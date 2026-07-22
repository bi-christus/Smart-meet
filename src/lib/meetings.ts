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

export type MeetingStatus = "aguardando" | "processado";
export type ReportStatus = "rascunho" | "a_validar" | "validada";

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  aguardando: "Aguardando",
  processado: "Processado",
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  rascunho: "Rascunho",
  a_validar: "A validar",
  validada: "Validada",
};

export type Meeting = {
  id: string;
  title: string;
  sector: string;
  date: string; // yyyy-mm-dd
  participants: string[]; // e-mails
  status: MeetingStatus;
  transcript?: string;
  ata?: string;
  reportStatus?: ReportStatus;
  createdBy?: string;
};

export type MeetingInput = {
  title: string;
  sector: string;
  date: string;
  participants: string[];
};

export function subscribeMeetings(
  sectors: string[],
  onData: (meetings: Meeting[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (sectors.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, "meetings"), where("sector", "in", sectors.slice(0, 30))),
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Meeting, "id">),
      }));
      list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      onData(list);
    },
    (e) => onError?.(e),
  );
}

export async function createMeeting(
  input: MeetingInput,
  createdBy: string,
): Promise<void> {
  await addDoc(collection(db, "meetings"), {
    title: input.title.trim(),
    sector: input.sector,
    date: input.date,
    participants: input.participants,
    status: "aguardando" as MeetingStatus,
    transcript: "",
    ata: "",
    reportStatus: "rascunho" as ReportStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
}

export async function updateMeeting(
  id: string,
  patch: Partial<Omit<Meeting, "id">>,
): Promise<void> {
  await updateDoc(doc(db, "meetings", id), patch);
}

export async function deleteMeetingById(id: string): Promise<void> {
  await deleteDoc(doc(db, "meetings", id));
}
