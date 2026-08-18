/**
 * Publica no Discord um evento que o QUADRO acabou de gravar.
 *
 * Esta rota é a casca de autenticação em volta de `publicarEvento`
 * (`src/lib/server/discord-aviso.ts`) — ela existe porque quem grava o evento é
 * o navegador, e o navegador não pode conhecer a URL do webhook: ela é uma
 * credencial, e quem a tem publica no canal para sempre, sem passar por login.
 *
 * Quem grava pelo Admin SDK (`api/demandas/decidir`, `api/recorrencias/gerar`)
 * NÃO passa por aqui: chama a função direto, sem salto de rede e sem forjar um
 * token para falar consigo mesmo.
 *
 * O cliente manda DOIS IDS e nada mais. Título, setor, autor, mudanças e
 * horário saem do banco — mesmo princípio de `api/demandas/decidir`, e pelo
 * mesmo motivo: sem isso, quem abrisse o console publicaria no canal do setor
 * uma mensagem qualquer, assinada como Smart Meet, dizendo que a demanda de
 * outra pessoa foi cancelada.
 *
 * QUEM PODE AVISAR é quem já podia ver o card: admin, ou quem participa do
 * setor. A checagem é a mesma que as regras do Firestore fazem na leitura —
 * repetida aqui porque o Admin SDK não passa por regra nenhuma.
 *
 * NÃO É CAMINHO CRÍTICO. Toda saída "não deu para avisar" é `200` com
 * `{ enviado: false, motivo }`, e não erro: a demanda já está gravada, o cliente
 * chama isto sem esperar resposta, e um 500 aqui só encheria o console de quem
 * está trabalhando. O `motivo` existe para o dia em que alguém perguntar "por
 * que não chegou no canal?" — a resposta fica na aba de rede, não num palpite.
 */
import { NextResponse } from "next/server";

import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import { publicarEvento } from "@/lib/server/discord-aviso";

export const runtime = "nodejs";

type Corpo = { cardId?: string; eventoId?: string };

function id(v: unknown): string {
  // O id do Firestore não tem barra nem ponto; recusar aqui evita montar um
  // caminho de documento que aponta para outro lugar da árvore.
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v) ? v : "";
}

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Corpo;

    const cardId = id(body.cardId);
    const eventoId = id(body.eventoId);
    if (!cardId || !eventoId) throw new HttpError(400, "Aviso sem card ou evento.");

    const db = adminDb();
    const card = await db.collection("cards").doc(cardId).get();
    if (!card.exists) throw new HttpError(404, "Demanda não encontrada.");

    const sector = ((card.data()?.sector as string) ?? "").trim();
    if (caller.role !== "admin" && !caller.sectors.includes(sector)) {
      throw new HttpError(403, "Você não participa do setor desta demanda.");
    }

    return NextResponse.json(await publicarEvento(db, cardId, eventoId));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    // O stack fica, ao contrário do resto das rotas deste app (ver AGENTS.md
    // §5): aqui a falha é invisível para quem usa, então o log é a única coisa
    // que sobra para descobrir por que o canal está mudo.
    if (status >= 500) console.error("discord/avisar:", e);
    return NextResponse.json({ error: message }, { status });
  }
}
