/**
 * Camada 2 — bomba de envio.
 *
 * Lê o áudio do IndexedDB e empurra para a sessão retomável do Drive em blocos
 * múltiplos de 256 KB, DURANTE a gravação. Regras que sustentam a garantia de
 * não perder áudio:
 *
 *  - o offset de verdade é o que o Google confirma; a cada falha reconciliamos
 *    com `queryOffset()` antes de reenviar qualquer coisa;
 *  - falha de rede nunca é definitiva: backoff exponencial e retomada nos
 *    eventos `online`, na volta da aba e na próxima abertura do sistema;
 *  - `navigator.locks` garante uma única bomba por gravação, mesmo com várias
 *    abas abertas e com o service worker ativo;
 *  - o áudio local só é apagado depois que o Drive devolve o id do arquivo.
 */

import {
  createUploadSession,
  putChunkDirect,
  putChunkProxied,
  queryOffset,
  renameDriveFile,
  CorsBlockedError,
  type ChunkOutcome,
} from "../drive-upload";
import { patchMeetingUpload } from "../meetings";
import {
  BLOCK_UNIT,
  deleteChunks,
  deleteRecording,
  getRecording,
  listAll,
  patchRecording,
  readTail,
  type RecordingRecord,
} from "./recording-db";

/** Teto por bloco no envio direto ao Google. */
const MAX_BLOCK_DIRECT = 32 * BLOCK_UNIT; // 8 MB
/** Teto no modo proxy — precisa caber no limite de corpo da Vercel (4,5 MB). */
const MAX_BLOCK_PROXY = 16 * BLOCK_UNIT; // 4 MB
/** Espera entre tentativas, em segundos. */
const BACKOFF_S = [1, 2, 4, 8, 15, 30];
/** Depois disto marcamos "falha" para o usuário agir — o áudio continua salvo. */
const MAX_ATTEMPTS = 12;
/** Intervalo mínimo entre gravações de progresso no Firestore. */
const FIRESTORE_THROTTLE_MS = 15000;
/** Prazo para o usuário confirmar o título antes de o registro ser descartado. */
const TITLE_GRACE_MS = 6 * 60 * 60 * 1000;
/**
 * Sem batida por mais que isto, uma gravação ainda marcada como "recording" é
 * tratada como órfã (a aba que a gravava morreu) e seu áudio é adotado para
 * envio. Os pedaços chegam ao disco a cada 5 s, então o limite fica muito acima
 * do intervalo normal — uma aba viva jamais é confundida com uma morta.
 */
const RECORDING_ORPHAN_MS = 90000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number): number {
  return BACKOFF_S[Math.min(attempt, BACKOFF_S.length - 1)] * 1000;
}

/** Roda `fn` com exclusividade entre abas e service worker. */
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) return fn();
  return (await navigator.locks.request(name, fn)) as T;
}

function hasWebLocks(): boolean {
  return typeof navigator !== "undefined" && !!navigator.locks?.request;
}

/**
 * true se NINGUÉM está segurando a trava de "gravação viva" — ou seja, a aba que
 * gravava sumiu (fechou, recarregou, travou) e o áudio ficou órfão. O gravador
 * segura essa trava enquanto captura (mesmo pausado); o navegador a solta quando
 * a aba morre.
 */
async function recLockFree(id: string): Promise<boolean> {
  if (!navigator.locks?.request) return false;
  try {
    return (await navigator.locks.request(
      `smartmeet-rec-${id}`,
      { ifAvailable: true },
      (lock) => lock !== null,
    )) as boolean;
  } catch {
    return false; // não deu para consultar → conservador: trata como viva
  }
}

function waitOnline(): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("online", done);
      resolve();
    };
    window.addEventListener("online", done);
    // rede pode voltar sem disparar o evento (VPN, troca de Wi-Fi)
    setTimeout(done, 15000);
  });
}

type Listener = (rec: RecordingRecord) => void;

class UploadManagerImpl {
  private pumping = new Set<string>();
  private listeners = new Set<Listener>();
  private lastFirestoreWrite = new Map<string, number>();
  private booted = false;
  /** gravação que ESTA aba está capturando agora (protegida da adoção de órfãs) */
  private activeRecordingId: string | null = null;

  // -------------------------------------------------------------------------
  // ciclo de vida
  // -------------------------------------------------------------------------

  /** Liga os gatilhos globais e retoma o que ficou pendente. Idempotente. */
  boot(): void {
    if (this.booted || typeof window === "undefined") return;
    this.booted = true;
    window.addEventListener("online", () => void this.resumeAll());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.resumeAll();
    });
    void this.resumeAll();
    // Segunda passada: numa recarga, a trava da aba anterior pode levar um
    // instante para cair — assim adotamos a gravação órfã mesmo nessa corrida.
    window.setTimeout(() => void this.resumeAll(), 2500);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(rec: RecordingRecord): void {
    this.listeners.forEach((fn) => {
      try {
        fn(rec);
      } catch {
        /* um ouvinte quebrado não pode parar o envio */
      }
    });
  }

  /** A aba declara qual gravação está capturando (não pode ser adotada como órfã). */
  markRecording(id: string): void {
    this.activeRecordingId = id;
  }
  private clearActive(id: string): void {
    if (this.activeRecordingId === id) this.activeRecordingId = null;
  }

  /** Retoma tudo que ainda não chegou inteiro ao Drive. */
  async resumeAll(): Promise<void> {
    let all: RecordingRecord[];
    try {
      all = await listAll();
    } catch {
      return;
    }
    for (const rec of all) {
      if (rec.status === "recording") {
        await this.adoptIfOrphan(rec);
        continue;
      }
      if (rec.status === "done") {
        await this.finalizePending(rec);
        continue;
      }
      if (rec.status === "failed") {
        // nova sessão do usuário = nova chance; o áudio continua no disco
        await patchRecording(rec.id, { status: "uploading", error: null });
      }
      void this.pump(rec.id);
    }
  }

  /**
   * Fecha o ciclo de uma gravação que o service worker concluiu sozinho.
   *
   * O worker consegue falar com o Google (a sessão carrega a credencial na
   * própria URL), mas não com o Firestore nem com as nossas rotas, que exigem o
   * token do Firebase. Então ele marca `done` e deixa o resto aqui: atualizar a
   * reunião, aplicar o título definitivo e só então descartar o registro.
   */
  private async finalizePending(rec: RecordingRecord): Promise<void> {
    await this.writeFirestore(rec, true);
    await deleteChunks(rec.id);
    // Ainda pode haver um formulário aberto esperando o título definitivo.
    // Passado esse prazo consideramos abandonado e ficamos com o nome provisório.
    const stale = Date.now() - rec.createdAt > TITLE_GRACE_MS;
    if (rec.titleConfirmed || stale) await deleteRecording(rec.id);
  }

  /**
   * Adota uma gravação que ficou presa em "recording" porque a aba que a
   * gravava morreu (queda de energia, aba fechada com o microfone aberto).
   *
   * Sem isto o áudio já salvo no disco jamais seria enviado: `resumeAll` pularia,
   * o service worker ignoraria (só envia "uploading") e a faixa de recuperação
   * esconde "recording". Aqui promovemos o registro a "uploading" fixando o total
   * no que há no disco — o que também o faz aparecer na faixa de recuperação.
   *
   * A gravação viva desta aba (activeRecordingId) e qualquer gravação com batida
   * recente ficam de fora: só o abandono real é adotado.
   */
  private async adoptIfOrphan(rec: RecordingRecord): Promise<void> {
    if (rec.id === this.activeRecordingId) return;

    // A aba que grava (mesmo pausada) segura a trava smartmeet-rec-<id>. Se ela
    // sumiu, a trava caiu e adotamos na hora. Sem Web Locks, caímos na batida:
    // só adota após um tempo sem novos pedaços.
    if (hasWebLocks()) {
      if (!(await recLockFree(rec.id))) return;
    } else {
      const beat = rec.lastActiveAt ?? rec.createdAt;
      if (Date.now() - beat <= RECORDING_ORPHAN_MS) return;
    }

    if (rec.bytesWritten <= 0) {
      // morreu antes de captar qualquer áudio: nada a salvar
      if (rec.meetingId) {
        await patchMeetingUpload(rec.meetingId, {
          uploadStatus: "falha",
          uploadError: "Gravação interrompida antes de captar áudio.",
        }).catch(() => {});
      }
      await deleteRecording(rec.id);
      return;
    }

    const adopted = await patchRecording(rec.id, {
      status: "uploading",
      totalBytes: rec.bytesWritten,
      stoppedAt: rec.stoppedAt ?? Date.now(),
      error: null,
    });
    if (adopted) {
      this.emit(adopted);
      await this.writeFirestore(adopted, true);
      void this.pump(rec.id);
    }
  }

  // -------------------------------------------------------------------------
  // API usada pela tela de reuniões
  // -------------------------------------------------------------------------

  /** Abre a sessão de upload assim que a gravação começa. */
  async openSession(rec: RecordingRecord): Promise<RecordingRecord> {
    const { uploadUrl } = await createUploadSession({
      name: rec.driveName,
      mimeType: rec.mimeType || "application/octet-stream",
      sector: rec.sector,
      recordingId: rec.id,
      outputs: rec.output,
    });
    const next = await patchRecording(rec.id, {
      sessionUri: uploadUrl,
      error: null,
    });
    return next ?? rec;
  }

  /** Chamado a cada pedaço novo no disco — envia se já houver bloco cheio. */
  nudge(recordingId: string): void {
    void this.pump(recordingId);
  }

  /** Encerra a gravação: fixa o tamanho total e envia o que falta. */
  async finishRecording(recordingId: string, durationMs: number): Promise<void> {
    this.clearActive(recordingId);
    const rec = await getRecording(recordingId);
    if (!rec) return;

    if (rec.bytesWritten <= 0) {
      // Nada foi captado (microfone mudo/negado): não há arquivo a fechar no
      // Drive. Marcamos falha em vez de tentar finalizar um upload de 0 byte.
      const failed = await patchRecording(recordingId, {
        status: "failed",
        stoppedAt: Date.now(),
        durationMs,
        totalBytes: 0,
        error: "Nenhum áudio foi captado.",
      });
      if (failed) {
        this.emit(failed);
        await this.writeFirestore(failed, true);
      }
      return;
    }

    await patchRecording(recordingId, {
      status: "uploading",
      stoppedAt: Date.now(),
      durationMs,
      totalBytes: rec.bytesWritten,
    });
    void this.pump(recordingId);
  }

  /**
   * Registra o título definitivo. Se o arquivo já fechou no Drive, renomeia na
   * hora; senão fica guardado e a renomeação acontece ao concluir.
   */
  async applyTitle(recordingId: string, title: string): Promise<void> {
    const rec = await patchRecording(recordingId, {
      title,
      titleConfirmed: true,
    });
    if (!rec) return;

    if (rec.driveFileId) {
      // preserva a extensão: o título não a carrega, o nome no Drive sim
      const dot = rec.driveName.lastIndexOf(".");
      const ext = dot > 0 ? rec.driveName.slice(dot) : "";
      const nextName = `${title}${ext}`;
      if (nextName !== rec.driveName) {
        try {
          const file = await renameDriveFile(rec.driveFileId, nextName, rec.sector);
          await patchRecording(recordingId, {
            driveName: nextName,
            driveLink: file.webViewLink ?? rec.driveLink,
          });
        } catch (e) {
          // nome errado no Drive é cosmético — nunca deve derrubar o fluxo
          console.warn("Falha ao renomear no Drive:", e);
        }
      }
    }

    // o registro só existia para permitir esta renomeação
    if (rec.status === "done") await deleteRecording(recordingId);
  }

  /** Liga o doc do Firestore ao registro local (criado no início da gravação). */
  async linkMeeting(recordingId: string, meetingId: string): Promise<void> {
    await patchRecording(recordingId, { meetingId });
  }

  async discard(recordingId: string): Promise<void> {
    await deleteRecording(recordingId);
  }

  // -------------------------------------------------------------------------
  // bomba
  // -------------------------------------------------------------------------

  async pump(recordingId: string): Promise<void> {
    if (this.pumping.has(recordingId)) return;
    this.pumping.add(recordingId);
    try {
      await withLock(`smartmeet-up-${recordingId}`, () => this.drive(recordingId));
    } catch (e) {
      console.error("Bomba de envio falhou:", e);
    } finally {
      this.pumping.delete(recordingId);
    }
  }

  private async drive(recordingId: string): Promise<void> {
    let attempt = 0;
    let directFailures = 0;

    for (;;) {
      const rec = await getRecording(recordingId);
      if (!rec || rec.status === "done" || rec.status === "failed") return;

      if (!navigator.onLine) {
        await waitOnline();
        continue;
      }

      try {
        if (!rec.sessionUri) {
          await this.openSession(rec);
          continue;
        }

        const outcome = await this.step(rec);
        if (outcome === "idle") return; // falta áudio; voltamos no próximo pedaço
        if (outcome === "finished") return;
        attempt = 0;
        directFailures = 0;
      } catch (e) {
        // Preflight barrado e queda de rede chegam iguais ao JavaScript. Se
        // estamos online e o envio direto falhou duas vezes seguidas, é CORS —
        // passamos a repassar os blocos pelo nosso servidor.
        if (e instanceof CorsBlockedError && !rec.proxyMode && navigator.onLine) {
          directFailures++;
          if (directFailures >= 2) {
            console.warn("Envio direto bloqueado; ativando modo proxy.");
            await patchRecording(recordingId, { proxyMode: true });
            attempt = 0;
            continue;
          }
        }

        attempt++;
        const message = e instanceof Error ? e.message : "Falha no envio.";
        if (attempt >= MAX_ATTEMPTS) {
          const failed = await patchRecording(recordingId, {
            status: "failed",
            error: message,
          });
          if (failed) {
            this.emit(failed);
            await this.writeFirestore(failed, true);
          }
          return;
        }
        await patchRecording(recordingId, { error: message });

        // antes de reenviar, pergunta ao Google onde ele parou de verdade
        await this.reconcile(recordingId);
        await sleep(backoffMs(attempt - 1));
      }
    }
  }

  /** Envia um bloco. Devolve o que fazer em seguida. */
  private async step(
    rec: RecordingRecord,
  ): Promise<"sent" | "idle" | "finished"> {
    const sessionUri = rec.sessionUri!;
    const total = rec.totalBytes;
    const available = rec.bytesWritten - rec.uploadedBytes;
    const maxBlock = rec.proxyMode ? MAX_BLOCK_PROXY : MAX_BLOCK_DIRECT;

    let size: number;
    let isFinal = false;

    if (total === null) {
      // Ainda gravando: só blocos múltiplos de 256 KB, e sempre deixando pelo
      // menos 1 byte para trás — assim o bloco final (o único que carrega o
      // tamanho total e fecha o arquivo) nunca fica vazio.
      size = Math.min(maxBlock, Math.floor(Math.max(0, available - 1) / BLOCK_UNIT) * BLOCK_UNIT);
      if (size === 0) return "idle";
    } else {
      const remaining = total - rec.uploadedBytes;
      if (remaining <= 0) {
        // Tudo já foi enviado com tamanho desconhecido: a consulta de status
        // com o total real fecha o arquivo.
        return (await this.settle(rec, await queryOffset(sessionUri, total)))
          ? "finished"
          : "sent";
      }
      if (remaining <= maxBlock) {
        size = remaining;
        isFinal = true;
      } else {
        size = Math.floor(maxBlock / BLOCK_UNIT) * BLOCK_UNIT;
      }
    }

    const blob = await this.readBlock(rec, rec.uploadedBytes, size);
    if (blob.size === 0) return "idle";
    if (blob.size !== size) {
      // Os contadores dizem uma coisa e o disco entrega outra. Enviar assim
      // produziria um arquivo corrompido — melhor parar e deixar o usuário
      // baixar a cópia local pela faixa de recuperação.
      throw new Error(
        "O áudio salvo localmente está inconsistente. Baixe a cópia local antes de tentar de novo.",
      );
    }

    // No envio direto não conseguimos ler o header `Range` (CORS), então
    // avançamos de forma otimista — e toda falha reconcilia com o servidor.
    // No modo proxy o offset devolvido é o real: nele a otimismo seria perigoso.
    const outcome = rec.proxyMode
      ? await putChunkProxied(sessionUri, blob, rec.uploadedBytes, isFinal ? total : null)
      : await putChunkDirect(sessionUri, blob, rec.uploadedBytes, isFinal ? total : null);

    return (await this.settle(
      rec,
      outcome,
      rec.proxyMode ? undefined : rec.uploadedBytes + blob.size,
    ))
      ? "finished"
      : "sent";
  }

  /** Aplica o resultado de um bloco. Devolve true quando o envio acabou. */
  private async settle(
    rec: RecordingRecord,
    outcome: ChunkOutcome,
    optimisticBytes?: number,
  ): Promise<boolean> {
    if (outcome.state === "complete") {
      if (!outcome.file.id) {
        // O arquivo fechou no Drive (áudio salvo), mas viemos sem o id — some o
        // elo para renomear/transcrever depois. Não é perda de áudio; a próxima
        // reconciliação da página costuma trazer o id.
        console.warn(
          "Drive confirmou o upload sem devolver o id do arquivo:",
          rec.id,
        );
      }
      const updated = await patchRecording(rec.id, {
        status: "done",
        driveFileId: outcome.file.id ?? null,
        driveLink: outcome.file.webViewLink ?? null,
        uploadedBytes: rec.totalBytes ?? rec.bytesWritten,
        error: null,
      });
      if (updated) {
        this.emit(updated);
        await this.writeFirestore(updated, true);
        // O áudio local só sai depois que o Drive confirmou o id. O registro
        // (metadado, alguns bytes) sobrevive até o título ser confirmado, para
        // que a renomeação ainda seja possível — com envio em streaming o
        // arquivo costuma fechar antes de o usuário sair do formulário.
        await deleteChunks(updated.id);
        if (updated.titleConfirmed) await deleteRecording(updated.id);
      }
      return true;
    }

    if (outcome.state === "expired") {
      // Sessão de uma semana venceu. Os dados continuam no disco: abrimos outra
      // sessão e reenviamos do zero.
      const reset = await patchRecording(rec.id, {
        sessionUri: null,
        uploadedBytes: 0,
        error: null,
      });
      if (reset) this.emit(reset);
      return false;
    }

    const confirmed = Math.max(outcome.confirmedBytes, optimisticBytes ?? 0);
    const updated = await patchRecording(rec.id, {
      uploadedBytes: confirmed,
      error: null,
    });
    if (updated) {
      this.emit(updated);
      await this.writeFirestore(updated, false);
    }
    return false;
  }

  /** Alinha `uploadedBytes` com o que o Google diz ter recebido. */
  private async reconcile(recordingId: string): Promise<void> {
    const rec = await getRecording(recordingId);
    if (!rec?.sessionUri) return;
    try {
      const outcome = await queryOffset(rec.sessionUri, rec.totalBytes);
      await this.settle(rec, outcome);
    } catch {
      // se nem a consulta passa, a rede está fora — o backoff cuida disso
    }
  }

  private async readBlock(
    rec: RecordingRecord,
    start: number,
    size: number,
  ): Promise<Blob> {
    if (!rec.file) return readTail(rec.id, start, size);
    // Arquivo escolhido pelo usuário: a referência pode ter sido movida ou
    // alterada desde a seleção. Lemos de verdade para falhar com uma mensagem
    // clara em vez de morrer como "erro de rede" lá na frente.
    try {
      const buf = await rec.file.slice(start, start + size).arrayBuffer();
      return new Blob([buf]);
    } catch {
      throw new Error(
        "O arquivo original não está mais acessível. Selecione-o novamente para continuar o envio.",
      );
    }
  }

  /** Espelha o progresso no Firestore, com folga para não escrever demais. */
  private async writeFirestore(
    rec: RecordingRecord,
    important: boolean,
  ): Promise<void> {
    if (!rec.meetingId) return;
    const last = this.lastFirestoreWrite.get(rec.id) ?? 0;
    if (!important && Date.now() - last < FIRESTORE_THROTTLE_MS) return;
    this.lastFirestoreWrite.set(rec.id, Date.now());
    try {
      await patchMeetingUpload(rec.meetingId, {
        uploadStatus:
          rec.status === "done"
            ? "concluido"
            : rec.status === "failed"
              ? "falha"
              : rec.status === "recording"
                ? "gravando"
                : "enviando",
        uploadedBytes: rec.uploadedBytes,
        totalBytes: rec.totalBytes ?? rec.bytesWritten,
        driveFileId: rec.driveFileId,
        driveLink: rec.driveLink,
        uploadError: rec.error,
        durationMin: rec.durationMs
          ? Math.max(1, Math.round(rec.durationMs / 60000))
          : undefined,
      });
    } catch (e) {
      // Firestore fora do ar não pode impedir o áudio de chegar ao Drive; o
      // registro local segue como fonte da verdade e é reconciliado depois.
      console.warn("Falha ao atualizar o progresso no Firestore:", e);
    }
  }
}

export const uploadManager = new UploadManagerImpl();
