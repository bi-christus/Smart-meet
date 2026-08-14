"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LADO_FOTO_PX, avatarDe, type PessoaDoAvatar } from "@/lib/avatar-core";
import { OverlayPortal } from "./overlay-portal";
import styles from "./avatar.module.css";

/**
 * O rosto de uma pessoa na interface — foto quando existe, inicial quando não.
 *
 * POR QUE ELE EXISTE: a mesma decisão estava escrita à mão em seis lugares
 * (topbar, tela de acesso pendente, lista do Admin, responsável no card,
 * autor no histórico, autor no comentário). Seis cópias de "se tem foto mostra
 * a foto, senão a primeira letra sobre a cor" — e cada uma errava algo
 * diferente: nenhuma tratava foto que falha ao carregar, três chumbavam
 * `#555` como cor de reserva, e o `alt` variava entre o nome e nada sem
 * critério. Cada avatar novo era a sétima chance de errar de um jeito inédito.
 *
 * A ESCOLHA NÃO MORA AQUI. Quem decide entre foto e inicial — e qual foto, e
 * qual letra, e qual cor — é `avatarDe`, em `avatar-core`, que é módulo puro e
 * tem teste no `prebuild`. Este arquivo é só a pintura daquela decisão.
 *
 * E É DE `avatar-core` QUE ELE IMPORTA, e não do `users.ts` que reexporta a
 * mesma função. O aviso de lá — "não faça a tela importar de dois módulos para
 * desenhar um elemento só" — é sobre as TELAS, e este componente existe
 * justamente para que nenhuma delas precise fazer isso. Vindo do módulo puro,
 * `<Avatar>` não arrasta `firebase/firestore` para dentro de todo lugar que
 * mostra o rosto de alguém.
 */

/** Reexportado para quem monta a pessoa na mão (autor de comentário, por ex.). */
export type { PessoaDoAvatar };

/**
 * O atraso entre pousar o ponteiro e a prévia aparecer.
 *
 * É o MESMO número do Cronograma (`ABRIR_PREVIA_MS`, `cronograma/page.tsx`), e
 * ser o mesmo é o ponto: "pausar o mouse para ver melhor" é um gesto só, e
 * cobrá-lo em 320 ms numa tela e em 200 ms na outra faria o app parecer dois
 * apps. Aqui ele também evita o piscar de quem só atravessa o card na diagonal e
 * cruza o avatar do canto no caminho.
 *
 * Está duplicado de propósito: extrair a mecânica das duas prévias para um hook
 * comum é mudança que atravessa arquivo de outra frente, e vale como Issue
 * própria — não como efeito colateral desta.
 */
const ABRIR_PREVIA_MS = 320;

/** Retângulo do alvo na janela — é dele que a prévia se pendura. */
type Ancora = { left: number; right: number; top: number; bottom: number };

export function Avatar({
  pessoa,
  size = 32,
  fotoDoGoogle,
  alt = "",
  title,
  className,
  aoAbrirPerfil,
}: {
  pessoa: PessoaDoAvatar;
  /** Diâmetro em px. A fonte da inicial acompanha, para a letra nunca vazar. */
  size?: number;
  /**
   * `user.photoURL` — só existe para o PRÓPRIO usuário logado. Das outras
   * pessoas o app só conhece o que está gravado em `/users`.
   */
  fotoDoGoogle?: string | null;
  /**
   * Vazio quando o nome já está escrito ao lado (avatar decorativo); o nome da
   * pessoa quando o avatar aparece sozinho e é ele quem a identifica. Em modo
   * alvo (ver `aoAbrirPerfil`) ele vira o rótulo do BOTÃO, e por isso deve
   * dizer o que o clique faz, e não só quem é a pessoa.
   */
  alt?: string;
  /**
   * A dica nativa do navegador — e ela SÓ existe fora do modo alvo. Em modo
   * alvo o `title` é descartado de propósito (ver `AlvoDePerfil`), e o que
   * sobra dele é servir de reserva para o rótulo do botão quando não veio
   * `alt`.
   */
  title?: string;
  /** Fica sempre no círculo, mesmo em modo alvo — quem estiliza "o avatar" está
   *  falando da bolinha, não do botão invisível que passou a envolvê-la. */
  className?: string;
  /**
   * PRESENTE = ESTE ROSTO É UM ALVO. Ausente (o padrão) = exatamente o avatar
   * de sempre: um `<img>` ou um `<span>`, sem botão, sem ouvinte, sem timer.
   *
   * Uma prop só, e não um par `clicavel` + `comPrevia`, porque as duas coisas
   * são a mesma afirmação dita de dois jeitos: "dá para ir ver esta pessoa". Um
   * avatar que abre prévia mas não abre nada ao clique seria uma porta pintada
   * na parede; um que abre o perfil sem avisar por nada que é clicável seria a
   * armadilha oposta. Separá-las em duas props criaria esses dois estados sem
   * que ninguém os quisesse.
   *
   * ONDE LIGAR: onde o avatar é o rosto de OUTRA pessoa e ver quem ela é
   * responde a uma pergunta que a tela levanta — hoje, o responsável no card do
   * Kanban. Onde NÃO ligar: no histórico e no comentário (um alvo por linha, em
   * lista que rola, é ruído, e o nome já está escrito ao lado), na topbar (o
   * clique ali já tem dono: o menu do usuário) e no acesso pendente (a pessoa
   * ainda não tem perfil para abrir).
   */
  aoAbrirPerfil?: () => void;
}) {
  // Guardamos a URL que falhou, e não um booleano: trocar de pessoa (ou de
  // foto) tem de dar uma chance nova à imagem, e um booleano deixaria o avatar
  // preso na inicial até o componente ser desmontado.
  const [srcQueFalhou, setSrcQueFalhou] = useState<string | null>(null);

  const escolha = avatarDe(pessoa, fotoDoGoogle ?? undefined);
  const foto =
    escolha.tipo === "foto" && escolha.src !== srcQueFalhou ? escolha.src : null;

  // Em modo alvo o nome sobe para o `aria-label` do botão e a dica nativa some
  // (ver `AlvoDePerfil`). Deixar o nome também no filho faria o leitor de tela
  // anunciar a pessoa duas vezes seguidas.
  const altDaCara = aoAbrirPerfil ? "" : alt;
  const titleDaCara = aoAbrirPerfil ? undefined : title;

  let cara: ReactNode;
  if (foto) {
    cara = (
      // O projeto inteiro usa <img> cru para avatar: `next/image` não serve
      // para data URI variável nem para host do Google, que muda de assinatura.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`${styles.raiz} ${styles.foto} ${className ?? ""}`}
        style={{ width: size, height: size }}
        src={foto}
        alt={altDaCara}
        title={titleDaCara}
        // A foto do Google recusa o request quando o referer é outro domínio;
        // em data URI é inócuo, e uniformizar evita o quadrado quebrado.
        referrerPolicy="no-referrer"
        // URL do Google expira e data URI pode estar corrompido no banco. Sem
        // isto, o resultado é o ícone de imagem quebrada no lugar da pessoa.
        onError={() => setSrcQueFalhou(foto)}
        // Imagem é arrastável por padrão, e dentro de um card `draggable` isso
        // faria a FOTO virar a alça do arraste — o card sairia do lugar levando
        // a imagem como carga em vez do id da demanda.
        draggable={false}
      />
    );
  } else {
    // Chegamos aqui ou porque não havia foto, ou porque a que havia não
    // carregou. No segundo caso a inicial de reserva vem da MESMA regra, pedida
    // de novo sem foto nenhuma — escrever aqui um "primeira letra em maiúscula
    // sobre a cor" seria fundar a segunda versão da decisão que este componente
    // unifica.
    const semFoto =
      escolha.tipo === "inicial" ? escolha : avatarDe({ ...pessoa, photo: null });
    // `avatarDe` sem `photo` e sem foto do provedor só tem um caminho de saída;
    // o `null` existe para o TypeScript, não para a tela.
    const inicial = semFoto.tipo === "inicial" ? semFoto : null;
    cara = (
      <span
        className={`${styles.raiz} ${styles.inicial} ${className ?? ""}`}
        style={{
          width: size,
          height: size,
          // 0,4 do diâmetro é a proporção que os seis avatares à mão já usavam
          // (30/12, 26/10, 38/14); centralizar isso mantém todos iguais.
          fontSize: Math.round(size * 0.4),
          background: inicial?.cor,
        }}
        title={titleDaCara}
        role={altDaCara ? "img" : undefined}
        aria-label={altDaCara || undefined}
        // Sem nome para dar, a letra é ruído para quem usa leitor de tela: ela
        // não acrescenta nada ao nome que já está escrito ao lado.
        aria-hidden={altDaCara ? undefined : true}
      >
        {inicial?.letra}
      </span>
    );
  }

  if (!aoAbrirPerfil) return cara;

  return (
    <AlvoDePerfil foto={foto} rotulo={alt || title || ""} aoAbrir={aoAbrirPerfil}>
      {cara}
    </AlvoDePerfil>
  );
}

/**
 * O avatar como alvo: botão que abre o perfil, e prévia da foto ao pousar.
 *
 * COMPONENTE À PARTE, e não um punhado de `if` dentro do `<Avatar>`: os cinco
 * lugares que continuam decorativos não podem pagar por isto. Aqui dentro há
 * estado, timer e ouvintes de janela; lá fora, avatar decorativo segue sendo um
 * `<img>` com um `useState` — e é ele que aparece dezenas de vezes por tela.
 *
 * O ALVO DENTRO DO ALVO. O card do Kanban é clicável (abre a demanda) e
 * `draggable` (muda de coluna). Um botão no meio dele cria três conflitos, e os
 * três estão resolvidos aqui: o clique não sobe (`stopPropagation`), o arraste
 * continua pegando o card inteiro (o botão não é `draggable`, e a foto lá em
 * cima é `draggable={false}`), e a prévia se fecha assim que qualquer arraste
 * começa.
 *
 * E AQUI NÃO HÁ `title`. A dica nativa é desenhada pelo navegador colada ao
 * ponteiro — isto é, exatamente onde a prévia nasce 320 ms depois, e por cima
 * dela: o retrato que a prévia existe para mostrar ficava tapado pela caixinha
 * de texto. Não dá para reposicionar o `title`, ele é do sistema; então ele sai.
 *
 * QUEM NÃO PAUSA O PONTEIRO NÃO PERDE NADA. Teclado e leitor de tela nunca
 * dependeram do `title` — quem os atende é o `aria-label`, que continua dizendo
 * quem é a pessoa e o que o clique faz, e que não desenha caixa nenhuma. Para
 * os olhos, quem responde "de quem é este rosto?" passou a ser o nome escrito
 * ao lado dele no card.
 */
function AlvoDePerfil({
  foto,
  rotulo,
  aoAbrir,
  children,
}: {
  /** A foto a ampliar, ou `null` para quem não tem — ver `pairou`. */
  foto: string | null;
  rotulo: string;
  aoAbrir: () => void;
  children: ReactNode;
}) {
  /**
   * Um estado só para as três fases, e não um par de booleanos.
   *
   * `"esperando"` precisa existir separado de "fechada" porque é durante ele que
   * um arraste pode começar — e sem sabê-lo, a prévia abriria no meio do
   * arraste, sozinha, 320 ms depois de o card já ter saído do lugar. Dois
   * booleanos diriam o mesmo com um quarto estado impossível a mais
   * ("esperando" e "aberta" ao mesmo tempo).
   */
  const [previa, setPrevia] = useState<Ancora | "esperando" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * O botão, para medi-lo na hora de ABRIR e não na hora de pousar.
   *
   * A diferença é real: `.kcard:hover` levanta o card 2 px em 160 ms, e uma
   * medida tirada no `mouseenter` seria a de antes do movimento. Medir 320 ms
   * depois pega o card já assentado, e a prévia nasce colada no rosto.
   */
  const botao = useRef<HTMLButtonElement>(null);

  // Efeito só de limpeza: sair da tela com o atraso pendente deixaria um
  // `setTimeout` vivo tentando abrir a prévia de um card que já não existe.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /**
   * Enquanto há prévia (aberta ou a caminho), a janela inteira pode cancelá-la.
   *
   * NA CAPTURA, e na janela, porque nenhum dos dois eventos chega aqui de outro
   * jeito. O `dragstart` nasce no CARD, que é ancestral deste botão — ele nunca
   * passa por aqui subindo. E `scroll` não borbulha: a coluna do Kanban rola por
   * dentro, e só a fase de captura vê isso.
   *
   * Assinado só quando armado, e não uma vez por avatar: são dezenas de cards
   * por quadro, e cinquenta ouvintes disparando a cada quadro de rolagem seria
   * pagar caro por algo que no máximo um avatar de cada vez usa.
   */
  useEffect(() => {
    if (!previa) return;
    const fechar = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setPrevia(null);
    };
    window.addEventListener("dragstart", fechar, true);
    window.addEventListener("scroll", fechar, true);
    return () => {
      window.removeEventListener("dragstart", fechar, true);
      window.removeEventListener("scroll", fechar, true);
    };
  }, [previa]);

  function pararTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  /**
   * O aparelho tem ponteiro que pousa sem clicar.
   *
   * Vale para os DOIS caminhos de abertura. O toque em tela é o caso que ele
   * pega: aparelho híbrido sintetiza `mouseenter` a partir do toque, e a prévia
   * que abrisse assim ficaria pendurada sobre o quadro sem nenhum `mouseleave`
   * para fechá-la. A pergunta é sobre o ponteiro e não sobre a largura da
   * janela: `(max-width: 900px)` esconderia a prévia de quem só encostou a
   * janela do navegador na metade da tela, com mouse e teclado na mão.
   */
  function temHover() {
    return window.matchMedia("(hover: hover)").matches;
  }

  /** Abre agora, medindo o botão onde ele está neste instante. */
  function abrirPrevia() {
    const el = botao.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPrevia({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }

  /**
   * QUEM NÃO TEM FOTO NÃO ABRE PRÉVIA NENHUMA — nem uma caixa grande com a
   * inicial dentro.
   *
   * A prévia existe para uma coisa só: ver bem uma foto que na tela tem 22 px.
   * A inicial não tem nada a revelar — ela já está inteira e legível no
   * tamanho em que está, e ampliá-la seis vezes devolveria um quadrado colorido
   * enorme com um "M" no meio, que não informa nada e ainda cobre o quadro.
   * Quem não tem foto continua com o clique (o perfil dela existe e tem nome,
   * papel e setores para ver) e com o nome escrito ao lado do rosto no card.
   */
  function pairou() {
    if (!foto || !temHover()) return;
    pararTimer();
    setPrevia("esperando");
    timer.current = setTimeout(abrirPrevia, ABRIR_PREVIA_MS);
  }

  /**
   * Sair fecha na hora, sem a tolerância que o Cronograma tem.
   *
   * Lá ela existe para atravessar os 4 px entre dois chips da mesma célula, que
   * o ponteiro cruza em menos de um quadro; aqui o avatar mais próximo está a um
   * card inteiro de distância, e não há vão nenhum a costurar. Segurar uma foto
   * de 128 px sobre o quadro depois de o ponteiro ter ido embora seria só a
   * prévia atrapalhando a leitura do que está atrás dela.
   */
  function saiu() {
    pararTimer();
    setPrevia(null);
  }

  /**
   * Foco é decisão deliberada: quem tabulou até aqui não precisa esperar.
   *
   * Mas só o foco QUE APARECE. Clicar num botão também o foca, e sem o
   * `:focus-visible` o clique do mouse abriria a prévia instantaneamente no
   * `mousedown` para fechá-la no `click`, uns 80 ms depois — um lampejo de foto
   * de 128 px logo antes de o perfil abrir. O seletor é exatamente a pergunta
   * certa: é o navegador dizendo se ESTE foco merece ser visto, e é para esse
   * caso (teclado) que o caminho existe.
   */
  function focou(e: React.FocusEvent<HTMLButtonElement>) {
    if (!foto || !temHover()) return;
    if (!e.currentTarget.matches(":focus-visible")) return;
    pararTimer();
    abrirPrevia();
  }

  return (
    <>
      <button
        ref={botao}
        type="button"
        className={styles.alvo}
        // O card inteiro é clicável e abre a demanda. Sem isto, ver o rosto de
        // quem responde por ela abriria as duas coisas de uma vez — e o modal da
        // demanda, que é maior, cobriria o perfil que a pessoa pediu.
        onClick={(e) => {
          e.stopPropagation();
          saiu();
          aoAbrir();
        }}
        onMouseEnter={pairou}
        onMouseLeave={saiu}
        onFocus={focou}
        onBlur={saiu}
        aria-label={rotulo || undefined}
      >
        {children}
      </button>
      {previa && previa !== "esperando" && foto && (
        <PreviaDaFoto src={foto} ancora={previa} />
      )}
    </>
  );
}

/**
 * A foto, grande, e nada mais.
 *
 * NÃO É UM CARTÃO DE INFORMAÇÕES — não tem nome, papel nem setor escritos. Quem
 * quer isso clica e abre o perfil; esta caixa responde a outra pergunta, que é
 * "quem é essa pessoa que eu não reconheço em 22 px". Por isso ela é
 * `aria-hidden`: para quem usa leitor de tela não há nada aqui que o rótulo do
 * botão já não diga, e um `role="tooltip"` sem texto anunciaria uma caixa vazia.
 *
 * ELA NÃO RECEBE PONTEIRO (`pointer-events: none` no CSS). É o que resolve de
 * uma vez os dois riscos de uma caixa grande sobre um quadro arrastável: ela não
 * rouba o clique de quem ia abrir o card por baixo, e cobrir o avatar não
 * interrompe o próprio hover que a sustenta.
 *
 * Mora num portal porque a coluna do Kanban tem `overflow` próprio: lá dentro,
 * qualquer caixa maior que o card seria cortada na borda da coluna.
 */
function PreviaDaFoto({ src, ancora }: { src: string; ancora: Ancora }) {
  const ref = useRef<HTMLDivElement>(null);

  /**
   * Encaixa a prévia ao lado do avatar sem deixá-la vazar da tela.
   *
   * `useLayoutEffect` e escrita direta no `style` do nó: guardar a posição em
   * estado renderizaria a prévia duas vezes — a primeira no canto errado,
   * visível por um quadro. Escrever antes da pintura não pisca, e não é
   * `setState` dentro de efeito.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margem = 10;
    const { width: w, height: h } = el.getBoundingClientRect();
    // À direita do avatar por padrão; à esquerda quando não cabe — que é o caso
    // da última coluna do quadro, onde o avatar fica encostado na borda.
    let left = ancora.right + margem;
    if (left + w > window.innerWidth - margem) left = ancora.left - w - margem;
    if (left < margem) left = Math.max(margem, window.innerWidth - w - margem);
    // Centrada na altura do avatar, e não alinhada pelo topo dele como no
    // Cronograma: lá a âncora é um chip largo, e o topo comum lê como "presa a
    // esta linha"; aqui a âncora é um círculo de 22 px, e uma caixa de 130
    // pendurada pelo topo dele pareceria presa a nada.
    let top = (ancora.top + ancora.bottom) / 2 - h / 2;
    if (top + h > window.innerHeight - margem) top = window.innerHeight - h - margem;
    if (top < margem) top = margem;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // Origem no lado de onde ela nasceu: a prévia que abriu à esquerda cresce da
    // direita para a esquerda, e não do meio.
    el.style.transformOrigin = left < ancora.left ? "right center" : "left center";
  }, [ancora]);

  return (
    <OverlayPortal>
      <div
        ref={ref}
        className={styles.previa}
        // O lado vem de `avatar-core` e não é escolhido aqui: é a resolução em
        // que a foto foi GRAVADA. Passar disso não mostra mais nada — só amplia
        // os mesmos 128 px e devolve uma foto borrada.
        style={{ width: LADO_FOTO_PX, height: LADO_FOTO_PX }}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.previaFoto}
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
        />
      </div>
    </OverlayPortal>
  );
}
