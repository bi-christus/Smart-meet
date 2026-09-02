/**
 * A ata de uma reunião que já foi processada.
 *
 * O cliente manda `meetingId` e o setor de destino; o servidor lê o documento
 * "Pontos importantes" no Drive, extrai a pauta com `ata-de-reuniao-core` e
 * grava a ata. Nada de IA: a estrutura já está no documento — o porquê inteiro
 * está no cabeçalho daquele módulo.
 *
 * ⚠️ NÃO recebe fileId do cliente, pela mesma razão de `api/drive/doc`: aceitar
 * um id arbitrário transformaria esta rota num proxy de leitura do Drive
 * Compartilhado inteiro, com a conta de serviço. O arquivo é resolvido a partir
 * dos `driveOutputs` da reunião.
 *
 * ⚠️ DUAS AUTORIZAÇÕES, E NENHUMA DELAS É OPCIONAL. Esta rota usa o Admin SDK,
 * e o Admin SDK IGNORA `firestore.rules` — aqui a checagem em TypeScript não é
 * a primeira barreira, é a única. É a lição que `check-demandas-boundary.mjs`
 * registra sobre `api/demandas/expurgar`, e é por isso que este arquivo entrou
 * na lista de alvos daquele guarda.
 *
 *   1. Ler a reunião: admin, dono do envio, ou gestor do setor DELA — a mesma
 *      de `api/drive/doc`.
 *   2. Escrever a ata: pertencer ao setor de DESTINO. As duas são necessárias
 *      porque elas são setores diferentes com frequência: a reunião das
 *      cantinas correu no setor B.I. e a ata dela pertence a Cantinas. Checar
 *      só a primeira deixaria qualquer gestor plantar ata em setor alheio.
 *
 * ESTA ROTA NÃO CRIA CARD, e nunca vai criar. Um card só nasce por decisão
 * humana em `api/demandas/decidir`.
 */
import { NextResponse } from "next/server";
import {
  HttpError,
  adminDb,
  driveToken,
  exportDocMarkdown,
  requireUser,
} from "@/lib/server/drive-server";
import {
  ligarCards,
  montarAtaDaReuniao,
  type ReuniaoDaAta,
} from "@/lib/ata-de-reuniao-core";
import type { DimensaoDaPauta } from "@/lib/ata-core";
// As tres regras desta rota moram num modulo puro, com teste — ver o cabecalho
// de `ata-gerar-core.ts`.
import { ehJaExiste, idDaAta, paraQuemPediu } from "@/lib/ata-gerar-core";

export const runtime = "nodejs";

/** O id do arquivo dentro de um link do Docs — igual ao de `api/drive/doc`. */
function idDoLink(link: string): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]{20,})/.exec(link || "");
  return m ? m[1] : null;
}

function limpo(v: unknown, teto: number): string {
  return String(v ?? "").trim().slice(0, teto);
}

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const meetingId = limpo(body.meetingId, 200);
    const setor = limpo(body.setor, 80);

    if (!meetingId) throw new HttpError(400, "Reunião não informada.");
    if (!setor) throw new HttpError(400, "Setor de destino não informado.");

    const db = adminDb();
    const snap = await db.collection("meetings").doc(meetingId).get();
    if (!snap.exists) throw new HttpError(404, "Reunião não encontrada.");
    const m = snap.data()!;

    // ---- autorização 1: ler esta reunião ----
    const setorDaReuniao = (m.sector as string) ?? "";
    const dono = String(m.createdBy ?? "").toLowerCase() === caller.email;
    const podeLer =
      caller.role === "admin" ||
      dono ||
      (caller.role === "gestor" && caller.sectors.includes(setorDaReuniao));
    if (!podeLer) throw new HttpError(403, "Você não tem acesso a esta reunião.");

    // ---- autorização 2: escrever no setor de destino ----
    if (caller.role !== "admin" && !caller.sectors.includes(setor)) {
      throw new HttpError(403, `Você não participa do setor "${setor}".`);
    }

    if (m.status !== "processado") {
      throw new HttpError(
        409,
        "Esta reunião ainda não foi processada. A ata sai do documento que o processamento gera.",
      );
    }

    /**
     * Idempotência em DOIS passos, e o segundo é o que fecha a corrida.
     *
     * A consulta sozinha era um check-then-add: dois pedidos simultâneos — duas
     * pessoas do setor, ou a mesma pessoa em duas abas — rodavam a leitura
     * antes de qualquer escrita, nenhum achava nada, e os dois gravavam.
     * Nasciam duas atas com o mesmo `meetingId` e o mesmo setor, mesmo título e
     * mesma data na lista; a partir dali as decisões da reunião se dividiam
     * entre as duas conforme quem tinha aberto qual, e nada na tela dizia que
     * havia duas.
     *
     * PASSO 1, a consulta, continua — e não por hábito: ela é a única coisa que
     * enxerga as atas gravadas ANTES desta versão, que têm id aleatório. Sem
     * ela, gerar de novo a ata de uma reunião antiga criaria uma segunda, e a
     * primeira — com as decisões já escritas dentro — ficaria órfã.
     *
     * PASSO 2 é o `create()` com id determinístico, logo abaixo. `create` falha
     * com ALREADY_EXISTS quando o documento já está lá, e essa falha é atômica
     * no servidor do Firestore: dos dois pedidos simultâneos, um grava e o
     * outro recebe a recusa e devolve o id do vencedor.
     *
     * O campo único da consulta segue de propósito: somar `setor` exigiria um
     * índice composto novo, e o filtro em memória custa nada — uma reunião gera
     * uma ata, duas no limite.
     */
    const jaExiste = await db
      .collection("atas")
      .where("meetingId", "==", meetingId)
      .get();
    const mesma = jaExiste.docs.find((d) => d.data().setor === setor);
    if (mesma) {
      return NextResponse.json({ id: mesma.id, jaExistia: true });
    }

    // ---- o documento ----
    const outputs = Array.isArray(m.driveOutputs)
      ? (m.driveOutputs as { kind: string; name: string; link: string }[])
      : [];
    const alvo = outputs.find((o) => o.kind === "resumo");
    if (!alvo) {
      throw new HttpError(
        422,
        'Esta reunião não tem o documento "Pontos importantes", que é de onde a pauta sai.',
      );
    }
    const fileId = idDoLink(alvo.link);
    if (!fileId) {
      throw new HttpError(422, "O link deste documento não é um Google Doc.");
    }
    const markdown = await exportDocMarkdown(await driveToken(), fileId);

    // ---- a árvore do setor de destino, para classificar os assuntos ----
    const dimsSnap = await db
      .collection("dimensoes")
      .where("setor", "==", setor)
      .get();
    const dimensoes: DimensaoDaPauta[] = dimsSnap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        nome: String(x.nome ?? ""),
        ordem: Number(x.ordem ?? 0),
        subs: Array.isArray(x.subs)
          ? (x.subs as { id?: unknown; nome?: unknown }[]).map((s) => ({
              id: String(s.id ?? ""),
              nome: String(s.nome ?? ""),
            }))
          : [],
      };
    });

    const reuniao: ReuniaoDaAta = {
      id: meetingId,
      title: String(m.title ?? ""),
      date: String(m.date ?? ""),
      participants: Array.isArray(m.participants)
        ? (m.participants as unknown[]).filter(
            (p): p is string => typeof p === "string" && !!p,
          )
        : [],
      createdBy: String(m.createdBy ?? ""),
    };

    const ata = montarAtaDaReuniao({ markdown, reuniao, setor, dimensoes });
    ata.itens = ligarCards(ata.itens, await cardsDaReuniao(db, setor, meetingId));

    const ref = db.collection("atas").doc(idDaAta(meetingId, setor));
    try {
      await ref.create({
        ...ata,
        createdAt: new Date(),
        createdBy: caller.email,
      });
    } catch (e) {
      // ALREADY_EXISTS (código 6 do gRPC) é o outro pedido tendo chegado
      // primeiro — o desfecho CERTO da corrida, e não uma falha. Devolvemos o
      // id, que é o mesmo, com a mesma resposta de quem achou na consulta.
      if (ehJaExiste(e)) {
        return NextResponse.json({ id: ref.id, jaExistia: true });
      }
      throw e;
    }

    return NextResponse.json({ id: ref.id, jaExistia: false });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    /**
     * O LOG LEVA O ERRO INTEIRO; a resposta leva uma frase em português.
     *
     * Eram duas coisas erradas de uma vez. Para fora, `e.message` ia cru: quando
     * a conta de serviço perde acesso ao Doc, `driveFetch` lança
     * `Drive API 404: {json do Google}` — e o modal imprimia esse JSON, em
     * inglês, com id de arquivo, para quem só queria gerar a ata.
     *
     * Para dentro, o `console.error` só rodava em `status >= 500` e logava a
     * MENSAGEM, jogando o stack fora. É o defeito que AGENTS.md §5 registra
     * sobre as 13 rotas de `api/`: elas capturam o próprio erro, devolvem JSON,
     * nada propaga para o Next, e o que sobra no log não diz onde quebrou.
     * Agora todo status >= 400 loga o objeto inteiro.
     */
    console.error("ata/gerar:", e);
    return NextResponse.json(
      {
        error: paraQuemPediu(
          e instanceof HttpError ? { status: e.status, message: e.message } : null,
        ),
      },
      { status },
    );
  }
}

/**
 * Os cards do setor de destino que esta mesma reunião já produziu, com o
 * assunto que os originou.
 *
 * O caminho é card → `propostaId` → proposta → `assunto`, e o assunto é, por
 * contrato do sidecar, o cabeçalho do bloco em "Pontos importantes". É isso que
 * torna o casamento exato em vez de heurístico.
 *
 * `meetingIds` é filtrado em memória em vez de por `array-contains`: somado ao
 * `sector` daria um índice composto novo, e um setor tem dezenas de cards.
 */
async function cardsDaReuniao(
  db: FirebaseFirestore.Firestore,
  setor: string,
  meetingId: string,
): Promise<{ id: string; assunto: string }[]> {
  const cards = await db.collection("cards").where("sector", "==", setor).get();
  const daReuniao = cards.docs.filter((d) => {
    const c = d.data();
    if (c.deletedAt) return false;
    const ids = Array.isArray(c.meetingIds) ? (c.meetingIds as unknown[]) : [];
    return ids.includes(meetingId) && typeof c.propostaId === "string";
  });
  if (!daReuniao.length) return [];

  const propostas = await Promise.all(
    daReuniao.map((d) =>
      db.collection("demandPropostas").doc(String(d.data().propostaId)).get(),
    ),
  );
  return daReuniao
    .map((d, i) => ({
      id: d.id,
      assunto: String(propostas[i].data()?.assunto ?? ""),
    }))
    .filter((x) => !!x.assunto);
}
