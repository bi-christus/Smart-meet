"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Icon } from "@/components/icons";
import { IconePicker } from "@/components/icone-picker";
import { OverlayPortal } from "@/components/overlay-portal";
import {
  LIMITE_NOME_PASTA,
  filhasDe,
  type PastaDoPortfolio,
} from "@/lib/portfolio-pastas";
import styles from "./links.module.css";

/**
 * O explorador do Portfólio (#229) — as peças visuais.
 *
 * O pedido foi "como o Windows": criar a pasta, dar um ícone, arrastar os
 * produtos para dentro. Então o vocabulário é o do Explorador de Arquivos, que
 * todo mundo do setor já sabe usar sem que ninguém explique:
 *
 * - "Nova pasta" aparece JÁ com o nome selecionado, pronto para digitar por
 *   cima. Enter confirma, Esc desiste, clicar fora confirma.
 * - Botão direito abre o menu (na pasta: Abrir, Renomear, Trocar ícone,
 *   Excluir; no vazio: Nova pasta). F2 renomeia, Delete exclui.
 * - Arrastar um produto ou uma pasta e soltar numa pasta, no caminho do topo
 *   ou na árvore da esquerda move para lá.
 *
 * O ARRASTE É O NATIVO DO NAVEGADOR (HTML5), e não uma biblioteca: é o mesmo
 * que o Kanban e o Cronograma já usam, funciona com a árvore e o caminho sem
 * coordenada nenhuma, e não pesa um byte. Quem está sendo arrastado mora no
 * ESTADO da página (`Arrastando`), e não só no `dataTransfer`: durante o
 * `dragover` o navegador esconde o conteúdo do `dataTransfer` (só revela no
 * `drop`), e sem saber O QUE vem não há como recusar a pasta que tenta entrar
 * em si mesma antes de ela ser solta.
 *
 * SEM MOVIMENTO NO ARRASTE (AGENTS.md §3): arrastar é interação de alta
 * frequência. O destino acende na hora, sem transição.
 */

/** O que está sendo arrastado agora. */
export type Arrastando = { tipo: "produto" | "pasta"; id: string };

/**
 * Transforma um elemento em DESTINO de soltar.
 *
 * O contador de entradas existe porque `dragenter`/`dragleave` disparam a cada
 * filho do alvo que o cursor cruza: com um booleano, passar do ícone para o
 * nome da pasta apagaria o destaque no meio da pasta. O contador é guardado
 * JUNTO de quem está sendo arrastado — assim um arraste que terminou fora
 * (sem `dragleave` final) não deixa o próximo nascer aceso, e sem efeito
 * nenhum para zerar.
 */
export function useDestino(
  arrastando: Arrastando | null,
  aceita: (a: Arrastando) => boolean,
  onSoltar: (a: Arrastando) => void,
) {
  const [sobre, setSobre] = useState<{ de: Arrastando | null; n: number }>({ de: null, n: 0 });
  const valido = arrastando !== null && aceita(arrastando);
  const ativo = valido && sobre.de === arrastando && sobre.n > 0;
  const props = valido
    ? {
        onDragEnter: (e: DragEvent) => {
          e.preventDefault();
          setSobre((s) => ({ de: arrastando, n: s.de === arrastando ? s.n + 1 : 1 }));
        },
        onDragOver: (e: DragEvent) => {
          // Sem `preventDefault` aqui o navegador recusa o `drop`.
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        },
        onDragLeave: () => setSobre((s) => ({ ...s, n: Math.max(0, s.n - 1) })),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setSobre({ de: null, n: 0 });
          onSoltar(arrastando);
        },
      }
    : {};
  return { ativo, props };
}

/** O começo do arraste: o tipo vai no estado, e um texto vai no `dataTransfer`. */
export function iniciarArraste(e: DragEvent, item: Arrastando, onInicio: (a: Arrastando) => void) {
  e.stopPropagation();
  e.dataTransfer.effectAllowed = "move";
  // O Firefox não começa arraste nenhum sem algum dado no `dataTransfer`.
  e.dataTransfer.setData("text/plain", item.id);
  onInicio(item);
}

// ---------------------------------------------------------------------------
// A pasta desenhada
// ---------------------------------------------------------------------------

/**
 * A pasta grande, com o ícone escolhido no meio — o equivalente da pasta do
 * Windows com a miniatura dentro. Sem ícone escolhido, ela fica lisa.
 */
function DesenhoDePasta({ icone }: { icone?: string }) {
  return (
    <span className={styles.pastaArte} aria-hidden="true">
      <svg viewBox="0 0 64 48" className={styles.pastaFundo}>
        <path d="M4 10a4 4 0 0 1 4-4h14l5 5h29a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
        <path className={styles.pastaFrente} d="M4 17a4 4 0 0 1 4-4h48a4 4 0 0 1 4 4v23a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
      </svg>
      {icone && (
        <span className={styles.pastaIcone}>
          <Icon name={icone} size={20} />
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// O nome sendo digitado — Nova pasta e Renomear são o mesmo campo
// ---------------------------------------------------------------------------

/**
 * O campo do nome, com o texto todo SELECIONADO ao abrir, como no Windows:
 * digitar já substitui o "Nova pasta".
 *
 * Clicar fora CONFIRMA (é o que o Windows faz), e por isso `onBlur` também
 * grava. O `feito` impede a segunda gravação: Enter grava, o campo some, e o
 * navegador ainda pode disparar o `blur` dele no caminho.
 */
function CampoDeNome({
  inicial,
  rotulo,
  onConfirmar,
  onDesistir,
}: {
  inicial: string;
  rotulo: string;
  /** Lança com a frase de tela; o campo fica aberto mostrando o motivo. */
  onConfirmar: (nome: string) => Promise<void>;
  onDesistir: () => void;
}) {
  const [valor, setValor] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const feito = useRef(false);

  const selecionar = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  async function confirmar() {
    if (feito.current || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await onConfirmar(valor);
      feito.current = true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o nome.");
      setSalvando(false);
    }
  }

  return (
    <span className={styles.campoNome}>
      <input
        ref={selecionar}
        className={styles.campoNomeInput}
        value={valor}
        maxLength={LIMITE_NOME_PASTA}
        disabled={salvando}
        aria-label={rotulo}
        aria-invalid={erro ? true : undefined}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          // O Enter e o Esc são DESTE campo: sem parar aqui, o Enter subiria
          // até a pasta e a abriria, e o Esc fecharia o que estiver em volta.
          e.stopPropagation();
          if (e.key === "Enter") void confirmar();
          if (e.key === "Escape") {
            feito.current = true;
            onDesistir();
          }
        }}
        onBlur={() => void confirmar()}
        onClick={(e) => e.stopPropagation()}
      />
      {erro && (
        <small className={styles.campoNomeErro} role="alert">
          {erro}
        </small>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// O menu do botão direito
// ---------------------------------------------------------------------------

export type ItemDeMenu = {
  rotulo: string;
  icone: string;
  atalho?: string;
  perigo?: boolean;
  onEscolher: () => void;
};

/**
 * O menu de contexto, preso ao ponto do clique.
 *
 * Num portal, pelo mesmo motivo do `IconePicker`: dentro da página ele nasceria
 * por baixo do cabeçalho. A posição é corrigida para caber na janela antes da
 * pintura (ref de função, sem `setState`): menu aberto perto da borda direita
 * abre para a esquerda, como em qualquer sistema.
 *
 * O foco ENTRA no menu (diferente do `IconePicker`, que mora dentro de um
 * modal): aqui não há laço de foco a respeitar, e é o que deixa as setas e o
 * Enter funcionarem para quem abriu pelo teclado (tecla Menu ou Shift+F10).
 */
export function MenuDeContexto({
  x,
  y,
  itens,
  onFechar,
}: {
  x: number;
  y: number;
  itens: ItemDeMenu[];
  onFechar: () => void;
}) {
  const caixa = useRef<HTMLDivElement | null>(null);

  const posicionar = useCallback(
    (el: HTMLDivElement | null) => {
      caixa.current = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margem = 8;
      const left = Math.min(x, window.innerWidth - r.width - margem);
      const top = y + r.height > window.innerHeight - margem ? Math.max(margem, y - r.height) : y;
      el.style.left = `${Math.max(margem, left)}px`;
      el.style.top = `${top}px`;
      el.querySelector<HTMLButtonElement>("button")?.focus();
    },
    [x, y],
  );

  useEffect(() => {
    const fora = (e: Event) => {
      if (e.target instanceof Node && caixa.current?.contains(e.target)) return;
      onFechar();
    };
    document.addEventListener("mousedown", fora, true);
    window.addEventListener("scroll", onFechar, true);
    window.addEventListener("resize", onFechar);
    window.addEventListener("blur", onFechar);
    return () => {
      document.removeEventListener("mousedown", fora, true);
      window.removeEventListener("scroll", onFechar, true);
      window.removeEventListener("resize", onFechar);
      window.removeEventListener("blur", onFechar);
    };
  }, [onFechar]);

  function teclas(e: KeyboardEvent) {
    const botoes = [...(caixa.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      onFechar();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      botoes[(i + 1) % botoes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      botoes[(i - 1 + botoes.length) % botoes.length]?.focus();
    }
  }

  return (
    <OverlayPortal>
      <div
        ref={posicionar}
        className={styles.menu}
        role="menu"
        style={{ left: x, top: y }}
        onKeyDown={teclas}
        onContextMenu={(e) => e.preventDefault()}
      >
        {itens.map((it) => (
          <button
            key={it.rotulo}
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${it.perigo ? styles.menuPerigo : ""}`}
            onClick={() => {
              onFechar();
              it.onEscolher();
            }}
          >
            <Icon name={it.icone} size={14} />
            <span>{it.rotulo}</span>
            {it.atalho && <kbd className={styles.menuAtalho}>{it.atalho}</kbd>}
          </button>
        ))}
      </div>
    </OverlayPortal>
  );
}

/**
 * Onde o menu abre. O botão direito do mouse traz o ponto; a tecla Menu e o
 * Shift+F10 disparam o mesmo `contextmenu` com coordenada zero — aí o menu
 * abre colado no elemento focado.
 */
export function pontoDoMenu(e: MouseEvent): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { x: r.left + 12, y: r.bottom - 6 };
}

// ---------------------------------------------------------------------------
// A pasta na grade
// ---------------------------------------------------------------------------

export function BlocoDePasta({
  pasta,
  conta,
  local,
  podeOrganizar,
  renomeando,
  arrastando,
  aceita,
  onSoltar,
  onArrastar,
  onFimDoArraste,
  onAbrir,
  onMenu,
  onRenomear,
  onConfirmarNome,
  onDesistirDoNome,
  onExcluir,
  onIcone,
}: {
  pasta: PastaDoPortfolio;
  conta: number;
  /** Onde a pasta mora — só na busca, que mistura pastas de toda a árvore. */
  local?: string;
  podeOrganizar: boolean;
  renomeando: boolean;
  arrastando: Arrastando | null;
  aceita: (a: Arrastando) => boolean;
  onSoltar: (a: Arrastando) => void;
  onArrastar: (a: Arrastando) => void;
  onFimDoArraste: () => void;
  onAbrir: () => void;
  onMenu: (ponto: { x: number; y: number }) => void;
  onRenomear: () => void;
  onConfirmarNome: (nome: string) => Promise<void>;
  onDesistirDoNome: () => void;
  onExcluir: () => void;
  onIcone: (icone: string | null) => void;
}) {
  const destino = useDestino(arrastando, aceita, onSoltar);
  const sendoArrastada = arrastando?.tipo === "pasta" && arrastando.id === pasta.id;
  const contaTexto = `${conta} ${conta === 1 ? "produto" : "produtos"}`;

  return (
    <div
      className={`${styles.pasta} ${destino.ativo ? styles.alvoAceso : ""} ${sendoArrastada ? styles.arrastado : ""}`}
      data-pasta-id={pasta.id}
      draggable={podeOrganizar && !renomeando}
      onDragStart={(e) => iniciarArraste(e, { tipo: "pasta", id: pasta.id }, onArrastar)}
      onDragEnd={onFimDoArraste}
      onContextMenu={
        podeOrganizar
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onMenu(pontoDoMenu(e));
            }
          : undefined
      }
      {...destino.props}
    >
      {renomeando ? (
        <div className={styles.pastaCorpo}>
          <DesenhoDePasta icone={pasta.icone} />
          <CampoDeNome
            inicial={pasta.nome}
            rotulo={`Novo nome para a pasta ${pasta.nome}`}
            onConfirmar={onConfirmarNome}
            onDesistir={onDesistirDoNome}
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.pastaCorpo}
          onClick={onAbrir}
          onKeyDown={(e) => {
            if (!podeOrganizar) return;
            if (e.key === "F2") {
              e.preventDefault();
              onRenomear();
            } else if (e.key === "Delete") {
              e.preventDefault();
              onExcluir();
            }
          }}
          title={podeOrganizar ? "Abrir · botão direito para mais opções" : "Abrir"}
          aria-label={`Abrir a pasta ${pasta.nome}, ${contaTexto}`}
        >
          <DesenhoDePasta icone={pasta.icone} />
          <span className={styles.pastaNome}>{pasta.nome}</span>
          <span className={styles.pastaConta}>{local ? `${local} · ${contaTexto}` : contaTexto}</span>
        </button>
      )}

      {podeOrganizar && !renomeando && (
        <>
          {/* O ÍCONE troca pelo canto da pasta, e não pelo meio dela: o
              clique no meio é ABRIR, o gesto que se faz mil vezes — trocar o
              ícone é o que se faz uma vez. O menu também leva até aqui
              ("Trocar ícone"), clicando neste botão pelo atributo. */}
          <IconePicker
            valor={pasta.icone ?? null}
            deduzido="pasta"
            rotulo={`a pasta ${pasta.nome}`}
            onEscolher={onIcone}
            className={styles.pastaTrocaIcone}
          >
            <Icon name={pasta.icone ?? "pasta"} size={13} />
          </IconePicker>
          <button
            type="button"
            className={styles.pastaMais}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onMenu({ x: r.left, y: r.bottom + 4 });
            }}
            aria-label={`Mais ações da pasta ${pasta.nome}`}
            title="Mais ações"
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </>
      )}
    </div>
  );
}

/** "Trocar ícone" do menu: abre o seletor que mora no canto da pasta. */
export function abrirSeletorDeIcone(pastaId: string) {
  document
    .querySelector<HTMLElement>(`[data-pasta-id="${CSS.escape(pastaId)}"] .${styles.pastaTrocaIcone}`)
    ?.click();
}

/** A pasta que está nascendo — o campo "Nova pasta" já selecionado. */
export function PastaNova({
  nome,
  onConfirmar,
  onDesistir,
}: {
  nome: string;
  onConfirmar: (nome: string) => Promise<void>;
  onDesistir: () => void;
}) {
  return (
    <div className={`${styles.pasta} ${styles.pastaNascendo}`}>
      <div className={styles.pastaCorpo}>
        <DesenhoDePasta />
        <CampoDeNome
          inicial={nome}
          rotulo="Nome da nova pasta"
          onConfirmar={onConfirmar}
          onDesistir={onDesistir}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O caminho no topo
// ---------------------------------------------------------------------------

/**
 * "Portfólio B.I. › Financeiro › Painéis" — cada pedaço abre aquela pasta e
 * aceita o que for solto nele, que é o jeito de tirar algo de uma pasta: soltar
 * no nível de cima.
 */
export function CaminhoDePastas({
  raiz,
  caminho,
  arrastando,
  aceita,
  onSoltar,
  onAbrir,
}: {
  raiz: string;
  caminho: PastaDoPortfolio[];
  arrastando: Arrastando | null;
  aceita: (destino: string | null, a: Arrastando) => boolean;
  onSoltar: (destino: string | null, a: Arrastando) => void;
  onAbrir: (id: string | null) => void;
}) {
  const pedacos: { id: string | null; nome: string; icone?: string }[] = [
    { id: null, nome: raiz },
    ...caminho.map((p) => ({ id: p.id, nome: p.nome, icone: p.icone })),
  ];
  return (
    <nav className={styles.caminho} aria-label="Pasta aberta">
      <ol>
        {pedacos.map((p, i) => (
          <PedacoDoCaminho
            key={p.id ?? "__raiz__"}
            nome={p.nome}
            icone={p.id === null ? "links" : (p.icone ?? "pasta")}
            atual={i === pedacos.length - 1}
            primeiro={i === 0}
            arrastando={arrastando}
            aceita={(a) => aceita(p.id, a)}
            onSoltar={(a) => onSoltar(p.id, a)}
            onAbrir={() => onAbrir(p.id)}
          />
        ))}
      </ol>
    </nav>
  );
}

function PedacoDoCaminho({
  nome,
  icone,
  atual,
  primeiro,
  arrastando,
  aceita,
  onSoltar,
  onAbrir,
}: {
  nome: string;
  icone: string;
  atual: boolean;
  primeiro: boolean;
  arrastando: Arrastando | null;
  aceita: (a: Arrastando) => boolean;
  onSoltar: (a: Arrastando) => void;
  onAbrir: () => void;
}) {
  const destino = useDestino(arrastando, aceita, onSoltar);
  return (
    <li className={styles.caminhoItem}>
      {!primeiro && <Icon name="chevronRight" size={13} />}
      <button
        type="button"
        className={`${styles.caminhoBotao} ${atual ? styles.caminhoAtual : ""} ${destino.ativo ? styles.alvoAceso : ""}`}
        onClick={onAbrir}
        aria-current={atual ? "location" : undefined}
        {...destino.props}
      >
        <Icon name={icone} size={14} />
        <span>{nome}</span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// A árvore à esquerda
// ---------------------------------------------------------------------------

/**
 * A árvore de pastas, como o painel de navegação do Windows: cada pasta com o
 * ícone dela, a contagem, e a seta que abre as filhas. É mapa e também
 * destino — soltar aqui move para a pasta, sem precisar abri-la antes.
 *
 * As pastas no caminho da que está aberta ficam sempre expandidas: abrir uma
 * subpasta pela grade e ver a árvore fechada lá em cima seria perder o "você
 * está aqui".
 */
export function ArvoreDePastas({
  raiz,
  total,
  arvore,
  contagem,
  atual,
  caminhoAtual,
  podeOrganizar,
  arrastando,
  aceita,
  onSoltar,
  onArrastar,
  onFimDoArraste,
  onAbrir,
  onMenu,
}: {
  raiz: string;
  total: number;
  arvore: readonly PastaDoPortfolio[];
  contagem: Map<string, number>;
  atual: string | null;
  caminhoAtual: readonly PastaDoPortfolio[];
  podeOrganizar: boolean;
  arrastando: Arrastando | null;
  aceita: (destino: string | null, a: Arrastando) => boolean;
  onSoltar: (destino: string | null, a: Arrastando) => void;
  onArrastar: (a: Arrastando) => void;
  onFimDoArraste: () => void;
  onAbrir: (id: string | null) => void;
  onMenu: (pasta: PastaDoPortfolio, ponto: { x: number; y: number }) => void;
}) {
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(() => new Set());
  const noCaminho = new Set(caminhoAtual.map((p) => p.id));
  const expandida = (id: string) => abertas.has(id) || noCaminho.has(id);
  const alternar = (id: string) =>
    setAbertas((s) => {
      const n = new Set(s);
      if (expandida(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function ramos(paiId: string | null, nivel: number): ReactNode {
    return filhasDe(arvore, paiId).map((p) => {
      const temFilhas = arvore.some((f) => f.paiId === p.id);
      const aberta = temFilhas && expandida(p.id);
      return (
        <li key={p.id} role="treeitem" aria-expanded={temFilhas ? aberta : undefined} aria-selected={atual === p.id}>
          <ItemDaArvore
            nome={p.nome}
            icone={p.icone ?? "pasta"}
            conta={contagem.get(p.id) ?? 0}
            nivel={nivel}
            ativo={atual === p.id}
            seta={temFilhas ? (aberta ? "aberta" : "fechada") : null}
            onSeta={() => alternar(p.id)}
            arrastavel={podeOrganizar}
            onArrastar={(e) => iniciarArraste(e, { tipo: "pasta", id: p.id }, onArrastar)}
            onFimDoArraste={onFimDoArraste}
            arrastando={arrastando}
            aceita={(a) => aceita(p.id, a)}
            onSoltar={(a) => onSoltar(p.id, a)}
            onAbrir={() => onAbrir(p.id)}
            onMenu={podeOrganizar ? (ponto) => onMenu(p, ponto) : undefined}
          />
          {aberta && <ul role="group">{ramos(p.id, nivel + 1)}</ul>}
        </li>
      );
    });
  }

  return (
    <nav className={styles.arvore} aria-label="Pastas do portfólio">
      <ul role="tree">
        <li role="treeitem" aria-selected={atual === null} aria-expanded>
          <ItemDaArvore
            nome={raiz}
            icone="links"
            conta={total}
            nivel={0}
            ativo={atual === null}
            forte
            seta={null}
            arrastavel={false}
            arrastando={arrastando}
            aceita={(a) => aceita(null, a)}
            onSoltar={(a) => onSoltar(null, a)}
            onAbrir={() => onAbrir(null)}
          />
          <ul role="group">{ramos(null, 1)}</ul>
        </li>
      </ul>
    </nav>
  );
}

function ItemDaArvore({
  nome,
  icone,
  conta,
  nivel,
  ativo,
  forte,
  seta,
  onSeta,
  arrastavel,
  onArrastar,
  onFimDoArraste,
  arrastando,
  aceita,
  onSoltar,
  onAbrir,
  onMenu,
}: {
  nome: string;
  icone: string;
  conta: number;
  nivel: number;
  ativo: boolean;
  forte?: boolean;
  seta: "aberta" | "fechada" | null;
  onSeta?: () => void;
  arrastavel: boolean;
  onArrastar?: (e: DragEvent) => void;
  onFimDoArraste?: () => void;
  arrastando: Arrastando | null;
  aceita: (a: Arrastando) => boolean;
  onSoltar: (a: Arrastando) => void;
  onAbrir: () => void;
  onMenu?: (ponto: { x: number; y: number }) => void;
}) {
  const destino = useDestino(arrastando, aceita, onSoltar);
  return (
    <div
      className={`${styles.arvoreLinha} ${ativo ? styles.arvoreOn : ""} ${destino.ativo ? styles.alvoAceso : ""}`}
      style={{ paddingLeft: 4 + nivel * 14 }}
      draggable={arrastavel}
      onDragStart={onArrastar}
      onDragEnd={onFimDoArraste}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              onMenu(pontoDoMenu(e));
            }
          : undefined
      }
      {...destino.props}
    >
      {seta ? (
        <button
          type="button"
          className={styles.arvoreSeta}
          onClick={onSeta}
          aria-label={seta === "aberta" ? `Recolher ${nome}` : `Expandir ${nome}`}
          tabIndex={-1}
        >
          <Icon name={seta === "aberta" ? "chevronBaixo" : "chevronRight"} size={12} />
        </button>
      ) : (
        <span className={styles.arvoreSetaVazia} />
      )}
      <button
        type="button"
        className={`${styles.arvoreItem} ${forte ? styles.arvoreForte : ""}`}
        onClick={onAbrir}
        aria-current={ativo ? "location" : undefined}
      >
        <Icon name={icone} size={14} />
        <span className={styles.arvoreNome} title={nome}>
          {nome}
        </span>
        <span className={styles.arvoreConta}>{conta}</span>
      </button>
    </div>
  );
}
