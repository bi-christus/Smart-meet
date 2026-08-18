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

// Idem para os links: normalizar URL, reconhecer serviço e escolher cor não
// dependem do banco. Reexportado daqui porque quem monta o card lê um módulo só.
import type { CardLink } from "./links-core";
export type { CardLink };

// O ícone escolhido de um link é regra pura — que nome vale, qual vence o
// deduzido, como se volta ao automático — e mora num módulo com teste próprio.
// Aqui só passa a escrita.
import { aplicarIcone } from "./icones-core.ts";

// Prioridade e tipo saíram daqui pelo mesmo motivo das colunas e da lixeira: o
// SERVIDOR precisa deles. A rota do aviso no Discord monta a mensagem lendo
// `/cards` pelo Admin SDK, e não pode importar este arquivo — ele traz o SDK do
// cliente junto. Reexportado para que nenhuma tela precise trocar de import.
import {
  DEMAND_TYPES,
  DEMAND_TYPE_COLOR,
  DEMAND_TYPE_LABEL,
  PRIORITY_LABEL,
  type DemandType,
  type Priority,
} from "./demanda-rotulos";
export { DEMAND_TYPES, DEMAND_TYPE_COLOR, DEMAND_TYPE_LABEL, PRIORITY_LABEL };
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

/** Paleta de tags (cor estável por nome). */
export const TAG_COLORS = [
  "#54b8ff",
  "#34d399",
  "#f5b13d",
  "#c084fc",
  "#fb7185",
  "#ff6a2b",
  "#2b7fff",
  "#5fe0b0",
];
export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

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
  startDate?: string | null; // data de início (yyyy-mm-dd)
  due?: string | null; // prazo de entrega (yyyy-mm-dd)
  priority?: Priority;
  tags?: string[];
  /** Quais das `tags` são referência, e para quem. Ausente = todas são texto. */
  tagRefs?: TagRef[];
  checklist?: ChecklistItem[];
  /**
   * Endereços que a demanda usa. Campo do card, e não coleção nova: a regra de
   * update de `/cards` já cobre quem pode escrever, e a aba Links lê pelo mesmo
   * `subscribeCardsForSectors` — que já vem escopado por setor. Coleção separada
   * custaria regra própria, índice próprio e uma segunda assinatura por setor
   * para mostrar uma lista que nunca passa de meia dúzia de itens por card.
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
};

export type CardInput = {
  title: string;
  description: string;
  columnId: string;
  type: DemandType;
  assignee: string | null;
  requester: string | null;
  requesterSector: string | null;
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
 * Assina os cards de vários setores (Dashboard/Cronograma/Links/Recorrências).
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
 * Abre a demanda e a primeira linha do histórico dela, no mesmo lote.
 *
 * `mudancas` é o estado inicial já traduzido (ver `mudancasIniciais`) — é o que
 * responde "com quem ela nasceu, e para quando".
 */
export async function createCard(
  sector: string,
  input: CardInput,
  createdBy: string,
  mudancas: Mudanca[],
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
  });
  const eventoId = anexarEvento(
    batch,
    ref.id,
    { autor: createdBy, sector },
    "criada",
    mudancas,
  );
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
 * Troca o ícone de UM link de uma demanda. `null` volta ao automático.
 *
 * TRANSAÇÃO, e não `updateDoc` com a lista que a tela tem na mão — pelo mesmo
 * motivo de `editComment` logo acima. `links` é um array, e gravar a cópia da
 * tela apaga, em silêncio, o link que outra pessoa colou entre o último
 * snapshot e este clique. A aba Links mostra links de dezenas de demandas de um
 * setor inteiro; a chance de duas pessoas mexerem no mesmo card não é teórica.
 *
 * ISTO NÃO PASSA POR `updateCard`, E A OMISSÃO É ESCOLHIDA — não esquecimento.
 * O registro é parâmetro obrigatório de `updateCard` porque trilha que depende
 * de disciplina no ponto de uso apodrece calada. Mas a regra do AGENTS.md §4 é
 * "escrita E REGISTRO andam no mesmo lote" — ela obriga a atomicidade de um
 * registro que precisa existir, e não obriga todo campo a virar registro. O
 * histórico da demanda responde "o que mudou nesta demanda?", e a resposta
 * "alguém trocou o desenho do selo de um link" empurra para baixo, uma linha de
 * cada vez, o que aquela trilha existe para preservar: mudança de prazo, de
 * responsável, de coluna. O que se perde ao não registrar é a autoria de uma
 * escolha cosmética, reversível em dois cliques por qualquer pessoa do setor,
 * e que a própria tela mostra o tempo todo — o ícone ESTÁ ali, visível, sem
 * precisar de auditoria.
 *
 * Pelo mesmo raciocínio não há aviso no Discord: `avisarDiscord` conta que uma
 * demanda mudou, e nada mudou na demanda.
 *
 * O DESFECHO É TIPADO porque as três saídas pedem telas diferentes. `"gravado"`
 * fecha o seletor; `"sem-mudanca"` também fecha, calado (escolher o que já
 * estava lá não é erro); `"sumiu"` precisa dizer alguma coisa — o card ou o
 * link deixou de existir enquanto esta aba estava aberta, e insistir no clique
 * não vai adiantar. Lançar nos três casos faria a tela tratar como falha o
 * caminho mais comum de todos.
 */
export type DesfechoIcone = "gravado" | "sem-mudanca" | "sumiu";

export async function definirIconeDoLink(
  cardId: string,
  linkId: string,
  icone: string | null,
): Promise<DesfechoIcone> {
  const ref = doc(db, "cards", cardId);
  let desfecho: DesfechoIcone = "sem-mudanca";
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      desfecho = "sumiu";
      return;
    }
    const atuais = (snap.data().links ?? []) as CardLink[];
    // `null` do módulo puro cobre três casos de uma vez: link inexistente,
    // valor já igual e nome fora do catálogo. Distinguir "sumiu" dos outros
    // dois é a única pergunta que a tela ainda precisa fazer.
    const novos = aplicarIcone(atuais, linkId, icone);
    if (!novos) {
      desfecho = atuais.some((l) => l.id === linkId) ? "sem-mudanca" : "sumiu";
      return;
    }
    tx.update(ref, { links: novos });
    desfecho = "gravado";
  });
  return desfecho;
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
