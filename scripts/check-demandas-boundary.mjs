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
 */
import { readFileSync, existsSync } from "node:fs";

const REGRAS = [
  {
    arquivo: "src/lib/server/demand-ingest.ts",
    proibidos: [
      { padrao: /collection\(\s*["'`]cards["'`]\s*\)/, motivo: 'escreve/le a colecao "cards"' },
      { padrao: /\.delete\s*\(/, motivo: "apaga documento" },
      { padrao: /deleteDoc|FieldValue\.delete/, motivo: "apaga documento ou campo" },
      { padrao: /\btx\.set\s*\(/, motivo: "usa set() — deve usar create(), que falha se ja existir" },
    ],
  },
  {
    arquivo: "src/app/api/cowork/catalogo/route.ts",
    proibidos: [
      { padrao: /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/, motivo: "expoe verbo de escrita" },
      // Escrita no Firestore especificamente. Um `.update(` solto pegaria
      // `createHash().update()`, que nao tem nada a ver com banco.
      {
        padrao: /(?:doc|collection)\s*\([^)]*\)\s*\.\s*(?:set|update|create|delete)\s*\(/,
        motivo: "escreve no Firestore",
      },
      { padrao: /\b(?:tx|batch)\s*\.\s*(?:set|update|create|delete)\s*\(/, motivo: "escreve via transacao/lote" },
      { padrao: /runTransaction|writeBatch|\.batch\s*\(/, motivo: "abre transacao ou lote de escrita" },
    ],
  },
];

let falhas = 0;
for (const regra of REGRAS) {
  if (!existsSync(regra.arquivo)) {
    console.error(`✗ ${regra.arquivo}: arquivo nao encontrado`);
    falhas++;
    continue;
  }
  const src = readFileSync(regra.arquivo, "utf8");
  // Sem comentarios: a palavra "cards" aparece legitimamente na documentacao.
  const codigo = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const { padrao, motivo } of regra.proibidos) {
    if (padrao.test(codigo)) {
      console.error(`✗ ${regra.arquivo}: ${motivo}  [${padrao}]`);
      falhas++;
    }
  }
}

if (falhas > 0) {
  console.error(
    `\n${falhas} violacao(oes) da fronteira de demandas.\n` +
      "O caminho automatico nao pode escrever em /cards nem apagar nada.\n" +
      "Um card so nasce em api/demandas/decidir, por decisao humana.\n",
  );
  process.exit(1);
}
console.log("fronteira de demandas: ok");
