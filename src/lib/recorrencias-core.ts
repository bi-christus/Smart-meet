/**
 * Recorrências — tipos e motor de datas, sem Firebase.
 *
 * Manutenção programada dos apps e serviços de um setor: cada data prevista
 * abre um card NOVO no Kanban, já com as atividades da regra como checklist. O
 * mesmo card nunca é reaberto — assim o histórico mostra o que foi feito em
 * cada ciclo, em vez de um card eterno que ninguém sabe quando foi tocado.
 *
 * Este arquivo vive separado do CRUD porque o cálculo roda nos DOIS lados: na
 * tela (mostrar as próximas datas) e na rota do cron (abrir os cards que já
 * venceram). Importar o SDK do cliente no servidor arrastaria o Firebase
 * inteiro para dentro da função — e a conta é exatamente a mesma.
 *
 * A regra nunca é "a cada N dias": é sempre dia da semana + posição no mês.
 * Intervalo em dias derrapa o calendário até cair num sábado, e manutenção que
 * cai no fim de semana simplesmente não é feita.
 */

import {
  addDays,
  daysBetween,
  DOW_LABEL,
  DOW_SHORT,
  parseISO,
  startOfDay,
  toISO,
} from "./datas.ts";

export type RecKind = "app" | "painel" | "rotina" | "integracao" | "processo";

export const REC_KIND_LABEL: Record<RecKind, string> = {
  app: "App",
  painel: "Painel / BI",
  rotina: "Rotina / ETL",
  integracao: "Integração",
  processo: "Processo",
};

export const REC_KIND_COLOR: Record<RecKind, string> = {
  app: "#c084fc",
  painel: "#ff6a2b",
  rotina: "#54b8ff",
  integracao: "#2dd4bf",
  processo: "#f5b13d",
};

export const REC_KINDS = Object.keys(REC_KIND_LABEL) as RecKind[];

/** Por semana (toda quinta, ou semana sim/semana não). */
export type WeeklyPattern = { mode: "weekly"; dow: number; every: number };
/** Por posição no mês (2ª terça, última sexta). `ord: -1` = última. */
export type MonthlyPattern = {
  mode: "monthly";
  ord: number;
  dow: number;
  everyM: number;
};
export type RecPattern = WeeklyPattern | MonthlyPattern;

export type Recorrencia = {
  id: string;
  /** O que aparece no título do card gerado. */
  name: string;
  /** Serviço / app sob manutenção (Power BI, Smart Meet, ETL de matrículas…). */
  svc: string;
  kind: RecKind;
  sector: string;
  /** Responsável — e-mail de um usuário do sistema. */
  owner: string | null;
  pattern: RecPattern;
  /** Âncora da série (yyyy-mm-dd): de onde as semanas/meses são contados. */
  since: string;
  /** Estimativa de esforço por ciclo, em minutos. */
  estMin: number;
  /** Quantos dias ANTES da data prevista o card é aberto. */
  lead: number;
  /** Coluna do Kanban em que o card nasce. */
  columnId: string;
  /** Viram o checklist do card gerado. */
  acts: string[];
  note?: string;
  active: boolean;
  /**
   * Data de cadastro (yyyy-mm-dd). O gerador nunca abre card para data
   * anterior a ela: uma regra criada hoje com âncora em janeiro descreve um
   * ritmo, não uma dívida de seis meses de manutenção atrasada.
   */
  createdOn?: string;
};

/** Uma data prevista que já virou card. Impede o mesmo ciclo de gerar duas vezes. */
export type Ocorrencia = {
  id: string;
  recId: string;
  sector: string;
  /** Data prevista (yyyy-mm-dd) — não a data em que o card foi criado. */
  date: string;
  cardId: string;
  by: string;
};

/** Só dias úteis: a data de uma recorrência é sempre um dia da semana. */
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const ORD_LABEL: Record<number, string> = {
  1: "1ª",
  2: "2ª",
  3: "3ª",
  4: "4ª",
  [-1]: "última",
};

/**
 * A n-ésima ocorrência de um dia da semana no mês. `ord === -1` = a última.
 * Devolve null quando o mês não tem aquela 5ª ocorrência.
 */
export function nthDowDate(
  y: number,
  m: number,
  ord: number,
  dow: number,
): Date | null {
  if (ord === -1) {
    const last = new Date(y, m + 1, 0);
    return new Date(y, m, last.getDate() - ((last.getDay() - dow + 7) % 7));
  }
  const first = new Date(y, m, 1);
  const day = 1 + ((dow - first.getDay() + 7) % 7) + (ord - 1) * 7;
  return day <= new Date(y, m + 1, 0).getDate() ? new Date(y, m, day) : null;
}

/** Datas previstas dentro de [from, to], nas duas pontas inclusive. */
export function recDates(
  rec: Pick<Recorrencia, "pattern" | "since">,
  from: Date,
  to: Date,
): Date[] {
  const p = rec.pattern;
  const out: Date[] = [];
  if (!p || !rec.since || from > to) return out;
  const ini = startOfDay(from);
  const fim = startOfDay(to);

  if (p.mode === "weekly") {
    const every = Math.max(1, p.every || 1);
    let d = parseISO(rec.since);
    d = addDays(d, (p.dow - d.getDay() + 7) % 7);
    // Salta de `every` em `every` semanas para não perder o alinhamento da
    // quinzena: avançar dia a dia até `from` daria a semana errada.
    if (d < ini) {
      const semanas = Math.ceil((ini.getTime() - d.getTime()) / (86400000 * 7 * every));
      d = addDays(d, semanas * 7 * every);
    }
    while (d <= fim) {
      out.push(d);
      d = addDays(d, 7 * every);
    }
    return out;
  }

  const every = Math.max(1, p.everyM || 1);
  const s = parseISO(rec.since);
  const base = s.getFullYear() * 12 + s.getMonth();
  const ultimo = fim.getFullYear() * 12 + fim.getMonth();
  for (let i = ini.getFullYear() * 12 + ini.getMonth(); i <= ultimo; i++) {
    if ((((i - base) % every) + every) % every) continue;
    const d = nthDowDate(Math.floor(i / 12), i % 12, p.ord, p.dow);
    if (d && d >= ini && d <= fim) out.push(d);
  }
  return out;
}

export function patternLabel(p: RecPattern | null | undefined): string {
  if (!p) return "—";
  if (p.mode === "weekly") {
    return (p.every || 1) > 1
      ? `${DOW_SHORT[p.dow]}, semana sim / semana não`
      : `toda ${DOW_LABEL[p.dow]}`;
  }
  const o = ORD_LABEL[p.ord] ?? `${p.ord}ª`;
  return (p.everyM || 1) > 1
    ? `${o} ${DOW_SHORT[p.dow]}, a cada ${p.everyM} meses`
    : `${o} ${DOW_SHORT[p.dow]} do mês`;
}

/** Quantos ciclos a regra produz por mês (4,345 semanas/mês em média). */
export function occurrencesPerMonth(p: RecPattern | null | undefined): number {
  if (!p) return 0;
  return p.mode === "weekly"
    ? 4.345 / Math.max(1, p.every || 1)
    : 1 / Math.max(1, p.everyM || 1);
}

/** Carga da regra em horas por mês — o que ela consome do time todo mês. */
export function recLoadHours(
  rec: Pick<Recorrencia, "pattern" | "estMin" | "active">,
): number {
  if (rec.active === false) return 0;
  return (rec.estMin * occurrencesPerMonth(rec.pattern)) / 60;
}

/** Próxima data prevista a partir de `from` (procura até ~14 meses à frente). */
export function nextDateOf(
  rec: Pick<Recorrencia, "pattern" | "since">,
  from: Date,
): string | null {
  const ds = recDates(rec, from, addDays(startOfDay(from), 420));
  return ds.length ? toISO(ds[0]) : null;
}

// ---------------------------------------------------------------------------
// Geração dos cards
// ---------------------------------------------------------------------------

/** Quantos dias para trás o gerador recupera datas que ninguém abriu. */
export const CATCHUP_DAYS = 7;

/**
 * Datas que já deveriam ter card e ainda não têm.
 *
 * A janela olha para trás e para frente ao mesmo tempo: para frente pela
 * antecedência da regra (`lead` — o card abre antes para dar tempo de fazer),
 * e para trás por poucos dias, para recuperar um cron que ficou fora do ar.
 *
 * O limite de trás não é frescura: sem ele, a primeira execução sobre uma
 * regra ancorada em janeiro abriria um card por mês do ano inteiro de uma vez,
 * todos vencidos, e o Kanban do setor nasceria impagável.
 */
export function pendingDates(
  rec: Recorrencia,
  jaGeradas: Set<string>,
  today: Date,
  catchupDays: number = CATCHUP_DAYS,
): string[] {
  if (rec.active === false) return [];
  const hoje = startOfDay(today);
  const inicio = addDays(hoje, -Math.max(0, catchupDays));
  const fim = addDays(hoje, Math.max(0, rec.lead || 0));
  // Nada antes do cadastro da regra: ritmo combinado hoje não é dívida velha.
  const piso = rec.createdOn ? parseISO(rec.createdOn) : null;
  return recDates(rec, inicio, fim)
    .map(toISO)
    .filter((iso) => !jaGeradas.has(iso))
    .filter((iso) => !piso || parseISO(iso) >= piso);
}

/** Título do card gerado — a data no fim separa um ciclo do outro na busca. */
export function cardTitleFor(rec: Recorrencia, iso: string): string {
  const d = parseISO(iso);
  return `${rec.name} — ${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function cardDescriptionFor(rec: Recorrencia): string {
  const svc = rec.svc?.trim();
  return (
    `Manutenção programada${svc ? ` de **${svc}**` : ""}. Card aberto pela ` +
    `recorrência _${rec.name}_ (${patternLabel(rec.pattern)}).`
  );
}

// ---------------------------------------------------------------------------
// Situação de uma ocorrência e da regra
// ---------------------------------------------------------------------------

/** `gone` = o card foi apagado do Kanban; a ocorrência fica como registro. */
export type OccState = "done" | "late" | "doing" | "open" | "gone";

/**
 * Em que pé está o card daquele ciclo.
 *
 * "Aberto" e "atrasado" são o mesmo estado no Kanban (parado na primeira
 * coluna) — o que os separa é a data prevista ter passado ou não.
 */
export function occState(
  occ: Pick<Ocorrencia, "date">,
  card: { columnId: string } | undefined,
  cols: { firstId: string; doneIds: Set<string> },
  today: Date,
): OccState {
  if (!card) return "gone";
  // A entrega é checada ANTES do resto: manutenção feita não atrasa, mesmo que
  // a data prevista do ciclo já tenha passado.
  if (cols.doneIds.has(card.columnId)) return "done";
  if (card.columnId === cols.firstId) {
    return daysBetween(occ.date, today) > 0 ? "late" : "open";
  }
  return "doing";
}

export type RecStatusKey = "late" | "doing" | "open" | "prev" | "off";

export type RecStatus = {
  k: RecStatusKey;
  label: string;
  occ?: Ocorrencia;
  state?: OccState;
};

/**
 * Situação da regra = a do ciclo em aberto mais antigo. Sem ciclo em aberto,
 * ela está apenas "prevista" — o próximo card ainda não nasceu.
 */
export function recStatus(
  rec: Recorrencia,
  occs: Ocorrencia[],
  estadoDa: (o: Ocorrencia) => OccState,
): RecStatus {
  if (rec.active === false) return { k: "off", label: "Pausada" };
  const aberta = occs
    .filter((o) => o.recId === rec.id)
    .map((o) => ({ o, s: estadoDa(o) }))
    .filter((x) => x.s === "open" || x.s === "doing" || x.s === "late")
    .sort((a, b) => (a.o.date < b.o.date ? -1 : 1))[0];
  if (!aberta) return { k: "prev", label: "Prevista" };
  const label =
    aberta.s === "late"
      ? "Atrasada"
      : aberta.s === "doing"
        ? "Em andamento"
        : "Aberta";
  return { k: aberta.s as RecStatusKey, label, occ: aberta.o, state: aberta.s };
}

export const REC_STATE_TOKENS: Record<RecStatusKey, [string, string]> = {
  late: ["var(--danger-bg)", "var(--danger-tx)"],
  doing: ["var(--warn-bg)", "var(--warn-tx)"],
  open: ["var(--info-bg)", "var(--info-tx)"],
  prev: ["var(--s3)", "var(--tx-3)"],
  off: ["var(--s3)", "var(--tx-3)"],
};
