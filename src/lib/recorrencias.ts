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
import { db, auth } from "./firebase";
import { toISO } from "./datas";
import type { Ocorrencia, Recorrencia } from "./recorrencias-core";

/**
 * Recorrências no Firestore.
 *
 * Duas coleções, e a separação é o que impede o card duplicado:
 *  - /recorrencias — a REGRA (o que, com que ritmo, por quem).
 *  - /ocorrencias  — cada data prevista que JÁ virou card. É o registro que o
 *    gerador consulta antes de abrir qualquer coisa; sem ele, um cron que roda
 *    duas vezes no mesmo dia abre o mesmo card duas vezes.
 *
 * O cálculo das datas mora em `recorrencias-core` — aqui só tem banco.
 */

export type RecorrenciaInput = Omit<Recorrencia, "id" | "createdOn">;

function limparAtividades(acts: string[]): string[] {
  return acts.map((a) => a.trim()).filter(Boolean).slice(0, 20);
}

export function subscribeRecorrencias(
  sectors: string[],
  onData: (list: Recorrencia[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (sectors.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "recorrencias"),
      where("sector", "in", sectors.slice(0, 30)),
    ),
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Recorrencia, "id">),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      onData(list);
    },
    (e) => onError?.(e),
  );
}

export function subscribeOcorrencias(
  sectors: string[],
  onData: (list: Ocorrencia[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (sectors.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "ocorrencias"),
      where("sector", "in", sectors.slice(0, 30)),
    ),
    (snap) => {
      onData(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Ocorrencia, "id">),
        })),
      );
    },
    (e) => onError?.(e),
  );
}

export async function createRecorrencia(
  input: RecorrenciaInput,
  createdBy: string,
): Promise<string> {
  const ref = await addDoc(collection(db, "recorrencias"), {
    ...input,
    name: input.name.trim(),
    svc: input.svc.trim(),
    acts: limparAtividades(input.acts),
    // Piso do gerador: uma regra cadastrada hoje descreve um ritmo daqui para
    // frente, não uma dívida de manutenção atrasada desde a âncora da série.
    createdOn: toISO(new Date()),
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

export async function updateRecorrencia(
  id: string,
  patch: Partial<Omit<Recorrencia, "id">>,
): Promise<void> {
  const limpo: Record<string, unknown> = { ...patch };
  if (typeof patch.name === "string") limpo.name = patch.name.trim();
  if (typeof patch.svc === "string") limpo.svc = patch.svc.trim();
  if (patch.acts) limpo.acts = limparAtividades(patch.acts);
  await updateDoc(doc(db, "recorrencias", id), limpo);
}

export async function deleteRecorrencia(id: string): Promise<void> {
  await deleteDoc(doc(db, "recorrencias", id));
}

/**
 * Pede ao servidor que abra os cards pendentes.
 *
 * A geração NÃO acontece aqui no navegador de propósito: quem cria o card é a
 * mesma rota que o cron chama todo dia. Duas implementações da mesma regra
 * (uma no cliente, outra no servidor) divergiriam na primeira mudança, e a
 * diferença só apareceria como card faltando ou card em duplicata.
 *
 * `recId` limita a uma regra — é o "Gerar card agora" do modal, que antecipa o
 * próximo ciclo em vez de esperar a data.
 */
export async function gerarCards(
  recId?: string,
): Promise<{ criados: number; cards: string[] }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const token = await user.getIdToken();
  const r = await fetch("/api/recorrencias/gerar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(recId ? { recId, antecipar: true } : {}),
  });
  const body = (await r.json().catch(() => ({}))) as {
    error?: string;
    criados?: number;
    cards?: string[];
  };
  if (!r.ok) throw new Error(body.error || "Não foi possível gerar os cards.");
  return { criados: body.criados ?? 0, cards: body.cards ?? [] };
}
