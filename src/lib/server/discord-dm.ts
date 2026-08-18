/**
 * A mensagem direta ao responsável — a metade que fala com a rede.
 *
 * A outra metade, que decide SE manda e O QUE escreve, é `discord-core.ts`
 * (`deveMandarDireto`, `montarAvisoDireto`): módulo puro, com teste no
 * `prebuild`. A fronteira é a mesma de `server/discord.ts` — aqui há `fetch`,
 * lá não há.
 *
 * POR QUE ISTO PRECISA DE TOKEN DE BOT, e o webhook não precisava. Webhook
 * publica num canal e mais nada; ele não tem identidade para abrir conversa com
 * ninguém. Mandar DM é agir COMO o aplicativo, e a API do Discord exige que ele
 * se identifique — `Authorization: Bot <token>`. Não existe caminho sem isso, e
 * é por isso que `DISCORD_BOT_TOKEN` deixou de ser variável só de máquina de
 * quem administra e passou a existir também em produção. A decisão está no
 * documento de desenho, com o motivo, porque ela contradiz o que estava escrito
 * lá antes.
 *
 * DUAS CHAMADAS, e não uma. O Discord não aceita "mande para o usuário X": ele
 * exige abrir (ou reencontrar) o canal privado com ele, e só então publicar.
 * `POST /users/@me/channels` é idempotente — chamá-lo de novo devolve o mesmo
 * canal, sem criar nada.
 *
 * E O ID DO CANAL NÃO É GUARDADO, de propósito. Guardá-lo economizaria uma ida
 * de rede de ~100 ms num caminho que ninguém está esperando, e custaria um
 * campo a mais para manter certo: o dia em que o cadastro trocasse de conta do
 * Discord, o canal guardado continuaria apontando para a caixa da pessoa
 * anterior — e a demanda de alguém chegaria em quem não tem nada com ela. Cem
 * milissegundos é barato demais para pagar por esse risco.
 */
import type { CorpoWebhook } from "@/lib/discord-core";

const API = "https://discord.com/api/v10";

/** Mesmo teto de `server/discord.ts`, e pelo mesmo motivo. */
const TIMEOUT_MS = 8000;

/**
 * O que aconteceu com a tentativa.
 *
 * `entregue: false` NUNCA é erro do app: a pessoa pode ter fechado a DM, saído
 * do servidor, ou o bot pode nem ter token. O aviso do canal já saiu nos três
 * casos, e o motivo existe para o log dizer qual foi.
 */
export type ResultadoDireto = {
  entregue: boolean;
  motivo?: "sem-token" | "dm-fechada" | "recusado" | "erro";
};

function cabecalho(token: string): HeadersInit {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Abre (ou reencontra) o canal privado com uma pessoa.
 *
 * O 403 aqui é o caso interessante e o mais comum: ele significa que a pessoa
 * desligou "mensagens diretas de membros do servidor" nas configurações de
 * privacidade dela. É escolha dela, e não defeito nosso — por isso vira motivo,
 * e não exceção.
 */
async function abrirCanal(
  token: string,
  discordId: string,
): Promise<{ id: string } | { falha: ResultadoDireto }> {
  const r = await fetch(`${API}/users/@me/channels`, {
    method: "POST",
    headers: cabecalho(token),
    body: JSON.stringify({ recipient_id: discordId }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (r.status === 403) return { falha: { entregue: false, motivo: "dm-fechada" } };
  if (!r.ok) {
    const detalhe = (await r.text().catch(() => "")).slice(0, 300);
    console.warn(`discord dm: não abriu canal (${r.status}). ${detalhe}`);
    return { falha: { entregue: false, motivo: "recusado" } };
  }

  const dados = (await r.json().catch(() => null)) as { id?: string } | null;
  const id = (dados?.id ?? "").trim();
  return id ? { id } : { falha: { entregue: false, motivo: "erro" } };
}

/**
 * Manda a mensagem direta. NUNCA lança.
 *
 * É a diferença de contrato para `enviarAviso`, que lança de propósito porque
 * quem chama usa a exceção para desfazer a marca de "já avisado". Aqui não há
 * marca própria: o direto é acompanhamento do aviso do canal, e o `discordAt`
 * do evento cobre os dois. Se esta função lançasse, uma DM fechada desfaria a
 * marca de um aviso que JÁ FOI publicado no canal — e o reenvio duplicaria a
 * mensagem lá para tentar de novo aqui.
 */
export async function enviarDireto(
  discordId: string,
  corpo: CorpoWebhook,
): Promise<ResultadoDireto> {
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  // Sem token o app funciona igual, só sem DM — é o estado de qualquer Preview
  // e do dia anterior a alguém colar a variável. Não é erro.
  if (!token) return { entregue: false, motivo: "sem-token" };

  const alvo = (discordId ?? "").trim();
  if (!alvo) return { entregue: false, motivo: "erro" };

  try {
    const canal = await abrirCanal(token, alvo);
    if ("falha" in canal) return canal.falha;

    const r = await fetch(`${API}/channels/${canal.id}/messages`, {
      method: "POST",
      headers: cabecalho(token),
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (r.ok) return { entregue: true };
    if (r.status === 403) return { entregue: false, motivo: "dm-fechada" };

    const detalhe = (await r.text().catch(() => "")).slice(0, 300);
    console.warn(`discord dm: recusada (${r.status}). ${detalhe}`);
    return { entregue: false, motivo: "recusado" };
  } catch (e) {
    console.warn("discord dm: não saiu", e);
    return { entregue: false, motivo: "erro" };
  }
}
