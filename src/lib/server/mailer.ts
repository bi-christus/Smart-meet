/**
 * Transporte de e-mail do app: SMTP do Gmail com senha de app.
 *
 * Por que não a conta de serviço que já fala com o Drive: enviar e-mail COMO um
 * usuário exige Delegação em Todo o Domínio, aprovada no Admin Console de um
 * Google Workspace. A conta principal é um gmail.com comum, então esse caminho
 * não existe — e o remetente precisa ser um endereço real, porque os
 * destinatários são institucionais (@christus.com.br) e um remetente
 * desconhecido cai em spam.
 *
 * A senha de app é gerada em myaccount.google.com/apppasswords (exige 2FA
 * ligada), não expira e é revogável isoladamente, sem mexer na senha da conta.
 *
 * Trocar de transporte depois (Resend, SMTP de outro provedor) é substituir só
 * o corpo de `sendMail` — nada mais no app conhece o Gmail.
 */
import nodemailer from "nodemailer";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type MailRequest = {
  to: string[];
  /** Sempre em cópia. Quem dispara pelo app precisa ter o registro do envio. */
  cc?: string[];
  subject: string;
  html: string;
  attachments?: MailAttachment[];
};

/** Um envio com anexos não deveria passar disso; o Gmail recusa perto de 25 MB. */
export const MAX_ANEXOS_BYTES = 20 * 1024 * 1024;

export function mailerConfigured(): boolean {
  return !!(process.env.MAIL_USER && process.env.MAIL_APP_PASSWORD);
}

/**
 * O Google mostra a senha de app em grupos de quatro ("abcd efgh ijkl mnop") e
 * é comum colar com os espaços. O SMTP recusaria em silêncio, então limpamos.
 */
function senhaLimpa(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/** Versão em texto puro, para clientes que não renderizam HTML. */
function textoSimples(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|h1|h2|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Envia a mensagem. Lança em qualquer falha — quem chama decide o que fazer.
 * No aviso de reunião processada, falhar significa apenas não gravar
 * `notifiedAt`, e a varredura seguinte tenta de novo.
 */
export async function sendMail(msg: MailRequest): Promise<void> {
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("MAIL_USER/MAIL_APP_PASSWORD não configurados.");
  }

  const to = msg.to.map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) throw new Error("Nenhum destinatário.");
  // Quem já está no "para" não precisa aparecer também em cópia.
  const cc = (msg.cc ?? [])
    .map((e) => e.trim())
    .filter((e) => e && !to.includes(e));

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // TLS direto: numa função serverless é um round-trip a menos que o STARTTLS da 587
    auth: { user, pass: senhaLimpa(pass) },
  });

  try {
    await transporter.sendMail({
      from: { name: process.env.MAIL_FROM_NAME || "Smart Meet", address: user },
      to,
      ...(cc.length ? { cc } : {}),
      subject: msg.subject,
      text: textoSimples(msg.html),
      html: msg.html,
      attachments: msg.attachments,
    });
  } finally {
    // A função serverless pode ser congelada logo depois; fechar o pool evita
    // deixar um socket pendurado até o timeout.
    transporter.close();
  }
}
