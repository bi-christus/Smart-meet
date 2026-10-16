/**
 * Testes do código de versão (M0001, C0001).
 *
 * Os dois modos de falha que importam não dão erro em lugar nenhum:
 *  - número REPETIDO na mesma série — duas mudanças diferentes do mesmo app
 *    com o mesmo nome, que é o que o código existe para impedir;
 *  - título COMIDO — a migração tirando do título um pedaço que não era
 *    código ("sala M3"), e isso vai para centenas de demandas de uma vez.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  codigoVisivel,
  formatarCodigo,
  lerCodigo,
  planoDeMigracao,
  precisaDeCodigo,
  proximoNumero,
  tirarCodigoDoTitulo,
} from "../src/lib/codigo-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- formato ----------------------------------------------------------------
checa("formata com quatro dígitos", formatarCodigo("M", 7) === "M0007");
checa("lê código antigo de três dígitos", lerCodigo("c012")?.n === 12);
checa("não lê o que não é código", lerCodigo("X0001") === null && lerCodigo("") === null);

// --- o título ---------------------------------------------------------------
const casos = [
  ["M0001 - Filtro de data", "Filtro de data", "M"],
  ["m002 Tela de login", "Tela de login", "M"],
  ["C001: tela branca", "tela branca", "C"],
  ["[C0003] Botão some", "Botão some", "C"],
  ["Ajuste do gráfico - M0004", "Ajuste do gráfico", "M"],
  ["Erro no export (C010)", "Erro no export", "C"],
];
for (const [de, para, p] of casos) {
  const r = tirarCodigoDoTitulo(de);
  checa(`"${de}" → "${para}"`, r.titulo === para && r.achado?.prefixo === p, r.titulo);
}
const intactos = [
  "Reforma da sala M3",
  "Turma C12 sem professor",
  "a M0003 quebrou o login",
  "Melhoria 2000 do painel",
  "M0003",
  "C3PO",
];
for (const t of intactos) {
  checa(`"${t}" fica como está`, tirarCodigoDoTitulo(t).titulo === t && !tirarCodigoDoTitulo(t).achado);
}

// --- quem ganha código ------------------------------------------------------
checa("melhoria com produto precisa de M", precisaDeCodigo({ id: "a", type: "melhoria", produtoId: "p" }) === "M");
checa("correção sem produto não ganha", precisaDeCodigo({ id: "a", type: "correcao", produtoId: null }) === null);
checa("relatório com produto não ganha", precisaDeCodigo({ id: "a", type: "relatorio", produtoId: "p" }) === null);
checa(
  "quem já tem o código certo não ganha outro",
  precisaDeCodigo({ id: "a", type: "melhoria", produtoId: "p", codigo: "M0002", codigoProduto: "p" }) === null,
);
checa(
  "trocou de categoria: pede código da série nova e esconde o velho",
  precisaDeCodigo({ id: "a", type: "correcao", produtoId: "p", codigo: "M0002", codigoProduto: "p" }) === "C" &&
    codigoVisivel({ id: "a", type: "correcao", produtoId: "p", codigo: "M0002", codigoProduto: "p" }) === null,
);
checa(
  "trocou de produto: código velho some",
  codigoVisivel({ id: "a", type: "melhoria", produtoId: "q", codigo: "M0002", codigoProduto: "p" }) === null,
);

// --- o número não volta -----------------------------------------------------
const serie = [
  { id: "1", type: "melhoria", produtoId: "p", codigo: "M0001", codigoProduto: "p" },
  // virou correção, mas continua dono do 3 na série M
  { id: "2", type: "correcao", produtoId: "p", codigo: "M0003", codigoProduto: "p" },
  { id: "3", type: "melhoria", produtoId: "q", codigo: "M0009", codigoProduto: "q" },
];
checa("próximo número conta o código que ficou para trás", proximoNumero(serie, "p", "M") === 4);
checa("cada produto tem a sua série", proximoNumero(serie, "q", "M") === 10 && proximoNumero(serie, "p", "C") === 1);

// --- a migração -------------------------------------------------------------
const hist = [
  { id: "c", sector: "B.I.", title: "C001 tela branca", type: "correcao", produtoId: "p", criadoEm: 300 },
  { id: "a", sector: "B.I.", title: "M0005 - Filtro", type: "melhoria", produtoId: "p", criadoEm: 100 },
  { id: "b", sector: "B.I.", title: "Exportar PDF", type: "melhoria", produtoId: "p", criadoEm: 200 },
  { id: "d", sector: "B.I.", title: "M0002 sem produto", type: "melhoria", produtoId: null, criadoEm: 150 },
  { id: "e", sector: "B.I.", title: "Relatório mensal", type: "relatorio", produtoId: "p", criadoEm: 50 },
  { id: "f", sector: "B.I.", title: "Outro app", type: "melhoria", produtoId: "q", criadoEm: 400 },
];
const plano = planoDeMigracao(hist);
const por = new Map(plano.alteracoes.map((a) => [a.id, a]));
checa("numera na ordem de criação, e não pelo título", por.get("a")?.codigo === "M0001" && por.get("b")?.codigo === "M0002");
checa("correção tem série própria", por.get("c")?.codigo === "C0001");
checa("outro produto começa do 1", por.get("f")?.codigo === "M0001");
checa("tira o código manual do título", por.get("a")?.title === "Filtro" && por.get("c")?.title === "tela branca");
checa("título sem código não é reescrito", por.get("b")?.title === undefined);
checa("relatório não é tocado", !por.has("e"));
checa(
  "código no título sem produto fica intacto e é reportado",
  !por.has("d") && plano.semSerie.map((c) => c.id).join() === "d",
);

const depois = hist.map((c) => ({ ...c, ...(por.get(c.id) ?? {}) }));
const segunda = planoDeMigracao(depois);
checa(
  "rodar de novo não muda nada",
  segunda.alteracoes.length === 0,
  JSON.stringify(segunda.alteracoes),
);

console.log(falhas === 0 ? "\ncódigo de versão: ok" : `\ncódigo de versão: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
