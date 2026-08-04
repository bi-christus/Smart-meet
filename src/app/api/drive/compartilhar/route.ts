/**
 * Compartilha os documentos de uma reunião com outro usuário do app.
 *
 * Concede acesso DE VERDADE, não só devolve o link. Quem recebe um link do
 * Drive Compartilhado sem ser membro dele esbarra em "você precisa de acesso" —
 * foi exatamente o problema relatado quando o primeiro e-mail saiu. Um botão
 * "compartilhar" que entrega link morto é pior que não ter botão.
 *
 * Duas restrições fecham o alcance disto:
 *  - só documentos DESTA reunião, resolvidos pelos `driveOutputs` no servidor;
 *  - só para quem já é usuário ATIVO do app. Não serve para abrir o acervo
 *    para fora da instituição.
 */
import { NextResponse } from "next/server";
import {
  HttpError,
  adminDb,
  driveToken,
  requireUser,
  syncGrants,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

function idDoLink(link: string): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]{20,})/.exec(link || "");
  return m ? m[1] : null;
}

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as {
      meetingId?: string;
      email?: string;
    };

    const meetingId = (body.meetingId || "").trim();
    const para = (body.email || "").trim().toLowerCase();
    if (!meetingId) throw new HttpError(400, "Reunião não informada.");
    if (!para.includes("@")) throw new HttpError(400, "E-mail inválido.");

    const db = adminDb();
    const snap = await db.collection("meetings").doc(meetingId).get();
    if (!snap.exists) throw new HttpError(404, "Reunião não encontrada.");
    const m = snap.data()!;

    const setor = (m.sector as string) ?? "";
    const dono = String(m.createdBy ?? "").toLowerCase() === caller.email;
    const podeVer =
      caller.role === "admin" ||
      dono ||
      (caller.role === "gestor" && caller.sectors.includes(setor));
    if (!podeVer) {
      throw new HttpError(403, "Você não tem acesso a esta reunião.");
    }

    // Só usuário ativo do app. Sem isto, o botão viraria uma porta para
    // compartilhar ata de reunião com qualquer endereço de e-mail do mundo.
    const alvo = await db.collection("users").doc(para).get();
    if (!alvo.exists || alvo.data()?.active !== true) {
      throw new HttpError(
        404,
        "Essa pessoa não é um usuário ativo do Smart Meeting.",
      );
    }

    const outputs = Array.isArray(m.driveOutputs)
      ? (m.driveOutputs as { kind: string; name: string; link: string }[])
      : [];
    if (outputs.length === 0) {
      throw new HttpError(409, "Esta reunião ainda não tem documentos.");
    }

    const token = await driveToken();
    let concedidos = 0;
    for (const o of outputs) {
      const fileId = idDoLink(o.link);
      if (!fileId) continue;
      try {
        await syncGrants(token, fileId, [{ email: para, role: "reader" }]);
        concedidos++;
      } catch (e) {
        console.warn("drive/compartilhar: falhou em", o.name, e);
      }
    }
    if (concedidos === 0) {
      throw new HttpError(502, "Não foi possível conceder acesso agora.");
    }

    await db.collection("logs").add({
      tipo: "documentos.compartilhados",
      meetingId,
      sector: setor,
      por: caller.email,
      para,
      documentos: concedidos,
      em: new Date(),
    });

    return NextResponse.json({ ok: true, documentos: concedidos });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("drive/compartilhar:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
