export type DriveResult = { id: string; webViewLink?: string; name?: string };

/**
 * Envia um áudio para o Drive Compartilhado.
 * 1) pede ao servidor uma sessão de upload (a chave da conta de serviço fica no servidor);
 * 2) envia os bytes direto ao Google (aguenta arquivos grandes) com progresso.
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
    headers: { "Content-Type": "application/json" },
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
