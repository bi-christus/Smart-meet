/**
 * Publica no Discord um evento que o quadro acabou de gravar.
 *
 * O cliente manda DOIS IDS e nada mais. Título, setor, autor, mudanças e
 * horário saem do banco, lidos aqui pelo Admin SDK — mesmo princípio de
 * `api/demandas/decidir`, e pelo mesmo motivo: sem isso, quem abrisse o console
 * publicaria no canal do setor uma mensagem qualquer, assinada como Smart Meet,
 * dizendo que a demanda de outra pessoa foi cancelada.
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
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import { enviarAviso } from "@/lib/server/discord";
import {
  deveAvisar,
  montarAviso,
  webhookDoSetor,
  type CardDoAviso,
  type EventoDoAviso,
} from "@/lib/discord-core";
import { rotuloPrioridade, rotuloTipo } from "@/lib/demanda-rotulos";
import type { Acao, Mudanca } from "@/lib/historico-core";

export const runtime = "nodejs";

type Corpo = { cardId?: string; eventoId?: string };

/** Só o que este arquivo lê do card. O resto do documento não interessa aqui. */
type CardDoc = {
  sector?: string;
  title?: string;
  columnId?: string;
  assignee?: string | null;
  requester?: string | null;
  requesterSector?: string | null;
  due?: string | null;
  priority?: string;
  type?: string;
};

type EventoDoc = {
  autor?: string;
  em?: { toMillis?: () => number } | null;
  acao?: Acao;
  mudancas?: Mudanca[];
  discordAt?: unknown;
};

function id(v: unknown): string {
  // O id do Firestore não tem barra nem ponto; recusar aqui evita montar um
  // caminho de documento que aponta para outro lugar da árvore.
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v) ? v : "";
}

/** Nome de gente a partir do e-mail, com o e-mail como plano B. */
async function nomes(
  db: Firestore,
  emails: string[],
): Promise<Map<string, { name: string; discordId: string | null }>> {
  const unicos = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, { name: string; discordId: string | null }>();
  if (unicos.length === 0) return out;
  const docs = await db.getAll(...unicos.map((e) => db.collection("users").doc(e)));
  docs.forEach((d, i) => {
    const dados = d.data() as { name?: string; discordId?: string } | undefined;
    out.set(unicos[i], {
      name: dados?.name?.trim() || unicos[i],
      // Ausente enquanto ninguém vinculou a conta — é o caso de hoje, e o aviso
      // sai igual, só sem a menção. Quem preenche este campo é
      // `api/discord/interactions`.
      discordId: dados?.discordId?.trim() || null,
    });
  });
  return out;
}

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Corpo;

    const cardId = id(body.cardId);
    const eventoId = id(body.eventoId);
    if (!cardId || !eventoId) throw new HttpError(400, "Aviso sem card ou evento.");

    const db = adminDb();
    const cardRef = db.collection("cards").doc(cardId);
    const evRef = cardRef.collection("historico").doc(eventoId);
    const [cardSnap, evSnap] = await db.getAll(cardRef, evRef);

    if (!cardSnap.exists) throw new HttpError(404, "Demanda não encontrada.");
    if (!evSnap.exists) throw new HttpError(404, "Evento não encontrado.");

    const card = cardSnap.data() as CardDoc;
    const ev = evSnap.data() as EventoDoc;
    const sector = (card.sector ?? "").trim();

    if (caller.role !== "admin" && !caller.sectors.includes(sector)) {
      throw new HttpError(403, "Você não participa do setor desta demanda.");
    }

    if (ev.discordAt) {
      return NextResponse.json({ enviado: false, motivo: "ja-avisado" });
    }

    const acao = ev.acao ?? "editada";
    const mudancas = ev.mudancas ?? [];
    if (!deveAvisar(acao, mudancas)) {
      return NextResponse.json({ enviado: false, motivo: "sem-noticia" });
    }

    const url = webhookDoSetor(
      sector,
      process.env.DISCORD_WEBHOOK_URL,
      process.env.DISCORD_WEBHOOK_URLS,
    );
    if (!url) {
      // Sem webhook configurado o app funciona igual — é o estado de qualquer
      // Preview antes de alguém colar a variável. Não é erro.
      return NextResponse.json({ enviado: false, motivo: "sem-webhook" });
    }

    // As colunas do setor, para trocar `columnId` pelo título que se lê no
    // quadro. Uma consulta pequena e escopada — o mesmo recorte que a tela usa.
    const [pessoas, colsSnap] = await Promise.all([
      nomes(db, [ev.autor ?? "", card.assignee ?? ""]),
      db.collection("columns").where("sector", "==", sector).get(),
    ]);
    const etapa =
      colsSnap.docs
        .map((d) => d.data() as { colId?: string; title?: string })
        .find((c) => c.colId === card.columnId)?.title ?? null;

    const autorEmail = (ev.autor ?? "").trim().toLowerCase();
    const respEmail = (card.assignee ?? "").trim().toLowerCase();
    const resp = respEmail ? pessoas.get(respEmail) : null;

    const cardDoAviso: CardDoAviso = {
      id: cardId,
      sector,
      title: card.title ?? "",
      etapa,
      responsavel: resp?.name ?? null,
      responsavelDiscordId: resp?.discordId ?? null,
      solicitante: card.requester ?? null,
      setorSolicitante: card.requesterSector ?? null,
      prazo: card.due ?? null,
      prioridade: card.priority ?? null,
      tipo: card.type ?? null,
    };

    const eventoDoAviso: EventoDoAviso = {
      id: eventoId,
      autor: pessoas.get(autorEmail)?.name ?? autorEmail,
      // `em` é `serverTimestamp()` e pode estar nulo por alguns milissegundos —
      // mesmo caso que `carregarHistorico` trata. Aqui a hora atual é a
      // aproximação certa: o evento acabou de ser gravado.
      em: ev.em?.toMillis?.() ?? Date.now(),
      acao,
      mudancas,
    };

    /**
     * A MARCA VEM ANTES DO ENVIO, e é isso que impede o aviso duplicado.
     *
     * Duas requisições para o mesmo evento — um retry do `keepalive`, um duplo
     * clique — chegam juntas e as duas leem `discordAt` vazio. Só a transação
     * decide quem ganha. Marcar depois do envio deixaria a janela aberta
     * exatamente durante a chamada de rede, que é o pedaço lento.
     *
     * O preço é que uma falha de envio precisa DESFAZER a marca, senão o evento
     * fica registrado como avisado sem nunca ter sido — e o reenvio, a única
     * correção possível, deixaria de acontecer para sempre.
     */
    try {
      await db.runTransaction(async (tx) => {
        const atual = await tx.get(evRef);
        if (atual.data()?.discordAt) throw new HttpError(409, "ja-avisado");
        tx.update(evRef, { discordAt: FieldValue.serverTimestamp() });
      });
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        return NextResponse.json({ enviado: false, motivo: "ja-avisado" });
      }
      throw e;
    }

    try {
      await enviarAviso(
        url,
        montarAviso({
          card: cardDoAviso,
          evento: eventoDoAviso,
          appUrl: process.env.APP_URL ?? null,
          rotulo: { prioridade: rotuloPrioridade, tipo: rotuloTipo },
        }),
      );
    } catch (e) {
      await evRef.update({ discordAt: FieldValue.delete() }).catch(() => {});
      throw e;
    }

    return NextResponse.json({ enviado: true });
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
