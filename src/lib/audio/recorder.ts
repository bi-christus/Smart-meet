/**
 * Camada de captura — MediaRecorder endurecido.
 *
 * Diferenças em relação a uma gravação ingênua:
 *  - `start(TIMESLICE)`: o áudio sai do MediaRecorder de 5 em 5 segundos e vai
 *    direto para o disco. Nada se acumula na RAM, então uma queda de energia
 *    custa no máximo o último pedaço não confirmado.
 *  - Opus 32 kbps mono (~14 MB/h) com negociação de formato — arquivo 4x menor
 *    significa upload 4x mais curto e muito menos exposição a falha de rede.
 *  - Wake Lock para o computador não dormir no meio da reunião.
 *  - Encerramento seguro: se o MediaRecorder falha ou o microfone é
 *    desconectado, a gravação é FECHADA (não reiniciada). Recriar o recorder
 *    injetaria um segundo cabeçalho WebM no meio do arquivo e tornaria ilegível
 *    todo o áudio posterior — então, em vez disso, fechamos o arquivo já válido,
 *    o entregamos para envio e avisamos o usuário para iniciar outra gravação.
 *  - Medidor de nível real, que também serve para detectar "gravando silêncio".
 */

import { appendChunk, type RecordingRecord } from "./recording-db";

/** Intervalo entre pedaços. Também é a perda máxima num desligamento abrupto. */
export const TIMESLICE_MS = 5000;
/** Opus mono a 32 kbps: qualidade de voz excelente, ~14 MB por hora. */
export const AUDIO_BITS_PER_SECOND = 32000;
/** Tempo de silêncio contínuo que dispara o alerta de microfone mudo. */
const SILENCE_ALERT_MS = 30000;
/** Abaixo disso consideramos que não há voz (0–1). */
const SILENCE_THRESHOLD = 0.012;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export type RecorderEvents = {
  /** um pedaço acabou de ser confirmado no disco */
  onChunk?: (rec: RecordingRecord) => void;
  /** nível do microfone (0–1), ~15x por segundo */
  onLevel?: (level: number) => void;
  /** silêncio prolongado — provável microfone errado */
  onSilence?: (silent: boolean) => void;
  /** problema recuperável já tratado (só para avisar na tela) */
  onWarning?: (message: string) => void;
  /**
   * A captura terminou de forma involuntária (microfone caiu, gravador falhou
   * ou disco cheio). O áudio já gravado é válido e deve ser finalizado/enviado;
   * quem escuta encerra a gravação e mostra o aviso.
   */
  onInterrupted?: (message: string) => void;
};

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  } catch {
    return [];
  }
}

export class AudioRecorder {
  readonly recordingId: string;
  readonly mimeType: string;

  private events: RecorderEvents;
  private deviceId?: string;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private startedAt = 0;
  private silentSince: number | null = null;
  private silentNotified = false;
  private stopping = false;
  private interrupted = false;
  /** encadeia as escritas para os pedaços chegarem ao disco em ordem */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(
    recordingId: string,
    mimeType: string,
    events: RecorderEvents = {},
    deviceId?: string,
  ) {
    this.recordingId = recordingId;
    this.mimeType = mimeType;
    this.events = events;
    this.deviceId = deviceId;
  }

  /** Milissegundos decorridos — por timestamp, imune ao throttle de aba em segundo plano. */
  elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Este navegador não suporta gravação de áudio.");
    }
    this.stream = await this.openStream();
    this.startedAt = Date.now();
    this.attachRecorder();
    this.attachMeter(this.stream);
    void this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Encerra e devolve a duração real da gravação. */
  async stop(): Promise<number> {
    if (this.stopping) return this.elapsedMs();
    this.stopping = true;
    document.removeEventListener("visibilitychange", this.onVisibility);

    const duration = this.elapsedMs();
    const rec = this.recorder;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.addEventListener("stop", () => resolve(), { once: true });
        try {
          rec.stop();
        } catch {
          resolve();
        }
      });
    }
    // garante que o último `dataavailable` chegou ao disco antes de prosseguir
    await this.writeChain;
    this.teardown();
    return duration;
  }

  /** Libera microfone, medidor e wake lock sem esperar pelo disco. */
  dispose(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stopping = true;
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      /* já parado */
    }
    this.teardown();
  }

  // -------------------------------------------------------------------------
  // interno
  // -------------------------------------------------------------------------

  private openStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  private attachRecorder(): void {
    if (!this.stream) return;
    const rec = new MediaRecorder(this.stream, {
      ...(this.mimeType ? { mimeType: this.mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });

    rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      // serializa as escritas: cada pedaço só entra depois do anterior, o que
      // mantém os offsets de bytes coerentes com a ordem do áudio
      this.writeChain = this.writeChain
        .then(() => appendChunk(this.recordingId, e.data))
        .then((updated) => {
          if (updated) this.events.onChunk?.(updated);
        })
        .catch((err) => {
          console.error("Falha ao gravar pedaço no disco:", err);
          void this.interrupt(
            "Não foi possível salvar mais áudio no disco (espaço esgotado). " +
              "A gravação foi encerrada e o áudio já salvo está sendo enviado.",
          );
        });
    };

    rec.onerror = () => {
      void this.interrupt(
        "O gravador falhou. A gravação foi encerrada e o áudio já salvo está sendo enviado.",
      );
    };

    // microfone arrancado / dispositivo trocado pelo sistema
    this.stream.getAudioTracks().forEach((t) => {
      t.onended = () => {
        void this.interrupt(
          "O microfone foi desconectado. A gravação foi encerrada e o áudio já salvo está sendo enviado. Inicie uma nova gravação para continuar.",
        );
      };
    });

    rec.start(TIMESLICE_MS);
    this.recorder = rec;
  }

  /**
   * Encerra a captura de forma involuntária, preservando o áudio já gravado.
   *
   * NÃO recriamos o recorder: um novo MediaRecorder escreveria outro cabeçalho
   * WebM no meio do arquivo, corrompendo todo o áudio posterior. Em vez disso
   * paramos o recorder (o que fecha um arquivo VÁLIDO), esperamos o último
   * pedaço chegar ao disco e avisamos quem escuta para finalizar e enviar.
   */
  private async interrupt(message: string): Promise<void> {
    if (this.stopping || this.interrupted) return;
    this.interrupted = true;
    this.stopping = true;
    document.removeEventListener("visibilitychange", this.onVisibility);

    const rec = this.recorder;
    if (rec && rec.state !== "inactive") {
      // o 'dataavailable' final dispara antes do 'stop', então o último pedaço
      // já estará encadeado em writeChain quando aguardarmos por ele abaixo
      await new Promise<void>((resolve) => {
        rec.addEventListener("stop", () => resolve(), { once: true });
        try {
          rec.stop();
        } catch {
          resolve();
        }
      });
    }
    await this.writeChain;
    this.teardown();
    this.events.onInterrupted?.(message);
  }

  private attachMeter(stream: MediaStream): void {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      this.audioCtx = ctx;
      this.analyser = analyser;

      const buf = new Float32Array(analyser.fftSize);
      this.levelTimer = window.setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        this.events.onLevel?.(Math.min(1, rms * 4));
        this.trackSilence(rms);
      }, 66);
    } catch {
      // medidor é enfeite útil, não pode derrubar a gravação
    }
  }

  private trackSilence(rms: number): void {
    const now = Date.now();
    if (rms >= SILENCE_THRESHOLD) {
      this.silentSince = null;
      if (this.silentNotified) {
        this.silentNotified = false;
        this.events.onSilence?.(false);
      }
      return;
    }
    if (this.silentSince === null) {
      this.silentSince = now;
    } else if (!this.silentNotified && now - this.silentSince >= SILENCE_ALERT_MS) {
      this.silentNotified = true;
      this.events.onSilence?.(true);
    }
  }

  private detachMeter(): void {
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    this.analyser = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  private async acquireWakeLock(): Promise<void> {
    if (!navigator.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      // negado (aba oculta, bateria fraca) — só perdemos a proteção contra sleep
    }
  }

  /** O wake lock cai quando a aba fica oculta; recuperamos ao voltar. */
  private onVisibility = (): void => {
    if (document.visibilityState === "visible" && !this.stopping) {
      void this.acquireWakeLock();
    }
  };

  private teardown(): void {
    this.detachMeter();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}
