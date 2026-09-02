"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./select.module.css";

export type SelectOption = {
  value: string;
  label: string;
  color?: string;
  /**
   * O que desempata duas opções de mesmo nome — o e-mail, quase sempre.
   *
   * Só o `<Combobox>` desenha, e só quem monta a lista sabe quando preencher:
   * pendurar o e-mail em toda linha encheria a lista de ruído para resolver um
   * problema que a maioria das listas não tem. Nome repetido numa lista de
   * escolha é escolha no escuro; nome único com e-mail embaixo é ruído.
   */
  hint?: string;
};

export function Select({
  value,
  options,
  onChange,
  placeholder = "Selecionar…",
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [up, setUp] = useState(false);
  /**
   * Onde o menu é desenhado — em coordenadas de JANELA, não do pai.
   *
   * O menu era `position: absolute` dentro do `.root`, e isso o entregava a
   * qualquer ancestral com `overflow` diferente de `visible`. Dois desses são
   * comuns nesta base: `.tabelaWrap` da tabela de tarefas da Ata (declara
   * `overflow-x: auto`, e pela especificação o outro eixo deixa de ser
   * `visible` junto) e o próprio `.modal`, que tem `max-height: 88vh` com
   * `overflow: auto`. Nos dois, o menu das últimas linhas era recortado — a
   * pessoa via meia opção e nenhuma indicação de que havia mais.
   *
   * `position: fixed` escapa do recorte de todos eles. O preço é ter de medir o
   * gatilho e reposicionar quando a página rola, e é o que o efeito abaixo faz.
   */
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  /**
   * O menu acompanha o gatilho enquanto a página rola.
   *
   * `capture: true` porque quem rola quase nunca é a janela: é o `.modal`, o
   * `.tabelaWrap`, a coluna do quadro. Evento de rolagem não sobe na árvore —
   * só na fase de captura dá para ouvir todos eles com um listener só.
   *
   * A medição fica no CALLBACK, e não no corpo do efeito, de propósito: o corpo
   * roda no render e um `setState` ali é o que a regra do lint recusa. Quem
   * mede na abertura é `openMenu`.
   */
  useEffect(() => {
    if (!open) return;
    const aoMover = () => medir();
    window.addEventListener("scroll", aoMover, true);
    window.addEventListener("resize", aoMover);
    return () => {
      window.removeEventListener("scroll", aoMover, true);
      window.removeEventListener("resize", aoMover);
    };
  }, [open]);

  /**
   * A seta rola o menu até a opção ativa.
   *
   * `.menu` tem `max-height: 260px` e cada opção mede ~34px: cabem sete. Sem
   * isto, `ArrowDown` movia um cursor que a partir da oitava opção estava fora
   * da tela — quem navega por teclado escolhia às cegas.
   *
   * `block: "nearest"` para a lista não pular quando a opção já está visível.
   */
  useEffect(() => {
    if (!open || active < 0) return;
    document
      .getElementById(`${baseId}-opt-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active, baseId]);

  /**
   * O cursor de teclado se posiciona AQUI, na abertura — e nunca mais.
   *
   * Ele morava num efeito com `[open, value, options]`, e `options` é um array
   * NOVO a cada render de quem chama: as telas montam a lista no corpo da
   * função ou passam literais inline. Numa página assinada em tempo real,
   * qualquer snapshot do Firestore redesenhava o pai, `options` mudava de
   * identidade, e o cursor de quem estava navegando por setas voltava para a
   * opção já selecionada.
   *
   * `value` tinha o mesmo problema um passo adiante: escolher com o teclado
   * muda `value`, o que reposicionaria o cursor durante a própria navegação.
   *
   * Aqui não há dependência para envelhecer — é o mesmo partido do `abrir()` do
   * `<Combobox>`, que nunca teve o defeito.
   */
  /**
   * Mede o gatilho e decide onde o menu cabe.
   *
   * Roda na abertura e a cada rolagem/redimensionamento enquanto ele está
   * aberto — a folga de 14px é para o menu não encostar na borda da janela.
   */
  function medir() {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const abaixo = window.innerHeight - r.bottom;
    const acima = r.top;
    const paraCima = abaixo < 280 && acima > abaixo;
    const altura = Math.min(260, Math.max(120, (paraCima ? acima : abaixo) - 14));
    setUp(paraCima);
    setPos({
      top: paraCima ? r.top - 6 - altura : r.bottom + 6,
      left: r.left,
      width: r.width,
      maxHeight: altura,
    });
  }

  function openMenu() {
    medir();
    setActive(options.findIndex((o) => o.value === value));
    setOpen(true);
  }

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    /**
     * TAB FECHA O MENU — e esta linha existe por causa de um caminho inteiro
     * que terminava em formulário perdido.
     *
     * As opções eram `<button>` nativos, logo tabáveis, e nada tratava Tab (o
     * único listener era `mousedown`). Em "Abrir a próxima reunião": a pessoa
     * preenchia título, data, horário, local, marcava participantes, abria o
     * `Select` do facilitador, dava Tab — o menu não fechava e o foco ia para
     * dentro dele — e apertava Escape para desistir da lista. O Escape do
     * `<button>` da opção não passava por aqui, subia até o `<Modal>`, e o
     * diálogo inteiro fechava levando tudo junto.
     *
     * A outra metade do conserto é `tabIndex={-1}` nas opções: com
     * `aria-activedescendant`, elas nunca deveriam receber foco.
     */
    if (e.key === "Tab") {
      if (open) setOpen(false);
      return;
    }
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[active];
      if (o) choose(o.value);
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.open : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && active >= 0 ? `${baseId}-opt-${active}` : undefined
        }
        aria-label={ariaLabel}
      >
        <span className={styles.val}>
          {selected?.color && (
            <span
              className={styles.dot}
              style={{ background: selected.color }}
            />
          )}
          <span className={selected ? "" : styles.ph}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <svg
          className={styles.chev}
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && pos && (
        <div
          className={`${styles.menu} ${up ? styles.up : ""}`}
          role="listbox"
          id={listId}
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              id={`${baseId}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`${styles.option} ${o.value === value ? styles.sel : ""} ${i === active ? styles.active : ""}`}
              onClick={() => choose(o.value)}
              onMouseEnter={() => setActive(i)}
              // Fora da ordem de tabulação: o padrão aqui é
              // `aria-activedescendant`, e o foco fica no gatilho. Sem isto o
              // Tab entrava na lista e o Escape de dentro dela fechava o modal
              // anfitrião — ver `onKey`.
              tabIndex={-1}
            >
              {o.color && (
                <span className={styles.dot} style={{ background: o.color }} />
              )}
              <span className={styles.optLabel}>{o.label}</span>
              {o.value === value && (
                <svg
                  className={styles.check}
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
