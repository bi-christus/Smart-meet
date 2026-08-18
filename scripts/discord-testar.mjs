/**
 * Prova que o webhook do Discord está certo — antes de qualquer deploy.
 *
 * POR QUE ISTO EXISTE. Quem liga a integração pela primeira vez cola uma URL no
 * painel da Vercel e só descobre se acertou depois do deploy. E o sintoma de ter
 * errado é o MESMO de tudo estar certo: nada acontece. Variável não salva, URL
 * pela metade, webhook apagado e "esqueci de clicar em Save" produzem
 * exatamente a mesma tela — um canal em silêncio. Este comando troca essa espera
 * por uma resposta em cinco segundos.
 *
 * ELE NÃO INVENTA UMA MENSAGEM PRÓPRIA, e isso é a decisão que importa aqui.
 * Usa `montarAviso` de `discord-core.ts` e `enviarAviso` de `server/discord.ts`
 * — os mesmos que a produção usa. Um teste com mensagem caprichada e um aviso
 * real quebrado seria o pior resultado possível: o teste passaria, a pessoa
 * seguiria confiante, e o canal continuaria mudo. O que aparece no canal ao
 * rodar isto é, byte a byte, o que uma demanda de verdade produz.
 *
 * NÃO ENTRA NO `prebuild`. Ele fala com a rede e publica num canal de gente.
 * Portão de deploy que manda mensagem para pessoas é portão que alguém desliga
 * na primeira sexta-feira — e, pior, encheria o canal a cada build.
 *
 * O módulo do servidor carrega aqui no Node puro porque ele só importa TIPO de
 * `discord-core` (`import type`), e o strip de tipos apaga isso antes de o alias
 * `@/` precisar ser resolvido. Não é sorte: é o que mantém este script possível.
 *
 *   npm run discord:testar
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { montarAviso } from "../src/lib/discord-core.ts";
import { enviarAviso, urlDeWebhookValida } from "../src/lib/server/discord.ts";

// Do `import.meta.url`, nunca do CWD — mesma razão de
// `check-demandas-boundary.mjs`: o veredito tem de ser o mesmo rodando de
// qualquer diretório.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_LOCAL = join(RAIZ, ".env.local");

function titulo(t) {
  console.log(`\n${t}\n${"─".repeat(t.length)}`);
}

function parar(mensagem) {
  console.error(`\n❌ ${mensagem}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. De onde vem a variável
// ---------------------------------------------------------------------------

// O arquivo é lido SEMPRE que existir, e não só quando a variável falta.
//
// A versão anterior carregava o `.env.local` apenas se `DISCORD_WEBHOOK_URL`
// não estivesse no ambiente — e com isso, quem testasse uma URL avulsa pela
// linha de comando perdia junto o `APP_URL` do arquivo, e o aviso saía sem link
// dizendo que APP_URL não existe. Duas variáveis diferentes, um `if` só.
const daLinhaDeComando = (process.env.DISCORD_WEBHOOK_URL ?? "").trim();
if (existsSync(ENV_LOCAL)) process.loadEnvFile(ENV_LOCAL);
// E a da linha de comando continua ganhando do arquivo, que é o que permite
// testar uma URL sem editar (nem sujar) o `.env.local` de quem trabalha aqui.
if (daLinhaDeComando) process.env.DISCORD_WEBHOOK_URL = daLinhaDeComando;

if (!existsSync(ENV_LOCAL) && !daLinhaDeComando) {
  parar(
    `Não achei o arquivo .env.local na raiz do projeto.\n\n` +
      `   Crie um arquivo chamado exatamente ".env.local" em\n` +
      `   ${RAIZ}\n` +
      `   com uma linha assim dentro:\n\n` +
      `      DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/000/aaa\n\n` +
      `   A URL sai do Discord: clique com o botão direito no canal →\n` +
      `   Editar canal → Integrações → Webhooks → Novo webhook →\n` +
      `   Copiar URL do Webhook.`,
  );
}

const url = (process.env.DISCORD_WEBHOOK_URL ?? "").trim();

if (!url) {
  parar(
    `O arquivo .env.local existe, mas não tem DISCORD_WEBHOOK_URL dentro.\n\n` +
      `   Acrescente uma linha (sem aspas, sem espaço em volta do "="):\n\n` +
      `      DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/000/aaa\n\n` +
      `   A URL sai do Discord: clique com o botão direito no canal →\n` +
      `   Editar canal → Integrações → Webhooks → Novo webhook →\n` +
      `   Copiar URL do Webhook.`,
  );
}

// ---------------------------------------------------------------------------
// 2. A forma da URL, antes de gastar uma ida à rede
// ---------------------------------------------------------------------------

titulo("Conferindo a URL");

if (!urlDeWebhookValida(url)) {
  const pista = url.includes("discord.gg")
    ? "Isso é um CONVITE do servidor (discord.gg/…), não um webhook."
    : url.includes("/channels/")
      ? "Isso é o endereço de um CANAL (…/channels/…), não um webhook."
      : url.startsWith("http")
        ? "O endereço não tem a forma /api/webhooks/<números>/<token>."
        : "Isso nem parece um endereço da web.";
  parar(
    `A URL não tem a cara de um webhook do Discord.\n\n` +
      `   ${pista}\n\n` +
      `   O que se procura é assim:\n` +
      `      https://discord.com/api/webhooks/1234567890/aBcD-eFgH_iJkL…\n\n` +
      `   Onde achar: no Discord, clique com o botão direito NO CANAL onde\n` +
      `   os avisos devem cair → Editar canal → Integrações → Webhooks →\n` +
      `   Novo webhook → Copiar URL do Webhook.`,
  );
}

// O token nunca é impresso. Quem estiver olhando a tela por cima do ombro — ou
// lendo um print colado num chat — não leva junto a credencial que publica no
// canal para sempre.
const partes = new URL(url).pathname.split("/");
const idWebhook = partes[partes.length - 2];
console.log(`✅ Forma correta. Webhook nº ${idWebhook} (o token fica oculto).`);

// ---------------------------------------------------------------------------
// 3. A mensagem — a MESMA que uma demanda de verdade produz
// ---------------------------------------------------------------------------

const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "") || null;

titulo("Publicando um aviso de teste");
console.log(
  appUrl
    ? `Link dos cards apontando para ${appUrl}`
    : `APP_URL não está definida aqui — o aviso sai SEM link clicável.\n` +
        `   Em produção ela existe, então isto não é problema do webhook.`,
);

const corpo = montarAviso({
  card: {
    id: "exemplo-de-teste",
    sector: "B.I.",
    title: "Teste de conexão — nenhuma demanda foi criada",
    etapa: "Fazendo",
    responsavel: "Smart Meet",
    solicitante: "Configuração",
    setorSolicitante: "B.I.",
    prazo: null,
    prioridade: "media",
    tipo: "manutencao",
  },
  evento: {
    id: "evento-de-teste",
    autor: "Smart Meet",
    em: Date.now(),
    // "movida" e não "criada": laranja é a cor da demanda que nasce, e um teste
    // com a cara de demanda nova é o que faz alguém procurar no quadro um card
    // que não existe.
    acao: "movida",
    mudancas: [
      { campo: "coluna", de: "A fazer", para: "Fazendo" },
      { campo: "responsavel", de: null, para: "Smart Meet" },
    ],
  },
  appUrl,
});

try {
  await enviarAviso(url, corpo);
} catch (e) {
  const status = typeof e?.status === "number" ? e.status : 0;
  const explicacao =
    status === 401 || status === 403
      ? `O Discord recusou o token do webhook. A URL provavelmente veio pela\n` +
        `   metade — ela é longa e o fim dela é o que autentica. Copie de novo\n` +
        `   pelo botão "Copiar URL do Webhook", sem selecionar com o mouse.`
      : status === 404
        ? `Este webhook não existe mais. Alguém o apagou no Discord, ou a URL\n` +
          `   é de um servidor/canal que não existe. Crie um novo em\n` +
          `   Editar canal → Integrações → Webhooks.`
        : status === 429
          ? `O Discord pediu para esperar (limite de mensagens). Rode de novo\n` +
            `   daqui a alguns segundos — isto não é erro de configuração.`
          : `Não consegui falar com o Discord. Confira a sua internet e, se\n` +
            `   estiver na rede da Rede, se ela não bloqueia discord.com.`;
  parar(`${e?.message ?? e}\n\n   ${explicacao}`);
}

titulo("Deu certo");
console.log(
  `A mensagem já está no canal. Vá olhar — ela tem barra azul à esquerda,\n` +
    `título "Teste de conexão", e diz "Smart Meet arrastou o card".\n` +
    `\n` +
    `É exatamente a cara que um aviso de demanda de verdade vai ter.\n` +
    `Nenhuma demanda foi criada: isto não passou perto do banco.\n` +
    `\n` +
    `PRÓXIMO PASSO — pôr a MESMA URL na Vercel, para o app publicar sozinho:\n` +
    `\n` +
    `   1. vercel.com → projeto smart-meeting → Settings\n` +
    `   2. Environment Variables → Add New\n` +
    `   3. Name:  DISCORD_WEBHOOK_URL\n` +
    `      Value: a mesma URL que acabou de funcionar\n` +
    `      Marque os três ambientes (Production, Preview, Development)\n` +
    `   4. Save\n` +
    `   5. Deployments → o último de Production → ⋯ → Redeploy\n` +
    `\n` +
    `Variável nova só vale para deploy NOVO. Sem o Redeploy do passo 5, o app\n` +
    `continua rodando com o ambiente antigo e o canal segue mudo — é o degrau\n` +
    `em que quase todo mundo tropeça.\n`,
);
