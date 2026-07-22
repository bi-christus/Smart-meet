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
} from "firebase/firestore";
import { db } from "./firebase";

export type KanbanColumn = { id: string; title: string; color: string };

/** Colunas padrão (compartilhadas entre setores por enquanto; por-setor vem na Fase 3f). */
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

export type ChecklistItem = { text: string; done: boolean };

export type Card = {
  id: string;
  sector: string;
  columnId: string;
  title: string;
  description?: string;
  assignee?: string | null; // e-mail do responsável
  due?: string | null; // yyyy-mm-dd
  priority?: Priority;
  checklist?: ChecklistItem[];
  order: number;
  enteredAt?: number; // ms — quando entrou na coluna atual (aging)
  createdBy?: string;
};

export type CardInput = {
  title: string;
  description: string;
  columnId: string;
  assignee: string | null;
  due: string | null;
  priority: Priority;
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

/** Assina os cards de vários setores (para Dashboard/Cronograma). */
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
    assignee: input.assignee || null,
    due: input.due || null,
    priority: input.priority,
    checklist: input.checklist,
    order: now,
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

export async function deleteCardById(id: string): Promise<void> {
  await deleteDoc(doc(db, "cards", id));
}

/** Move um card para outra coluna (reinicia o aging e vai para o topo). */
export async function moveCard(id: string, columnId: string): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(db, "cards", id), {
    columnId,
    order: now,
    enteredAt: now,
  });
}

// ---------------------------------------------------------------------------
// Colunas por setor (editáveis) — armazenadas no Firestore.
// `colId` é o id que os cards referenciam em `columnId`.
// ---------------------------------------------------------------------------

export type ColumnDoc = {
  id: string; // id do documento no Firestore
  sector: string;
  colId: string; // id lógico usado por card.columnId
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

/** Cria as colunas padrão de um setor (idempotente — ids determinísticos). */
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
