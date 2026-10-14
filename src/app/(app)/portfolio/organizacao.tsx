"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import {
  LIMITE_CLASSIFICACAO,
  mesmaClassificacao,
  type GrupoDeCategoria,
} from "@/lib/links-do-setor";
import styles from "./links.module.css";

/**
 * O que está escolhido na trilha: tudo, uma categoria (ou "Sem categoria",
 * `categoria: null`), ou uma pasta dentro de uma categoria.
 */
export type Recorte =
  | { tipo: "tudo" }
  | { tipo: "categoria"; categoria: string | null }
  | { tipo: "pasta"; categoria: string; pasta: string };

export const RECORTE_TUDO: Recorte = { tipo: "tudo" };

/** O grupo de categoria (e a pasta) que o recorte deixa na tela. */
export function aplicarRecorte(
  grupos: readonly GrupoDeCategoria[],
  r: Recorte,
): GrupoDeCategoria[] {
  if (r.tipo === "tudo") return [...grupos];
  const cat = grupos.filter((g) =>
    r.categoria === null ? g.categoria === null : g.categoria !== null && mesmaClassificacao(g.categoria, r.categoria),
  );
  if (r.tipo === "categoria") return cat;
  return cat
    .map((g) => {
      const pastas = g.pastas.filter((p) => p.pasta !== null && mesmaClassificacao(p.pasta, r.pasta));
      return { ...g, pastas, total: pastas.reduce((n, p) => n + p.links.length, 0) };
    })
    .filter((g) => g.total > 0);
}

function mesmoRecorte(a: Recorte, b: Recorte): boolean {
  if (a.tipo !== b.tipo) return false;
  if (a.tipo === "tudo") return true;
  if (a.tipo === "categoria" && b.tipo === "categoria") {
    return a.categoria === null || b.categoria === null
      ? a.categoria === b.categoria
      : mesmaClassificacao(a.categoria, b.categoria);
  }
  if (a.tipo === "pasta" && b.tipo === "pasta") {
    return mesmaClassificacao(a.categoria, b.categoria) && mesmaClassificacao(a.pasta, b.pasta);
  }
  return false;
}

/**
 * A trilha de categorias e pastas, à esquerda da grade (14/10/2026).
 *
 * É o índice do portfólio: categorias com as pastas dentro, cada uma com a
 * contagem, e um clique recorta a grade. Para o ADMIN cada nome ganha um lápis
 * que renomeia ali mesmo — renomear para o nome de outra junta as duas, e
 * apagar o nome desfaz a categoria (os produtos voltam para "Sem categoria").
 *
 * As contagens são do portfólio inteiro, não da busca: a trilha é o mapa, e
 * o mapa não encolhe a cada tecla digitada.
 */
export function TrilhaDoPortfolio({
  grupos,
  total,
  recorte,
  onRecorte,
  podeOrganizar,
  onRenomear,
}: {
  grupos: readonly GrupoDeCategoria[];
  total: number;
  recorte: Recorte;
  onRecorte: (r: Recorte) => void;
  podeOrganizar: boolean;
  /** Renomeia a categoria (`pasta` ausente) ou a pasta. Lança com a frase de tela. */
  onRenomear: (alvo: { categoria: string; pasta?: string }, novo: string) => Promise<void>;
}) {
  const temCategoria = grupos.some((g) => g.categoria !== null);

  return (
    <nav className={styles.trilha} aria-label="Categorias e pastas do portfólio">
      <Item
        rotulo="Todos os produtos"
        icone="links"
        conta={total}
        ativo={recorte.tipo === "tudo"}
        onClick={() => onRecorte(RECORTE_TUDO)}
      />
      {temCategoria &&
        grupos.map((g) =>
          g.categoria === null ? (
            <Item
              key="__sem__"
              rotulo="Sem categoria"
              icone="tag"
              conta={g.total}
              apagado
              ativo={mesmoRecorte(recorte, { tipo: "categoria", categoria: null })}
              onClick={() => onRecorte({ tipo: "categoria", categoria: null })}
            />
          ) : (
            <div key={g.categoria} className={styles.trilhaGrupo}>
              <Item
                rotulo={g.categoria}
                icone="tag"
                conta={g.total}
                forte
                ativo={mesmoRecorte(recorte, { tipo: "categoria", categoria: g.categoria })}
                onClick={() => onRecorte({ tipo: "categoria", categoria: g.categoria })}
                renomear={
                  podeOrganizar
                    ? (novo) => onRenomear({ categoria: g.categoria as string }, novo)
                    : undefined
                }
              />
              {g.pastas.map((p) =>
                p.pasta === null ? null : (
                  <Item
                    key={p.pasta}
                    rotulo={p.pasta}
                    icone="pasta"
                    conta={p.links.length}
                    recuado
                    ativo={mesmoRecorte(recorte, {
                      tipo: "pasta",
                      categoria: g.categoria as string,
                      pasta: p.pasta,
                    })}
                    onClick={() =>
                      onRecorte({ tipo: "pasta", categoria: g.categoria as string, pasta: p.pasta as string })
                    }
                    renomear={
                      podeOrganizar
                        ? (novo) =>
                            onRenomear({ categoria: g.categoria as string, pasta: p.pasta as string }, novo)
                        : undefined
                    }
                  />
                ),
              )}
            </div>
          ),
        )}
      {!temCategoria && podeOrganizar && (
        <p className={styles.trilhaDica}>
          Organize os produtos em categorias e pastas pelo lápis de cada
          produto — os campos Categoria e Pasta ficam no formulário.
        </p>
      )}
    </nav>
  );
}

function Item({
  rotulo,
  icone,
  conta,
  ativo,
  onClick,
  recuado,
  forte,
  apagado,
  renomear,
}: {
  rotulo: string;
  icone: string;
  conta: number;
  ativo: boolean;
  onClick: () => void;
  recuado?: boolean;
  forte?: boolean;
  apagado?: boolean;
  renomear?: (novo: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(rotulo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    if (!renomear) return;
    if (valor.trim() === rotulo) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await renomear(valor);
      setEditando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível renomear.");
    } finally {
      setSalvando(false);
    }
  }

  if (editando) {
    return (
      <div className={`${styles.trilhaItem} ${recuado ? styles.trilhaRecuo : ""}`}>
        <input
          className={styles.trilhaInput}
          value={valor}
          autoFocus
          maxLength={LIMITE_CLASSIFICACAO}
          disabled={salvando}
          aria-label={`Novo nome para ${rotulo}`}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void confirmar();
            if (e.key === "Escape") {
              setValor(rotulo);
              setErro(null);
              setEditando(false);
            }
          }}
          onBlur={() => void confirmar()}
        />
        {erro && <small className={styles.trilhaErro}>{erro}</small>}
      </div>
    );
  }

  return (
    <div className={`${styles.trilhaLinha} ${recuado ? styles.trilhaRecuo : ""}`}>
      <button
        type="button"
        className={`${styles.trilhaItem} ${ativo ? styles.trilhaOn : ""} ${forte ? styles.trilhaForte : ""} ${apagado ? styles.trilhaApagado : ""}`}
        onClick={onClick}
        aria-current={ativo || undefined}
      >
        <Icon name={icone} size={14} />
        <span className={styles.trilhaNome} title={rotulo}>
          {rotulo}
        </span>
        <span className={styles.trilhaConta}>{conta}</span>
      </button>
      {renomear && (
        <button
          type="button"
          className={styles.trilhaLapis}
          onClick={() => {
            setValor(rotulo);
            setEditando(true);
          }}
          aria-label={`Renomear ${rotulo}`}
          title="Renomear (dar o nome de outra junta as duas; apagar o nome desfaz)"
        >
          <Icon name="edit" size={12} />
        </button>
      )}
    </div>
  );
}
