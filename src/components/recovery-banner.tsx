"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import {
  fmtBytes,
  listUnfinished,
  type RecordingRecord,
} from "@/lib/audio/recording-db";
import { uploadManager } from "@/lib/audio/uploader";
import { registerUploadWorker } from "@/lib/audio/sw-register";
import { baixarCopiaLocal } from "@/lib/audio/baixar-copia";
import { useEnvios } from "@/lib/audio/envio-context";
import styles from "./recovery-banner.module.css";

/**
 * Rede de segurança visível.
 *
 * Fica montada no shell do app (não só na tela de reuniões) por três motivos:
 *  1. liga a bomba de envio, para o upload continuar mesmo se o usuário sair da
 *     tela de reuniões e for para o Kanban;
 *  2. registra o service worker, que segue enviando com a aba fechada (só no
 *     Chrome e no Edge, e só com o navegador aberto — ver `public/sw.js`);
 *  3. mostra o que ficou pela metade — uma gravação interrompida nunca some em
 *     silêncio, e o usuário sempre tem como baixar uma cópia local.
 *
 * O que o painel do envio (#250) já mostra fica FORA daqui: o mesmo áudio em
 * dois lugares, um deles em amarelo de alerta, faria um envio que está
 * andando parecer um problema. Sobra para a faixa o que o painel não conhece —
 * as falhas antigas e o que ficou parado de outra sessão.
 */
export function RecoveryBanner() {
  const { acompanha } = useEnvios();
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
  //
  // O RECUSADO NÃO CONTA: o servidor não vai aceitar aquele arquivo, e o
  // aviso prenderia a pessoa no site por um envio que não vai acontecer —
  // toda vez que ela tentasse sair, até lembrar de descartar.
  const prendem = pending.filter((r) => !r.recusado).length;
  useEffect(() => {
    if (!prendem) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [prendem]);

  async function download(rec: RecordingRecord) {
    setBusy(rec.id);
    try {
      await baixarCopiaLocal(rec);
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
  const stalled = pending.filter(
    (r) => r.status !== "recording" && !acompanha(r.id),
  );
  if (!stalled.length) return null;

  const recusados = stalled.filter((r) => r.recusado).length;
  const naoChegaram = stalled.length - recusados;

  return (
    <div className={styles.wrap} role="status">
      <div className={styles.icon}>
        <Icon name="shield" size={17} />
      </div>
      <div className={styles.body}>
        <div className={styles.title}>
          {naoChegaram === 0
            ? recusados === 1
              ? "1 arquivo não foi aceito"
              : `${recusados} arquivos não foram aceitos`
            : naoChegaram === 1
              ? "1 gravação ainda não chegou inteira ao Drive"
              : `${naoChegaram} gravações ainda não chegaram inteiras ao Drive`}
        </div>
        {/* A frase antiga — "o envio continua sozinho, você não precisa fazer
            nada" — convidava a fechar o site, e fechar PARA o envio no Firefox
            e no Safari (o service worker só segue no Chrome e no Edge, e só
            com o navegador aberto). Quem lia aquilo e fechava achava que o
            áudio tinha chegado. */}
        <div className={styles.sub}>
          {naoChegaram === 0
            ? "O servidor recusou o arquivo pelo que ele é. Descarte e envie o áudio certo — o original continua no seu computador."
            : "O áudio está salvo neste computador. Deixe o site aberto para o envio continuar — se fechar, ele retoma quando você voltar."}
        </div>

        <ul className={styles.list}>
          {stalled.map((r) => {
            const total = r.totalBytes ?? r.bytesWritten;
            const pct = total ? Math.min(100, Math.round((r.uploadedBytes / total) * 100)) : 0;
            return (
              <li key={r.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <span className={styles.itemName}>{r.title}</span>
                  <span className={styles.itemMeta} title={r.recusado ? (r.error ?? undefined) : undefined}>
                    {fmtBytes(total)} ·{" "}
                    {r.recusado
                      ? "este arquivo não foi aceito: descarte e envie o áudio certo"
                      : r.status === "failed"
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
                  {/* Recusado pelo servidor (não é áudio): tentar de novo não
                      faz nada, e o botão prometeria o contrário. */}
                  {r.status === "failed" && !r.recusado && (
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
