/**
 * Envia um documento gerado por e-mail, com o conteúdo NO CORPO da mensagem.
 *
 * Por que no corpo e não como link: o Drive Compartilhado só abre para quem é
 * membro dele, e quem recebe um documento por e-mail quase nunca é. Mandar link
 * seria entregar uma porta trancada — o problema que já apareceu quando o
 * primeiro aviso saiu.
 *
 * Quem dispara entra SEMPRE em cópia. O remetente é a conta do B.I., então sem
 * a cópia a pessoa que compartilhou não teria nenhum registro do que enviou,
 * para quem, nem quando — e o destinatário responderia para o B.I. sem que ela
 * soubesse.
 */
import { NextResponse } from "next/server";
import { markdownParaEmail } from "@/lib/server/markdown-email";
import {
  HttpError,
  adminDb,
  driveToken,
  exportDocMarkdown,
  requireUser,
} from "@/lib/server/drive-server";
import { sendMail, mailerConfigured } from "@/lib/server/mailer";
import { DRIVE_OUTPUT_LABEL } from "@/lib/meetings";

export const runtime = "nodejs";

const KINDS = ["transcricao", "resumo", "detalhada", "didatica"] as const;
type Kind = (typeof KINDS)[number];

/** Teto de destinatários por envio. Compartilhar não é lista de transmissão. */
const MAX_DESTINATARIOS = 10;

function idDoLink(link: string): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]{20,})/.exec(link || "");
  return m ? m[1] : null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    if (!mailerConfigured()) {
      throw new HttpError(503, "O envio de e-mail não está configurado.");
    }

    const body = (await req.json().catch(() => ({}))) as {
      meetingId?: string;
      kind?: string;
      para?: string[];
      mensagem?: string;
    };

    const meetingId = (body.meetingId || "").trim();
    const kind = (body.kind || "").trim() as Kind;
    if (!meetingId) throw new HttpError(400, "Reunião não informada.");
    if (!KINDS.includes(kind)) throw new HttpError(400, "Documento inválido.");

    const para = [
      ...new Set(
        (body.para ?? [])
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => EMAIL_OK.test(e)),
      ),
    ];
    if (para.length === 0) {
      throw new HttpError(400, "Informe pelo menos um destinatário válido.");
    }
    if (para.length > MAX_DESTINATARIOS) {
      throw new HttpError(
        400,
        `No máximo ${MAX_DESTINATARIOS} destinatários por envio.`,
      );
    }

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
    if (!podeVer) throw new HttpError(403, "Você não tem acesso a esta reunião.");

    const outputs = Array.isArray(m.driveOutputs)
      ? (m.driveOutputs as { kind: string; name: string; link: string }[])
      : [];
    const alvo = outputs.find((o) => o.kind === kind);
    if (!alvo) throw new HttpError(404, "Este documento não existe na reunião.");
    const fileId = idDoLink(alvo.link);
    if (!fileId) throw new HttpError(422, "O link deste documento é inválido.");

    const token = await driveToken();
    const markdown = await exportDocMarkdown(token, fileId);
    const corpoDoc = await markdownParaEmail(markdown);

    const titulo = (m.title as string) || "Reunião";
    const rotulo = DRIVE_OUTPUT_LABEL[kind];
    const recado = String(body.mensagem ?? "").trim().slice(0, 800);

    // 1080px em vez dos 680 tradicionais de e-mail promocional: aqui o corpo é
    // um DOCUMENTO — a Ata detalhada tem tabelas de duas colunas largas e uma
    // matriz de ação, e a 680 o texto ficava espremido numa faixa central com
    // as laterais vazias. `width="100%"` com `max-width` continua encolhendo
    // bem no celular.
    const html = `<div style="background:#faf6ef;padding:24px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:1080px;margin:0 auto;background:#fffdf8;border:1px solid #e6ddcf;">
    <tr><td style="padding:26px 34px 6px;">
      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#a08b6d;">Smart Meet · ${esc(rotulo)}</p>
      <p style="margin:0 0 2px;font-family:Arial,sans-serif;font-size:13px;color:#7a6f61;">
        ${esc(titulo)} · ${esc(setor)} — enviado por ${esc(caller.email)}
      </p>
    </td></tr>
    ${
      recado
        ? `<tr><td style="padding:10px 34px 0;">
             <p style="margin:0;padding:12px 14px;background:#fbf7f0;border-left:3px solid #c99a4e;font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#4a4237;white-space:pre-wrap;">${esc(recado)}</p>
           </td></tr>`
        : ""
    }
    <tr><td style="padding:18px 34px 28px;">
      ${corpoDoc}
      <p style="margin:24px 0 0;font-family:Arial,sans-serif;font-size:11.5px;line-height:1.5;color:#9b8f7e;border-top:1px solid #ece4d7;padding-top:12px;">
        Documento gerado por IA a partir do áudio da reunião — confira antes de usar como registro oficial.
      </p>
    </td></tr>
  </table>
</div>`;

    await sendMail({
      to: para,
      cc: [caller.email],
      subject: `${rotulo} — ${titulo}`,
      html,
    });

    await db.collection("logs").add({
      tipo: "documento.enviado",
      meetingId,
      sector: setor,
      kind,
      por: caller.email,
      para,
      em: new Date(),
    });

    return NextResponse.json({ ok: true, enviados: para.length });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("drive/enviar-doc:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
