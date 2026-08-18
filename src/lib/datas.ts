/**
 * Datas em ISO curto (yyyy-mm-dd), sempre no fuso local.
 *
 * `new Date("2026-07-13")` é interpretado como UTC e, no Brasil, volta para o
 * dia 12 — prazo que vence hoje aparece como vencido ontem. Todo parsing de
 * data do app passa por aqui de propósito, e nenhuma tela chama `new Date(iso)`
 * direto.
 *
 * Sem dependência de Firebase nem de React: roda igual no navegador, na rota
 * do cron e nos scripts de teste.
 */

export const MES_CURTO = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export const MES_LONGO = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Índices iguais aos de `Date.getDay()`: 0 = domingo. */
export const DOW_LABEL = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
export const DOW_SHORT = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];
/** Cabeçalho de calendário — a semana começa na segunda. */
export const DOW_MINI = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
/**
 * O mesmo cabeçalho sem o fim de semana.
 *
 * Sai daqui como fatia de `DOW_MINI`, e não como cinco rótulos escritos de
 * novo, porque é a semana começar na segunda que faz os cinco primeiros serem
 * exatamente os dias úteis — as duas constantes dependem da mesma decisão e
 * precisam quebrar juntas se alguém mudar a ordem. `DOW_MINI` fica inteiro:
 * recortar lá dentro decidiria pelos sete dias na tela de quem ainda os quer.
 */
export const DOW_MINI_UTEIS = DOW_MINI.slice(0, 5);

export function parseISO(iso: string): Date {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Segunda-feira da semana de `d`. */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7));
}

/**
 * Semana útil — a regra, e só ela.
 *
 * Ninguém na Rede trabalha sábado nem domingo. Três lugares dependem disso: a
 * grade do Cronograma, que passa a desenhar de segunda a sexta; o prazo do
 * formulário de demanda, que recusa fim de semana; e o gerador de recorrências,
 * que empurra a data prevista. Os três leem daqui. Regra de calendário copiada
 * em três telas é regra que diverge na primeira exceção — e ninguém descobre,
 * porque cada tela continua mostrando um número plausível.
 *
 * Cada pergunta tem duas funções, uma para `Date` e outra para o ISO curto, com
 * o sabor no nome. Uma só, aceitando os dois, seria onde o fuso volta a morder:
 * quem tivesse um `Date` na mão passaria por `new Date(iso)` no meio do caminho
 * sem perceber — que é exatamente o que o cabeçalho deste arquivo evita.
 *
 * (`WEEKDAYS`, em `recorrencias-core.ts`, responde outra pergunta: em que dias
 * uma regra de recorrência PODE ser marcada. Aqui a pergunta é sobre uma data
 * que já existe.)
 */
export function ehFimDeSemana(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

export function ehFimDeSemanaISO(iso: string): boolean {
  return ehFimDeSemana(parseISO(iso));
}

/**
 * O dia útil de `d` em diante — inclusivo: de segunda a sexta devolve o próprio
 * dia, e só sábado e domingo andam.
 *
 * Para FRENTE, de propósito: fim de semana vira a segunda seguinte, nunca a
 * sexta anterior. Puxar para trás encurtaria o prazo que a pessoa escolheu, e
 * uma demanda gerada com prazo em dia que já passou nasce vencida — o card
 * aparece vermelho antes de alguém ter tido chance de abri-lo.
 *
 * Devolve sempre à meia-noite local, como `addDays` e `startOfWeek`.
 */
export function proximoDiaUtil(d: Date): Date {
  let x = startOfDay(d);
  while (ehFimDeSemana(x)) x = addDays(x, 1);
  return x;
}

export function proximoDiaUtilISO(iso: string): string {
  return toISO(proximoDiaUtil(parseISO(iso)));
}

/** "sábado", "segunda-feira" — o nome do dia para a frase que explica a recusa. */
export function rotuloDoDia(d: Date): string {
  return DOW_LABEL[d.getDay()];
}

export function rotuloDoDiaISO(iso: string): string {
  return rotuloDoDia(parseISO(iso));
}

/** Dias decorridos desde `iso`: positivo = passado, negativo = futuro. */
export function daysBetween(iso: string, today: Date): number {
  return Math.round(
    (startOfDay(today).getTime() - parseISO(iso).getTime()) / 86400000,
  );
}

/** "13 jul" */
export function fmtDayMonth(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()} ${MES_CURTO[d.getMonth()]}`;
}

/** "hoje" · "há 3 dias" · "em 2 dias" */
export function relDay(iso: string, today: Date): string {
  const n = daysBetween(iso, today);
  if (n === 0) return "hoje";
  if (n > 0) return `há ${n} dia${n > 1 ? "s" : ""}`;
  return `em ${-n} dia${-n > 1 ? "s" : ""}`;
}

/** Número com uma casa e vírgula decimal — "2,5 h/mês". */
export function hh(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

/**
 * O INTERVALO de uma semana, para o rótulo do eixo x — "3–9 ago", "29 jul–4 ago".
 *
 * Existe porque o gráfico de fluxo do Dashboard rotulava a coluna com
 * `${dia}/${mês}` do começo da semana. A coluna cobre sete dias e dizia "3/08":
 * quem lê entende "3 de agosto" e conclui que a barra é do DIA. A reclamação
 * chegou exatamente assim, e não era engano de quem leu — era o rótulo
 * prometendo uma granularidade que o desenho não tem.
 *
 * O mês aparece uma vez quando a semana não atravessa a virada, e duas quando
 * atravessa. Repetir sempre ("3 ago–9 ago") gasta 3 caracteres num rótulo que
 * precisa caber em ~40px com 52 semanas na tela, e omitir sempre esconde a
 * virada, que é o único ponto onde o leitor pode se perder.
 *
 * Recebe `Date` e não ISO de propósito — quem chama já tem a segunda-feira
 * pronta de `startOfWeek`, e um desvio por `parseISO` no meio do caminho é a
 * volta do bug de fuso que o cabeçalho deste arquivo evita.
 */
export function rotuloSemana(inicio: Date): string {
  const fim = addDays(inicio, 6);
  return inicio.getMonth() === fim.getMonth()
    ? `${inicio.getDate()}–${fim.getDate()} ${MES_CURTO[fim.getMonth()]}`
    : `${inicio.getDate()} ${MES_CURTO[inicio.getMonth()]}–${fim.getDate()} ${MES_CURTO[fim.getMonth()]}`;
}

/**
 * A mesma semana por extenso — "3 a 9 de agosto de 2026" —, para o balão.
 *
 * O ano entra SEMPRE. No período de 12 meses o eixo dá a volta inteira e "29 de
 * dezembro" sem ano é ambíguo justamente na semana em que o leitor mais precisa
 * de certeza; e o balão tem largura de sobra, ao contrário do eixo.
 */
export function semanaPorExtenso(inicio: Date): string {
  const fim = addDays(inicio, 6);
  const di = inicio.getDate();
  const df = fim.getDate();
  const mi = MES_LONGO[inicio.getMonth()];
  const mf = MES_LONGO[fim.getMonth()];
  if (inicio.getFullYear() !== fim.getFullYear())
    return `${di} de ${mi} de ${inicio.getFullYear()} a ${df} de ${mf} de ${fim.getFullYear()}`;
  if (inicio.getMonth() !== fim.getMonth())
    return `${di} de ${mi} a ${df} de ${mf} de ${fim.getFullYear()}`;
  return `${di} a ${df} de ${mf} de ${fim.getFullYear()}`;
}
