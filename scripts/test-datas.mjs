/**
 * Testes de `src/lib/datas.ts`.
 *
 * Errar aqui é caro porque não parece erro. Data errada não derruba a tela, não
 * cai no log, não abre um toast vermelho: ela mostra um número com cara de
 * número certo, e quem lê acredita. "Vence em 2 dias" quando vencia ontem é
 * indistinguível de "vence em 2 dias" quando vence em 2 dias — a única pista
 * seria alguém conferir no calendário, e ninguém confere o que já está escrito.
 *
 * Este arquivo inteiro existe por causa de uma linha: `new Date("2026-07-13")` é
 * lido como UTC e, em qualquer fuso a oeste de Greenwich — o Brasil todo —,
 * volta para o dia 12. Um dia inteiro perdido em silêncio, no lugar exato onde
 * o app promete prazo. `parseISO` é a resposta a isso, e o primeiro bloco aqui
 * é o teste que impede alguém de "simplificar" o parsing de volta ao bug.
 *
 * Os testes valem em qualquer fuso: o `prebuild` roda em UTC na Vercel e no
 * horário de Fortaleza na máquina de quem desenvolve, e nenhuma asserção pode
 * depender de qual dos dois é. Onde o fuso do Brasil precisa ser demonstrado, o
 * teste o nomeia explicitamente via `Intl`, em vez de torcer para o relógio da
 * máquina estar certo.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  addDays,
  daysBetween,
  DOW_LABEL,
  DOW_MINI,
  DOW_MINI_UTEIS,
  DOW_SHORT,
  ehFimDeSemana,
  ehFimDeSemanaISO,
  fmtDayMonth,
  FUSO_DO_SETOR,
  hh,
  hojeNoFuso,
  MES_CURTO,
  MES_LONGO,
  parseISO,
  proximoDiaUtil,
  proximoDiaUtilISO,
  relDay,
  rotuloDoDia,
  rotuloDoDiaISO,
  startOfDay,
  startOfWeek,
  toISO,
} from "../src/lib/datas.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

/** Só para o teste: o dia do mês de um instante lido num fuso nomeado. */
function diaEm(instante, fuso) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    day: "numeric",
  }).format(instante);
}

// --- a razão de ser do arquivo: parseISO não volta um dia ------------------
// Primeiro a armadilha, para o teste provar que ela é real e não folclore. O
// fuso é nomeado (Fortaleza, onde a Rede está) em vez de herdado da máquina,
// senão este bloco passaria por engano num runner em UTC.
checa(
  "new Date(iso) realmente volta um dia no fuso do Brasil",
  diaEm(new Date("2026-07-13"), "America/Fortaleza") === "12",
  `dia ${diaEm(new Date("2026-07-13"), "America/Fortaleza")} em Fortaleza`,
);

const p = parseISO("2026-07-13");
checa("parseISO devolve o dia que está escrito, não o anterior", p.getDate() === 13, String(p.getDate()));
checa("parseISO acerta o mês (julho = índice 6)", p.getMonth() === 6, String(p.getMonth()));
checa("parseISO acerta o ano", p.getFullYear() === 2026, String(p.getFullYear()));
// 01 de janeiro é o caso em que errar um dia erra também mês e ano de uma vez.
const ano = parseISO("2026-01-01");
checa(
  "1º de janeiro não vira 31 de dezembro do ano anterior",
  toISO(ano) === "2026-01-01",
  toISO(ano),
);

// --- hojeNoFuso: o dia de quem trabalha, não o do servidor ----------------
// A Vercel roda em UTC. Este bloco existe porque o erro aqui não parece erro:
// a demanda que vence hoje aparece como atrasada, e o resumo do dia vira
// cobrança indevida às 21h.
// 01:00 em UTC = 22:00 do dia anterior em Fortaleza. É a janela em que o
// relógio do servidor e o de quem trabalha discordam — e a única em que o erro
// aparece.
const NOITE = new Date("2026-08-19T01:00:00Z");
checa(
  "às 22h de Fortaleza ainda é hoje",
  hojeNoFuso(NOITE) === "2026-08-18",
  hojeNoFuso(NOITE),
);
checa(
  "e o MESMO instante lido em UTC já é o dia seguinte — a armadilha",
  hojeNoFuso(NOITE, "UTC") === "2026-08-19",
  hojeNoFuso(NOITE, "UTC"),
);
checa(
  "meia-noite e dez de Fortaleza já é o dia novo",
  hojeNoFuso(new Date("2026-08-19T03:10:00Z")) === "2026-08-19",
  hojeNoFuso(new Date("2026-08-19T03:10:00Z")),
);
checa(
  "o formato é o mesmo do `due` do card — dois dígitos, comparável como string",
  /^\d{4}-\d{2}-\d{2}$/.test(hojeNoFuso(new Date("2026-01-05T12:00:00Z"))),
  hojeNoFuso(new Date("2026-01-05T12:00:00Z")),
);
checa("o fuso padrão é o da Rede", FUSO_DO_SETOR === "America/Fortaleza");

// --- toISO: dois dígitos, sempre ------------------------------------------
// "2026-1-5" ordena depois de "2026-10-01" em comparação de string, e é assim
// que o Firestore e todo `sort()` do app ordenam data.
checa(
  "mês e dia de um dígito saem com zero à esquerda",
  toISO(new Date(2026, 0, 5)) === "2026-01-05",
  toISO(new Date(2026, 0, 5)),
);
checa(
  "dezembro e dia 31 saem inteiros",
  toISO(new Date(2026, 11, 31)) === "2026-12-31",
  toISO(new Date(2026, 11, 31)),
);
checa(
  "o ISO curto ordena como string na ordem do calendário",
  ["2026-10-01", "2026-01-05", "2026-02-10"].sort().join("|") ===
    "2026-01-05|2026-02-10|2026-10-01",
  ["2026-10-01", "2026-01-05", "2026-02-10"].sort().join("|"),
);

// --- ida e volta ------------------------------------------------------------
const IDAS = [
  "2026-01-01",
  "2026-01-05",
  "2026-02-28",
  "2024-02-29",
  "2026-07-13",
  "2026-12-31",
];
IDAS.forEach((iso) => {
  checa(`ida e volta preserva ${iso}`, toISO(parseISO(iso)) === iso, toISO(parseISO(iso)));
});
const volta = new Date(2026, 6, 13);
checa(
  "e no outro sentido: Date → ISO → Date cai no mesmo dia",
  toISO(parseISO(toISO(volta))) === toISO(volta),
);

// --- startOfDay -------------------------------------------------------------
checa(
  "startOfDay zera a hora sem mudar o dia",
  toISO(startOfDay(new Date(2026, 6, 13, 23, 59, 59))) === "2026-07-13",
  toISO(startOfDay(new Date(2026, 6, 13, 23, 59, 59))),
);
checa(
  "startOfDay de uma hora da manhã também fica no mesmo dia",
  toISO(startOfDay(new Date(2026, 6, 13, 0, 30))) === "2026-07-13",
);

// --- startOfWeek: a semana começa na segunda -------------------------------
// 2026-08-13 é quinta; a segunda da semana é 2026-08-10.
checa(
  "quinta volta para a segunda da mesma semana",
  toISO(startOfWeek(parseISO("2026-08-13"))) === "2026-08-10",
  toISO(startOfWeek(parseISO("2026-08-13"))),
);
// O caso que mais quebra: domingo pertence à semana que COMEÇOU na segunda
// anterior, não à que vai começar amanhã.
checa(
  "domingo pertence à semana que já passou, não à seguinte",
  toISO(startOfWeek(parseISO("2026-08-16"))) === "2026-08-10",
  toISO(startOfWeek(parseISO("2026-08-16"))),
);
checa(
  "segunda não anda sete dias para trás",
  toISO(startOfWeek(parseISO("2026-08-10"))) === "2026-08-10",
  toISO(startOfWeek(parseISO("2026-08-10"))),
);
checa(
  "na virada de mês a semana atravessa para trás",
  toISO(startOfWeek(parseISO("2026-09-01"))) === "2026-08-31",
  toISO(startOfWeek(parseISO("2026-09-01"))),
);
checa(
  "na virada de ano também",
  toISO(startOfWeek(parseISO("2027-01-01"))) === "2026-12-28",
  toISO(startOfWeek(parseISO("2027-01-01"))),
);
checa(
  "startOfWeek ignora a hora que vinha na data",
  toISO(startOfWeek(new Date(2026, 7, 16, 22, 10))) === "2026-08-10",
  toISO(startOfWeek(new Date(2026, 7, 16, 22, 10))),
);
// Invariante, e não um caso: a segunda de qualquer dia é sempre segunda, e
// nunca fica no futuro.
const semanaOk = Array.from({ length: 400 }, (_, i) => addDays(parseISO("2026-01-01"), i)).every(
  (d) => {
    const s = startOfWeek(d);
    return s.getDay() === 1 && s.getTime() <= startOfDay(d).getTime() && daysBetween(toISO(s), d) < 7;
  },
);
checa("em 400 dias seguidos, startOfWeek sempre cai numa segunda da semana corrente", semanaOk);

// --- addDays ----------------------------------------------------------------
checa(
  "atravessa o mês",
  toISO(addDays(parseISO("2026-08-31"), 1)) === "2026-09-01",
  toISO(addDays(parseISO("2026-08-31"), 1)),
);
checa(
  "atravessa o ano",
  toISO(addDays(parseISO("2026-12-31"), 1)) === "2027-01-01",
  toISO(addDays(parseISO("2026-12-31"), 1)),
);
checa(
  "número negativo anda para trás pelo ano",
  toISO(addDays(parseISO("2027-01-01"), -1)) === "2026-12-31",
  toISO(addDays(parseISO("2027-01-01"), -1)),
);
checa(
  "número negativo anda para trás pelo mês",
  toISO(addDays(parseISO("2026-03-01"), -1)) === "2026-02-28",
  toISO(addDays(parseISO("2026-03-01"), -1)),
);
checa(
  "ano bissexto tem 29 de fevereiro",
  toISO(addDays(parseISO("2024-02-28"), 1)) === "2024-02-29",
  toISO(addDays(parseISO("2024-02-28"), 1)),
);
checa(
  "ano comum não tem",
  toISO(addDays(parseISO("2026-02-28"), 1)) === "2026-03-01",
  toISO(addDays(parseISO("2026-02-28"), 1)),
);
checa("zero dias não move nada", toISO(addDays(parseISO("2026-07-13"), 0)) === "2026-07-13");
checa(
  "365 dias a partir de 1º de janeiro de ano comum caem no 1º de janeiro seguinte",
  toISO(addDays(parseISO("2026-01-01"), 365)) === "2027-01-01",
  toISO(addDays(parseISO("2026-01-01"), 365)),
);
checa(
  "addDays não altera a data que recebeu",
  (() => {
    const orig = parseISO("2026-07-13");
    addDays(orig, 30);
    return toISO(orig) === "2026-07-13";
  })(),
);

// --- daysBetween ------------------------------------------------------------
const hoje = parseISO("2026-08-13");
checa("mesma data dá zero", daysBetween("2026-08-13", hoje) === 0, String(daysBetween("2026-08-13", hoje)));
checa("passado é positivo", daysBetween("2026-08-10", hoje) === 3, String(daysBetween("2026-08-10", hoje)));
checa("futuro é negativo", daysBetween("2026-08-20", hoje) === -7, String(daysBetween("2026-08-20", hoje)));
checa(
  "a hora de `today` não conta: 23h59 ainda é hoje",
  daysBetween("2026-08-13", new Date(2026, 7, 13, 23, 59, 59)) === 0,
  String(daysBetween("2026-08-13", new Date(2026, 7, 13, 23, 59, 59))),
);
checa(
  "atravessa o ano",
  daysBetween("2026-12-31", parseISO("2027-01-01")) === 1,
  String(daysBetween("2026-12-31", parseISO("2027-01-01"))),
);

// --- horário de verão -------------------------------------------------------
// `daysBetween` divide por 86400000 e arredonda. Num dia de virada de horário de
// verão o dia local tem 23 ou 25 horas, e a divisão dá 0,958 ou 1,042 — o
// `Math.round` é o que segura isso, e é ele que estes testes vigiam. O Brasil
// não tem mais horário de verão desde 2019, mas o código roda no navegador de
// quem estiver onde estiver, e o intervalo abaixo cobre as duas viradas
// brasileiras de 2018/2019 além das do hemisfério norte de 2018 a 2020.
//
// A varredura é o teste de verdade: ela usa o fuso da máquina que estiver
// rodando, então fica vermelha em qualquer fuso onde a conta não se sustente,
// em vez de afirmar coisa sobre um fuso que ninguém está usando.
const INICIO = parseISO("2018-01-01");
const DIAS_VARRIDOS = 1096; // 2018, 2019 e 2020
let d = INICIO;
const consecutivosRuins = [];
const idaVoltaRuins = [];
for (let i = 0; i < DIAS_VARRIDOS; i++) {
  const iso = toISO(d);
  if (toISO(parseISO(iso)) !== iso) idaVoltaRuins.push(iso);
  const prox = addDays(d, 1);
  if (daysBetween(iso, prox) !== 1) consecutivosRuins.push(iso);
  d = prox;
}
checa(
  "dois dias seguidos distam 1, em todos os 1096 dias varridos",
  consecutivosRuins.length === 0,
  consecutivosRuins.slice(0, 5).join(", ") || `${DIAS_VARRIDOS} dias conferidos`,
);
checa(
  "ida e volta se sustenta mesmo no dia cuja meia-noite não existe",
  idaVoltaRuins.length === 0,
  idaVoltaRuins.slice(0, 5).join(", ") || `${DIAS_VARRIDOS} dias conferidos`,
);
const acumuladasRuins = [];
for (let i = 0; i < DIAS_VARRIDOS; i++) {
  if (daysBetween(toISO(addDays(INICIO, i)), INICIO) !== -i) acumuladasRuins.push(i);
}
checa(
  "a distância acumulada não deriva ao longo de três anos",
  acumuladasRuins.length === 0,
  acumuladasRuins.slice(0, 5).join(", ") || `${DIAS_VARRIDOS} distâncias conferidas`,
);
// As duas viradas brasileiras, nomeadas — para quem for ler o teste depois
// saber que elas foram consideradas, e não só varridas por acaso.
checa(
  "04/11/2018, o dia em que a meia-noite não existiu no Brasil, dista 1 do dia anterior",
  daysBetween("2018-11-03", parseISO("2018-11-04")) === 1,
  String(daysBetween("2018-11-03", parseISO("2018-11-04"))),
);
checa(
  "17/02/2019, o dia de 25 horas, também",
  daysBetween("2019-02-16", parseISO("2019-02-17")) === 1,
  String(daysBetween("2019-02-16", parseISO("2019-02-17"))),
);

// --- relDay: o plural é o que denuncia a régua -----------------------------
checa("hoje é 'hoje'", relDay("2026-08-13", hoje) === "hoje", relDay("2026-08-13", hoje));
checa(
  "um dia no passado é singular",
  relDay("2026-08-12", hoje) === "há 1 dia",
  relDay("2026-08-12", hoje),
);
checa(
  "dois dias no passado é plural",
  relDay("2026-08-11", hoje) === "há 2 dias",
  relDay("2026-08-11", hoje),
);
checa(
  "um dia no futuro é singular",
  relDay("2026-08-14", hoje) === "em 1 dia",
  relDay("2026-08-14", hoje),
);
checa(
  "dois dias no futuro é plural",
  relDay("2026-08-15", hoje) === "em 2 dias",
  relDay("2026-08-15", hoje),
);
checa(
  "o futuro nunca sai com sinal negativo escrito",
  !relDay("2026-09-13", hoje).includes("-"),
  relDay("2026-09-13", hoje),
);

// --- fmtDayMonth ------------------------------------------------------------
checa("13 de julho", fmtDayMonth("2026-07-13") === "13 jul", fmtDayMonth("2026-07-13"));
checa(
  "dia de um dígito aparece sem zero à esquerda (é rótulo, não chave)",
  fmtDayMonth("2026-01-05") === "5 jan",
  fmtDayMonth("2026-01-05"),
);
checa("dezembro", fmtDayMonth("2026-12-31") === "31 dez", fmtDayMonth("2026-12-31"));
checa(
  "o mês não escorrega um: o primeiro dia de março é 1 mar",
  fmtDayMonth("2026-03-01") === "1 mar",
  fmtDayMonth("2026-03-01"),
);

// --- hh ---------------------------------------------------------------------
checa("meia hora sai com vírgula", hh(2.5) === "2,5", hh(2.5));
checa("inteiro não ganha casa decimal", hh(2) === "2", hh(2));
checa("zero é zero", hh(0) === "0", hh(0));
checa("arredonda para baixo na primeira casa", hh(2.04) === "2", hh(2.04));
checa("arredonda para cima na primeira casa", hh(2.06) === "2,1", hh(2.06));
checa("não sobra ponto em número nenhum", !hh(10.25).includes("."), hh(10.25));
checa("terço de hora não vira dízima na tela", hh(1 / 3) === "0,3", hh(1 / 3));

// --- as tabelas de rótulo ---------------------------------------------------
checa("doze meses curtos", MES_CURTO.length === 12);
checa("doze meses longos", MES_LONGO.length === 12);
checa("os índices de mês batem entre as duas tabelas", MES_CURTO[2] === "mar" && MES_LONGO[2] === "março");
checa("sete dias em DOW_LABEL", DOW_LABEL.length === 7);
checa("sete dias em DOW_SHORT", DOW_SHORT.length === 7);
checa(
  "DOW_LABEL segue o índice de getDay(): 0 é domingo",
  DOW_LABEL[new Date(2026, 7, 16).getDay()] === "domingo",
  DOW_LABEL[new Date(2026, 7, 16).getDay()],
);

// ===========================================================================
// SEMANA ÚTIL
// ===========================================================================
// Daqui para baixo é a regra que o Cronograma, o formulário de demanda e o
// gerador de recorrências passam a consultar. Se ela divergir entre as três
// telas, o sintoma será um prazo que o formulário aceita e o Cronograma não
// desenha — um card que existe e não aparece em lugar nenhum.

// --- fim de semana ----------------------------------------------------------
checa("sábado é fim de semana", ehFimDeSemanaISO("2026-08-15"));
checa("domingo é fim de semana", ehFimDeSemanaISO("2026-08-16"));
[
  ["2026-08-10", "segunda"],
  ["2026-08-11", "terça"],
  ["2026-08-12", "quarta"],
  ["2026-08-13", "quinta"],
  ["2026-08-14", "sexta"],
].forEach(([iso, nome]) => {
  checa(`${nome} é dia útil`, !ehFimDeSemanaISO(iso), iso);
});
checa("a versão que recebe Date concorda com a que recebe ISO (sábado)", ehFimDeSemana(parseISO("2026-08-15")));
checa("e no dia útil também", !ehFimDeSemana(parseISO("2026-08-13")));
checa(
  "a hora não muda a resposta: sábado às 23h59 ainda é sábado",
  ehFimDeSemana(new Date(2026, 7, 15, 23, 59)),
);
// Invariante: numa semana qualquer, exatamente dois dias são fim de semana.
const semana = Array.from({ length: 7 }, (_, i) => addDays(parseISO("2026-08-10"), i));
checa(
  "de sete dias seguidos, exatamente dois são fim de semana",
  semana.filter(ehFimDeSemana).length === 2,
  String(semana.filter(ehFimDeSemana).length),
);

// --- próximo dia útil: sempre para frente ----------------------------------
checa(
  "sexta é dia útil e não anda",
  proximoDiaUtilISO("2026-08-14") === "2026-08-14",
  proximoDiaUtilISO("2026-08-14"),
);
checa(
  "sábado vai para a segunda seguinte, dois dias à frente",
  proximoDiaUtilISO("2026-08-15") === "2026-08-17",
  proximoDiaUtilISO("2026-08-15"),
);
checa(
  "domingo vai para a segunda seguinte, um dia à frente",
  proximoDiaUtilISO("2026-08-16") === "2026-08-17",
  proximoDiaUtilISO("2026-08-16"),
);
checa(
  "segunda não anda",
  proximoDiaUtilISO("2026-08-17") === "2026-08-17",
  proximoDiaUtilISO("2026-08-17"),
);
["2026-08-11", "2026-08-12", "2026-08-13"].forEach((iso) => {
  checa(`${iso} é dia útil e fica onde está`, proximoDiaUtilISO(iso) === iso, proximoDiaUtilISO(iso));
});
// A decisão que este bloco protege: para frente, nunca para trás. Se alguém
// trocar por "sexta anterior" para "não passar do prazo", estes dois quebram.
checa(
  "o sábado nunca é puxado para a sexta anterior",
  proximoDiaUtilISO("2026-08-15") !== "2026-08-14",
  proximoDiaUtilISO("2026-08-15"),
);
checa(
  "e o resultado nunca é anterior à data recebida",
  ["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17"].every(
    (iso) => proximoDiaUtilISO(iso) >= iso,
  ),
);

// --- próximo dia útil na virada de mês e de ano ----------------------------
checa(
  "sábado 31 de outubro vai para segunda 2 de novembro",
  proximoDiaUtilISO("2026-10-31") === "2026-11-02",
  proximoDiaUtilISO("2026-10-31"),
);
checa(
  "domingo 31 de maio vai para segunda 1º de junho",
  proximoDiaUtilISO("2026-05-31") === "2026-06-01",
  proximoDiaUtilISO("2026-05-31"),
);
checa(
  "sábado 28 de fevereiro vai para segunda 2 de março",
  proximoDiaUtilISO("2026-02-28") === "2026-03-02",
  proximoDiaUtilISO("2026-02-28"),
);
checa(
  "sábado 31 de dezembro atravessa o ano até 2 de janeiro",
  proximoDiaUtilISO("2022-12-31") === "2023-01-02",
  proximoDiaUtilISO("2022-12-31"),
);
checa(
  "domingo 31 de dezembro vira 1º de janeiro, que é segunda",
  proximoDiaUtilISO("2023-12-31") === "2024-01-01",
  proximoDiaUtilISO("2023-12-31"),
);
checa(
  "sábado 1º de janeiro anda para dentro do ano novo",
  proximoDiaUtilISO("2028-01-01") === "2028-01-03",
  proximoDiaUtilISO("2028-01-01"),
);

// --- próximo dia útil: a versão que recebe Date ----------------------------
checa(
  "a versão Date devolve meia-noite, como addDays e startOfWeek",
  (() => {
    const r = proximoDiaUtil(new Date(2026, 7, 15, 18, 42));
    return toISO(r) === "2026-08-17" && r.getMinutes() === 0 && r.getSeconds() === 0;
  })(),
  toISO(proximoDiaUtil(new Date(2026, 7, 15, 18, 42))),
);
checa(
  "a versão Date não altera a data que recebeu",
  (() => {
    const orig = new Date(2026, 7, 15);
    proximoDiaUtil(orig);
    return toISO(orig) === "2026-08-15";
  })(),
);
// Invariantes, sobre um ano inteiro: o resultado é sempre dia útil, nunca fica
// para trás e nunca empurra mais que dois dias.
const anoTodo = Array.from({ length: 366 }, (_, i) => addDays(parseISO("2026-01-01"), i));
checa(
  "em 366 dias, o próximo dia útil nunca cai em fim de semana",
  anoTodo.every((x) => !ehFimDeSemana(proximoDiaUtil(x))),
);
checa(
  "em 366 dias, ele nunca anda para trás",
  anoTodo.every((x) => proximoDiaUtil(x).getTime() >= startOfDay(x).getTime()),
);
checa(
  "em 366 dias, ele nunca empurra mais que dois dias",
  anoTodo.every((x) => daysBetween(toISO(x), proximoDiaUtil(x)) <= 2),
);
checa(
  "e é idempotente: aplicar duas vezes dá o mesmo dia",
  anoTodo.every((x) => toISO(proximoDiaUtil(proximoDiaUtil(x))) === toISO(proximoDiaUtil(x))),
);

// --- o rótulo do dia, para a frase de erro ---------------------------------
checa("sábado se chama sábado", rotuloDoDiaISO("2026-08-15") === "sábado", rotuloDoDiaISO("2026-08-15"));
checa("domingo se chama domingo", rotuloDoDiaISO("2026-08-16") === "domingo", rotuloDoDiaISO("2026-08-16"));
checa(
  "e o dia útil também tem nome, para quem precisar",
  rotuloDoDiaISO("2026-08-13") === "quinta-feira",
  rotuloDoDiaISO("2026-08-13"),
);
checa(
  "a versão Date concorda com a versão ISO",
  rotuloDoDia(parseISO("2026-08-15")) === rotuloDoDiaISO("2026-08-15"),
);
checa(
  "o rótulo do fim de semana é sempre sábado ou domingo",
  semana.filter(ehFimDeSemana).every((x) => ["sábado", "domingo"].includes(rotuloDoDia(x))),
);

// --- o cabeçalho da grade ---------------------------------------------------
checa(
  "a semana útil tem cinco colunas",
  DOW_MINI_UTEIS.length === 5,
  DOW_MINI_UTEIS.join(" "),
);
checa(
  "e vai de Seg a Sex",
  DOW_MINI_UTEIS.join(" ") === "Seg Ter Qua Qui Sex",
  DOW_MINI_UTEIS.join(" "),
);
checa(
  "sem sábado nem domingo",
  !DOW_MINI_UTEIS.includes("Sáb") && !DOW_MINI_UTEIS.includes("Dom"),
);
// O que amarra as duas constantes: DOW_MINI_UTEIS é a fatia dos cinco primeiros
// de DOW_MINI, e isso só é a semana útil porque a semana começa na segunda. Se
// alguém reordenar DOW_MINI para começar no domingo, é aqui que aparece.
checa(
  "DOW_MINI continua com os sete dias (outra tela ainda pode querê-los)",
  DOW_MINI.length === 7,
  DOW_MINI.join(" "),
);
checa(
  "a semana de DOW_MINI começa na segunda — é o que faz a fatia funcionar",
  DOW_MINI[0] === "Seg" && DOW_MINI[5] === "Sáb" && DOW_MINI[6] === "Dom",
  DOW_MINI.join(" "),
);
checa(
  "os cinco úteis são exatamente os cinco primeiros de DOW_MINI",
  DOW_MINI_UTEIS.join("|") === DOW_MINI.slice(0, 5).join("|"),
);
// A ligação entre o cabeçalho e o calendário: a coluna N da grade tem de ser o
// dia N da semana que começa na segunda.
checa(
  "a coluna de cada dia útil bate com o rótulo do cabeçalho",
  Array.from({ length: 5 }, (_, i) => addDays(startOfWeek(parseISO("2026-08-13")), i)).every(
    (x, i) => DOW_SHORT[x.getDay()].slice(0, 3).toLowerCase() === DOW_MINI_UTEIS[i].toLowerCase(),
  ),
);

console.log(
  falhas === 0
    ? "\nTodos os testes de datas passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
