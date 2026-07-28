"use client";

import { uploadManager } from "./uploader";

const SYNC_TAG = "smartmeet-upload";

let registration: ServiceWorkerRegistration | null = null;
let wired = false;

type SyncManagerLike = { register: (tag: string) => Promise<void> };

function syncManager(
  reg: ServiceWorkerRegistration | null,
): SyncManagerLike | null {
  const sync = (reg as unknown as { sync?: SyncManagerLike })?.sync;
  return sync ?? null;
}

/**
 * Registra o worker que continua o envio com a aba fechada.
 *
 * Onde o Background Sync não existe (Firefox, Safari), isto vira um no-op
 * silencioso: o áudio continua no IndexedDB e o `UploadManager` retoma na
 * próxima abertura do sistema.
 */
export async function registerUploadWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (wired) return;
  wired = true;

  try {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  } catch (e) {
    console.warn("Envio em segundo plano indisponível:", e);
    return;
  }

  // o worker avisa quando avança para a interface atualizar o progresso
  navigator.serviceWorker.addEventListener("message", (event) => {
    if ((event.data as { type?: string })?.type === "smartmeet-progress") {
      void uploadManager.resumeAll();
    }
  });

  // Ao sair da página, passamos o bastão: o que faltar vai pelo worker.
  window.addEventListener("pagehide", () => {
    void requestBackgroundSync();
  });
}

/** Pede ao navegador para terminar o envio em segundo plano. */
export async function requestBackgroundSync(): Promise<boolean> {
  const reg = registration ?? (await navigator.serviceWorker?.ready.catch(() => null));
  const sync = syncManager(reg ?? null);
  if (!sync) return false;
  try {
    await sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}
