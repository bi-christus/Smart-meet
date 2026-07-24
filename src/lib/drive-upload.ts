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

/**
 * Envia um áudio para o Drive.
 * 1) o servidor confere quem é você, garante a pasta /{setor}/{seu e-mail}
 *    com as permissões certas e devolve uma sessão de upload;
 * 2) o navegador envia os bytes direto ao Google, com progresso.
 */
export async function uploadAudioToDrive(
  blob: Blob,
  filename: string,
  sector: string,
  onProgress?: (fraction: number) => void,
): Promise<DriveResult> {
  const mimeType = blob.type || "audio/webm";

  const res = await fetch("/api/drive/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ name: filename, mimeType, sector }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || "Falha ao preparar o upload no Drive");
  }
  const { uploadUrl } = (await res.json()) as { uploadUrl: string };

  return await new Promise<DriveResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as DriveResult);
        } catch {
          resolve({ id: "" });
        }
      } else {
        reject(new Error("Falha no envio ao Drive (" + xhr.status + ")"));
      }
    };
    xhr.onerror = () => reject(new Error("Falha de rede no envio ao Drive"));
    xhr.send(blob);
  });
}
