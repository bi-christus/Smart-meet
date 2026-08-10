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
