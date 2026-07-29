"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createMeetingDraft, type OutputKind } from "../meetings";
import {
  createRecording,
  deleteRecording,
  getRecording,
  newRecordingId,
  requestPersistence,
  storageWarning,
  type RecordingRecord,
} from "./recording-db";
import {
  AudioRecorder,
  AUDIO_BITS_PER_SECOND,
  listMicrophones,
  pickMimeType,
} from "./recorder";
import { uploadManager } from "./uploader";

export type RecorderState = {
  recording: boolean;
  elapsedMs: number;
  level: number;
  silent: boolean;
  warning: string | null;
  error: string | null;
  bytesWritten: number;
  uploadedBytes: number;
  /** true enquanto o áudio ainda não chegou inteiro ao Drive */
  uploading: boolean;
  /** true quando a captura está pausada (mesmo arquivo, retomável) */
  paused: boolean;
};

const IDLE: RecorderState = {
  recording: false,
  elapsedMs: 0,
  level: 0,
  silent: false,
  warning: null,
  error: null,
  bytesWritten: 0,
  uploadedBytes: 0,
  uploading: false,
  paused: false,
};

export function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "audio";
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
}

function isoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type StartResult = { recordingId: string; meetingId: string | null };
export type FinishResult = {
  recordingId: string;
  meetingId: string | null;
  durationMin: number;
  title: string;
};

/**
 * Cola a captura, o disco e a bomba de envio numa API que a tela consome.
 * Nenhuma regra de durabilidade mora aqui — isto é só o fio condutor.
 */
export function useRecorder(ownerEmail: string) {
  const [state, setState] = useState<RecorderState>(IDLE);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");

  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const tickRef = useRef<number | null>(null);

  const patch = useCallback((p: Partial<RecorderState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  // lista de microfones (rótulos só aparecem depois da primeira permissão)
  useEffect(() => {
    let alive = true;
    const load = () => {
      void listMicrophones().then((d) => alive && setDevices(d));
    };
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, []);

  // progresso de envio da gravação corrente
  useEffect(
    () =>
      uploadManager.subscribe((rec: RecordingRecord) => {
        if (rec.id !== recordingIdRef.current) return;
        patch({
          uploadedBytes: rec.uploadedBytes,
          bytesWritten: rec.bytesWritten,
          uploading: rec.status !== "done",
          error: rec.error,
        });
        if (rec.status === "done") recordingIdRef.current = null;
      }),
    [patch],
  );

  // Sair da tela no meio da gravação NÃO pode perder áudio: encerramos a
  // captura e enviamos o que já foi gravado (arquivo válido) em vez de largar a
  // gravação em aberto. Num recarregar/fechar da aba, isto pode não chegar a
  // rodar — mas aí a trava de "gravação viva" cai e a próxima carga adota o
  // órfão. Nos dois caminhos o áudio se preserva.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      const recorder = recorderRef.current;
      const id = recordingIdRef.current;
      recorderRef.current = null;
      if (recorder && id) {
        void recorder
          .stop()
          .then((ms) => uploadManager.finishRecording(id, ms))
          .catch(() => {});
      } else {
        recorder?.dispose();
      }
    };
  }, []);

  const start = useCallback(
    async (opts: {
      sector: string;
      output: OutputKind[];
      titleHint?: string;
    }): Promise<StartResult> => {
      const mimeType = pickMimeType();
      const id = newRecordingId();
      const now = new Date();
      const title = opts.titleHint || `Gravação — ${stamp(now)}`;
      const driveName = `${title}.${extFromMime(mimeType)}`;

      await requestPersistence();
      // 1 h de reunião a 32 kbps ≈ 14 MB; avisamos se o disco estiver apertado
      const warn = await storageWarning((AUDIO_BITS_PER_SECOND / 8) * 3600);

      const rec = await createRecording({
        id,
        kind: "mic",
        sector: opts.sector,
        ownerEmail,
        title,
        driveName,
        mimeType,
        output: opts.output,
      });

      const recorder = new AudioRecorder(
        id,
        mimeType,
        {
          onChunk: (updated) => {
            patch({ bytesWritten: updated.bytesWritten });
            uploadManager.nudge(id);
          },
          onLevel: (level) => patch({ level }),
          onSilence: (silent) => patch({ silent }),
          onWarning: (warning) => patch({ warning }),
          onInterrupted: (message) => {
            // Captura encerrada involuntariamente: finaliza o que já foi gravado
            // (arquivo válido) e o entrega para envio; a tela volta ao estado
            // ocioso com o aviso. Nada de reiniciar — isso corromperia o WebM.
            const rid = recordingIdRef.current;
            if (tickRef.current) {
              clearInterval(tickRef.current);
              tickRef.current = null;
            }
            const durationMs = recorderRef.current?.elapsedMs() ?? 0;
            recorderRef.current = null;
            recordingIdRef.current = null;
            patch({
              recording: false,
              paused: false,
              level: 0,
              silent: false,
              warning: message,
            });
            if (rid) void uploadManager.finishRecording(rid, durationMs);
          },
        },
        deviceId || undefined,
      );

      try {
        await recorder.start();
      } catch (e) {
        await deleteRecording(id);
        throw new Error(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Permissão de microfone negada. Libere o acesso no navegador e tente novamente."
            : "Não foi possível acessar o microfone. Verifique se outro programa está usando o dispositivo.",
        );
      }

      recorderRef.current = recorder;
      recordingIdRef.current = id;
      // Esta aba passa a ser a dona da gravação: enquanto ela viver, nenhuma
      // outra aba deve adotar este registro como órfão.
      uploadManager.markRecording(id);
      setState({
        ...IDLE,
        recording: true,
        uploading: true,
        warning: warn,
      });

      tickRef.current = window.setInterval(() => {
        // por timestamp: não sofre com o throttle de aba em segundo plano
        patch({ elapsedMs: recorder.elapsedMs() });
      }, 500);

      // A rede vem depois do microfone: gravar nunca pode esperar por servidor.
      let meetingId: string | null = null;
      try {
        meetingId = await createMeetingDraft(
          {
            title,
            sector: opts.sector,
            date: isoDate(now),
            send: "mic",
            output: opts.output,
            recordingId: id,
          },
          ownerEmail,
        );
        await uploadManager.linkMeeting(id, meetingId);
      } catch (e) {
        console.warn("Não foi possível registrar a reunião agora:", e);
      }
      try {
        await uploadManager.openSession({ ...rec, meetingId });
      } catch (e) {
        // Sem sessão o áudio continua indo para o disco; a bomba abre outra
        // assim que a rede voltar.
        console.warn("Sessão de upload será aberta mais tarde:", e);
      }

      return { recordingId: id, meetingId };
    },
    [deviceId, ownerEmail, patch],
  );

  const stop = useCallback(async (): Promise<FinishResult | null> => {
    const recorder = recorderRef.current;
    const id = recordingIdRef.current;
    if (!recorder || !id) return null;

    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const durationMs = await recorder.stop();
    recorderRef.current = null;
    patch({
      recording: false,
      paused: false,
      level: 0,
      silent: false,
      elapsedMs: durationMs,
    });

    await uploadManager.finishRecording(id, durationMs);
    const rec = await getRecording(id);
    return {
      recordingId: id,
      meetingId: rec?.meetingId ?? null,
      durationMin: Math.max(1, Math.round(durationMs / 60000)),
      title: rec?.title ?? "",
    };
  }, [patch]);

  const pause = useCallback(() => {
    recorderRef.current?.pause();
    patch({ paused: true, level: 0 });
  }, [patch]);

  const resume = useCallback(() => {
    recorderRef.current?.resume();
    patch({ paused: false });
  }, [patch]);

  /** Envia um arquivo escolhido pelo usuário pela mesma esteira retomável. */
  const startFileUpload = useCallback(
    async (
      file: File,
      opts: { sector: string; output: OutputKind[]; title: string },
    ): Promise<StartResult> => {
      const id = newRecordingId();
      const mimeType = file.type || "application/octet-stream";
      const ext = file.name.includes(".")
        ? file.name.split(".").pop()!
        : extFromMime(mimeType);
      const driveName = `${opts.title}.${ext}`;

      await requestPersistence();
      const rec = await createRecording({
        id,
        kind: "file",
        sector: opts.sector,
        ownerEmail,
        title: opts.title,
        // o modal já coletou o título definitivo antes de chamar isto
        titleConfirmed: true,
        driveName,
        mimeType,
        output: opts.output,
        status: "uploading",
        file,
        bytesWritten: file.size,
        totalBytes: file.size,
        stoppedAt: Date.now(),
      });

      recordingIdRef.current = id;
      patch({ uploading: true, bytesWritten: file.size, uploadedBytes: 0 });

      let meetingId: string | null = null;
      try {
        meetingId = await createMeetingDraft(
          {
            title: opts.title,
            sector: opts.sector,
            date: isoDate(),
            send: "file",
            output: opts.output,
            recordingId: id,
          },
          ownerEmail,
        );
        await uploadManager.linkMeeting(id, meetingId);
      } catch (e) {
        console.warn("Não foi possível registrar a reunião agora:", e);
      }
      try {
        await uploadManager.openSession({ ...rec, meetingId });
      } catch (e) {
        console.warn("Sessão de upload será aberta mais tarde:", e);
      }
      uploadManager.nudge(id);

      return { recordingId: id, meetingId };
    },
    [ownerEmail, patch],
  );

  const dismissWarning = useCallback(() => patch({ warning: null }), [patch]);

  return {
    state,
    devices,
    deviceId,
    setDeviceId,
    start,
    stop,
    pause,
    resume,
    startFileUpload,
    dismissWarning,
  };
}
