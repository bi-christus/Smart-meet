/**
 * Backup do Firestore para JSON.
 *
 * Por que não `gcloud firestore export` nem o backup agendado do Firebase: os
 * dois exigem faturamento habilitado (plano Blaze) e o projeto está no Spark.
 * Enquanto isso não muda, este script é o único ponto de restauração que
 * existe — e um ponto de restauração imperfeito vale muito mais que nenhum.
 *
 * O que ele NÃO é: um export consistente no tempo. Ele lê coleção por coleção,
 * então um documento escrito no meio da execução pode entrar e outro não. Para
 * o volume atual (dezenas de reuniões, centenas de cards) isso é irrelevante;
 * se o banco crescer muito, migre para o export gerenciado.
 *
 * Uso:
 *   node scripts/backup-firestore.mjs [destino]
 *
 * Sem argumento, grava na pasta do OneDrive — que já é sincronizada fora da
 * máquina, o que é metade do valor de um backup.
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJETO = process.env.FIREBASE_PROJECT_ID || "smart-meet-d441b";
const CHAVE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  join(homedir(), ".gcp", "mcp-gsheets-sa.json");
const DESTINO =
  process.argv[2] ||
  join(
    homedir(),
    "OneDrive",
    "Central de Trabalho",
    "Cowork",
    "Rotinas",
    "Backups",
  );
/** Quantos dias de backup manter. Além disso, apaga o mais antigo. */
const MANTER_DIAS = 30;

function hoje() {
  // Sem fuso: o nome do arquivo é só uma etiqueta ordenável.
  return new Date().toISOString().slice(0, 10);
}

/** Timestamps e refs do Firestore não sobrevivem ao JSON.stringify cru. */
function serializar(v) {
  if (v === null || v === undefined) return v;
  if (typeof v?.toDate === "function") {
    return { __tipo: "timestamp", valor: v.toDate().toISOString() };
  }
  if (typeof v?.latitude === "number" && typeof v?.longitude === "number") {
    return { __tipo: "geopoint", lat: v.latitude, lng: v.longitude };
  }
  if (v?._path?.segments) return { __tipo: "ref", caminho: v.path };
  if (Array.isArray(v)) return v.map(serializar);
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = serializar(x);
    return o;
  }
  return v;
}

async function dumpColecao(col, profundidade = 0) {
  const snap = await col.get();
  const docs = {};
  for (const d of snap.docs) {
    const item = { dados: serializar(d.data()) };
    // Subcoleções só até 2 níveis: o suficiente para o modelo atual e um
    // limite que impede uma recursão acidental cara.
    if (profundidade < 2) {
      const subs = await d.ref.listCollections();
      if (subs.length) {
        item.subcolecoes = {};
        for (const s of subs) {
          item.subcolecoes[s.id] = await dumpColecao(s, profundidade + 1);
        }
      }
    }
    docs[d.id] = item;
  }
  return docs;
}

function limparAntigos(dir) {
  const arquivos = readdirSync(dir)
    .filter((f) => /^firestore-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const excedente = arquivos.length - MANTER_DIAS;
  for (let i = 0; i < excedente; i++) {
    rmSync(join(dir, arquivos[i]));
    console.log("removido (fora da retenção):", arquivos[i]);
  }
}

const creds = JSON.parse(readFileSync(CHAVE, "utf8"));
if (!getApps().length) {
  initializeApp({ credential: cert(creds), projectId: PROJETO });
}
const db = getFirestore();

mkdirSync(DESTINO, { recursive: true });

const colecoes = await db.listCollections();
const saida = { projeto: PROJETO, geradoEm: new Date().toISOString(), colecoes: {} };
let total = 0;
for (const c of colecoes) {
  const docs = await dumpColecao(c);
  saida.colecoes[c.id] = docs;
  const n = Object.keys(docs).length;
  total += n;
  console.log(`${c.id}: ${n} documento(s)`);
}

const arquivo = join(DESTINO, `firestore-${hoje()}.json`);
writeFileSync(arquivo, JSON.stringify(saida, null, 2), "utf8");
limparAntigos(DESTINO);

console.log(`\nbackup gravado: ${arquivo}`);
console.log(`coleções: ${colecoes.length} · documentos: ${total}`);
