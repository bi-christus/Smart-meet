"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRecorder, type FinishResult } from "./use-recorder";

/**
 * Sobe a gravação para o SHELL do app (não mais para a tela de Reuniões), para
 * que o usuário possa trocar de aba e usar o sistema inteiro sem parar de gravar
 * — a captura continua e aparece num mini player flutuante.
 */

type RecorderApi = ReturnType<typeof useRecorder>;

type RecordingContextValue = Omit<RecorderApi, "stop"> & {
  stop: () => Promise<FinishResult | null>;
  /** resultado do último encerramento — a tela de Reuniões abre o modal com ele */
  pendingConfirm: FinishResult | null;
  clearPendingConfirm: () => void;
};

const Ctx = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({
  ownerEmail,
  children,
}: {
  ownerEmail: string;
  children: React.ReactNode;
}) {
  const rec = useRecorder(ownerEmail);
  const [pendingConfirm, setPendingConfirm] = useState<FinishResult | null>(
    null,
  );

  const recStop = rec.stop;
  const stop = useCallback(async () => {
    const done = await recStop();
    if (done) setPendingConfirm(done);
    return done;
  }, [recStop]);

  // Aviso ao fechar/recarregar a aba com o microfone aberto — agora em qualquer
  // página, já que a gravação vive no shell.
  const recording = rec.state.recording;
  useEffect(() => {
    if (!recording) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [recording]);

  const value: RecordingContextValue = {
    ...rec,
    stop,
    pendingConfirm,
    clearPendingConfirm: () => setPendingConfirm(null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecording(): RecordingContextValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useRecording precisa estar dentro de <RecordingProvider>");
  }
  return v;
}
