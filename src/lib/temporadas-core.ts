/**
 * Temporadas do Rank — um mês, um campeonato.
 *
 * Módulo puro (AGENTS.md §4): sem `firebase/firestore`, sem React. Só depende
 * de `datas.ts` (o fuso e os nomes de mês) e dos módulos puros que o Rank já
 * usa (`entregas-core.ts`, `rank-core.ts`) — a colocação de uma temporada é a
 * MESMA regra do pódio acumulado, só que recortada por mês.
 *
 * O RECORTE É `Card.enteredAt`, e não o histórico. O campo já existe
 * (`kanban.ts`) e já é atualizado a cada troca de coluna — é "quando este
 * card entrou na coluna em que está agora". Card entregue raramente volta a
 * mover, então na prática é "quando foi entregue". Ler `historico` por card
 * resolveria o mesmo problema com uma leitura por demanda em vez de zero.
 *
 * QUEM GRAVA O RÓTULO NÃO É ESTE ARQUIVO. `entregasDoMes` devolve contagem por
 * e-mail (chave), exatamente como `entregasPorPessoa` já faz para o
 * acumulado — quem tem o nome de exibição em mãos (a tela, com `usersMap`; o
 * cron, com uma leitura de `/users`) é quem monta os `Participante[]` e chama
 * `montarRank`. Resolver nome aqui obrigaria este módulo a saber de onde vêm
 * os nomes, e o cron e a tela vêm de lugares diferentes.
 */
import {
  ehEntrega,
  entregasPorPessoa,
  type CardContavel,
  type EntreguePorSetor,
} from "./entregas-core.ts";
import type { Colocacao } from "./rank-core.ts";
import { FUSO_DO_SETOR, MES_LONGO } from "./datas.ts";

/** O recorte de card que uma temporada precisa, além do que `entregas-core` já pede. */
export type CardComEntrada = CardContavel & { enteredAt?: number | null };

/**
 * "yyyy-mm" do instante `ms`, no fuso de quem trabalha.
 *
 * Mesmo padrão de `hojeNoFuso` (`datas.ts`): `en-CA` já formata nessa ordem, e
 * é o que faz o id do documento (`temporadas/{mes}`) ordenar como string sem
 * precisar de um campo separado.
 */
export function mesDe(ms: number, fuso: string = FUSO_DO_SETOR): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(ms));
}

/** O mês corrente, no mesmo formato — o padrão do seletor de temporada. */
export function mesAtual(
  agora: Date = new Date(),
  fuso: string = FUSO_DO_SETOR,
): string {
  return mesDe(agora.getTime(), fuso);
}

/**
 * Um mês antes de `mes`. É o que o cron usa no dia 1: fechar o mês que acabou
 * de terminar, não o que está começando.
 */
export function mesAnterior(mes: string): string {
  const [anoStr, mesStr] = mes.split("-");
  const ano = Number(anoStr);
  const m = Number(mesStr);
  const anteriorM = m === 1 ? 12 : m - 1;
  const anteriorAno = m === 1 ? ano - 1 : ano;
  return `${anteriorAno}-${String(anteriorM).padStart(2, "0")}`;
}

/** "Agosto de 2026" — o rótulo do seletor e do chip de campeã(o) no perfil. */
export function rotuloMes(mes: string): string {
  const [anoStr, mesStr] = mes.split("-");
  const nome = MES_LONGO[Number(mesStr) - 1] ?? mesStr;
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${anoStr}`;
}

/**
 * Entregas do recorte, só as que caíram dentro de `mes`.
 *
 * Card sem `enteredAt` numérico (nenhum caso real hoje, mas o campo é
 * opcional no tipo) fica de fora — melhor perder uma entrega antiga sem data
 * do que datar errado e contar num mês que não foi o dele.
 */
export function entregasDoMes(
  cards: readonly CardComEntrada[],
  ent: EntreguePorSetor,
  mes: string,
  fuso: string = FUSO_DO_SETOR,
): { por: Map<string, number>; total: number } {
  const doMes = cards.filter(
    (c) => typeof c.enteredAt === "number" && mesDe(c.enteredAt, fuso) === mes,
  );
  return entregasPorPessoa(doMes, ent);
}

/** O recorte de card que a pontualidade precisa: o de uma temporada e o prazo. */
export type CardComPrazo = CardComEntrada & { due?: string | null };

/** "yyyy-mm-dd" do instante `ms`, no fuso de quem trabalha — o par de `mesDe`. */
export function diaDe(ms: number, fuso: string = FUSO_DO_SETOR): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Das entregas de cada pessoa no mês, quantas saíram no prazo (#215).
 *
 * POR QUE ISTO ENTROU NO RANK. O pódio conta entregas, e só conta: dez tarefas
 * triviais pesam mais que um painel grande, e quem entrega tudo atrasado sobe
 * igual a quem cumpre o combinado. A pontualidade vai AO LADO da contagem, e
 * não dentro dela — mudar o critério de colocação reescreveria o que as
 * temporadas já fechadas anunciaram, e elas estão congeladas de propósito.
 *
 * NO PRAZO é ter chegado à etapa de entrega ATÉ O FIM DO DIA do prazo, no fuso
 * do setor: entregar às 18h do dia combinado é cumprir. A comparação é de DIA
 * (`diaDe`), e não de instante, pelo mesmo motivo de `inicioDoDia` em
 * `prazo-core`: o mesmo trabalho não pode ser "no prazo" às 9h e "atrasado" às
 * 15h.
 *
 * SEM PRAZO NÃO ENTRA NA CONTA — nem a favor, nem contra. O denominador é só o
 * que tinha prazo: cobrar pontualidade de uma demanda sem data seria inventar
 * um combinado que ninguém fez. Quem não teve nenhuma entrega com prazo fica
 * FORA do mapa, e a tela não mostra porcentagem nenhuma para essa pessoa.
 *
 * A chave é o `assignee` cru, a MESMA de `entregasPorPessoa` — se as duas
 * divergissem, o pódio mostraria a pontualidade de uma pessoa ao lado da
 * contagem de outra.
 */
export function pontualidadeDoMes(
  cards: readonly CardComPrazo[],
  ent: EntreguePorSetor,
  mes: string,
  fuso: string = FUSO_DO_SETOR,
): Map<string, { noPrazo: number; comPrazo: number }> {
  const out = new Map<string, { noPrazo: number; comPrazo: number }>();
  cards.forEach((c) => {
    if (typeof c.enteredAt !== "number" || mesDe(c.enteredAt, fuso) !== mes) return;
    if (!ehEntrega(c, ent) || !c.assignee) return;
    const prazo = (c.due ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return;
    const atual = out.get(c.assignee) ?? { noPrazo: 0, comPrazo: 0 };
    atual.comPrazo++;
    if (diaDe(c.enteredAt, fuso) <= prazo) atual.noPrazo++;
    out.set(c.assignee, atual);
  });
  return out;
}

/** "100%" — arredondado para o inteiro; a casa decimal num pódio é ruído. */
export function rotuloPontualidade(p: { noPrazo: number; comPrazo: number }): string {
  return `${Math.round((p.noPrazo / p.comPrazo) * 100)}%`;
}

/**
 * Quem venceu — todo mundo empatado na primeira posição, e não um só.
 *
 * `montarRank` já resolve empate de colocação (dois primeiros lugares, não um
 * primeiro e um segundo por ordem alfabética); campeonato compartilhado é a
 * mesma decisão aplicada ao topo, não uma regra nova.
 */
export function vencedoresDoRanking(ranking: readonly Colocacao[]): string[] {
  return ranking.filter((r) => r.posicao === 1).map((r) => r.chave);
}
