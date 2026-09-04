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
 *
 * A resposta tem DUAS metades, e elas respondem a perguntas diferentes.
 * `cards` responde "isto já existe?", card a card, e é o que evita a proposta
 * duplicada. `vocabulario` responde "como este setor CHAMA as coisas?", e é o
 * que evita a tag inventada. A segunda não dá para deduzir da primeira: são mil
 * e quinhentas listas de tag, e quem lê esta resposta é um modelo de linguagem,
 * que não agrega — amostra. Enquanto só existia `cards`, toda demanda nascia
 * com uma tag nova e o catálogo virou uma fileira de entradas contando "1".
 */
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError, adminDb } from "@/lib/server/drive-server";
// Módulo PURO: `kanban.ts` traz o SDK do cliente junto e uma rota não consegue
// importá-lo. A definição de "está na lixeira" mora num lugar só, e é esta.
import { viva } from "@/lib/lixeira-core";
// Mesmo motivo, e a mesma direção da seta: a conta de "quais tags este setor
// realmente usa" é regra pura, tem teste em `scripts/test-tags.mjs`, e é a
// MESMA que desenha a barra de tags do quadro. Recalculá-la aqui à mão faria a
// resposta desta rota divergir do que o operador vê na tela — e ninguém
// perceberia, porque as duas continuariam parecendo certas.
import { vocabularioDeTags } from "@/lib/tags-core";

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
    const vivos = snap.docs.filter((d) =>
      viva(d.data() as { deletedAt?: number | null }),
    );

    const cards = vivos
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

    /**
     * O VOCABULÁRIO sai do quadro INTEIRO, e não da lista podada acima.
     *
     * Ele é justamente o resumo que existe para dispensar a leitura card a
     * card: uma tag que o setor usa toda semana pode estar só em demandas que
     * caíram fora do teto de `MAX_CARDS`, e ela é o que mais importa oferecer.
     * `truncado` já avisa que `cards` foi cortado; cortar o vocabulário junto
     * seria esconder a parte que não precisava ser cortada.
     *
     * POR QUE ELE EXISTE. Sem isto, saber que "estoque" é a palavra das
     * Cantinas exigiria agregar as tags de mil e quinhentos cards — e quem lê
     * esta resposta é um modelo de linguagem, que não agrega, amostra. O
     * resultado era uma tag nova inventada por demanda: um catálogo em que toda
     * entrada aparece uma vez, e tag que aparece uma vez não liga nada a nada.
     */
    const vocabulario = vocabularioDeTags(
      vivos.map((d) => {
        const c = d.data();
        return {
          setor: (c.sector as string) ?? "",
          tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        };
      }),
    );

    return NextResponse.json({
      geradoEm: new Date().toISOString(),
      hash,
      totalCards: cards.length,
      truncado: snap.size > MAX_CARDS,
      vocabulario,
      cards,
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("cowork/catalogo:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
