/**
 * Catálogo de demandas para o Cowork — SOMENTE LEITURA.
 *
 * É o único canal pelo qual o processador externo enxerga o que já existe no
 * Kanban, para não propor de novo o que já está cadastrado. Três escolhas
 * deliberadas moldam esta rota:
 *
 * 1. Só existe GET. Não há POST, PATCH nem DELETE em nenhuma rota /api/cowork.
 *    Vazar o COWORK_TOKEN vaza leitura de títulos de demanda — nada mais.
 * 2. O token é PRÓPRIO, separado do CRON_SECRET. Reaproveitar o segredo do
 *    cron transformaria um vazamento de leitura em poder de disparar o sync.
 * 3. A resposta é podada: título, tags, tipo, coluna e setor. Descrição,
 *    comentários e checklist ficam de fora — servem para casar assunto, não
 *    para reconstruir o conteúdo do quadro fora do app.
 */
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError, adminDb } from "@/lib/server/drive-server";
// Módulo PURO: `kanban.ts` traz o SDK do cliente junto e uma rota não consegue
// importá-lo. A definição de "está na lixeira" mora num lugar só, e é esta.
import { viva } from "@/lib/lixeira-core";

export const runtime = "nodejs";

/** Teto de cards devolvidos. Acima disso o casamento léxico já não ajuda. */
const MAX_CARDS = 1500;

function tokenConfere(req: Request): boolean {
  const esperado = process.env.COWORK_TOKEN;
  if (!esperado) return false;
  const h = req.headers.get("authorization") || "";
  const recebido = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!recebido) return false;
  // Comparação em tempo constante: comparar segredo com === vaza, pelo tempo,
  // quantos caracteres iniciais estavam certos.
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  try {
    if (!tokenConfere(req)) {
      throw new HttpError(401, "Token do Cowork ausente ou inválido.");
    }

    const db = adminDb();
    const snap = await db.collection("cards").get();

    // Demanda na lixeira sai do catálogo. O Admin SDK não passa pelo filtro do
    // `subscribeCards`, então sem esta peneira o Cowork continuaria propondo
    // ajuste para uma demanda que alguém já excluiu — e a proposta chegaria
    // apontando para um card que não está em quadro nenhum.
    //
    // Peneira ANTES do `slice`: cortar primeiro faria as excluídas gastarem
    // vagas do teto e sumirem demandas vivas do fim da lista.
    const cards = snap.docs
      .filter((d) => viva(d.data() as { deletedAt?: number | null }))
      .slice(0, MAX_CARDS)
      .map((d) => {
        const c = d.data();
        return {
          cardId: d.id,
          setor: (c.sector as string) ?? "",
          titulo: (c.title as string) ?? "",
          tipo: (c.type as string) ?? null,
          coluna: (c.columnId as string) ?? null,
          tags: Array.isArray(c.tags) ? (c.tags as string[]).slice(0, 12) : [],
          responsavel: (c.assignee as string) ?? null,
          // `rev` viaja para que uma fase futura consiga detectar que o card
          // mudou entre a leitura do catálogo e a aplicação de um ajuste.
          rev: typeof c.rev === "number" ? c.rev : 0,
        };
      });

    // O hash identifica ESTA foto do catálogo. Serve para o Cowork registrar
    // no sidecar de que versão ele partiu, e para diagnosticar depois uma
    // proposta que cita um card que já não existe.
    const hash = createHash("sha256")
      .update(JSON.stringify(cards.map((c) => [c.cardId, c.rev])))
      .digest("hex")
      .slice(0, 16);

    return NextResponse.json({
      geradoEm: new Date().toISOString(),
      hash,
      totalCards: cards.length,
      truncado: snap.size > MAX_CARDS,
      cards,
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("cowork/catalogo:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
