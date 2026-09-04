/**
 * Quem conclui, quem pede para concluir, e o que a fila de pedidos mostra.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * escreve no banco é `kanban.ts`; quem desenha é a página do Kanban e o modal
 * do card. É isto que permite `scripts/test-conclusao.mjs` rodar a decisão
 * inteira em Node puro.
 *
 * O PEDIDO. Antes disto, qualquer pessoa do setor arrastava o card para
 * "Concluído" e a demanda estava entregue — ninguém revisava. A daily não tinha
 * como saber o que fora dado por pronto desde ontem. A mudança pedida foi: o
 * operador *solicita* a conclusão, e gestor e admin revisam.
 *
 * POR QUE O OPERADOR, E SÓ ELE. Gestor e admin já são quem exclui, restaura e
 * administra coluna neste app (`gestorNoSetor`, em `firestore.rules`). Tirar
 * deles a conclusão inventaria um quarto papel que o cadastro não tem, e
 * deixaria a revisão dependendo de uma pessoa só.
 *
 * ATÉ ONDE ISTO SE SUSTENTA — e isto precisa ser lido antes de confiar demais
 * na palavra "trava". As regras do Firestore conseguem garantir que ninguém
 * PEDE em nome de outro e que ninguém APROVA o próprio pedido. O que elas não
 * conseguem é impedir a mudança de coluna em si: saber que uma coluna é a de
 * conclusão depende de olhar a lista ORDENADA de colunas do setor
 * (`colunasEntregues`, em `kanban-columns.ts` — a última do quadro, mais as que
 * declaram conclusão no nome), e regra do Firestore não consulta coleção. Fazer
 * isso custaria denormalizar a lista num documento por setor e mantê-la em dia a
 * cada rename e cada reordenação — sincronia que apodrece calada e, quando
 * apodrece, tranca gente para fora do próprio quadro.
 *
 * Então o que se ganha é honesto, e é o que o pedido queria: o GESTO na tela
 * passa por aqui, e o REGISTRO do pedido é inforjável. Quem tiver o console do
 * Firebase aberto continua conseguindo arrastar a demanda pelo campo `columnId`
 * — e essa pessoa é gestor ou admin de algum setor, porque é o que o console
 * exige. Isto é um portão de processo, não de segurança, e chamá-lo de outra
 * coisa seria mentir para quem ler depois.
 */

/** Papéis que concluem sem pedir a ninguém. Ver o cabeçalho. */
const CONCLUEM_DIRETO = ["admin", "gestor"];

/**
 * Esta pessoa conclui sozinha?
 *
 * Papel desconhecido — cadastro incompleto, documento editado à mão, papel novo
 * de uma versão futura — cai no lado de PEDIR, e é de propósito. É o inverso do
 * padrão aberto de `permissoes-core`, e o motivo é que aqui os dois erros não se
 * equivalem: quem pede sem precisar perde um clique, e um gestor aprova em
 * seguida; quem conclui sem poder fura exatamente a revisão que esta frente
 * existe para criar — e ninguém descobre, porque a demanda só aparece entregue.
 */
export function podeConcluirDireto(papel: unknown): boolean {
  return CONCLUEM_DIRETO.includes(String(papel ?? "").trim().toLowerCase());
}

/** O pedido gravado no card. */
export type PedidoDeConclusao = {
  /** E-mail de quem pediu. As regras exigem que bata com o token. */
  por: string;
  /** Quando (ms). */
  em: number;
  /**
   * A etapa para onde a demanda vai se o pedido for aprovado.
   *
   * Guardada no pedido, e não deduzida na hora de aprovar, porque o setor pode
   * ter mais de uma etapa de conclusão e pode renomeá-las entre o pedido e a
   * revisão. Sem isto, aprovar teria de adivinhar o destino — e adivinharia a
   * última coluna do quadro, que não é necessariamente a que a pessoa apontou.
   */
  colunaAlvo: string;
};

/** O mínimo que este módulo precisa enxergar de um card. */
export type CardComPedido = {
  conclusaoPedida?: PedidoDeConclusao | null;
};

/**
 * O pedido do card, lido como se o campo pudesse estar em qualquer estado.
 *
 * E ele pode: é campo novo, então toda demanda anterior a esta frente não o tem;
 * e o documento aceita o que o console do Firebase escrever. Pedido sem `por` ou
 * sem `colunaAlvo` não é pedido — é um objeto pela metade que faria a tela
 * mostrar "pedido por" seguido de nada, e o botão de aprovar mandar a demanda
 * para uma coluna de id vazio, ou seja, para fora do quadro.
 */
export function pedidoDoCard(card: CardComPedido): PedidoDeConclusao | null {
  const p = card.conclusaoPedida;
  if (!p || typeof p !== "object") return null;
  const por = String(p.por ?? "").trim();
  const colunaAlvo = String(p.colunaAlvo ?? "").trim();
  if (!por || !colunaAlvo) return null;
  const em = typeof p.em === "number" && Number.isFinite(p.em) ? p.em : 0;
  return { por, em, colunaAlvo };
}

/** Atalho de leitura para as telas. */
export function temPedido(card: CardComPedido): boolean {
  return pedidoDoCard(card) !== null;
}

/**
 * Este gesto tem de virar pedido, em vez de acontecer?
 *
 * As três condições juntas, e nenhuma sozinha basta: quem faz não pode concluir
 * direto, o destino é etapa de conclusão, e a demanda ainda não está lá. A
 * terceira é a que evita o pop-up mais irritante possível — reordenar um card
 * DENTRO da coluna de concluídos perguntando se você quer concluir uma demanda
 * que já está concluída.
 *
 * `entregues` vem de `colunasEntregues` (`kanban-columns.ts`), que é a regra
 * única do app para "esta etapa é entrega". Receber o conjunto pronto, em vez de
 * calculá-lo aqui, é o que impede este módulo de virar uma segunda definição da
 * mesma coisa.
 */
export function precisaPedirConclusao(args: {
  papel: unknown;
  colunaAtual: string;
  colunaDestino: string;
  entregues: ReadonlySet<string>;
}): boolean {
  if (podeConcluirDireto(args.papel)) return false;
  if (!args.entregues.has(args.colunaDestino)) return false;
  return args.colunaAtual !== args.colunaDestino;
}

/**
 * A coluna de conclusão para onde o botão "Solicitar conclusão" aponta.
 *
 * A ÚLTIMA das entregues na ordem do quadro, e não a primeira: um setor que pôs
 * "Concluído" no meio e deixou "Arquivo morto" no fim tem as duas no conjunto
 * (ver `colunasEntregues`), e o fim do fluxo é o fim do fluxo. Quem arrasta
 * escolhe a coluna com o gesto; quem clica no botão não escolhe nada, e a
 * escolha tem de ser a menos surpreendente.
 *
 * `null` quando o quadro não tem etapa de conclusão nenhuma — quadro sem colunas
 * ainda carregadas, ou um setor que apagou todas. A tela usa isso para não
 * oferecer um botão que não teria para onde apontar.
 */
export function colunaDeConclusao(
  colunasEmOrdem: readonly string[],
  entregues: ReadonlySet<string>,
): string | null {
  for (let i = colunasEmOrdem.length - 1; i >= 0; i--) {
    if (entregues.has(colunasEmOrdem[i])) return colunasEmOrdem[i];
  }
  return null;
}

/**
 * Os cards da coluna com os pedidos pendentes na frente.
 *
 * É o destaque no topo que o pedido descreve, e o objetivo dele é declarado:
 * demanda pendente de conclusão é revisada na daily e não passa batido. Quem
 * abre o quadro para revisar precisa vê-las sem procurar, e elas estão
 * espalhadas pelas colunas — o pedido nasce onde a demanda está, não numa fila
 * separada.
 *
 * ESTÁVEL NO RESTO: quem não tem pedido mantém exatamente a ordem que veio, e os
 * pedidos entre si mantêm a ordem que vieram. Está escrito com dois baldes e não
 * com `sort` porque a intenção é separar, não ordenar — e um comparador
 * devolvendo 0 para "os dois têm pedido" é a forma mais fácil de alguém, mais
 * tarde, achar que pode acrescentar um critério de desempate ali dentro.
 *
 * Não altera a lista recebida: ela alimenta memo e render.
 */
export function comPedidosNoTopo<C extends CardComPedido>(
  cards: readonly C[],
): C[] {
  const comPedido: C[] = [];
  const resto: C[] = [];
  for (const c of cards) (temPedido(c) ? comPedido : resto).push(c);
  // Nada pendente: devolve a MESMA lista, sem copiar. É o caso comum de todo
  // quadro, e a cópia à toa invalida memo em cada atualização do Firestore.
  if (comPedido.length === 0) return cards as C[];
  return [...comPedido, ...resto];
}

/** Quantas demandas esperam revisão — o número que a barra do quadro mostra. */
export function contarPedidos(cards: readonly CardComPedido[]): number {
  return cards.reduce((n, c) => n + (temPedido(c) ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// As três transições
// ---------------------------------------------------------------------------

/**
 * O que se grava no card em cada uma das três transições.
 *
 * São funções, e não três objetos literais espalhados pelas telas, porque as
 * três precisam concordar sobre uma coisa que não se vê olhando para nenhuma
 * delas isolada: **o campo é apagado com `null`, nunca com `undefined`**.
 * `undefined` num campo do Firestore é erro de escrita, não campo ausente — e o
 * erro apareceria só na recusa, que é o caminho menos usado dos três.
 *
 * A hora entra por parâmetro. `Date.now()` aqui dentro tornaria o resultado
 * intestável, que é o motivo de ela ser parâmetro em todo módulo puro deste
 * repositório.
 */
export function patchDePedido(
  por: string,
  colunaAlvo: string,
  agora: number,
): { conclusaoPedida: PedidoDeConclusao } {
  return { conclusaoPedida: { por, em: agora, colunaAlvo } };
}

/**
 * Aprovar: a demanda vai para a etapa que o pedido apontou, e o pedido sai.
 *
 * As duas coisas no MESMO patch, e é o ponto inteiro desta função. Em duas
 * escritas, a falha da segunda deixaria o pior estado possível — a demanda
 * concluída com o pedido ainda pendurado, ou seja, de volta ao topo da coluna de
 * concluídos todo dia, pedindo uma revisão que já aconteceu.
 *
 * `enteredAt` entra junto porque a demanda ENTROU na coluna agora: sem ele o
 * selo de "parado há N dias" contaria desde a última etapa, e o card chegaria ao
 * Concluído já dizendo que está parado há duas semanas.
 */
export function patchDeAprovacao(
  pedido: PedidoDeConclusao,
  agora: number,
): { columnId: string; enteredAt: number; conclusaoPedida: null } {
  return {
    columnId: pedido.colunaAlvo,
    enteredAt: agora,
    conclusaoPedida: null,
  };
}

/** Recusar: o pedido sai, a demanda fica exatamente onde estava. */
export function patchDeRecusa(): { conclusaoPedida: null } {
  return { conclusaoPedida: null };
}
