/**
 * Camada 1 — persistência local do áudio (IndexedDB).
 *
 * O IndexedDB é a FONTE DA VERDADE da gravação: cada pedaço entregue pelo
 * MediaRecorder é gravado aqui numa transação própria e só é considerado salvo
 * quando o evento `complete` da transação dispara (isto é, o navegador já
 * confirmou a escrita). Nada de áudio se acumula na memória da aba.
 *
 * Se a aba fechar, o navegador travar ou o computador desligar, os pedaços
 * continuam no disco e o `UploadManager` retoma o envio na próxima abertura.
 *
 * ATENÇÃO: o service worker (`public/sw.js`) lê este mesmo banco com um leitor
 * próprio e mínimo. Ao mudar `DB_NAME`, `DB_VERSION` ou o formato dos registros,
 * atualize os dois lados.
 */

export const DB_NAME = "smartmeet-audio";
export const DB_VERSION = 1;
export const STORE_RECORDINGS = "recordings";
export const STORE_CHUNKS = "chunks";

/** Blocos do upload retomável do Google precisam ser múltiplos de 256 KB. */
export const BLOCK_UNIT = 256 * 1024;

export type RecordingStatus =
  /** microfone aberto, ainda chegando pedaço */
  | "recording"
  /** gravação encerrada, faltam bytes para enviar */
  | "uploading"
  /** arquivo fechado no Drive */
  | "done"
  /** falha definitiva — precisa de ação do usuário */
  | "failed";

export type RecordingKind = "mic" | "file";

export type RecordingRecord = {
  id: string;
  kind: RecordingKind;
  status: RecordingStatus;
  sector: string;
  ownerEmail: string;
  /** doc de `meetings` criado logo no início (rascunho) */
  meetingId: string | null;
  title: string;
  /**
   * true depois que o usuário confirmou o título no modal. Enquanto for false
   * o registro é preservado mesmo com o upload concluído, porque a renomeação
   * no Drive ainda pode acontecer — com streaming, o arquivo costuma fechar
   * antes de o usuário terminar de preencher o formulário.
   */
  titleConfirmed: boolean;
  /** nome com que o arquivo nasceu no Drive */
  driveName: string;
  mimeType: string;
  /** o que o usuário pediu gerar — vira a etiqueta smGerar no arquivo do Drive */
  output?: string[];
  createdAt: number;
  /**
   * Última "batida" da aba que grava — atualizada a cada pedaço. Se um registro
   * segue como "recording" mas sem batida recente, a aba que o gravava morreu e
   * o áudio é órfão: o UploadManager o adota em vez de deixá-lo preso para sempre.
   */
  lastActiveAt?: number;
  stoppedAt: number | null;
  durationMs: number;
  /** sessão retomável do Drive (vale 1 semana) */
  sessionUri: string | null;
  /** bytes já confirmados pelo Google */
  uploadedBytes: number;
  /** só é conhecido depois que a gravação encerra */
  totalBytes: number | null;
  /** bytes já persistidos aqui no IndexedDB */
  bytesWritten: number;
  chunkCount: number;
  driveFileId: string | null;
  driveLink: string | null;
  error: string | null;
  /** true quando o envio direto ao Google foi bloqueado por CORS e caiu no proxy */
  proxyMode: boolean;
  /** caminho "file": referência ao arquivo original escolhido pelo usuário */
  file?: File;
};

type ChunkRecord = {
  recordingId: string;
  seq: number;
  byteStart: number;
  byteEnd: number;
  size: number;
  blob: Blob;
};

// ---------------------------------------------------------------------------
// abertura
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECORDINGS)) {
        const s = db.createObjectStore(STORE_RECORDINGS, { keyPath: "id" });
        s.createIndex("byStatus", "status");
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const s = db.createObjectStore(STORE_CHUNKS, {
          keyPath: ["recordingId", "seq"],
        });
        // permite pular direto para o primeiro pedaço que ainda tem bytes novos
        s.createIndex("byEnd", ["recordingId", "byteEnd"]);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // se outra aba pedir upgrade, soltamos a conexão para não travá-la
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Falha ao abrir o banco local."));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Transação falhou."));
    tx.onabort = () => reject(tx.error ?? new Error("Transação abortada."));
  });
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Operação falhou."));
  });
}

// ---------------------------------------------------------------------------
// armazenamento persistente
// ---------------------------------------------------------------------------

/**
 * Pede ao navegador que não descarte este banco sob pressão de disco. Sem isso
 * o Chrome pode apagar o IndexedDB silenciosamente quando o disco enche.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Devolve um aviso quando o espaço livre não comporta com folga o que se
 * pretende gravar (`expectedBytes`), para alertar ANTES de começar.
 */
export async function storageWarning(
  expectedBytes: number,
): Promise<string | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (!quota) return null;
    const free = quota - usage;
    if (free < expectedBytes * 2) {
      return `Espaço local baixo (${fmtBytes(free)} livres). Libere espaço em disco antes de gravar reuniões longas.`;
    }
    return null;
  } catch {
    return null;
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// gravações
// ---------------------------------------------------------------------------

export function newRecordingId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createRecording(
  init: Pick<
    RecordingRecord,
    "id" | "kind" | "sector" | "ownerEmail" | "title" | "driveName" | "mimeType"
  > &
    Partial<RecordingRecord>,
): Promise<RecordingRecord> {
  const rec: RecordingRecord = {
    status: "recording",
    titleConfirmed: false,
    meetingId: null,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    stoppedAt: null,
    durationMs: 0,
    sessionUri: null,
    uploadedBytes: 0,
    totalBytes: null,
    bytesWritten: 0,
    chunkCount: 0,
    driveFileId: null,
    driveLink: null,
    error: null,
    proxyMode: false,
    ...init,
  };
  const db = await openDb();
  const tx = db.transaction(STORE_RECORDINGS, "readwrite");
  tx.objectStore(STORE_RECORDINGS).put(rec);
  await done(tx);
  return rec;
}

export async function getRecording(
  id: string,
): Promise<RecordingRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_RECORDINGS, "readonly");
  return asPromise(
    tx.objectStore(STORE_RECORDINGS).get(id) as IDBRequest<RecordingRecord | undefined>,
  );
}

/**
 * Aplica um patch de forma atômica (lê e regrava na mesma transação), para que
 * duas atualizações concorrentes — página e service worker — não se sobrescrevam.
 */
export async function patchRecording(
  id: string,
  patch: Partial<RecordingRecord>,
): Promise<RecordingRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_RECORDINGS, "readwrite");
  const store = tx.objectStore(STORE_RECORDINGS);
  const cur = (await asPromise(
    store.get(id) as IDBRequest<RecordingRecord | undefined>,
  )) as RecordingRecord | undefined;
  if (!cur) {
    tx.abort();
    return undefined;
  }
  const next = { ...cur, ...patch };
  store.put(next);
  await done(tx);
  return next;
}

export async function listAll(): Promise<RecordingRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_RECORDINGS, "readonly");
  const all = await asPromise(
    tx.objectStore(STORE_RECORDINGS).getAll() as IDBRequest<RecordingRecord[]>,
  );
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** Gravações que ainda não chegaram inteiras ao Drive. */
export async function listUnfinished(): Promise<RecordingRecord[]> {
  const all = await listAll();
  return all.filter((r) => r.status !== "done");
}

// ---------------------------------------------------------------------------
// pedaços
// ---------------------------------------------------------------------------

/**
 * Grava um pedaço e atualiza os contadores da gravação na MESMA transação.
 * Só resolve quando a transação completa — a partir daí o áudio sobrevive a
 * um desligamento abrupto.
 */
export async function appendChunk(
  recordingId: string,
  blob: Blob,
): Promise<RecordingRecord | undefined> {
  if (!blob.size) return getRecording(recordingId);
  const db = await openDb();
  const tx = db.transaction([STORE_RECORDINGS, STORE_CHUNKS], "readwrite");
  const recStore = tx.objectStore(STORE_RECORDINGS);
  const rec = (await asPromise(
    recStore.get(recordingId) as IDBRequest<RecordingRecord | undefined>,
  )) as RecordingRecord | undefined;
  if (!rec) {
    tx.abort();
    return undefined;
  }
  const byteStart = rec.bytesWritten;
  const chunk: ChunkRecord = {
    recordingId,
    seq: rec.chunkCount,
    byteStart,
    byteEnd: byteStart + blob.size,
    size: blob.size,
    blob,
  };
  tx.objectStore(STORE_CHUNKS).put(chunk);
  const next: RecordingRecord = {
    ...rec,
    bytesWritten: chunk.byteEnd,
    chunkCount: rec.chunkCount + 1,
    lastActiveAt: Date.now(),
  };
  recStore.put(next);
  await done(tx);
  return next;
}

/**
 * Devolve até `maxBytes` de áudio contíguo a partir do byte `fromByte`.
 * Usa o índice `byEnd` para saltar direto ao primeiro pedaço com bytes novos e
 * fatia as bordas, então o bloco devolvido tem exatamente o tamanho pedido
 * (ou menos, se ainda não houver dados suficientes).
 */
export async function readTail(
  recordingId: string,
  fromByte: number,
  maxBytes: number,
): Promise<Blob> {
  const db = await openDb();
  const tx = db.transaction(STORE_CHUNKS, "readonly");
  const index = tx.objectStore(STORE_CHUNKS).index("byEnd");
  const range = IDBKeyRange.bound(
    [recordingId, fromByte + 1],
    [recordingId, Number.MAX_SAFE_INTEGER],
  );

  const parts: BlobPart[] = [];
  let collected = 0;

  await new Promise<void>((resolve, reject) => {
    const req = index.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || collected >= maxBytes) return resolve();
      const c = cursor.value as ChunkRecord;
      const start = Math.max(0, fromByte - c.byteStart);
      const end = Math.min(c.size, start + (maxBytes - collected));
      const slice = start === 0 && end === c.size ? c.blob : c.blob.slice(start, end);
      parts.push(slice);
      collected += end - start;
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("Falha ao ler o áudio local."));
  });

  return new Blob(parts);
}

/** Remonta a gravação inteira — usado no botão "Baixar cópia local". */
export function assembleBlob(rec: RecordingRecord): Promise<Blob> {
  if (rec.file) return Promise.resolve(rec.file);
  return readTail(rec.id, 0, Number.MAX_SAFE_INTEGER);
}

export async function deleteRecording(recordingId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_RECORDINGS, STORE_CHUNKS], "readwrite");
  tx.objectStore(STORE_RECORDINGS).delete(recordingId);
  tx.objectStore(STORE_CHUNKS).delete(
    IDBKeyRange.bound([recordingId, -Infinity], [recordingId, Infinity]),
  );
  await done(tx);
}

/** Apaga só o áudio, preservando o registro (para histórico após concluir). */
export async function deleteChunks(recordingId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_CHUNKS, "readwrite");
  tx.objectStore(STORE_CHUNKS).delete(
    IDBKeyRange.bound([recordingId, -Infinity], [recordingId, Infinity]),
  );
  await done(tx);
}
