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

/**
 * O fuso de quem trabalha, e não o de onde o código roda.
 *
 * Fortaleza, onde a Rede está — o mesmo fuso que `scripts/test-datas.mjs` já
 * usa para provar a armadilha do `new Date(iso)`. As funções serverless da
 * Vercel rodam em UTC: às 21:00 daqui já é o dia seguinte lá, e um "hoje"
 * tirado do relógio cru marcaria como ATRASADA a demanda que vence hoje, no dia
 * em que ela ainda pode ser entregue. Erro de fuso em relatório de prazo não
 * parece erro: parece cobrança.
 */
export const FUSO_DO_SETOR = "America/Fortaleza";

/**
 * Que dia é hoje (aaaa-mm-dd) no fuso de quem trabalha.
 *
 * `en-CA` já formata nessa ordem, e é por isso que ele aparece aqui em vez de
 * `pt-BR` — não é descuido: `pt-BR` daria `18/08/2026`, que não se compara com
 * o `due` do card por ordenação de string, que é como todo o resto do app trata
 * data (ver `toISO`).
 *
 * `agora` entra por parâmetro para o teste ter relógio.
 */
export function hojeNoFuso(
  agora: Date = new Date(),
  fuso: string = FUSO_DO_SETOR,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
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
