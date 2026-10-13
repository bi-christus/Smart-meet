/**
 * Métricas de entrega do Dashboard (#216) — lead time, pontualidade e o recorte
 * por produto do Portfólio.
 *
 * Módulo puro (AGENTS.md §4): sem `firebase/firestore`, sem React. A tela passa
 * os cards do quadro, a regra de "está entregue" (`concluido`, a mesma que o
 * resto do Dashboard usa) e a janela `[ini, fim)` de `limitesDaJanela` — e é
 * isso que faz estes números baterem com os do painel de fluxo ao lado: o
 * recorte de tempo é UM só na tela inteira.
 *
 * O INSTANTE DA ENTREGA É `enteredAt` do card entregue, a mesma leitura de
 * `calcularFluxo` e das temporadas do Rank: card concluído raramente volta a
 * mover, então "quando entrou na coluna em que está" é "quando foi entregue".
 *
 * O NASCIMENTO É `criadoEm` de `fluxo-core`, e não uma cópia: duas regras de
 * "quando a demanda nasceu" dariam dois lead times para o mesmo card.
 */
import { FUSO_DO_SETOR } from "./datas.ts";
import { criadoEm, percentil, type CardFluxo } from "./fluxo-core.ts";

/** O recorte de card que estas contas leem. */
export type CardMedido = CardFluxo & {
  due?: string | null;
  produtoId?: string | null;
};

/** O que sai de um conjunto de entregas — o mesmo formato no quadro e no produto. */
export type Medidas = {
  /** Demandas entregues dentro da janela. */
  entregas: number;
  /** Lead time em dias, da criação à entrega. `null` sem nenhuma entrega datável. */
  leadMediano: number | null;
  leadP85: number | null;
  /** Quantas das entregas tinham prazo, e quantas destas chegaram até ele. */
  comPrazo: number;
  noPrazo: number;
};

/**
 * "yyyy-mm-dd" do instante, no fuso de quem trabalha.
 *
 * A comparação com o prazo é de DIA, não de instante — a mesma escolha de
 * `pontualidadeDoMes` no Rank: o mesmo trabalho não pode ser "no prazo" às 9h
 * e "atrasado" às 15h do dia combinado.
 */
export function diaNoFuso(ms: number, fuso: string = FUSO_DO_SETOR): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

const PRAZO_VALIDO = /^\d{4}-\d{2}-\d{2}$/;

/** As entregas que caem na janela `[ini, fim)`. Card sem `enteredAt` fica de fora. */
export function entreguesNaJanela<C extends CardMedido>(
  cards: readonly C[],
  concluido: (c: C) => boolean,
  ini: number,
  fim: number,
): C[] {
  return cards.filter(
    (c) =>
      concluido(c) &&
      typeof c.enteredAt === "number" &&
      c.enteredAt >= ini &&
      c.enteredAt < fim,
  );
}

/**
 * Lead time e pontualidade de um conjunto de entregas JÁ recortado.
 *
 * SEM PRAZO NÃO ENTRA NA PONTUALIDADE, nem a favor nem contra — mesma regra do
 * Rank. Cobrar data de uma demanda sem data seria inventar um combinado.
 *
 * Lead time negativo (relógio de quem criou adiantado, card importado) vira
 * zero em vez de puxar a mediana para baixo.
 */
export function medir(
  entregues: readonly CardMedido[],
  fuso: string = FUSO_DO_SETOR,
): Medidas {
  const dias: number[] = [];
  let comPrazo = 0;
  let noPrazo = 0;
  entregues.forEach((c) => {
    if (typeof c.enteredAt !== "number") return;
    const nasceu = criadoEm(c);
    if (nasceu !== null) {
      dias.push(Math.max(0, Math.round((c.enteredAt - nasceu) / 86400000)));
    }
    const prazo = (c.due ?? "").trim();
    if (!PRAZO_VALIDO.test(prazo)) return;
    comPrazo++;
    if (diaNoFuso(c.enteredAt, fuso) <= prazo) noPrazo++;
  });
  const ordenado = dias.sort((a, b) => a - b);
  return {
    entregas: entregues.length,
    leadMediano: ordenado.length ? percentil(ordenado, 0.5) : null,
    leadP85: ordenado.length ? percentil(ordenado, 0.85) : null,
    comPrazo,
    noPrazo,
  };
}

/** "83%", ou `null` quando nenhuma entrega tinha prazo — a tela mostra travessão. */
export function pctNoPrazo(m: Pick<Medidas, "comPrazo" | "noPrazo">): number | null {
  return m.comPrazo ? Math.round((m.noPrazo / m.comPrazo) * 100) : null;
}

/** Uma linha do painel por produto. */
export type LinhaDeProduto = Medidas & {
  produtoId: string;
  /** Demandas ainda abertas no produto — o que falta, ao lado do que saiu. */
  abertas: number;
};

/**
 * As métricas do quadro quebradas por produto do Portfólio.
 *
 * Demanda sem produto NÃO vira uma linha "Sem produto": a maior parte do
 * trabalho do setor é avulsa, e uma linha dessas dominaria o painel inteiro
 * falando de coisa nenhuma. O total do quadro já está nos KPIs de cima.
 *
 * Produto sem nenhuma entrega na janela e sem nada aberto também não aparece —
 * a maioria do Portfólio é anterior ao Smart Meeting (#208), e uma linha de
 * zeros por link antigo enterraria os que estão em andamento.
 *
 * Ordem: mais entregas primeiro, depois mais abertas, depois o id (estável).
 * O nome é da tela, que tem a lista de produtos em mãos.
 */
export function medidasPorProduto<C extends CardMedido>(
  cards: readonly C[],
  concluido: (c: C) => boolean,
  ini: number,
  fim: number,
  fuso: string = FUSO_DO_SETOR,
): LinhaDeProduto[] {
  const entregues = new Map<string, C[]>();
  const abertas = new Map<string, number>();
  entreguesNaJanela(cards, concluido, ini, fim).forEach((c) => {
    if (!c.produtoId) return;
    const lista = entregues.get(c.produtoId) ?? [];
    lista.push(c);
    entregues.set(c.produtoId, lista);
  });
  cards.forEach((c) => {
    if (!c.produtoId || concluido(c)) return;
    abertas.set(c.produtoId, (abertas.get(c.produtoId) ?? 0) + 1);
  });
  const ids = new Set([...entregues.keys(), ...abertas.keys()]);
  return [...ids]
    .map((produtoId) => ({
      produtoId,
      abertas: abertas.get(produtoId) ?? 0,
      ...medir(entregues.get(produtoId) ?? [], fuso),
    }))
    .sort(
      (a, b) =>
        b.entregas - a.entregas ||
        b.abertas - a.abertas ||
        a.produtoId.localeCompare(b.produtoId),
    );
}
