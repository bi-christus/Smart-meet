/**
 * Testes do motor de datas das recorrências.
 *
 * Não é enfeite: este cálculo é o que decide QUANDO um card de manutenção
 * nasce no Kanban de um setor. Um erro de alinhamento na quinzena, ou um
 * "última sexta" que devolve a penúltima, não aparece na tela como erro —
 * aparece como manutenção que simplesmente não foi feita naquele mês.
 *
 * A janela de recuperação (`pendingDates`) tem o mesmo peso na direção
 * contrária: se o piso de data cair, uma regra ancorada em janeiro abre doze
 * cards vencidos de uma vez no primeiro dia em que o cron rodar.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  recDates,
  nthDowDate,
  pendingDates,
  patternLabel,
  recLoadHours,
  nextDateOf,
} from "../src/lib/recorrencias-core.ts";
import { toISO, parseISO, daysBetween } from "../src/lib/datas.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(`${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

function igual(rotulo, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  checa(rotulo, a === b, a === b ? "" : `obtido ${a}, esperado ${b}`);
}

const emJulho = (rec) =>
  recDates(rec, parseISO("2026-07-01"), parseISO("2026-07-31")).map(toISO);

// Julho de 2026: quintas 2/9/16/23/30 · terças 7/14/21/28 · sextas 3/10/17/24/31

// ---- semanal ----
igual(
  "toda quinta",
  emJulho({ pattern: { mode: "weekly", dow: 4, every: 1 }, since: "2026-01-08" }),
  ["2026-07-02", "2026-07-09", "2026-07-16", "2026-07-23", "2026-07-30"],
);

// A âncora é 8/jan (quinta). Semana sim/semana não a partir dela cai em 9 e 23
// de julho — se o salto até a janela perder o alinhamento, sai 2/16/30.
igual(
  "quinzenal alinhada à âncora",
  emJulho({ pattern: { mode: "weekly", dow: 4, every: 2 }, since: "2026-01-08" }),
  ["2026-07-09", "2026-07-23"],
);

// Âncora que NÃO cai no dia da semana da regra: a série começa na primeira
// quinta seguinte, não no próprio dia da âncora.
igual(
  "âncora em outro dia da semana",
  recDates(
    { pattern: { mode: "weekly", dow: 4, every: 1 }, since: "2026-07-06" },
    parseISO("2026-07-01"),
    parseISO("2026-07-15"),
  ).map(toISO),
  ["2026-07-09"],
);

// ---- mensal ----
igual(
  "2ª terça do mês",
  emJulho({ pattern: { mode: "monthly", ord: 2, dow: 2, everyM: 1 }, since: "2026-01-01" }),
  ["2026-07-14"],
);
igual(
  "última sexta do mês",
  emJulho({ pattern: { mode: "monthly", ord: -1, dow: 5, everyM: 1 }, since: "2026-01-01" }),
  ["2026-07-31"],
);
igual(
  "1ª segunda do mês",
  emJulho({ pattern: { mode: "monthly", ord: 1, dow: 1, everyM: 1 }, since: "2026-01-01" }),
  ["2026-07-06"],
);
// Bimestral ancorado em fevereiro: cai em fev/abr/jun/ago — julho fica vazio.
igual(
  "bimestral pula o mês fora da série",
  emJulho({ pattern: { mode: "monthly", ord: 1, dow: 5, everyM: 2 }, since: "2026-02-06" }),
  [],
);
igual(
  "bimestral acerta o mês da série",
  recDates(
    { pattern: { mode: "monthly", ord: 1, dow: 5, everyM: 2 }, since: "2026-02-06" },
    parseISO("2026-08-01"),
    parseISO("2026-08-31"),
  ).map(toISO),
  ["2026-08-07"],
);

// nthDowDate direto: "última" num mês que termina no próprio dia da semana.
checa(
  "última sexta quando o mês acaba numa sexta",
  toISO(nthDowDate(2026, 6, -1, 5)) === "2026-07-31",
);

// ---- janela de geração ----
const semanal = {
  id: "r1",
  name: "Backup",
  svc: "DW",
  kind: "rotina",
  sector: "B.I.",
  owner: null,
  pattern: { mode: "weekly", dow: 1, every: 1 }, // toda segunda
  since: "2026-01-05",
  estMin: 60,
  lead: 0,
  columnId: "backlog",
  acts: [],
  active: true,
};
const quinta16 = parseISO("2026-07-16");

igual(
  "sem antecedência, só o que já venceu na janela de recuperação",
  pendingDates(semanal, new Set(), quinta16),
  ["2026-07-13"],
);
igual(
  "antecedência de 7 dias alcança a próxima segunda",
  pendingDates({ ...semanal, lead: 7 }, new Set(), quinta16),
  ["2026-07-13", "2026-07-20"],
);
igual(
  "data já gerada não volta",
  pendingDates({ ...semanal, lead: 7 }, new Set(["2026-07-13"]), quinta16),
  ["2026-07-20"],
);
igual(
  "nada antes do cadastro da regra",
  pendingDates({ ...semanal, lead: 7, createdOn: "2026-07-15" }, new Set(), quinta16),
  ["2026-07-20"],
);
igual("regra pausada não gera", pendingDates({ ...semanal, active: false }, new Set(), quinta16), []);

// O piso de recuperação é o que impede a enxurrada: uma regra mensal ancorada
// em janeiro, vista pela primeira vez em julho, abre UM card — não sete.
const mensalAntiga = {
  ...semanal,
  pattern: { mode: "monthly", ord: 2, dow: 2, everyM: 1 },
  since: "2026-01-01",
  lead: 3,
};
igual(
  "mensal antiga não abre o ano inteiro de uma vez",
  pendingDates(mensalAntiga, new Set(), quinta16),
  ["2026-07-14"],
);

// ---- rótulos e carga ----
igual("rótulo semanal", patternLabel({ mode: "weekly", dow: 4, every: 1 }), "toda quinta-feira");
igual(
  "rótulo quinzenal",
  patternLabel({ mode: "weekly", dow: 4, every: 2 }),
  "quinta, semana sim / semana não",
);
igual(
  "rótulo mensal",
  patternLabel({ mode: "monthly", ord: -1, dow: 5, everyM: 1 }),
  "última sexta do mês",
);
igual(
  "rótulo bimestral",
  patternLabel({ mode: "monthly", ord: 1, dow: 1, everyM: 2 }),
  "1ª segunda, a cada 2 meses",
);

// 60 min toda semana ≈ 4,345 h/mês; 180 min uma vez por mês = 3 h/mês.
checa(
  "carga semanal em h/mês",
  Math.abs(recLoadHours({ pattern: { mode: "weekly", dow: 1, every: 1 }, estMin: 60, active: true }) - 4.345) < 0.001,
);
checa(
  "carga mensal em h/mês",
  Math.abs(recLoadHours({ pattern: { mode: "monthly", ord: 1, dow: 1, everyM: 1 }, estMin: 180, active: true }) - 3) < 0.001,
);
checa(
  "regra pausada não pesa",
  recLoadHours({ pattern: { mode: "weekly", dow: 1, every: 1 }, estMin: 60, active: false }) === 0,
);

igual("próxima data", nextDateOf(semanal, quinta16), "2026-07-20");

// ---- fuso: ISO puro não pode voltar um dia ----
checa("parseISO respeita o fuso local", toISO(parseISO("2026-07-13")) === "2026-07-13");
checa("daysBetween conta passado como positivo", daysBetween("2026-07-13", quinta16) === 3);
checa("daysBetween conta futuro como negativo", daysBetween("2026-07-20", quinta16) === -4);

console.log(falhas ? `\n${falhas} falha(s)` : "\nmotor de recorrências: ok");
process.exitCode = falhas === 0 ? 0 : 1;
