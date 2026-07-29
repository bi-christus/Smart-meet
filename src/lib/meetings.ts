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

export type MeetingStatus = "aguardando" | "processando" | "processado";
export type ReportStatus = "rascunho" | "a_validar" | "validada";
export type SendMethod = "file" | "mic" | "online";
/**
 * O que a IA gera a partir da transcrição (Fase 4). É uma multi-seleção: por
 * padrão vem só "resumo" (pontos importantes); as atas são opcionais.
 */
export type OutputKind = "resumo" | "detalhada" | "didatica";

/**
 * Arquivos que o processador externo (Cowork) gera na pasta do Drive e que o
 * app apenas LÊ e linka — ele não faz a IA, só reflete o resultado.
 */
export type DriveOutputKind =
  | "transcricao"
  | "resumo"
  | "detalhada"
  | "didatica";
export type DriveOutput = { kind: DriveOutputKind; name: string; link: string };

export const DRIVE_OUTPUT_LABEL: Record<DriveOutputKind, string> = {
  transcricao: "Transcrição",
  resumo: "Pontos importantes",
  detalhada: "Ata detalhada",
  didatica: "Ata didática",
};

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  aguardando: "Aguardando",
  processando: "Processando",
  processado: "Processado",
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  rascunho: "Rascunho",
  a_validar: "A validar",
  validada: "Validada",
};

export const SEND_LABEL: Record<SendMethod, string> = {
  file: "arquivo",
  mic: "microfone",
  online: "online",
};

/**
 * Estado do áudio no caminho até o Drive. Fica no Firestore (e não só no
 * navegador) para que uma gravação interrompida apareça na esteira de qualquer
 * dispositivo — inclusive para o gestor — em vez de sumir em silêncio.
 */
export type UploadStatus = "gravando" | "enviando" | "concluido" | "falha";

export const UPLOAD_STATUS_LABEL: Record<UploadStatus, string> = {
  gravando: "Gravando",
  enviando: "Enviando áudio",
  concluido: "Áudio salvo",
  falha: "Envio interrompido",
};

export type Meeting = {
  id: string;
  title: string;
  sector: string;
  date: string; // yyyy-mm-dd
  participants: string[]; // e-mails
  status: MeetingStatus;
  send?: SendMethod;
  output?: OutputKind[];
  durationMin?: number;
  driveFileId?: string | null;
  driveLink?: string | null;
  /** arquivos gerados pelo Cowork na pasta do Drive (transcrição, ata, relatório) */
  driveOutputs?: DriveOutput[];
  transcript?: string;
  ata?: string;
  reportStatus?: ReportStatus;
  createdBy?: string;
  /** id da gravação no IndexedDB do navegador que a originou */
  recordingId?: string | null;
  uploadStatus?: UploadStatus;
  uploadedBytes?: number;
  totalBytes?: number;
  uploadError?: string | null;
};

export type MeetingInput = {
  title: string;
  sector: string;
  date: string;
  participants: string[];
  send: SendMethod;
  output: OutputKind[];
  durationMin?: number;
  driveFileId?: string | null;
  driveLink?: string | null;
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
    query(
      collection(db, "meetings"),
      where("sector", "in", sectors.slice(0, 30)),
    ),
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
): Promise<string> {
  const ref = await addDoc(collection(db, "meetings"), {
    title: input.title.trim(),
    sector: input.sector,
    date: input.date,
    participants: input.participants,
    status: "aguardando" as MeetingStatus,
    send: input.send,
    output: input.output,
    durationMin: input.durationMin ?? null,
    driveFileId: input.driveFileId ?? null,
    driveLink: input.driveLink ?? null,
    transcript: "",
    ata: "",
    reportStatus: "rascunho" as ReportStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/**
 * Cria o registro da reunião no INÍCIO da gravação, com título provisório.
 *
 * Antecipar isso é uma proteção: se a máquina desligar no meio, a reunião já
 * existe na esteira com `uploadStatus` pendente, então ninguém depende de
 * lembrar que havia uma gravação em andamento. O modal de confirmação depois
 * só completa os dados via `updateMeeting`.
 */
export async function createMeetingDraft(
  input: {
    title: string;
    sector: string;
    date: string;
    send: SendMethod;
    output: OutputKind[];
    recordingId: string;
  },
  createdBy: string,
): Promise<string> {
  const ref = await addDoc(collection(db, "meetings"), {
    title: input.title.trim(),
    sector: input.sector,
    date: input.date,
    participants: [],
    status: "aguardando" as MeetingStatus,
    send: input.send,
    output: input.output,
    durationMin: null,
    driveFileId: null,
    driveLink: null,
    transcript: "",
    ata: "",
    reportStatus: "rascunho" as ReportStatus,
    recordingId: input.recordingId,
    uploadStatus: "gravando" as UploadStatus,
    uploadedBytes: 0,
    totalBytes: 0,
    uploadError: null,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/** Espelha o progresso do envio. Campos `undefined` são ignorados. */
export async function patchMeetingUpload(
  id: string,
  patch: {
    uploadStatus?: UploadStatus;
    uploadedBytes?: number;
    totalBytes?: number;
    driveFileId?: string | null;
    driveLink?: string | null;
    uploadError?: string | null;
    durationMin?: number;
  },
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  if (!Object.keys(clean).length) return;
  await updateDoc(doc(db, "meetings", id), clean);
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
