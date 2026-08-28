/**
 * Testes das temporadas mensais do Rank.
 *
 * O QUE IMPORTA AQUI é a fronteira do mês — um card que entrou na coluna de
 * entrega no último minuto de um mês, e outro no primeiro minuto do
 * seguinte, não podem trocar de temporada por causa do fuso do servidor
 * (Vercel roda em UTC; a Rede está em Fortaleza). E o empate no topo: duas
 * pessoas com o mesmo número de entregas na primeira posição têm de virar
 * DOIS vencedores, nunca um escolhido por ordem alfabética.
 */
import {
  entregasDoMes,
  mesAnterior,
  mesAtual,
  mesDe,
  rotuloMes,
  vencedoresDoRanking,
} from "../src/lib/temporadas-core.ts";
import { entreguesPorSetor } from "../src/lib/entregas-core.ts";
import { montarRank } from "../src/lib/rank-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— `mesDe`, no fuso de quem trabalha —");

// 2026-08-31 23:30 em Fortaleza (UTC-3) é 2026-09-01 02:30 em UTC. Se a
// contagem usasse o relógio cru do servidor, esta entrega de agosto seria
// contada em setembro.
const ultimoMinutoDeAgosto = Date.UTC(2026, 8, 1, 2, 30); // 2026-09-01T02:30Z
checa(
  "23h30 do último dia do mês, no fuso local, ainda é do mês que termina",
  mesDe(ultimoMinutoDeAgosto) === "2026-08",
  mesDe(ultimoMinutoDeAgosto),
);

const primeiroMinutoDeSetembro = Date.UTC(2026, 8, 1, 3, 1); // 2026-09-01T03:01Z
checa(
  "um minuto depois, já é do mês seguinte",
  mesDe(primeiroMinutoDeSetembro) === "2026-09",
  mesDe(primeiroMinutoDeSetembro),
);

console.log("\n— `mesAtual` e `mesAnterior` —");

checa(
  "mesAtual lê o mês do relógio passado",
  mesAtual(new Date(Date.UTC(2026, 7, 15, 12, 0))) === "2026-08",
);
checa("janeiro volta pro dezembro do ano anterior", mesAnterior("2026-01") === "2025-12");
checa("mês comum só decrementa", mesAnterior("2026-08") === "2026-07");

console.log("\n— `rotuloMes` —");

checa("agosto de 2026", rotuloMes("2026-08") === "Agosto de 2026", rotuloMes("2026-08"));
checa("janeiro de 2027", rotuloMes("2027-01") === "Janeiro de 2027", rotuloMes("2027-01"));

console.log("\n— `entregasDoMes` —");

const ent = entreguesPorSetor({ "B.I.": [{ id: "concluido", title: "Concluído" }] });
const card = (o) => ({ sector: "B.I.", columnId: "concluido", ...o });

const cards = [
  card({ assignee: "ana@px", enteredAt: Date.UTC(2026, 7, 10) }), // agosto
  card({ assignee: "ana@px", enteredAt: Date.UTC(2026, 7, 20) }), // agosto
  card({ assignee: "bia@px", enteredAt: Date.UTC(2026, 8, 2) }), // setembro
  card({ assignee: "ana@px", enteredAt: null }), // sem data, fora de qualquer mês
  card({ columnId: "andamento", assignee: "ana@px", enteredAt: Date.UTC(2026, 7, 5) }), // não entregue
];

const agosto = entregasDoMes(cards, ent, "2026-08");
checa("ana tem 2 em agosto", agosto.por.get("ana@px") === 2, String(agosto.por.get("ana@px")));
checa("bia não aparece em agosto", !agosto.por.has("bia@px"));
checa("total de agosto é 2", agosto.total === 2, String(agosto.total));

const setembro = entregasDoMes(cards, ent, "2026-09");
checa("bia tem 1 em setembro", setembro.por.get("bia@px") === 1);
checa("ana não aparece em setembro", !setembro.por.has("ana@px"));

console.log("\n— `vencedoresDoRanking`: empate no topo é campeonato compartilhado —");

const empatados = montarRank([
  { chave: "ana@px", rotulo: "Ana", entregues: 5 },
  { chave: "bia@px", rotulo: "Bia", entregues: 5 },
  { chave: "cid@px", rotulo: "Cid", entregues: 3 },
]);
checa(
  "os dois primeiros lugares viram vencedores",
  vencedoresDoRanking(empatados).sort().join() === "ana@px,bia@px",
  vencedoresDoRanking(empatados).join(),
);

const semEmpate = montarRank([
  { chave: "ana@px", rotulo: "Ana", entregues: 9 },
  { chave: "bia@px", rotulo: "Bia", entregues: 5 },
]);
checa(
  "sem empate, só um vencedor",
  vencedoresDoRanking(semEmpate).join() === "ana@px",
);

checa(
  "ninguém entregou nada: nenhum vencedor",
  vencedoresDoRanking(montarRank([])).length === 0,
);

console.log(
  falhas === 0 ? "\ntemporadas: ok" : `\ntemporadas: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
