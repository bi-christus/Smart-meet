/**
 * O retorno do Discord: fecha o vínculo em um clique.
 *
 * ESTA ROTA É PÚBLICA POR OBRIGAÇÃO — quem a chama é o navegador da pessoa,
 * voltando do Discord, sem token nosso e sem cabeçalho que possamos exigir. O
 * que a protege são duas coisas, e nenhuma delas é o que chega na query:
 *
 *   1. O `state`, que nasceu dentro de uma sessão autenticada do Smart Meet
 *      (`oauth/iniciar`) e é consumido aqui uma vez só. É ele que diz de quem é
 *      o cadastro — jamais um `email` vindo da URL.
 *   2. A troca do `code` por token, feita servidor-a-servidor com o
 *      `DISCORD_CLIENT_SECRET`. O `id` da conta do Discord vem dessa troca,
 *      nunca do navegador.
 *
 * Um `code` roubado sem o segredo não vale nada, e um `state` roubado sem a
 * conta do Discord também não. É a mesma aritmética dos dois segredos que
 * sustenta o `/vincular <codigo>`.
 *
 * ELA RESPONDE HTML, e não JSON nem redirecionamento. É o fim da linha de um
 * fluxo que abriu uma aba nova: não há tela do app atrás dela, e um JSON cru na
 * cara de quem só queria ser avisado das demandas é o pior fim possível. A aba
 * de origem, que continua aberta no Perfil, vira "Conectado" sozinha — ela
 * assina `users/{email}` desde antes do clique.
 */
import { NextResponse } from "next/server";

import { adminDb } from "@/lib/server/drive-server";
import { VinculoRecusado, ligarConta } from "@/lib/server/discord-vinculo";
import {
  alvoDoVinculo,
  estadoValido,
  frasePorMotivo,
  urlDeRetorno,
  VALIDADE_ESTADO_MS,
  type MotivoOauth,
} from "@/lib/discord-oauth-core";

export const runtime = "nodejs";

const API = "https://discord.com/api/v10";
const COL_ESTADOS = "discordOauth";
const TIMEOUT_MS = 8000;

/** O que o Discord devolve sobre a pessoa. Só isto é lido. */
type UsuarioDoDiscord = {
  id?: string;
  username?: string;
  global_name?: string;
  email?: string | null;
  verified?: boolean;
};

/**
 * A página que a pessoa lê no fim.
 *
 * Autossuficiente de propósito: sem CSS do app, sem fonte remota, sem script.
 * Ela é servida por uma rota de API, fora do layout, e qualquer dependência
 * externa aqui viraria uma tela em branco no exato momento em que a pessoa
 * precisa saber se deu certo.
 */
function pagina(args: {
  ok: boolean;
  titulo: string;
  frase: string;
  voltarPara: string | null;
}): NextResponse {
  const cor = args.ok ? "#3fa66b" : "#d64545";
  const escapar = (t: string) =>
    t.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c] as string,
    );
  const voltar = args.voltarPara
    ? `<a class="btn" href="${escapar(args.voltarPara)}">Voltar ao Smart Meet</a>`
    : "";
  const html = `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Smart Meet · Discord</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
         background:#0f1115; color:#e8e9ec;
         font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; padding:24px }
  .cartao { max-width:34rem; background:#171a21; border:1px solid #262a33;
            border-left:4px solid ${cor}; border-radius:12px; padding:28px 26px }
  h1 { margin:0 0 10px; font-size:1.25rem; letter-spacing:-.01em }
  p { margin:0 0 18px; color:#b9bcc4 }
  .btn { display:inline-block; padding:9px 16px; border-radius:8px;
         background:#ff6a2b; color:#141414; font-weight:600; text-decoration:none }
  .fecha { margin:0; font-size:.86rem; color:#7d828d }
</style>
</head><body><main class="cartao">
<h1>${escapar(args.titulo)}</h1>
<p>${escapar(args.frase)}</p>
${voltar}
<p class="fecha" style="margin-top:18px">Você já pode fechar esta aba.</p>
</main></body></html>`;
  return new NextResponse(html, {
    status: args.ok ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Página de fim de fluxo, com o resultado de uma ação de conta: guardá-la
      // em cache faria um retorno antigo reaparecer no lugar do novo.
      "Cache-Control": "no-store",
    },
  });
}

function base(): string | null {
  return (process.env.APP_URL || "").trim().replace(/\/+$/, "") || null;
}

function recusar(motivo: MotivoOauth): NextResponse {
  return pagina({
    ok: false,
    titulo: "Não deu para conectar",
    frase: frasePorMotivo(motivo),
    voltarPara: base(),
  });
}

/** Troca o `code` por um token de usuário. `null` = o Discord não aceitou. */
async function trocarPorToken(
  code: string,
  redirect: string,
): Promise<string | null> {
  const clientId = (process.env.DISCORD_CLIENT_ID ?? "").trim();
  const secret = (process.env.DISCORD_CLIENT_SECRET ?? "").trim();
  if (!clientId || !secret) return null;

  const r = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    // `redirect_uri` vai de novo, e tem de ser IDÊNTICA à do pedido de
    // autorização — o Discord compara as duas. Por isso as duas saem da mesma
    // função (`urlDeRetorno`) e nenhuma é digitada duas vezes.
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!r.ok) {
    console.warn(
      `discord/oauth: troca recusada (${r.status})`,
      (await r.text().catch(() => "")).slice(0, 300),
    );
    return null;
  }
  const dados = (await r.json().catch(() => null)) as {
    access_token?: string;
  } | null;
  return (dados?.access_token ?? "").trim() || null;
}

async function quemAutorizou(token: string): Promise<UsuarioDoDiscord | null> {
  const r = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) return null;
  return (await r.json().catch(() => null)) as UsuarioDoDiscord | null;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;

  // O "cancelar" da tela do Discord volta por aqui, e ele NÃO é falha: nada
  // aconteceu, e a pessoa precisa ler exatamente isso em vez de um erro.
  if (q.get("error")) return recusar("recusado");

  const code = (q.get("code") ?? "").trim();
  if (!code) return recusar("sem-codigo");

  const estado = (q.get("state") ?? "").trim();
  const retorno = urlDeRetorno(process.env.APP_URL);
  if (!retorno) return recusar("erro");

  try {
    const db = adminDb();

    // O `state` é consumido ANTES da ida ao Discord, numa transação: lido e
    // apagado de uma vez. Consumir depois deixaria a janela de reuso aberta
    // exatamente durante a chamada de rede, que é o pedaço lento — e o `state`
    // é justamente o que impede alguém de completar um fluxo que não começou.
    let emailDoEstado: string | null = null;
    if (estadoValido(estado)) {
      const ref = db.collection(COL_ESTADOS).doc(estado);
      await db
        .runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const d = snap.data() as { email?: string; criadoEm?: number };
          tx.delete(ref);
          if (Date.now() - (d.criadoEm ?? 0) >= VALIDADE_ESTADO_MS) return;
          emailDoEstado = (d.email ?? "").trim().toLowerCase() || null;
        })
        // Falha de transação aqui não pode derrubar o fluxo: o plano B do
        // e-mail verificado ainda pode salvar o vínculo.
        .catch((e) => console.warn("discord/oauth: state não consumido", e));
    }

    const token = await trocarPorToken(code, retorno);
    if (!token) return recusar("estado-invalido");

    const usuario = await quemAutorizou(token);
    const discordId = (usuario?.id ?? "").trim();
    if (!discordId) return recusar("erro");

    const emailDoDiscord = (usuario?.email ?? "").trim().toLowerCase() || null;

    // A consulta do plano B só acontece quando ele é o único caminho — com
    // `state` vivo, ler o cadastro do e-mail do Discord seria uma ida ao banco
    // para uma resposta que ninguém vai usar.
    let cadastroAtivo = false;
    if (!emailDoEstado && emailDoDiscord && usuario?.verified === true) {
      const snap = await db.collection("users").doc(emailDoDiscord).get();
      cadastroAtivo = snap.exists && snap.data()?.active === true;
    }

    const alvo = alvoDoVinculo({
      emailDoEstado,
      emailDoDiscord,
      emailDoDiscordVerificado: usuario?.verified === true,
      cadastroAtivoComEmailDoDiscord: cadastroAtivo,
    });
    if (!alvo) return recusar("nao-achei-cadastro");

    const nome =
      (usuario?.global_name || usuario?.username || "").trim() || discordId;
    const { desligou } = await ligarConta(db, {
      email: alvo.email,
      discordId,
      discordNome: nome,
      origem: "clique",
    });

    const extra = desligou
      ? " Esta conta do Discord estava ligada a outro cadastro; a ligação anterior foi desfeita."
      : "";
    return pagina({
      ok: true,
      titulo: "Pronto — contas conectadas",
      frase:
        `${nome} agora responde por ${alvo.email} no Smart Meet. ` +
        "Você vai ser mencionado nos avisos das demandas onde for o responsável, e receber no privado o que mexer nelas." +
        extra,
      voltarPara: base(),
    });
  } catch (e) {
    if (e instanceof VinculoRecusado) return recusar("sem-acesso");
    console.error("discord/oauth/callback:", e);
    return recusar("erro");
  }
}
