/**
 * Quais demandas concluídas o quadro desenha — e quais ele guarda embaixo.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * desenha é `kanban/page.tsx`; é isto que permite `scripts/test-concluidas.mjs`
 * rodar a regra inteira em Node puro, com o relógio entrando por parâmetro.
 *
 * O PROBLEMA. A coluna de conclusão é a única do quadro que só cresce. Nenhuma
 * demanda sai dela, então depois de um ano ela tem seiscentos cards, a barra de
 * rolagem da coluna vira um fio, e a informação que interessa — o que foi
 * entregue ESTE mês — está enterrada embaixo do ano passado. As outras colunas
 * se esvaziam sozinhas; esta não tem porta de saída.
 *
 * A SAÍDA É O MÊS CORRENTE, e não um botão de arquivar. As duas foram
 * consideradas. Arquivar dá controle por card, mas custa um campo novo, uma
 * regra nova, e — o que decidiu — um SEGUNDO motivo para um card estar
 * escondido, convivendo com a lixeira (`deletedAt`). Quem fosse procurar um
 * card sumido passaria a ter dois lugares para olhar, e toda tela que lê
 * `/cards` (Dashboard, Rank, relatório do gestor, catálogo do Cowork, árvore de
 * Dimensões, Ata) teria de decidir sobre os dois. Fora que arquivar depende de
 * alguém lembrar de arquivar: se ninguém lembrar, a coluna cresce igual, agora
 * com um botão que todo mundo aprendeu a ignorar.
 *
 * O corte por mês não guarda estado nenhum. `enteredAt` já é gravado a cada
 * movimento (ver `moveCard`), então a data em que o card entrou na conclusão já
 * existe no banco desde sempre.
 *
 * NADA SOME DO BANCO, E NADA SOME DAS CONTAS. Isto decide o DESENHO da coluna,
 * e mais nada: o Dashboard, o Rank, o relatório e a busca continuam vendo o
 * quadro inteiro. Esconder de todo mundo faria números mudarem de lugar sem
 * ninguém ter pedido, que é exatamente o oposto do que este corte serve.
 */

import { MES_LONGO } from "./datas.ts";

/** O mínimo que esta regra precisa enxergar de um card. */
export type ComEntrada = {
  /** ms de quando o card entrou na coluna atual. Ver `Card.enteredAt`. */
  enteredAt?: number | null;
};

/**
 * A meia-noite do primeiro dia do mês que contém este instante, no fuso local.
 *
 * Local, e não UTC, pelo mesmo motivo de `startOfDay` em `datas.ts`: o mês de
 * quem usa o app é o mês do calendário na parede dele. Em UTC, uma entrega das
 * 22h do dia 31 de agosto em Fortaleza cairia em setembro, e o card sumiria da
 * coluna no dia seguinte ao de ter sido concluído.
 */
export function inicioDoMes(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** "setembro de 2026" — o mês que a coluna está mostrando, por extenso. */
export function rotuloDoMes(ms: number): string {
  const d = new Date(ms);
  return `${MES_LONGO[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * Esta demanda foi concluída dentro do mês corrente?
 *
 * CARD SEM `enteredAt` CONTA COMO ANTIGO. O campo é gravado na criação e em
 * todo movimento, então só não o tem quem é anterior a ele existir — que é,
 * por definição, das antigas. Tratá-lo como recente faria a única coisa que o
 * corte não pode fazer: manter para sempre à vista justamente os cards mais
 * velhos do quadro. E ele não fica inalcançável: sai listado no "+N de meses
 * anteriores", que é onde ele deve estar.
 */
export function concluidaNoMes(c: ComEntrada, agora: number): boolean {
  return typeof c.enteredAt === "number" && c.enteredAt >= inicioDoMes(agora);
}

/**
 * Parte a coluna em duas: o que o mês corrente entregou, e o resto.
 *
 * A ORDEM DE CADA LADO É PRESERVADA. Quem chama já ordenou a coluna por
 * `order`, que em card movido é `-now` — ou seja, a coluna já chega com o mais
 * recente em cima. Reordenar aqui trocaria a ordem do quadro por uma segunda
 * regra de ordenação que ninguém pediu, e as duas divergiriam no primeiro card
 * que alguém reordenasse à mão.
 *
 * Não filtra lixeira: quem chama já passou por `viva`. Duas verdades sobre "o
 * que aparece no quadro" é o defeito que este projeto já documentou em
 * `lixeira-core`.
 */
export function separarConcluidas<C extends ComEntrada>(
  cards: readonly C[],
  agora: number,
): { recentes: C[]; antigas: C[] } {
  const recentes: C[] = [];
  const antigas: C[] = [];
  cards.forEach((c) => (concluidaNoMes(c, agora) ? recentes : antigas).push(c));
  return { recentes, antigas };
}
