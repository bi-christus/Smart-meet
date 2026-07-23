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
} from "firebase/firestore";
import { db } from "./firebase";

export type KanbanColumn = { id: string; title: string; color: string };

/** Colunas padrão (seed inicial por setor). */
export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: "backlog", title: "A fazer", color: "#78776f" },
  { id: "andamento", title: "Em andamento", color: "#54b8ff" },
  { id: "aguardando", title: "Aguardando", color: "#f5b13d" },
  { id: "validacao", title: "Validação", color: "#c084fc" },
  { id: "concluido", title: "Concluído", color: "#34d399" },
];

export type Priority = "alta" | "media" | "baixa";
export const PRIORITY_LABEL: Record<Priority, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

/** Tipo da demanda. */
export type DemandType = "implementacao" | "correcao" | "melhoria" | "relatorio";
export const DEMAND_TYPES: DemandType[] = [
  "implementacao",
  "correcao",
  "melhoria",
  "relatorio",
];
export const DEMAND_TYPE_LABEL: Record<DemandType, string> = {
  implementacao: "Nova implementação",
  correcao: "Correção",
  melhoria: "Melhoria",
  relatorio: "Relatório",
};
export const DEMAND_TYPE_COLOR: Record<DemandType, string> = {
  implementacao: "#54b8ff", // info
  correcao: "#fb7185", // danger
  melhoria: "#c084fc", // roxo
  relatorio: "#f5b13d", // âmbar
};

export type ChecklistItem = {
  id?: string;
  text: string;
  done: boolean;
  desc?: string;
};
export type Comment = { id?: string; author: string; text: string; at: number };

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
  assignee?: string | null; // responsável (e-mail)
  requester?: string | null; // solicitante (e-mail)
  startDate?: string | null; // data de início (yyyy-mm-dd)
  due?: string | null; // prazo de entrega (yyyy-mm-dd)
  priority?: Priority;
  tags?: string[];
  checklist?: ChecklistItem[];
  comments?: Comment[];
  order: number;
  enteredAt?: number;
  createdBy?: string;
};

export type CardInput = {
  title: string;
  description: string;
  columnId: string;
  type: DemandType;
  assignee: string | null;
  requester: string | null;
  startDate: string | null;
  due: string | null;
  priority: Priority;
  tags: string[];
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
    startDate: input.startDate || null,
    due: input.due || null,
    priority: input.priority,
    tags: input.tags,
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

export async function addComment(
  id: string,
  comment: Comment,
): Promise<void> {
  await updateDoc(doc(db, "cards", id), { comments: arrayUnion(comment) });
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
