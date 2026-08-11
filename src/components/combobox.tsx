"use client";

/**
 * Lista suspensa que se digita — o "combobox com busca".
 *
 * Existe pelo mesmo motivo que o `Select` não bastava em Solicitante e Setor
 * solicitante: esses dois cadastros crescem sem teto, e uma lista de cem nomes
 * obriga a rolar procurando com o olho um nome que a pessoa já sabe de cor.
 * Aqui ela digita três letras e a lista encolhe até o que interessa.
 *
 * A busca é sem acento e sem maiúscula de propósito: "jose", "José" e "JOSE"
 * têm de achar a mesma pessoa, senão o campo parece vazio e alguém cadastra o
 * nome de novo, com outra grafia.
 *
 * Mantém a API do `Select` (mesmo `SelectOption`), então trocar um pelo outro é
 * só trocar o nome do componente.
 */
import { useId, useMemo, useRef, useState } from "react";
import type { SelectOption } from "./select";
import styles from "./combobox.module.css";

function chave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function Combobox({
  value,
  options,
  onChange,
  placeholder = "Selecionar…",
  ariaLabel,
  /** O que dizer quando a busca não acha nada — a saída depende da tela. */
  vazioTexto = "Nada encontrado.",
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  vazioTexto?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativa, setAtiva] = useState(0);
  const [up, setUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const selected = options.find((o) => o.value === value);

  const filtradas = useMemo(() => {
    const q = chave(busca.trim());
    if (!q) return options;
    const hits = options.filter((o) => chave(o.label).includes(q));
    // Quem começa com o que foi digitado vem antes de quem só contém: digitar
    // "ma" tem de oferecer "Marketing" antes de "Comercial". `sort` é estável,
    // então o resto mantém a ordem do cadastro.
    hits.sort(
      (a, b) =>
        Number(chave(b.label).startsWith(q)) -
        Number(chave(a.label).startsWith(q)),
    );
    return hits;
  }, [options, busca]);

  // O índice é preso à lista a cada render: apagar uma letra encurta o
  // resultado, e um índice antigo escolheria o nome errado no Enter.
  const idx = Math.min(ativa, filtradas.length - 1);

  function abrir() {
    if (open) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      setUp(below < 280 && r.top > below);
    }
    // Abre limpo, mostrando a lista inteira: quem abriu pode só querer olhar as
    // opções, e começar com o nome atual no campo obrigaria a apagá-lo antes.
    setBusca("");
    setAtiva(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function fechar() {
    setOpen(false);
    setBusca("");
  }

  function escolher(v: string) {
    onChange(v);
    fechar();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // O Escape do modal anfitrião fecha o diálogo inteiro. Aqui ele só fecha
      // a lista — sem o `stopPropagation` a demanda em edição seria perdida.
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        fechar();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        abrir();
        return;
      }
      const n = filtradas.length;
      if (n === 0) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setAtiva((cur) => (Math.min(cur, n - 1) + passo + n) % n);
      return;
    }
    if (e.key === "Enter") {
      // `preventDefault` mesmo sem opção: o Enter aqui é "escolher", nunca
      // "enviar o formulário que estiver em volta".
      e.preventDefault();
      if (open && filtradas[idx]) escolher(filtradas[idx].value);
      return;
    }
    if (e.key === "Tab" && open) fechar();
  }

  const rotulo = selected?.label ?? "";
  const comCor = !open && selected?.color;

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.campo}>
        {comCor && (
          <span
            className={styles.dotFixo}
            style={{ background: selected.color }}
          />
        )}
        <input
          className={styles.input}
          style={comCor ? { paddingLeft: 30 } : undefined}
          value={open ? busca : rotulo}
          onChange={(e) => {
            setBusca(e.target.value);
            setAtiva(0);
            if (!open) abrir();
          }}
          onFocus={abrir}
          onClick={abrir}
          onBlur={fechar}
          onKeyDown={onKey}
          // Digitar aqui FILTRA, não cadastra: quem escreve um nome que não
          // existe continua sem valor escolhido, e ao sair o campo volta a
          // mostrar o que estava. Por isso o aberto pede busca, não um nome.
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filtradas[idx] ? `${baseId}-opt-${idx}` : undefined
          }
          autoComplete="off"
        />
        <svg
          className={`${styles.chev} ${open ? styles.chevOpen : ""}`}
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {open && (
        <div
          className={`${styles.menu} ${up ? styles.up : ""}`}
          role="listbox"
          id={listId}
        >
          {filtradas.length === 0 ? (
            <div className={styles.vazio}>{vazioTexto}</div>
          ) : (
            filtradas.map((o, i) => (
              <button
                key={o.value || `__vazio-${i}`}
                type="button"
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={`${styles.option} ${o.value === value ? styles.sel : ""} ${i === idx ? styles.active : ""}`}
                // `onMouseDown` prevenido: sem isso o blur do campo fecha a
                // lista antes de o clique chegar, e escolher com o mouse
                // simplesmente não funciona.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setAtiva(i)}
                onClick={() => escolher(o.value)}
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
                    aria-hidden="true"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
