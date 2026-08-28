import { NextResponse } from "next/server";
import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import { DEFAULT_COLUMNS } from "@/lib/kanban-columns";
import { entreguesPorSetor } from "@/lib/entregas-core";
import { viva } from "@/lib/lixeira-core";
import { montarRank } from "@/lib/rank-core";
import {
  entregasDoMes,
  mesAnterior,
  mesAtual,
  vencedoresDoRanking,
  type CardComEntrada,
} from "@/lib/temporadas-core";

export const runtime = "nodejs";

/**
 * Fecha a temporada de um mês — congela o pódio e registra quem venceu.
 *
 * Dois disparos, um caminho só, igual `recorrencias/gerar`:
 *  - o cron da Vercel, dia 1 de cada mês (cabeçalho com CRON_SECRET);
 *  - um disparo manual de admin (`requireUser` + `role === "admin"`), para
 *    fechar fora do calendário ou reprocessar em ambiente local.
 *
 * IDEMPOTENTE por checagem de existência: se `temporadas/{mes}` já tem
 * documento, a rota devolve sem regravar. Uma temporada fechada é um fato —
 * reabrir e recalcular mudaria o "vencedor registrado" depois que ele já foi
 * anunciado, que é exatamente o que a Parte B inteira existe para não fazer.
 *
 * A TEMPORADA É DA ORGANIZAÇÃO TODA, não de um setor. Por isso lê `cards` e
 * `columns` inteiros — diferente de `recorrencias/gerar`, que escopa por
 * quem chama.
 */

type Corpo = { mes?: string };

type CardBruto = {
  sector?: string;
  columnId?: string;
  assignee?: string | null;
  requesterSector?: string | null;
  enteredAt?: number | null;
  deletedAt?: number | null;
};

type ColumnBruto = { sector?: string; colId?: string; title?: string; order?: number };

/** Nome de exibição de um e-mail, com cache por execução — igual `recorrencias/gerar`. */
async function nomeDe(
  db: FirebaseFirestore.Firestore,
  cache: Map<string, string>,
  email: string,
): Promise<string> {
  const chave = email.toLowerCase();
  const guardado = cache.get(chave);
  if (guardado !== undefined) return guardado;
  const snap = await db.collection("users").doc(chave).get();
  const nome = (snap.data()?.name as string | undefined) || email;
  cache.set(chave, nome);
  return nome;
}

/**
 * Colunas de cada setor que tem card, com fallback para `DEFAULT_COLUMNS`.
 *
 * Mesma lógica de `colunasDoSetor` em `recorrencias/gerar/route.ts`, adaptada
 * para todos os setores de uma vez — a temporada precisa da organização
 * inteira, não de um setor por chamada.
 */
function colunasPorSetor(
  colsBrutas: ColumnBruto[],
  setoresComCard: ReadonlySet<string>,
): Record<string, { id: string; title: string }[]> {
  const porSetor = new Map<string, ColumnBruto[]>();
  colsBrutas.forEach((c) => {
    if (!c.sector) return;
    const lista = porSetor.get(c.sector) ?? [];
    lista.push(c);
    porSetor.set(c.sector, lista);
  });

  const out: Record<string, { id: string; title: string }[]> = {};
  setoresComCard.forEach((sector) => {
    const lista = porSetor.get(sector);
    out[sector] = lista?.length
      ? lista
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((c) => ({ id: String(c.colId ?? ""), title: String(c.title ?? c.colId ?? "") }))
          .filter((c) => c.id)
      : DEFAULT_COLUMNS.map((c) => ({ id: c.id, title: c.title }));
  });
  return out;
}

async function executar(req: Request, corpo: Corpo) {
  const authz = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;

  let autor: string;
  if (cronSecret && authz === `Bearer ${cronSecret}`) {
    autor = "cron";
  } else {
    const caller = await requireUser(req);
    if (caller.role !== "admin") {
      throw new HttpError(403, "Só administradores podem fechar uma temporada.");
    }
    autor = caller.email;
  }

  // Sem `corpo.mes`: fecha o mês que ACABOU DE TERMINAR — é o que o cron do
  // dia 1 precisa. Com `corpo.mes`: reabre a mesma conta para outro mês,
  // usado no fechamento manual (teste local, reprocessamento).
  const mes = corpo.mes || mesAnterior(mesAtual());

  const db = adminDb();
  const ref = db.collection("temporadas").doc(mes);
  const jaFechada = await ref.get();
  if (jaFechada.exists) {
    return NextResponse.json({ mes, jaFechada: true });
  }

  const [cardsSnap, colsSnap] = await Promise.all([
    db.collection("cards").get(),
    db.collection("columns").get(),
  ]);

  const cardsVivos: CardComEntrada[] = cardsSnap.docs
    .map((d) => d.data() as CardBruto)
    .filter(viva)
    .map((c) => ({
      sector: String(c.sector ?? ""),
      columnId: String(c.columnId ?? ""),
      assignee: c.assignee ?? null,
      requesterSector: c.requesterSector ?? null,
      enteredAt: c.enteredAt ?? null,
    }));

  const setoresComCard = new Set(cardsVivos.map((c) => c.sector).filter(Boolean));
  const colsBrutas = colsSnap.docs.map((d) => d.data() as ColumnBruto);
  const ent = entreguesPorSetor(colunasPorSetor(colsBrutas, setoresComCard));

  const { por, total } = entregasDoMes(cardsVivos, ent, mes);

  const nomesPorEmail = new Map<string, string>();
  const participantes = [];
  for (const [email, entregues] of por.entries()) {
    participantes.push({
      chave: email,
      rotulo: await nomeDe(db, nomesPorEmail, email),
      entregues,
    });
  }
  const ranking = montarRank(participantes);
  const vencedores = vencedoresDoRanking(ranking);

  await ref.set({
    mes,
    ranking,
    vencedores,
    entregas: total,
    fechadaEm: new Date(),
    fechadaPor: autor,
  });

  return NextResponse.json({ mes, entregas: total, vencedores });
}

async function responder(req: Request, corpo: Corpo) {
  try {
    return await executar(req, corpo);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("temporadas/fechar:", message);
    return NextResponse.json({ error: message }, { status });
  }
}

/** Disparo do cron da Vercel (GET com o CRON_SECRET no cabeçalho). */
export async function GET(req: Request) {
  return responder(req, {});
}

/** Disparo manual de admin — opcionalmente para outro mês que não o anterior. */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as Corpo;
  return responder(req, {
    mes: typeof corpo.mes === "string" ? corpo.mes : undefined,
  });
}
