/**
 * Conteúdo de um documento gerado, para ler dentro do app.
 *
 * ⚠️ NÃO recebe um fileId do cliente, de propósito. Recebe `meetingId` + `kind`
 * e resolve o arquivo a partir dos `driveOutputs` da reunião. Aceitar um id
 * arbitrário transformaria esta rota num proxy de leitura do Drive
 * Compartilhado inteiro, com a conta de serviço — qualquer usuário do app
 * conseguiria ler o áudio ou a ata de qualquer setor sabendo só o id.
 *
 * A autorização é a MESMA da tela de relatórios: admin, dono do envio, ou
 * gestor do setor.
 */
import { NextResponse } from "next/server";
import {
  HttpError,
  adminDb,
  driveToken,
  exportDocMarkdown,
  requireUser,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

const KINDS = ["transcricao", "resumo", "detalhada", "didatica"] as const;
type Kind = (typeof KINDS)[number];

/** O id do arquivo dentro de um link do Docs. */
function idDoLink(link: string): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]{20,})/.exec(link || "");
  return m ? m[1] : null;
}

export async function GET(req: Request) {
  try {
    const caller = await requireUser(req);
    const url = new URL(req.url);
    const meetingId = (url.searchParams.get("meetingId") || "").trim();
    const kind = (url.searchParams.get("kind") || "").trim() as Kind;

    if (!meetingId) throw new HttpError(400, "Reunião não informada.");
    if (!KINDS.includes(kind)) throw new HttpError(400, "Documento inválido.");

    const snap = await adminDb().collection("meetings").doc(meetingId).get();
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

    const outputs = Array.isArray(m.driveOutputs)
      ? (m.driveOutputs as { kind: string; name: string; link: string }[])
      : [];
    const alvo = outputs.find((o) => o.kind === kind);
    if (!alvo) throw new HttpError(404, "Este documento não existe na reunião.");

    const fileId = idDoLink(alvo.link);
    if (!fileId) {
      throw new HttpError(422, "O link deste documento não é um Google Doc.");
    }

    const token = await driveToken();
    const markdown = await exportDocMarkdown(token, fileId);

    return NextResponse.json({
      nome: alvo.name,
      kind,
      link: alvo.link,
      markdown,
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("drive/doc:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
