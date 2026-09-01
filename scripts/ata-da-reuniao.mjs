/**
 * Gera a ata de uma reunião já processada, pela linha de comando.
 *
 * POR QUE ISTO EXISTE, se a tela já tem o botão "Gerar da reunião": porque
 * nenhum agente faz login no app com conta Google real (AGENTS.md §6), e a
 * primeira ata precisava nascer e ser CONFERIDA antes de o PR ir para a `main`.
 * O modo de ensaio imprime a ata inteira que sairia — cabeçalho, cada assunto,
 * cada decisão, cada tarefa — para alguém ler linha a linha contra o documento
 * original. Uma extração que ninguém olhou não é melhor que nenhuma.
 *
 * ELE RODA O MESMO NÚCLEO DA ROTA. `ata-de-reuniao-core` é importado aqui e em
 * `api/ata/gerar` — não há uma segunda implementação para divergir em silêncio.
 * A diferença é só quem autoriza: lá, `requireUser`; aqui, o fato de você ter a
 * chave da conta de serviço na máquina.
 *
 * Uso:
 *   node scripts/ata-da-reuniao.mjs --titulo "Dimensões cantinas" --setor Cantinas
 *   node scripts/ata-da-reuniao.mjs --titulo "Dimensões cantinas" --setor Cantinas --confirmar
 *   node scripts/ata-da-reuniao.mjs --lista
 *
 * O padrão é NÃO gravar, pelo mesmo motivo de `semear-cantinas.mjs`: isto
 * escreve no Firestore de produção, onde não existe homologação. Um script que
 * grava só por ser executado é o tipo de coisa que roda por engano dentro de
 * outro comando.
 *
 * É IDEMPOTENTE pelo `meetingId` + setor, a mesma trava da rota: rodar duas
 * vezes reconhece a ata que já existe e não cria uma segunda.
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ligarCards,
  montarAtaDaReuniao,
} from "../src/lib/ata-de-reuniao-core.ts";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const PROJETO = process.env.FIREBASE_PROJECT_ID || "smart-meet-d441b";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

const argv = process.argv.slice(2);
const opcao = (nome) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 ? argv[i + 1] : "";
};
const GRAVAR = argv.includes("--confirmar");
const LISTA = argv.includes("--lista");
const TITULO = opcao("titulo");
const SETOR = opcao("setor");

/**
 * A credencial sai do `.env.local`, e não de `~/.gcp`, porque esta é a MESMA
 * conta que a rota usa em produção: o Drive só compartilha os documentos
 * gerados com ela. Ler a chave de outro lugar daria um script que funciona na
 * máquina de quem escreveu e falha na do próximo.
 */
function servico() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  }
  const env = readFileSync(join(RAIZ, ".env.local"), "utf8");
  const m = /^GOOGLE_SERVICE_ACCOUNT=(.*)$/m.exec(env);
  if (!m) {
    console.error(
      "GOOGLE_SERVICE_ACCOUNT não está no ambiente nem em .env.local.",
    );
    process.exit(1);
  }
  return JSON.parse(m[1].trim());
}

const sa = servico();
if (!getApps().length) {
  initializeApp({ credential: cert(sa), projectId: PROJETO });
}
const db = getFirestore();

/** O mesmo export de `drive-server.exportDocMarkdown`, com as mesmas limpezas. */
async function baixarDoc(token, fileId) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?` +
    new URLSearchParams({ mimeType: "text/markdown", supportsAllDrives: "true" });
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Drive respondeu ${r.status} ao exportar ${fileId}.`);
  return (await r.text())
    .replace(/^(#{1,6}\s+)\*\*(.+?)\*\*\s*$/gm, "$1$2")
    .replace(/\\([~.\-*_[\]()#+!])/g, "$1")
    .trim();
}

const reunioesSnap = await db.collection("meetings").get();
const processadas = reunioesSnap.docs.filter((d) => {
  const m = d.data();
  return (
    m.status === "processado" &&
    (m.driveOutputs ?? []).some((o) => o.kind === "resumo")
  );
});

if (LISTA || !TITULO) {
  console.log(`\nReuniões processadas com "Pontos importantes" (${processadas.length}):\n`);
  processadas
    .sort((a, b) => String(b.data().date ?? "").localeCompare(String(a.data().date ?? "")))
    .forEach((d) => {
      const m = d.data();
      console.log(`  ${m.date ?? "sem data"}  ${m.sector ?? "?"}  ${m.title}`);
    });
  if (!TITULO) {
    console.log(`\nEscolha uma com --titulo "<parte do título>" --setor <Setor>\n`);
  }
  process.exit(0);
}

const alvo = processadas.filter((d) =>
  String(d.data().title ?? "").toLowerCase().includes(TITULO.toLowerCase()),
);
if (alvo.length === 0) {
  console.error(`\nNenhuma reunião processada casa com "${TITULO}". Use --lista.\n`);
  process.exit(1);
}
if (alvo.length > 1) {
  console.error(`\n"${TITULO}" casa com ${alvo.length} reuniões — seja mais específico:`);
  alvo.forEach((d) => console.error(`  ${d.data().date}  ${d.data().title}`));
  console.error("");
  process.exit(1);
}

const doc = alvo[0];
const m = doc.data();
const setor = SETOR || m.sector;

// Setor de destino que não existe é quase sempre erro de digitação — e uma ata
// num setor inexistente é invisível para todo mundo, inclusive para quem a
// criou, porque a regra do Firestore fecha por setor.
const setores = (await db.collection("setores").get()).docs.map((d) => d.data().name);
if (!setores.includes(setor)) {
  console.error(`\nO setor "${setor}" não existe. Os que existem:`);
  console.error(`  ${setores.join(", ")}\n`);
  process.exit(1);
}

const jaExiste = (
  await db.collection("atas").where("meetingId", "==", doc.id).get()
).docs.find((d) => d.data().setor === setor);

const out = (m.driveOutputs ?? []).find((o) => o.kind === "resumo");
const fileId = /\/document\/d\/([a-zA-Z0-9_-]{20,})/.exec(out.link)?.[1];
if (!fileId) {
  console.error("\nO link do documento não é um Google Doc.\n");
  process.exit(1);
}

const auth = new GoogleAuth({ credentials: sa, scopes: [DRIVE_SCOPE] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const markdown = await baixarDoc(token, fileId);

const dimensoes = (
  await db.collection("dimensoes").where("setor", "==", setor).get()
).docs.map((d) => ({
  id: d.id,
  nome: d.data().nome ?? "",
  ordem: Number(d.data().ordem ?? 0),
  subs: (d.data().subs ?? []).map((s) => ({ id: String(s.id), nome: s.nome ?? "" })),
}));

const ata = montarAtaDaReuniao({
  markdown,
  reuniao: {
    id: doc.id,
    title: m.title ?? "",
    date: m.date ?? "",
    participants: m.participants ?? [],
    createdBy: m.createdBy ?? "",
  },
  setor,
  dimensoes,
});

// O card que a mesma reunião gerou, quando ele está NESTE setor. A ata das
// cantinas é o caso em que ele não está: a reunião correu no B.I. e o card
// ficou lá, então nenhum item liga — e é o certo.
const cards = (await db.collection("cards").where("sector", "==", setor).get()).docs
  .filter(
    (d) =>
      !d.data().deletedAt &&
      (d.data().meetingIds ?? []).includes(doc.id) &&
      d.data().propostaId,
  );
const propostas = await Promise.all(
  cards.map((d) => db.collection("demandPropostas").doc(d.data().propostaId).get()),
);
ata.itens = ligarCards(
  ata.itens,
  cards
    .map((d, i) => ({ id: d.id, assunto: propostas[i].data()?.assunto ?? "" }))
    .filter((x) => x.assunto),
);

// ---- o relatório ---------------------------------------------------------
console.log(`\nprojeto: ${PROJETO}${GRAVAR ? "" : "   (ensaio — nada foi gravado)"}\n`);
console.log(`  reunião:      ${m.title}  (${doc.id})`);
console.log(`  setor dela:   ${m.sector}`);
console.log(`  setor da ata: ${setor}`);
console.log(`  documento:    ${out.name}`);
console.log("");
console.log(`  título:       ${ata.titulo}`);
console.log(`  data:         ${ata.data || "—"}`);
console.log(`  facilitador:  ${ata.facilitador || "—"}`);
console.log(`  participantes:${ata.participantes.length ? " " + ata.participantes.join(", ") : " —"}`);
console.log(`  citados:      ${ata.citados.join(", ") || "—"}`);
console.log(`\n  ${ata.itens.length} assunto(s):\n`);

for (const item of ata.itens) {
  const dim = dimensoes.find((d) => d.id === item.dimensaoId);
  const sub = dim?.subs.find((s) => s.id === item.subdimensaoId);
  const marca = item.cardId ? `card ${item.cardId}` : "sem card";
  console.log(`  ── ${item.assunto}   [${marca}]`);
  if (dim) console.log(`     dimensão:  ${dim.nome}${sub ? ` · ${sub.nome}` : ""}`);
  if (item.decisao) console.log(`     decisão:   ${item.decisao}`);
  if (item.objetivo) console.log(`     objetivo:  ${item.objetivo}`);
  if (item.contexto) console.log(`     contexto:  ${item.contexto.slice(0, 160)}…`);
  item.tarefas.forEach((t) =>
    console.log(`       · ${t.texto}${t.observacao ? `   ${t.observacao}` : ""}`),
  );
  console.log("");
}

if (jaExiste) {
  console.log(`  · esta reunião JÁ tem ata em ${setor} (${jaExiste.id}) — nada a fazer\n`);
  process.exit(0);
}

if (!GRAVAR) {
  console.log(
    `Confira o texto acima contra o documento. Para gravar:\n` +
      `  node scripts/ata-da-reuniao.mjs --titulo "${TITULO}" --setor ${setor} --confirmar\n`,
  );
  process.exit(0);
}

const ref = await db.collection("atas").add({
  ...ata,
  createdAt: FieldValue.serverTimestamp(),
  createdBy: m.createdBy ?? "",
});
console.log(`  + ata criada em ${setor} (${ref.id})\n`);
