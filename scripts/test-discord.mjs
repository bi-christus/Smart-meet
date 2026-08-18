/**
 * Testes do aviso no Discord.
 *
 * Errar aqui é caro de um jeito específico: NADA APARECE. O aviso é caminho não
 * crítico — a demanda grava, a tela funciona, e a única evidência de que a
 * integração quebrou é uma mensagem que não chegou num canal. Ninguém abre um
 * chamado por mensagem que não veio.
 *
 * As três moedas:
 *
 *  - OS TETOS. A API do Discord recusa o embed INTEIRO quando um campo estoura,
 *    com 400. Uma descrição de 4 mil caracteres não é caso de borda: é o
 *    tamanho que `updateCard` permite gravar. Um título de 300 caracteres numa
 *    demanda apagaria o aviso dela para sempre, em silêncio.
 *
 *  - A MENÇÃO. `allowed_mentions` errado é o oposto de não avisar: um título de
 *    demanda com "@everyone" — texto que qualquer pessoa digita — notificaria o
 *    servidor inteiro. E menção escrita DENTRO do embed não notifica ninguém,
 *    que é o jeito de a integração parecer pronta e não chegar em ninguém.
 *
 *  - O ROTEAMENTO. `resolverWebhook` com JSON quebrado não pode calar o aviso;
 *    o setor errado publica demanda de um time no canal de outro; e o canal
 *    errado joga acompanhamento de fluxo dentro do canal de entrada, que é o
 *    jeito de fazer alguém silenciar os dois.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  COR_POR_ACAO,
  LIMITE_CAMPOS,
  LIMITE_CAMPO_VALOR,
  LIMITE_DESCRICAO,
  LIMITE_TITULO,
  LIMITE_TOTAL_EMBED,
  aparar,
  canalDoEvento,
  cortar,
  deveAvisar,
  linkDoCard,
  montarAviso,
  montarResumoDeRecorrencias,
  pesoDoEmbed,
  resolverWebhook,
} from "../src/lib/discord-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

const CARD = {
  id: "abc123",
  sector: "B.I.",
  title: "Painel de consumo do refeitório",
  etapa: "Fazendo",
  responsavel: "Kauã Silva",
  solicitante: "Marina",
  setorSolicitante: "RH",
  prazo: "2026-09-01",
  prioridade: "alta",
  tipo: "implementacao",
};

const EVENTO = {
  id: "ev1",
  autor: "Ítalo Araujo",
  em: Date.parse("2026-08-17T12:00:00.000Z"),
  acao: "movida",
  mudancas: [{ campo: "coluna", de: "A fazer", para: "Fazendo" }],
};

// --- cortar: o reticências conta para o teto -------------------------------
checa("texto curto passa inteiro", cortar("oi", 10) === "oi");
checa(
  "texto longo cabe no teto, contando o reticências",
  cortar("a".repeat(50), 10).length === 10,
  `${cortar("a".repeat(50), 10).length}`,
);
checa(
  "corte prefere a palavra quando sobra texto de verdade",
  cortar("painel de consumo do refeitorio", 20) === "painel de consumo…",
  cortar("painel de consumo do refeitorio", 20),
);
checa(
  "palavra única não vira duas letras e um reticências",
  cortar("supercalifragilistico", 12) === "supercalifr…",
  cortar("supercalifragilistico", 12),
);
checa("nulo e espaço não explodem", cortar("   ", 10) === "");

// --- deveAvisar: política de ruído ----------------------------------------
checa("criação sempre avisa", deveAvisar("criada", []) === true);
checa("exclusão sempre avisa", deveAvisar("excluida", []) === true);
checa("restauração sempre avisa", deveAvisar("restaurada", []) === true);
checa(
  "edição sem mudança nenhuma NÃO vira aviso mudo",
  deveAvisar("editada", []) === false,
);
checa(
  "edição com mudança avisa",
  deveAvisar("editada", [{ campo: "prazo", de: null, para: "01/09/2026" }]) ===
    true,
);
checa("movida sem par não avisa", deveAvisar("movida", []) === false);

// --- linkDoCard: a base vem de APP_URL, nunca da origem --------------------
checa(
  "monta o deep link do quadro",
  linkDoCard("https://app.exemplo.com", "B.I.", "abc") ===
    "https://app.exemplo.com/kanban?setor=B.I.&card=abc",
  linkDoCard("https://app.exemplo.com", "B.I.", "abc"),
);
checa(
  "barra sobrando na base não vira barra dupla",
  linkDoCard("https://app.exemplo.com///", "B.I.", "abc") ===
    "https://app.exemplo.com/kanban?setor=B.I.&card=abc",
);
checa("sem APP_URL, sem link (melhor que link quebrado)", linkDoCard("", "B.I.", "x") === null);
checa("APP_URL indefinida também", linkDoCard(undefined, "B.I.", "x") === null);
checa(
  "setor com ponto e espaço é escapado na query",
  linkDoCard("https://a.b", "T. I.", "x").includes("setor=T.+I."),
  linkDoCard("https://a.b", "T. I.", "x"),
);

// --- canalDoEvento + resolverWebhook: roteamento ---------------------------
checa(
  "demanda nascendo vai para o canal de entrada",
  canalDoEvento("criada") === "novas",
);
checa(
  "o resto do ciclo de vida vai para o fluxo",
  ["editada", "movida", "excluida", "restaurada"].every(
    (a) => canalDoEvento(a) === "fluxo",
  ),
);

const rota = (extra) =>
  resolverWebhook({ canal: "novas", setor: "B.I.", ...extra });

checa(
  "sem mapa nenhum, cai no padrão",
  rota({ padrao: "https://padrao" }) === "https://padrao",
);
checa(
  "mapa por canal ganha do padrão",
  rota({ padrao: "https://padrao", porCanal: '{"novas":"https://novas"}' }) ===
    "https://novas",
);
checa(
  "canal sem entrada própria volta para o padrão",
  resolverWebhook({
    canal: "resumo",
    setor: "B.I.",
    padrao: "https://padrao",
    porCanal: '{"novas":"https://novas"}',
  }) === "https://padrao",
);
checa(
  "mapa por setor ganha do mapa por canal — o específico manda",
  rota({
    padrao: "https://padrao",
    porCanal: '{"novas":"https://novas"}',
    porSetor: '{"B.I.":{"novas":"https://bi-novas"}}',
  }) === "https://bi-novas",
);
checa(
  "a forma antiga do mapa por setor continua valendo",
  rota({ padrao: "https://padrao", porSetor: '{"B.I.":"https://bi"}' }) ===
    "https://bi",
);
checa(
  "`padrao` dentro do setor cobre o canal que ele não listou",
  resolverWebhook({
    canal: "resumo",
    setor: "B.I.",
    padrao: "https://padrao",
    porSetor:
      '{"B.I.":{"novas":"https://bi-novas","padrao":"https://bi-tudo"}}',
  }) === "https://bi-tudo",
);
checa(
  "setor com canais próprios mas sem este canal cai no mapa por canal",
  resolverWebhook({
    canal: "resumo",
    setor: "B.I.",
    padrao: "https://padrao",
    porCanal: '{"resumo":"https://resumo"}',
    porSetor: '{"B.I.":{"novas":"https://bi-novas"}}',
  }) === "https://resumo",
);
checa(
  "setor fora do mapa volta para o padrão",
  resolverWebhook({
    canal: "novas",
    setor: "RH",
    padrao: "https://padrao",
    porSetor: '{"B.I.":"https://bi"}',
  }) === "https://padrao",
);
checa(
  "JSON quebrado NÃO cala o aviso — cai no padrão",
  rota({ padrao: "https://padrao", porSetor: "{isto nao e json" }) ===
    "https://padrao",
);
checa(
  "JSON quebrado no mapa por canal também não cala",
  rota({ padrao: "https://padrao", porCanal: "[1,2,3]" }) === "https://padrao",
);
checa(
  "sem padrão e sem mapa, não há para onde avisar",
  rota({ padrao: "" }) === null,
);
checa(
  "entrada vazia no mapa não vale como destino",
  rota({ padrao: "https://padrao", porSetor: '{"B.I.":"   "}' }) ===
    "https://padrao",
);

// --- montarAviso: a notícia primeiro, o contexto depois --------------------
const aviso = montarAviso({
  card: CARD,
  evento: EVENTO,
  appUrl: "https://app.exemplo.com",
});
const embed = aviso.embeds[0];

checa("um embed por aviso", aviso.embeds.length === 1);
checa(
  "o autor diz quem fez e o que fez",
  embed.author.name === "Ítalo Araujo arrastou o card",
  embed.author.name,
);
checa("o título é o da demanda", embed.title === CARD.title);
checa(
  "o título leva ao card, não ao quadro",
  embed.url === "https://app.exemplo.com/kanban?setor=B.I.&card=abc123",
  embed.url,
);
checa("a cor é a da ação", embed.color === COR_POR_ACAO.movida);
checa(
  "o horário é o do FATO, não o do envio",
  embed.timestamp === "2026-08-17T12:00:00.000Z",
  embed.timestamp,
);
checa(
  "a mudança vem antes do contexto",
  embed.fields[0].name === "Etapa" &&
    embed.fields[0].value.includes("A fazer") &&
    embed.fields[0].value.includes("Fazendo"),
  JSON.stringify(embed.fields[0]),
);
checa(
  "o campo que já foi notícia NÃO se repete no contexto",
  embed.fields.filter((f) => f.name === "Etapa").length === 1,
  JSON.stringify(embed.fields.map((f) => f.name)),
);
checa(
  "o contexto traz responsável, prazo, prioridade e solicitante",
  ["Responsável", "Prazo", "Prioridade", "Solicitante"].every((n) =>
    embed.fields.some((f) => f.name === n),
  ),
  JSON.stringify(embed.fields.map((f) => f.name)),
);
checa(
  "o prazo sai em dd/mm/aaaa",
  embed.fields.find((f) => f.name === "Prazo").value === "01/09/2026",
);
checa(
  "solicitante e setor saem juntos",
  embed.fields.find((f) => f.name === "Solicitante").value === "Marina · RH",
);
checa(
  "o rodapé diz de qual setor veio",
  embed.footer.text.startsWith("Smart Meet · B.I."),
  embed.footer.text,
);
checa(
  "campo vazio não vira linha '—' no aviso",
  !montarAviso({
    card: { id: "x", sector: "B.I.", title: "T" },
    evento: { ...EVENTO, mudancas: [] },
  }).embeds[0].fields.some((f) => f.value === "—" && f.name === "Prazo"),
);

// --- a menção -------------------------------------------------------------
checa(
  "sem vínculo, nenhuma menção e nenhuma permissão de menção",
  aviso.content === undefined &&
    aviso.allowed_mentions.parse.length === 0 &&
    aviso.allowed_mentions.users === undefined,
  JSON.stringify(aviso.allowed_mentions),
);

const comMencao = montarAviso({
  card: { ...CARD, responsavelDiscordId: "999888777" },
  evento: EVENTO,
});
checa(
  "a menção vai no content — dentro do embed ela não notifica ninguém",
  comMencao.content === "<@999888777>",
  comMencao.content,
);
checa(
  "só o mencionado é liberado; @everyone continua desligado",
  comMencao.allowed_mentions.parse.length === 0 &&
    comMencao.allowed_mentions.users.length === 1 &&
    comMencao.allowed_mentions.users[0] === "999888777",
  JSON.stringify(comMencao.allowed_mentions),
);
const tituloVenenoso = montarAviso({
  card: { ...CARD, title: "@everyone conferir isto agora" },
  evento: EVENTO,
});
checa(
  "'@everyone' no título da demanda NÃO notifica o servidor",
  tituloVenenoso.allowed_mentions.parse.length === 0,
);

// --- os tetos -------------------------------------------------------------
const gigante = montarAviso({
  card: {
    ...CARD,
    title: "T".repeat(900),
    solicitante: "S".repeat(3000),
  },
  evento: {
    ...EVENTO,
    autor: "A".repeat(900),
    acao: "editada",
    mudancas: Array.from({ length: 40 }, (_, i) => ({
      campo: "titulo",
      de: `de ${"x".repeat(2000)} ${i}`,
      para: `para ${"y".repeat(2000)} ${i}`,
    })),
  },
});
const g = gigante.embeds[0];
checa("título cortado no teto", g.title.length <= LIMITE_TITULO, `${g.title.length}`);
checa(
  "no máximo 25 campos",
  g.fields.length <= LIMITE_CAMPOS,
  `${g.fields.length}`,
);
checa(
  "nenhum valor de campo passa de 1024",
  g.fields.every((f) => f.value.length <= LIMITE_CAMPO_VALOR),
  `${Math.max(...g.fields.map((f) => f.value.length))}`,
);
checa(
  "o embed inteiro cabe no orçamento de 6000",
  pesoDoEmbed(g) <= LIMITE_TOTAL_EMBED,
  `${pesoDoEmbed(g)}`,
);
checa(
  "o corte é ANUNCIADO, não silencioso",
  g.fields.some((f) => f.name === "…" && /mais \d+ iten?s?/.test(f.value)),
  JSON.stringify(g.fields.at(-1)),
);

// `aparar` não inventa corte onde não precisa.
const pequeno = { title: "oi", fields: [{ name: "a", value: "b" }] };
checa(
  "embed que já cabe sai intacto",
  aparar(pequeno) === pequeno,
);

// --- o resumo da rodada de recorrências ------------------------------------
const TRES = [
  { id: "c1", title: "Backup mensal do Looker", responsavel: "Kauã Silva" },
  { id: "c2", title: "Conferência de acessos" },
  { id: "c3", title: "" },
];
const resumo = montarResumoDeRecorrencias({
  sector: "B.I.",
  cards: TRES,
  appUrl: "https://app.exemplo.com",
});
const re = resumo.embeds[0];

checa("o resumo é UMA mensagem, não uma por card", resumo.embeds.length === 1);
checa(
  "o título conta quantas abriram",
  re.title === "3 demandas de manutenção foram abertas",
  re.title,
);
checa(
  "com uma só, o título fica no singular",
  montarResumoDeRecorrencias({ sector: "B.I.", cards: [TRES[0]] }).embeds[0]
    .title === "1 demanda de manutenção foi aberta",
);
checa(
  "cada linha leva ao card",
  re.description.includes("(https://app.exemplo.com/kanban?setor=B.I.&card=c1)"),
  re.description.split("\n")[0],
);
checa(
  "o responsável aparece quando existe, e some quando não",
  re.description.includes("— Kauã Silva") &&
    !re.description.split("\n")[1].includes("—"),
  re.description,
);
checa(
  "card sem título não vira linha vazia",
  re.description.includes("Demanda sem título"),
);
checa(
  "rotina automática NÃO menciona ninguém",
  resumo.allowed_mentions.parse.length === 0 &&
    resumo.allowed_mentions.users === undefined &&
    resumo.content === undefined,
);
checa(
  "sem APP_URL, o resumo sai sem link em vez de com link quebrado",
  !montarResumoDeRecorrencias({ sector: "B.I.", cards: TRES })
    .embeds[0].description.includes("]("),
);

// Uma rodada grande é o caso que o cron produz de verdade.
const sessenta = Array.from({ length: 60 }, (_, i) => ({
  id: `c${i}`,
  title: `Manutenção ${i} ${"z".repeat(300)}`,
  responsavel: "Alguém",
}));
const grande = montarResumoDeRecorrencias({
  sector: "B.I.",
  cards: sessenta,
  appUrl: "https://app.exemplo.com",
});
checa(
  "60 cards continuam UMA mensagem",
  grande.embeds.length === 1 && grande.embeds[0].title.startsWith("60 "),
);
checa(
  "a descrição cabe no teto de 4096",
  grande.embeds[0].description.length <= LIMITE_DESCRICAO,
  `${grande.embeds[0].description.length}`,
);
checa(
  "a lista é cortada e o corte é anunciado",
  /e mais 45/.test(grande.embeds[0].description),
  grande.embeds[0].description.split("\n").at(-1),
);
checa(
  "colchete no título não quebra o link do Markdown ao meio",
  !montarResumoDeRecorrencias({
    sector: "B.I.",
    cards: [{ id: "c1", title: "Ajuste [urgente] (rev 2)" }],
    appUrl: "https://a.b",
  }).embeds[0].description.includes("[urgente]"),
);

console.log(
  falhas === 0
    ? "\n✅ aviso no discord: ok"
    : `\n❌ aviso no discord: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
