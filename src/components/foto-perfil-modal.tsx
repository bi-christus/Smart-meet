"use client";

import { useRef, useState } from "react";
import { Modal } from "./modal";
import { Avatar, type PessoaDoAvatar } from "./avatar";
import { SkeletonAvatar } from "./skeleton";
import { Icon } from "./icons";
import { fraseDeFalha } from "@/lib/erro-ui-core";
import {
  LADO_FOTO_PX,
  LIMITE_FOTO_BYTES,
  conferirFoto,
  tamanhoDataUri,
  setUserPhoto,
  removeUserPhoto,
} from "@/lib/users";
import styles from "./foto-perfil-modal.module.css";

/**
 * Trocar a própria foto de perfil.
 *
 * POR QUE É ARQUIVO PRÓPRIO E NÃO MORA NO SHELL: `layout.tsx` é o shell de
 * TODAS as páginas — é ele quem decide navegação, tema e sessão. Enfiar lá
 * dentro um pipeline de `File` → `createImageBitmap` → canvas → JPEG faria o
 * arquivo mais lido do projeto passar a ser, metade dele, sobre processamento
 * de imagem. O shell continua sabendo só o que lhe cabe: que existe um item de
 * menu, e que a foto nova volta por um callback.
 *
 * A DIVISÃO DE TRABALHO com `avatar-core` é a do AGENTS.md §4, e é o motivo de
 * este arquivo existir: lá mora o que é REGRA e dá para testar em Node puro
 * (o que cabe, o que é imagem, qual avatar ganha); aqui mora o que só existe
 * dentro de um navegador (canvas, `File`, `createImageBitmap`). Nenhuma das
 * duas metades sabe fazer a outra.
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

/**
 * A frase que a pessoa lê quando a GRAVAÇÃO falha.
 *
 * Mesma construção de `fraseDeFalha` em `kanban/page.tsx` e pelo mesmo motivo:
 * quem decide o que dizer continua sendo `classificarErro`, mas o título dele
 * foi escrito para LEITURA ("Não foi possível carregar") e quem clicou em
 * Salvar não estava carregando nada. Por isso a ação entra na frente, e dele se
 * aproveita a causa — quando ele a nomeia — e a última frase da descrição, que
 * é onde mora o que fazer agora.
 *
 * Está duplicado, e é consciente: o lugar dele é um módulo em `src/lib`, que
 * este PR não pode tocar. Fica a nota para quem for extrair os dois.
 */
/** "9,4 KB" — mesma régua e mesma vírgula do `motivo` que `conferirFoto` devolve;
 *  dois formatos de tamanho na mesma tela leriam como dois números diferentes. */
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

export function FotoPerfilModal({
  pessoa,
  email,
  temFoto,
  onFoto,
  onClose,
}: {
  pessoa: PessoaDoAvatar;
  email: string;
  /** Se já existe foto gravada — é o que decide se "Remover foto" aparece. */
  temFoto: boolean;
  /**
   * A foto nova (ou `null`, ao remover) de volta para o shell. Sem isto a
   * topbar só mudaria no próximo login: o perfil é lido uma vez, na entrada.
   */
  onFoto: (uri: string | null) => void;
  onClose: () => void;
}) {
  const [preparando, setPreparando] = useState(false);
  const [nova, setNova] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState<"salvar" | "remover" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const previa: PessoaDoAvatar = nova ? { ...pessoa, photo: nova } : pessoa;
  const ocupado = preparando || gravando !== null;

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // O input precisa esquecer o arquivo: escolher DE NOVO o mesmo depois de um
    // erro não dispara `change` enquanto o valor anterior continuar lá.
    e.target.value = "";
    if (!file) return;

    setErro(null);
    setNova(null);
    setPreparando(true);
    const r = await prepararFoto(file);
    setPreparando(false);

    if (!r.ok) {
      setErro(r.motivo);
      return;
    }
    setNova(r.uri);
  }

  async function salvar() {
    if (!nova) return;
    setErro(null);
    setGravando("salvar");
    try {
      await setUserPhoto(email, nova);
      onFoto(nova);
      onClose();
    } catch (e) {
      console.error("Erro ao salvar a foto de perfil:", e);
      setErro(fraseDeFalha("Não foi possível salvar a foto.", e, navigator.onLine));
      setGravando(null);
    }
  }

  async function remover() {
    setErro(null);
    setGravando("remover");
    try {
      await removeUserPhoto(email);
      onFoto(null);
      onClose();
    } catch (e) {
      console.error("Erro ao remover a foto de perfil:", e);
      setErro(fraseDeFalha("Não foi possível remover a foto.", e, navigator.onLine));
      setGravando(null);
    }
  }

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Foto de perfil"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={420}
    >
      <div className={styles.head}>
        <span className={styles.chip}>
          <Icon name="users" size={12} /> Foto de perfil
        </span>
      </div>

      <p className={styles.ajuda}>
        A imagem é cortada no centro, reduzida para {LADO}×{LADO} e guardada no
        seu perfil. Sem foto, o avatar volta a ser a inicial do seu nome.
      </p>

      <div
        className={styles.previa}
        role="group"
        aria-label="Prévia do avatar nos tamanhos reais"
      >
        {preparando ? (
          <SkeletonAvatar sizes={TAMANHOS_REAIS} texto="Preparando a imagem…" />
        ) : (
          // A prévia é do tamanho de verdade, e são três: mostrar um círculo
          // de 120 px aqui prometeria um detalhe que o card de 22 px não tem.
          TAMANHOS_REAIS.map((s) => (
            <Avatar key={s} pessoa={previa} size={s} alt="" />
          ))
        )}
      </div>

      <div className={styles.legenda}>
        {preparando ? (
          "Cortando e reduzindo a imagem…"
        ) : (
          <>
            Como ela aparece no card, na barra do topo e na lista de usuários.
            {/* O peso aparece porque ele é baixado por todo mundo em toda tela
                — quem escolhe a foto é a única pessoa em posição de preferir
                uma mais leve, e para isso precisa saber o número. */}
            {nova &&
              ` ${emKB(tamanhoDataUri(nova))} de ${emKB(LIMITE_FOTO_BYTES)}.`}
          </>
        )}
      </div>

      <div className={styles.escolha}>
        {/* Escondido de propósito: o input de arquivo cru não aceita estilo,
            não deve receber Tab, e quem lhe dá rótulo é o botão ao lado. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className={styles.arquivo}
          onChange={(e) => void escolher(e)}
          tabIndex={-1}
          aria-hidden="true"
        />
        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
        >
          <Icon name="upload" size={15} />{" "}
          {preparando
            ? "Preparando…"
            : nova
              ? "Trocar imagem"
              : "Escolher imagem"}
        </button>
        {temFoto && (
          <button
            type="button"
            className={styles.btnDanger}
            onClick={() => void remover()}
            disabled={ocupado}
          >
            <Icon name="trash" size={15} />{" "}
            {gravando === "remover" ? "Removendo…" : "Remover foto"}
          </button>
        )}
      </div>

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
          disabled={gravando !== null}
        >
          Cancelar
        </button>
        <button
          type="button"
          className={styles.btnSave}
          onClick={() => void salvar()}
          disabled={!nova || ocupado}
        >
          {gravando === "salvar" ? "Salvando…" : "Salvar foto"}
        </button>
      </div>
    </Modal>
  );
}
