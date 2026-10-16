/**
 * Aplica o código de versão (M0001, C0001) ao histórico de demandas (#242).
 *
 * A regra mora em `src/lib/codigo-core.ts` (`planoDeMigracao`) e é testada em
 * `test-codigo.mjs`; aqui só se lê o banco, mostra o plano e, se pedido, grava.
 *
 * Uso:
 *   node scripts/migrar-codigos.mjs            → SIMULA: mostra o plano, não grava
 *   node scripts/migrar-codigos.mjs --gravar   → backup primeiro, depois grava
 *
 * SIMULAR É O PADRÃO porque o que este script faz é reescrever o título de
 * demandas reais de uma vez. Quem quer gravar precisa dizer, e vê o plano antes.
 *
 * O BACKUP VEM ANTES, e se ele falhar nada é gravado. É `backup-firestore.mjs`,
 * o mesmo ponto de restauração de sempre.
 *
 * O TÍTULO DEIXA RASTRO. Cada título reescrito ganha um evento `editada` no
 * histórico do card, no mesmo lote da escrita (AGENTS.md §4: escrita e registro
 * andam juntos), em nome da conta do setor. O código em si não gera evento: é
 * campo do sistema, como `histCount`, e não decisão de ninguém.
 *
 * Idempotente: rodar de novo depois de gravar mostra "nada a fazer".
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { planoDeMigracao, codigoVisivel } from "../src/lib/codigo-core.ts";

const PROJETO = process.env.FIREBASE_PROJECT_ID || "smart-meet-d441b";
const CHAVE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  join(homedir(), ".gcp", "mcp-gsheets-sa.json");
/** Em nome de quem o evento do título é registrado. */
const AUTOR = "setorbiunichristus@gmail.com";
const GRAVAR = process.argv.includes("--gravar");
/** 500 é o teto do lote; cada título usa duas operações (card + evento). */
const POR_LOTE = 400;

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(readFileSync(CHAVE, "utf8"))),
    projectId: PROJETO,
  });
}
const db = getFirestore();

const snap = await db.collection("cards").get();
const cards = snap.docs.map((d) => {
  const x = d.data();
  return {
    id: d.id,
    sector: x.sector ?? "",
    title: x.title ?? "",
    type: x.type ?? null,
    produtoId: x.produtoId ?? null,
    codigo: x.codigo ?? null,
    codigoProduto: x.codigoProduto ?? null,
    criadoEm: x.createdAt?.toMillis?.() ?? x.enteredAt ?? 0,
  };
});

const { alteracoes, semSerie } = planoDeMigracao(cards);
const porId = new Map(cards.map((c) => [c.id, c]));

console.log(`cards lidos: ${cards.length}`);
console.log(`a alterar: ${alteracoes.length}\n`);
for (const a of alteracoes) {
  const c = porId.get(a.id);
  const partes = [];
  if (a.codigo) partes.push(a.codigo);
  if (a.title !== undefined) partes.push(`título: "${c.title}" → "${a.title}"`);
  console.log(`  [${c.sector}] ${a.id}  ${partes.join("  ·  ")}`);
}

if (semSerie.length) {
  console.log(
    `\nCom código no título mas SEM série (sem produto ou tipo fora de melhoria/correção) — não tocados:`,
  );
  for (const c of semSerie) {
    console.log(`  [${c.sector}] ${c.id}  tipo=${c.type ?? "—"} produto=${c.produtoId ?? "—"}  "${c.title}"`);
  }
}

// Número repetido na mesma série: a corrida que `codigoPara` aceitou, ou
// alguém editando o campo à mão. Só avisa — renumerar é decisão de gente.
const depois = cards.map((c) => ({ ...c, ...(alteracoes.find((a) => a.id === c.id) ?? {}) }));
const vistos = new Map();
for (const c of depois) {
  const v = codigoVisivel(c);
  if (!v) continue;
  const k = `${c.produtoId}|${v}`;
  if (vistos.has(k)) console.log(`\n⚠️  código repetido: ${v} em ${vistos.get(k)} e ${c.id}`);
  else vistos.set(k, c.id);
}

if (!GRAVAR) {
  console.log("\nSIMULAÇÃO — nada foi gravado. Para gravar: node scripts/migrar-codigos.mjs --gravar");
  process.exit(0);
}
if (alteracoes.length === 0) {
  console.log("\nnada a fazer.");
  process.exit(0);
}

console.log("\nbackup antes de gravar…");
const raiz = join(dirname(fileURLToPath(import.meta.url)));
const bk = spawnSync(process.execPath, [join(raiz, "backup-firestore.mjs")], {
  stdio: "inherit",
});
if (bk.status !== 0) {
  console.error("o backup falhou — nada foi gravado.");
  process.exit(1);
}

let lote = db.batch();
let ops = 0;
let gravados = 0;
for (const a of alteracoes) {
  const c = porId.get(a.id);
  const ref = db.collection("cards").doc(a.id);
  const patch = {};
  if (a.codigo) {
    patch.codigo = a.codigo;
    patch.codigoProduto = a.codigoProduto;
  }
  if (a.title !== undefined) {
    patch.title = a.title;
    patch.histCount = FieldValue.increment(1);
    lote.set(ref.collection("historico").doc(), {
      sector: c.sector,
      autor: AUTOR,
      em: FieldValue.serverTimestamp(),
      acao: "editada",
      mudancas: [{ campo: "titulo", de: c.title, para: a.title }],
    });
    ops++;
  }
  lote.update(ref, patch);
  ops++;
  gravados++;
  if (ops >= POR_LOTE) {
    await lote.commit();
    lote = db.batch();
    ops = 0;
  }
}
if (ops) await lote.commit();
console.log(`\ngravado: ${gravados} card(s).`);
