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
} from "firebase/firestore";
import { db } from "./firebase";

export type KanbanColumn = { id: string; title: string; color: string };

/** Colunas padrão (compartilhadas entre setores por enquanto; por-setor vem na Fase 3f). */
export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: "backlog", title: "A fazer", color: "#78776f" },
  { id: "andamento", title: "Em andamento", color: "#54b8ff" },
  { id: "aguardando", title: "Aguardando", color: "#f59e0b" },
  { id: "validacao", title: "Validação", color: "#c77dff" },
  { id: "concluido", title: "Concluído", color: "#37d39b" },
];

export type Card = {
  id: string;
  sector: string;
  columnId: string;
  title: string;
  description?: string;
  assignee?: string | null; // e-mail do responsável
  due?: string | null; // yyyy-mm-dd
  order: number;
  createdBy?: string;
};

export type CardInput = {
  title: string;
  description: string;
  columnId: string;
  assignee: string | null;
  due: string | null;
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
  await addDoc(collection(db, "cards"), {
    sector,
    columnId: input.columnId,
    title: input.title.trim(),
    description: input.description.trim(),
    assignee: input.assignee || null,
    due: input.due || null,
    order: Date.now(),
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

/** Move um card para outra coluna (mantém-no no topo da coluna destino). */
export async function moveCard(id: string, columnId: string): Promise<void> {
  await updateDoc(doc(db, "cards", id), { columnId, order: Date.now() });
}
