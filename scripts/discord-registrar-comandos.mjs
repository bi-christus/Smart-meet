/**
 * Registra `/vincular` e `/desvincular` no servidor do Discord.
 *
 * RODA UMA VEZ, NA MÃO. Não entra no `prebuild` e não entra em cron: registrar
 * comando é ato de administração do aplicativo do Discord, não parte de um
 * deploy, e um PUT a cada build gastaria limite de requisição do Discord para
 * reescrever exatamente a mesma lista.
 *
 * Rode de novo só quando `COMANDOS`, em `src/lib/discord-vinculo-core.ts`,
 * mudar. A lista mora lá, e não aqui, porque os dois lados a leem: este script
 * a envia, e `api/discord/interactions` decide o que fazer pelo `name`. Em dois
 * lugares, um comando renomeado no script vira comando que o Discord oferece e
 * a rota não reconhece — e o sintoma é "a aplicação não respondeu", sem nada no
 * log.
 *
 *   DISCORD_APP_ID=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… \
 *     node scripts/discord-registrar-comandos.mjs
 *
 * POR QUE COMANDO DE SERVIDOR, e não global: o global demora até uma hora para
 * aparecer, e o de servidor aparece na hora. Este bot serve um servidor só — o
 * da Rede — então o global não traria vantagem nenhuma e custaria a espera
 * justamente no momento em que alguém está tentando conferir se funcionou.
 *
 * O token do bot NÃO precisa ir para a Vercel: nada em produção o usa. As
 * interações são autenticadas por assinatura, não por token nosso. Guardá-lo
 * como variável de ambiente do projeto seria expor uma credencial que só este
 * script, rodando na sua máquina, tem motivo para conhecer.
 */
import { COMANDOS } from "../src/lib/discord-vinculo-core.ts";

const APP_ID = process.env.DISCORD_APP_ID?.trim();
const TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();
const GUILD_ID = process.env.DISCORD_GUILD_ID?.trim();

const faltando = [
  ["DISCORD_APP_ID", APP_ID],
  ["DISCORD_BOT_TOKEN", TOKEN],
  ["DISCORD_GUILD_ID", GUILD_ID],
].filter(([, v]) => !v);

if (faltando.length) {
  console.error(
    `Faltam variáveis: ${faltando.map(([k]) => k).join(", ")}.\n\n` +
      "Onde achar cada uma, no https://discord.com/developers/applications:\n" +
      "  DISCORD_APP_ID    → General Information → Application ID\n" +
      "  DISCORD_BOT_TOKEN → Bot → Reset Token (ele só aparece uma vez)\n" +
      "  DISCORD_GUILD_ID  → no Discord, clique com o botão direito no nome do\n" +
      "                      servidor → Copiar ID do servidor. Se a opção não\n" +
      "                      existir, ligue Configurações → Avançado → Modo\n" +
      "                      desenvolvedor.",
  );
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;

// PUT e não POST: PUT SUBSTITUI a lista inteira, então um comando removido de
// `COMANDOS` some do Discord também. Com POST, comando apagado do código
// continuaria aparecendo para quem digita `/` — oferecendo algo que a rota já
// não sabe responder.
const r = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(COMANDOS),
});

const corpo = await r.text();

if (!r.ok) {
  console.error(`❌ O Discord recusou (${r.status}):\n${corpo}`);
  if (r.status === 401) {
    console.error(
      "\n401 é token errado ou já resetado. Gere outro em Bot → Reset Token.",
    );
  }
  if (r.status === 403) {
    console.error(
      "\n403 costuma ser o bot fora do servidor. Convide-o por\n" +
        "OAuth2 → URL Generator, marcando o escopo `applications.commands`.",
    );
  }
  process.exit(1);
}

const registrados = JSON.parse(corpo);
console.log(`✅ ${registrados.length} comando(s) registrado(s) no servidor:`);
for (const c of registrados) console.log(`   /${c.name} — ${c.description}`);
console.log(
  "\nEles aparecem na hora. Se não aparecerem, feche e reabra o Discord.",
);
