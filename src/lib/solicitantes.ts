import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

/**
 * Solicitantes e setores solicitantes — QUEM pede as demandas. São um cadastro
 * próprio (não os usuários do sistema): um solicitante pode não ter acesso ao
 * Smart Meet. Apenas admins gerenciam (a aba Admin é admin-only).
 */

export type SolicitanteSetor = { id: string; name: string };
export type Solicitante = { id: string; name: string; setor: string };

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "pt-BR");
}

// ---------------------------------------------------------------------------
// setores solicitantes
// ---------------------------------------------------------------------------

export function subscribeSolicitanteSetores(
  onData: (list: SolicitanteSetor[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "solicitanteSetores"),
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SolicitanteSetor, "id">),
      }));
      list.sort(byName);
      onData(list);
    },
    (e) => onError?.(e),
  );
}

export async function addSolicitanteSetor(name: string): Promise<void> {
  await addDoc(collection(db, "solicitanteSetores"), {
    name: name.trim(),
    createdAt: serverTimestamp(),
  });
}

export async function deleteSolicitanteSetor(id: string): Promise<void> {
  await deleteDoc(doc(db, "solicitanteSetores", id));
}

// ---------------------------------------------------------------------------
// solicitantes
// ---------------------------------------------------------------------------

export function subscribeSolicitantes(
  onData: (list: Solicitante[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "solicitantes"),
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Solicitante, "id">),
      }));
      list.sort(byName);
      onData(list);
    },
    (e) => onError?.(e),
  );
}

export async function addSolicitante(
  name: string,
  setor: string,
): Promise<void> {
  await addDoc(collection(db, "solicitantes"), {
    name: name.trim(),
    setor: setor.trim(),
    createdAt: serverTimestamp(),
  });
}

export async function deleteSolicitante(id: string): Promise<void> {
  await deleteDoc(doc(db, "solicitantes", id));
}
