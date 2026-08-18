/**
 * Testes dos emblemas.
 *
 * A REGRA AQUI ERRA EM DUAS DIREÇÕES, e só uma delas é barulhenta:
 *
 *  - APERTADA demais, alguém não recebe um emblema que conquistou. Reclamam.
 *  - FROUXA demais, alguém recebe um título que NÃO conquistou. Ninguém
 *    reclama, e é o pior dos dois — um reconhecimento que se dá sozinho deixa
 *    de significar qualquer coisa para todo mundo, inclusive para quem o ganhou
 *    de verdade.
 *
 * É por isso que o bloco maior deste arquivo não testa o caminho feliz: testa
 * documento torto, campo faltando, tipo errado e grafia divergente — que é o
 * estado em que um documento editável por gente, pelo console do Firebase e por
 * versões futuras deste app realmente chega.
 */
import {
  CONFIG_PADRAO,
  DEGRAUS_PADRAO,
  LIMITE_NOME_EMBLEMA,
  NIVEL_MAXIMO,
  chaveDeSetor,
  conquistados,
  contarEntregasPorSetorSolicitante,
  escopoDaContagem,
  maisPertoDoProximo,
  montarEmblemas,
  motivoDosDegraus,
  nivelDe,
  normalizarConfigEmblemas,
} from "../src/lib/emblemas-core.ts";
import { entreguesPorSetor } from "../src/lib/entregas-core.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const D = DEGRAUS_PADRAO;

console.log("\n— a escada padrão —");

checa(`tem ${NIVEL_MAXIMO} degraus`, D.length === NIVEL_MAXIMO);
checa("é estritamente crescente", D[0] < D[1] && D[1] < D[2]);
checa("todos inteiros e maiores que zero", D.every((n) => Number.isInteger(n) && n > 0));

console.log("\n— `nivelDe`: as bordas exatas —");

checa(`${D[0] - 1} → 0`, nivelDe(D[0] - 1, D) === 0);
checa(`${D[0]} → 1 (o degrau é inclusivo)`, nivelDe(D[0], D) === 1);
checa(`${D[1] - 1} → 1`, nivelDe(D[1] - 1, D) === 1);
checa(`${D[1]} → 2`, nivelDe(D[1], D) === 2);
checa(`${D[2] - 1} → 2`, nivelDe(D[2] - 1, D) === 2);
checa(`${D[2]} → 3`, nivelDe(D[2], D) === 3);
checa("muito acima do topo continua 3", nivelDe(D[2] * 5, D) === 3);
checa("zero é nível 0", nivelDe(0, D) === 0);

console.log("\n— `motivoDosDegraus`: uma frase por causa —");

checa("escada válida não tem motivo", motivoDosDegraus(3, 10, 25) === null);
const mTipo = motivoDosDegraus("3", 10, 25);
const mOrdem = motivoDosDegraus(30, 10, 25);
checa("tipo errado tem motivo", typeof mTipo === "string");
checa("ordem errada tem motivo", typeof mOrdem === "string");
// Uma frase só para dois problemas diferentes obriga o admin a adivinhar qual
// dos dois ele cometeu.
checa("as duas causas dão frases DIFERENTES", mTipo !== mOrdem);
checa("zero é recusado", typeof motivoDosDegraus(0, 10, 25) === "string");
checa("negativo é recusado", typeof motivoDosDegraus(-1, 10, 25) === "string");
checa("fracionário é recusado", typeof motivoDosDegraus(3.5, 10, 25) === "string");
checa("empate é recusado", typeof motivoDosDegraus(10, 10, 25) === "string");
checa("NaN é recusado", typeof motivoDosDegraus(NaN, 10, 25) === "string");

console.log("\n— leitura tolerante: TODO documento torto vira a escada padrão —");

/**
 * A ASSERÇÃO QUE MAIS IMPORTA DESTE ARQUIVO. Uma escada "remendada" —
 * aproveitar `[20, null, 100]` como `[20, 15, 100]` — pode ficar não-crescente,
 * e escada não-crescente dá o DEGRAU MÁXIMO a quem tem zero entrega.
 */
const TORTOS = [
  null,
  undefined,
  7,
  "config",
  [],
  {},
  { degraus: null },
  { degraus: [20, 50] },
  { degraus: [20, 50, 100, 200] },
  { degraus: ["20", "50", "100"] },
  { degraus: [50, 20, 100] },
  { degraus: [0, 50, 100] },
  { degraus: [20.5, 50, 100] },
  { degraus: [5, NaN, 100] },
  { degraus: [10, 10, 10] },
  { degraus: {} },
];
for (const t of TORTOS) {
  const c = normalizarConfigEmblemas(t);
  checa(
    `\`${JSON.stringify(t)}\` devolve a escada padrão INTEIRA`,
    c.degraus.join() === D.join(),
    c.degraus.join(),
  );
}
checa(
  "nenhuma entrada torta produz escada parcialmente aproveitada",
  TORTOS.every((t) => {
    const d = normalizarConfigEmblemas(t).degraus;
    return d[0] < d[1] && d[1] < d[2];
  }),
);
checa(
  "escada válida sobrevive",
  normalizarConfigEmblemas({ degraus: [4, 12, 30] }).degraus.join() === "4,12,30",
);
checa("`CONFIG_PADRAO` não tem setor nomeado", Object.keys(CONFIG_PADRAO.setores).length === 0);

console.log("\n— leitura tolerante: os nomes —");

const cfgNomes = normalizarConfigEmblemas({
  degraus: [3, 10, 25],
  setores: {
    infra: { setor: "Infraestrutura", nome: "Construtor" },
    compras: { setor: "Compras", nome: "   " },
    rh: { setor: "RH", nome: 7 },
    cvu: { setor: "CVU", nome: "x".repeat(LIMITE_NOME_EMBLEMA + 1) },
    odonto: "não é objeto",
    "  ": { setor: "vazio", nome: "Fantasma" },
    // Campo que uma versão futura escreveu e esta não conhece.
    nutricao: { setor: "Nutrição", nome: "Nutridor", degrausPorSetor: [1, 2, 3] },
  },
});

checa("nome bom sobrevive", cfgNomes.setores.infra.nome === "Construtor");
checa("nome só de espaços cai para vazio", cfgNomes.setores.compras.nome === "");
checa("nome não-string cai para vazio", cfgNomes.setores.rh.nome === "");
checa(
  `nome acima de ${LIMITE_NOME_EMBLEMA} cai para vazio`,
  cfgNomes.setores.cvu.nome === "",
);
checa("entrada não-objeto é ignorada", cfgNomes.setores.odonto === undefined);
checa("chave em branco é ignorada", !("" in cfgNomes.setores) && !("  " in cfgNomes.setores));
checa(
  "campo desconhecido não quebra a leitura",
  cfgNomes.setores.nutricao.nome === "Nutridor",
);
checa(
  "a chave é normalizada na leitura",
  normalizarConfigEmblemas({ setores: { "  INFRA ": { setor: "Infra", nome: "C" } } })
    .setores.infra?.nome === "C",
);

console.log("\n— contagem por setor solicitante —");

const ent = entreguesPorSetor({
  "B.I.": [
    { id: "backlog", title: "A fazer" },
    { id: "concluido", title: "Concluído" },
  ],
});
const c = (setor, extra = {}) => ({
  sector: "B.I.",
  columnId: "concluido",
  assignee: "ana@px",
  requesterSector: setor,
  ...extra,
});

const cards = [
  c("Infra"),
  c("infra "), // mesma coisa
  c(" INFRA"), // mesma coisa
  c("Compras"),
  c(null), // entregue, sem setor solicitante
  c("   "), // idem, gravado como espaços
  c("Infra", { columnId: "backlog" }), // não entregue
  c("Infra", { assignee: "bia@px" }), // de outra pessoa
];

const contagem = contarEntregasPorSetorSolicitante(cards, ent, "ana@px", CONFIG_PADRAO);

checa("as três grafias colapsam num setor só", contagem.porSetor.get("infra")?.entregues === 3);
checa("compras conta 1", contagem.porSetor.get("compras")?.entregues === 1);
checa("são dois setores, não quatro", contagem.porSetor.size === 2, String(contagem.porSetor.size));
checa("setor nulo e em branco vão para `semSetor`", contagem.semSetor === 2);
// 4 com setor (3 de Infra + 1 de Compras) + 2 sem = 6.
checa("o total inclui o que não tem setor", contagem.total === 6, String(contagem.total));
// As duas asserções abaixo se provam pela CONTAGEM DE INFRA, e não pelo total:
// o card da bia e o que ficou no backlog são os dois de Infra, então se
// qualquer um deles entrasse, Infra teria 4 ou 5 em vez de 3.
checa(
  "card de outra pessoa não entra",
  contagem.porSetor.get("infra")?.entregues === 3,
  String(contagem.porSetor.get("infra")?.entregues),
);
checa("card não entregue não entra", contagem.total === 6 && contagem.porSetor.get("infra")?.entregues === 3);

// A ordem do snapshot do Firestore NÃO é contrato. Sem uma regra determinística,
// o rótulo mudaria entre duas aberturas do mesmo perfil.
// Das três grafias ("Infra", "infra", "INFRA"), a menor pela collation pt-BR é
// a minúscula. O que importa não é QUAL delas vence, e sim que a escolha seja
// determinística: a ordem em que o Firestore devolve os documentos não é
// contrato, e sem regra o rótulo mudaria entre duas aberturas do mesmo perfil.
const grafias = ["Infra", "infra", "INFRA"];
const menor = [...grafias].sort((a, b) => a.localeCompare(b, "pt-BR"))[0];
checa(
  "sem nome do admin, o rótulo é a MENOR grafia por pt-BR",
  contagem.porSetor.get("infra")?.rotulo === menor,
  `${contagem.porSetor.get("infra")?.rotulo} (esperado ${menor})`,
);
const contagemComAdmin = contarEntregasPorSetorSolicitante(cards, ent, "ana@px", {
  degraus: D,
  setores: { infra: { setor: "Infraestrutura", nome: "Construtor" } },
});
checa(
  "com nome do admin, vence a grafia que o admin viu",
  contagemComAdmin.porSetor.get("infra")?.rotulo === "Infraestrutura",
);
checa("`chaveDeSetor` normaliza espaço e caixa", chaveDeSetor("  InFrA ") === "infra");

console.log("\n— `montarEmblemas` —");

const cfg = {
  degraus: [3, 10, 25],
  setores: { infra: { setor: "Infraestrutura", nome: "Construtor" } },
};
const lista = montarEmblemas(contagemComAdmin, cfg);

checa("o nome do admin vira o nome do emblema", lista.find((e) => e.chave === "infra")?.nome === "Construtor");
// Silencioso de propósito: "undefined" e "o setor some da lista" são as duas
// outras saídas, e as duas são piores.
checa(
  "setor sem nome definido usa o nome do próprio setor",
  lista.find((e) => e.chave === "compras")?.nome === "Compras",
);
checa("os de nível 0 CONTINUAM na lista", lista.some((e) => e.nivel === 0));
checa("`conquistados` filtra os de nível 0", conquistados(lista).every((e) => e.nivel >= 1));
checa("`conquistados` devolve [], nunca undefined", Array.isArray(conquistados([])));

const semDegrau = montarEmblemas(
  {
    porSetor: new Map([["x", { rotulo: "X", entregues: 100 }]]),
    semSetor: 0,
    total: 100,
  },
  cfg,
);
checa("no nível máximo `proximoDegrau` é null", semDegrau[0].proximoDegrau === null);
checa("no nível máximo `faltam` é null", semDegrau[0].faltam === null);
checa("no nível máximo o progresso é 1", semDegrau[0].progresso === 1);

const todos = montarEmblemas(
  {
    porSetor: new Map([
      ["a", { rotulo: "A", entregues: 0 }],
      ["b", { rotulo: "B", entregues: 1 }],
      ["c", { rotulo: "C", entregues: 30 }],
    ]),
    semSetor: 0,
    total: 31,
  },
  cfg,
);
checa(
  "o progresso fica sempre em [0,1] e nunca é NaN",
  todos.every((e) => Number.isFinite(e.progresso) && e.progresso >= 0 && e.progresso <= 1),
  todos.map((e) => e.progresso).join(", "),
);

console.log("\n— a ordem da faixa —");

const ordenados = montarEmblemas(
  {
    porSetor: new Map([
      // nível 2 com MAIS entregas que o de nível 3 é impossível com uma escada
      // crescente, mas nível 2 com 24 e nível 3 com 25 não é — e ordenar só por
      // entregas inverteria os dois, pondo o troféu menor na frente.
      ["dois", { rotulo: "Dois", entregues: 24 }],
      ["tres", { rotulo: "Tres", entregues: 25 }],
      ["um", { rotulo: "Um", entregues: 5 }],
    ]),
    semSetor: 0,
    total: 54,
  },
  cfg,
);
checa(
  "nível ↓ vem antes de entregas ↓",
  ordenados.map((e) => e.chave).join() === "tres,dois,um",
  ordenados.map((e) => `${e.chave}(n${e.nivel})`).join(),
);

const empate = montarEmblemas(
  {
    porSetor: new Map([
      ["zebra", { rotulo: "Zebra", entregues: 5 }],
      ["abelha", { rotulo: "Abelha", entregues: 5 }],
    ]),
    semSetor: 0,
    total: 10,
  },
  cfg,
);
checa("empate desempata por nome pt-BR", empate[0].nome === "Abelha");

console.log("\n— `maisPertoDoProximo`: pela FRAÇÃO, não pelo que falta —");

const perto = montarEmblemas(
  {
    porSetor: new Map([
      // 19/20 = 95% do caminho no degrau; 95/100 = 90%. Os dois faltando 5.
      ["a", { rotulo: "A", entregues: 19 }],
      ["b", { rotulo: "B", entregues: 95 }],
    ]),
    semSetor: 0,
    total: 114,
  },
  { degraus: [1, 20, 100], setores: {} },
);
const escolhido = maisPertoDoProximo(perto);
checa(
  "19 de 20 (95%) ganha de 95 de 100 (90%), mesmo os dois faltando 5",
  escolhido?.chave === "a",
  `${escolhido?.chave} (${escolhido?.progresso})`,
);
checa(
  "todo mundo no nível máximo devolve null",
  maisPertoDoProximo(semDegrau) === null,
);
checa("lista vazia devolve null", maisPertoDoProximo([]) === null);

console.log("\n— `escopoDaContagem` —");

checa("mesmos setores: completo", escopoDaContagem(["B.I."], ["B.I."]).completo);
checa(
  "pessoa em setor que não vejo: incompleto",
  !escopoDaContagem(["B.I."], ["B.I.", "RH"]).completo,
);
checa(
  "`ausentes` vem ordenado e sem duplicata",
  escopoDaContagem(["B.I."], ["RH", "Infra", "RH"]).ausentes.join() === "Infra,RH",
);
checa("pessoa sem setores nunca produz aviso", escopoDaContagem(["B.I."], null).completo);
checa("pessoa com [] nunca produz aviso", escopoDaContagem(["B.I."], []).completo);
checa(
  "quem não vê nada e olha alguém com setor: incompleto",
  !escopoDaContagem([], ["B.I."]).completo,
);

console.log("\n— o ícone existe —");

// Ícone ausente sai como um `<svg>` vazio: nenhum erro, nenhum aviso, e um
// quadrado em branco no cabeçalho do bloco.
const icons = readFileSync(join(raiz, "src/components/icons.tsx"), "utf8");
checa("`emblema` tem desenho em icons.tsx", /^\s{2}emblema:/m.test(icons));

console.log(falhas === 0 ? "\nemblemas: ok" : `\nemblemas: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
