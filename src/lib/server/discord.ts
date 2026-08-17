/**
 * O envio para o webhook do Discord — a metade que fala com a rede.
 *
 * A outra metade, que decide O QUE se escreve, é `src/lib/discord-core.ts`:
 * módulo puro, com teste no `prebuild`. A divisão é a do AGENTS.md §4, e a
 * fronteira é exatamente esta: aqui há `fetch`, lá não há.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ, de propósito: não decide se o aviso vale a pena,
 * não monta o texto e não sabe o que é uma demanda. Ele recebe uma URL e um
 * corpo, e responde se saiu.
 */
import type { CorpoWebhook } from "@/lib/discord-core";

/**
 * Teto de espera de uma tentativa.
 *
 * A rota do aviso roda DEPOIS que a demanda já foi gravada — o usuário está
 * olhando o quadro, não esta requisição. Mas função serverless cobra por tempo
 * de parede, e um webhook pendurado seguraria a função até o limite da
 * plataforma. Oito segundos é folga larga para uma chamada que normalmente
 * responde em menos de um.
 */
const TIMEOUT_MS = 8000;

/**
 * Quanto se aceita esperar por um 429 antes de desistir.
 *
 * O Discord limita webhook por canal (5 execuções por 2 segundos, na prática).
 * Um quadro com três pessoas arrastando card ao mesmo tempo bate nisso. Esperar
 * o `retry_after` e tentar de novo resolve o caso comum; esperar mais do que
 * isso seria segurar a função por causa de uma mensagem que ninguém está
 * aguardando.
 */
const MAX_ESPERA_MS = 3000;

export class DiscordError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Reconhece uma URL de webhook do Discord.
 *
 * Existe porque `DISCORD_WEBHOOK_URL` é colada à mão no painel da Vercel, e o
 * modo de errar é colar o convite do servidor, o link do canal, ou a URL com um
 * espaço no fim. Sem esta conferência, o erro chega como um 404 do Discord
 * dentro de um `console.warn` que ninguém lê — e a integração fica "instalada"
 * sem nunca ter funcionado.
 *
 * Não valida o token: isso só o Discord sabe. Valida a FORMA, que é o que dá
 * para saber daqui.
 */
export function urlDeWebhookValida(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (
      u.protocol === "https:" &&
      (u.hostname === "discord.com" ||
        u.hostname === "discordapp.com" ||
        u.hostname.endsWith(".discord.com")) &&
      /^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

async function postar(url: string, corpo: CorpoWebhook): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Publica o aviso. Devolve `true` quando o Discord aceitou.
 *
 * LANÇA em falha de verdade, e é assim de propósito: quem chama só grava a
 * marca de "já avisado" quando isto volta bem. Engolir o erro aqui faria o
 * evento ficar marcado como avisado sem nunca ter sido — e o reenvio, que é a
 * única correção possível, deixaria de acontecer para sempre.
 */
export async function enviarAviso(
  url: string,
  corpo: CorpoWebhook,
): Promise<boolean> {
  if (!urlDeWebhookValida(url)) {
    throw new DiscordError(
      500,
      "A URL do webhook do Discord não tem a forma de um webhook do Discord. Confira DISCORD_WEBHOOK_URL na Vercel.",
    );
  }

  let r = await postar(url, corpo);

  if (r.status === 429) {
    // `retry_after` vem em SEGUNDOS, e fracionário (0.75). Tratá-lo como
    // milissegundos faz a retentativa sair na hora e tomar outro 429.
    const dados = (await r.json().catch(() => null)) as {
      retry_after?: number;
    } | null;
    const esperaMs = Math.round((dados?.retry_after ?? 1) * 1000);
    if (esperaMs > MAX_ESPERA_MS) {
      throw new DiscordError(429, `Discord pediu ${esperaMs} ms de espera.`);
    }
    await new Promise((ok) => setTimeout(ok, esperaMs));
    r = await postar(url, corpo);
  }

  if (r.ok) return true;

  // O corpo do erro do Discord é onde mora a causa ("Invalid Webhook Token",
  // "Unknown Webhook"). Sem ele, o log diria só "400" — e 400 do Discord tem
  // uma dúzia de causas diferentes.
  const detalhe = (await r.text().catch(() => "")).slice(0, 300);
  throw new DiscordError(
    r.status,
    `Discord recusou o aviso (${r.status}). ${detalhe}`.trim(),
  );
}
