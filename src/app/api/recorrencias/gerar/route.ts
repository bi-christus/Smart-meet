import { NextResponse } from "next/server";
import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import { DEFAULT_COLUMNS } from "@/lib/kanban-columns";
import { startOfDay } from "@/lib/datas";
import {
  cardDescriptionFor,
  cardTitleFor,
  nextDateOf,
  pendingDates,
  type Recorrencia,
} from "@/lib/recorrencias-core";

export const runtime = "nodejs";

/**
 * Abre no Kanban os cards de manutenção que a recorrência já deveria ter
 * aberto.
 *
 * Dois disparos, um caminho só:
 *  - o cron da Vercel, todo dia de manhã (cabeçalho com CRON_SECRET);
 *  - o botão "Gerar card agora" do modal, que antecipa o próximo ciclo.
 *
 * A geração é IDEMPOTENTE por transação: a ocorrência tem id determinístico
 * (`<regra>__<data>`) e é criada com `create()`, que falha se já existir. Cron
 * que roda duas vezes, aba aberta em dois navegadores e clique repetido no
 * botão terminam todos no mesmo lugar — um card por data prevista.
 *
 * Nota sobre a fronteira das demandas: `scripts/check-demandas-boundary.mjs`
 * proíbe o caminho automático da IA (Cowork → Drive → ingest) de criar cards.
 * Aqui é outro caminho e outra natureza: a recorrência é uma regra que um
 * humano escreveu e ligou, dizendo de antemão que aquele card deve nascer
 * naquela data. Não há proposta, nem texto de LLM, no meio.
 */

/** Teto por execução, para a função caber no tempo e nunca inundar um setor. */
const LIMITE_POR_EXECUCAO = 200;

type Corpo = { recId?: string; antecipar?: boolean };

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Colunas do setor, na ordem. Setor que ainda não personalizou cai no padrão —
 * o mesmo que o Kanban mostra antes do primeiro seed.
 */
async function colunasDoSetor(
  db: FirebaseFirestore.Firestore,
  sector: string,
): Promise<string[]> {
  const snap = await db.collection("columns").where("sector", "==", sector).get();
  if (snap.empty) return DEFAULT_COLUMNS.map((c) => c.id);
  return snap.docs
    .map((d) => d.data() as { colId?: string; order?: number })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => String(c.colId ?? ""))
    .filter(Boolean);
}

async function executar(req: Request, corpo: Corpo) {
  const authz = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;

  // sectors = null significa "todos" (cron ou admin).
  let sectors: string[] | null;
  let autor: string;
  if (cronSecret && authz === `Bearer ${cronSecret}`) {
    sectors = null;
    autor = "cron";
  } else {
    const caller = await requireUser(req);
    sectors = caller.role === "admin" ? null : caller.sectors;
    autor = caller.email;
    if (sectors && sectors.length === 0) {
      return NextResponse.json({ criados: 0, cards: [] });
    }
  }

  const db = adminDb();
  const hoje = startOfDay();

  // Regras candidatas. Uma consulta só, filtrando setor em memória: a lista de
  // recorrências de uma organização é pequena, e `where in` teria o teto de 30.
  let regras: { id: string; data: Recorrencia }[];
  if (corpo.recId) {
    const d = await db.collection("recorrencias").doc(corpo.recId).get();
    if (!d.exists) throw new HttpError(404, "Recorrência não encontrada.");
    regras = [{ id: d.id, data: d.data() as Recorrencia }];
  } else {
    const snap = await db
      .collection("recorrencias")
      .where("active", "==", true)
      .get();
    regras = snap.docs.map((d) => ({ id: d.id, data: d.data() as Recorrencia }));
  }

  const noEscopo = regras.filter(
    ({ data }) => !sectors || sectors.includes(data.sector),
  );
  if (corpo.recId && noEscopo.length === 0) {
    throw new HttpError(403, "Você não tem acesso ao setor desta recorrência.");
  }

  const criados: string[] = [];
  const colunasPorSetor = new Map<string, string[]>();

  for (const { id, data } of noEscopo) {
    if (criados.length >= LIMITE_POR_EXECUCAO) break;
    const rec: Recorrencia = { ...data, id };
    if (rec.active === false && !corpo.antecipar) continue;

    // Datas desta regra que já viraram card.
    const jaSnap = await db
      .collection("ocorrencias")
      .where("recId", "==", id)
      .get();
    const jaGeradas = new Set(
      jaSnap.docs.map((d) => String((d.data() as { date?: string }).date ?? "")),
    );

    let datas = pendingDates(rec, jaGeradas, hoje);
    // "Gerar card agora": se nada venceu ainda, antecipa o PRÓXIMO ciclo. É o
    // caso de uso do botão — fazer a manutenção antes da data combinada.
    if (datas.length === 0 && corpo.antecipar) {
      const prox = nextDateOf(rec, hoje);
      if (prox && !jaGeradas.has(prox)) datas = [prox];
    }
    if (datas.length === 0) continue;

    if (!colunasPorSetor.has(rec.sector)) {
      colunasPorSetor.set(rec.sector, await colunasDoSetor(db, rec.sector));
    }
    const colunas = colunasPorSetor.get(rec.sector) as string[];
    // Coluna configurada que não existe mais (o setor renomeou/apagou) não pode
    // fazer o card nascer invisível: cai na primeira coluna do quadro.
    const columnId = colunas.includes(rec.columnId)
      ? rec.columnId
      : (colunas[0] ?? DEFAULT_COLUMNS[0].id);

    for (const iso of datas) {
      if (criados.length >= LIMITE_POR_EXECUCAO) break;
      const cardRef = db.collection("cards").doc();
      const occRef = db.collection("ocorrencias").doc(`${id}__${iso}`);
      const agora = new Date();
      const agoraMs = agora.getTime();

      try {
        await db.runTransaction(async (tx) => {
          const occ = await tx.get(occRef);
          if (occ.exists) throw new HttpError(409, "ja-existe");
          tx.create(cardRef, {
            sector: rec.sector,
            columnId,
            title: cardTitleFor(rec, iso),
            description: cardDescriptionFor(rec),
            type: "manutencao",
            assignee: rec.owner || null,
            requester: null,
            requesterSector: null,
            startDate: null,
            due: iso,
            priority: "media",
            tags: [],
            checklist: (rec.acts ?? []).map((text) => ({
              id: uid(),
              text,
              done: false,
            })),
            comments: [],
            order: -agoraMs,
            enteredAt: agoraMs,
            createdAt: agora,
            createdBy: autor,
            rev: 0,
            // Proveniência: de onde este card veio, para quem abrir daqui a meses.
            origem: "recorrencia",
            recId: id,
            recDate: iso,
          });
          tx.create(occRef, {
            recId: id,
            sector: rec.sector,
            date: iso,
            cardId: cardRef.id,
            by: autor,
            createdAt: agora,
          });
        });
        criados.push(cardRef.id);
      } catch (e) {
        // Corrida perdida (outra execução criou a mesma data) não é erro: o
        // resultado desejado — um card só — está exatamente onde deveria.
        if (e instanceof HttpError && e.status === 409) continue;
        console.warn("recorrencias/gerar: falha ao abrir card", id, iso, e);
      }
    }
  }

  return NextResponse.json({ criados: criados.length, cards: criados });
}

async function responder(req: Request, corpo: Corpo) {
  try {
    return await executar(req, corpo);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("recorrencias/gerar:", message);
    return NextResponse.json({ error: message }, { status });
  }
}

/** Disparo do cron da Vercel (GET com o CRON_SECRET no cabeçalho). */
export async function GET(req: Request) {
  return responder(req, {});
}

/** Disparo do app: varredura do setor, ou "gerar agora" de uma regra. */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as Corpo;
  return responder(req, {
    recId: typeof corpo.recId === "string" ? corpo.recId : undefined,
    antecipar: corpo.antecipar === true,
  });
}
