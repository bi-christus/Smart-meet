/**
 * Testes do andamento dos produtos do Portfólio (`lib/produtos-core.ts`, #209).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar a tela não prova:
 *
 * 1. PRODUTO SEM DEMANDA ABERTA NÃO GANHA NADA. A maioria do Portfólio é
 *    anterior ao Smart Meeting; um selo "0 em andamento" em cada um deles
 *    transformaria o acesso rápido num painel de zeros.
 * 2. A SAÚDE USA A MESMA RÉGUA DO CARD. O mapa de entregas é montado com
 *    `colunasEntregues` de verdade, e o prazo passa pelo mesmo `dueInfo` do selo
 *    do card — escrever a expectativa à mão aqui testaria a cópia, não a regra.
 * 3. DEMANDA ENTREGUE NÃO ATRASA. Prazo vencido depois de a demanda chegar em
 *    "Concluído" não pinta o produto de vermelho.
 */
import {
  SAUDE_ROTULO,
  andamentoPorProduto,
  rotuloDoSelo,
} from "../src/lib/produtos-core.ts";
import { entreguesPorSetor } from "../src/lib/entregas-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const PADRAO = [
  { id: "backlog", title: "A fazer" },
  { id: "andamento", title: "Em andamento" },
  { id: "aguardando", title: "Aguardando" },
  { id: "validacao", title: "Validação" },
  { id: "concluido", title: "Concluído" },
];
const COLUNAS = PADRAO.map((c) => ({ colId: c.id, title: c.title }));
const ENTREGUES = entreguesPorSetor({ "B.I.": PADRAO });
// 13/10/2026, meio-dia: o relógio do teste não pode ser o de quem roda.
const AGORA = new Date(2026, 9, 13, 12).getTime();

const card = (id, extra = {}) => ({
  id,
  title: id,
  sector: "B.I.",
  columnId: "andamento",
  ...extra,
});

console.log("\n— quem ganha selo —");

const CARDS = [
  card("v1", { produtoId: "vendas", columnId: "backlog", due: "2026-10-30" }),
  card("v2", { produtoId: "vendas", columnId: "andamento", due: "2026-10-20" }),
  card("v3", { produtoId: "vendas", columnId: "andamento" }),
  card("v4", { produtoId: "vendas", columnId: "concluido", due: "2026-09-01", enteredAt: 200 }),
  card("v5", { produtoId: "vendas", columnId: "concluido", enteredAt: 900 }),
  // Produto só com demanda entregue: está parado, e parado não tem selo.
  card("c1", { produtoId: "custos", columnId: "concluido", enteredAt: 50 }),
  // Demanda sem produto não pode aparecer em lugar nenhum desta conta.
  card("s1", { columnId: "andamento", due: "2026-01-01" }),
  card("s2", { produtoId: "   ", columnId: "andamento" }),
];
const mapa = andamentoPorProduto({
  cards: CARDS,
  colunas: COLUNAS,
  entregues: ENTREGUES,
  agora: AGORA,
});

checa("só o produto com demanda aberta entra", [...mapa.keys()].join(",") === "vendas", [...mapa.keys()].join(","));
checa("produto só com entregas não ganha selo", !mapa.has("custos"));
checa("demanda sem produto (ou com espaço em branco) não conta", !mapa.has("") && !mapa.has("   "));

const vendas = mapa.get("vendas");
checa("conta só as abertas", vendas.abertas === 3, String(vendas.abertas));
checa("o selo diz em andamento", rotuloDoSelo(vendas) === "3 em andamento");
checa(
  "as etapas saem na ordem do quadro, só as que têm demanda",
  vendas.porEtapa.map((e) => `${e.title}:${e.n}`).join(",") === "A fazer:1,Em andamento:2",
  vendas.porEtapa.map((e) => `${e.title}:${e.n}`).join(","),
);
checa(
  "os próximos prazos vêm do mais perto para o mais longe, sem os que não têm prazo",
  vendas.proximosPrazos.map((c) => c.id).join(",") === "v2,v1",
);
checa(
  "as entregas vêm da mais recente para a mais antiga",
  vendas.entregues.map((c) => c.id).join(",") === "v5,v4",
);

console.log("\n— a saúde usa a régua do card —");

checa("tudo com folga é em dia", vendas.saude === "em-dia", vendas.saude);
// A v4 venceu em setembro, mas está em "Concluído": entregue não atrasa.
checa("entregue com prazo vencido não pinta de vermelho", vendas.atrasadas === 0);

const comAtraso = andamentoPorProduto({
  cards: [...CARDS, card("v6", { produtoId: "vendas", due: "2026-10-10" })],
  colunas: COLUNAS,
  entregues: ENTREGUES,
  agora: AGORA,
}).get("vendas");
checa("uma atrasada basta para o produto estar atrasado", comAtraso.saude === "atrasada");
checa("e a contagem diz quantas", comAtraso.atrasadas === 1);

const comPrazoPerto = andamentoPorProduto({
  cards: [card("p1", { produtoId: "x", due: "2026-10-15" })],
  colunas: COLUNAS,
  entregues: ENTREGUES,
  agora: AGORA,
}).get("x");
checa("vence em até 3 dias é atenção — o mesmo 'soon' do selo do card", comPrazoPerto.saude === "atencao");

const semPrazo = andamentoPorProduto({
  cards: [card("p2", { produtoId: "y" })],
  colunas: COLUNAS,
  entregues: ENTREGUES,
  agora: AGORA,
}).get("y");
checa("sem prazo não é atraso — ninguém prometeu data", semPrazo.saude === "em-dia");

console.log("\n— o que sobra de borda —");

const orfa = andamentoPorProduto({
  cards: [card("o1", { produtoId: "z", columnId: "apagada" })],
  colunas: COLUNAS,
  entregues: ENTREGUES,
  agora: AGORA,
}).get("z");
checa(
  "card em etapa que não existe mais continua contado, com o id no lugar do nome",
  orfa.abertas === 1 && orfa.porEtapa[0].title === "apagada",
);
checa(
  "toda saúde tem rótulo",
  ["atrasada", "atencao", "em-dia"].every((s) => !!SAUDE_ROTULO[s]),
);

console.log(falhas === 0 ? "\nprodutos: ok" : `\nprodutos: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
