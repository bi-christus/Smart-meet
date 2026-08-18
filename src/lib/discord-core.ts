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
 *    entra por parâmetro (`resolverWebhook`), que é o que permite testar o
 *    roteamento por canal e por setor sem inventar variável de ambiente no
 *    teste.
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

// ---------------------------------------------------------------------------
// O roteamento: qual canal recebe o quê.
//
// O servidor do setor não tem UM canal de demandas — tem quatro, cada um com um
// assunto (`#demandas-novas`, `#demandas-fluxo`, `#alertas-e-recorrencias`,
// `#resumo-diario`). Publicar tudo num canal só desfaz de propósito a
// organização que alguém montou: quem quer ver demanda nascendo passa a ler
// também toda troca de etapa, e o jeito de sobreviver a isso é silenciar o
// canal inteiro — que apaga junto o aviso que importava.
// ---------------------------------------------------------------------------

/** Os canais, por assunto. O nome é a CHAVE da configuração, não o do canal. */
export const CANAIS = ["novas", "fluxo", "alertas", "resumo"] as const;
export type Canal = (typeof CANAIS)[number];

/**
 * Em que canal este evento se lê.
 *
 * "Nasceu uma demanda" é notícia para quem acompanha entrada de trabalho;
 * "mudou de etapa", "foi editada", "foi para a lixeira" é acompanhamento de
 * fluxo, e é o volume. Separar os dois é o que permite alguém seguir só o
 * primeiro sem perder nada.
 *
 * A lixeira fica no fluxo, e não num canal próprio: excluir e restaurar são
 * raros o bastante para não incomodar, e um canal a mais por causa deles seria
 * um canal que ninguém abre.
 */
export function canalDoEvento(acao: Acao): Canal {
  return acao === "criada" ? "novas" : "fluxo";
}

/** Só o que se aceita como URL: string com conteúdo, já sem espaço em volta. */
function comoUrl(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * JSON de configuração, ou `null` quando não dá para ler.
 *
 * JSON quebrado NÃO derruba o aviso — quem chama cai no próximo degrau. Variável
 * de ambiente mal colada é erro de configuração, e configuração errada não pode
 * calar a notificação inteira.
 */
function mapa(bruto?: string | null): Record<string, unknown> | null {
  if (!bruto) return null;
  try {
    const v = JSON.parse(bruto) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Para onde ESTE aviso vai — o canal do assunto, dentro do setor.
 *
 * Quatro degraus, do mais específico ao mais genérico, e o primeiro que
 * responde ganha:
 *
 *   1. `porSetor[setor][canal]` — o setor tem canais próprios.
 *   2. `porSetor[setor]` como string — o setor tem UM canal para tudo. É a forma
 *      antiga de `DISCORD_WEBHOOK_URLS`, e continua valendo: quem já a
 *      configurou não precisa mexer em nada para o app continuar publicando.
 *   3. `porCanal[canal]` — os canais do servidor, valendo para todos os setores.
 *      É a configuração de hoje, com um setor só executando demanda.
 *   4. `padrao` — `DISCORD_WEBHOOK_URL`, o canal único de antes de tudo isto.
 *
 * A ordem não é arbitrária: o que alguém escreveu para um setor específico é
 * uma decisão mais informada do que a regra geral do servidor, e a regra geral
 * é mais informada do que o padrão herdado. Inverter qualquer par faz uma
 * configuração nova ser silenciosamente ignorada — o modo de falha em que tudo
 * parece certo e as mensagens continuam saindo no canal errado.
 */
export function resolverWebhook(args: {
  canal: Canal;
  setor: string;
  padrao?: string | null;
  /** `DISCORD_WEBHOOK_URLS`: `{"B.I.": "url"}` ou `{"B.I.": {"novas": "url"}}`. */
  porSetor?: string | null;
  /** `DISCORD_WEBHOOK_CANAIS`: `{"novas": "url", "fluxo": "url", …}`. */
  porCanal?: string | null;
}): string | null {
  const { canal, setor } = args;

  const doSetor = mapa(args.porSetor)?.[setor];
  if (doSetor && typeof doSetor === "object" && !Array.isArray(doSetor)) {
    const m = doSetor as Record<string, unknown>;
    // `padrao` dentro do setor é a saída para quem quer um canal só para os
    // assuntos que não configurou, sem repetir a mesma URL quatro vezes.
    const achado = comoUrl(m[canal]) ?? comoUrl(m.padrao);
    if (achado) return achado;
  } else {
    const achado = comoUrl(doSetor);
    if (achado) return achado;
  }

  return comoUrl(mapa(args.porCanal)?.[canal]) ?? comoUrl(args.padrao);
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

// ---------------------------------------------------------------------------
// O aviso direto — a mesma notícia, na caixa de quem ela é.
//
// O canal resolve "o setor precisa saber". Ele NÃO resolve "você precisa
// saber": a menção no canal chega junto com todas as outras, e quem está com o
// Discord no celular durante uma aula lê a notificação do servidor uma vez por
// dia. A demanda que mudou de prazo hoje de manhã é a que menos pode esperar
// por isso.
//
// Por isso o direto existe, e por isso ele é ESTREITO de propósito: só o
// responsável, só o que mexeu na demanda dele, e nunca o que ele mesmo fez.
// Mensagem direta é o canal mais caro que existe — ela vibra o telefone e não
// dá para silenciar sem silenciar o bot inteiro. Gastá-la com eco do próprio
// clique é o jeito de ensinar alguém a ignorar todas.
// ---------------------------------------------------------------------------

/**
 * Se este evento merece uma mensagem direta ao responsável.
 *
 * Três recusas, e cada uma vale ser lida:
 *
 * 1. SEM VÍNCULO não há para onde mandar. É o caso comum enquanto ninguém
 *    conectou a conta, e o aviso do canal sai igual.
 *
 * 2. O AUTOR NÃO SE AVISA. Quem arrastou o próprio card acabou de ver a tela
 *    responder; a mensagem chegaria antes de ele soltar o mouse. Este é o
 *    ruído que mais rápido faz alguém desligar o bot.
 *
 * 3. EVENTO SEM NOTÍCIA não vira direto, pelo mesmo motivo que não vira aviso
 *    de canal (`deveAvisar`) — e a régua é a MESMA função, de propósito: duas
 *    réguas separadas divergiriam no dia em que alguém mexesse numa só, e a
 *    diferença entre "apareceu no canal" e "chegou na DM" seria impossível de
 *    explicar para quem usa.
 *
 * O que ela NÃO cobre, e a nota fica: quem PERDEU a demanda não é avisado. A
 * mudança do responsável guarda só o nome de quem saiu (`Mudanca.de`), não o
 * e-mail, e sem e-mail não há vínculo a procurar. Resolver isso exigiria o
 * evento carregar identidade além de rótulo — mudança no histórico, não aqui.
 */
export function deveMandarDireto(args: {
  acao: Acao;
  mudancas: Mudanca[];
  /** E-mail de quem fez a mudança. */
  autorEmail: string;
  /** E-mail do responsável ATUAL do card. */
  responsavelEmail?: string | null;
  responsavelDiscordId?: string | null;
}): boolean {
  const { acao, mudancas, autorEmail, responsavelEmail, responsavelDiscordId } =
    args;
  if (!(responsavelDiscordId ?? "").trim()) return false;

  const resp = (responsavelEmail ?? "").trim().toLowerCase();
  if (!resp) return false;
  if (resp === (autorEmail ?? "").trim().toLowerCase()) return false;

  return deveAvisar(acao, mudancas);
}

/**
 * A primeira linha da mensagem direta: por que ela chegou.
 *
 * Uma DM do nada com um embed dentro é um susto — a pessoa não pediu, e o
 * embed sozinho não diz se ela precisa fazer alguma coisa. A frase resolve isso
 * em cinco palavras, e é o que aparece na prévia da notificação do celular,
 * antes de qualquer toque.
 *
 * "passou a ser sua" ganha das outras quando o responsável mudou porque é a
 * única que muda o que a pessoa tem a fazer hoje.
 */
export function linhaDoDireto(acao: Acao, mudancas: Mudanca[]): string {
  if (mudancas.some((m) => m.campo === "responsavel")) {
    return "Esta demanda passou a ser sua.";
  }
  if (acao === "criada") return "Abriram uma demanda no seu nome.";
  if (acao === "excluida") return "Uma demanda sua foi para a lixeira.";
  if (acao === "restaurada") return "Uma demanda sua voltou da lixeira.";
  if (acao === "movida") return "Uma demanda sua mudou de etapa.";
  return "Alteraram uma demanda sua.";
}

/**
 * A mensagem direta, a partir do MESMO embed do canal.
 *
 * Reaproveitar `montarAviso` não é economia de linhas: é a garantia de que a DM
 * e o canal contam a mesma história. Um segundo montador acabaria mostrando um
 * campo a mais aqui e um a menos ali, e a pessoa que lesse os dois teria de
 * decidir em qual acreditar.
 *
 * Duas diferenças, e só duas:
 *
 * - `content` vira a frase do porquê, e não a menção. Mencionar alguém dentro da
 *   própria DM dele é ruído: ele já está sendo notificado por estar ali.
 * - `allowed_mentions` fecha tudo. Não há ninguém a notificar além do
 *   destinatário, e um `@everyone` digitado no título de uma demanda não pode
 *   virar nada aqui dentro.
 */
export function montarAvisoDireto(args: {
  card: CardDoAviso;
  evento: EventoDoAviso;
  appUrl?: string | null;
  rotulo?: { prioridade?: (p: string) => string; tipo?: (t: string) => string };
}): CorpoWebhook {
  const { evento } = args;
  return {
    content: cortar(linhaDoDireto(evento.acao, evento.mudancas), LIMITE_CONTEUDO),
    embeds: montarAviso(args).embeds,
    allowed_mentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// O resumo do dia.
//
// Os outros avisos contam o que ACABOU de acontecer; nenhum deles conta o que
// está parado. Uma demanda que venceu na sexta e ninguém tocou não gera evento
// nenhum — ela some do canal justamente por não estar andando, que é o motivo
// de alguém precisar saber dela. O resumo é o único aviso que fala do que NÃO
// aconteceu.
// ---------------------------------------------------------------------------

/** O recorte do card que o resumo enxerga — tudo já resolvido para texto. */
export type CardDoResumo = {
  id: string;
  title: string;
  responsavel?: string | null;
  /** aaaa-mm-dd. */
  prazo?: string | null;
  /** Título da coluna, não o `colId`. */
  etapa?: string | null;
  /** Se a etapa atual já conta como entrega — ver `colunasEntregues`. */
  entregue: boolean;
};

export type Panorama = {
  /** Quantas demandas vivas e não entregues o setor tem. */
  abertas: number;
  /** Prazo já vencido, da mais antiga para a mais nova. */
  atrasadas: CardDoResumo[];
  vencemHoje: CardDoResumo[];
  /** Aberta e sem ninguém — o buraco que ninguém vê passar. */
  semResponsavel: CardDoResumo[];
  /** Etapa → quantas, na ordem em que as etapas chegaram. */
  porEtapa: [string, number][];
};

/**
 * O que há para contar sobre o dia.
 *
 * ENTREGUE NÃO CONTA COMO ATRASO, e isto é a regra do app inteiro, não uma
 * escolha deste arquivo: prazo vencido de demanda já entregue não é atraso —
 * a data passou depois que o trabalho terminou. É o mesmo motivo de
 * `colunasEntregues` existir em `kanban-columns.ts`. Um resumo que cobra
 * entrega já feita é um resumo que se aprende a ignorar em duas semanas.
 *
 * `hoje` entra por parâmetro (aaaa-mm-dd) e não sai de `new Date()` aqui
 * dentro: o teste precisa de relógio, e a rota roda em UTC enquanto o setor
 * trabalha em São Paulo — quem decide qual é "hoje" é quem sabe do fuso.
 */
export function panoramaDoDia(args: {
  cards: CardDoResumo[];
  hoje: string;
}): Panorama {
  const abertas = args.cards.filter((c) => !c.entregue);

  const comPrazo = abertas.filter((c) => !!c.prazo);
  const atrasadas = comPrazo
    .filter((c) => (c.prazo as string) < args.hoje)
    // Da mais antiga para a mais nova: a que está parada há mais tempo é a que
    // menos pode continuar no fim da lista.
    .sort((a, b) => (a.prazo as string).localeCompare(b.prazo as string));
  const vencemHoje = comPrazo.filter((c) => c.prazo === args.hoje);

  const semResponsavel = abertas.filter(
    (c) => !(c.responsavel ?? "").trim(),
  );

  const contagem = new Map<string, number>();
  for (const c of abertas) {
    const etapa = (c.etapa ?? "").trim() || "Sem etapa";
    contagem.set(etapa, (contagem.get(etapa) ?? 0) + 1);
  }

  return {
    abertas: abertas.length,
    atrasadas,
    vencemHoje,
    semResponsavel,
    porEtapa: [...contagem.entries()],
  };
}

/** Quantas linhas cabem num bloco antes de ele virar parede. */
const TETO_LINHAS_RESUMO = 8;

/**
 * Uma lista de demandas que CABE no campo, com o corte anunciado.
 *
 * O teto de linhas não basta sozinho, e foi assim que este bloco nasceu errado:
 * oito títulos longos com link passam dos 1024 caracteres do campo, e o
 * `cortar` da borda apagava justamente a última linha — a que dizia "…e mais
 * 32". O resultado era uma lista que parecia completa e não era, que é a única
 * forma de errar aqui que ninguém percebe.
 *
 * Por isso o orçamento é conferido A CADA linha, já descontando o espaço que a
 * frase do corte vai ocupar. Mesma ideia de `aparar`: um bloco que perde
 * silenciosamente metade dos itens mente sobre o que aconteceu.
 */
function bloco(
  cards: CardDoResumo[],
  sector: string,
  appUrl: string | null | undefined,
): string {
  const aviso = (n: number) => `• …e mais ${n}`;
  const linhas: string[] = [];
  let usado = 0;

  for (const c of cards) {
    if (linhas.length >= TETO_LINHAS_RESUMO) break;

    const alvo = linkDoCard(appUrl, sector, c.id);
    // Colchetes e parênteses quebrariam o link do Markdown ao meio, e o que
    // sobraria na tela seria a URL crua no meio da frase.
    const titulo = cortar(c.title || "Demanda sem título", 90).replace(
      /[[\]()]/g,
      "",
    );
    const nome = alvo ? `[${titulo}](${alvo})` : titulo;
    const quem = (c.responsavel ?? "").trim();
    const linha = `• ${nome}${quem ? ` — ${quem}` : " — _sem responsável_"}`;

    const sobrariam = cards.length - linhas.length - 1;
    const reserva = sobrariam > 0 ? aviso(sobrariam).length + 1 : 0;
    if (usado + linha.length + 1 + reserva > LIMITE_CAMPO_VALOR) break;

    linhas.push(linha);
    usado += linha.length + 1;
  }

  const sobrando = cards.length - linhas.length;
  if (sobrando > 0) linhas.push(aviso(sobrando));
  return linhas.join("\n");
}

/**
 * O resumo do dia, ou `null` quando o quadro está vazio.
 *
 * `null` E NÃO "0 demandas abertas". Um aviso diário que chega dizendo que não
 * há nada é o aviso que ensina a não abrir o canal — e quando ele finalmente
 * tiver notícia, já terá virado ruído de fundo. Quadro com demanda aberta e
 * nada atrasado, esse SIM vira mensagem: "está tudo em dia" é informação, e é
 * a única forma de alguém confiar no silêncio dos outros dias.
 *
 * A COR É O QUE SE LÊ ANTES DO TEXTO numa lista de avisos empilhados, e aqui
 * ela é o resumo do resumo: vermelho quando há atraso, âmbar quando algo vence
 * hoje, verde quando não há nem um nem outro. Quem rolar o canal sem ler sabe
 * o estado do setor pela barra lateral.
 */
export function montarResumoDiario(args: {
  sector: string;
  cards: CardDoResumo[];
  /** aaaa-mm-dd, no fuso de quem trabalha. */
  hoje: string;
  appUrl?: string | null;
}): CorpoWebhook | null {
  const { sector, hoje, appUrl } = args;
  const p = panoramaDoDia({ cards: args.cards, hoje });
  if (p.abertas === 0) return null;

  const campos: EmbedCampo[] = [];
  if (p.atrasadas.length) {
    campos.push({
      name: `Atrasadas — ${p.atrasadas.length}`,
      value: bloco(p.atrasadas, sector, appUrl),
    });
  }
  if (p.vencemHoje.length) {
    campos.push({
      name: `Vencem hoje — ${p.vencemHoje.length}`,
      value: bloco(p.vencemHoje, sector, appUrl),
    });
  }
  if (p.semResponsavel.length) {
    campos.push({
      name: `Sem responsável — ${p.semResponsavel.length}`,
      value: bloco(p.semResponsavel, sector, appUrl),
    });
  }

  // O panorama por etapa vem por último e numa linha só: ele é o pano de fundo,
  // não a notícia. Quem lê o resumo quer saber o que precisa de ação hoje; o
  // total por coluna é o que ele confere depois, se conferir.
  const porEtapa = p.porEtapa.map(([etapa, n]) => `${etapa}: **${n}**`).join(" · ");
  if (porEtapa) {
    campos.push({ name: "No quadro", value: cortar(porEtapa, LIMITE_CAMPO_VALOR) });
  }

  const cor = p.atrasadas.length
    ? 0xd64545
    : p.vencemHoje.length
      ? 0xf5b13d
      : 0x3fa66b;

  const titulo = p.atrasadas.length
    ? `${p.atrasadas.length} demanda${p.atrasadas.length === 1 ? "" : "s"} atrasada${p.atrasadas.length === 1 ? "" : "s"}`
    : p.vencemHoje.length
      ? `${p.vencemHoje.length} demanda${p.vencemHoje.length === 1 ? "" : "s"} vence${p.vencemHoje.length === 1 ? "" : "m"} hoje`
      : "Nada atrasado por aqui";

  return {
    embeds: [
      aparar({
        author: { name: cortar("Resumo do dia", LIMITE_AUTOR) },
        title: cortar(titulo, LIMITE_TITULO),
        description: cortar(
          `${p.abertas} demanda${p.abertas === 1 ? "" : "s"} em aberto no quadro.`,
          LIMITE_DESCRICAO,
        ),
        color: cor,
        fields: campos,
        footer: { text: cortar(`Smart Meet · ${sector}`, LIMITE_RODAPE) },
      }),
    ],
    // Rotina diária não menciona ninguém, pelo mesmo motivo do cron das
    // recorrências: ser marcado por um relógio é o tipo de notificação que
    // ensina a ignorar as que vêm de gente.
    allowed_mentions: { parse: [] },
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
