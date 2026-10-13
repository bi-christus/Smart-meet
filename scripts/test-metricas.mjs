/**
 * Testes das métricas de entrega do Dashboard (`lib/metricas-core.ts`, #216).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar a tela não prova:
 *
 * 1. A JANELA É `[ini, fim)`, a mesma de `limitesDaJanela`: entrega no instante
 *    `fim` é da janela seguinte, e contá-la nas duas faria o KPI discordar do
 *    painel de fluxo ao lado.
 * 2. PONTUALIDADE É POR DIA, NO FUSO. Entregar às 23h do dia do prazo em
 *    Fortaleza é no prazo, mesmo já sendo o dia seguinte em UTC.
 * 3. SEM PRAZO NÃO ENTRA NA CONTA, nem no numerador nem no denominador.
 * 4. PRODUTO SEM MOVIMENTO NÃO GANHA LINHA, e demanda avulsa não vira linha
 *    "Sem produto".
 */
import {
  diaNoFuso,
  entreguesNaJanela,
  medidasPorProduto,
  medir,
  pctNoPrazo,
} from "../src/lib/metricas-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const DIA = 86400000;
// 10/08/2026 12:00 em Fortaleza (UTC-3) = 15:00 UTC.
const BASE = Date.UTC(2026, 7, 10, 15, 0, 0);
const seg = (ms) => ({ seconds: Math.floor(ms / 1000) });

const concluido = (c) => c.columnId === "done";

const cards = [
  // entregue em 4 dias, prazo folgado → no prazo
  { id: "a", columnId: "done", createdAt: seg(BASE - 4 * DIA), enteredAt: BASE, due: "2026-08-12", produtoId: "p1" },
  // entregue em 10 dias, prazo vencido → atrasado
  { id: "b", columnId: "done", createdAt: seg(BASE - 10 * DIA), enteredAt: BASE, due: "2026-08-05", produtoId: "p1" },
  // entregue em 2 dias, sem prazo → fora da pontualidade
  { id: "c", columnId: "done", createdAt: seg(BASE - 2 * DIA), enteredAt: BASE, due: null, produtoId: "p2" },
  // aberta no p2
  { id: "d", columnId: "doing", createdAt: seg(BASE - DIA), enteredAt: BASE, due: "2026-08-20", produtoId: "p2" },
  // avulsa entregue
  { id: "e", columnId: "done", createdAt: seg(BASE - 6 * DIA), enteredAt: BASE, due: "2026-08-10" },
  // entregue ANTES da janela, no p3 — não conta, e p3 não ganha linha
  { id: "f", columnId: "done", createdAt: seg(BASE - 40 * DIA), enteredAt: BASE - 30 * DIA, produtoId: "p3" },
];

const ini = BASE - 7 * DIA;
const fim = BASE + DIA;

// 1. Janela
const naJanela = entreguesNaJanela(cards, concluido, ini, fim);
checa("entregas na janela: a, b, c, e", naJanela.map((c) => c.id).join() === "a,b,c,e", naJanela.map((c) => c.id).join());
checa(
  "entrega exatamente em `fim` fica de fora",
  entreguesNaJanela([{ columnId: "done", enteredAt: fim }], concluido, ini, fim).length === 0,
);
checa(
  "entrega exatamente em `ini` entra",
  entreguesNaJanela([{ columnId: "done", enteredAt: ini }], concluido, ini, fim).length === 1,
);
checa(
  "card aberto não é entrega, mesmo com enteredAt na janela",
  entreguesNaJanela([{ columnId: "doing", enteredAt: BASE }], concluido, ini, fim).length === 0,
);

// 2 e 3. Medidas do quadro
const m = medir(naJanela);
checa("4 entregas", m.entregas === 4, String(m.entregas));
// lead times: 4, 10, 2, 6 → ordenado 2,4,6,10; p50 = índice 2 = 6; p85 = índice 3 = 10
checa("lead mediano = 6 dias", m.leadMediano === 6, String(m.leadMediano));
checa("lead p85 = 10 dias", m.leadP85 === 10, String(m.leadP85));
checa("3 com prazo (c não tem)", m.comPrazo === 3, String(m.comPrazo));
checa("2 no prazo (a e e — e no próprio dia)", m.noPrazo === 2, String(m.noPrazo));
checa("pctNoPrazo = 67%", pctNoPrazo(m) === 67, String(pctNoPrazo(m)));
checa("sem entrega com prazo → null", pctNoPrazo({ comPrazo: 0, noPrazo: 0 }) === null);
checa("sem entregas → lead null", medir([]).leadMediano === null && medir([]).leadP85 === null);

const tarde = Date.UTC(2026, 7, 11, 2, 0, 0); // 23h de 10/08 em Fortaleza
checa("23h em Fortaleza ainda é o dia 10", diaNoFuso(tarde) === "2026-08-10", diaNoFuso(tarde));
const mt = medir([{ enteredAt: tarde, createdAt: seg(tarde - DIA), due: "2026-08-10" }]);
checa("entregar às 23h do dia do prazo é no prazo", mt.noPrazo === 1 && mt.comPrazo === 1);

checa(
  "lead negativo vira zero",
  medir([{ enteredAt: BASE, createdAt: seg(BASE + 2 * DIA) }]).leadMediano === 0,
);
checa(
  "prazo malformado não conta",
  medir([{ enteredAt: BASE, due: "10/08/2026" }]).comPrazo === 0,
);

// 4. Por produto
const linhas = medidasPorProduto(cards, concluido, ini, fim);
checa("linhas só de p1 e p2", linhas.map((l) => l.produtoId).join() === "p1,p2", linhas.map((l) => l.produtoId).join());
const p1 = linhas.find((l) => l.produtoId === "p1");
const p2 = linhas.find((l) => l.produtoId === "p2");
checa("p1: 2 entregas, 1 de 2 no prazo, 0 abertas", p1.entregas === 2 && p1.noPrazo === 1 && p1.comPrazo === 2 && p1.abertas === 0);
checa("p2: 1 entrega sem prazo, 1 aberta", p2.entregas === 1 && p2.comPrazo === 0 && p2.abertas === 1);
checa(
  "produto só com demanda aberta também aparece",
  medidasPorProduto([{ columnId: "doing", produtoId: "x" }], concluido, ini, fim)[0]?.abertas === 1,
);

if (falhas) {
  console.error(`\n${falhas} falha(s) em test-metricas.`);
  process.exit(1);
}
console.log("\ntest-metricas: tudo certo.");
