/**
 * Testes das séries semanais do Dashboard (`lib/fluxo-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar o gráfico não prova: que a janela cai
 * nas semanas certas. Um gráfico deslocado em uma semana é desenhado exatamente
 * como um gráfico correto — mesmas barras, mesma linha, mesma cara — e o erro só
 * aparece quando alguém cruza um número dele com o quadro do Kanban, meses
 * depois. Por isso a maior parte das afirmações aqui é sobre BORDA: o domingo às
 * 23h59 que ainda é da semana que passou, a segunda 00h00 que já é da próxima, o
 * card criado um dia antes da janela abrir.
 *
 * O relógio entra por parâmetro em tudo (`hoje`), porque teste de data que lê o
 * relógio do sistema passa hoje e falha na segunda-feira seguinte.
 */
import {
  MAX_SEMANAS,
  calcularFluxo,
  isoDe,
  janelaDeSemanas,
  parseData,
  percentil,
  rotuloSemana,
} from "../src/lib/fluxo-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

/** Quarta-feira, 15 de julho de 2026. A semana dela vai de 13 a 19. */
const HOJE = new Date(2026, 6, 15);
const ms = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const nasceu = (y, m, d, h) => ({ createdAt: { seconds: ms(y, m, d, h) / 1000 } });
const entregue = (n, y, m, d, h) => ({ ...n, enteredAt: ms(y, m, d, h) });
const TUDO_CONCLUIDO = () => true;
const NADA_CONCLUIDO = () => false;

console.log("\n— a janela cai em semanas de segunda a domingo —");

const j12 = janelaDeSemanas(HOJE, { modo: "recentes", semanas: 12 });
checa("12 semanas pedidas, 12 devolvidas", j12.length === 12, String(j12.length));
checa(
  "a última é a semana de hoje, começando na segunda",
  isoDe(j12[11].inicio) === "2026-07-13" && isoDe(j12[11].fim) === "2026-07-19",
  `${isoDe(j12[11].inicio)}..${isoDe(j12[11].fim)}`,
);
checa(
  "a primeira está 11 semanas atrás",
  isoDe(j12[0].inicio) === "2026-04-27",
  isoDe(j12[0].inicio),
);
checa(
  "toda semana começa numa segunda",
  j12.every((s) => s.inicio.getDay() === 1),
);
checa(
  "toda semana termina num domingo, 6 dias depois",
  j12.every(
    (s) => s.fim.getDay() === 0 && s.fim - s.inicio === 6 * 86400000,
  ),
);

console.log("\n— a semana em curso é a única parcial —");

checa("só uma semana é parcial", j12.filter((s) => s.parcial).length === 1);
checa("e é a última", j12[11].parcial === true);

// Domingo 23h59 ainda é da semana que fecha; segunda 00h00 já é da próxima. É
// a borda que erra em silêncio: `<=` no lugar de `<` desloca o painel inteiro.
const noDomingo = janelaDeSemanas(new Date(2026, 6, 19, 23, 59), {
  modo: "recentes",
  semanas: 2,
});
checa(
  "domingo 23h59 ainda é a semana de 13/07",
  isoDe(noDomingo[1].inicio) === "2026-07-13" && noDomingo[1].parcial,
  isoDe(noDomingo[1].inicio),
);
const naSegunda = janelaDeSemanas(new Date(2026, 6, 20, 0, 0), {
  modo: "recentes",
  semanas: 2,
});
checa(
  "segunda 00h00 já é a semana de 20/07",
  isoDe(naSegunda[1].inicio) === "2026-07-20" && naSegunda[1].parcial,
  isoDe(naSegunda[1].inicio),
);

console.log("\n— intervalo escolhido à mão —");

const enc = janelaDeSemanas(HOJE, {
  modo: "intervalo",
  de: "2026-07-15",
  ate: "2026-07-20",
});
checa(
  "terça a segunda vira DUAS semanas cheias",
  enc.length === 2 &&
    isoDe(enc[0].inicio) === "2026-07-13" &&
    isoDe(enc[1].fim) === "2026-07-26",
  `${enc.length}: ${enc.map((s) => isoDe(s.inicio)).join(",")}`,
);
checa(
  "o mesmo dia nas duas pontas dá uma semana",
  janelaDeSemanas(HOJE, {
    modo: "intervalo",
    de: "2026-07-15",
    ate: "2026-07-15",
  }).length === 1,
);

const trocado = janelaDeSemanas(HOJE, {
  modo: "intervalo",
  de: "2026-07-20",
  ate: "2026-07-06",
});
checa(
  "fim antes do início troca as pontas em vez de zerar",
  trocado.length === 3 && isoDe(trocado[0].inicio) === "2026-07-06",
  `${trocado.length}: ${trocado.map((s) => isoDe(s.inicio)).join(",")}`,
);

checa(
  "data pela metade devolve janela vazia (é 'ainda não escolheu')",
  janelaDeSemanas(HOJE, { modo: "intervalo", de: "", ate: "2026-07-20" })
    .length === 0,
);

const passado = janelaDeSemanas(HOJE, {
  modo: "intervalo",
  de: "2026-01-05",
  ate: "2026-02-01",
});
checa(
  "intervalo todo no passado não tem semana parcial",
  passado.length === 4 && passado.every((s) => !s.parcial),
  `${passado.length} / ${passado.filter((s) => s.parcial).length} parcial(is)`,
);

const gigante = janelaDeSemanas(HOJE, {
  modo: "intervalo",
  de: "2000-01-03",
  ate: "2026-07-19",
});
checa(
  `intervalo absurdo para no teto de ${MAX_SEMANAS} semanas`,
  gigante.length === MAX_SEMANAS,
  String(gigante.length),
);
checa(
  "e o corte guarda o FIM pedido, não o começo",
  isoDe(gigante[gigante.length - 1].inicio) === "2026-07-13",
  isoDe(gigante[gigante.length - 1].inicio),
);

console.log("\n— o rótulo diz a semana inteira, não um dia —");

checa(
  "mesmo mês: o mês sai uma vez só",
  rotuloSemana(new Date(2026, 6, 13), new Date(2026, 6, 19), 2026) ===
    "13 a 19 jul",
  rotuloSemana(new Date(2026, 6, 13), new Date(2026, 6, 19), 2026),
);
checa(
  "meses diferentes: os dois aparecem",
  rotuloSemana(new Date(2026, 8, 28), new Date(2026, 9, 4), 2026) ===
    "28 set a 4 out",
  rotuloSemana(new Date(2026, 8, 28), new Date(2026, 9, 4), 2026),
);
checa(
  "semana de réveillon: o ano aparece nas DUAS pontas",
  rotuloSemana(new Date(2025, 11, 29), new Date(2026, 0, 4), 2026) ===
    "29 dez 2025 a 4 jan 2026",
  rotuloSemana(new Date(2025, 11, 29), new Date(2026, 0, 4), 2026),
);
checa(
  "semana inteira de outro ano também leva o ano",
  rotuloSemana(new Date(2025, 6, 14), new Date(2025, 6, 20), 2026) ===
    "14 jul 2025 a 20 jul 2025",
  rotuloSemana(new Date(2025, 6, 14), new Date(2025, 6, 20), 2026),
);

console.log("\n— parseData recusa o que não é data —");

checa("data boa vira meia-noite local", isoDe(parseData("2026-07-15")) === "2026-07-15");
checa("vazio é null", parseData("") === null);
checa("formato solto é null", parseData("15/07/2026") === null);
// O `Date` aceita 31/02 rolando para 3 de março. Um seletor de período que
// silenciosamente anda três dias é pior do que um que recusa.
checa("31 de fevereiro é null, não 3 de março", parseData("2026-02-31") === null);
checa("mês 13 é null", parseData("2026-13-01") === null);
checa("null/undefined não explodem", parseData(null) === null && parseData(undefined) === null);

console.log("\n— as séries —");

const cards = [
  // Três entradas na semana de 13/07, uma delas entregue na mesma semana.
  entregue(nasceu(2026, 7, 13), 2026, 7, 16),
  nasceu(2026, 7, 14),
  nasceu(2026, 7, 19, 23), // domingo à noite: ainda é 13/07
  // Uma na semana anterior, entregue na semana de 13/07.
  entregue(nasceu(2026, 7, 6), 2026, 7, 15),
  // Nasceu ANTES da janela e continua aberta: é fila inicial, não entrada.
  nasceu(2026, 5, 4),
];
const conc = (c) => c.enteredAt !== undefined;
const f = calcularFluxo(cards, conc, HOJE, { modo: "recentes", semanas: 2 });

checa("duas semanas na janela", f.semanas.length === 2);
checa("a semana de 06/07 teve 1 entrada", f.entradas[0] === 1, String(f.entradas[0]));
checa("a semana de 13/07 teve 3 entradas", f.entradas[1] === 3, String(f.entradas[1]));
checa("domingo 23h contou na semana certa", f.entradas[1] === 3);
checa("a semana de 13/07 teve 2 entregas", f.entregas[1] === 2, String(f.entregas[1]));
checa(
  "o card anterior à janela virou fila inicial, não entrada",
  f.filaInicial === 1 && f.totalEntradas === 4,
  `fila ${f.filaInicial}, entradas ${f.totalEntradas}`,
);
checa(
  "a fila acumula: 1 + 1 - 0 = 2, depois 2 + 3 - 2 = 3",
  f.fila[0] === 2 && f.fila[1] === 3,
  f.fila.join(","),
);
checa("o saldo é entrada menos entrega", f.saldo[0] === 1 && f.saldo[1] === 1, f.saldo.join(","));

// A semana parcial fora da média é a decisão que mais muda número na tela: com
// ela dentro, a vazão cairia toda segunda-feira sem nada ter acontecido.
checa(
  "a vazão média ignora a semana em curso (0 entregas / 1 semana completa)",
  f.vazaoMedia === 0,
  String(f.vazaoMedia),
);
const f2 = calcularFluxo(cards, conc, HOJE, { modo: "recentes", semanas: 3 });
checa(
  "com duas semanas completas, a vazão é a média delas",
  f2.vazaoMedia === 0,
  String(f2.vazaoMedia),
);

console.log("\n— fila nunca é negativa, e o vazio não quebra —");

const soEntregas = calcularFluxo(
  [entregue(nasceu(2026, 7, 14), 2026, 7, 15)],
  TUDO_CONCLUIDO,
  HOJE,
  { modo: "recentes", semanas: 2 },
);
checa("fila trava no zero", soEntregas.fila.every((v) => v >= 0), soEntregas.fila.join(","));

const nada = calcularFluxo([], NADA_CONCLUIDO, HOJE, { modo: "recentes", semanas: 12 });
checa(
  "sem card nenhum, as séries têm o tamanho da janela e são zeradas",
  nada.entradas.length === 12 && nada.entradas.every((v) => v === 0),
);
const semJanela = calcularFluxo(cards, conc, HOJE, {
  modo: "intervalo",
  de: "",
  ate: "",
});
checa(
  "janela vazia devolve séries vazias sem estourar",
  semJanela.semanas.length === 0 && semJanela.fila.length === 0,
);

console.log("\n— percentil —");
checa("p85 de 1..10 é 9", percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.85) === 9);
checa("lista vazia é 0", percentil([], 0.85) === 0);
checa("um elemento só devolve ele", percentil([7], 0.85) === 7);

console.log(falhas === 0 ? "\nfluxo: ok" : `\nfluxo: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
