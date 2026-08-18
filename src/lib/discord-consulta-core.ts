/**
 * Os comandos de consulta — o que se responde quando alguém pergunta.
 *
 * Moradia em módulo puro (AGENTS.md §4): sem SDK do Firestore e sem `fetch`,
 * testado por `scripts/test-discord-consulta.mjs` sem subir nada. Quem lê o
 * banco é `api/discord/interactions`.
 *
 * O PROBLEMA que isto resolve. O aviso e a DM contam o que MUDOU. Nenhum dos
 * dois responde "o que eu tenho para hoje?" — e essa é a pergunta que faz
 * alguém abrir o quadro dez vezes por dia. Quem está no Discord o dia inteiro
 * paga uma troca de janela e um login por uma lista de cinco linhas.
 *
 * A RESPOSTA É EFÊMERA, sempre (`respostaEfemera`). A lista de demandas de uma
 * pessoa é assunto dela: publicada no canal, ela vira histórico de chat sobre
 * quem está atrasado em quê, e é o tipo de coisa que muda o jeito como as
 * pessoas usam o quadro.
 *
 * E É TEXTO, não embed. Embed dentro de resposta efêmera fica pesado no celular
 * para o que é uma lista curta, e o Markdown do `content` já dá link clicável.
 * O embed existe para o aviso, que chega sem ser pedido e precisa se distinguir
 * do resto do canal; aqui a pessoa acabou de digitar o comando e sabe o que
 * está lendo.
 */

/** Teto do `content` de uma mensagem do Discord — número deles. */
export const LIMITE_RESPOSTA = 2000;

/**
 * Quantas linhas a lista mostra.
 *
 * Dez cabe numa tela de celular sem rolar. Quem tem mais de dez demandas
 * abertas não precisa de uma lista de trinta: precisa abrir o quadro, e a
 * última linha diz isso.
 */
export const TETO_LISTA = 10;

/** O recorte da demanda que a consulta enxerga — tudo resolvido para texto. */
export type DemandaNaConsulta = {
  id: string;
  sector: string;
  title: string;
  /** Título da coluna, não o `colId`. */
  etapa?: string | null;
  /** aaaa-mm-dd. */
  prazo?: string | null;
  responsavel?: string | null;
  /** Se a etapa já conta como entrega — ver `colunasEntregues`. */
  entregue: boolean;
};

/** aaaa-mm-dd → dd/mm. O ano só aparece quando não é o corrente. */
function prazoCurto(iso: string, hoje: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return m[1] === hoje.slice(0, 4)
    ? `${m[3]}/${m[2]}`
    : `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Texto comparável: sem acento, sem caixa, sem espaço sobrando.
 *
 * Buscar "relatorio" e não achar "Relatório" é o jeito de a busca parecer
 * quebrada. Quem digita num celular quase nunca acentua.
 */
export function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Se o título responde ao termo. Todas as palavras do termo, em qualquer ordem. */
export function combina(titulo: string, termo: string): boolean {
  const alvo = normalizar(titulo);
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  // Termo vazio não casa com tudo: casa com nada. "Buscar por nada" devolvendo
  // o quadro inteiro é a resposta que faz alguém achar que digitou certo.
  if (palavras.length === 0) return false;
  return palavras.every((p) => alvo.includes(p));
}

/**
 * A ordem em que se lê uma lista de demanda: a mais urgente primeiro.
 *
 * Atrasada, depois o que tem prazo pela frente, depois o que não tem prazo
 * nenhum. Ordenar por data de criação — o padrão que sai de graça da consulta —
 * colocaria a demanda de março antes da que vence amanhã.
 *
 * Sem prazo vai para o fim, e não para o começo: ausência de prazo não é
 * urgência, e tratá-la como tal empurraria para cima justamente o que ninguém
 * datou.
 */
export function ordenarPorUrgencia(
  cards: DemandaNaConsulta[],
  hoje: string,
): DemandaNaConsulta[] {
  const peso = (c: DemandaNaConsulta) =>
    !c.prazo ? 2 : c.prazo < hoje ? 0 : 1;
  return [...cards].sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    if (a.prazo && b.prazo) return a.prazo.localeCompare(b.prazo);
    return a.title.localeCompare(b.title, "pt-BR");
  });
}

function linkDe(
  appUrl: string | null | undefined,
  c: DemandaNaConsulta,
): string | null {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const q = new URLSearchParams({ setor: c.sector, card: c.id });
  return `${base}/kanban?${q.toString()}`;
}

/** Uma linha da lista, já com marca de atraso e link. */
function linha(
  c: DemandaNaConsulta,
  hoje: string,
  appUrl: string | null | undefined,
): string {
  const alvo = linkDe(appUrl, c);
  // Colchetes e parênteses quebram o link do Markdown ao meio.
  const titulo = (c.title || "Demanda sem título")
    .replace(/[[\]()]/g, "")
    .slice(0, 90);
  const nome = alvo ? `[${titulo}](${alvo})` : titulo;

  const partes: string[] = [];
  if (c.etapa) partes.push(c.etapa);
  if (c.prazo) {
    const atrasada = c.prazo < hoje;
    // O aviso de atraso vem em NEGRITO e por extenso, não como cor ou ícone:
    // no Discord a linha é texto puro, e um emoji vermelho no meio de dez
    // linhas some. "atrasada" é a palavra que a pessoa procura.
    partes.push(
      atrasada
        ? `**atrasada desde ${prazoCurto(c.prazo, hoje)}**`
        : `prazo ${prazoCurto(c.prazo, hoje)}`,
    );
  }
  return `• ${nome}${partes.length ? ` — ${partes.join(" · ")}` : ""}`;
}

/**
 * Junta as linhas sem estourar o teto, anunciando o corte.
 *
 * Mesmo cuidado do resumo do dia: cortar na borda apagaria justamente a última
 * linha — a que diz quantas ficaram de fora —, e a lista pareceria completa sem
 * ser. Aqui o custo de errar é maior, porque a pessoa PERGUNTOU: ela vai agir
 * achando que viu tudo.
 */
function juntar(
  cabecalho: string,
  linhas: string[],
  total: number,
  rodape: string,
): string {
  const aviso = (n: number) =>
    `\n_…e mais ${n} — abra o quadro para ver a lista inteira._`;
  const out: string[] = [];
  let usado = cabecalho.length + rodape.length;

  for (const l of linhas) {
    const faltariam = total - out.length - 1;
    const reserva = faltariam > 0 ? aviso(faltariam).length : 0;
    if (usado + l.length + 1 + reserva > LIMITE_RESPOSTA) break;
    out.push(l);
    usado += l.length + 1;
  }

  const sobrando = total - out.length;
  return (
    cabecalho +
    "\n" +
    out.join("\n") +
    (sobrando > 0 ? aviso(sobrando) : "") +
    rodape
  );
}

/**
 * A resposta de `/minhas-demandas`.
 *
 * O caso vazio é resposta de verdade, e não erro: "você não tem nada em aberto"
 * é exatamente o que a pessoa perguntou, e mandá-la conferir no quadro seria
 * devolver a pergunta.
 */
export function montarMinhasDemandas(args: {
  cards: DemandaNaConsulta[];
  hoje: string;
  appUrl?: string | null;
}): string {
  const abertas = args.cards.filter((c) => !c.entregue);
  if (abertas.length === 0) {
    return "Você não tem nenhuma demanda em aberto. 🎉";
  }

  const ordenadas = ordenarPorUrgencia(abertas, args.hoje);
  const atrasadas = ordenadas.filter(
    (c) => c.prazo && c.prazo < args.hoje,
  ).length;

  const cabecalho =
    `**Suas demandas em aberto — ${abertas.length}**` +
    (atrasadas
      ? ` · ${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}`
      : "");

  return juntar(
    cabecalho,
    ordenadas.slice(0, TETO_LISTA).map((c) => linha(c, args.hoje, args.appUrl)),
    abertas.length,
    "",
  );
}

/**
 * A resposta de `/demanda <busca>`.
 *
 * Ela procura entre as demandas do SETOR de quem perguntou, e inclui as
 * entregues: quem busca pelo nome de uma demanda muitas vezes quer justamente a
 * que já foi entregue — "aquilo ficou pronto?" é metade das perguntas que o
 * comando existe para responder. A etapa na linha diz qual é o caso.
 */
export function montarBusca(args: {
  termo: string;
  cards: DemandaNaConsulta[];
  hoje: string;
  appUrl?: string | null;
}): string {
  const termo = args.termo.trim();
  if (!termo) {
    return "Diga o que procurar: `/demanda busca: painel do refeitório`.";
  }

  const achadas = args.cards.filter((c) => combina(c.title, termo));
  if (achadas.length === 0) {
    return `Nenhuma demanda do seu setor com **${termo.slice(0, 80)}** no título. A busca ignora acento e maiúscula, então tente uma palavra só.`;
  }

  const ordenadas = ordenarPorUrgencia(achadas, args.hoje);
  return juntar(
    `**${achadas.length} demanda${achadas.length === 1 ? "" : "s"} com “${termo.slice(0, 60)}”**`,
    ordenadas
      .slice(0, TETO_LISTA)
      .map(
        (c) =>
          linha(c, args.hoje, args.appUrl) +
          (c.entregue ? " ✓" : "") +
          (c.responsavel ? ` · ${c.responsavel}` : ""),
      ),
    achadas.length,
    "",
  );
}
