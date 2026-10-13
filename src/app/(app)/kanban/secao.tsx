"use client";

import type { ReactNode } from "react";
import styles from "./kanban.module.css";

/**
 * Uma seção do lado direito do modal — descrição, links, checklist,
 * comentários — com título e um resumo ("2/5", "3") ao lado.
 *
 * SEMPRE ABERTA. Ela já foi recolhível (#211), nascendo fechada quando vazia,
 * e o uso mostrou o contrário do pretendido: para ver o que havia em cada uma
 * era preciso um clique a mais, e a informação do card ficava atrás de botões.
 * Decisão do setor em 13/10/2026 — não volte a recolher.
 */
export function Secao({
  titulo,
  resumo,
  children,
}: {
  titulo: string;
  /** O que vai ao lado do título — "2/5", "3". Vazio = nada. */
  resumo?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.secao}>
      <h4 className={styles.secaoTopo}>
        <span>{titulo}</span>
        {resumo && <span className={styles.secaoResumo}>{resumo}</span>}
      </h4>
      <div className={styles.secaoCorpo}>{children}</div>
    </section>
  );
}
