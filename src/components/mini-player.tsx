"use client";

import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { useRecording } from "@/lib/audio/recording-context";
import styles from "./mini-player.module.css";

function fmtTimer(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Mostra a gravação em andamento quando o usuário está em outra aba do sistema.
 * Na própria tela de Reuniões o painel completo já cuida disso, então some.
 */
export function MiniPlayer() {
  const { state, stop, pause, resume } = useRecording();
  const router = useRouter();
  const pathname = usePathname();

  if (!state.recording || pathname === "/reunioes") return null;

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <button
        className={styles.face}
        onClick={() => router.push("/reunioes")}
        title="Abrir na aba Reuniões"
      >
        <span
          className={`${styles.dot} ${state.paused ? styles.dotPaused : ""}`}
        />
        <span className={styles.info}>
          <span className={styles.label}>
            {state.paused ? "Pausado" : "Gravando"}
          </span>
          <span className={styles.time}>{fmtTimer(state.elapsedMs)}</span>
        </span>
      </button>
      <div className={styles.controls}>
        <button
          className={styles.ctrl}
          onClick={state.paused ? resume : pause}
          title={state.paused ? "Retomar" : "Pausar"}
        >
          <Icon name={state.paused ? "play" : "pause"} size={16} />
        </button>
        <button
          className={`${styles.ctrl} ${styles.stop}`}
          onClick={async () => {
            await stop();
            router.push("/reunioes");
          }}
          title="Parar e enviar"
        >
          <Icon name="stop" size={15} />
        </button>
      </div>
    </div>
  );
}
