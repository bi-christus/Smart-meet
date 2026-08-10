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
 *
 * Os dois cadastros são INDEPENDENTES: a pessoa não pertence a um setor. Quem
 * pede uma demanda pode pedi-la por qualquer setor (e a mesma pessoa muda de
 * área), então amarrar os dois só fazia a lista de nomes sumir quando o setor
 * escolhido não batia com o cadastro. Na demanda, cada campo é gravado por si.
 */

export type SolicitanteSetor = { id: string; name: string };
export type Solicitante = { id: string; name: string };

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

export async function addSolicitante(name: string): Promise<void> {
  await addDoc(collection(db, "solicitantes"), {
    name: name.trim(),
    createdAt: serverTimestamp(),
  });
}

export async function deleteSolicitante(id: string): Promise<void> {
  await deleteDoc(doc(db, "solicitantes", id));
}

// ---------------------------------------------------------------------------
// Criação a partir do formulário de demanda
//
// Duas telas cadastram durante o preenchimento — o modal do Kanban e a
// validação de propostas — e cada uma usa um componente de select diferente.
// A UI diverge; a REGRA (não duplicar nome, devolver o nome já pronto para
// selecionar) mora aqui, para não existir em duas versões.
// ---------------------------------------------------------------------------

/**
 * Cadastra o setor solicitante se ainda não existir e devolve o nome
 * canônico — o que já estava salvo, quando é repetido, para não criar
 * "Compras" e "compras" como coisas diferentes.
 */
export async function garantirSetorSolicitante(
  nome: string,
  existentes: SolicitanteSetor[],
): Promise<string> {
  const n = nome.trim();
  if (!n) throw new Error("Informe o nome do setor.");
  const igual = existentes.find(
    (s) => s.name.trim().toLowerCase() === n.toLowerCase(),
  );
  if (igual) return igual.name;
  await addSolicitanteSetor(n);
  return n;
}

/** Idem para a pessoa — duplicata é o mesmo nome no cadastro inteiro. */
export async function garantirSolicitante(
  nome: string,
  existentes: Solicitante[],
): Promise<string> {
  const n = nome.trim();
  if (!n) throw new Error("Informe o nome do solicitante.");
  const igual = existentes.find(
    (s) => s.name.trim().toLowerCase() === n.toLowerCase(),
  );
  if (igual) return igual.name;
  await addSolicitante(n);
  return n;
}
