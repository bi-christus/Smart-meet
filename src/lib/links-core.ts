/**
 * Links da demanda — o que dá para saber de uma URL sem abrir a URL.
 *
 * Moradia em módulo puro, como `kanban-columns`, `tags-ref` e `historico-core`:
 * aqui não entra o SDK do Firestore, então tudo isto é testado por
 * `scripts/test-links.mjs` sem subir nada. Quem escreve no banco é `kanban.ts`.
 *
 * O PROBLEMA que isto resolve: a demanda vive de coisas que moram fora dela — a
 * planilha do consumo, o painel do Looker, a pasta no Drive. Até aqui esses
 * endereços eram colados no meio da descrição, onde ninguém os acha depois e
 * onde uma URL de 90 caracteres do Drive quebra a leitura do texto em volta.
 *
 * Três decisões que valem ser lidas antes de mexer:
 *
 * 1. `normalizarUrl` é PORTÃO DE SEGURANÇA, não cosmético. O que sai daqui vai
 *    para um `href`, e `javascript:` num href executa no clique, com a sessão de
 *    quem clicou. Por isso a regra é lista de PERMISSÃO — só `http` e `https` —
 *    e não lista de proibição: esquema que ninguém previu devolve `""`.
 *
 * 2. NADA AQUI VAI À REDE. `servicoDe`, `corDoLink` e `monogramaDe` respondem só
 *    do texto da URL. O favicon do site seria mais bonito e custaria uma
 *    requisição por link a cada render, para um host que não é nosso, contando
 *    ao dono daquele host quem abriu qual demanda e quando.
 *
 * 3. A COR é identidade, não decoração. Marca conhecida usa a cor da marca;
 *    domínio desconhecido usa uma cor derivada do próprio domínio, sempre a
 *    mesma. Cor que muda entre uma tela e outra deixa de ser pista e vira ruído.
 */

export type CardLink = {
  id: string;
  /** Já passou por `normalizarUrl`. É este valor que vai para o `href`. */
  url: string;
  /** Rótulo humano. Ausente é o caso comum — a tela cai em `dominioDe`. */
  title?: string;
  /** E-mail de quem colou. Cru como no histórico: é a chave do avatar. */
  addedBy: string;
  /** Milissegundos. */
  addedAt: number;
  /**
   * O ícone que ALGUÉM ESCOLHEU para este link, sobrepondo o deduzido.
   *
   * Ausente é o caso normal e continua sendo para sempre: sem ele, `iconeDoLink`
   * (em `icones-core`) deduz pelo serviço, como esta tela sempre fez. O campo só
   * existe para a exceção — o endereço interno que cai no genérico, o Doc que a
   * pessoa quer marcar como planilha porque é isso que ele é para ela.
   *
   * O VALOR É OPACO AQUI, e isso não é desleixo. Quem sabe quais nomes existem é
   * `icones-core`, que conhece o catálogo; este módulo conhece URL. Pôr a
   * validação aqui obrigaria `links-core` a importar o catálogo, e o catálogo
   * importa daqui — as duas metades ficariam num ciclo para responder uma
   * pergunta que nenhuma das duas faz sozinha.
   */
  icone?: string;
};

export type ServicoLink =
  | "drive"
  | "docs"
  | "sheets"
  | "slides"
  | "forms"
  | "looker"
  | "powerbi"
  | "youtube"
  | "meet"
  | "calendar"
  | "github"
  | "figma"
  | "notion"
  | "trello"
  | "whatsapp"
  | "pdf"
  | "planilha"
  | "generico";

export const SERVICO_ROTULO: Record<ServicoLink, string> = {
  drive: "Google Drive",
  docs: "Documentos Google",
  sheets: "Planilhas Google",
  slides: "Apresentações Google",
  forms: "Formulários Google",
  looker: "Looker Studio",
  powerbi: "Power BI",
  youtube: "YouTube",
  meet: "Google Meet",
  calendar: "Google Agenda",
  github: "GitHub",
  figma: "Figma",
  notion: "Notion",
  trello: "Trello",
  whatsapp: "WhatsApp",
  pdf: "PDF",
  planilha: "Planilha",
  generico: "Link",
};

/**
 * Cor de marca, quando a marca é reconhecível de longe.
 *
 * Duas fugas conscientes do hex oficial: o Drive não tem cor única (o triângulo
 * é tricolor) e ficou com o amarelo dele, o que empurrou o Apresentações para o
 * laranja do Google — o amarelo oficial das duas é indistinguível numa lista de
 * seis links. GitHub e Notion são preto-e-branco na marca; preto some no tema
 * escuro, então ficaram em dois cinzas de temperatura diferente.
 */
const CORES: Record<Exclude<ServicoLink, "generico">, string> = {
  drive: "#ffba00",
  docs: "#4285f4",
  sheets: "#0f9d58",
  slides: "#e8710a",
  forms: "#7248b9",
  looker: "#2b7fff",
  powerbi: "#f2c811",
  youtube: "#ff0033",
  meet: "#00897b",
  calendar: "#1a73e8",
  github: "#7d8590",
  figma: "#f24e1e",
  notion: "#cfcbc4",
  trello: "#0079bf",
  whatsapp: "#25d366",
  pdf: "#e5484d",
  planilha: "#107c41",
};

/** Paleta do domínio sem marca conhecida. Mesma família do resto do quadro. */
const LINK_COLORS = [
  "#54b8ff",
  "#34d399",
  "#f5b13d",
  "#c084fc",
  "#fb7185",
  "#ff6a2b",
  "#2b7fff",
  "#5fe0b0",
];

/**
 * O esquema declarado no começo do texto, ou `null` quando não há nenhum.
 *
 * Duas coisas parecem esquema e não são; sem tratá-las, `normalizarUrl`
 * recusaria endereço legítimo. `bi.christus.com:8080/x` casa com a gramática de
 * esquema, mas nenhum esquema real tem ponto. E `localhost:3000` não tem ponto
 * nenhum — só que o que vem depois dos dois-pontos é porta, não caminho.
 */
function esquemaDe(t: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):([\s\S]*)$/.exec(t);
  if (!m) return null;
  const nome = m[1].toLowerCase();
  if (nome.includes(".")) return null;
  if (/^\d+([/?#]|$)/.test(m[2])) return null;
  return nome;
}

/** Host que é host de verdade: dois rótulos, no mínimo — ou `localhost`. */
const HOST_PLAUSIVEL = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

/**
 * Devolve a URL pronta para virar `href`, ou `""` quando não é URL.
 *
 * `""` é a resposta única para tudo que não passa: esquema perigoso, texto
 * solto, lixo colado. Quem chama testa uma coisa só, e não há caminho em que um
 * valor duvidoso chegue à tela "só desta vez".
 */
export function normalizarUrl(bruta: string): string {
  const t = (bruta ?? "").trim();
  if (!t) return "";

  const esquema = esquemaDe(t);
  if (esquema && esquema !== "http" && esquema !== "https") return "";

  let u: URL;
  try {
    // Sem esquema é o caso mais comum de colagem ("drive.google.com/..."), e
    // `https` é o padrão certo: quem ainda só serve `http` redireciona.
    u = new URL(esquema ? t : `https://${t}`);
  } catch {
    return "";
  }

  // Redundante hoje — o teste de esquema acima já garante isto. Fica porque é a
  // tranca que sobra no dia em que alguém afrouxar `esquemaDe`, e o que está do
  // outro lado desta porta é execução de script na sessão de quem clicou.
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";

  // "reunião de terça" vira "https://reunião de terça" e o construtor recusa
  // (espaço em host). Mas "rascunho" vira "https://rascunho", que ele ACEITA:
  // sem esta linha, toda frase de uma palavra viraria link.
  if (u.hostname !== "localhost" && !HOST_PLAUSIVEL.test(u.hostname)) return "";

  // `toString` é a normalização: minúsculas no host, porta padrão fora, query e
  // fragmento preservados como vieram.
  return u.toString();
}

/** Host sem `www.`, em minúsculas. `""` quando a URL não passa no portão. */
export function dominioDe(url: string): string {
  const norm = normalizarUrl(url);
  if (!norm) return "";
  try {
    // A porta sai junto: `hostname` (e não `host`) já vem sem ela, e uma porta
    // no rótulo não ajuda ninguém a reconhecer de onde é o link.
    return new URL(norm).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** `true` para o próprio domínio e para qualquer subdomínio dele. */
function ehDominio(host: string, alvo: string): boolean {
  return host === alvo || host.endsWith(`.${alvo}`);
}

/** Host conhecido → serviço. A ordem não importa: cada entrada é exclusiva. */
const POR_HOST: [string, ServicoLink][] = [
  ["forms.gle", "forms"],
  ["drive.google.com", "drive"],
  ["lookerstudio.google.com", "looker"],
  ["datastudio.google.com", "looker"],
  ["meet.google.com", "meet"],
  ["calendar.google.com", "calendar"],
  ["powerbi.com", "powerbi"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["github.com", "github"],
  ["figma.com", "figma"],
  ["notion.so", "notion"],
  ["notion.site", "notion"],
  ["trello.com", "trello"],
  ["wa.me", "whatsapp"],
  ["whatsapp.com", "whatsapp"],
];

/**
 * Que serviço é aquele link.
 *
 * O host decide primeiro e a extensão do arquivo só depois: um PDF hospedado no
 * Drive continua sendo um link do Drive para quem vai clicar — é lá que ele vai
 * parar, e é lá que estão as permissões que podem barrá-lo.
 */
export function servicoDe(url: string): ServicoLink {
  const norm = normalizarUrl(url);
  if (!norm) return "generico";

  let u: URL;
  try {
    u = new URL(norm);
  } catch {
    return "generico";
  }
  const dom = u.hostname.replace(/^www\./, "");
  const caminho = u.pathname.toLowerCase();

  // `docs.google.com` sozinho não diz nada: os quatro editores do Google moram
  // no mesmo host e só o primeiro pedaço do caminho os separa.
  if (dom === "docs.google.com") {
    if (caminho.startsWith("/spreadsheets")) return "sheets";
    if (caminho.startsWith("/document")) return "docs";
    if (caminho.startsWith("/presentation")) return "slides";
    if (caminho.startsWith("/forms")) return "forms";
  }

  const casa = POR_HOST.find(([h]) => ehDominio(dom, h));
  if (casa) return casa[1];

  if (caminho.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx|xls|csv)$/.test(caminho)) return "planilha";
  return "generico";
}

/** Cor do link: a da marca, ou uma estável derivada do domínio. */
export function corDoLink(url: string): string {
  const servico = servicoDe(url);
  if (servico !== "generico") return CORES[servico];

  // Estável é o requisito: o mesmo host precisa sair na mesma cor em todo card
  // e em toda tela, senão a cor deixa de ser pista. Mesmo hash de `tagColor` e
  // `pickColor` — copiado, e não importado, porque os dois moram em módulos que
  // trazem o SDK do Firestore junto e este aqui é puro.
  const semente = dominioDe(url) || url.trim();
  let h = 0;
  for (let i = 0; i < semente.length; i++) {
    h = (h * 31 + semente.charCodeAt(i)) >>> 0;
  }
  return LINK_COLORS[h % LINK_COLORS.length];
}

/**
 * O selo do link: o fundo que ele realmente pinta, e a tinta que se lê nele.
 *
 * ISTO NÃO É AJUSTE FINO, É LEGIBILIDADE. O selo é o único lugar do app onde o
 * fundo é cor de MARCA, e marca não pede licença: branco sobre o amarelo do
 * Drive dá 1,7:1, e sobre o do Power BI é pior. O mínimo da WCAG AA para esta
 * letra é 4,5:1 — o monograma tem 14px, e 14px em negrito ainda não conta como
 * "texto grande", que só começa em 18,66px. Fixar `#fff`, como estava, era
 * decidir que três selos não se leem para ninguém.
 *
 * São dois passos, nesta ordem, e o segundo existe porque o primeiro não basta:
 *
 * 1. ESCOLHER A TINTA. Ganha a ponta que contrastar mais — branco ou o
 *    quase-preto. Resolve o Drive (vira 10,2:1) e o Power BI.
 *
 * 2. ESCURECER O FUNDO, quando nem a melhor das duas chega a 4,5:1. Existe uma
 *    faixa no meio onde nenhuma tinta serve, e o vermelho do YouTube cai nela:
 *    4,4:1 com quase-preto, 4,3:1 com branco. Um passo de escurecimento resolve
 *    e não tira o tom — o vermelho continua vermelho, e o teste é quem diz que
 *    chegou. Mexer no FUNDO e não na tinta é o que preserva o reconhecimento:
 *    a marca é a cor, e a cor sobrevive à mudança de brilho.
 *
 * O quase-preto é o `--tx` do tema claro, fixo e não `var(--tx)`: o fundo aqui é
 * o mesmo nos dois temas, e a tinta que se lê sobre amarelo não muda porque a
 * página em volta ficou escura.
 */
const TINTA_CLARA = "#ffffff";
const TINTA_ESCURA = "#1a1a17";
const CONTRASTE_MINIMO = 4.5;

/** Luminância relativa da WCAG. `0` é preto, `1` é branco. */
function luminancia(hex: string): number {
  const h = hex.replace("#", "");
  const cheio =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const canal = (i: number) => {
    const v = parseInt(cheio.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}

function contraste(a: number, b: number): number {
  const [claro, escuro] = a > b ? [a, b] : [b, a];
  return (claro + 0.05) / (escuro + 0.05);
}

/** Multiplica os três canais pelo mesmo fator — o tom fica, o brilho cai. */
function escurecer(hex: string, fator: number): string {
  const h = hex.replace("#", "");
  const canal = (i: number) =>
    Math.round(parseInt(h.slice(i, i + 2), 16) * fator)
      .toString(16)
      .padStart(2, "0");
  return `#${canal(0)}${canal(2)}${canal(4)}`;
}

/** A dupla fundo/tinta do selo, já garantida legível. */
export function seloDoLink(url: string): { fundo: string; tinta: string } {
  let fundo = corDoLink(url);

  // 12 passos de 8% chegam a 37% do brilho original — mais escuro do que
  // qualquer cor da paleta precisa, e um teto que impede laço infinito se
  // alguém cadastrar uma cor inválida amanhã.
  for (let i = 0; i < 12; i++) {
    const lum = luminancia(fundo);
    const claro = contraste(lum, luminancia(TINTA_CLARA));
    const escuro = contraste(lum, luminancia(TINTA_ESCURA));
    const melhor = Math.max(claro, escuro);
    if (melhor >= CONTRASTE_MINIMO) {
      return { fundo, tinta: escuro > claro ? TINTA_ESCURA : TINTA_CLARA };
    }
    fundo = escurecer(fundo, 0.92);
  }
  // Inalcançável com a paleta atual; a saída honesta é a mais escura que dá.
  return { fundo, tinta: TINTA_CLARA };
}

/**
 * Uma ou duas letras para o selo do link.
 *
 * Do PRIMEIRO RÓTULO do domínio, não do começo da string: crua, ela daria "HT"
 * em todo link (de `https`) e "WW" em todo `www.` — dois monogramas que não
 * distinguem nada de nada.
 */
export function monogramaDe(url: string): string {
  const dom = dominioDe(url);
  const base = dom ? dom.split(".")[0] : url.trim();
  const letras = base.replace(/[^a-z0-9]/gi, "");
  return letras.slice(0, 2).toUpperCase() || "?";
}

/**
 * O que a tela escreve no link.
 *
 * O domínio antes da URL crua porque "drive.google.com" responde à pergunta que
 * a lista faz ("de onde é isto?") em 15 caracteres, e a URL do Drive gasta 90
 * para responder pior.
 */
export function rotuloDoLink(l: CardLink): string {
  const t = (l.title ?? "").trim();
  if (t) return t;
  return dominioDe(l.url) || l.url;
}

/**
 * Se a URL já está na lista.
 *
 * Compara NORMALIZADO dos dois lados: quem cola de novo o mesmo endereço
 * raramente cola do mesmo jeito — vem sem `https://` na segunda vez, ou com a
 * barra final que o navegador acrescentou. Comparar texto cru deixaria os dois
 * entrarem, e a lista passaria a ter o mesmo link duas vezes.
 */
export function jaTem(links: CardLink[], url: string): boolean {
  const alvo = normalizarUrl(url);
  // URL reprovada no portão não "já está" em lugar nenhum. Sem esta guarda,
  // dois inválidos casariam entre si pelo `"" === ""`.
  if (!alvo) return false;
  return links.some((l) => normalizarUrl(l.url) === alvo);
}

/**
 * Id do link, derivado do conteúdo.
 *
 * Nem `crypto.randomUUID` nem `Math.random`. O primeiro não existe igual nos
 * dois lugares onde este módulo roda (o teste no Node, a página no navegador
 * antigo); o segundo, chamado durante o render do React, devolveria um id novo a
 * cada passada — a chave da lista mudaria sozinha e o React remontaria a linha
 * inteira a cada digitação em qualquer campo do modal.
 *
 * Dois hashes de 32 bits, e não um: um só colidiria dentro do mesmo card com
 * probabilidade alta demais para uma lista que a pessoa vê inteira.
 */
export function novoIdLink(url: string, addedAt: number): string {
  // Normalizada na semente: colar "x.com" e "https://x.com/" no mesmo instante
  // é o MESMO link, e o id tem de dizer isso.
  const semente = `${normalizarUrl(url) || url.trim()}|${addedAt}`;
  let a = 0x811c9dc5;
  let b = 0x1b873593;
  for (let i = 0; i < semente.length; i++) {
    const c = semente.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = (Math.imul(b + c, 2654435761) ^ (b >>> 7)) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}
