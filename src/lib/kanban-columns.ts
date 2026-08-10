/**
 * Colunas padrão do Kanban — sem Firebase, de propósito.
 *
 * O gerador de recorrências roda no servidor e precisa saber em que coluna o
 * card nasce quando o setor ainda não personalizou as suas. Importar
 * `lib/kanban` lá dentro arrastaria o SDK do cliente (e as variáveis
 * NEXT_PUBLIC_*) para dentro da função. Copiar a lista criaria duas verdades.
 *
 * `lib/kanban` reexporta daqui, então nada mais precisa saber que este arquivo
 * existe.
 */

export type KanbanColumn = { id: string; title: string; color: string };

/** Seed inicial de cada setor. A primeira é a entrada; a última, a conclusão. */
export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: "backlog", title: "A fazer", color: "#78776f" },
  { id: "andamento", title: "Em andamento", color: "#54b8ff" },
  { id: "aguardando", title: "Aguardando", color: "#f5b13d" },
  { id: "validacao", title: "Validação", color: "#c084fc" },
  { id: "concluido", title: "Concluído", color: "#34d399" },
];

/** Uma etapa cujo NOME já declara a entrega feita. */
export function colunaEhTerminal(titulo: string): boolean {
  return /conclu|entregue|finaliz|pronto|feito|encerrad/i.test(titulo);
}

/**
 * Etapas em que a demanda conta como ENTREGUE — a regra única do app.
 *
 * Duas fontes, porque nenhuma sozinha basta: a ÚLTIMA coluna do quadro (o setor
 * que renomeou "Concluído" para "Entregue ao cliente" continua entregando na
 * ponta) e qualquer coluna cujo nome declare conclusão (o setor que pôs
 * "Concluído" no meio e deixou "Arquivo morto" no fim não entrega no arquivo).
 *
 * Existe porque prazo vencido de demanda já entregue NÃO é atraso: a data
 * passou depois que o trabalho terminou. Antes disto cada tela decidia sozinha
 * o que era "concluído", e o relatório do gestor cobrava entrega já feita.
 *
 * `cols` precisa vir na ordem do quadro.
 */
export function colunasEntregues(
  cols: { id: string; title: string }[],
): Set<string> {
  const out = new Set<string>();
  cols.forEach((c) => {
    if (colunaEhTerminal(c.title)) out.add(c.id);
  });
  const ultima = cols[cols.length - 1];
  if (ultima) out.add(ultima.id);
  return out;
}
