/**
 * O começo do vínculo em um clique: devolve para onde o botão manda a pessoa.
 *
 * POR QUE UMA ROTA, e não a URL montada no navegador. O `state` precisa nascer
 * do lado de cá, amarrado ao e-mail da SESSÃO — é ele que prova, no retorno,
 * quem apertou o botão. Montado no cliente, o e-mail viria de um campo que
 * qualquer pessoa edita no console, e o vínculo passaria a ser "diga quem você
 * é" em vez de "prove".
 *
 * `DISCORD_CLIENT_ID` é público por natureza (ele aparece na URL de autorização
 * que o navegador abre). Fica aqui mesmo assim, e não em `NEXT_PUBLIC_*`, para
 * a montagem inteira morar num lugar só: com metade da URL no bundle e metade
 * aqui, um `redirect_uri` divergente viraria erro do Discord sem nada no log
 * dizendo qual das duas metades estava errada.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import {
  VALIDADE_ESTADO_MS,
  urlDeAutorizacao,
  urlDeRetorno,
} from "@/lib/discord-oauth-core";

export const runtime = "nodejs";

/** Onde os `state` esperam. Só o servidor enxerga (ver as regras). */
const COL_ESTADOS = "discordOauth";

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);

    const clientId = (process.env.DISCORD_CLIENT_ID ?? "").trim();
    const retorno = urlDeRetorno(process.env.APP_URL);
    if (!clientId || !retorno) {
      // Mensagem de configuração, e não "erro inesperado": quem vê isto é
      // alguém do setor tentando conectar, e a única saída é um administrador
      // colar duas variáveis. Dizer qual falta economiza a ida ao log.
      throw new HttpError(
        503,
        "A conexão em um clique ainda não está configurada (falta DISCORD_CLIENT_ID ou APP_URL). Use a opção do código, logo abaixo.",
      );
    }

    const db = adminDb();
    const col = db.collection(COL_ESTADOS);

    // Os anteriores desta pessoa morrem agora. Sem isso, quem apertasse o botão
    // três vezes deixaria três `state` vivos por dez minutos — e cada um é um
    // convite aberto para ligar uma conta do Discord ao cadastro dela.
    const antigos = await col.where("email", "==", caller.email).get();
    if (!antigos.empty) {
      const lote = db.batch();
      antigos.forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }

    // 24 bytes em base64url: 32 caracteres, imprevisível, e é o id do documento
    // — a busca do retorno vira um `get` direto pelo caminho, sem consulta e
    // sem índice. Mesma decisão do código de seis dígitos.
    const estado = randomBytes(24).toString("base64url");
    const criadoEm = Date.now();
    await col.doc(estado).create({
      email: caller.email,
      criadoEm,
      // Nunca lido pelo app — está aqui para quem abrir o console do Firestore
      // e precisar saber o que é este documento sem ir ao código.
      expiraEm: new Date(criadoEm + VALIDADE_ESTADO_MS),
    });

    return NextResponse.json({
      url: urlDeAutorizacao({ clientId, urlDeRetorno: retorno, estado }),
      expiraEmSegundos: Math.round(VALIDADE_ESTADO_MS / 1000),
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("discord/oauth/iniciar:", e);
    return NextResponse.json({ error: message }, { status });
  }
}
