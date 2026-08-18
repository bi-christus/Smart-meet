"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { OverlayPortal } from "./overlay-portal";
import { Icon } from "./icons";
import {
  COLUNAS_DA_GRADE,
  GRUPOS_DE_ICONE,
  ICONES_DE_LINK,
  iconePorNome,
  proximoIndiceNaGrade,
} from "@/lib/icones-core";
import styles from "./icone-picker.module.css";

/**
 * O seletor de ícone de um link — o selo vira botão, e o botão abre a grade.
 *
 * ELE RENDERIZA O PRÓPRIO GATILHO, e não recebe um. Dois consumidores usam este
 * componente (a aba Links e a linha de link do modal da demanda) e os dois já
 * tinham um selo desenhado com classe e cor próprias; receber o gatilho pronto
 * significaria cada um repetir por fora o `onKeyDown`, o `aria-expanded`, o
 * `aria-activedescendant` e o fechamento por Escape — que é exatamente a parte
 * que erra calada. Aqui eles passam a aparência (`className`, `style`,
 * `children`) e o comportamento é um só.
 *
 * TRÊS COISAS QUE PARECEM DETALHE E DECIDEM SE FUNCIONA:
 *
 * 1. **O FOCO NÃO ENTRA NO POPOVER.** Ele fica no gatilho o tempo todo, e a
 *    célula ativa é anunciada por `aria-activedescendant`, como `<Select>` já
 *    faz. Não é preferência de estilo: o popover mora num portal, ou seja FORA
 *    da árvore do `<Modal>` — e o laço de foco de `modal.tsx` só conhece o que
 *    está dentro dele. Com o foco numa célula, o Tab não bateria na guarda e
 *    escaparia do diálogo, deixando a demanda aberta atrás de um foco perdido
 *    na página.
 *
 * 2. **ESCAPE PRECISA DE `stopPropagation`.** Portal do React propaga o evento
 *    SINTÉTICO pela árvore do React, não pela do DOM: sem parar aqui, o Escape
 *    que fecha esta grade sobe até o `onKeyDown` do `<Modal>` e **descarta o
 *    rascunho inteiro da demanda**. É a mesma linha que `select.tsx` escreve
 *    pelo mesmo motivo, e ela vale no gatilho E no popover.
 *
 * 3. **A POSIÇÃO É MEDIDA, não decidida por limiar.** `<Select>` escolhe abrir
 *    para cima comparando o espaço com um número fixo, e pode fazer isso porque
 *    o menu dele está EM FLUXO. Este popover é `position: fixed` num portal:
 *    ele precisa da própria altura para saber se cabe, e a medida só existe
 *    depois de montado. O caminho certo é o de `PreviaDaFoto` (`avatar.tsx`) —
 *    `useLayoutEffect` medindo o próprio nó e escrevendo em `el.style` antes da
 *    pintura, o que não pisca e não é `setState` dentro de efeito.
 */

/** Retângulo do gatilho na janela — é dele que a grade se pendura. */
type Ancora = { left: number; right: number; top: number; bottom: number };

export function IconePicker({
  valor,
  deduzido,
  rotulo,
  onEscolher,
  disabled,
  className,
  style,
  children,
}: {
  /** O nome escolhido, ou `null` para "automático". */
  valor: string | null;
  /**
   * O que a dedução daria — só para a linha "Automático" mostrar o desenho que
   * ela devolve. `null` quando o serviço é genérico e o selo é o monograma.
   */
  deduzido: string | null;
  /** O que este seletor governa, para o rótulo do botão. Ex.: o título do link. */
  rotulo: string;
  /** `null` = voltar ao automático. */
  onEscolher: (nome: string | null) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** O conteúdo do selo: o `<Icon>` de hoje, ou o monograma. */
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  /** Índice na grade. `-1` é a linha larga do "Automático", não "nenhum". */
  const [ativo, setAtivo] = useState(-1);
  const [ancora, setAncora] = useState<Ancora | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const base = useId();
  const idLista = `${base}-grade`;
  const idCelula = (i: number) => `${base}-op-${i}`;

  function abrir() {
    const el = botao.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAncora({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    // Abrir já apontando para o que está escolhido: quem volta ao seletor para
    // trocar não precisa procurar de novo onde estava.
    setAtivo(valor ? ICONES_DE_LINK.findIndex((i) => i.nome === valor) : -1);
    setAberto(true);
  }

  function fechar() {
    setAberto(false);
    setAncora(null);
  }

  function escolher(nome: string | null) {
    onEscolher(nome);
    fechar();
    // O foco volta a existir onde estava: ele nunca saiu do gatilho, mas o
    // clique do mouse numa célula tira o `:focus-visible`, e sem isto o Tab
    // seguinte recomeçaria do topo da página.
    botao.current?.focus();
  }

  /**
   * A janela inteira fecha a grade — rolagem e clique fora.
   *
   * NA CAPTURA, e na janela, pelo mesmo motivo de `<Avatar>`: `scroll` não
   * borbulha, e a coluna do Kanban e o corpo do modal rolam por dentro. Sem a
   * fase de captura, a grade ficaria pendurada no ar enquanto a lista de baixo
   * anda — ela é `fixed`, então a âncora congelaria no lugar errado.
   *
   * Assinado só enquanto aberto: são dezenas de links por tela, e um ouvinte de
   * rolagem por link disparando a cada quadro seria caro para algo que no
   * máximo um seletor de cada vez usa.
   */
  useEffect(() => {
    if (!aberto) return;
    const foraDaqui = (e: Event) => {
      const alvo = e.target as Node | null;
      if (alvo && botao.current?.contains(alvo)) return;
      // O popover está no portal: `closest` pelo atributo é o que o reconhece
      // sem uma segunda referência atravessando o componente.
      if (alvo instanceof Element && alvo.closest("[data-icone-picker]")) return;
      fechar();
    };
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    document.addEventListener("mousedown", foraDaqui, true);
    return () => {
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
      document.removeEventListener("mousedown", foraDaqui, true);
    };
  }, [aberto]);

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Ver a decisão 2 do cabeçalho. Sem isto, o Escape que fecha a grade
      // descarta o rascunho da demanda inteira.
      if (aberto) {
        e.stopPropagation();
        fechar();
      }
      return;
    }
    if (!aberto) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      escolher(ativo < 0 ? null : (ICONES_DE_LINK[ativo]?.nome ?? null));
      return;
    }
    const proximo = proximoIndiceNaGrade(
      ativo,
      e.key,
      COLUNAS_DA_GRADE,
      ICONES_DE_LINK.length,
    );
    if (proximo !== ativo) {
      e.preventDefault();
      setAtivo(proximo);
    }
  }

  const escolhido = valor ? iconePorNome(valor) : undefined;

  return (
    <>
      <button
        ref={botao}
        type="button"
        className={className}
        style={style}
        onClick={(e) => {
          // Na aba Links o card não é clicável, mas no modal da demanda a linha
          // inteira tem alvos ao redor. Parar aqui é o mesmo cuidado que
          // `<Avatar>` toma dentro do card do Kanban.
          e.stopPropagation();
          if (aberto) fechar();
          else abrir();
        }}
        onKeyDown={aoTeclar}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? idLista : undefined}
        aria-activedescendant={aberto ? idCelula(ativo) : undefined}
        aria-label={
          escolhido
            ? `Ícone de ${rotulo}: ${escolhido.rotulo}. Trocar`
            : `Ícone de ${rotulo}: automático. Trocar`
        }
      >
        {children}
      </button>

      {aberto && ancora && (
        <Grade
          ancora={ancora}
          idLista={idLista}
          idCelula={idCelula}
          ativo={ativo}
          valor={valor}
          deduzido={deduzido}
          onAtivar={setAtivo}
          onEscolher={escolher}
          onTeclar={aoTeclar}
        />
      )}
    </>
  );
}

/**
 * A grade, fora da página.
 *
 * Mora num portal porque a coluna do Kanban e o corpo do modal têm `overflow`
 * próprio: lá dentro, qualquer caixa maior que a linha seria cortada na borda —
 * e esta caixa é muito maior que o selo de 26 px que a abre.
 */
function Grade({
  ancora,
  idLista,
  idCelula,
  ativo,
  valor,
  deduzido,
  onAtivar,
  onEscolher,
  onTeclar,
}: {
  ancora: Ancora;
  idLista: string;
  idCelula: (i: number) => string;
  ativo: number;
  valor: string | null;
  deduzido: string | null;
  onAtivar: (i: number) => void;
  onEscolher: (n: string | null) => void;
  onTeclar: (e: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margem = 8;
    const { width: w, height: h } = el.getBoundingClientRect();

    // Alinhada pela ESQUERDA do gatilho, e não centrada nele: o selo tem 26 px
    // e a grade tem quase 300 — centrar poria a caixa quase toda para fora em
    // todo link da primeira coluna da tela.
    let left = ancora.left;
    if (left + w > window.innerWidth - margem) left = window.innerWidth - w - margem;
    if (left < margem) left = margem;

    // Abaixo por padrão; acima quando não cabe. A medida é a da PRÓPRIA caixa,
    // que é o que um popover `fixed` não consegue adivinhar por limiar.
    let top = ancora.bottom + 6;
    if (top + h > window.innerHeight - margem) {
      const acima = ancora.top - h - 6;
      top = acima >= margem ? acima : Math.max(margem, window.innerHeight - h - margem);
    }

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [ancora]);

  return (
    <OverlayPortal>
      <div
        ref={ref}
        className={styles.pop}
        data-icone-picker=""
        role="listbox"
        id={idLista}
        aria-label="Ícone do link"
        onKeyDown={onTeclar}
      >
        {/* "Automático" é uma OPÇÃO, não um botão de limpar, e por isso mora
            dentro da mesma lista e recebe o mesmo `aria-selected`. Fosse um
            botão à parte, voltar ao padrão deixaria de ser escolher e passaria
            a ser desfazer — e a pessoa perderia a informação de qual é o
            desenho que o automático entrega, que é justamente o que ela quer
            comparar antes de decidir. */}
        <div
          id={idCelula(-1)}
          role="option"
          aria-selected={valor === null}
          className={`${styles.auto} ${ativo === -1 ? styles.ativo : ""}`}
          onMouseEnter={() => onAtivar(-1)}
          onClick={() => onEscolher(null)}
        >
          <span className={styles.autoSelo} aria-hidden="true">
            {deduzido ? <Icon name={deduzido} size={16} /> : "Aa"}
          </span>
          <span className={styles.autoTx}>
            <strong>Automático</strong>
            <span>
              {deduzido
                ? "deduzido pelo endereço"
                : "sem serviço reconhecido — mostra as iniciais"}
            </span>
          </span>
          {valor === null && <Icon name="check" size={14} />}
        </div>

        {GRUPOS_DE_ICONE.map((grupo) => (
          <div
            key={grupo}
            role="group"
            aria-label={grupo}
            className={styles.grupo}
          >
            <div className={styles.grupoTx} aria-hidden="true">
              {grupo}
            </div>
            <div className={styles.grade}>
              {ICONES_DE_LINK.map((ic, i) =>
                ic.grupo !== grupo ? null : (
                  <div
                    key={ic.nome}
                    id={idCelula(i)}
                    role="option"
                    aria-selected={valor === ic.nome}
                    aria-label={ic.rotulo}
                    title={ic.rotulo}
                    className={`${styles.celula} ${ativo === i ? styles.ativo : ""} ${
                      valor === ic.nome ? styles.escolhida : ""
                    }`}
                    onMouseEnter={() => onAtivar(i)}
                    onClick={() => onEscolher(ic.nome)}
                  >
                    <Icon name={ic.nome} size={17} />
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </OverlayPortal>
  );
}
