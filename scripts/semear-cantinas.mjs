/**
 * Cria o setor de execução "Cantinas" e a árvore D1–D4 dele.
 *
 * POR QUE ISTO É UM SCRIPT, e não um clique na aba Admin: a aba Admin cria o
 * setor, mas criar as quatro dimensões com as suas dezesseis subdimensões à mão
 * são dezesseis formulários, e o texto delas veio de uma ata — o lugar em que
 * ele precisa ficar registrado é o repositório, não a memória de quem digitou.
 * Quem quiser conferir de onde saiu cada nome lê o comentário de `DIMENSOES`
 * abaixo e acha a linha da ata correspondente.
 *
 * A ESTRUTURA VEIO DA ATA DA REUNIÃO DAS CANTINAS. As quatro dimensões, com o
 * escopo entre parênteses, estão registradas lá nestas palavras: "D1 cadeia de
 * suprimentos (estoque, compras, transporte, patrimônio); D2 operação e gente
 * (pessoas, sanitário, execução de balcão, escala, fiscal); D3 engenharia de
 * cardápio, comunicação e eventos; D4 financeiro, controladoria, dados, vendas
 * e ponto de venda".
 *
 * TODA SUBDIMENSÃO NASCE COMO ROTINA, e não como projeto. A diferença não é
 * decorativa (ver `dimensoes-core.ts`): projeto tem fim e ganha porcentagem de
 * conclusão; rotina não termina, e medir "40% do controle de estoque" é
 * inventar um fim que não existe. A ata prevê que um item "pode virar projeto",
 * e virar é um clique em Admin › Dimensões — nascer projeto seria o app decidindo
 * por quem conduz o trabalho.
 *
 * É IDEMPOTENTE: roda quantas vezes quiser. O que já existe é reconhecido pelo
 * nome (sem caixa, sem acento, como `setorExistente` compara) e pulado. É por
 * isso que ele pode ser rodado de novo depois de alguém renomear uma coisa na
 * tela sem medo de duplicar o resto.
 *
 * Uso:
 *   node scripts/semear-cantinas.mjs              # só mostra o que faria
 *   node scripts/semear-cantinas.mjs --confirmar  # grava
 *
 * O padrão é NÃO gravar de propósito: isto escreve no Firestore de produção,
 * onde não existe homologação (AGENTS.md, cabeçalho). Um script de semeadura
 * que grava só por ser executado é o tipo de coisa que roda por engano dentro
 * de outro comando.
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJETO = process.env.FIREBASE_PROJECT_ID || "smart-meet-d441b";
const CHAVE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  join(homedir(), ".gcp", "mcp-gsheets-sa.json");

const SETOR = "Cantinas";

/**
 * As quatro dimensões e o que mora dentro de cada uma.
 *
 * A `ordem` é o que decide a COR na árvore (`corDaDimensao`) e a posição — por
 * isso ela é explícita aqui em vez de ser o índice do array: reordenar esta
 * lista um dia não pode repintar as quatro dimensões de quem já está usando.
 */
const DIMENSOES = [
  {
    nome: "D1 · Cadeia de suprimentos",
    ordem: 0,
    subs: ["Estoque", "Compras", "Transporte", "Patrimônio"],
  },
  {
    nome: "D2 · Operação e gente",
    ordem: 1,
    subs: ["Pessoas", "Sanitário", "Execução de balcão", "Escala", "Fiscal"],
  },
  {
    nome: "D3 · Cardápio, comunicação e eventos",
    ordem: 2,
    subs: ["Engenharia de cardápio", "Comunicação", "Eventos"],
  },
  {
    nome: "D4 · Financeiro, dados e vendas",
    ordem: 3,
    subs: ["Financeiro", "Controladoria", "Dados", "Vendas", "Ponto de venda"],
  },
];

const GRAVAR = process.argv.includes("--confirmar");

/** A mesma comparação de `setorExistente` e `nomeExistente`: sem caixa, sem acento. */
const chave = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(readFileSync(CHAVE, "utf8"))),
    projectId: PROJETO,
  });
}
const db = getFirestore();

const feito = [];
const pulado = [];

// ---- o setor -------------------------------------------------------------
const setoresSnap = await db.collection("setores").get();
const jaTem = setoresSnap.docs.find((d) => chave(d.data().name) === chave(SETOR));

if (jaTem) {
  pulado.push(`setor "${jaTem.data().name}" já existe (${jaTem.id})`);
} else if (GRAVAR) {
  const ref = await db.collection("setores").add({
    name: SETOR,
    createdAt: FieldValue.serverTimestamp(),
  });
  feito.push(`setor "${SETOR}" criado (${ref.id})`);
} else {
  feito.push(`criaria o setor "${SETOR}"`);
}

// ---- as dimensões --------------------------------------------------------
const dimsSnap = await db.collection("dimensoes").where("setor", "==", SETOR).get();
const existentes = new Map(dimsSnap.docs.map((d) => [chave(d.data().nome), d]));

for (const dim of DIMENSOES) {
  const atual = existentes.get(chave(dim.nome));
  if (atual) {
    pulado.push(`dimensão "${dim.nome}" já existe (${atual.id})`);
    continue;
  }
  // O id da subdimensão é "1", "2", … dentro da dimensão — o mesmo formato que
  // `proximoIdDeSub` produz, para que a próxima criada pela tela continue a
  // contagem em vez de colidir com uma destas.
  const subs = dim.subs.map((nome, i) => ({
    id: String(i + 1),
    nome,
    tipo: "rotina",
  }));
  if (GRAVAR) {
    const ref = await db.collection("dimensoes").add({
      setor: SETOR,
      nome: dim.nome,
      ordem: dim.ordem,
      subs,
      createdAt: FieldValue.serverTimestamp(),
    });
    feito.push(`dimensão "${dim.nome}" criada com ${subs.length} subdimensões (${ref.id})`);
  } else {
    feito.push(`criaria "${dim.nome}" com ${subs.length} subdimensões`);
  }
}

console.log(`\nprojeto: ${PROJETO}${GRAVAR ? "" : "   (ensaio — nada foi gravado)"}\n`);
feito.forEach((l) => console.log(`  + ${l}`));
pulado.forEach((l) => console.log(`  · ${l}`));
if (!GRAVAR && feito.length)
  console.log(`\nPara gravar de verdade: node scripts/semear-cantinas.mjs --confirmar`);
console.log("");
