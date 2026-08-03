/**
 * Aviso de "sua reunião ficou pronta" para quem enviou o áudio.
 *
 * Disparado por `api/drive/sync` no instante em que a reunião passa a
 * "processado" com arquivos linkados. O e-mail leva a transcrição e as atas
 * como anexos .docx, para que a pessoa consiga validar sem depender de ter
 * acesso à pasta do Drive Compartilhado.
 *
 * O HTML é escrito com estilo INLINE apenas: o app do Gmail remove blocos
 * <style> e classes, e o e-mail chegaria sem formatação nenhuma.
 */
import {
  sendMail,
  mailerConfigured,
  MAX_ANEXOS_BYTES,
  type MailAttachment,
} from "./mailer";
import { exportDoc, DOCX_MIME } from "./drive-server";

export type OutputKind = "transcricao" | "resumo" | "detalhada" | "didatica";
export type DriveOutput = { kind: OutputKind; name: string; link: string };
export type DriveFile = { id: string; name: string; mimeType: string };

const LABEL: Record<OutputKind, string> = {
  transcricao: "Transcrição",
  resumo: "Pontos importantes",
  detalhada: "Ata detalhada",
  didatica: "Ata didática",
};

/** Ordem de leitura: a ata principal primeiro, a transcrição por último. */
const ORDER: OutputKind[] = ["resumo", "detalhada", "didatica", "transcricao"];

const MIME_GDOC = "application/vnd.google-apps.document";

function sorted(outputs: DriveOutput[]): DriveOutput[] {
  return [...outputs].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** dd/mm/aaaa a partir de "aaaa-mm-dd", sem passar por Date (evita fuso). */
function dataBr(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
}

function corpo(args: {
  titulo: string;
  setor: string;
  data: string;
  outputs: DriveOutput[];
  appUrl: string | null;
  semAnexo: DriveOutput[];
}): string {
  const { titulo, setor, data, outputs, appUrl, semAnexo } = args;

  const linhas = sorted(outputs)
    .map((o) => {
      const nome = esc(o.name);
      const rotulo = esc(LABEL[o.kind]);
      const alvo = o.link
        ? `<a href="${esc(o.link)}" style="color:#8c5a2b;text-decoration:underline;">abrir no Drive</a>`
        : "";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e6ddcf;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#3b332a;"><strong>${rotulo}</strong><br><span style="font-size:13px;color:#7a6f61;">${nome}</span></td>
        <td style="padding:8px 12px;border-bottom:1px solid #e6ddcf;font-family:Arial,sans-serif;font-size:13px;text-align:right;white-space:nowrap;">${alvo}</td>
      </tr>`;
    })
    .join("");

  const aviso = semAnexo.length
    ? `<p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#8a5b1e;background:#fdf3e0;border-left:3px solid #c99a4e;padding:10px 12px;">
         ${semAnexo.length === 1 ? "Um arquivo não pôde ser anexado" : `${semAnexo.length} arquivos não puderam ser anexados`}
         (${esc(semAnexo.map((o) => LABEL[o.kind]).join(", "))}). Use os links da tabela para abrir no Drive.
       </p>`
    : "";

  const botao = appUrl
    ? `<p style="margin:24px 0 0;">
         <a href="${esc(appUrl)}/reunioes" style="display:inline-block;background:#3b332a;color:#faf6ef;font-family:Arial,sans-serif;font-size:14px;text-decoration:none;padding:11px 22px;border-radius:3px;">Validar no Smart Meet</a>
       </p>`
    : "";

  return `<div style="background:#faf6ef;padding:28px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;margin:0 auto;background:#fffdf8;border:1px solid #e6ddcf;">
    <tr><td style="padding:28px 32px 8px;">
      <p style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#a08b6d;">Smart Meet</p>
      <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:normal;color:#2c251d;">Sua reunião está pronta para validação</h1>
    </td></tr>
    <tr><td style="padding:12px 32px 0;">
      <p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#4a4237;">
        O processamento do áudio que você enviou terminou. A transcrição e a ata seguem em anexo, em formato Word, e também podem ser abertas direto no Drive.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf7f0;border:1px solid #e6ddcf;margin:0 0 18px;">
        <tr>
          <td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#7a6f61;">Reunião</td>
          <td style="padding:10px 12px;font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#2c251d;text-align:right;">${esc(titulo)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#7a6f61;border-top:1px solid #ece4d7;">Setor</td>
          <td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:14px;color:#2c251d;text-align:right;border-top:1px solid #ece4d7;">${esc(setor)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;color:#7a6f61;border-top:1px solid #ece4d7;">Data</td>
          <td style="padding:10px 12px;font-family:Arial,sans-serif;font-size:14px;color:#2c251d;text-align:right;border-top:1px solid #ece4d7;">${esc(dataBr(data))}</td>
        </tr>
      </table>
      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#a08b6d;">O que foi gerado</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e6ddcf;">
        ${linhas}
      </table>
      ${aviso}
      ${botao}
    </td></tr>
    <tr><td style="padding:22px 32px 28px;">
      <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#9b8f7e;border-top:1px solid #ece4d7;padding-top:14px;">
        Mensagem automática do Smart Meet. O conteúdo é gerado por IA a partir do áudio — confira antes de usar como registro oficial.
      </p>
    </td></tr>
  </table>
</div>`;
}

/**
 * Monta e envia o aviso. Devolve `false` (sem lançar) quando não há a quem
 * avisar ou o transporte não está configurado — assim o `sync` segue seu
 * trabalho normalmente num ambiente sem e-mail montado.
 *
 * Lança apenas em falha real de envio, para que o chamador NÃO grave
 * `notifiedAt` e a próxima varredura tente de novo.
 */
export async function notifyProcessed(args: {
  meeting: { title?: string; sector?: string; date?: string; createdBy?: string };
  outputs: DriveOutput[];
  files: DriveFile[];
  appUrl: string | null;
  /** Token do Drive, para exportar cada Doc como .docx e anexar. */
  token: string;
}): Promise<boolean> {
  const { meeting, outputs, files, appUrl, token } = args;

  const to = (meeting.createdBy || "").trim().toLowerCase();
  if (!to || !to.includes("@")) return false;
  if (outputs.length === 0) return false;
  if (!mailerConfigured()) {
    console.warn("notify: e-mail não configurado — aviso não enviado.");
    return false;
  }

  // O id do arquivo não vive no DriveOutput (que é o que o app guarda); casamos
  // pelo nome contra a listagem da pasta que o sync já tinha em mãos.
  const porNome = new Map(files.map((f) => [f.name, f]));
  const anexos: MailAttachment[] = [];
  const semAnexo: DriveOutput[] = [];
  let bytes = 0;

  for (const o of sorted(outputs)) {
    const f = porNome.get(o.name);
    // Só arquivos nativos do Google são exportáveis para .docx.
    if (!f || f.mimeType !== MIME_GDOC) {
      semAnexo.push(o);
      continue;
    }
    try {
      const content = await exportDoc(token, f.id);
      if (bytes + content.length > MAX_ANEXOS_BYTES) {
        semAnexo.push(o);
        continue;
      }
      bytes += content.length;
      anexos.push({
        // O nome vem do Drive e pode ter "/" ou ":", que quebram o anexo.
        filename: `${o.name.replace(/[\\/:*?"<>|]/g, "-")}.docx`,
        content,
        contentType: DOCX_MIME,
      });
    } catch (e) {
      // Um Doc que não exporta não pode impedir o aviso: o e-mail sai com os
      // links do Drive e um alerta de qual arquivo ficou sem anexo.
      console.warn("notify: falha ao exportar", o.name, e);
      semAnexo.push(o);
    }
  }

  // O endereço do botão NÃO pode sair da origem da requisição: o cron da Vercel
  // chama a URL interna do deploy (…-hash.vercel.app) e um teste local chamaria
  // localhost, mandando o destinatário para um endereço que não existe para
  // ele. APP_URL manda; a origem fica só como último recurso.
  const appBase =
    (process.env.APP_URL || appUrl || "").trim().replace(/\/+$/, "") || null;

  const titulo = meeting.title?.trim() || "Reunião sem título";
  await sendMail({
    to: [to],
    subject: `Smart Meet — "${titulo}" está pronta para validação`,
    html: corpo({
      titulo,
      setor: meeting.sector || "—",
      data: meeting.date || "",
      outputs,
      appUrl: appBase,
      semAnexo,
    }),
    attachments: anexos,
  });
  return true;
}
