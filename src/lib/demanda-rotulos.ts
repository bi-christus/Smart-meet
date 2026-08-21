/**
 * Como se ESCREVE prioridade e tipo de demanda.
 *
 * Moradia em módulo puro pelo motivo de sempre neste projeto (AGENTS.md §4): o
 * SERVIDOR também precisa disto. As rotas que leem `/cards` pelo Admin SDK não
 * conseguem importar `kanban.ts`, que carrega `firebase/firestore` do cliente
 * junto — mesma razão que já tirou daqui `lixeira-core`, `kanban-columns` e
 * `tags-ref`.
 *
 * Quem trouxe a necessidade foi o aviso no Discord: ele é montado no servidor e
 * precisa dizer "Alta" e "Nova implementação", não "alta" e "implementacao". A
 * alternativa era copiar os dois mapas para dentro da rota, e mapa copiado é
 * mapa que envelhece separado — o dia em que alguém acrescentar um tipo de
 * demanda, a tela mostra o nome novo e o Discord mostra o identificador cru.
 *
 * `kanban.ts` REEXPORTA tudo isto, então nenhuma tela precisou mudar de import:
 * quem monta o card continua lendo um módulo só.
 *
 * NOTA SOBRE A LISTA DE TIPOS. `src/lib/server/demandas-schema.ts` mantém a
 * própria `TIPOS_DEMANDA`, usada para validar o que a IA propõe. São duas
 * listas com os mesmos cinco valores, e isso é dívida conhecida — unificá-las
 * mexe no caminho de ingestão, que tem fronteira própria
 * (`check-demandas-boundary.mjs`) e não cabe no PR do aviso.
 */

export type Priority = "alta" | "media" | "baixa";

export const PRIORITY_LABEL: Record<Priority, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

/** Tipo da demanda. */
/**
 * As prioridades que o app sabe desenhar, na ordem em que ele as oferece.
 *
 * Mora ao lado de `PRIORITY_LABEL` porque é a mesma verdade vista de outro
 * ângulo: uma diz como se escreve cada prioridade, a outra diz quais existem.
 * Estava em `kanban/comum.ts`, e de lá o card extraído não conseguia lê-la sem
 * inverter a direção da dependência — componente de `src/components` importando
 * a pasta de uma página.
 */
export const KNOWN_PRIORITIES: Priority[] = ["alta", "media", "baixa"];

export type DemandType =
  | "implementacao"
  | "correcao"
  | "melhoria"
  | "relatorio"
  | "manutencao";

export const DEMAND_TYPES: DemandType[] = [
  "implementacao",
  "correcao",
  "melhoria",
  "relatorio",
  "manutencao",
];

export const DEMAND_TYPE_LABEL: Record<DemandType, string> = {
  implementacao: "Nova implementação",
  correcao: "Correção",
  melhoria: "Melhoria",
  relatorio: "Relatório",
  manutencao: "Manutenção",
};

export const DEMAND_TYPE_COLOR: Record<DemandType, string> = {
  implementacao: "#54b8ff", // info
  correcao: "#fb7185", // danger
  melhoria: "#c084fc", // roxo
  relatorio: "#f5b13d", // âmbar
  manutencao: "#2dd4bf", // verde-água — é o tipo que a recorrência abre
};

/**
 * O rótulo de um valor que veio do banco, com o valor cru como plano B.
 *
 * Existe porque o servidor lê campos GRAVADOS, e o banco tem cards anteriores a
 * cada mudança nesta lista. Um `PRIORITY_LABEL[p]` direto devolveria `undefined`
 * para um valor antigo, e o aviso sairia com "Prioridade: undefined" — que é
 * pior do que sair com o valor cru, porque parece defeito do sistema em vez de
 * dado velho.
 */
export function rotuloPrioridade(p: string | null | undefined): string {
  const v = (p ?? "").trim();
  return PRIORITY_LABEL[v as Priority] ?? v;
}

export function rotuloTipo(t: string | null | undefined): string {
  const v = (t ?? "").trim();
  return DEMAND_TYPE_LABEL[v as DemandType] ?? v;
}
