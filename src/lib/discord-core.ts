/**
 * O aviso da demanda no Discord — o que se escreve, e para onde ele vai.
 *
 * Moradia em módulo puro, como `kanban-columns`, `tags-ref` e `historico-core`:
 * aqui não entra o SDK do Firestore nem `fetch`, então tudo isto é testado por
 * `scripts/test-discord.mjs` sem subir nada e sem falar com o Discord. Quem
 * manda de verdade é `src/lib/server/discord.ts`.
 *
 * O PROBLEMA que isto resolve: o quadro só conta o que aconteceu para quem está
 * com ele aberto. Quem passa o dia no Discord descobre que a demanda trocou de
 * dono quando abre o Kanban — ou quando alguém avisa por fora, que é o que
 * acontecia.
 *
 * Quatro decisões que valem ser lidas antes de mexer:
 *
 * 1. O AVISO NASCE DO EVENTO DO HISTÓRICO, não de um segundo diff. `mudancas`
 *    chega pronto de `diffCard` — com os rótulos já resolvidos, "Etapa: A → B"
 *    em vez de `columnId`. Calcular de novo aqui criaria duas verdades sobre a
 *    mesma mudança, e a do Discord seria a que ninguém confere.
 *
 * 2. OS TETOS DO DISCORD SÃO REGRA, e por isso moram num módulo com teste. A
 *    API recusa o embed INTEIRO quando um campo estoura — devolve 400, o aviso
 *    some, e nada na tela do Smart Meet indica que sumiu. Uma descrição de 4 mil
 *    caracteres não é caso de borda: é o tamanho que `updateCard` permite.
 *
 * 3. NADA AQUI VAI À REDE, e nada aqui lê `process.env` sozinho. O ambiente
 *    entra por parâmetro (`webhookDoSetor`), que é o que permite testar o
 *    roteamento por setor sem inventar variável de ambiente no teste.
 *
 * 4. O AVISO É CLICÁVEL. `/kanban?setor=X&card=<id>` já abre o card direto —
 *    ver `src/app/(app)/kanban/page.tsx:296`. Aviso que obriga a pessoa a
 *    procurar a demanda no quadro é meio aviso.
 */

// Módulo puro importando módulo puro, como `historico-core` importa
// `links-core`. Com extensão: quem roda este arquivo pelo strip de tipos do
// Node exige o caminho completo.
import {
  ACAO_ROTULO,
  linhaDaMudanca,
  type Acao,
  type Mudanca,
} from "./historico-core.ts";

// ---------------------------------------------------------------------------
// Os tetos da API do Discord.
//
// Estes números são DELES, não nossos, e estourar qualquer um devolve 400 com o
// embed inteiro recusado. Ficam nomeados aqui em vez de espalhados como número
// solto porque a próxima pessoa precisa saber que são externos: mudá-los não
// afrouxa nada, só quebra em produção.
// ---------------------------------------------------------------------------
export const LIMITE_TITULO = 256;
export const LIMITE_DESCRICAO = 4096;
export const LIMITE_CAMPO_NOME = 256;
export const LIMITE_CAMPO_VALOR = 1024;
export const LIMITE_CAMPOS = 25;
export const LIMITE_AUTOR = 256;
export const LIMITE_RODAPE = 2048;
export const LIMITE_CONTEUDO = 2000;
/** Soma de título + descrição + campos + rodapé + autor, no embed inteiro. */
export const LIMITE_TOTAL_EMBED = 6000;

/**
 * A cor da barra lateral do embed, por ação.
 *
 * É a única pista que se lê ANTES do texto, numa lista de avisos empilhados no
 * canal. Laranja é a marca e fica com o nascimento da demanda; vermelho e verde
 * ficam com o par excluir/restaurar, que é o que mais assusta quem vê passar.
 * Editar é cinza de propósito: é o evento mais frequente e o que menos precisa
 * puxar o olho.
 */
export const COR_POR_ACAO: Record<Acao, number> = {
  criada: 0xff6a2b,
  editada: 0x8b93a1,
  movida: 0x4c8bf5,
  excluida: 0xd64545,
  restaurada: 0x3fa66b,
};

/** O recorte do card que o aviso enxerga — tudo já resolvido para texto. */
export type CardDoAviso = {
  id: string;
  sector: string;
  title: string;
  /** Título da coluna, não o `colId`. Quem resolve é a rota, lendo /columns. */
  etapa?: string | null;
  /** Nome do responsável, não o e-mail. */
  responsavel?: string | null;
  /**
   * Id do responsável no Discord, quando ele vinculou a conta.
   *
   * É o que transforma o aviso em notificação de verdade: sem ele a mensagem
   * chega no canal e depende de alguém estar olhando. Ausente é o caso comum
   * enquanto ninguém vinculou — e o aviso sai igual, só sem a menção.
   */
  responsavelDiscordId?: string | null;
  solicitante?: string | null;
  setorSolicitante?: string | null;
  /** aaaa-mm-dd. */
  prazo?: string | null;
  prioridade?: string | null;
  tipo?: string | null;
};

/** O evento do histórico, como ele está gravado. */
export type EventoDoAviso = {
  id: string;
  /** Nome de quem fez, já resolvido. Cai no e-mail quando não há cadastro. */
  autor: string;
  /** Milissegundos. */
  em: number;
  acao: Acao;
  mudancas: Mudanca[];
};

/**
 * Corta preservando palavra quando dá, e marca o corte.
 *
 * O reticências conta para o teto — cortar em `max` e depois somar três
 * caracteres é como se estoura um limite achando que se respeitou ele.
 */
export function cortar(texto: string, max: number): string {
  const t = (texto ?? "").trim();
  if (t.length <= max) return t;
  const bruto = t.slice(0, max - 1);
  const espaco = bruto.lastIndexOf(" ");
  // Só quebra na palavra se sobrar texto de verdade; senão o corte seco é
  // melhor do que devolver duas letras e um reticências.
  const base = espaco > max * 0.6 ? bruto.slice(0, espaco) : bruto;
  return `${base.trimEnd()}…`;
}

/**
 * Se este evento vira aviso.
 *
 * Mora aqui, e não num `if` dentro da rota, porque é POLÍTICA DE RUÍDO — a
 * primeira coisa que vai querer mudar quando o canal encher. Um lugar, com
 * teste.
 *
 * A régua hoje é generosa de propósito: tudo que virou linha na timeline vira
 * aviso. `diffCard` já é o filtro de ruído do projeto — reordenar checklist e
 * renomear um link não geram evento nenhum, então não chegam até aqui. Duplicar
 * esse julgamento criaria uma demanda que aparece no histórico e não aparece no
 * Discord, e a diferença entre as duas listas seria impossível de explicar para
 * quem usa.
 *
 * O que ela recusa é o evento VAZIO de verbo que precisa de par: "editada" sem
 * nenhuma mudança não tem o que contar, e viraria "fulano editou a demanda" sem
 * dizer o quê — ruído puro num canal.
 */
export function deveAvisar(acao: Acao, mudancas: Mudanca[]): boolean {
  if (acao === "editada" || acao === "movida") return mudancas.length > 0;
  return true;
}

/**
 * O endereço do card no app, ou `null` quando não se sabe onde o app mora.
 *
 * A base NÃO pode sair da origem da requisição — mesmo motivo de
 * `src/lib/server/notify.ts:197`: o link seria o host interno do deploy, que
 * não existe para quem clica. `APP_URL` manda; sem ela, o aviso sai sem link,
 * que é melhor do que sair com um link quebrado.
 */
export function linkDoCard(
  appUrl: string | null | undefined,
  sector: string,
  cardId: string,
): string | null {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const q = new URLSearchParams({ setor: sector, card: cardId });
  return `${base}/kanban?${q.toString()}`;
}

/** aaaa-mm-dd → dd/mm/aaaa. Qualquer outra coisa passa reto. */
function dataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Para onde este setor avisa.
 *
 * `porSetor` é um JSON opcional (`DISCORD_WEBHOOK_URLS`) e ganha do padrão. Um
 * setor sem entrada própria cai no `padrao` — que é o caso de hoje, com um setor
 * só executando demanda (ver `DEFAULT_SECTORS` em `users.ts`). A porta fica
 * aberta porque o dia em que um segundo setor entrar, ele vai querer o próprio
 * canal, e descobrir isso com o quadro em produção é tarde.
 *
 * JSON quebrado NÃO derruba o aviso: cai no padrão e segue. Variável de
 * ambiente mal colada é erro de configuração, e configuração errada não pode
 * calar a notificação inteira.
 */
export function webhookDoSetor(
  sector: string,
  padrao: string | null | undefined,
  porSetor?: string | null,
): string | null {
  const limpo = (padrao ?? "").trim();
  if (porSetor) {
    try {
      const mapa = JSON.parse(porSetor) as Record<string, unknown>;
      const achado = mapa?.[sector];
      if (typeof achado === "string" && achado.trim()) return achado.trim();
    } catch {
      // Silêncio proposital — ver o comentário acima.
    }
  }
  return limpo || null;
}

// ---------------------------------------------------------------------------
// O corpo do webhook.
//
// Os tipos são o subconjunto que este projeto usa, e não o da API inteira: o
// que não está aqui é o que ninguém manda, e acrescentar campo é decisão
// consciente e não autocomplete.
// ---------------------------------------------------------------------------

export type EmbedCampo = { name: string; value: string; inline?: boolean };

export type Embed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: EmbedCampo[];
  author?: { name: string };
  footer?: { text: string };
  /** ISO 8601. */
  timestamp?: string;
};

export type CorpoWebhook = {
  content?: string;
  embeds: Embed[];
  /**
   * A trava do `@everyone`.
   *
   * `parse: []` desliga TODA menção automática; `users` reabre a permissão para
   * exatamente os ids listados. Sem isto, um título de demanda contendo
   * "@everyone" — texto que qualquer pessoa digita no campo Título — notificaria
   * o servidor inteiro. O padrão do Discord é permitir; o padrão daqui é negar.
   */
  allowed_mentions: { parse: never[]; users?: string[] };
};

/** Quanto do orçamento de 6000 caracteres um embed já gastou. */
export function pesoDoEmbed(e: Embed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0)
  );
}

/**
 * Tira campos do fim até o embed caber nos 6000.
 *
 * A ordem dos campos é de importância decrescente (ver `montarAviso`), então
 * cortar do fim descarta o menos útil. E o corte é ANUNCIADO — um embed que
 * silenciosamente perde metade das mudanças mente sobre o que aconteceu.
 */
export function aparar(embed: Embed): Embed {
  if (pesoDoEmbed(embed) <= LIMITE_TOTAL_EMBED) return embed;
  const campos = [...(embed.fields ?? [])];
  let cortados = 0;
  const tentativa = (): Embed => ({
    ...embed,
    fields: cortados
      ? [
          ...campos,
          {
            name: "…",
            value: `mais ${cortados} ${cortados === 1 ? "item" : "itens"} — abra a demanda`,
          },
        ]
      : campos,
  });
  while (campos.length && pesoDoEmbed(tentativa()) > LIMITE_TOTAL_EMBED) {
    campos.pop();
    cortados++;
  }
  return tentativa();
}

/**
 * O aviso pronto para ir ao webhook.
 *
 * A ordem dos campos NÃO é estética: é a ordem em que se lê um aviso de
 * demanda. O que mudou vem primeiro, porque é a notícia; o estado atual vem
 * depois, porque é o contexto. Quem só bate o olho no celular lê a notícia e
 * segue.
 */
export function montarAviso(args: {
  card: CardDoAviso;
  evento: EventoDoAviso;
  appUrl?: string | null;
  /** Rótulos legíveis de prioridade e tipo, do `kanban.ts` de quem chama. */
  rotulo?: { prioridade?: (p: string) => string; tipo?: (t: string) => string };
}): CorpoWebhook {
  const { card, evento, appUrl, rotulo } = args;
  const link = linkDoCard(appUrl, card.sector, card.id);

  const campos: EmbedCampo[] = [];

  // 1. A notícia: o que mudou, na mesma redação da timeline do card.
  for (const m of evento.mudancas) {
    if (campos.length >= LIMITE_CAMPOS - 1) break;
    const linha = linhaDaMudanca(m);
    const valor = linha.nota
      ? linha.nota
      : `${linha.de ?? "—"} → **${linha.para ?? "—"}**`;
    campos.push({
      name: cortar(linha.rotulo, LIMITE_CAMPO_NOME),
      value: cortar(valor, LIMITE_CAMPO_VALOR) || "—",
      inline: true,
    });
  }

  // 2. O contexto: onde a demanda está agora. Só o que não repete a notícia —
  // mostrar "Etapa: Fazendo" logo abaixo de "Etapa: A fazer → Fazendo" é a
  // mesma informação ocupando duas linhas do celular de quem leu.
  const jaContado = new Set(evento.mudancas.map((m) => m.campo));
  const contexto: [string, string | null | undefined, boolean][] = [
    ["Etapa", jaContado.has("coluna") ? null : card.etapa, true],
    ["Responsável", jaContado.has("responsavel") ? null : card.responsavel, true],
    [
      "Prazo",
      jaContado.has("prazo") ? null : card.prazo ? dataBR(card.prazo) : null,
      true,
    ],
    [
      "Prioridade",
      jaContado.has("prioridade")
        ? null
        : card.prioridade
          ? (rotulo?.prioridade?.(card.prioridade) ?? card.prioridade)
          : null,
      true,
    ],
    [
      "Solicitante",
      jaContado.has("solicitante")
        ? null
        : [card.solicitante, card.setorSolicitante]
            .filter(Boolean)
            .join(" · ") || null,
      true,
    ],
  ];
  for (const [nome, valor, inline] of contexto) {
    if (!valor || campos.length >= LIMITE_CAMPOS) continue;
    campos.push({
      name: nome,
      value: cortar(String(valor), LIMITE_CAMPO_VALOR),
      inline,
    });
  }

  const embed = aparar({
    author: { name: cortar(`${evento.autor} ${ACAO_ROTULO[evento.acao]}`, LIMITE_AUTOR) },
    title: cortar(card.title || "Demanda sem título", LIMITE_TITULO),
    ...(link ? { url: link } : {}),
    color: COR_POR_ACAO[evento.acao],
    fields: campos,
    footer: {
      text: cortar(
        `Smart Meet · ${card.sector}${card.tipo ? ` · ${rotulo?.tipo?.(card.tipo) ?? card.tipo}` : ""}`,
        LIMITE_RODAPE,
      ),
    },
    // `em` vem do relógio do SERVIDOR (`serverTimestamp()` — ver `historico.ts`),
    // então o horário do aviso é o horário do fato, não o de quando a mensagem
    // saiu. A diferença aparece quando um reenvio acontece horas depois.
    timestamp: new Date(evento.em).toISOString(),
  });

  // A menção vive no `content`, e não dentro do embed: o Discord NÃO notifica
  // por menção escrita em embed — ela vira texto azul e ninguém recebe nada.
  // É o erro que faz a integração parecer pronta e não avisar ninguém.
  const alvo = (card.responsavelDiscordId ?? "").trim();
  const content = alvo ? cortar(`<@${alvo}>`, LIMITE_CONTEUDO) : undefined;

  return {
    ...(content ? { content } : {}),
    embeds: [embed],
    allowed_mentions: alvo ? { parse: [], users: [alvo] } : { parse: [] },
  };
}

/**
 * UMA mensagem para a rodada inteira do cron de recorrências.
 *
 * E não um aviso por card, que é a escolha óbvia e a errada: o cron pode abrir
 * dezenas de cards às 06:10, e vinte mensagens seguidas no canal — todas iguais
 * menos o título — é o jeito de fazer alguém silenciar o canal. Canal
 * silenciado apaga também os avisos que importam, que é um preço alto demais
 * por uma rotina automática que ninguém precisa acompanhar card a card.
 *
 * Mora aqui, e não na rota, pelo motivo de sempre (AGENTS.md §4): montar a
 * mensagem é REGRA, e regra tem teste. O que fica na rota é o envio.
 */
export function montarResumoDeRecorrencias(args: {
  sector: string;
  cards: { id: string; title: string; responsavel?: string | null }[];
  appUrl?: string | null;
}): CorpoWebhook {
  const { sector, cards, appUrl } = args;

  // 15 linhas cabem folgadas nos 4096 da descrição e ainda são legíveis num
  // celular; o resto vira contagem. Uma lista de sessenta títulos não é lista,
  // é parede.
  const TETO_LINHAS = 15;
  const mostradas = cards.slice(0, TETO_LINHAS);
  const sobrando = cards.length - mostradas.length;

  const linhas = mostradas.map((c) => {
    const alvo = linkDoCard(appUrl, sector, c.id);
    // Os colchetes e parênteses do título quebrariam o link do Markdown ao
    // meio, e o que sobraria na tela seria a URL crua no meio da frase.
    const titulo = cortar(c.title || "Demanda sem título", 120).replace(
      /[[\]()]/g,
      "",
    );
    const nome = alvo ? `[${titulo}](${alvo})` : titulo;
    return `• ${nome}${c.responsavel ? ` — ${c.responsavel}` : ""}`;
  });
  if (sobrando > 0) linhas.push(`• …e mais ${sobrando}`);

  return {
    embeds: [
      {
        author: { name: cortar("Recorrências do dia", LIMITE_AUTOR) },
        title: cortar(
          cards.length === 1
            ? "1 demanda de manutenção foi aberta"
            : `${cards.length} demandas de manutenção foram abertas`,
          LIMITE_TITULO,
        ),
        description: cortar(linhas.join("\n"), LIMITE_DESCRICAO),
        // O verde-água de `manutencao` em `DEMAND_TYPE_COLOR`: é o tipo que a
        // recorrência abre, e a cor faz o resumo se reconhecer de longe entre
        // os avisos de demanda comuns.
        color: 0x2dd4bf,
        footer: { text: cortar(`Smart Meet · ${sector}`, LIMITE_RODAPE) },
      },
    ],
    // Rotina automática não menciona ninguém. O responsável de cada card ganha
    // menção quando alguém MEXER na demanda dele; ser acordado às 6h por um
    // cron é o tipo de notificação que ensina a ignorar todas as outras.
    allowed_mentions: { parse: [] },
  };
}
