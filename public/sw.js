/**
 * Smart Meeting — service worker de envio em segundo plano.
 *
 * Objetivo único: continuar mandando áudio para o Drive depois que o usuário
 * fecha a aba. Não faz cache de páginas nem intercepta navegação.
 *
 * Por que Background Sync e não Background Fetch: a Background Fetch API do
 * Chrome só aceita requisições SEM corpo, então não serve para upload. O evento
 * `sync` roda código nosso — inclusive `fetch()` com Blob — assim que houver
 * rede, mesmo sem nenhuma aba aberta (Chrome, Edge, Android). No Firefox e no
 * Safari este evento não existe: lá o envio retoma quando o sistema é reaberto,
 * o que já é seguro porque o áudio está no IndexedDB.
 *
 * O esquema do banco é o mesmo de src/lib/audio/recording-db.ts — ao mudar lá,
 * mude aqui.
 */

const SYNC_TAG = "smartmeet-upload";
const DB_NAME = "smartmeet-audio";
const DB_VERSION = 1;
const STORE_RECORDINGS = "recordings";
const STORE_CHUNKS = "chunks";
const BLOCK_UNIT = 256 * 1024;
const MAX_BLOCK_DIRECT = 32 * BLOCK_UNIT;
const MAX_BLOCK_PROXY = 16 * BLOCK_UNIT;
/** Orçamento por evento: o navegador mata o worker se ele demorar demais. */
const BUDGET_MS = 90000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(pumpAll());
});

// ---------------------------------------------------------------------------
// IndexedDB (leitor mínimo)
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // o worker nunca cria o banco: quem faz isso é a página, ao gravar
    req.onupgradeneeded = () => req.transaction && req.transaction.abort();
  });
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function listPending(db) {
  const tx = db.transaction(STORE_RECORDINGS, "readonly");
  const all = await reqAsPromise(tx.objectStore(STORE_RECORDINGS).getAll());
  // gravações com o microfone aberto pertencem à aba; aqui só o que já encerrou
  return all.filter((r) => r.status === "uploading" && r.sessionUri);
}

async function getRecording(db, id) {
  const tx = db.transaction(STORE_RECORDINGS, "readonly");
  return reqAsPromise(tx.objectStore(STORE_RECORDINGS).get(id));
}

async function patchRecording(db, id, patch) {
  const tx = db.transaction(STORE_RECORDINGS, "readwrite");
  const store = tx.objectStore(STORE_RECORDINGS);
  const cur = await reqAsPromise(store.get(id));
  if (!cur) {
    tx.abort();
    return null;
  }
  const next = Object.assign({}, cur, patch);
  store.put(next);
  await txDone(tx);
  return next;
}

/**
 * Libera o áudio (o pesado) mas preserva o registro.
 *
 * O worker não tem o token do Firebase, então não consegue fechar o ciclo:
 * atualizar a reunião no Firestore e renomear o arquivo com o título final.
 * Por isso deixamos o registro marcado como `done` — a página faz essa
 * conciliação (`finalizePending`) na próxima vez que for aberta e só então
 * apaga o registro.
 */
async function releaseChunks(db, id) {
  const tx = db.transaction(STORE_CHUNKS, "readwrite");
  tx.objectStore(STORE_CHUNKS).delete(
    IDBKeyRange.bound([id, -Infinity], [id, Infinity]),
  );
  await txDone(tx);
}

/** Mesma lógica de readTail() do cliente: fatia as bordas pelo índice byEnd. */
function readTail(db, recordingId, fromByte, maxBytes) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHUNKS, "readonly");
    const index = tx.objectStore(STORE_CHUNKS).index("byEnd");
    const range = IDBKeyRange.bound(
      [recordingId, fromByte + 1],
      [recordingId, Number.MAX_SAFE_INTEGER],
    );
    const parts = [];
    let collected = 0;
    const req = index.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || collected >= maxBytes) return resolve(new Blob(parts));
      const c = cursor.value;
      const start = Math.max(0, fromByte - c.byteStart);
      const end = Math.min(c.size, start + (maxBytes - collected));
      parts.push(start === 0 && end === c.size ? c.blob : c.blob.slice(start, end));
      collected += end - start;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// envio
// ---------------------------------------------------------------------------

async function notifyClients() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage({ type: "smartmeet-progress" }));
}

async function pumpAll() {
  let db;
  try {
    db = await openDb();
  } catch {
    return;
  }

  const deadline = Date.now() + BUDGET_MS;
  let pending;
  try {
    pending = await listPending(db);
  } catch {
    return;
  }

  for (const rec of pending) {
    if (Date.now() > deadline) break;
    try {
      await pumpOne(db, rec.id, deadline);
    } catch (e) {
      console.warn("[sw] envio falhou, tentaremos de novo:", e);
    }
  }

  // Se ainda sobrou coisa, agenda outra rodada em vez de rejeitar a promessa:
  // o navegador limita quantas vezes repete um sync que falha.
  try {
    const left = await listPending(db);
    if (left.length && self.registration.sync) {
      await self.registration.sync.register(SYNC_TAG);
    }
  } catch {
    /* sem sync disponível: a página retoma na próxima abertura */
  }
}

async function pumpOne(db, id, deadline) {
  // mesmo nome de trava do cliente: worker e abas nunca enviam o mesmo bloco
  const run = async () => {
    while (Date.now() < deadline) {
      const rec = await getRecording(db, id);
      if (!rec || rec.status !== "uploading" || !rec.sessionUri) return;

      // O worker só faz envio direto. Em modo proxy a rota exige o token do
      // Firebase (que vive na página), então saímos ANTES de qualquer PUT —
      // inclusive o de finalização — para não queimar o orçamento do sync
      // batendo num preflight que será barrado. A aba resolve ao reabrir.
      if (rec.proxyMode) return;

      const total = rec.totalBytes;
      if (total === null || total === undefined) return; // ainda gravando
      const remaining = total - rec.uploadedBytes;
      const maxBlock = MAX_BLOCK_DIRECT;

      if (remaining <= 0) {
        // só falta declarar o tamanho total e fechar o arquivo
        const res = await fetch(rec.sessionUri, {
          method: "PUT",
          headers: { "Content-Range": `bytes */${total}` },
        });
        if (await applyOutcome(db, id, res, rec.uploadedBytes)) return;
        continue;
      }

      const isFinal = remaining <= maxBlock;
      const size = isFinal
        ? remaining
        : Math.floor(maxBlock / BLOCK_UNIT) * BLOCK_UNIT;

      const blob = rec.file
        ? rec.file.slice(rec.uploadedBytes, rec.uploadedBytes + size)
        : await readTail(db, id, rec.uploadedBytes, size);
      if (!blob.size) return;
      // Mesmo guarda do cliente: se o disco entregar menos do que os contadores
      // dizem, um bloco curto/desalinhado abriria um buraco. Saímos e deixamos a
      // página (que sabe reconciliar e oferecer a cópia local) resolver.
      if (blob.size !== size) return;

      const start = rec.uploadedBytes;
      const end = start + blob.size - 1;
      const declared = isFinal ? total : "*";

      const res = await fetch(rec.sessionUri, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${start}-${end}/${declared}` },
        body: blob,
      });
      if (await applyOutcome(db, id, res, start + blob.size)) return;
    }
  };

  if (self.navigator && self.navigator.locks) {
    await self.navigator.locks.request(`smartmeet-up-${id}`, run);
  } else {
    await run();
  }
}

/** Devolve true quando não há mais o que fazer com esta gravação agora. */
async function applyOutcome(db, id, res, optimisticBytes) {
  if (res.status === 308) {
    await patchRecording(db, id, { uploadedBytes: optimisticBytes, error: null });
    await notifyClients();
    return false;
  }
  if (res.ok) {
    let file = {};
    try {
      file = await res.json();
    } catch {
      /* resposta sem corpo: o id chega na próxima reconciliação da página */
    }
    await patchRecording(db, id, {
      status: "done",
      driveFileId: file.id || null,
      driveLink: file.webViewLink || null,
      error: null,
    });
    // o áudio local só sai depois da confirmação do Drive
    await releaseChunks(db, id);
    await notifyClients();
    return true;
  }
  if (res.status === 404 || res.status === 410) {
    // sessão vencida: a página abre outra e reenvia (os dados seguem no disco)
    await patchRecording(db, id, { sessionUri: null, uploadedBytes: 0 });
    return true;
  }
  throw new Error(`Drive respondeu ${res.status}`);
}
