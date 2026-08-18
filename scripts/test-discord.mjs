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
  deveMandarDireto,
  linhaDoDireto,
  linkDoCard,
  montarAviso,
  montarAvisoDireto,
  montarResumoDeRecorrencias,
  montarResumoDiario,
  panoramaDoDia,
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

// --- a mensagem direta ao responsável --------------------------------------
//
// A recusa é o que importa testar aqui. Um direto a mais é ruído no telefone de
// alguém, e ruído no telefone é o que faz a pessoa desligar o bot inteiro — e
// junto com ele os avisos que ela queria.
const baseDm = {
  acao: "editada",
  mudancas: [{ campo: "prazo", de: "01/09", para: "10/09" }],
  autorEmail: "italo@px.com.br",
  responsavelEmail: "kaua@px.com.br",
  responsavelDiscordId: "999",
};

checa("responsável vinculado e mudança de outra pessoa: manda", deveMandarDireto(baseDm));
checa(
  "sem vínculo não há para onde mandar",
  !deveMandarDireto({ ...baseDm, responsavelDiscordId: null }),
);
checa(
  "vínculo em branco também não",
  !deveMandarDireto({ ...baseDm, responsavelDiscordId: "   " }),
);
checa(
  "demanda sem responsável não tem destinatário",
  !deveMandarDireto({ ...baseDm, responsavelEmail: null }),
);
checa(
  "quem mexeu na PRÓPRIA demanda não se avisa",
  !deveMandarDireto({ ...baseDm, autorEmail: "kaua@px.com.br" }),
);
checa(
  "e a comparação ignora caixa e espaço, que é como o e-mail chega",
  !deveMandarDireto({ ...baseDm, autorEmail: "  Kaua@PX.com.BR " }),
);
checa(
  "evento sem notícia não vira direto, pela MESMA régua do canal",
  !deveMandarDireto({ ...baseDm, mudancas: [] }),
);
checa(
  "mas excluir não precisa de par para ser notícia",
  deveMandarDireto({ ...baseDm, acao: "excluida", mudancas: [] }),
);

checa(
  "a linha diz por que a mensagem chegou",
  linhaDoDireto("criada", []) === "Abriram uma demanda no seu nome.",
);
checa(
  "troca de responsável ganha das outras — é o que muda o dia da pessoa",
  linhaDoDireto("movida", [
    { campo: "coluna", de: "A fazer", para: "Fazendo" },
    { campo: "responsavel", de: "Ítalo", para: "Kauã" },
  ]) === "Esta demanda passou a ser sua.",
);
checa(
  "cada ação tem a sua frase, e nenhuma sai vazia",
  ["criada", "editada", "movida", "excluida", "restaurada"].every(
    (a) => linhaDoDireto(a, []).length > 0,
  ),
);

const dm = montarAvisoDireto({
  card: CARD,
  evento: EVENTO,
  appUrl: "https://app.exemplo.com",
  rotulo: { prioridade: (p) => p, tipo: (t) => t },
});
const noCanal = montarAviso({
  card: CARD,
  evento: EVENTO,
  appUrl: "https://app.exemplo.com",
  rotulo: { prioridade: (p) => p, tipo: (t) => t },
});
checa(
  "a DM conta a MESMA história do canal — um embed só, idêntico",
  JSON.stringify(dm.embeds) === JSON.stringify(noCanal.embeds),
);
checa(
  "o `content` da DM é o porquê, e não a menção",
  dm.content === linhaDoDireto(EVENTO.acao, EVENTO.mudancas) &&
    !dm.content.includes("<@"),
);
checa(
  "dentro da DM não se menciona ninguém",
  dm.allowed_mentions.parse.length === 0 &&
    dm.allowed_mentions.users === undefined,
);

// --- o resumo do dia -------------------------------------------------------
//
// Este é o único aviso que fala do que NÃO aconteceu, e o jeito de estragá-lo é
// cobrar entrega já feita: um resumo que lista como atrasada a demanda entregue
// semana passada é um resumo que se aprende a ignorar em duas semanas.
const HOJE_DIA = "2026-08-18";
const QUADRO_DIA = [
  { id: "a", title: "Painel do refeitório", responsavel: "Kauã", prazo: "2026-08-10", etapa: "Em andamento", entregue: false },
  { id: "b", title: "Carga do DW", responsavel: "Ítalo", prazo: "2026-08-17", etapa: "A fazer", entregue: false },
  { id: "c", title: "Relatório do RH", responsavel: "Kauã", prazo: "2026-08-18", etapa: "Em andamento", entregue: false },
  { id: "d", title: "Conferência de acessos", responsavel: null, prazo: null, etapa: "A fazer", entregue: false },
  { id: "e", title: "Dashboard antigo", responsavel: "Ítalo", prazo: "2026-01-05", etapa: "Concluído", entregue: true },
  { id: "f", title: "Sem prazo mesmo", responsavel: "Emerson", prazo: null, etapa: "Aguardando", entregue: false },
];
const panDia = panoramaDoDia({ cards: QUADRO_DIA, hoje: HOJE_DIA });

checa("entregue não entra na contagem de abertas", panDia.abertas === 5);
checa(
  "prazo vencido de demanda ENTREGUE não é atraso",
  !panDia.atrasadas.some((c) => c.id === "e"),
  panDia.atrasadas.map((c) => c.id).join(","),
);
checa(
  "as atrasadas vêm da mais antiga para a mais nova",
  panDia.atrasadas.map((c) => c.id).join(",") === "a,b",
);
checa("o que vence hoje não conta como atraso", panDia.vencemHoje.map((c) => c.id).join(",") === "c");
checa("demanda sem prazo não aparece em nenhum dos dois", panDia.atrasadas.length + panDia.vencemHoje.length === 3);
checa(
  "o buraco de quem não tem dono aparece",
  panDia.semResponsavel.map((c) => c.id).join(",") === "d",
);
checa(
  "a contagem por etapa só conta o que está aberto",
  JSON.stringify(panDia.porEtapa.sort()) ===
    JSON.stringify([["A fazer", 2], ["Aguardando", 1], ["Em andamento", 2]].sort()),
  JSON.stringify(panDia.porEtapa),
);

const diario = montarResumoDiario({
  sector: "B.I.",
  cards: QUADRO_DIA,
  hoje: HOJE_DIA,
  appUrl: "https://app.exemplo.com",
});
const embDia = diario.embeds[0];
checa("o título diz o que precisa de ação hoje", embDia.title === "2 demandas atrasadas");
checa("vermelho quando há atraso — é o que se lê antes do texto", embDia.color === 0xd64545);
checa(
  "cada linha leva ao card",
  embDia.fields[0].value.includes("(https://app.exemplo.com/kanban?setor=B.I.&card=a)"),
  embDia.fields[0].value.split("\n")[0],
);
checa("o panorama por etapa vem por último, não primeiro", embDia.fields.at(-1).name === "No quadro");
checa("rotina diária NÃO menciona ninguém", embDia.description !== undefined && diario.allowed_mentions.parse.length === 0 && diario.allowed_mentions.users === undefined);
checa(
  "todo campo cabe no teto de 1024",
  embDia.fields.every((f) => f.value.length <= LIMITE_CAMPO_VALOR),
);

const soVenceHoje = montarResumoDiario({
  sector: "B.I.",
  cards: [QUADRO_DIA[2], QUADRO_DIA[4]],
  hoje: HOJE_DIA,
});
checa("âmbar quando só há vencimento de hoje", soVenceHoje.embeds[0].color === 0xf5b13d);
checa("e o título fala no singular", soVenceHoje.embeds[0].title === "1 demanda vence hoje");

const tudoEmDia = montarResumoDiario({
  sector: "B.I.",
  cards: [{ id: "z", title: "Tranquila", responsavel: "Kauã", prazo: "2026-12-01", etapa: "A fazer", entregue: false }],
  hoje: HOJE_DIA,
});
checa("verde e dito na cara quando está tudo em dia", tudoEmDia.embeds[0].color === 0x3fa66b);
checa(
  '"está tudo em dia" É notícia — é o que faz alguém confiar no silêncio dos outros dias',
  tudoEmDia.embeds[0].title === "Nada atrasado por aqui",
);

checa(
  "quadro vazio NÃO vira mensagem — aviso diário sem notícia ensina a não abrir o canal",
  montarResumoDiario({ sector: "B.I.", cards: [], hoje: HOJE_DIA }) === null,
);
checa(
  "quadro só com entregues também não",
  montarResumoDiario({ sector: "B.I.", cards: [QUADRO_DIA[4]], hoje: HOJE_DIA }) === null,
);

const muitasDoDia = Array.from({ length: 40 }, (_, i) => ({
  id: `x${i}`,
  title: `Demanda número ${i} com um título razoavelmente comprido para ocupar espaço`,
  responsavel: "Kauã",
  prazo: "2026-08-01",
  etapa: "A fazer",
  entregue: false,
}));
const grandeDoDia = montarResumoDiario({ sector: "B.I.", cards: muitasDoDia, hoje: HOJE_DIA, appUrl: "https://app.exemplo.com" });
checa(
  "quarenta atrasadas continuam UMA mensagem",
  grandeDoDia.embeds.length === 1,
);
const listaDoDia = grandeDoDia.embeds[0].fields[0].value.split("\n");
const anuncio = /^• …e mais (\d+)$/.exec(listaDoDia.at(-1) ?? "");
checa(
  "o corte é anunciado, e a conta fecha — 40 = listadas + anunciadas",
  !!anuncio && listaDoDia.length - 1 + Number(anuncio[1]) === 40,
  listaDoDia.at(-1),
);
checa(
  "e o anúncio SOBREVIVE ao teto do campo (era aqui que ele se perdia)",
  grandeDoDia.embeds[0].fields[0].value.length <= LIMITE_CAMPO_VALOR &&
    grandeDoDia.embeds[0].fields[0].value.includes("…e mais"),
  `${grandeDoDia.embeds[0].fields[0].value.length}`,
);
checa(
  "e o embed inteiro cabe nos 6000",
  pesoDoEmbed(grandeDoDia.embeds[0]) <= LIMITE_TOTAL_EMBED,
  `${pesoDoEmbed(grandeDoDia.embeds[0])}`,
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
