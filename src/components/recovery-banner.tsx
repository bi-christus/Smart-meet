"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import {
  assembleBlob,
  fmtBytes,
  listUnfinished,
  type RecordingRecord,
} from "@/lib/audio/recording-db";
import { uploadManager } from "@/lib/audio/uploader";
import { registerUploadWorker } from "@/lib/audio/sw-register";
import styles from "./recovery-banner.module.css";

/**
 * Rede de segurança visível.
 *
 * Fica montada no shell do app (não só na tela de reuniões) por três motivos:
 *  1. liga a bomba de envio, para o upload continuar mesmo se o usuário sair da
 *     tela de reuniões e for para o Kanban;
 *  2. registra o service worker, que segue enviando com a aba fechada;
 *  3. mostra o que ficou pela metade — uma gravação interrompida nunca some em
 *     silêncio, e o usuário sempre tem como baixar uma cópia local.
 */
export function RecoveryBanner() {
  const [items, setItems] = useState<RecordingRecord[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listUnfinished());
    } catch {
      // sem IndexedDB (aba anônima antiga, navegador exótico) não há o que mostrar
    }
  }, []);

  useEffect(() => {
    uploadManager.boot();
    void registerUploadWorker();
    const tick = () => void refresh();
    const unsubscribe = uploadManager.subscribe(tick);
    // a primeira leitura é só a primeira batida do mesmo relógio
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 5000);
    return () => {
      unsubscribe();
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  const pending = items.filter((r) => r.status !== "done");

  // Aviso ao fechar a aba enquanto há áudio sem confirmação do Drive. Nada se
  // perde se o usuário insistir — mas quase sempre ele não quer.
  useEffect(() => {
    if (!pending.length) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending.length]);

  async function download(rec: RecordingRecord) {
    setBusy(rec.id);
    try {
      const blob = await assembleBlob(rec);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = rec.driveName || `${rec.title}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      console.error(e);
      alert("Não foi possível montar o arquivo local.");
    } finally {
      setBusy(null);
    }
  }

  async function discard(rec: RecordingRecord) {
    const ok = window.confirm(
      `Descartar "${rec.title}"? O áudio guardado neste computador será apagado e não poderá ser recuperado.`,
    );
    if (!ok) return;
    await uploadManager.discard(rec.id);
    void refresh();
  }

  if (!pending.length || dismissed) return null;

  // gravações em andamento não são "pendências" — são o trabalho normal
  const stalled = pending.filter((r) => r.status !== "recording");
  if (!stalled.length) return null;

  return (
    <div className={styles.wrap} role="status">
      <div className={styles.icon}>
        <Icon name="shield" size={17} />
      </div>
      <div className={styles.body}>
        <div className={styles.title}>
          {stalled.length === 1
            ? "1 gravação ainda não chegou inteira ao Drive"
            : `${stalled.length} gravações ainda não chegaram inteiras ao Drive`}
        </div>
        <div className={styles.sub}>
          O áudio está salvo neste computador. O envio continua sozinho — você
          não precisa fazer nada.
        </div>

        <ul className={styles.list}>
          {stalled.map((r) => {
            const total = r.totalBytes ?? r.bytesWritten;
            const pct = total ? Math.min(100, Math.round((r.uploadedBytes / total) * 100)) : 0;
            return (
              <li key={r.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <span className={styles.itemName}>{r.title}</span>
                  <span className={styles.itemMeta}>
                    {fmtBytes(total)} ·{" "}
                    {r.status === "failed"
                      ? (r.error ?? "envio interrompido")
                      : `${pct}% enviado`}
                  </span>
                  <div className={styles.bar}>
                    <div
                      className={`${styles.fill} ${r.status === "failed" ? styles.fillBad : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className={styles.actions}>
                  {r.status === "failed" && (
                    <button
                      className={styles.btn}
                      onClick={() => void uploadManager.resumeAll()}
                    >
                      Tentar de novo
                    </button>
                  )}
                  <button
                    className={styles.btn}
                    onClick={() => void download(r)}
                    disabled={busy === r.id}
                  >
                    {busy === r.id ? "Montando…" : "Baixar cópia"}
                  </button>
                  <button
                    className={`${styles.btn} ${styles.btnBad}`}
                    onClick={() => void discard(r)}
                  >
                    Descartar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <button
        className={styles.close}
        onClick={() => setDismissed(true)}
        aria-label="Ocultar aviso"
      >
        ×
      </button>
    </div>
  );
}
