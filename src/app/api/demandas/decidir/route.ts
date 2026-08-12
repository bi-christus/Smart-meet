/**
 * Decisão humana sobre uma proposta de demanda: aceitar ou recusar.
 *
 * Este é o ÚNICO lugar do sistema onde uma proposta vira card. O ingest não
 * escreve em /cards; o Cowork não fala com o Firestore. Um card só nasce aqui,
 * com alguém autenticado clicando.
 *
 * Quem pode decidir: admin, ou quem participa do setor ALVO da proposta. Quem
 * enviou o áudio mas é de outro setor pode recusar (ele tem o contexto da
 * conversa), mas não aceita — o dado atravessa o setor, a permissão não.
 *
 * O que o cliente manda é sempre tratado como sugestão: `sectorAlvo`,
 * `createdBy`, `columnId` e `order` são resolvidos AQUI. O corpo da requisição
 * só influencia os campos de conteúdo da demanda.
 */
import { NextResponse } from "next/server";

import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import { TIPOS_DEMANDA, type TipoDemanda } from "@/lib/server/demandas-schema";
// Módulo puro (sem SDK do cliente): serve os dois lados, e é o que mantém o
// histórico escrito aqui com a mesma forma do que o quadro escreve.
import { dataBR, type Mudanca } from "@/lib/historico-core";

export const runtime = "nodejs";

const PRIORIDADES = ["alta", "media", "baixa"] as const;
type Prioridade = (typeof PRIORIDADES)[number];

type Corpo = {
  propostaId?: string;
  decisao?: "aceitar" | "recusar";
  motivo?: string;
  /**
   * Campos editados pelo humano antes de aceitar.
   *
   * Responsável, solicitante e datas só existem aqui — a IA nunca os propõe,
   * porque são o que a transcrição mais erra. Quem decide é quem valida.
   */
  edicao?: {
    title?: string;
    description?: string;
    type?: string;
    priority?: string;
    columnId?: string;
    tags?: string[];
    checklist?: { text: string; desc?: string }[];
    assignee?: string | null;
    requester?: string | null;
    requesterSector?: string | null;
    startDate?: string | null;
    due?: string | null;
  };
};

/** Data no formato do app (aaaa-mm-dd) ou null. Rejeita qualquer outra coisa. */
function dataOuNulo(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function limpo(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Corpo;

    const propostaId = limpo(body.propostaId, 200);
    const decisao = body.decisao;
    if (!propostaId) throw new HttpError(400, "Proposta não informada.");
    if (decisao !== "aceitar" && decisao !== "recusar") {
      throw new HttpError(400, "Decisão inválida.");
    }

    const db = adminDb();
    const propRef = db.collection("demandPropostas").doc(propostaId);
    const snap = await propRef.get();
    if (!snap.exists) throw new HttpError(404, "Proposta não encontrada.");
    const p = snap.data()!;

    if (p.status !== "pendente") {
      throw new HttpError(409, `Esta proposta já foi ${p.status}.`);
    }

    const sectorAlvo = (p.sectorAlvo as string) ?? "";
    const ehDoSetor = caller.role === "admin" || caller.sectors.includes(sectorAlvo);
    const ehAutorDoAudio =
      (p.criadoPor as string | undefined)?.toLowerCase() === caller.email;

    if (decisao === "aceitar" && !ehDoSetor) {
      throw new HttpError(
        403,
        `Só quem participa de ${sectorAlvo} pode aceitar esta proposta. Você pode recusá-la.`,
      );
    }
    if (decisao === "recusar" && !ehDoSetor && !ehAutorDoAudio) {
      throw new HttpError(403, "Você não participa do setor desta proposta.");
    }

    const agora = new Date();
    const motivo = limpo(body.motivo, 500);

    const loteRef = db.collection("demandLotes").doc(p.loteId as string);

    /**
     * Fecha a decisão. Relê a proposta DENTRO da transação: entre o clique de
     * duas pessoas na mesma proposta, a verificação feita lá em cima já estaria
     * velha, e a segunda sobrescreveria a decisão da primeira.
     */
    async function encerrar(
      novoStatus: "aceita" | "recusada",
      extraProposta: Record<string, unknown>,
      log: Record<string, unknown>,
      criarCard?: (tx: FirebaseFirestore.Transaction) => void,
    ) {
      await db.runTransaction(async (tx) => {
        const atual = await tx.get(propRef);
        if (atual.data()?.status !== "pendente") {
          throw new HttpError(409, "Alguém acabou de decidir esta proposta.");
        }
        const lote = await tx.get(loteRef);
        const t = (lote.data()?.totais ?? {}) as Record<string, number>;
        const pendentes = Math.max(0, (t.pendentes ?? 1) - 1);

        criarCard?.(tx);

        tx.update(propRef, {
          status: novoStatus,
          decisao: { por: caller.email, em: agora, motivo, ...extraProposta },
        });
        tx.update(loteRef, {
          totais: {
            propostas: t.propostas ?? 0,
            pendentes,
            aceitas: (t.aceitas ?? 0) + (novoStatus === "aceita" ? 1 : 0),
            recusadas: (t.recusadas ?? 0) + (novoStatus === "recusada" ? 1 : 0),
          },
          status: pendentes === 0 ? "resolvido" : "parcial",
        });
        tx.create(db.collection("logs").doc(), {
          propostaId,
          loteId: p.loteId,
          meetingId: p.meetingId,
          sector: sectorAlvo,
          por: caller.email,
          em: agora,
          ...log,
        });
      });
    }

    // ---- recusa: não toca em /cards ----
    if (decisao === "recusar") {
      await encerrar("recusada", {}, { tipo: "demandas.recusada", motivo });
      return NextResponse.json({ ok: true, status: "recusada" });
    }

    // ---- aceite: cria o card ----
    const base = (p.proposta ?? {}) as Record<string, unknown>;
    const ed = body.edicao ?? {};

    const title = limpo(ed.title ?? base.title, 120);
    if (!title) throw new HttpError(400, "A demanda precisa de um título.");

    const tipo = (
      TIPOS_DEMANDA.includes(ed.type as TipoDemanda)
        ? ed.type
        : TIPOS_DEMANDA.includes(base.type as TipoDemanda)
          ? base.type
          : "implementacao"
    ) as TipoDemanda;

    const prioridade = (
      PRIORIDADES.includes(ed.priority as Prioridade) ? ed.priority : "media"
    ) as Prioridade;

    // A coluna precisa EXISTIR no setor de destino: um card com columnId órfão
    // fica no banco, marcado como aceito, e não aparece em coluna nenhuma.
    const colsSnap = await db
      .collection("columns")
      .where("sector", "==", sectorAlvo)
      .get();
    const colunas = colsSnap.docs.map((d) => d.data());
    if (colunas.length === 0) {
      throw new HttpError(
        409,
        `O setor ${sectorAlvo} ainda não tem colunas no quadro. Crie o quadro antes de aceitar.`,
      );
    }
    const pedida = limpo(ed.columnId, 60);
    const columnId =
      colunas.find((c) => c.colId === pedida)?.colId ??
      [...colunas].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0].colId;

    const tags = Array.isArray(ed.tags)
      ? ed.tags.map((t) => limpo(t, 40)).filter(Boolean).slice(0, 8)
      : Array.isArray(base.tags)
        ? (base.tags as string[]).slice(0, 8)
        : [];

    const checklistBruta = Array.isArray(ed.checklist)
      ? ed.checklist
      : Array.isArray(base.checklist)
        ? (base.checklist as { text: string; desc?: string }[])
        : [];
    const checklist = checklistBruta
      .map((it) => {
        const text = limpo(it?.text, 200);
        const desc = limpo(it?.desc, 500);
        return text ? (desc ? { text, done: false, desc } : { text, done: false }) : null;
      })
      .filter(Boolean)
      .slice(0, 10);

    const agoraMs = agora.getTime();
    const cardRef = db.collection("cards").doc();

    /**
     * O estado inicial como o histórico vai mostrar.
     *
     * Nome e não e-mail, etapa e não `colId`: o registro tem de continuar
     * legível quando o responsável for desativado ou a coluna for renomeada —
     * mesma escolha do quadro (ver `criarRotulos` em kanban/page.tsx).
     */
    const responsavel = limpo(ed.assignee, 120);
    const nomeResp = responsavel
      ? ((await db.collection("users").doc(responsavel.toLowerCase()).get())
          .data()?.name as string | undefined) || responsavel
      : "";
    const prazoInicial = dataOuNulo(ed.due);
    const mudancasIniciaisDoCard: Mudanca[] = [
      {
        campo: "coluna",
        de: null,
        para: colunas.find((c) => c.colId === columnId)?.title ?? columnId,
      },
      ...(nomeResp
        ? [{ campo: "responsavel" as const, de: null, para: nomeResp }]
        : []),
      ...(prazoInicial
        ? [{ campo: "prazo" as const, de: null, para: dataBR(prazoInicial) }]
        : []),
    ];

    const camposEditados = Object.keys(ed ?? {});
    await encerrar(
      "aceita",
      { cardId: cardRef.id, camposEditados },
      { tipo: "demandas.aceita", cardId: cardRef.id, camposEditados },
      (tx) => {
        tx.create(cardRef, {
          sector: sectorAlvo,
          columnId,
          title,
          description: limpo(ed.description ?? base.description, 4000),
          type: tipo,
          // Só o humano preenche estes. Datas são opcionais de propósito: uma
          // fila que exige duas datas por item é uma fila que ninguém abre.
          assignee: limpo(ed.assignee, 120) || null,
          requester: limpo(ed.requester, 120) || null,
          requesterSector: limpo(ed.requesterSector, 80) || null,
          startDate: dataOuNulo(ed.startDate),
          due: dataOuNulo(ed.due),
          priority: prioridade,
          tags,
          checklist,
          comments: [],
          order: -agoraMs,
          enteredAt: agoraMs,
          createdAt: agora,
          createdBy: caller.email,
          rev: 0,
          // Proveniência: de onde este card veio, para quem abrir daqui a meses.
          origem: "reuniao",
          propostaId,
          meetingIds: [p.meetingId],
          histCount: 1,
        });
        // Primeira linha da timeline do card. Sem ela, a demanda nascida de uma
        // reunião abriria o histórico vazio — e "não tem registro" leria como
        // "ninguém mexeu", quando na verdade ela veio de uma decisão tomada
        // aqui, por alguém, num instante que o sistema conhece.
        tx.create(cardRef.collection("historico").doc(), {
          sector: sectorAlvo,
          autor: caller.email,
          em: agora,
          acao: "criada",
          mudancas: mudancasIniciaisDoCard,
        });
      },
    );

    return NextResponse.json({ ok: true, status: "aceita", cardId: cardRef.id });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("demandas/decidir:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
