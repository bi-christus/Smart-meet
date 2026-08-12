/**
 * Guarda a fronteira de segurança das demandas. Roda no `prebuild`.
 *
 * A regra que ele protege: o caminho automático (Cowork → Drive → ingest) NUNCA
 * escreve em /cards e NUNCA apaga nada. Um card só nasce por decisão humana em
 * `api/demandas/decidir`.
 *
 * Isso é fácil de furar sem má intenção — alguém "otimiza" o ingest para já
 * criar o card das propostas de confiança alta, o code review não pega, e a
 * garantia que o Ítalo pediu deixa de existir em silêncio. Um comentário não
 * segura isso; um build vermelho segura.
 *
 * Três decisões deste arquivo que parecem detalhe e não são:
 *
 * 1. Os caminhos saem de `import.meta.url`, nunca do CWD. Este é o portão do
 *    deploy: tem de dar o mesmo veredito rodando de qualquer diretório. Com
 *    caminho relativo ao CWD, rodar de fora do repo acusava "arquivo nao
 *    encontrado" nos dois alvos e mandava o operador caçar uma escrita em
 *    /cards que nunca existiu.
 * 2. Ausência de alvo e violação de regra são contadas separado. As duas
 *    derrubam o build — falhar fechado é de propósito —, mas dizem coisas
 *    opostas: uma é "a regra foi furada", a outra é "o alvo da regra sumiu,
 *    provavelmente num rename". Misturar as duas mente no log da Vercel.
 * 3. As rotas do Cowork entram por glob, não por lista literal, porque o risco
 *    real é uma rota NOVA nascer com POST — e lista literal não vê o que ainda
 *    não existe. Como glob que não casa nada é indistinguível de pasta limpa,
 *    zero casamentos conta como ausência e derruba o build também. Sem isso,
 *    renomear a pasta desligaria o guarda em silêncio.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Raiz do repositório a partir da localização deste arquivo — não do CWD. */
const RAIZ = fileURLToPath(new URL("../", import.meta.url));

/** `globSync` devolve o separador do SO; o log tem de ser igual no Windows e no Linux. */
const paraPosix = (p) => p.split(path.sep).join("/");

const PROIBIDOS_INGEST = [
  { padrao: /collection\(\s*["'`]cards["'`]\s*\)/, motivo: 'escreve/le a colecao "cards"' },
  { padrao: /\.delete\s*\(/, motivo: "apaga documento" },
  { padrao: /deleteDoc|FieldValue\.delete/, motivo: "apaga documento ou campo" },
  { padrao: /\btx\.set\s*\(/, motivo: "usa set() — deve usar create(), que falha se ja existir" },
];

const PROIBIDOS_COWORK = [
  { padrao: /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/, motivo: "expoe verbo de escrita" },
  // Escrita no Firestore especificamente. Um `.update(` solto pegaria
  // `createHash().update()`, que nao tem nada a ver com banco.
  {
    padrao: /(?:doc|collection)\s*\([^)]*\)\s*\.\s*(?:set|update|create|delete)\s*\(/,
    motivo: "escreve no Firestore",
  },
  { padrao: /\b(?:tx|batch)\s*\.\s*(?:set|update|create|delete)\s*\(/, motivo: "escreve via transacao/lote" },
  { padrao: /runTransaction|writeBatch|\.batch\s*\(/, motivo: "abre transacao ou lote de escrita" },
];

const REGRAS = [
  { arquivo: "src/lib/server/demand-ingest.ts", proibidos: PROIBIDOS_INGEST },
  {
    glob: "src/app/api/cowork/**/route.ts",
    ondeSumiu: "src/app/api/cowork",
    proibidos: PROIBIDOS_COWORK,
  },
];

let ausentes = 0;
let violacoes = 0;

/** Devolve os arquivos a inspecionar; lista vazia já contabilizou a ausência. */
function alvosDe(regra) {
  if (regra.arquivo) {
    if (!existsSync(path.join(RAIZ, regra.arquivo))) {
      console.error(
        `✗ ${regra.arquivo}: arquivo esperado nao existe — renomearam o caminho automatico? ` +
          "Aponte a regra para o novo caminho em scripts/check-demandas-boundary.mjs.",
      );
      ausentes++;
      return [];
    }
    return [regra.arquivo];
  }
  const achados = globSync(regra.glob, { cwd: RAIZ }).map(paraPosix).sort();
  if (achados.length === 0) {
    console.error(
      `✗ ${regra.ondeSumiu}: nenhuma rota do caminho automatico encontrada — a pasta foi renomeada ou movida? ` +
        "Aponte a regra para o novo caminho em scripts/check-demandas-boundary.mjs.",
    );
    ausentes++;
  }
  return achados;
}

for (const regra of REGRAS) {
  for (const rel of alvosDe(regra)) {
    const src = readFileSync(path.join(RAIZ, rel), "utf8");
    // Sem comentarios: a palavra "cards" aparece legitimamente na documentacao.
    const codigo = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const { padrao, motivo } of regra.proibidos) {
      if (padrao.test(codigo)) {
        console.error(`✗ ${rel}: ${motivo}  [${padrao}]`);
        violacoes++;
      }
    }
  }
}

if (ausentes > 0) {
  console.error(
    `\n${ausentes} alvo(s) da fronteira de demandas nao existe(m) mais.\n` +
      "O guarda perdeu o alvo — e um rename, nao uma regra furada.\n" +
      "Aponte a regra para o novo caminho; nao apague a regra.\n",
  );
}
if (violacoes > 0) {
  console.error(
    `\n${violacoes} violacao(oes) da fronteira de demandas.\n` +
      "O caminho automatico nao pode escrever em /cards nem apagar nada.\n" +
      "Um card so nasce em api/demandas/decidir, por decisao humana.\n",
  );
}
if (ausentes > 0 || violacoes > 0) process.exit(1);

console.log("fronteira de demandas: ok");
