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
