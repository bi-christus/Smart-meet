/**
 * Envia o relatório de demandas para o gestor.
 *
 * O corpo do e-mail é montado AQUI, no servidor, a partir dos cards lidos do
 * Firestore — nunca do HTML que o cliente mandaria. Duas razões:
 *
 * 1. Aceitar HTML do cliente permitiria a qualquer usuário autenticado enviar
 *    conteúdo arbitrário a partir da conta institucional do B.I.
 * 2. O cliente enxerga um setor; o relatório precisa do escopo real e das
 *    permissões conferidas no servidor.
 *
 * O cliente manda apenas o RECORTE (setores, destinatários, recado). A prévia
 * na tela roda o mesmo `montarRelatorio`, então o que se vê é o que sai.
 */
import { NextResponse } from "next/server";
import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import { sendMail, mailerConfigured } from "@/lib/server/mailer";
import { agregar } from "@/lib/relatorio/agregar";
import { montarRelatorio } from "@/lib/relatorio/montar";
import { PREFS_PADRAO, MAX_DESTINATARIOS } from "@/lib/relatorio/config";
import type { Card, ColumnDoc } from "@/lib/kanban";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    if (!mailerConfigured()) {
      throw new HttpError(503, "O envio de e-mail não está configurado.");
    }

    const body = (await req.json().catch(() => ({}))) as {
      setor?: string;
      para?: string[];
      recado?: string;
      /** Envio de teste: manda só para quem disparou. */
      teste?: boolean;
    };

    const setor = (body.setor || "").trim();
    if (!setor) throw new HttpError(400, "Setor não informado.");

    // A restrição real de escopo é aqui, não na tela.
    if (caller.role !== "admin" && !caller.sectors.includes(setor)) {
      throw new HttpError(403, "Você não participa deste setor.");
    }

    const teste = body.teste === true;
    const para = teste
      ? [caller.email]
      : [
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
    const [cardsSnap, colsSnap, usersSnap] = await Promise.all([
      db.collection("cards").where("sector", "==", setor).get(),
      db.collection("columns").where("sector", "==", setor).get(),
      db.collection("users").get(),
    ]);

    const cards = cardsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Card,
    );
    if (cards.length === 0) {
      throw new HttpError(409, `O quadro de ${setor} não tem demandas.`);
    }
    const colunas = colsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as ColumnDoc)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const nomePorEmail: Record<string, string> = {};
    usersSnap.forEach((d) => {
      const u = d.data();
      const email = String(u.email || d.id).toLowerCase();
      if (u.name) nomePorEmail[email] = String(u.name);
    });

    const agora = Date.now();
    const prefs = { ...PREFS_PADRAO, setores: [setor] };
    const dados = agregar(cards, colunas, nomePorEmail, prefs, agora);
    const rel = montarRelatorio(dados, prefs, {
      setores: [setor],
      enviadoPor: nomePorEmail[caller.email] ?? caller.email,
      recado: String(body.recado ?? "").trim().slice(0, 800) || undefined,
      agora,
    });

    await sendMail({
      to: para,
      // Quem dispara entra em cópia — mas não no teste, senão ele receberia
      // duas vezes a mesma mensagem.
      cc: teste ? [] : [caller.email],
      subject: teste ? `[TESTE] ${rel.assunto}` : rel.assunto,
      html: rel.html,
      text: rel.texto,
      replyTo: caller.email,
    });

    await db.collection("logs").add({
      tipo: teste ? "relatorio.teste" : "relatorio.enviado",
      sector: setor,
      por: caller.email,
      para,
      demandas: dados.total,
      linhasEnviadas: rel.linhasEnviadas,
      linhasCortadas: rel.linhasCortadas,
      bytes: rel.bytes,
      em: new Date(),
    });

    return NextResponse.json({
      ok: true,
      enviados: para.length,
      demandas: dados.total,
      linhasEnviadas: rel.linhasEnviadas,
      linhasCortadas: rel.linhasCortadas,
      bytes: rel.bytes,
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("kanban/relatorio:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
