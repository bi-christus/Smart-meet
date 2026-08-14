"use client";

import { useRef, useState } from "react";
import { Modal } from "./modal";
import { Avatar } from "./avatar";
import { SkeletonAvatar } from "./skeleton";
import { Icon } from "./icons";
import { fraseDeFalha } from "@/lib/erro-ui-core";
// As regras puras (`conferirFoto`, `conferirNome`, os tetos) chegam pela porta
// que `users.ts` abre de propósito para quem JÁ paga o SDK — e este arquivo
// paga, porque grava. Quem não grava, como `<Avatar>`, importa direto do módulo
// puro para não arrastar `firebase/firestore` junto.
import {
  LADO_FOTO_PX,
  LIMITE_FOTO_BYTES,
  ROLE_LABEL,
  conferirFoto,
  conferirNome,
  saveOwnProfile,
  tamanhoDataUri,
  type MeuCadastro,
  type UserProfile,
} from "@/lib/users";
import styles from "./perfil-modal.module.css";

/**
 * O perfil de uma pessoa — o único lugar do app onde a foto não é um selo.
 *
 * DE ONDE ELE VEIO. Este arquivo ABSORVEU `foto-perfil-modal.tsx` inteiro, e
 * aquele arquivo deixou de existir. A razão é que ele respondia metade de uma
 * pergunta: a foto entrou no produto, três pessoas passaram a usá-la, e não
 * havia tela nenhuma em que ela aparecesse maior que 38 px — o dono da foto era
 * justamente quem nunca a via. Manter os dois seria pior do que qualquer uma
 * das duas telas sozinha: duas rotas para trocar a mesma imagem, divergindo na
 * primeira vez que alguém melhorasse uma delas.
 *
 * OS DOIS MODOS, e por que o `modo` é obrigatório. Este componente serve tanto
 * ao SEU perfil (edita nome e foto) quanto ao de OUTRA pessoa (só leitura, do
 * avatar do card do Kanban). O desenho óbvio — um `readOnly?: boolean` — é o
 * desenho errado, porque o seu valor padrão é o perigoso: quem esquecesse de
 * passá-lo abriria um formulário editando o nome de outra pessoa, e o
 * compilador não teria nada a dizer. Aqui o modo é um campo OBRIGATÓRIO de uma
 * união discriminada: não existe "esquecer", só existe escolher. E o braço
 * `"eu"` exige o `onMudou` junto — quem edita tem de devolver a mudança para a
 * topbar, e o tipo não deixa prometer edição sem esse caminho de volta.
 *
 * A DIVISÃO DE TRABALHO com `avatar-core` é a do AGENTS.md §4: lá mora o que é
 * REGRA e roda em Node puro (o que cabe, o que é imagem, que nome vale); aqui
 * mora o que só existe dentro de um navegador (canvas, `File`,
 * `createImageBitmap`). Nenhuma das duas metades sabe fazer a outra.
 *
 * NADA SOBE PARA LUGAR NENHUM: a foto termina como data URI dentro do próprio
 * documento do usuário. É por isso que o corte e a redução acontecem aqui,
 * antes de qualquer escrita — 128×128 em JPEG cabe num campo; o arquivo
 * original de uma câmera de celular, não.
 */

/**
 * O lado do recorte vem de `avatar-core`, e não é declarado aqui.
 *
 * Ele e `LIMITE_FOTO_BYTES` são uma decisão só — o teto de bytes foi calculado
 * com "128×128 em JPEG sai entre 5 e 9 KiB". Dois números que precisam concordar
 * e moram em arquivos diferentes concordam até o dia em que alguém mexe num só,
 * e aí ninguém percebe: as fotos passam a ser recusadas, e a frase acusa
 * tamanho em vez de acusar a divergência.
 */
const LADO = LADO_FOTO_PX;

/**
 * O diâmetro do retrato grande, em px de CSS. Hoje, 96.
 *
 * É DERIVADO do lado gravado de propósito, e a fração é o argumento inteiro. A
 * foto no banco tem 128×128 reais; a maioria das telas em que este app é usado
 * é 2×, então um retrato de N px de CSS pede 2N px de imagem. Em 128 de CSS a
 * conta pediria 256 e a imagem entregaria 128 — ampliação de 2×, que é
 * exatamente onde um retrato começa a parecer borrado. Justo na única tela cujo
 * propósito é mostrar a foto bem.
 *
 * 0,75 põe o teto em 1,5× de ampliação em tela retina (e em uma REDUÇÃO em tela
 * 1×, onde sai nítido de sobra). É o maior tamanho que ainda se sustenta, e ao
 * mesmo tempo 2,5× o maior avatar do resto do app (38 px) — o bastante para
 * parar de ler como selo, que é o pedido.
 *
 * Se um dia `LADO_FOTO_PX` subir, este número sobe junto sem ninguém precisar
 * lembrar. Era esse o motivo de não escrever "96" aqui.
 */
const LADO_EXIBIDO = Math.round(LADO_FOTO_PX * 0.75);

/**
 * A escada de qualidade do JPEG.
 *
 * Começa em 0,82, que é onde um retrato de 128×128 fica na faixa prevista pelo
 * teto. Os degraus abaixo existem para o caso que `avatar-core` prevê em texto:
 * foto muito detalhada comprime mal e estoura mesmo depois de reduzida. Em vez
 * de recusar de cara, tenta-se de novo mais comprimido — perda que ninguém
 * enxerga num círculo de 38 px — e só então a pessoa recebe o "não".
 */
const QUALIDADES = [0.82, 0.7, 0.6, 0.5];

/** Os três tamanhos em que o avatar realmente aparece: card, topbar, lista. */
const TAMANHOS_REAIS = [22, 30, 38];

const NAO_E_IMAGEM =
  "Este arquivo não é uma imagem que o navegador consiga abrir. Escolha um JPG, PNG ou WebP.";
const SEM_CANVAS =
  "Este navegador não conseguiu preparar a imagem. Tente por outro navegador, ou por um computador.";

/** "9,4 KB" — mesma régua e mesma vírgula do `motivo` que `conferirFoto` devolve;
 *  dois formatos de tamanho na mesma tela leriam como dois números diferentes.
 *
 *  Continua duplicado de `avatar-core`, e continua consciente: o lugar dele é um
 *  módulo em `src/lib`, que este PR não pode tocar. A nota fica para quem for
 *  extrair os dois. */
function emKB(bytes: number): string {
  const kb = Math.ceil((bytes / 1024) * 10) / 10;
  return `${kb.toFixed(1).replace(".", ",")} KB`;
}

/**
 * Decodifica o arquivo escolhido.
 *
 * `createImageBitmap` primeiro porque ele decodifica FORA da thread principal —
 * é o que impede a interface de congelar diante de uma foto de 12 megapixels,
 * que é o tamanho normal do que sai de um celular. O `<img>` + object URL fica
 * como reserva para quem não o tem.
 */
async function decodificar(
  file: File,
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolver, rejeitar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rejeitar(new Error("nao decodificou"));
      img.src = url;
    });
  } finally {
    // A imagem já terminou de decodificar quando chegamos aqui; segurar o
    // object URL depois disso é vazar o arquivo inteiro na memória da aba.
    URL.revokeObjectURL(url);
  }
}

type Preparo = { ok: true; uri: string } | { ok: false; motivo: string };

/**
 * Arquivo escolhido → data URI quadrado, conferido e pronto para gravar.
 *
 * O corte é no CENTRO e acontece AQUI, não na hora de exibir: o avatar é sempre
 * um círculo, então recortar só na exibição guardaria bytes que ninguém vê —
 * e, pior, a prévia mostraria um enquadramento e o banco guardaria outro.
 */
async function prepararFoto(file: File): Promise<Preparo> {
  let fonte: ImageBitmap | HTMLImageElement;
  try {
    fonte = await decodificar(file);
  } catch {
    return { ok: false, motivo: NAO_E_IMAGEM };
  }

  try {
    const largura = "naturalWidth" in fonte ? fonte.naturalWidth : fonte.width;
    const altura = "naturalHeight" in fonte ? fonte.naturalHeight : fonte.height;
    if (!largura || !altura) return { ok: false, motivo: NAO_E_IMAGEM };

    const lado = Math.min(largura, altura);
    // Nunca ampliar: uma foto de 40×40 esticada para 128 não ganha detalhe
    // nenhum, só multiplica os bytes que precisam caber no teto.
    const alvo = Math.min(LADO, lado);

    const canvas = document.createElement("canvas");
    canvas.width = alvo;
    canvas.height = alvo;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, motivo: SEM_CANVAS };

    ctx.imageSmoothingQuality = "high";
    // JPEG não tem transparência. Sem este fundo, um PNG recortado sai com o
    // vazado preto — e branco é o que menos surpreende num retrato.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, alvo, alvo);
    ctx.drawImage(
      fonte,
      (largura - lado) / 2,
      (altura - lado) / 2,
      lado,
      lado,
      0,
      0,
      alvo,
      alvo,
    );

    let ultimoMotivo = SEM_CANVAS;
    for (const q of QUALIDADES) {
      const uri = canvas.toDataURL("image/jpeg", q);
      // Navegador que não sabe codificar JPEG devolve PNG caladamente, e um PNG
      // de 128×128 estoura o teto. Sair aqui evita mostrar "grande demais" a
      // quem escolheu uma foto de tamanho perfeitamente normal.
      if (!uri.startsWith("data:image/jpeg")) {
        return { ok: false, motivo: SEM_CANVAS };
      }
      // Quem sabe o teto é `avatar-core`, e a frase que explica o porquê é a
      // dele: ela cita os dois números, e nós não a escreveríamos melhor.
      const conferida = conferirFoto(uri);
      if (conferida.ok) return { ok: true, uri };
      ultimoMotivo = conferida.motivo;
    }
    return { ok: false, motivo: ultimoMotivo };
  } catch {
    return { ok: false, motivo: SEM_CANVAS };
  } finally {
    if ("close" in fonte) fonte.close();
  }
}

export type PerfilModalProps = {
  /**
   * A pessoa mostrada, como ela está em `/users`. No modo `"outra-pessoa"` é
   * um `usersMap[email]` — quem não estiver no mapa não tem perfil para abrir.
   */
  pessoa: UserProfile;
  onClose: () => void;
} & (
  | {
      modo: "eu";
      /** `user.photoURL` — a foto da conta Google, que só o próprio dono tem. */
      fotoDoGoogle?: string | null;
      /**
       * O que acabou de ser gravado, de volta para o shell — exatamente o
       * objeto que foi ao banco. Sem isto a topbar só mudaria no próximo
       * login: o perfil é lido uma vez, na entrada.
       */
      onMudou: (gravado: MeuCadastro) => void;
    }
  | { modo: "outra-pessoa" }
);

export function PerfilModal(props: PerfilModalProps) {
  const { pessoa, onClose } = props;
  const meu = props.modo === "eu";

  /**
   * O que já está NO BANCO — a linha de base contra a qual "mudou?" é medido.
   *
   * Deriva do prop e não é estado, porque não existe estado intermediário para
   * guardar: `saveOwnProfile` grava nome e foto num `updateDoc` só. Ou tudo
   * entrou e o diálogo fechou, ou nada entrou e a base continua sendo esta.
   */
  const nomeSalvo = (pessoa.name ?? "").trim();
  const fotoSalva = pessoa.photo ?? null;

  const [nome, setNome] = useState(pessoa.name ?? "");
  /**
   * A foto ainda não gravada: `undefined` = ninguém mexeu, `string` = escolheu
   * uma nova, `null` = pediu para remover. Mesma convenção de três estados que
   * o shell usa para a foto local, e pelo mesmo motivo: "não mexeu" e "removeu"
   * são respostas diferentes que um `string | null` sozinho confundiria.
   */
  const [fotoPendente, setFotoPendente] = useState<string | null | undefined>(
    undefined,
  );
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fotoMostrada = fotoPendente === undefined ? fotoSalva : fotoPendente;
  /**
   * No modo `"eu"` o retrato é a PRÉVIA do que vai ser gravado — nome digitado
   * e foto escolhida, antes de existirem no banco. No modo `"outra-pessoa"` é a
   * pessoa como ela está, direto do prop: `nome` e `fotoPendente` congelaram no
   * momento em que o diálogo abriu, e ali eles não têm o que representar.
   */
  const previa = meu ? { ...pessoa, name: nome, photo: fotoMostrada } : pessoa;
  const fotoDoGoogle = props.modo === "eu" ? props.fotoDoGoogle : null;

  const nomeMudou = meu && nome.trim() !== nomeSalvo;
  const fotoMudou = meu && fotoPendente !== undefined;
  const ocupado = preparando || gravando;

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // O input precisa esquecer o arquivo: escolher DE NOVO o mesmo depois de um
    // erro não dispara `change` enquanto o valor anterior continuar lá.
    e.target.value = "";
    if (!file) return;

    setErro(null);
    setFotoPendente(undefined);
    setPreparando(true);
    const r = await prepararFoto(file);
    setPreparando(false);

    if (!r.ok) {
      setErro(r.motivo);
      return;
    }
    setFotoPendente(r.uri);
  }

  /**
   * Grava — e "pela metade" não é um estado que exista aqui.
   *
   * NÃO PORQUE ESTE ARQUIVO TOME CUIDADO, mas porque `saveOwnProfile` põe nome
   * e foto no MESMO `updateDoc`: ou os dois campos entram, ou nenhum. Era esse
   * o buraco de uma tela com dois campos e um botão só — duas escritas em
   * sequência, a segunda falhando depois de a primeira ter entrado, e a pessoa
   * ficando com o cadastro pela metade sem nada na tela dizendo qual metade.
   * Por isso não há aqui nem `setUserPhoto` nem `removeUserPhoto`: uma escrita
   * só é a garantia, e dois caminhos de escrita a desfariam.
   *
   * A CONFERÊNCIA VEM ANTES DA ESCRITA e usa a mesma função que a regra do
   * Firestore encarna. A regra é a segunda barreira, não a primeira: ela sabe
   * responder "sem permissão", não sabe dizer que o nome ficou sem uma letra
   * sequer — e essa é a frase de que precisa quem acabou de digitar.
   */
  async function salvar() {
    if (props.modo !== "eu") return;
    const { onMudou } = props;
    if (!nomeMudou && !fotoMudou) return;

    setErro(null);

    const conferido = conferirNome(nome);
    if (!conferido.ok) {
      setErro(conferido.motivo);
      return;
    }

    /**
     * `photo` só entra quando MUDOU, e a ausência dela é significativa: em
     * `MeuCadastro`, campo ausente quer dizer "não mexa na foto". Mandar
     * `photo: null` por descuido faria uma correção de nome apagar a imagem de
     * quem nem chegou a abrir o seletor de arquivo.
     */
    const gravado: MeuCadastro =
      fotoPendente === undefined
        ? { name: conferido.nome }
        : { name: conferido.nome, photo: fotoPendente };

    setGravando(true);
    try {
      await saveOwnProfile(pessoa.email, gravado);
      onMudou(gravado);
      onClose();
    } catch (e) {
      console.error("Erro ao salvar o perfil:", e);
      setErro(
        fraseDeFalha("Não foi possível salvar o perfil.", e, navigator.onLine),
      );
      setGravando(false);
    }
  }

  /**
   * O botão que acompanha "Escolher imagem", e o que ele faz depende de onde a
   * foto está. Um só, porque em qualquer momento existe UMA volta que faz
   * sentido: tirar a que está gravada, desistir da que se acabou de escolher,
   * ou desfazer a remoção ainda não salva. Três botões fixos com dois sempre
   * inertes seriam a mesma informação, escrita de um jeito que obriga a ler.
   */
  const voltaDaFoto: {
    texto: string;
    icone: string;
    vira: string | null | undefined;
  } | null =
    fotoPendente === null
      ? { texto: "Manter a foto", icone: "history", vira: undefined }
      : typeof fotoPendente === "string"
        ? { texto: "Descartar imagem", icone: "x", vira: undefined }
        : fotoSalva
          ? { texto: "Remover foto", icone: "trash", vira: null }
          : null;

  // O rótulo NOMEIA o que o clique vai gravar, e depois o que ele está
  // gravando. Um "Salvar" genérico ao lado de dois campos não diz se a foto
  // entra junto — e é justamente essa a dúvida. "Salvando…" cru teria o mesmo
  // defeito do "Carregando…" que o AGENTS.md §3 proíbe: anuncia que algo
  // acontece sem dizer o quê.
  const rotuloSalvar = gravando
    ? nomeMudou && fotoMudou
      ? "Salvando o perfil…"
      : nomeMudou
        ? "Salvando o nome…"
        : fotoPendente === null
          ? "Removendo a foto…"
          : "Salvando a foto…"
    : nomeMudou && fotoMudou
      ? "Salvar nome e foto"
      : nomeMudou
        ? "Salvar nome"
        : fotoPendente === null
          ? "Remover foto"
          : fotoMudou
            ? "Salvar foto"
            : "Salvar";

  return (
    <Modal
      onClose={onClose}
      ariaLabel={meu ? "Seu perfil" : `Perfil de ${pessoa.name || pessoa.email}`}
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={460}
    >
      <div className={styles.head}>
        <span className={styles.chip}>
          <Icon name="users" size={12} /> {meu ? "Seu perfil" : "Perfil"}
        </span>
      </div>

      <div className={styles.retrato}>
        {preparando ? (
          <SkeletonAvatar
            sizes={[LADO_EXIBIDO]}
            texto="Preparando a imagem…"
          />
        ) : (
          // `alt` vazio: o nome vem escrito logo abaixo, e um `alt` com o nome
          // faria o leitor de tela dizê-lo duas vezes seguidas.
          <Avatar
            pessoa={previa}
            size={LADO_EXIBIDO}
            fotoDoGoogle={fotoDoGoogle}
            alt=""
            className={styles.foto}
          />
        )}
      </div>

      {meu ? (
        <>
          <div className={styles.fotoAcoes}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => inputRef.current?.click()}
              disabled={ocupado}
            >
              <Icon name="upload" size={15} />{" "}
              {preparando
                ? "Preparando…"
                : fotoMostrada
                  ? "Trocar imagem"
                  : "Escolher imagem"}
            </button>
            {/* Nenhum destes é escrita imediata, como "Remover foto" era
                antes: com nome e foto na mesma tela, dois caminhos de escrita
                seriam dois jeitos de a tela discordar do banco. E o botão
                sempre oferece a VOLTA do estado em que se está — remover sem
                como desfazer é um beco, e a saída não pode ser fechar o
                diálogo e torcer. A foto do Google nunca aparece aqui: ela não
                está no nosso banco, e não há o que remover. */}
            {voltaDaFoto && (
              <button
                type="button"
                className={styles.btnDanger}
                onClick={() => {
                  setErro(null);
                  setFotoPendente(voltaDaFoto.vira);
                }}
                disabled={ocupado}
              >
                <Icon name={voltaDaFoto.icone} size={15} />{" "}
                {voltaDaFoto.texto}
              </button>
            )}
          </div>

          <div className={styles.legenda}>
            {preparando ? (
              "Cortando e reduzindo a imagem…"
            ) : fotoPendente === null ? (
              "A foto sai ao salvar, e o avatar volta a ser a inicial do seu nome."
            ) : (
              <>
                A imagem é cortada no centro e reduzida para {LADO}×{LADO}.
                {/* O peso aparece porque ele é baixado por todo mundo em toda
                    tela — quem escolhe a foto é a única pessoa em posição de
                    preferir uma mais leve, e para isso precisa saber o número. */}
                {typeof fotoPendente === "string" &&
                  ` ${emKB(tamanhoDataUri(fotoPendente))} de ${emKB(LIMITE_FOTO_BYTES)}.`}
              </>
            )}
          </div>

          <div
            className={styles.mini}
            role="group"
            aria-label="Prévia do avatar nos tamanhos reais"
          >
            {TAMANHOS_REAIS.map((s) => (
              <Avatar
                key={s}
                pessoa={previa}
                size={s}
                fotoDoGoogle={fotoDoGoogle}
                alt=""
              />
            ))}
            <span className={styles.miniTexto}>
              No card, na barra do topo e na lista de usuários.
            </span>
          </div>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="perfil-nome">
              Nome
            </label>
            <input
              id="perfil-nome"
              className={styles.input}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Como você quer ser chamado"
              disabled={gravando}
              autoComplete="name"
            />
          </div>

          {/* Escondido de propósito: o input de arquivo cru não aceita estilo,
              não deve receber Tab, e quem lhe dá rótulo é o botão lá em cima.
              FICA NO FIM DO DIÁLOGO por causa do `<Modal>`: ao abrir, ele põe o
              foco no primeiro elemento focável que encontra, e um `<input>` com
              `display: none` casa com aquele seletor e engole o foco em
              silêncio — o diálogo abriria com o foco em lugar nenhum, e o Tab
              de quem usa teclado recomeçaria do topo da página. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className={styles.arquivo}
            onChange={(e) => void escolher(e)}
            tabIndex={-1}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className={styles.nomeLido}>{pessoa.name || pessoa.email}</div>
      )}

      <dl className={styles.dados}>
        <dt>E-mail</dt>
        <dd className={styles.mono}>{pessoa.email}</dd>

        <dt>Papel</dt>
        <dd>{ROLE_LABEL[pessoa.role]}</dd>

        <dt>Cargo</dt>
        <dd className={pessoa.cargo ? undefined : styles.vazio}>
          {pessoa.cargo || "não informado"}
        </dd>

        <dt>Setores</dt>
        <dd>
          {pessoa.sectors?.length ? (
            <span className={styles.setores}>
              {pessoa.sectors.map((s) => (
                <span key={s} className={styles.setor}>
                  {s}
                </span>
              ))}
            </span>
          ) : (
            // "nenhum" e "ainda não carregou" são coisas diferentes, e aqui só
            // a primeira existe: o perfil chega pronto de `/users`, junto com o
            // clique que abriu este diálogo. Não há espera para esqueletar.
            <span className={styles.vazio}>nenhum setor</span>
          )}
        </dd>
      </dl>

      {meu && (
        <p className={styles.nota}>
          Papel, cargo e setores são definidos por quem administra o sistema.
        </p>
      )}

      {erro && (
        <div className={styles.err} role="alert">
          {erro}
        </div>
      )}

      <div className={styles.acoes}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={onClose}
          disabled={gravando}
        >
          {meu ? "Cancelar" : "Fechar"}
        </button>
        {meu && (
          <button
            type="button"
            className={styles.btnSave}
            onClick={() => void salvar()}
            disabled={ocupado || (!nomeMudou && !fotoMudou)}
          >
            {rotuloSalvar}
          </button>
        )}
      </div>
    </Modal>
  );
}
