/**
 * "Este card conta como entrega, e de quem" — uma vez só, no app inteiro.
 *
 * Módulo puro (AGENTS.md §4). O único import é `kanban-columns`, que também é
 * puro: é de lá que vem `colunasEntregues`, a regra de QUAIS COLUNAS entregam,
 * e ela não muda de casa nem é copiada.
 *
 * POR QUE ELE EXISTE. Esta decisão estava escrita à mão dentro de um `useMemo`
 * em `rank/page.tsx` — três linhas que dizem "se a coluna é de entrega, conta
 * uma para o `assignee`". Os emblemas precisam exatamente da mesma decisão, com
 * um recorte a mais (por setor solicitante), e reimplementá-la produziria o pior
 * defeito possível deste tipo: o pódio e o emblema DISCORDANDO sobre a mesma
 * demanda, cada um com o próprio jeito de comparar e-mail. É por isso que este
 * PR extrai a regra e faz o Rank passar a chamá-la — dois consumidores no mesmo
 * PR, como o §4 manda.
 *
 * O QUE ELE NÃO FAZ: filtrar a lixeira. `subscribeCards*` já chama `viva` na
 * origem, e refiltrar aqui criaria uma segunda verdade sobre o mesmo assunto —
 * a que ninguém lembraria de atualizar quando a primeira mudasse.
 */
import { colunasEntregues } from "./kanban-columns.ts";

/** O recorte de um card que este módulo precisa. Nada mais. */
export type CardContavel = {
  sector: string;
  columnId: string;
  assignee?: string | null;
  requesterSector?: string | null;
};

/** Setor de execução → ids das colunas em que a demanda conta como entregue. */
export type EntreguePorSetor = Readonly<Record<string, ReadonlySet<string>>>;

/**
 * Monta o mapa a partir das colunas de cada setor.
 *
 * Existe aqui, e não só em `kanban.ts`, para que o TESTE possa montá-lo com
 * `colunasEntregues` de verdade — a regra de produção, não uma cópia da
 * expectativa. `deliveredBySector` continua onde está, em `kanban.ts`: é um
 * embrulho de seis linhas sobre esta mesma função, com teste próprio, e movê-lo
 * seria churn por um ganho que já existe.
 */
export function entreguesPorSetor(
  colsPorSetor: Record<string, { id: string; title: string }[]>,
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  Object.entries(colsPorSetor).forEach(([setor, lista]) => {
    out[setor] = colunasEntregues(lista);
  });
  return out;
}

/** Este card está numa coluna de entrega do quadro dele? */
export function ehEntrega(c: CardContavel, ent: EntreguePorSetor): boolean {
  return ent[c.sector]?.has(c.columnId) ?? false;
}

/**
 * O responsável deste card é esta pessoa?
 *
 * A COMPARAÇÃO É EXATA, e isso é escolha consciente com um custo assumido. O
 * pódio compara assim hoje — o e-mail é a chave crua de um `Map` —, então
 * normalizar a caixa aqui faria o emblema e o pódio pararem de concordar, que é
 * exatamente o que este módulo existe para impedir.
 *
 * O que se perde: dois cards gravados com `"Fulano@px"` e `"fulano@px"` contam
 * como duas pessoas nos dois lugares. Consertar isso é uma frente própria — ela
 * mexe no pódio, no filtro de responsável e no `usersMap` de sete telas —, e
 * fazê-la de carona aqui mudaria o Rank sem ninguém ter pedido.
 */
export function mesmaPessoa(
  assignee: string | null | undefined,
  email: string,
): boolean {
  return !!assignee && assignee === email;
}

/**
 * Entregas por pessoa, e o total do recorte.
 *
 * `total` INCLUI a entrega sem responsável, e `por` não. As duas são verdade e
 * respondem a perguntas diferentes: "o setor entregou 50" e "fulano entregou
 * 11". O quadro tem demanda entregue sem ninguém no campo de responsável, e
 * somar `por` para achar o total daria um número menor que o real, sem nada na
 * tela explicando a diferença.
 */
export function entregasPorPessoa(
  cards: readonly CardContavel[],
  ent: EntreguePorSetor,
): { por: Map<string, number>; total: number } {
  const por = new Map<string, number>();
  let total = 0;
  cards.forEach((c) => {
    if (!ehEntrega(c, ent)) return;
    total++;
    const quem = c.assignee;
    if (!quem) return;
    por.set(quem, (por.get(quem) ?? 0) + 1);
  });
  return { por, total };
}
