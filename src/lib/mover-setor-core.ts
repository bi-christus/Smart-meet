/**
 * A demanda que mudou de quadro: quem pode mover, para onde, e o que vai junto.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * escreve é `kanban.ts`; quem desenha é o modal do card.
 *
 * O PEDIDO. Demanda aberta no setor errado não tinha conserto: era preciso
 * excluir e redigitar tudo — título, descrição, checklist, links, prazo — e o
 * histórico ficava na lixeira do setor de origem.
 *
 * ISTO REABRE UMA PORTA QUE FOI FECHADA DE PROPÓSITO, e vale saber disso antes
 * de mexer aqui. `firestore.rules` mantinha `sector` imutável com um comentário
 * explícito: "trocar o setor por update seria a porta dos fundos para escrever
 * em quadro alheio". A regra nova fecha a mesma brecha por outro caminho —
 * exigindo os DOIS setores, o de saída e o de chegada. Quem move precisa poder
 * ver os dois lados do movimento; sem isso, mover seria escrever num quadro que
 * a pessoa não enxerga, que era exatamente o perigo original.
 *
 * QUEM PODE: qualquer usuário ativo que tenha os dois setores no cadastro. Não
 * exige ser gestor — decisão tomada com o Ítalo em 04/09/2026. Corrigir o setor
 * de uma demanda é conserto de digitação, não ato de administração, e travá-lo
 * em gestor faria a correção depender de quem não estava na conversa em que o
 * erro apareceu.
 *
 * O QUE MOVER ARRASTA JUNTO é o que este módulo existe para calcular. Não é
 * trocar um campo: a coluna é de outro quadro, a classificação de dimensão é
 * cadastro por setor, e o relógio da etapa recomeça. Errar qualquer um desses
 * some com a demanda da tela sem ela estar excluída — e é por isso que o plano é
 * calculado e MOSTRADO antes de gravar, em vez de acontecer e ser descoberto
 * depois.
 */

/** O mínimo que este módulo precisa saber de quem está movendo. */
export type PessoaQueMove = {
  role?: string | null;
  sectors?: string[] | null;
};

/** O mínimo que ele precisa saber de uma coluna. */
export type ColunaSimples = {
  /** O id de etapa dentro do setor — `colId`, nunca o id do documento. */
  colId: string;
  title: string;
};

/** O mínimo que ele precisa saber da demanda. */
export type CardQueMuda = {
  sector: string;
  columnId: string;
  assignee?: string | null;
  dimensaoId?: string | null;
  subdimensaoId?: string | null;
  setoresAnteriores?: string[] | null;
  /** Só para saber se há um a cancelar — a forma dele não interessa aqui. */
  conclusaoPedida?: unknown;
};

/** Quantos setores anteriores o card guarda. Ver `planoDaMudanca`. */
export const MAX_SETORES_ANTERIORES = 10;

function limpos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Esta pessoa pode levar uma demanda de `origem` para `destino`?
 *
 * Admin atravessa, pelo mesmo motivo de sempre neste app: ele enxerga todo
 * setor, então "ter os dois no cadastro" já é verdade para ele — e exigir que
 * estivessem escritos na lista o trancaria fora de um conserto que só ele
 * costuma ser chamado para fazer.
 *
 * Origem igual a destino é `false`, e não um caso especial na tela: mover para
 * onde já se está não é uma operação, e deixá-la passar gravaria um evento de
 * transferência que não transferiu nada.
 */
export function podeMover(
  pessoa: PessoaQueMove | null | undefined,
  origem: string,
  destino: string,
): boolean {
  if (!pessoa) return false;
  const de = String(origem ?? "").trim();
  const para = String(destino ?? "").trim();
  if (!de || !para || de === para) return false;
  if (String(pessoa.role ?? "").trim().toLowerCase() === "admin") return true;
  const meus = limpos(pessoa.sectors);
  return meus.includes(de) && meus.includes(para);
}

/**
 * Os setores que a tela oferece como destino.
 *
 * Sai da lista da PESSOA, e não de um cadastro global de setores: oferecer um
 * destino que ela não tem seria oferecer um erro — a regra do Firestore
 * recusaria a escrita, e o que chegaria na tela é "sem permissão" sobre uma
 * opção que a própria tela apresentou.
 *
 * O admin é o caso em que a lista da pessoa não basta: ele enxerga todo setor, e
 * o cadastro dele costuma listar poucos ou nenhum. Por isso `todosOsSetores`
 * existe — e é usada só para ele.
 */
export function destinosPossiveis(
  pessoa: PessoaQueMove | null | undefined,
  origem: string,
  todosOsSetores: readonly string[] = [],
): string[] {
  if (!pessoa) return [];
  const ehAdmin = String(pessoa.role ?? "").trim().toLowerCase() === "admin";
  const base = ehAdmin
    ? [...new Set([...limpos(pessoa.sectors), ...limpos(todosOsSetores)])]
    : limpos(pessoa.sectors);
  return base
    .filter((s) => podeMover(pessoa, origem, s))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Texto comparável de título de etapa: sem acento, sem caixa, sem sobra. */
function chaveDeTitulo(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export type ColunaEscolhida = {
  colId: string;
  title: string;
  /** Como ela foi encontrada — é o que a tela precisa dizer a quem move. */
  por: "mesmo-id" | "mesmo-nome" | "entrada";
};

/**
 * A etapa equivalente no quadro de destino.
 *
 * TRÊS TENTATIVAS, nesta ordem, e cada uma cobre um caso real:
 *
 *   1. MESMO `colId`. Todo setor semeado por `seedDefaultColumns` tem as mesmas
 *      cinco etapas com os mesmos ids, então este caso é a maioria: a demanda
 *      que estava em "Em andamento" chega em "Em andamento".
 *   2. MESMO NOME. Dois setores que criaram à mão uma etapa "Em revisão" têm
 *      ids diferentes para a mesma ideia — o id é gerado, o nome é escolhido.
 *      Comparado sem acento e sem caixa, porque quem digitou os dois foi gente
 *      diferente em dias diferentes.
 *   3. A ENTRADA, que é a primeira coluna do quadro (ver `kanban-columns.ts`).
 *      É o destino honesto de uma etapa que não existe do outro lado: a demanda
 *      chega para ser triada, em vez de chegar num lugar parecido que ninguém
 *      escolheu.
 *
 * `null` só quando o destino não tem coluna nenhuma. Nesse caso NÃO se inventa
 * um `columnId`: um card apontando para uma etapa que não existe some da tela
 * sem estar excluído, que é a pior forma de perder uma demanda.
 */
export function mapearColuna(
  colunaAtual: string,
  colsDestino: readonly ColunaSimples[],
  /**
   * Título da etapa de onde a demanda sai. Opcional porque nem todo chamador o
   * tem: o cronograma carrega colunas de vários setores e pode não ter a do
   * card em mãos. Sem ele, a segunda tentativa simplesmente não acontece.
   */
  tituloAtual = "",
): ColunaEscolhida | null {
  if (colsDestino.length === 0) return null;

  const porId = colsDestino.find((c) => c.colId === colunaAtual);
  if (porId) return { colId: porId.colId, title: porId.title, por: "mesmo-id" };

  const alvo = chaveDeTitulo(tituloAtual);
  const porNome = alvo
    ? colsDestino.find((c) => chaveDeTitulo(c.title) === alvo)
    : undefined;
  if (porNome)
    return { colId: porNome.colId, title: porNome.title, por: "mesmo-nome" };

  return { colId: colsDestino[0].colId, title: colsDestino[0].title, por: "entrada" };
}

export type PlanoDaMudanca = {
  destino: string;
  coluna: ColunaEscolhida;
  /** A classificação de dimensão será apagada? Só é falso se não havia. */
  limpaClassificacao: boolean;
  /** O responsável atual não participa do setor de destino. */
  responsavelForaDoDestino: boolean;
  /** Havia um pedido de conclusão em aberto, e ele será cancelado. */
  cancelaPedidoDeConclusao: boolean;
  /** O que se grava no card. Pronto para o `updateCard`. */
  patch: {
    sector: string;
    columnId: string;
    dimensaoId: null;
    subdimensaoId: null;
    enteredAt: number;
    order: number;
    setoresAnteriores: string[];
    conclusaoPedida: null;
  };
};

/**
 * O que vai acontecer, calculado antes de acontecer.
 *
 * Existe como valor — e não como uma escrita direta — para a tela poder MOSTRAR
 * o resultado antes de confirmar. Mover é a mudança mais radical que uma demanda
 * sofre neste app (troca de quadro, de etapa e de classificação de uma vez), e
 * descobrir o que aconteceu depois de acontecer é como se perde a confiança na
 * função inteira.
 *
 * Devolve `null` quando o movimento não é possível: sem permissão, ou destino
 * sem coluna nenhuma. Os dois casos a tela trata igual — a ação não é oferecida.
 *
 * AS QUATRO COISAS QUE MUDAM ALÉM DO SETOR:
 *
 * - `columnId`, porque as etapas são de outro quadro. Ver `mapearColuna`.
 * - `dimensaoId`/`subdimensaoId` viram `null`. A árvore de dimensões é cadastro
 *   POR SETOR (`dimensoes-core.ts`): um id da origem não significa nada no
 *   destino, e mantê-lo faria a demanda aparecer pendurada num galho de outro
 *   setor — ou em galho nenhum, dependendo de o id colidir. A árvore do destino
 *   sabe acolher isto: cai em "Sem classificação".
 * - `enteredAt` recomeça, porque a demanda entrou agora nesta etapa. Sem isso o
 *   selo "parado há N dias" chegaria contando desde o outro quadro.
 * - `order` recomeça no topo, como em `moveCard`: a demanda chega para ser vista.
 *
 * O QUE NÃO MUDA: solicitante, setor solicitante e responsável. Quem pediu
 * continua sendo quem pediu — mover a demanda não reescreve a história dela. O
 * responsável fica mesmo podendo não ser do destino, e a tela AVISA em vez de
 * apagar: apagar em silêncio perderia a informação de quem estava tocando
 * aquilo, e quem move é justamente quem sabe se ele continua.
 *
 * `setoresAnteriores` guarda por onde a demanda passou, e não é enfeite: é o que
 * permite o histórico continuar legível depois da mudança. Os eventos gravam o
 * setor do card no momento em que aconteceram, e a consulta do histórico é
 * escopada por setor (regra do Firestore) — sem esta lista, a timeline de uma
 * demanda transferida começaria no dia da transferência, calada.
 */
export function planoDaMudanca(args: {
  pessoa: PessoaQueMove | null | undefined;
  card: CardQueMuda;
  /** Título da etapa atual, para a segunda tentativa de mapeamento. */
  tituloDaColunaAtual?: string;
  destino: string;
  colsDestino: readonly ColunaSimples[];
  /** Setores de quem está como responsável. Ausente = não dá para saber. */
  setoresDoResponsavel?: readonly string[] | null;
  agora: number;
}): PlanoDaMudanca | null {
  const { pessoa, card, destino, colsDestino, agora } = args;
  if (!podeMover(pessoa, card.sector, destino)) return null;

  const coluna = mapearColuna(
    card.columnId,
    colsDestino,
    args.tituloDaColunaAtual ?? "",
  );
  if (!coluna) return null;

  // O da origem entra na frente e os repetidos saem: uma demanda que vai e volta
  // entre dois setores não pode encher a lista com o mesmo par para sempre — o
  // `in` da consulta do histórico tem teto de 30 valores.
  const anteriores = [
    card.sector,
    ...limpos(card.setoresAnteriores).filter((s) => s !== card.sector),
  ]
    .filter((s) => s !== destino)
    .slice(0, MAX_SETORES_ANTERIORES);

  return {
    destino,
    coluna,
    limpaClassificacao: !!card.dimensaoId || !!card.subdimensaoId,
    responsavelForaDoDestino:
      !!card.assignee &&
      Array.isArray(args.setoresDoResponsavel) &&
      !args.setoresDoResponsavel.includes(destino),
    cancelaPedidoDeConclusao: !!card.conclusaoPedida,
    patch: {
      sector: destino,
      columnId: coluna.colId,
      dimensaoId: null,
      subdimensaoId: null,
      enteredAt: agora,
      order: -agora,
      setoresAnteriores: anteriores,
      /**
       * O PEDIDO DE CONCLUSÃO EM ABERTO É CANCELADO pela mudança de setor.
       *
       * Ele não sobrevive à viagem, e carregá-lo seria pior do que perdê-lo: o
       * `colunaAlvo` dele é um `colId` do quadro de ORIGEM, e aprovar depois da
       * mudança mandaria a demanda para uma etapa que não existe no destino — ou
       * seja, para fora da tela, sem estar excluída.
       *
       * Repontá-lo também não serve: quem move quase nunca é quem pediu, e a
       * regra do Firestore exige que quem escreve o pedido seja quem assina.
       * Cancelar é a única saída que não mente. A tela avisa antes de gravar, e
       * o histórico registra a mudança de setor — de onde dá para entender o que
       * aconteceu com o pedido.
       *
       * Sempre `null`, mesmo quando não havia pedido: gravar o campo já nulo é
       * escrita idempotente, e um patch que muda de forma conforme o estado do
       * card é um patch que a regra do Firestore vê de dois jeitos.
       */
      conclusaoPedida: null,
    },
  };
}

/**
 * Os setores em que o histórico desta demanda pode estar.
 *
 * O atual primeiro, e os anteriores depois. É o que a consulta do histórico usa
 * num `in` — e o teto de 30 do Firestore é por isso que
 * `MAX_SETORES_ANTERIORES` existe.
 *
 * Card nunca transferido devolve uma lista de um só, que é exatamente a consulta
 * que já existia: o caminho comum não paga nada por esta função existir.
 */
export function setoresDoHistorico(card: {
  sector: string;
  setoresAnteriores?: string[] | null;
}): string[] {
  const atual = String(card.sector ?? "").trim();
  const antes = limpos(card.setoresAnteriores).filter((s) => s !== atual);
  return (atual ? [atual, ...antes] : antes).slice(0, 30);
}
