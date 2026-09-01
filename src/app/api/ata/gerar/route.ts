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
     * Idempotência pelo `meetingId`, e só por ele.
     *
     * Consulta de campo único de propósito: somar `setor` exigiria um índice
     * composto novo, e o filtro em memória custa nada — uma reunião gera uma
     * ata, duas no limite. Sem isto, dois cliques no botão dariam duas atas
     * idênticas e ninguém saberia qual editar.
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

    const ref = await db.collection("atas").add({
      ...ata,
      createdAt: new Date(),
      createdBy: caller.email,
    });

    return NextResponse.json({ id: ref.id, jaExistia: false });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("ata/gerar:", message);
    return NextResponse.json({ error: message }, { status });
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
