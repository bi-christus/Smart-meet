/**
 * O lado do Smart Meet do vínculo: gerar o código, e desfazer a ligação.
 *
 * A outra ponta é `api/discord/interactions`, que recebe o `/vincular`. Esta
 * rota exige login (`requireUser`); aquela exige assinatura do Discord. É a
 * separação que faz o vínculo valer alguma coisa — cada rota confere a ponta
 * que ela consegue conferir, e nenhuma das duas liga nada sozinha.
 *
 * O CÓDIGO É O ID DO DOCUMENTO, e não um campo. Assim a busca do `/vincular` é
 * um `get` direto pelo caminho, sem consulta e sem índice — e a unicidade é do
 * banco, não de uma checagem que alguém pode esquecer de fazer.
 */
import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import {
  VALIDADE_CODIGO_MS,
  gerarCodigo,
  segundosRestantes,
} from "@/lib/discord-vinculo-core";

export const runtime = "nodejs";

const COL_CODIGOS = "discordCodigos";

/** Tentativas de sorteio antes de desistir, em caso de código já ocupado. */
const TENTATIVAS = 5;

/**
 * Gera um código novo para quem está logado.
 *
 * Apaga os códigos anteriores da mesma pessoa antes de criar o novo. Sem isso,
 * quem apertasse o botão três vezes deixaria três códigos vivos, e os dois
 * abandonados continuariam valendo por dez minutos — segredos esquecidos num
 * banco, exatamente o que ninguém pretendeu criar.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    const db = adminDb();
    const col = db.collection(COL_CODIGOS);

    const antigos = await col.where("email", "==", caller.email).get();
    if (!antigos.empty) {
      const lote = db.batch();
      antigos.forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }

    const criadoEm = Date.now();
    for (let i = 0; i < TENTATIVAS; i++) {
      // `randomInt` e não `Math.random()`: este número autoriza uma ligação de
      // conta, e `Math.random()` é previsível o bastante para não servir a nada
      // que autoriza.
      const codigo = gerarCodigo((teto) => randomInt(teto));
      try {
        // `create` e não `set`: falha se o id já existir, que é o jeito de a
        // colisão virar retentativa em vez de roubo silencioso do código de
        // outra pessoa.
        await col.doc(codigo).create({
          email: caller.email,
          criadoEm,
          // Nunca lido pelo app — está aqui para quem abrir o console do
          // Firestore e precisar saber o que é este documento sem ir ao código.
          expiraEm: new Date(criadoEm + VALIDADE_CODIGO_MS),
        });
        return NextResponse.json({
          codigo,
          expiraEmSegundos: segundosRestantes(criadoEm, Date.now()),
        });
      } catch {
        // Id ocupado — sorteia outro.
      }
    }
    throw new HttpError(503, "Não consegui gerar um código agora. Tente de novo.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("discord/vinculo POST:", e);
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Desfaz o vínculo pelo lado de cá.
 *
 * Existe além do `/desvincular` do Discord porque os dois lados somem de jeitos
 * diferentes: quem sai da empresa perde o e-mail, quem troca de servidor perde
 * o Discord. Ter só um dos botões deixaria alguém preso a uma menção que não
 * consegue desligar de onde está.
 */
export async function DELETE(req: Request) {
  try {
    const caller = await requireUser(req);
    const db = adminDb();
    const ref = db.collection("users").doc(caller.email);

    const snap = await ref.get();
    const atual = (snap.data() as { discordId?: string } | undefined)?.discordId;
    if (!atual) return NextResponse.json({ ok: true, jaEstavaSolto: true });

    await ref.update({
      discordId: FieldValue.delete(),
      discordUser: FieldValue.delete(),
    });
    await db.collection("logs").add({
      tipo: "discord.desvinculado",
      por: caller.email,
      em: new Date(),
      discordId: atual,
      origem: "app",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("discord/vinculo DELETE:", e);
    return NextResponse.json({ error: message }, { status });
  }
}
