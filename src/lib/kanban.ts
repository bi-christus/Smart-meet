import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
  arrayUnion,
  runTransaction,
} from "firebase/firestore";
import { db } from "./firebase";

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

export type Priority = "alta" | "media" | "baixa";
export const PRIORITY_LABEL: Record<Priority, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

/** Tipo da demanda. */
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
};

/** Assina os cards de um setor em tempo real. */
export function subscribeCards(
  sector: string,
  onData: (cards: Card[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "cards"), where("sector", "==", sector)),
    (snap) => {
      const cards = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Card, "id">),
      }));
      cards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      onData(cards);
    },
    (e) => onError?.(e),
  );
}

/** Assina os cards de vários setores (Dashboard/Cronograma). */
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
      onData(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Card, "id">) })),
      );
    },
    (e) => onError?.(e),
  );
}

export async function createCard(
  sector: string,
  input: CardInput,
  createdBy: string,
): Promise<void> {
  const now = Date.now();
  await addDoc(collection(db, "cards"), {
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
    comments: [],
    order: -now,
    enteredAt: now,
    createdAt: serverTimestamp(),
    createdBy,
  });
}

export async function updateCard(
  id: string,
  patch: Partial<Omit<Card, "id">>,
): Promise<void> {
  await updateDoc(doc(db, "cards", id), patch);
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

/**
 * Reescreve o texto de um comentário já publicado.
 *
 * Transação, e não `updateDoc` com a lista que o modal tem na mão: `comments` é
 * um array, e gravar a cópia da tela apagaria, em silêncio, o comentário que
 * outra pessoa escreveu enquanto este card estava aberto. A transação relê a
 * lista no instante da escrita e mexe só no comentário alvo.
 *
 * O alvo é casado pelo `id`, mas cai em autor+data quando o comentário é antigo
 * e nasceu sem id — foi assim que os primeiros foram gravados.
 *
 * Devolve a marca de edição gravada, para a tela mostrar o que está no banco em
 * vez de um segundo relógio próprio.
 */
export async function editComment(
  cardId: string,
  alvo: { id?: string; author: string; at: number },
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
    const bate = (c: Comment) =>
      alvo.id && c.id
        ? c.id === alvo.id
        : c.author === alvo.author && c.at === alvo.at;
    const i = atuais.findIndex(bate);
    // Sumiu entre abrir e salvar (card recriado, comentário removido): não é
    // caso de recriar o comentário no fim da lista, fora do lugar e do tempo.
    if (i < 0) return;
    atuais[i] = { ...atuais[i], text, editedAt };
    tx.update(ref, { comments: atuais });
  });
  return editedAt;
}

export async function deleteCardById(id: string): Promise<void> {
  await deleteDoc(doc(db, "cards", id));
}

/** Move um card para outra coluna (reinicia o aging e vai para o topo). */
export async function moveCard(id: string, columnId: string): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(db, "cards", id), {
    columnId,
    order: -now,
    enteredAt: now,
  });
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
