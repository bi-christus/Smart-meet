/**
 * Testes das pastas do Portfólio (#229).
 *
 * O que dá errado aqui não aparece como erro na tela:
 *
 *  - O CICLO. Uma pasta dentro da própria filha (pelo console, ou por um
 *    arraste que escapou da conferência) faria qualquer função que sobe pela
 *    árvore girar para sempre — e a aba inteira travaria.
 *  - O PRODUTO QUE SOME. Pasta apagada, ou mãe de outro setor: o que estava
 *    dentro tem de aparecer em algum lugar (a raiz), nunca em lugar nenhum.
 *  - A EXCLUSÃO QUE APAGA. Excluir a pasta não pode levar produto junto.
 *  - A REGRA E O CORE DISCORDANDO sobre o teto do nome.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LIMITE_NOME_PASTA,
  arvoreDoSetor,
  caminhoDe,
  caminhoEscrito,
  conferirNomeDePasta,
  contagemPorPasta,
  filhasDe,
  idsDaSubarvore,
  nomeLivre,
  nomeRepetido,
  normalizarPasta,
  pastaCasaBusca,
  pastaDoProduto,
  planoDeConversao,
  planoDeExclusao,
  podeMoverPasta,
} from "../src/lib/portfolio-pastas-core.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(`${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

function pasta(id, nome, paiId = null, setor = "B.I.") {
  return { id, setor, nome, paiId, createdBy: "admin@px.com.br", createdAt: 1 };
}
function produto(id, pastaId, setor = "B.I.") {
  return pastaId ? { id, setor, pastaId } : { id, setor };
}

// ---------------------------------------------------------------------------
console.log("— o nome —");
checa("nome normal passa", conferirNomeDePasta("  Financeiro ").ok);
checa("vazio é recusado", !conferirNomeDePasta("   ").ok);
checa("só símbolo é recusado", !conferirNomeDePasta("---").ok);
checa(
  "o teto vale",
  conferirNomeDePasta("a".repeat(LIMITE_NOME_PASTA)).ok &&
    !conferirNomeDePasta("a".repeat(LIMITE_NOME_PASTA + 1)).ok,
);
checa("Nova pasta quando está livre", nomeLivre([]) === "Nova pasta");
checa(
  "Nova pasta (2), (3)… como no Windows",
  nomeLivre([{ nome: "Nova pasta" }, { nome: "nova PASTA (2)" }]) === "Nova pasta (3)",
);

// ---------------------------------------------------------------------------
console.log("\n— a leitura desconfiada —");
checa("sem setor é descartada", normalizarPasta("p", { nome: "X" }) === null);
checa(
  "nome torto vira 'Pasta sem nome' em vez de sumir com o que tem dentro",
  normalizarPasta("p", { setor: "B.I.", nome: "" })?.nome === "Pasta sem nome",
);
checa("mãe de si mesma vira raiz", normalizarPasta("p", { setor: "B.I.", nome: "X", paiId: "p" })?.paiId === null);
checa("paiId torto vira raiz", normalizarPasta("p", { setor: "B.I.", nome: "X", paiId: "a/b" })?.paiId === null);

{
  const ciclo = [pasta("a", "A", "b"), pasta("b", "B", "a"), pasta("c", "C", "a")];
  const arv = arvoreDoSetor(ciclo, "B.I.");
  checa(
    "ciclo a↔b é desfeito (as duas vão para a raiz) e a filha continua dentro",
    arv.find((p) => p.id === "a").paiId === null &&
      arv.find((p) => p.id === "b").paiId === null &&
      arv.find((p) => p.id === "c").paiId === "a",
  );
  const outroSetor = [pasta("x", "X", null, "RH"), pasta("y", "Y", "x", "B.I.")];
  checa(
    "mãe de outro setor não existe para este: a pasta vai para a raiz",
    arvoreDoSetor(outroSetor, "B.I.").find((p) => p.id === "y").paiId === null,
  );
  checa("só as pastas do setor entram", arvoreDoSetor(outroSetor, "B.I.").length === 1);
}

// ---------------------------------------------------------------------------
console.log("\n— a árvore —");
const arv = arvoreDoSetor(
  [
    pasta("fin", "Financeiro"),
    pasta("pai", "Painéis"),
    pasta("pai10", "Pasta 10"),
    pasta("pai2", "Pasta 2"),
    pasta("aca", "Acadêmico", "pai"),
    pasta("graf", "Gráficos", "aca"),
  ],
  "B.I.",
);
checa(
  "irmãs em ordem de nome, com número em ordem de número",
  filhasDe(arv, null).map((p) => p.nome).join("|") === "Financeiro|Painéis|Pasta 2|Pasta 10",
  filhasDe(arv, null).map((p) => p.nome).join("|"),
);
checa("caminho da raiz até a pasta", caminhoDe(arv, "graf").map((p) => p.id).join("/") === "pai/aca/graf");
checa("caminho escrito", caminhoEscrito(arv, "aca") === "Painéis › Acadêmico");
checa("caminho da raiz é vazio", caminhoDe(arv, null).length === 0 && caminhoEscrito(arv, null) === "");
checa("caminho de pasta que não existe é vazio", caminhoDe(arv, "zzz").length === 0);
checa("subárvore inclui netas", [...idsDaSubarvore(arv, "pai")].sort().join("|") === "aca|graf|pai");

checa("pasta não entra em si mesma", !podeMoverPasta(arv, "pai", "pai"));
checa("pasta não entra na neta", !podeMoverPasta(arv, "pai", "graf"));
checa("pasta entra numa irmã", podeMoverPasta(arv, "fin", "pai"));
checa("neta sobe para a raiz", podeMoverPasta(arv, "graf", null));
checa("mover para onde já está não é movimento", !podeMoverPasta(arv, "aca", "pai"));
checa("destino que não existe é recusado", !podeMoverPasta(arv, "fin", "zzz"));

checa("nome repetido entre irmãs, sem caixa", nomeRepetido(arv, null, "financeiro"));
checa("o mesmo nome em outro nível pode", !nomeRepetido(arv, "pai", "Financeiro"));
checa("renomear para o próprio nome não é repetição", !nomeRepetido(arv, null, "Financeiro", "fin"));

// ---------------------------------------------------------------------------
console.log("\n— os produtos —");
const prods = [
  produto("p1", "graf"),
  produto("p2", "aca"),
  produto("p3", "fin"),
  produto("p4"),
  produto("p5", "apagada"),
];
checa("produto em pasta que não existe aparece na raiz", pastaDoProduto(arv, prods[4]) === null);
const conta = contagemPorPasta(arv, prods);
checa("a contagem inclui as subpastas", conta.get("pai") === 2 && conta.get("aca") === 2 && conta.get("graf") === 1);
checa("pasta vazia conta zero", conta.get("pai2") === 0);

{
  const plano = planoDeExclusao(arv, prods, "aca");
  checa(
    "excluir a pasta sobe o conteúdo para a mãe, sem apagar produto",
    plano.destino === "pai" && plano.pastas.join() === "graf" && plano.produtos.join() === "p2",
  );
  checa("excluir pasta que não existe não faz nada", planoDeExclusao(arv, prods, "zzz") === null);
}

checa("busca de pasta sem acento nem caixa", pastaCasaBusca(arv.find((p) => p.id === "aca"), "ACADEMICO"));
checa("busca vazia não casa pasta nenhuma", !pastaCasaBusca(arv[0], "  "));

// ---------------------------------------------------------------------------
console.log("\n— a conversão da organização antiga (#226) —");
{
  const antigos = [
    { id: "a", setor: "B.I.", categoria: "Power BI", pasta: "Financeiro" },
    { id: "b", setor: "B.I.", categoria: "power bi", pasta: "financeiro" },
    { id: "c", setor: "B.I.", categoria: "Power BI" },
    { id: "d", setor: "B.I.", categoria: "Financeiro" },
    { id: "e", setor: "B.I." },
    { id: "f", setor: "B.I.", categoria: "Velha", pastaId: "fin" },
  ];
  const plano = planoDeConversao(arv, antigos);
  checa(
    "cria só o que falta, sem duplicar por caixa: Power BI e Power BI › Financeiro",
    plano.criar.length === 2 &&
      plano.criar[0].nome === "Power BI" &&
      plano.criar[0].paiId === null &&
      plano.criar[1].nome === "Financeiro" &&
      plano.criar[1].paiId === plano.criar[0].idProvisorio,
    JSON.stringify(plano.criar),
  );
  const destino = Object.fromEntries(plano.mover.map((m) => [m.produtoId, m.pastaId]));
  checa("as duas grafias caem na mesma subpasta", destino.a === destino.b && destino.a === plano.criar[1].idProvisorio);
  checa("categoria sem pasta vai para a pasta da categoria", destino.c === plano.criar[0].idProvisorio);
  checa("categoria com o nome de uma pasta que já existe a reaproveita", destino.d === "fin");
  checa("produto sem categoria fica de fora", !("e" in destino));
  checa("produto já arrastado para uma pasta nova não volta para a antiga", destino.f === "fin");
  checa(
    "a mãe vem antes da filha no plano (o id provisório já existe quando a filha chega)",
    plano.criar.findIndex((c) => c.idProvisorio === plano.criar[1].paiId) < 1,
  );
}

// ---------------------------------------------------------------------------
console.log("\n— o core é puro, e a regra concorda —");
const fonte = readFileSync(join(raiz, "src/lib/portfolio-pastas-core.ts"), "utf8");
checa("nada de firebase dentro do core (AGENTS.md §4)", !/from\s+["']firebase/.test(fonte));

const rules = readFileSync(join(raiz, "firestore.rules"), "utf8");
const bloco = rules.match(/match \/pastasPortfolio\/\{[\s\S]*?\n {4}\}/);
checa("existe bloco /pastasPortfolio nas regras", Boolean(bloco));
if (bloco) {
  const b = bloco[0];
  const teto = b.match(/nome\.size\(\) <= (\d+)/);
  checa(
    "o teto do nome é o mesmo dos dois lados",
    teto && Number(teto[1]) === LIMITE_NOME_PASTA,
    `regra=${teto?.[1]} core=${LIMITE_NOME_PASTA}`,
  );
  checa("quem enxerga o setor lê", /allow read: if podeNoSetor\(cur\('setor'\)\);/.test(b));
  checa(
    "criar, alterar e excluir são só de admin",
    /allow create:[\s\S]*?isAdmin\(\);/.test(b) &&
      /allow update:[\s\S]*?isAdmin\(\);/.test(b) &&
      /allow delete: if isAdmin\(\);/.test(b),
  );
  checa("setor, autor e data de criação são imutáveis", /!mudou\(\['setor', 'createdBy', 'createdAt'\]\)/.test(b));
  checa("a forma do documento é travada", /keys\(\)\.hasOnly\(/.test(b));
}

console.log(falhas === 0 ? "\npastas do portfolio: ok" : `\npastas do portfolio: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
