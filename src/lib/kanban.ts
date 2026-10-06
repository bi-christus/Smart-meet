import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  arrayUnion,
  runTransaction,
  type QuerySnapshot,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./firebase";

// A trilha de mudanças da demanda. Mora em módulo próprio, mas as escritas
// passam por aqui de propósito — ver `updateCard`.
import { anexarEvento, type ContextoHistorico } from "./historico";
import type { Acao, Mudanca } from "./historico-core";
export type { ContextoHistorico };

// O aviso no Discord entra AQUI, e não nas telas, pelo mesmo motivo que fez
// `registro` virar parâmetro obrigatório de `updateCard`: são seis lugares que
// escrevem card (dois modais, três páginas e duas rotas), e um aviso pendurado
// em cada um apodrece calado no primeiro caminho novo que alguém abrir. Aqui é
// impossível gravar sem avisar, porque é a mesma função.
import { avisarDiscord } from "./discord";

// A regra da lixeira é pura e o SERVIDOR também precisa dela — as rotas que
// leem `/cards` pelo Admin SDK não conseguem importar este arquivo, que carrega
// o SDK do cliente junto. Ver o cabeçalho de `lixeira-core`.
import { naLixeira, ordenarLixeira, viva } from "./lixeira-core";
export { naLixeira, viva };

// Moradia em módulo puro: o gerador de recorrências lê as colunas no servidor,
// onde importar este arquivo (e o SDK do cliente junto) não é possível.
import {
  DEFAULT_COLUMNS,
  colunaEhTerminal,
  colunasEntregues,
  type KanbanColumn,
} from "./kanban-columns";
export { DEFAULT_COLUMNS, colunaEhTerminal, colunasEntregues };
export type { KanbanColumn };

// Mesmo motivo: a regra de tag-referência é pura e tem teste próprio.
import { resolverTags, type TagRef } from "./tags-ref";
export { resolverTags };
export type { TagRef };

// A cor da tag MUDOU DE CASA para `tags-core`, e este arquivo passa a
// reexportá-la — como já faz com as colunas, a lixeira e os rótulos de demanda.
// Mudou quando a árvore da aba Dimensões (removida em 06/10/2026) precisou dela
// num módulo puro, que não pode importar este aqui (ele traz o SDK do cliente na
// primeira linha). Ficou lá porque é onde mora o resto da régua de tag. Nenhuma
// tela precisa trocar de import.
import { TAG_COLORS, tagColor } from "./tags-core.ts";
export { TAG_COLORS, tagColor };

// Idem para os links: normalizar URL, reconhecer serviço e escolher cor não
// dependem do banco. Reexportado daqui porque quem monta o card lê um módulo só.
import type { CardLink } from "./links-core";
export type { CardLink };

// Mesmo motivo, e mesma reexportação das colunas e da lixeira: quem decide se o
// gesto vira pedido, para onde a aprovação manda a demanda e o que cada
// transição grava é módulo puro com teste. Aqui só passam as três escritas.
import {
  patchDeAprovacao,
  patchDePedido,
  patchDeRecusa,
  pedidoDoCard,
  type PedidoDeConclusao,
} from "./conclusao-core.ts";
export type { PedidoDeConclusao };

// Prioridade e tipo saíram daqui pelo mesmo motivo das colunas e da lixeira: o
// SERVIDOR precisa deles. A rota do aviso no Discord monta a mensagem lendo
// `/cards` pelo Admin SDK, e não pode importar este arquivo — ele traz o SDK do
// cliente junto. Reexportado para que nenhuma tela precise trocar de import.
import {
  DEMAND_TYPES,
  DEMAND_TYPE_COLOR,
  DEMAND_TYPE_LABEL,
  KNOWN_PRIORITIES,
  PRIORITY_LABEL,
  type DemandType,
  type Priority,
} from "./demanda-rotulos";
export {
  DEMAND_TYPES,
  DEMAND_TYPE_COLOR,
  DEMAND_TYPE_LABEL,
  KNOWN_PRIORITIES,
  PRIORITY_LABEL,
};
export type { DemandType, Priority };

export type ChecklistItem = {
  id?: string;
  text: string;
  done: boolean;
  desc?: string;
};
export type Comment = {
  id?: string;
  author: string;
  text: string;
  at: number;
  /** Quando o texto foi reescrito. Ausente = comentário como foi publicado. */
  editedAt?: number;
};


export type Card = {
  id: string;
  sector: string;
  columnId: string;
  title: string;
  description?: string;
  type?: DemandType;
  assignee?: string | null; // responsável (e-mail do usuário do sistema)
  requester?: string | null; // solicitante (nome cadastrado)
  requesterSector?: string | null; // setor solicitante (cadastrado)
  /**
   * Onde esta demanda mora na árvore do setor — ver `dimensoes-core.ts`.
   *
   * Guarda o ID, e não o nome, pelo motivo que `tags-ref.ts` documenta: nome é
   * cópia, e cópia não sobrevive ao rename do cadastro. Quem traduz para texto é
   * quem tem o cadastro em mãos.
   *
   * Os DOIS campos existem porque os dois casos existem. A ata prevê a demanda
   * que mora numa subdimensão e a que fica direto na dimensão ("uma caixa que
   * abriga vários trabalhos"), e o formulário não obriga a descer o segundo
   * nível. `subdimensaoId` sem `dimensaoId` não é estado válido, e a árvore
   * trata como não classificada.
   *
   * Ausente em toda demanda anterior a esta frente — que é a maioria delas. A
   * árvore junta essas no nó "Sem classificação"; ela nunca esconde demanda por
   * falta de campo.
   */
  dimensaoId?: string | null;
  subdimensaoId?: string | null;
  startDate?: string | null; // data de início (yyyy-mm-dd)
  due?: string | null; // prazo de entrega (yyyy-mm-dd)
  priority?: Priority;
  tags?: string[];
  /** Quais das `tags` são referência, e para quem. Ausente = todas são texto. */
  tagRefs?: TagRef[];
  checklist?: ChecklistItem[];
  /**
   * Endereços que a demanda usa. Campo do card, e não coleção nova: a regra de
   * update de `/cards` já cobre quem pode escrever, e coleção separada custaria
   * regra própria e uma segunda assinatura por setor para mostrar uma lista que
   * nunca passa de meia dúzia de itens por card.
   *
   * A aba Links NÃO lê mais este campo (06/10/2026). Ela tem cadastro próprio,
   * `/links`, com nome e descrição — ver `links-do-setor-core.ts`. O que mora
   * aqui é o que UMA demanda usa, e aparece só no modal dela.
   */
  links?: CardLink[];
  comments?: Comment[];
  order: number;
  /** Quando o card entrou na coluna atual (ms) — base do aging e da entrega. */
  enteredAt?: number;
  /**
   * Timestamp do Firestore, gravado na criação. Só as métricas leem: é a data
   * de ENTRADA da demanda no sistema, e sem ela não há como medir fluxo.
   */
  createdAt?: { seconds: number } | null;
  createdBy?: string;
  /** De onde o card veio, para quem abrir daqui a meses. */
  origem?: "reuniao" | "recorrencia";
  /** Recorrência que abriu este card, e a data prevista do ciclo. */
  recId?: string;
  recDate?: string;
  /**
   * As reuniões gravadas que originaram esta demanda.
   *
   * Já era escrito por `api/demandas/decidir` e lido por `api/ata/gerar`; entra
   * no tipo agora porque a ata passou a gravá-lo também, e um campo que duas
   * telas escrevem sem estar no tipo é um campo que a terceira esquece.
   */
  meetingIds?: string[];
  /**
   * A ata em que se decidiu abrir esta demanda.
   *
   * Proveniência, e nunca vínculo de ida: quem responde "esta demanda está na
   * ata?" continua sendo o `cardId` do item, lá na ata. Este campo responde a
   * outra pergunta, a de quem abre o card meses depois — "de onde isto saiu?" —
   * e é a única coisa no quadro que aponta de volta para a reunião que decidiu.
   */
  ataId?: string;
  /**
   * Contador de versão, incrementado a cada edição pelo modal. Serve para
   * detectar que o card mudou entre o momento em que uma mudança automática
   * foi calculada e o momento em que seria aplicada.
   */
  rev?: number;
  /**
   * Quantos eventos o card tem em `historico`.
   *
   * Denormalizado porque o quadro precisa dele: o selo no canto do card mostra
   * quantas vezes a demanda mudou, e contar de verdade custaria uma leitura da
   * subcoleção por card em cada atualização do quadro inteiro. Ausente nos
   * cards anteriores ao histórico — que é a resposta certa: eles não têm
   * evento nenhum.
   */
  histCount?: number;
  /**
   * Quando a demanda foi para a lixeira (ms). Ausente ou `null` = viva.
   *
   * Marca, e não exclusão de verdade: o documento fica inteiro — mesma coluna,
   * mesma `order`, mesmo `enteredAt`, com o histórico pendurado embaixo. É o
   * que permite restaurar sem a demanda voltar mentindo que é nova. Quem
   * responde "isto está na lixeira?" é `naLixeira`, nunca uma comparação solta.
   */
  deletedAt?: number | null;
  /** E-mail de quem mandou para a lixeira. `null` depois de restaurada. */
  deletedBy?: string | null;
  /**
   * O pedido de conclusão em aberto. Ausente ou `null` = nenhum.
   *
   * O operador não conclui direto: ele pede, e gestor ou admin revisam. A regra
   * inteira — quem pede, quando o gesto vira pedido, e o que cada uma das três
   * transições grava — mora em `conclusao-core.ts`, que é puro e testado. Aqui
   * só passa o campo.
   *
   * Campo do card, e não coleção nova, pelo mesmo motivo dos `links` logo acima:
   * é no máximo um por demanda, o quadro já assina `/cards` por setor, e uma
   * coleção separada custaria regra própria e uma segunda assinatura por setor
   * para mostrar um selo. Além disso, ele PRECISA estar no card: o destaque no
   * topo da coluna é uma reordenação da lista que o quadro já tem em mãos, e
   * com o pedido fora do card ela dependeria de duas fontes chegarem juntas.
   */
  conclusaoPedida?: PedidoDeConclusao | null;
  /**
   * Por quais setores esta demanda já passou. Ausente = nasceu e ficou onde
   * está, que é a maioria absoluta.
   *
   * NÃO É NOSTALGIA: é o que mantém o histórico legível depois de uma
   * transferência. Cada evento grava o setor do card no momento em que
   * aconteceu, e a consulta do histórico é escopada por setor porque a REGRA do
   * Firestore é (ver `historico.ts` e `firestore.rules`). Sem esta lista, a
   * timeline de uma demanda transferida começaria no dia da transferência — os
   * eventos anteriores continuariam gravados e simplesmente escapariam da
   * consulta, sem erro nenhum na tela.
   *
   * Reescrever o setor dos eventos antigos seria a alternativa óbvia, e ela é
   * impossível de propósito: `allow update: if false` na subcoleção. Evento
   * gravado não se reescreve.
   */
  setoresAnteriores?: string[];
};

export type CardInput = {
  title: string;
  description: string;
  columnId: string;
  type: DemandType;
  assignee: string | null;
  requester: string | null;
  requesterSector: string | null;
  dimensaoId: string | null;
  subdimensaoId: string | null;
  startDate: string | null;
  due: string | null;
  priority: Priority;
  tags: string[];
  tagRefs: TagRef[];
  checklist: ChecklistItem[];
  links: CardLink[];
};

/** Vira o snapshot em cards, sem julgar nada. As três assinaturas partem daqui. */
function cardsDo(snap: QuerySnapshot): Card[] {
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Card, "id">),
  }));
}

/**
 * Assina os cards de um setor em tempo real — só os VIVOS.
 *
 * O FILTRO MORA AQUI, na origem, e não em cada tela. Seis telas leem card hoje;
 * se cada uma filtrasse por conta própria, a sétima que alguém escrever no mês
 * que vem nasceria mostrando demanda excluída — e ninguém perceberia, porque a
 * tela funcionaria perfeitamente. Esconder o que foi para a lixeira é
 * propriedade da FONTE, não boa vontade de quem consome. Quem quer o outro lado
 * pede por ele, em `subscribeLixeira`.
 *
 * E o filtro é EM MEMÓRIA, não na consulta. `where("deletedAt", "==", null)`
 * parece a versão certa e é a armadilha: no Firestore, documento que não TEM o
 * campo não é devolvido por consulta sobre aquele campo. Todo card já gravado
 * está nessa situação — nenhum deles conhece `deletedAt` —, então a consulta
 * "correta" devolveria zero demandas, e todos os quadros do app amanheceriam
 * vazios até alguém rodar um backfill. Fora isso, ainda pediria índice composto
 * com `sector`. Filtrar depois custa o que o snapshot já trouxe, e o snapshot
 * do setor é justamente o que o quadro precisa inteiro de qualquer jeito.
 */
export function subscribeCards(
  sector: string,
  onData: (cards: Card[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "cards"), where("sector", "==", sector)),
    (snap) => {
      const cards = cardsDo(snap).filter(viva);
      cards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      onData(cards);
    },
    (e) => onError?.(e),
  );
}

/**
 * Assina os cards de vários setores (Dashboard/Cronograma/Recorrências/Rank).
 *
 * Mesma exclusão da lixeira, pelo mesmo motivo — ver `subscribeCards`.
 */
export function subscribeCardsForSectors(
  sectors: string[],
  onData: (cards: Card[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (sectors.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, "cards"), where("sector", "in", sectors.slice(0, 30))),
    (snap) => {
      onData(cardsDo(snap).filter(viva));
    },
    (e) => onError?.(e),
  );
}

/**
 * Assina só as demandas NA lixeira de um setor, da mais recente para a mais
 * antiga.
 *
 * Espelho exato de `subscribeCards`: a mesma consulta, o filtro invertido. É de
 * propósito que a consulta seja idêntica — o SDK do cliente reconhece o mesmo
 * alvo e não abre uma segunda escuta no servidor quando as duas telas coexistem.
 * Uma consulta própria (`where("deletedAt", "!=", null)`) custaria índice novo e
 * ainda esbarraria na mesma armadilha do documento sem o campo.
 */
export function subscribeLixeira(
  sector: string,
  onData: (cards: Card[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "cards"), where("sector", "==", sector)),
    (snap) => {
      onData(ordenarLixeira(cardsDo(snap).filter(naLixeira)));
    },
    (e) => onError?.(e),
  );
}

/**
 * De onde a demanda veio, para quem abrir o card daqui a meses.
 *
 * `origem` já existia no `Card` e era gravada só pelas rotas do servidor
 * (`api/demandas/decidir`, `api/recorrencias/gerar`). A ata precisa do mesmo, e
 * copiá-lo para dentro da tela faria a proveniência ser escrita de dois jeitos.
 */
export type Proveniencia = {
  origem?: "reuniao" | "recorrencia";
  /** A reunião gravada que originou a demanda, quando houve uma. */
  meetingIds?: string[];
  /** A ata em que a decisão de abrir esta demanda foi tomada. */
  ataId?: string;
};

/**
 * Abre a demanda e a primeira linha do histórico dela, no mesmo lote.
 *
 * `mudancas` é o estado inicial já traduzido (ver `mudancasIniciais`) — é o que
 * responde "com quem ela nasceu, e para quando".
 *
 * `noMesmoLote` É A ESCRITA DE QUEM CHAMOU, e ela entra AQUI por um motivo só:
 * AGENTS.md §4 — escrita e registro andam no mesmo lote, ou as duas entram ou
 * nenhuma. Quem trouxe a necessidade foi a ata, que cria a demanda e no mesmo
 * gesto grava o `cardId` no item da pauta. Em duas escritas separadas, a falha
 * da segunda deixaria o pior estado possível: um card de verdade no quadro e a
 * ata ainda chamando aquilo de assunto — e a próxima tentativa criaria um card
 * duplicado, porque nada na ata diria que o primeiro existe.
 *
 * O `WriteBatch` vaza na assinatura de propósito. A alternativa era esta função
 * conhecer a ata, e aí ela conheceria a próxima tela também. Quem passa a
 * função é sempre um módulo de `lib/` (nunca uma página): é lá que o SDK mora.
 */
export async function createCard(
  sector: string,
  input: CardInput,
  createdBy: string,
  mudancas: Mudanca[],
  extras?: Proveniencia,
  noMesmoLote?: (batch: WriteBatch, cardId: string) => void,
): Promise<string> {
  const now = Date.now();
  // Id gerado aqui, e não pelo `addDoc`: o evento do histórico precisa do id do
  // card para entrar no MESMO lote — e o lote é o que garante que a demanda
  // nunca nasça sem o registro de que nasceu.
  const ref = doc(collection(db, "cards"));
  const batch = writeBatch(db);
  batch.set(ref, {
    sector,
    columnId: input.columnId,
    title: input.title.trim(),
    description: input.description.trim(),
    type: input.type,
    assignee: input.assignee || null,
    requester: input.requester || null,
    requesterSector: input.requesterSector || null,
    dimensaoId: input.dimensaoId || null,
    subdimensaoId: input.subdimensaoId || null,
    startDate: input.startDate || null,
    due: input.due || null,
    priority: input.priority,
    tags: input.tags,
    tagRefs: input.tagRefs,
    checklist: input.checklist,
    links: input.links,
    comments: [],
    order: -now,
    enteredAt: now,
    createdAt: serverTimestamp(),
    createdBy,
    histCount: 1,
    // Espalhado no fim, e só com o que veio: `undefined` num campo do Firestore
    // é erro de escrita, não campo ausente.
    ...(extras?.origem ? { origem: extras.origem } : {}),
    ...(extras?.meetingIds?.length ? { meetingIds: extras.meetingIds } : {}),
    ...(extras?.ataId ? { ataId: extras.ataId } : {}),
  });
  const eventoId = anexarEvento(
    batch,
    ref.id,
    { autor: createdBy, sector },
    "criada",
    mudancas,
  );
  noMesmoLote?.(batch, ref.id);
  await batch.commit();
  // Depois do commit, sempre. Avisar antes publicaria no canal uma demanda que
  // ainda pode não existir — e o lote falha inteiro, não pela metade.
  avisarDiscord(ref.id, eventoId);
  return ref.id;
}

/**
 * Grava a edição do card E o registro dela.
 *
 * O registro é PARÂMETRO OBRIGATÓRIO, não uma chamada separada que quem escreve
 * a tela precisa lembrar de fazer. Trilha que depende de disciplina no ponto de
 * uso apodrece no primeiro caminho novo que alguém abrir — e apodrece calada,
 * porque a tela continua funcionando perfeitamente sem ela.
 *
 * Lote e não duas escritas: o card e a linha do histórico entram juntos ou não
 * entram. Se a mudança gravasse e o registro falhasse, o histórico passaria a
 * mentir por omissão, que é o único jeito de um histórico ser pior do que nada.
 *
 * `mudancas` vazio (uma reordenação de checklist, por exemplo) grava o card sem
 * criar linha nenhuma — ver `diffCard`.
 */
export async function updateCard(
  id: string,
  patch: Partial<Omit<Card, "id">>,
  registro: { ctx: ContextoHistorico; acao: Acao; mudancas: Mudanca[] },
): Promise<void> {
  const ref = doc(db, "cards", id);
  const batch = writeBatch(db);
  const eventoId = anexarEvento(
    batch,
    id,
    registro.ctx,
    registro.acao,
    registro.mudancas,
  );
  // O incremento entra no MESMO update do card: duas escritas no mesmo
  // documento dentro de um lote não são combinadas, e a segunda mandaria um
  // patch sem os campos da primeira.
  batch.update(ref, eventoId ? { ...patch, histCount: increment(1) } : patch);
  await batch.commit();
  avisarDiscord(id, eventoId);
}

/**
 * Grava no banco o que `resolverTags` já mostra na tela.
 *
 * A tela sozinha bastaria para quem está olhando o quadro, mas quem lê `tags`
 * fora dele — a busca, o relatório do gestor, o catálogo do cowork — lê o campo
 * cru. Enquanto o texto antigo estiver gravado, esses três continuam
 * respondendo pelo nome velho. Por isso o conserto é escrito, não só exibido.
 *
 * Idempotente de propósito: dois navegadores com o mesmo quadro aberto escrevem
 * a mesma correção, e a segunda não tem efeito.
 */
export async function corrigirTagsDeCards(
  correcoes: { id: string; tags: string[]; tagRefs: TagRef[] }[],
): Promise<void> {
  if (correcoes.length === 0) return;
  const batch = writeBatch(db);
  // 500 é o teto de operações de um lote do Firestore. Passar disso seria um
  // erro do lote inteiro — e um quadro com mais de 500 tags desatualizadas de
  // uma vez é raro, mas o resto entra na próxima passada.
  correcoes.slice(0, 500).forEach((c) => {
    batch.update(doc(db, "cards", c.id), {
      tags: c.tags,
      tagRefs: c.tagRefs,
    });
  });
  await batch.commit();
}

export async function addComment(
  id: string,
  comment: Comment,
): Promise<void> {
  await updateDoc(doc(db, "cards", id), { comments: arrayUnion(comment) });
}

/** Alvo de uma mudança em comentário já gravado. */
export type CommentRef = { id?: string; author: string; at: number };

/**
 * Acha o comentário na lista que veio do banco.
 *
 * O `id` é o casamento bom, mas cai em autor+data quando o comentário é antigo
 * e nasceu sem id — foi assim que os primeiros foram gravados.
 */
function acharComentario(lista: Comment[], alvo: CommentRef): number {
  return lista.findIndex((c) =>
    alvo.id && c.id
      ? c.id === alvo.id
      : c.author === alvo.author && c.at === alvo.at,
  );
}

/**
 * Reescreve o texto de um comentário já publicado.
 *
 * Transação, e não `updateDoc` com a lista que o modal tem na mão: `comments` é
 * um array, e gravar a cópia da tela apagaria, em silêncio, o comentário que
 * outra pessoa escreveu enquanto este card estava aberto. A transação relê a
 * lista no instante da escrita e mexe só no comentário alvo.
 *
 * Devolve a marca de edição gravada, para a tela mostrar o que está no banco em
 * vez de um segundo relógio próprio.
 */
export async function editComment(
  cardId: string,
  alvo: CommentRef,
  text: string,
): Promise<number> {
  const ref = doc(db, "cards", cardId);
  // Fora da transação: ela pode ser repetida pelo Firestore, e a hora da edição
  // é a de quem editou, não a da última tentativa de gravar.
  const editedAt = Date.now();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const atuais = ((snap.data().comments ?? []) as Comment[]).slice();
    const i = acharComentario(atuais, alvo);
    // Sumiu entre abrir e salvar (card recriado, comentário removido): não é
    // caso de recriar o comentário no fim da lista, fora do lugar e do tempo.
    if (i < 0) return;
    atuais[i] = { ...atuais[i], text, editedAt };
    tx.update(ref, { comments: atuais });
  });
  return editedAt;
}

/**
 * Apaga um comentário. Some de vez — comentário não tem lixeira.
 *
 * Mesma transação da edição, e pelo mesmo motivo. `arrayRemove` seria menos
 * código, mas ele casa o objeto inteiro campo a campo: um comentário editado
 * por outra aba (que ganhou `editedAt`) deixaria de casar, e a remoção não
 * aconteceria sem ninguém perceber.
 *
 * Tira UM, não todos os que batem: se dois comentários antigos e sem id
 * dividissem autor e milissegundo, apagar os dois seria apagar o que ninguém
 * pediu.
 */
export async function removeComment(
  cardId: string,
  alvo: CommentRef,
): Promise<void> {
  const ref = doc(db, "cards", cardId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const atuais = ((snap.data().comments ?? []) as Comment[]).slice();
    const i = acharComentario(atuais, alvo);
    if (i < 0) return;
    atuais.splice(i, 1);
    tx.update(ref, { comments: atuais });
  });
}

/**
 * Manda a demanda para a lixeira.
 *
 * ISTO SUBSTITUI o antigo `deleteCardById`, que apagava de verdade — e que, na
 * prática, só o super admin conseguia executar. Ele varria a subcoleção de
 * histórico num lote de até 400 deleções, e cada deleção custa 8 acessos a
 * documento nas regras para admin (14 para gestor), contra um teto de 20 por
 * requisição. O super admin passava porque `isSuperAdmin()` responde sem ler
 * documento nenhum; todo o resto batia no teto e recebia "sem permissão" numa
 * ação que a pessoa tinha, sim, permissão de fazer.
 *
 * A saída não é um lote menor: é não precisar de lote. Aqui são DUAS operações
 * de documento único — a marca no card e o evento do histórico —, e o custo
 * cabe com folga (14 acessos para admin, 18 para gestor). Apagar de vez, com a
 * varrida da subcoleção, é `POST /api/demandas/expurgar`, que roda no Admin SDK
 * e não passa por regra nenhuma.
 *
 * Lote de duas, e não duas escritas: a demanda sai do quadro e o registro de
 * que ela saiu entram juntos, ou nenhum dos dois entra (AGENTS.md §4). Uma
 * demanda que some sem linha nenhuma no histórico é a pior coisa que esta
 * funcionalidade poderia produzir — some justamente o que responde "quem
 * apagou isto, e quando?".
 *
 * `columnId`, `order` e `enteredAt` NÃO são tocados. É o que faz a restauração
 * devolver a demanda ao lugar de onde ela saiu, com a idade que sempre teve.
 */
export async function moverParaLixeira(
  id: string,
  registro: { ctx: ContextoHistorico },
): Promise<void> {
  const batch = writeBatch(db);
  // Sem `mudancas`: o verbo é o fato inteiro, e "deletedAt: vazio → data" seria
  // a mesma frase escrita duas vezes. Por isso o evento entra mesmo assim — ver
  // `registraSemMudancas` em `historico-core`.
  const eventoId = anexarEvento(batch, id, registro.ctx, "excluida", []);
  batch.update(doc(db, "cards", id), {
    deletedAt: Date.now(),
    deletedBy: registro.ctx.autor,
    histCount: increment(1),
  });
  await batch.commit();
  avisarDiscord(id, eventoId);
}

/**
 * Devolve a demanda ao quadro, na coluna em que estava.
 *
 * Grava `null`, e não `deleteField()`. As duas escondem a demanda da lixeira,
 * mas a regra do Firestore que autoriza a restauração olha os campos afetados
 * pela escrita, e `null` é o que ela consegue examinar: `deleteField()` chega
 * como remoção, e uma regra que precisa comparar valor não tem o que comparar.
 * `naLixeira` trata ausência e `null` como a mesma coisa exatamente para que
 * essa escolha fique livre — ver `lixeira-core`.
 *
 * Nada de `order` nem de `enteredAt`. Reiniciar o aging faria a demanda voltar
 * ao topo da coluna mentindo que é nova, e o atraso que ela acumulou — que é a
 * razão de alguém tê-la resgatado — desapareceria do Dashboard no mesmo clique.
 */
export async function restaurarDaLixeira(
  id: string,
  registro: { ctx: ContextoHistorico },
): Promise<void> {
  const batch = writeBatch(db);
  const eventoId = anexarEvento(batch, id, registro.ctx, "restaurada", []);
  batch.update(doc(db, "cards", id), {
    deletedAt: null,
    deletedBy: null,
    histCount: increment(1),
  });
  await batch.commit();
  avisarDiscord(id, eventoId);
}

/**
 * Move um card para outra coluna (reinicia o aging e vai para o topo).
 *
 * Arrastar é a mudança mais frequente do quadro e a que menos deixa rastro na
 * memória de quem arrastou — é justamente a que mais precisa do registro.
 */
export async function moveCard(
  id: string,
  columnId: string,
  registro: { ctx: ContextoHistorico; mudancas: Mudanca[] },
): Promise<void> {
  const now = Date.now();
  const batch = writeBatch(db);
  const eventoId = anexarEvento(
    batch,
    id,
    registro.ctx,
    "movida",
    registro.mudancas,
  );
  batch.update(doc(db, "cards", id), {
    columnId,
    order: -now,
    enteredAt: now,
    ...(eventoId ? { histCount: increment(1) } : {}),
  });
  await batch.commit();
  avisarDiscord(id, eventoId);
}

// ---------------------------------------------------------------------------
// Pedido de conclusão — as três transições
// ---------------------------------------------------------------------------

/**
 * As três passam por aqui, e não por `updateCard`, por uma razão só: o VERBO.
 *
 * `updateCard` grava a ação "editada" e uma lista de mudanças de campo. Pedir,
 * aprovar e recusar não são edição de campo — o que interessa na timeline é
 * quem pediu, quem decidiu e quando, e nenhum par "de → para" conta isso. Passar
 * por `updateCard` produziria três linhas dizendo "editou a demanda" sobre um
 * campo que a timeline nem rastreia, ou seja, três linhas vazias.
 *
 * O que elas herdam de `updateCard` é o que importa: lote único com o evento
 * dentro, incremento do contador no MESMO update do card, e o aviso no Discord
 * depois do commit. Ver os comentários de lá — eles valem inteiros aqui.
 */
async function gravarConclusao(
  id: string,
  patch: Partial<Omit<Card, "id">>,
  ctx: ContextoHistorico,
  acao: Acao,
): Promise<void> {
  const batch = writeBatch(db);
  // Sem mudanças de campo: os três verbos valem por si, e é `registraSemMudancas`
  // (`historico-core`) quem garante que o evento nasce assim mesmo. Um verbo
  // esquecido lá faria a ação acontecer sem deixar rastro.
  const eventoId = anexarEvento(batch, id, ctx, acao, []);
  batch.update(
    doc(db, "cards", id),
    eventoId ? { ...patch, histCount: increment(1) } : patch,
  );
  await batch.commit();
  avisarDiscord(id, eventoId);
}

/**
 * O operador pede que a demanda seja dada por concluída.
 *
 * `por` é quem está pedindo, e as regras do Firestore exigem que bata com o
 * token — ninguém pede em nome de outro, mesmo princípio de `createdBy` e do
 * `deletedBy` da lixeira.
 *
 * O card NÃO se move. É a diferença inteira entre isto e `moveCard`: a demanda
 * fica onde está, com um pedido pendurado, até alguém revisar.
 */
export async function pedirConclusao(
  id: string,
  por: string,
  colunaAlvo: string,
  ctx: ContextoHistorico,
): Promise<void> {
  await gravarConclusao(
    id,
    patchDePedido(por, colunaAlvo, Date.now()),
    ctx,
    "conclusao-pedida",
  );
}

/**
 * O gestor aprova: a demanda vai para a etapa que o pedido apontou.
 *
 * Recebe o CARD, e não o id, porque o destino está gravado no pedido dele — e
 * ler o pedido aqui, em vez de receber a coluna por parâmetro, é o que impede
 * quem chama de aprovar para uma coluna que ninguém pediu.
 *
 * Pedido ilegível (campo pela metade, documento mexido à mão) não vira escrita
 * nenhuma: `pedidoDoCard` devolve `null` e a função sai. Aprovar um pedido que
 * não dá para ler mandaria a demanda para uma coluna de id vazio, ou seja, para
 * fora do quadro.
 */
export async function aprovarConclusao(
  card: Pick<Card, "id" | "conclusaoPedida">,
  ctx: ContextoHistorico,
): Promise<void> {
  const pedido = pedidoDoCard(card);
  if (!pedido) return;
  await gravarConclusao(
    card.id,
    patchDeAprovacao(pedido, Date.now()),
    ctx,
    "conclusao-aprovada",
  );
}

/** O gestor recusa: o pedido sai, a demanda fica exatamente onde estava. */
export async function recusarConclusao(
  id: string,
  ctx: ContextoHistorico,
): Promise<void> {
  await gravarConclusao(id, patchDeRecusa(), ctx, "conclusao-recusada");
}

// ---------------------------------------------------------------------------
// Fusão de duas demandas
// ---------------------------------------------------------------------------

/**
 * Funde duas demandas: o conteúdo vai para uma, a outra vai para a lixeira.
 *
 * UM LOTE SÓ, com as quatro escritas. AGENTS.md §4 já manda escrita e registro
 * andarem juntos, e aqui isso é mais forte do que de costume: uma fusão pela
 * metade deixa o conteúdo duplicado no vencedor E o original vivo no quadro —
 * ou seja, PIORA exatamente o problema que ela veio resolver, e a segunda
 * tentativa duplicaria de novo.
 *
 * O CARD QUE PERDE VAI PARA A LIXEIRA, não é apagado. Nada é removido de lá: o
 * que foi para o vencedor foi copiado. É isso que faz uma fusão errada ser
 * desfeita restaurando um card íntegro, em vez de reconstruído de memória.
 *
 * OS DOIS EVENTOS APONTAM UM PARA O OUTRO, pelo TÍTULO e não pelo id. A timeline
 * é lida por gente, e um id de vinte caracteres não responde "fundiu com o
 * quê?"; o título responde. O id do outro card não se perde — ele está no
 * documento que foi para a lixeira, com o histórico dele pendurado embaixo.
 *
 * ORÇAMENTO DAS REGRAS: são duas escritas em `/cards` e duas na subcoleção
 * `historico`, num lote de quatro operações. O teto do Firestore é de 20 acessos
 * a documento por lote, e cada uma destas custa uma leitura do cadastro — folga
 * larga. Foi um lote de 400 deleções que estourou aquele teto uma vez (ver o
 * rodapé de `historico.ts`); quatro não chega perto.
 */
export async function fundirCards(args: {
  vencedorId: string;
  perdidoId: string;
  /** Títulos como ficam DEPOIS da fusão — é o que os dois eventos citam. */
  tituloVencedor: string;
  tituloPerdido: string;
  patchVencedor: Record<string, unknown>;
  patchPerdido: Record<string, unknown>;
  ctx: ContextoHistorico;
}): Promise<void> {
  const batch = writeBatch(db);

  const eventoVencedor = anexarEvento(batch, args.vencedorId, args.ctx, "fundida", [
    { campo: "fusao", de: args.tituloPerdido, para: null },
  ]);
  const eventoPerdido = anexarEvento(batch, args.perdidoId, args.ctx, "absorvida", [
    { campo: "fusao", de: null, para: args.tituloVencedor },
  ]);

  batch.update(doc(db, "cards", args.vencedorId), {
    ...args.patchVencedor,
    ...(eventoVencedor ? { histCount: increment(1) } : {}),
  });
  batch.update(doc(db, "cards", args.perdidoId), {
    ...args.patchPerdido,
    ...(eventoPerdido ? { histCount: increment(1) } : {}),
  });

  await batch.commit();
  // Só o vencedor é anunciado. O aviso do perdido diria ao canal que uma demanda
  // foi excluída, sem dizer que ela virou parte de outra — e quem lesse o canal
  // entenderia o contrário do que aconteceu.
  avisarDiscord(args.vencedorId, eventoVencedor);
}

// ---------------------------------------------------------------------------
// Mudança de setor
// ---------------------------------------------------------------------------

/**
 * Leva a demanda para o quadro de outro setor.
 *
 * O QUE VAI JUNTO não se decide aqui: quem calcula é `planoDaMudanca`
 * (`mover-setor-core.ts`), que é puro e testado, e a tela MOSTRA o plano antes
 * de chamar isto. Aqui só passa a escrita.
 *
 * O EVENTO É GRAVADO NO SETOR DE ORIGEM, e esta é a linha que merece a
 * explicação. A regra de criação do histórico exige que o `sector` do evento
 * bata com o do card pai — e, dentro deste lote, o card pai ainda é o antigo:
 * as regras avaliam a criação do evento contra o documento como ele está
 * gravado, não contra o que o mesmo lote vai gravar nele. Escrever o evento já
 * com o setor de destino faria a regra recusá-lo, e o lote inteiro cairia
 * junto — a transferência simplesmente não aconteceria, com uma mensagem
 * falando de permissão.
 *
 * O efeito colateral disso é justamente o que `setoresAnteriores` resolve: a
 * linha da transferência fica no setor de origem, junto com todo o resto da
 * timeline, e a consulta do histórico passa a procurar nos dois.
 */
export async function moverDeSetor(
  id: string,
  patch: Partial<Omit<Card, "id">>,
  registro: { ctx: ContextoHistorico; mudancas: Mudanca[] },
): Promise<void> {
  const batch = writeBatch(db);
  const eventoId = anexarEvento(
    batch,
    id,
    registro.ctx,
    "transferida",
    registro.mudancas,
  );
  batch.update(
    doc(db, "cards", id),
    eventoId ? { ...patch, histCount: increment(1) } : patch,
  );
  await batch.commit();
  avisarDiscord(id, eventoId);
}

// ---------------------------------------------------------------------------
// Colunas por setor (editáveis)
// ---------------------------------------------------------------------------

export type ColumnDoc = {
  id: string;
  sector: string;
  colId: string;
  title: string;
  color: string;
  order: number;
};

export const COLUMN_COLORS = [
  "#78776f",
  "#54b8ff",
  "#f5b13d",
  "#c084fc",
  "#34d399",
  "#fb7185",
  "#ff6a2b",
  "#2b7fff",
];

function sectorKey(s: string): string {
  return s.replace(/[^\w]/g, "_");
}

export function subscribeColumns(
  sector: string,
  onData: (cols: ColumnDoc[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "columns"), where("sector", "==", sector)),
    (snap) => {
      const cols = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ColumnDoc, "id">),
      }));
      cols.sort((a, b) => a.order - b.order);
      onData(cols);
    },
    (e) => onError?.(e),
  );
}

/**
 * Colunas de vários setores de uma vez (Dashboard e Cronograma).
 *
 * Existe porque "concluído" não é um id fixo: cada setor edita as suas colunas,
 * e a última do quadro é o que define uma demanda entregue. Contar atraso com
 * `columnId !== "concluido"` chapado erra em todo setor que renomeou a coluna.
 */
export function subscribeColumnsForSectors(
  sectors: string[],
  onData: (cols: ColumnDoc[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (sectors.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "columns"),
      where("sector", "in", sectors.slice(0, 30)),
    ),
    (snap) => {
      const cols = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ColumnDoc, "id">),
      }));
      cols.sort((a, b) => a.order - b.order);
      onData(cols);
    },
    (e) => onError?.(e),
  );
}

/**
 * Agrupa as colunas por setor, caindo no padrão para quem ainda não
 * personalizou — assim quem consome nunca precisa tratar "setor sem colunas".
 */
export function columnsBySector(
  cols: ColumnDoc[],
  sectors: string[],
): Record<string, KanbanColumn[]> {
  const out: Record<string, KanbanColumn[]> = {};
  cols.forEach((c) => {
    (out[c.sector] = out[c.sector] ?? []).push({
      id: c.colId,
      title: c.title,
      color: c.color,
    });
  });
  sectors.forEach((s) => {
    if (!out[s]?.length) out[s] = DEFAULT_COLUMNS;
  });
  return out;
}

/**
 * Etapas de entrega de cada setor, prontas para `has(card.columnId)`.
 *
 * Dashboard e Cronograma leem vários quadros de uma vez e precisam saber, card
 * a card, se aquela demanda já foi entregue — sem isso, prazo vencido de coisa
 * concluída volta a aparecer como atraso.
 */
export function deliveredBySector(
  colsPorSetor: Record<string, KanbanColumn[]>,
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  Object.entries(colsPorSetor).forEach(([s, lista]) => {
    out[s] = colunasEntregues(lista);
  });
  return out;
}

export async function seedDefaultColumns(sector: string): Promise<void> {
  const batch = writeBatch(db);
  DEFAULT_COLUMNS.forEach((c, i) => {
    batch.set(doc(db, "columns", `${sectorKey(sector)}__${c.id}`), {
      sector,
      colId: c.id,
      title: c.title,
      color: c.color,
      order: i,
    });
  });
  await batch.commit();
}

export async function addColumn(
  sector: string,
  title: string,
  color: string,
  order: number,
): Promise<void> {
  await addDoc(collection(db, "columns"), {
    sector,
    colId: `col_${Date.now()}`,
    title: title.trim(),
    color,
    order,
  });
}

export async function updateColumn(
  id: string,
  patch: { title?: string; color?: string },
): Promise<void> {
  await updateDoc(doc(db, "columns", id), patch);
}

export async function deleteColumn(id: string): Promise<void> {
  await deleteDoc(doc(db, "columns", id));
}

export async function reorderColumns(orderedIds: string[]): Promise<void> {
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => batch.update(doc(db, "columns", id), { order: i }));
  await batch.commit();
}
