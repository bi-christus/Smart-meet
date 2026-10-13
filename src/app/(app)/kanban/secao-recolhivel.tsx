"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import styles from "./kanban.module.css";

/**
 * Uma seção do lado direito do modal — descrição, links, checklist,
 * comentários — que se recolhe (#211).
 *
 * QUEM DECIDE SE NASCE ABERTA É O MODAL, pelo conteúdo: seção com conteúdo abre,
 * seção vazia nasce fechada, mostrando só o título. É o que tira da demanda
 * recém-criada as quatro áreas de digitação vazias que ela abria, sem esconder
 * nada de quem já escreveu alguma coisa.
 *
 * O título é um BOTÃO, e não um rótulo com uma setinha decorativa: ele tem foco,
 * responde a Enter e diz pelo `aria-expanded` se está aberto — a seção fechada
 * não pode ser um lugar aonde o teclado não chega.
 *
 * Sem animação de altura: abrir e fechar seção é gesto de alta frequência, e
 * transição de altura é o tipo de movimento que mede errado quando o conteúdo é
 * longo (AGENTS.md §3).
 */
export function SecaoRecolhivel({
  titulo,
  resumo,
  aberta,
  onAlternar,
  children,
}: {
  titulo: string;
  /** O que vai ao lado do título — "2/5", "3". Vazio = nada. */
  resumo?: string;
  aberta: boolean;
  onAlternar: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.secao}>
      <button
        type="button"
        className={styles.secaoTopo}
        onClick={onAlternar}
        aria-expanded={aberta}
      >
        <Icon name={aberta ? "chevronBaixo" : "chevronRight"} size={13} />
        <span>{titulo}</span>
        {resumo && <span className={styles.secaoResumo}>{resumo}</span>}
      </button>
      {aberta && <div className={styles.secaoCorpo}>{children}</div>}
    </section>
  );
}
