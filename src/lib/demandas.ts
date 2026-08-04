/**
 * Propostas de demanda geradas a partir de reuniões — lado do cliente.
 *
 * O cliente só LÊ estas coleções. Aceitar e recusar passam por
 * `POST /api/demandas/decidir`, onde a autorização é verificada e a escrita em
 * /cards acontece dentro de uma transação com log. As regras do Firestore
 * negam escrita direta aqui, então não há atalho.
 */
import {
  collection,
  onSnapshot,
  query,
  where,
  type FirestoreError,
} from "firebase/firestore";
import { db, auth } from "./firebase";

export type Certeza = "alta" | "media" | "baixa";
export type StatusProposta = "pendente" | "aceita" | "recusada" | "obsoleta";

export type Evidencia = { citacao: string; marca?: string };

export type Proposta = {
  id: string;
  loteId: string;
  meetingId: string;
  driveFileId: string;
  sectorReuniao: string;
  sectorAlvo: string;
  acao: "nova";
  certezaLLM: Certeza;
  assunto: string;
  resumo: string;
  evidencia: Evidencia[];
  conferir: string[];
  proposta: {
    title: string;
    description: string;
    type: string;
    tags: string[];
    checklist: { text: string; desc?: string }[];
  };
  possivelDuplicataDe: string[];
  status: StatusProposta;
  decisao?: {
    por: string;
    motivo?: string;
    cardId?: string;
    camposEditados?: string[];
  };
};

export type Lote = {
  id: string;
  meetingId: string;
  base: string;
  sectorReuniao: string;
  status: "pendente" | "parcial" | "resolvido" | "rejeitado";
  motivoRejeicao?: string;
  rejeitadasNoIngest?: { motivo: string; resumo: string }[];
  totais?: {
    propostas: number;
    pendentes: number;
    aceitas: number;
    recusadas: number;
  };
};

export const CERTEZA_LABEL: Record<Certeza, string> = {
  alta: "Confiança alta",
  media: "Confiança média",
  baixa: "Confiança baixa",
};

export function subscribePropostas(
  sectors: string[],
  onData: (p: Proposta[]) => void,
  onError?: (e: FirestoreError) => void,
): () => void {
  if (sectors.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "demandPropostas"),
      where("sectorAlvo", "in", sectors.slice(0, 30)),
    ),
    (snap) => {
      onData(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Proposta, "id">) })),
      );
    },
    onError,
  );
}

export function subscribeLotes(
  sectors: string[],
  onData: (l: Lote[]) => void,
  onError?: (e: FirestoreError) => void,
): () => void {
  if (sectors.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "demandLotes"),
      where("sectorReuniao", "in", sectors.slice(0, 30)),
    ),
    (snap) => {
      onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Lote, "id">) })));
    },
    onError,
  );
}

export type Edicao = {
  title?: string;
  description?: string;
  type?: string;
  priority?: string;
  columnId?: string;
  tags?: string[];
  checklist?: { text: string; desc?: string }[];
};

/** Aceitar ou recusar. Devolve o id do card quando a proposta é aceita. */
export async function decidirProposta(args: {
  propostaId: string;
  decisao: "aceitar" | "recusar";
  motivo?: string;
  edicao?: Edicao;
}): Promise<{ status: string; cardId?: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const token = await user.getIdToken();

  const r = await fetch("/api/demandas/decidir", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });
  const body = (await r.json().catch(() => ({}))) as {
    error?: string;
    status?: string;
    cardId?: string;
  };
  if (!r.ok) throw new Error(body.error || "Não foi possível registrar a decisão.");
  return { status: body.status ?? "", cardId: body.cardId };
}
