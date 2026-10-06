/**
 * Testes do cadastro de dimensões.
 *
 * O que este arquivo protege, em ordem de quanto dói errar:
 *
 *  1. **O id da subdimensão nunca é reaproveitado.** Ele é o que a demanda
 *     guarda. Reciclar um id depois de uma exclusão remanejaria demandas de uma
 *     subdimensão para outra, em silêncio.
 *  2. **A régua do nome é a mesma no TypeScript e em CEL.** Nenhum outro portão
 *     do projeto liga as duas — o `tsc` não lê CEL.
 *  3. **Documento torto não derruba o cadastro.** Uma subdimensão quebrada some
 *     da lista; a dimensão inteira continua.
 *
 * A aba Dimensões, e com ela os testes da árvore, saiu em 06/10/2026 (ver o
 * cabeçalho de `dimensoes-core.ts`).
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LIMITE_NOME_CHARS,
  PALETA_DIMENSAO,
  conferirNome,
  corDaDimensao,
  nomeExistente,
  normalizarDimensao,
  ordenarDimensoes,
  proximoIdDeSub,
} from "../src/lib/dimensoes-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log("\n— a régua do nome —");

checa("nome comum passa", conferirNome("Brigada", "da dimensão").ok);
checa("o nome volta aparado", conferirNome("  Brigada  ", "x").nome === "Brigada");
checa("vazio é recusado", !conferirNome("", "x").ok);
checa("só espaço é recusado", !conferirNome("   ", "x").ok);
checa("o que não é texto é recusado", !conferirNome(undefined, "x").ok);
checa("número é recusado", !conferirNome(42, "x").ok);
checa("o teto é respeitado", conferirNome("x".repeat(LIMITE_NOME_CHARS), "x").ok);
checa(
  "um caractere além do teto é recusado",
  !conferirNome("x".repeat(LIMITE_NOME_CHARS + 1), "x").ok,
);
// Acento conta um caractere para o `.length` do JS e para o `size()` do CEL.
checa(
  "nome acentuado é medido igual dos dois lados",
  conferirNome("ç".repeat(LIMITE_NOME_CHARS), "x").ok &&
    !conferirNome("ç".repeat(LIMITE_NOME_CHARS + 1), "x").ok,
);
checa(
  "o nome mais longo do documento da Infra cabe",
  conferirNome("Higiene, Hospitalidade e Logística Interna", "x").ok,
);
checa("a recusa explica o motivo", conferirNome("", "da dimensão").motivo.includes("dimensão"));

console.log("\n— duplicata —");

const lista = [
  { id: "a", nome: "Brigada" },
  { id: "b", nome: "Compras" },
];
checa("acha o igual", nomeExistente("Brigada", lista)?.id === "a");
checa("acha sem diferenciar caixa", nomeExistente("brigada", lista)?.id === "a");
checa("acha com espaço sobrando", nomeExistente("  BRIGADA ", lista)?.id === "a");
checa("não inventa o que não tem", nomeExistente("RH", lista) === undefined);

console.log("\n— id de subdimensão —");

checa("a primeira é s1", proximoIdDeSub([]) === "s1");
checa(
  "conta a partir do maior já emitido",
  proximoIdDeSub([{ id: "s1" }, { id: "s2" }, { id: "s3" }]) === "s4",
);
// A garantia nº 2 do cabeçalho: apagar do meio não recicla id.
checa(
  "apagar do meio NÃO recicla o id",
  proximoIdDeSub([{ id: "s1" }, { id: "s3" }]) === "s4",
);
checa(
  "id fora do padrão não confunde a conta",
  proximoIdDeSub([{ id: "legado" }, { id: "s7" }]) === "s8",
);

console.log("\n— leitura defensiva do documento —");

const dim = normalizarDimensao("d1", {
  nome: "  Pessoas  ",
  setor: "Infra",
  ordem: 3,
  subs: [
    { id: "s1", nome: "Ciclo de pessoal", tipo: "rotina" },
    { id: "s2", nome: "  Disciplina  ", tipo: "projeto" },
    { id: "s2", nome: "Repetida" }, // id repetido
    { id: "s3", nome: "" }, // sem nome
    { id: "", nome: "Sem id" },
    { nome: "Sem id nenhum" },
    null,
    "texto solto",
    { id: "s9", nome: "Sem tipo" }, // tipo ausente
  ],
});
checa("nome e setor voltam aparados", dim?.nome === "Pessoas");
checa("subdimensão quebrada não derruba a dimensão", dim?.subs.length === 3, JSON.stringify(dim?.subs));
checa("id repetido entra uma vez só", dim?.subs.filter((s) => s.id === "s2").length === 1);
checa("o nome da subdimensão volta aparado", dim?.subs[1]?.nome === "Disciplina");
checa("tipo ausente vira rotina, não projeto", dim?.subs[2]?.tipo === "rotina");
checa("sem nome, a dimensão inteira é descartada", normalizarDimensao("x", { setor: "Infra" }) === null);
checa("sem setor, a dimensão inteira é descartada", normalizarDimensao("x", { nome: "Solta" }) === null);
checa("documento que não é objeto é descartado", normalizarDimensao("x", null) === null);
checa("ordem ausente vira 0", normalizarDimensao("x", { nome: "A", setor: "S" })?.ordem === 0);

console.log("\n— ordem e cor —");

const ordenadas = ordenarDimensoes([
  { id: "c", nome: "Zebra", ordem: 1, setor: "S", subs: [] },
  { id: "a", nome: "Alfa", ordem: 1, setor: "S", subs: [] },
  { id: "b", nome: "Beta", ordem: 0, setor: "S", subs: [] },
]);
checa("ordena pelo número", ordenadas[0].id === "b");
checa("empate desempata pelo nome", ordenadas[1].id === "a" && ordenadas[2].id === "c");
checa("a paleta tem oito passos", PALETA_DIMENSAO.length === 8);
checa("a cor dá a volta na paleta", corDaDimensao(0) === corDaDimensao(8));
checa("ordem negativa não quebra a cor", typeof corDaDimensao(-3) === "string" && corDaDimensao(-3).startsWith("#"));

console.log("\n— o core é puro —");

const fonte = readFileSync(join(raiz, "src/lib/dimensoes-core.ts"), "utf8");
checa("nada de firebase dentro do core (AGENTS.md §4)", !/from\s+["']firebase/.test(fonte));
checa("nada de react dentro do core", !/from\s+["']react["']/.test(fonte));

console.log("\n— o TypeScript e a regra do Firestore concordam —");

const rules = readFileSync(join(raiz, "firestore.rules"), "utf8");
const bloco = rules.match(/match \/dimensoes\/\{[\s\S]*?\n {4}\}/);
checa("existe bloco /dimensoes nas regras", Boolean(bloco));
if (bloco) {
  const teto = bloco[0].match(/size\(\) <= (\d+)/);
  checa(
    "o teto de caracteres da regra é o mesmo do core",
    teto ? Number(teto[1]) === LIMITE_NOME_CHARS : false,
    teto ? `regra=${teto[1]} core=${LIMITE_NOME_CHARS}` : "não achei o teto",
  );
  checa("quem enxerga o setor lê", /allow read: if podeNoSetor\(cur\('setor'\)\);/.test(bloco[0]));
  checa("só gestor ou admin escreve", /gestorNoSetor\(/.test(bloco[0]));
  checa("a regra recusa nome vazio, como o core", /!= ''/.test(bloco[0]));
  checa(
    "o setor é imutável no update",
    /novo\('setor'\) == cur\('setor'\)/.test(bloco[0]),
    bloco[0],
  );
}

console.log(falhas === 0 ? "\ndimensoes: ok" : `\ndimensoes: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
