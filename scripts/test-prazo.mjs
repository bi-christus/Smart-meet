/**
 * Testes da regra de prazo do card.
 *
 * Esta regra pinta o selo de TODO card do quadro e decide a cor de TODO galho
 * da árvore de dimensões. Ela não tinha teste nenhum até esta frente: morava
 * dentro de `dueInfo`, em `kanban/page.tsx`, junto do JSX.
 *
 * O que dói mais errar, e por isso vem primeiro aqui:
 *
 *  1. **Demanda entregue não atrasa.** O prazo pode ter passado depois de o
 *     trabalho terminar. Errar isso cobra, em vermelho, entrega já feita.
 *  2. **A hora do dia não muda o veredito.** Sem `inicioDoDia`, a mesma demanda
 *     com prazo para hoje seria "em dia" de manhã e "atrasada" à tarde.
 *  3. **`agingDays` conta 24 horas corridas, não viradas de meia-noite.** É o
 *     comportamento que já está em produção, e o teste existe para que ninguém
 *     o "conserte" sem querer numa refatoração.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  agingDays,
  dueInfo,
  estaAtrasada,
  fmtShort,
  inicioDoDia,
  msDaData,
  parseDue,
} from "../src/lib/prazo-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const HORA = 3600000;
const DIA = 86400000;

// 20/08/2026, uma quinta-feira, às 15h30.
const TARDE = new Date(2026, 7, 20, 15, 30).getTime();
const MANHA = new Date(2026, 7, 20, 6, 5).getTime();
const QUASE_MEIA_NOITE = new Date(2026, 7, 20, 23, 59).getTime();

console.log("\n— o básico —");

checa("parseDue lê aaaa-mm-dd no fuso local", parseDue("2026-08-20").getDate() === 20);
checa("fmtShort põe zero à esquerda", fmtShort(new Date(2026, 6, 3)) === "03/07");
checa("msDaData e parseDue concordam", msDaData("2026-08-20") === parseDue("2026-08-20").getTime());
checa(
  "inicioDoDia zera a hora",
  new Date(inicioDoDia(TARDE)).getHours() === 0 &&
    inicioDoDia(TARDE) === inicioDoDia(MANHA),
);

console.log("\n— atrasada —");

checa("prazo de ontem, em aberto, atrasa", estaAtrasada("2026-08-19", false, TARDE));
checa("prazo de hoje NÃO atrasa", !estaAtrasada("2026-08-20", false, TARDE));
checa("prazo de amanhã não atrasa", !estaAtrasada("2026-08-21", false, TARDE));
checa("sem prazo não atrasa", !estaAtrasada(null, false, TARDE));
checa("prazo indefinido não atrasa", !estaAtrasada(undefined, false, TARDE));

// Garantia nº 1 do cabeçalho.
checa(
  "ENTREGUE com prazo vencido há meses não atrasa",
  !estaAtrasada("2026-01-01", true, TARDE),
);

// Garantia nº 2 do cabeçalho — o mesmo dia, três horas diferentes.
checa(
  "a hora do dia não muda o veredito do prazo de hoje",
  !estaAtrasada("2026-08-20", false, MANHA) &&
    !estaAtrasada("2026-08-20", false, TARDE) &&
    !estaAtrasada("2026-08-20", false, QUASE_MEIA_NOITE),
);
checa(
  "a hora do dia não muda o veredito do prazo de ontem",
  estaAtrasada("2026-08-19", false, MANHA) &&
    estaAtrasada("2026-08-19", false, QUASE_MEIA_NOITE),
);

console.log("\n— o selo do card —");

checa("sem prazo tem tom próprio, não 'ok'", dueInfo(null, false, TARDE).tone === "none");
checa(
  "sem prazo diz o que está faltando",
  dueInfo(null, false, TARDE).label === "sem prazo definido",
);
checa("hoje é 'soon' e se chama Hoje", (() => {
  const i = dueInfo("2026-08-20", false, TARDE);
  return i.tone === "soon" && i.label === "Hoje";
})());
checa("amanhã se chama Amanhã", dueInfo("2026-08-21", false, TARDE).label === "Amanhã");
checa("ontem se chama Ontem, e é 'late'", (() => {
  const i = dueInfo("2026-08-19", false, TARDE);
  return i.tone === "late" && i.label === "Ontem";
})());
checa("dois dias atrás conta os dias", dueInfo("2026-08-18", false, TARDE).label === "2d atrás");
checa("três dias à frente ainda é 'soon'", dueInfo("2026-08-23", false, TARDE).tone === "soon");
checa("quatro dias à frente já é 'ok'", dueInfo("2026-08-24", false, TARDE).tone === "ok");
checa("prazo distante mostra a data", dueInfo("2026-09-15", false, TARDE).label === "15/09");
checa(
  "entregue é verde mesmo com a data no passado",
  dueInfo("2026-01-01", true, TARDE).tone === "done",
);
checa(
  "entregue mostra a data da entrega prometida",
  dueInfo("2026-01-01", true, TARDE).label === "entregue · 01/01",
);
checa(
  "o selo concorda com estaAtrasada, sempre",
  ["2026-08-18", "2026-08-19", "2026-08-20", "2026-09-01"].every(
    (d) =>
      (dueInfo(d, false, TARDE).tone === "late") === estaAtrasada(d, false, TARDE),
  ),
);

console.log("\n— parado —");

checa("sem enteredAt é zero, não um", agingDays(undefined, TARDE) === 0);
checa("entrou agora é zero", agingDays(TARDE, TARDE) === 0);
// Garantia nº 3 do cabeçalho: 24h corridas. Ontem às 23h ainda não fez um dia.
checa(
  "23 horas atrás ainda é zero — a conta é de 24h corridas",
  agingDays(TARDE - 23 * HORA, TARDE) === 0,
);
checa("25 horas atrás é um dia", agingDays(TARDE - 25 * HORA, TARDE) === 1);
checa("sete dias atrás são sete dias", agingDays(TARDE - 7 * DIA, TARDE) === 7);
checa("data no futuro não vira número negativo", agingDays(TARDE + DIA, TARDE) === 0);

console.log("\n— o core é puro —");

const fonte = readFileSync(join(raiz, "src/lib/prazo-core.ts"), "utf8");
checa("nada de firebase dentro do core (AGENTS.md §4)", !/from\s+["']firebase/.test(fonte));
checa("nada de react dentro do core", !/from\s+["']react["']/.test(fonte));

console.log("\n— a árvore usa esta regra, e não uma cópia —");

const arvore = readFileSync(join(raiz, "src/lib/dimensoes-core.ts"), "utf8");
checa(
  "dimensoes-core importa estaAtrasada de prazo-core",
  /from\s+["']\.\/prazo-core\.ts["']/.test(arvore),
);
checa(
  "dimensoes-core NÃO reimplementa a comparação de prazo",
  !/msDaData\(\s*c\.due\s*\)\s*<\s*inicioDoDia/.test(arvore),
);

console.log(falhas === 0 ? "\nprazo: ok" : `\nprazo: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
