/**
 * Campos por etapa — o que uma etapa do quadro pede para o card entrar nela
 * (#212). Sem o banco.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * grava a configuração na coluna e a demanda no card é a tela; o que mora aqui
 * é a decisão — "esta passagem pede alguma coisa? o quê?" —, e é ela que
 * `scripts/test-etapas.mjs` confere em Node puro.
 *
 * DE ONDE VEIO. É a ideia das fases do Pipefy: cada etapa pergunta só o que faz
 * sentido naquele momento, em vez de o formulário de abertura perguntar tudo de
 * uma vez. Ninguém sabe o prazo no instante em que a demanda chega; quem começa
 * a trabalhar nela sabe. Então o prazo é pedido na passagem para "Em andamento",
 * e não na abertura.
 *
 * QUEM CONFIGURA é gestor do setor ou admin, na própria coluna. A regra de
 * `/columns` já autoriza exatamente esses dois (`gestorNoSetor`), então a
 * configuração não precisou de regra nova.
 *
 * O LIMITE, dito na cara: a exigência vale na TELA. A regra do Firestore não
 * conhece a ordem das colunas — saber que uma etapa vem depois da outra depende
 * da lista ordenada de `/columns`, e regra não consulta coleção. É o mesmo
 * limite do pedido de conclusão (ver o cabeçalho de `conclusao-core.ts`).
 */

/** Os campos que uma etapa pode pedir. A ordem é a da configuração e a da caixa. */
export const CAMPOS_DA_ETAPA = [
  "assignee",
  "due",
  "startDate",
  "priority",
  "type",
  "produtoId",
  "requester",
  "tags",
  "checklist",
  "description",
  "links",
  "comentario",
] as const;
export type CampoDaEtapa = (typeof CAMPOS_DA_ETAPA)[number];

export const CAMPO_DA_ETAPA_ROTULO: Record<CampoDaEtapa, string> = {
  assignee: "Responsável",
  due: "Prazo de entrega",
  startDate: "Início",
  priority: "Prioridade",
  type: "Tipo",
  produtoId: "Produto",
  requester: "Solicitante",
  tags: "Tags",
  checklist: "Checklist",
  description: "Descrição",
  links: "Link",
  comentario: "Comentário",
};

/**
 * Um campo pedido pela etapa.
 *
 * `obrigatorio` trava a passagem; sem ele o campo é SUGERIDO — aparece na caixa,
 * mas pode ser pulado. A diferença existe porque nem todo setor quer travar o
 * mesmo campo: o checklist ao entrar em andamento ajuda, e travá-lo faria
 * alguém escrever "fazer" num item só para o botão liberar.
 */
export type ExigenciaDaEtapa = { campo: CampoDaEtapa; obrigatorio: boolean };

/**
 * Lê a configuração gravada na coluna como se ela pudesse estar em qualquer
 * estado — e pode: a coluna é escrita pela tela, pelo console e por versões
 * antigas do app que nem conheciam o campo.
 *
 * Campo desconhecido sai em silêncio (uma versão futura pode ter acrescentado
 * um que esta não sabe pedir), e o repetido fica só uma vez, com o PRIMEIRO
 * valor — o que a tela de configuração desenhou por último é o que vem antes.
 */
export function normalizarExigencias(bruto: unknown): ExigenciaDaEtapa[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<CampoDaEtapa>();
  const out: ExigenciaDaEtapa[] = [];
  for (const b of bruto) {
    if (!b || typeof b !== "object") continue;
    const campo = (b as { campo?: unknown }).campo;
    if (typeof campo !== "string") continue;
    if (!(CAMPOS_DA_ETAPA as readonly string[]).includes(campo)) continue;
    const c = campo as CampoDaEtapa;
    if (vistos.has(c)) continue;
    vistos.add(c);
    out.push({ campo: c, obrigatorio: (b as { obrigatorio?: unknown }).obrigatorio === true });
  }
  // Na ordem do catálogo, e não na de gravação: a caixa pergunta sempre na
  // mesma ordem, seja qual for a ordem em que o gestor marcou.
  return out.sort(
    (a, b) => CAMPOS_DA_ETAPA.indexOf(a.campo) - CAMPOS_DA_ETAPA.indexOf(b.campo),
  );
}

/** O tanto de card que a pergunta "já está preenchido?" precisa. */
export type CardDaEtapa = {
  assignee?: string | null;
  due?: string | null;
  startDate?: string | null;
  priority?: string | null;
  type?: string | null;
  produtoId?: string | null;
  requester?: string | null;
  tags?: readonly string[] | null;
  checklist?: readonly unknown[] | null;
  description?: string | null;
  links?: readonly unknown[] | null;
};

/**
 * O campo já está preenchido no card?
 *
 * O COMENTÁRIO NUNCA ESTÁ. Ele não é um campo do card, é o registro DAQUELA
 * passagem: "aguardando o quê, ou quem?" se responde de novo cada vez que a
 * demanda entra em "Aguardando" — o comentário de três semanas atrás falava de
 * outra espera.
 */
export function campoPreenchido(card: CardDaEtapa, campo: CampoDaEtapa): boolean {
  const texto = (v: string | null | undefined) => !!(v ?? "").trim();
  switch (campo) {
    case "assignee":
      return texto(card.assignee);
    case "due":
      return texto(card.due);
    case "startDate":
      return texto(card.startDate);
    case "priority":
      return texto(card.priority);
    case "type":
      return texto(card.type);
    case "produtoId":
      return texto(card.produtoId);
    case "requester":
      return texto(card.requester);
    case "tags":
      return (card.tags?.length ?? 0) > 0;
    case "checklist":
      return (card.checklist?.length ?? 0) > 0;
    case "description":
      return texto(card.description);
    case "links":
      return (card.links?.length ?? 0) > 0;
    case "comentario":
      return false;
  }
}

/**
 * O que a caixa de passagem pergunta — vazio quando não há o que perguntar.
 *
 * A CAIXA NÃO ABRE quando:
 *   - o card não muda de etapa (reordenar dentro da coluna);
 *   - o card VOLTA para uma etapa anterior. Devolver a demanda para "A fazer"
 *     não é avançar o trabalho, e cobrar o prazo de quem está devolvendo seria
 *     a caixa atrapalhando a correção de um erro;
 *   - a etapa não pede nada, ou tudo o que ela pede já está preenchido.
 *
 * Etapa de origem que não está mais na lista (a coluna foi apagada com o card
 * dentro) conta como começo do quadro: qualquer destino é avanço.
 *
 * A fusão e a troca de setor nem chegam aqui: elas não são passagem de etapa,
 * e quem as chama não pergunta.
 */
export function oQueAPassagemPede(args: {
  origem: string;
  destino: string;
  /** Os `colId` do quadro, na ordem dele. */
  ordem: readonly string[];
  exigencias: readonly ExigenciaDaEtapa[];
  card: CardDaEtapa;
}): ExigenciaDaEtapa[] {
  const { origem, destino, ordem, exigencias, card } = args;
  if (origem === destino) return [];
  const de = ordem.indexOf(origem);
  const para = ordem.indexOf(destino);
  if (de >= 0 && para >= 0 && para < de) return [];
  return exigencias.filter((e) => !campoPreenchido(card, e.campo));
}

/**
 * A sugestão para as etapas padrão do quadro (`DEFAULT_COLUMNS`).
 *
 * É SUGESTÃO, e não configuração: nada é gravado sozinho. O gestor vê o botão
 * "usar a sugestão" na coluna e decide. Etapa criada à mão não tem sugestão —
 * o app não sabe o que "Em revisão jurídica" deveria pedir.
 */
export const SUGESTAO_POR_ETAPA: Readonly<Record<string, readonly ExigenciaDaEtapa[]>> = {
  andamento: [
    { campo: "assignee", obrigatorio: true },
    { campo: "due", obrigatorio: true },
    { campo: "checklist", obrigatorio: false },
  ],
  aguardando: [{ campo: "comentario", obrigatorio: true }],
  validacao: [{ campo: "links", obrigatorio: false }],
};
