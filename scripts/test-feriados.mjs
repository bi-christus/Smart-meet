/**
 * Testes de `src/lib/feriados-core.ts`.
 *
 * Este arquivo existe porque o erro aqui é invisível por construção. Um feriado
 * calculado com um dia de diferença não derruba a tela, não cai no log e não
 * abre toast nenhum: o calendário desenha o adesivo na terça em vez da segunda,
 * e a única pessoa capaz de perceber é alguém que já sabia a data — que é
 * justamente quem não precisava do adesivo. A falha oposta é pior: o feriado que
 * simplesmente não aparece é indistinguível de um mês que não tem feriado.
 *
 * Por isso a estratégia é CRAVAR datas conferidas, e não reimplementar a fórmula
 * do outro lado. Um teste que recalcula a Páscoa com o mesmo algoritmo concorda
 * com qualquer erro que o algoritmo tenha; um teste que escreve "2026-04-05"
 * discorda dele. As datas abaixo vêm de calendário publicado.
 *
 * E todo ISO aqui é string literal, nunca `new Date`: um teste de calendário que
 * constrói datas com o relógio da máquina para de testar o calendário e passa a
 * testar o fuso de quem o roda — e a Vercel roda em UTC enquanto a máquina de
 * quem desenvolve roda em Fortaleza.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  diaSemExpediente,
  diasSemExpediente,
  domingoDePascoa,
  feriadoDe,
  feriadosDoAno,
  feriadosEntre,
  rotuloDoFeriado,
} from "../src/lib/feriados-core.ts";
import { ehFimDeSemanaISO, parseISO, DOW_LABEL } from "../src/lib/datas.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- a Páscoa, de onde tudo o mais depende --------------------------------
// Dez anos cravados. É aqui que a troca silenciosa pelo computus juliano seria
// pega: ele devolve 12/04 em 2026, uma semana depois, arrastando junto os cinco
// móveis sem produzir um sintoma na tela.
const PASCOA = {
  2024: "2024-03-31",
  2025: "2025-04-20",
  2026: "2026-04-05",
  2027: "2027-03-28",
  2028: "2028-04-16",
  2029: "2029-04-01",
  2030: "2030-04-21",
  2031: "2031-04-13",
  2032: "2032-03-28",
  2033: "2033-04-17",
};
for (const [ano, iso] of Object.entries(PASCOA)) {
  checa(
    `domingo de Páscoa de ${ano}`,
    domingoDePascoa(Number(ano)) === iso,
    domingoDePascoa(Number(ano)),
  );
}
// A Páscoa é domingo por definição. Este teste vale mesmo se alguém "corrigir" a
// tabela acima junto com o código: a propriedade não sai da tabela.
checa(
  "toda Páscoa calculada cai num domingo",
  Object.keys(PASCOA).every(
    (a) => parseISO(domingoDePascoa(Number(a))).getDay() === 0,
  ),
);

// --- os móveis, com data de calendário publicado --------------------------
const MOVEIS_CONFERIDOS = [
  ["2026-02-16", "Segunda-feira de Carnaval"],
  ["2026-02-17", "Terça-feira de Carnaval"],
  ["2026-02-18", "Quarta-feira de Cinzas (até as 14h)"],
  ["2026-04-03", "Sexta-feira Santa"],
  ["2026-06-04", "Corpus Christi"],
  ["2027-02-08", "Segunda-feira de Carnaval"],
  ["2027-02-09", "Terça-feira de Carnaval"],
  ["2027-02-10", "Quarta-feira de Cinzas (até as 14h)"],
  ["2027-03-26", "Sexta-feira Santa"],
  ["2027-05-27", "Corpus Christi"],
  ["2028-02-28", "Segunda-feira de Carnaval"],
  ["2028-02-29", "Terça-feira de Carnaval"],
  ["2028-03-01", "Quarta-feira de Cinzas (até as 14h)"],
  ["2028-04-14", "Sexta-feira Santa"],
  ["2028-06-15", "Corpus Christi"],
  ["2029-02-12", "Segunda-feira de Carnaval"],
  ["2029-02-13", "Terça-feira de Carnaval"],
  ["2029-03-30", "Sexta-feira Santa"],
  ["2029-05-31", "Corpus Christi"],
];
for (const [iso, nome] of MOVEIS_CONFERIDOS) {
  const f = feriadoDe(iso);
  checa(`${iso} é ${nome}`, f?.nome === nome, f ? f.nome : "não é feriado");
}
// 2028 é bissexto e a terça de Carnaval cai em 29 de fevereiro: 47 dias antes de
// 16 de abril só chega lá atravessando um fevereiro de 29 dias. É o melhor caso
// de teste do conjunto — aritmética de data que ignora o bissexto erra aqui e
// acerta em todo o resto.
checa(
  "o Carnaval de 2028 atravessa o 29 de fevereiro sem errar o dia",
  feriadoDe("2028-02-29")?.curto === "Carnaval",
);
// Corpus Christi é sempre quinta e Sexta-feira Santa é sempre sexta: a prova de
// que nenhum offset trocou de sinal nem foi contado a partir da âncora errada.
checa(
  "Corpus Christi cai sempre numa quinta-feira",
  [2026, 2027, 2028, 2029, 2030, 2031, 2032].every(
    (a) =>
      parseISO(feriadosDoAno(a).find((f) => f.nome === "Corpus Christi").iso)
        .getDay() === 4,
  ),
);
checa(
  "Sexta-feira Santa cai sempre numa sexta-feira",
  [2026, 2027, 2028, 2029, 2030, 2031, 2032].every(
    (a) =>
      parseISO(feriadosDoAno(a).find((f) => f.nome === "Sexta-feira Santa").iso)
        .getDay() === 5,
  ),
);

// --- os fixos -------------------------------------------------------------
const FIXOS_2026 = [
  ["2026-01-01", "Confraternização Universal"],
  ["2026-04-21", "Tiradentes"],
  ["2026-05-01", "Dia do Trabalho"],
  ["2026-09-07", "Independência do Brasil"],
  ["2026-10-12", "Nossa Senhora Aparecida, Padroeira do Brasil"],
  ["2026-11-02", "Finados"],
  ["2026-11-15", "Proclamação da República"],
  ["2026-11-20", "Dia Nacional de Zumbi e da Consciência Negra"],
  ["2026-12-25", "Natal"],
];
for (const [iso, nome] of FIXOS_2026) {
  checa(
    `${iso} é ${nome}`,
    feriadoDe(iso)?.nome === nome,
    feriadoDe(iso)?.nome ?? "null",
  );
}
// O caso que motivou a tela: 7 de setembro de 2026 é uma SEGUNDA-FEIRA, ou seja,
// tem célula na grade de segunda a sexta. Se algum dia isto falhar, quem estiver
// conferindo o print vai saber por quê antes de procurar bug no CSS.
checa(
  "7 de setembro de 2026 cai numa segunda-feira — tem célula na grade",
  DOW_LABEL[parseISO("2026-09-07").getDay()] === "segunda-feira",
  DOW_LABEL[parseISO("2026-09-07").getDay()],
);

// --- não existe "observed day" no Brasil ----------------------------------
// A Proclamação da República de 2026 cai num domingo e PERMANECE no domingo.
// Rolar para a segunda seguinte criaria um feriado que nenhum calendário do país
// tem — e faria a grade desenhar o adesivo num dia útil de verdade.
checa(
  "15/11/2026 é domingo",
  DOW_LABEL[parseISO("2026-11-15").getDay()] === "domingo",
  DOW_LABEL[parseISO("2026-11-15").getDay()],
);
checa(
  "e NÃO foi rolado para a segunda — 16/11/2026 é dia comum",
  feriadoDe("2026-11-16") === null,
  feriadoDe("2026-11-16")?.nome ?? "dia comum, como esperado",
);

// --- o 20 de novembro, que nem sempre foi nacional -------------------------
// A Lei 14.759 foi publicada em 22/12/2023, com vigência na data da publicação:
// 2024 é o primeiro ano valendo. O Cronograma navega para trás sem limite, e
// afirmar um feriado que não existia seria errar com cara de acerto.
checa(
  "20/11/2024 já é feriado nacional",
  feriadoDe("2024-11-20")?.tipo === "feriado",
  feriadoDe("2024-11-20")?.base ?? "null",
);
checa(
  "20/11/2023 ainda NÃO era feriado nacional",
  feriadoDe("2023-11-20") === null,
  feriadoDe("2023-11-20")?.nome ?? "fora, como esperado",
);
checa(
  "mas 25/12/2023 continua sendo Natal",
  feriadoDe("2023-12-25")?.nome === "Natal",
);

// --- e as outras duas datas que não nasceram com a Lei 662 -----------------
// A Lei 662/1949 declarou CINCO datas: 1º de janeiro, 1º de maio, 7 de setembro,
// 15 de novembro e 25 de dezembro. É fácil escrever "Lei 662/1949, desde 1949"
// nas nove linhas da tabela e seguir a vida — o texto fica plausível e ninguém
// confere. Tiradentes veio pela Lei 1.266, de dezembro de 1950, e Finados só
// pela Lei 10.607, de 19 de dezembro de 2002, DEPOIS do 2 de novembro daquele
// ano. Estes quatro testes existem para que a correção não apodreça na primeira
// vez que alguém "uniformizar" a tabela.
checa(
  "21/04/1950 ainda não era Tiradentes — a Lei 1.266 é de dezembro de 1950",
  feriadoDe("1950-04-21") === null,
  feriadoDe("1950-04-21")?.nome ?? "fora, como esperado",
);
checa(
  "21/04/1951 já é Tiradentes",
  feriadoDe("1951-04-21")?.tipo === "feriado",
  feriadoDe("1951-04-21")?.base ?? "null",
);
checa(
  "02/11/2002 ainda não era Finados — a Lei 10.607 é de 19 de dezembro",
  feriadoDe("2002-11-02") === null,
  feriadoDe("2002-11-02")?.nome ?? "fora, como esperado",
);
checa(
  "02/11/2003 já é Finados",
  feriadoDe("2003-11-02")?.tipo === "feriado",
  feriadoDe("2003-11-02")?.base ?? "null",
);
// E o que a Lei 662 realmente criou continua valendo desde 1949.
checa(
  "as cinco datas originais da Lei 662 valem em 1949",
  ["1949-01-01", "1949-05-01", "1949-09-07", "1949-11-15", "1949-12-25"].every(
    (iso) => feriadoDe(iso)?.base === "Lei 662/1949 (redação da Lei 10.607/2002)",
  ),
);
checa(
  "e nenhuma outra data fixa se diz criada pela Lei 662",
  feriadosDoAno(2026)
    .filter((f) => f.base.startsWith("Lei 662"))
    .map((f) => f.iso.slice(5))
    .join(" ") === "01-01 05-01 09-07 11-15 12-25",
  feriadosDoAno(2026)
    .filter((f) => f.base.startsWith("Lei 662"))
    .map((f) => f.iso.slice(5))
    .join(" "),
);

// --- expediente: o campo que impede a tela de mentir -----------------------
// Meio expediente NÃO é dia parado. Desenhar o adesivo de férias num dia em que
// metade do setor está na mesa de manhã é afirmação falsa — e é `diaSemExpediente`,
// não `feriadoDe`, que a célula chama justamente por isto.
const MEIO = [
  ["2026-02-18", "Quarta-feira de Cinzas"],
  ["2026-12-24", "véspera de Natal"],
  ["2026-12-31", "véspera de Ano-Novo"],
];
for (const [iso, nome] of MEIO) {
  checa(
    `${nome} está no módulo…`,
    feriadoDe(iso)?.expediente === "meio",
    feriadoDe(iso)?.expediente ?? "ausente",
  );
  checa(
    `…mas NÃO ganha o adesivo (${iso})`,
    diaSemExpediente(iso) === null,
    diaSemExpediente(iso)?.nome ?? "sem adesivo, como esperado",
  );
}
const PARADO = [
  ["2026-09-07", "Independência"],
  ["2026-02-16", "segunda de Carnaval"],
  ["2026-02-17", "terça de Carnaval"],
  ["2026-06-04", "Corpus Christi"],
  ["2026-04-03", "Sexta-feira Santa"],
  ["2026-12-25", "Natal"],
];
for (const [iso, nome] of PARADO) {
  checa(
    `${nome} ganha o adesivo (${iso})`,
    diaSemExpediente(iso)?.iso === iso,
    diaSemExpediente(iso)?.nome ?? "null",
  );
}

// --- a distinção que a tela escreve ---------------------------------------
// O adesivo é o mesmo nos dois; só o texto separa lei de costume.
checa(
  "Independência é feriado de lei",
  feriadoDe("2026-09-07")?.tipo === "feriado",
  feriadoDe("2026-09-07")?.tipo,
);
checa(
  "Carnaval é facultativo — não há lei federal que o crie",
  feriadoDe("2026-02-16")?.tipo === "facultativo",
  feriadoDe("2026-02-16")?.tipo,
);
checa(
  "Corpus Christi é facultativo",
  feriadoDe("2026-06-04")?.tipo === "facultativo",
  feriadoDe("2026-06-04")?.tipo,
);
checa(
  "Sexta-feira Santa vale como feriado",
  feriadoDe("2026-04-03")?.tipo === "feriado",
  feriadoDe("2026-04-03")?.tipo,
);
checa(
  "o rótulo de um feriado de lei diz 'Feriado nacional'",
  rotuloDoFeriado(feriadoDe("2026-09-07")) ===
    "Feriado nacional — Independência do Brasil",
  rotuloDoFeriado(feriadoDe("2026-09-07")),
);
checa(
  "o rótulo de um facultativo NÃO o chama de feriado nacional",
  rotuloDoFeriado(feriadoDe("2026-02-16")) ===
    "Ponto facultativo — Segunda-feira de Carnaval",
  rotuloDoFeriado(feriadoDe("2026-02-16")),
);
checa(
  "todo registro carrega a base legal — é o que responde quando alguém contesta",
  feriadosDoAno(2026).every((f) => f.base.length > 0),
);

// --- o nome curto, que é o que cabe na célula ------------------------------
// Sem ele o dia mais visível de outubro fica escrito "Nossa Senhora Apar…".
checa(
  "12 de outubro tem nome curto que cabe",
  feriadoDe("2026-10-12")?.curto === "Aparecida",
  feriadoDe("2026-10-12")?.curto,
);
checa(
  "nenhum nome curto passa de 17 caracteres",
  feriadosDoAno(2026).every((f) => f.curto.length <= 17),
  feriadosDoAno(2026)
    .map((f) => `${f.curto}(${f.curto.length})`)
    .join(" "),
);
checa(
  "e nenhum nome curto está vazio",
  feriadosDoAno(2026).every((f) => f.curto.trim().length > 0),
);

// --- colisão: dois feriados no mesmo dia ----------------------------------
// A Sexta-feira Santa varre de 20 de março a 23 de abril e atravessa o 21 de
// abril: sempre que a Páscoa cai em 23/04, Tiradentes e Paixão coincidem. É raro
// (2000 e 2079 no próximo século e meio) e é real, e o que a tela não pode fazer
// é alternar de nome entre dois renders.
checa(
  "2079: a Páscoa cai em 23/04, então a Sexta-Santa cai no Tiradentes",
  domingoDePascoa(2079) === "2079-04-23",
  domingoDePascoa(2079),
);
checa(
  "os dois estão na lista do ano — as duas coisas são verdade",
  feriadosDoAno(2079).filter((f) => f.iso === "2079-04-21").length === 2,
  feriadosDoAno(2079)
    .filter((f) => f.iso === "2079-04-21")
    .map((f) => f.nome)
    .join(" + "),
);
// CRAVA O VENCEDOR, e nao a funcao consigo mesma. `feriadoDe(x) === feriadoDe(x)`
// e verdade para qualquer implementacao — inclusive para uma que devolvesse a
// Paixao hoje e o Tiradentes depois de alguem trocar a ordem do spread em
// `feriadosDoAno`. O nome escrito aqui e o que impede essa troca de passar verde.
checa(
  "e a consulta de um dia devolve o Tiradentes, o feriado de data fixa",
  feriadoDe("2079-04-21")?.nome === "Tiradentes",
  feriadoDe("2079-04-21")?.nome ?? "null",
);

// --- forma da lista -------------------------------------------------------
const de2026 = feriadosDoAno(2026);
checa(
  "2026 tem 16 datas — 11 fixas + 5 móveis",
  de2026.length === 16,
  String(de2026.length),
);
// O 28 de outubro fica de FORA de proposito: e dispensa integral, e so na
// administracao publica federal. Marca-lo "meio expediente" esconderia o adesivo
// pelo motivo certo com o fato errado. Este teste guarda a decisao.
checa(
  "28 de outubro nao esta na tabela — a Rede e privada",
  feriadoDe("2026-10-28") === null,
  feriadoDe("2026-10-28")?.nome ?? "fora, como esperado",
);
checa(
  "a lista sai em ordem cronológica",
  de2026.every((f, i) => i === 0 || de2026[i - 1].iso <= f.iso),
  de2026.map((f) => f.iso).join(" "),
);
checa(
  "todo ISO gerado tem dez caracteres e zero à esquerda",
  de2026.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.iso)),
  de2026.map((f) => f.iso).join(" "),
);
checa(
  "todo feriado do ano pertence ao ano pedido",
  de2026.every((f) => f.iso.startsWith("2026-")),
);
// O Corpus Christi é o mais distante da âncora (60 dias depois da Páscoa) e a
// Páscoa mais tardia possível é 25 de abril — que acontece em 2038. Nem ali ele
// vaza para o ano seguinte.
checa(
  "nem no ano de Páscoa mais tardia algum feriado vaza para o ano seguinte",
  feriadosDoAno(2038).every((f) => f.iso.startsWith("2038-")),
  `Páscoa de 2038: ${domingoDePascoa(2038)}`,
);
// Nenhum campo do tipo interno (`mes`, `dia`, `desde`) pode vazar para o objeto
// que a tela recebe: `desde: 1949` do outro lado de uma serialização seria um
// enigma para quem o encontrasse.
checa(
  "o registro entregue não carrega a regra que o gerou",
  de2026.every(
    (f) => !("mes" in f) && !("dia" in f) && !("desde" in f) && !("offset" in f),
  ),
  Object.keys(de2026[0]).join(","),
);

// --- a consulta de intervalo ----------------------------------------------
// A janela do Cronograma é fechada nas duas pontas, e a de dezembro atravessa a
// virada de ano na vista de semana.
checa(
  "feriadosEntre inclui as duas pontas",
  feriadosEntre("2026-09-07", "2026-09-07").length === 1,
  String(feriadosEntre("2026-09-07", "2026-09-07").length),
);
const virada = feriadosEntre("2026-12-28", "2027-01-03");
checa(
  "feriadosEntre atravessa a virada de ano sem perder nem duplicar",
  virada.map((f) => f.iso).join(" ") === "2026-12-31 2027-01-01",
  virada.map((f) => `${f.iso} ${f.curto}`).join(" · "),
);
checa(
  "e diasSemExpediente descarta a véspera, ficando só com o Ano-Novo",
  diasSemExpediente("2026-12-28", "2027-01-03")
    .map((f) => f.iso)
    .join(" ") === "2027-01-01",
  diasSemExpediente("2026-12-28", "2027-01-03")
    .map((f) => f.iso)
    .join(" "),
);
checa(
  "intervalo invertido devolve lista vazia em vez de explodir",
  feriadosEntre("2026-12-31", "2026-01-01").length === 0,
);
checa(
  "intervalo sem feriado nenhum devolve lista vazia",
  feriadosEntre("2026-08-03", "2026-08-07").length === 0,
);

// --- o que a célula do calendário pergunta --------------------------------
checa(
  "dia comum devolve null, e não um objeto vazio",
  feriadoDe("2026-09-08") === null,
);
checa(
  "texto que não é data não explode — devolve null",
  feriadoDe("") === null &&
    feriadoDe("nao-e-data") === null &&
    feriadoDe("2026-09") === null,
);
// O cache por ano não pode mudar resposta: mesma pergunta, mesma resposta.
checa(
  "o cache nao muda resposta: o indice do ano devolve o que a lista tem",
  feriadoDe("2026-09-07")?.nome === "Independência do Brasil" &&
    feriadoDe("2026-12-25")?.nome === "Natal" &&
    feriadoDe("2026-04-03")?.nome === "Sexta-feira Santa",
);

// --- os que caem em fim de semana ----------------------------------------
// A grade do Cronograma vai de segunda a sexta: feriado em sábado ou domingo não
// tem célula. Esta contagem existe para provar que o caso é comum, e não uma
// exceção que dá para ignorar.
const noFds = diasSemExpediente("2026-01-01", "2026-12-31").filter((f) =>
  ehFimDeSemanaISO(f.iso),
);
checa(
  "há feriado em fim de semana em 2026 — a tira precisa dar conta deles",
  noFds.length > 0,
  noFds.map((f) => `${f.iso} ${f.curto}`).join(", "),
);

console.log(
  falhas === 0
    ? "\nTodos os testes de feriados passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
