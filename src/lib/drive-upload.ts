import { auth } from "./firebase";

export type DriveResult = { id: string; webViewLink?: string; name?: string };

export type DriveCheck = {
  ok: boolean;
  serviceAccount?: string;
  folderName?: string;
  folderId?: string;
  sharedDrive?: boolean;
  canWrite?: boolean;
  hint?: string;
  error?: string;
};

async function authHeader(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Sessão expirada. Entre novamente.");
  return { Authorization: `Bearer ${t}` };
}

/** Diagnóstico da ligação com o Drive (apenas admin). */
export async function checkDrive(): Promise<DriveCheck> {
  const res = await fetch("/api/drive/check", { headers: await authHeader() });
  return (await res.json()) as DriveCheck;
}

export type SyncResult = { checked: number; updated: number };

/**
 * Pede ao servidor para conferir no Drive quais áudios o Cowork já processou
 * (renomeou com "Transcrito") e refletir isso nas reuniões. O snapshot do
 * Firestore atualiza a tela sozinho quando algo muda.
 */
export async function syncDrive(): Promise<SyncResult> {
  const res = await fetch("/api/drive/sync", { headers: await authHeader() });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || "Falha ao verificar o processamento no Drive.");
  }
  return (await res.json()) as SyncResult;
}

// ---------------------------------------------------------------------------
// protocolo retomável do Google Drive
//
// O envio é feito em blocos: cada PUT leva um `Content-Range`. Enquanto a
// reunião está acontecendo o tamanho final é desconhecido, então usamos
// `bytes X-Y/*`; o último bloco leva o total real e fecha o arquivo, e o Drive
// responde 200 com o id. Assim o áudio chega ao servidor do Google DURANTE a
// gravação, e uma interrupção só custa o trecho ainda não confirmado.
// ---------------------------------------------------------------------------

/** Resultado de um bloco: incompleto (com offset), concluído ou sessão expirada. */
export type ChunkOutcome =
  | { state: "incomplete"; confirmedBytes: number }
  | { state: "complete"; file: DriveResult }
  | { state: "expired" };

/** Abre a sessão de upload; o servidor cuida da pasta e das permissões. */
export async function createUploadSession(params: {
  name: string;
  mimeType: string;
  sector: string;
  recordingId?: string;
  /** o que o usuário pediu gerar — vira a etiqueta smGerar no arquivo do Drive */
  outputs?: string[];
  /**
   * Instruções de quem enviou, para a IA seguir. Vira a `description` do
   * arquivo no Drive — que é onde o Cowork consegue lê-las, já que ele não
   * fala com o Firestore.
   */
  observacoes?: string;
}): Promise<{ uploadUrl: string; folderId?: string }> {
  const res = await fetch("/api/drive/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || "Falha ao preparar o upload no Drive.");
  }
  return (await res.json()) as { uploadUrl: string; folderId?: string };
}

/** Pergunta ao Google quantos bytes ele realmente tem (ver rota upload-status). */
export async function queryOffset(
  sessionUri: string,
  totalBytes: number | null,
): Promise<ChunkOutcome> {
  const res = await fetch("/api/drive/upload-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ sessionUri, totalBytes }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || "Falha ao consultar o envio no Drive.");
  }
  return (await res.json()) as ChunkOutcome;
}

function contentRange(start: number, size: number, total: number | null): string {
  const end = start + size - 1;
  return `bytes ${start}-${end}/${total === null ? "*" : total}`;
}

/**
 * Envia um bloco direto ao Google.
 *
 * Lança `CorsBlockedError` se o navegador barrar o `Content-Range` no preflight;
 * o `UploadManager` reage ligando o modo proxy.
 */
export class CorsBlockedError extends Error {}

export async function putChunkDirect(
  sessionUri: string,
  blob: Blob,
  start: number,
  total: number | null,
): Promise<ChunkOutcome> {
  let res: Response;
  try {
    res = await fetch(sessionUri, {
      method: "PUT",
      headers: { "Content-Range": contentRange(start, blob.size, total) },
      body: blob,
    });
  } catch (e) {
    // Um preflight barrado chega aqui como TypeError, igual a uma queda de
    // rede. Quem distingue os dois é o UploadManager: se estamos online e a
    // primeira tentativa falhou assim, tratamos como bloqueio de CORS.
    throw new CorsBlockedError(
      e instanceof Error ? e.message : "Falha de rede no envio ao Drive.",
    );
  }

  if (res.status === 308) {
    // Sem CORS para ler o header `Range`, seguimos com o offset otimista; o
    // valor real é reconciliado via queryOffset() sempre que algo falha.
    return { state: "incomplete", confirmedBytes: start + blob.size };
  }
  if (res.ok) {
    const file = (await res.json().catch(() => ({}))) as DriveResult;
    return { state: "complete", file };
  }
  if (res.status === 404 || res.status === 410) return { state: "expired" };

  throw new Error(`Falha no envio ao Drive (${res.status}).`);
}

/** Mesma operação, porém repassada pelo nosso servidor (contorna CORS). */
export async function putChunkProxied(
  sessionUri: string,
  blob: Blob,
  start: number,
  total: number | null,
): Promise<ChunkOutcome> {
  const res = await fetch("/api/drive/upload-chunk", {
    method: "POST",
    headers: {
      ...(await authHeader()),
      "Content-Type": "application/octet-stream",
      "x-session-uri": sessionUri,
      "x-content-range": contentRange(start, blob.size, total),
    },
    body: blob,
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Falha no envio ao Drive (${res.status}).`);
  }
  return (await res.json()) as ChunkOutcome;
}

/** Renomeia o arquivo quando o usuário confirma o título definitivo. */
export async function renameDriveFile(
  fileId: string,
  name: string,
  sector: string,
  /** Gravação pelo microfone: a sessão de upload abriu antes de o usuário ter
   *  escrito as observações, então elas chegam ao arquivo neste momento. */
  observacoes?: string,
): Promise<DriveResult> {
  const res = await fetch("/api/drive/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ fileId, name, sector, observacoes }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || "Falha ao renomear o arquivo no Drive.");
  }
  return (await res.json()) as DriveResult;
}
