/**
 * Os links do setor — o cadastro da aba Links, sem o banco.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * fala com o banco é `links-do-setor.ts`, o irmão, e é isto que permite
 * `scripts/test-links-do-setor.mjs` conferir a régua inteira em Node puro.
 *
 * DE ONDE ISTO VEIO. A aba Links nasceu sem cadastro próprio: ela lia os
 * `links` de dentro dos cards e virava o avesso, um card por link, com o
 * TÍTULO DA DEMANDA em destaque. Usada como catálogo dos aplicativos do setor —
 * o painel do Power BI, a planilha de custos, o sistema da clínica —, isso deu
 * três defeitos que nenhum ajuste de tela resolvia:
 *
 * 1. Para um link aparecer, ele precisava de uma demanda que o hospedasse. Quem
 *    queria só registrar "onde fica o painel de vendas" tinha de abrir um card
 *    de mentira no Kanban.
 * 2. O nome em destaque era o da demanda, não o do aplicativo. "Ajustar filtro
 *    do relatório de março" não diz a ninguém que ali mora o painel de vendas.
 * 3. Não havia onde dizer O QUE é o aplicativo — o campo não existia no link do
 *    card, e a descrição da demanda fala do trabalho, não da ferramenta.
 *
 * Por isso o link da aba virou documento próprio (`/links`), com nome e
 * descrição escritos por quem cadastra. O link de DENTRO da demanda continua
 * onde estava, no modal do card: ele responde "o que esta demanda usa", e é
 * outra pergunta.
 *
 * A URL continua passando pela MESMA régua de `links-core` — `normalizarUrl` é
 * portão de segurança (o valor vai para um `href`), e uma segunda cópia dele
 * aqui seria o primeiro passo para as duas discordarem sobre o que é seguro.
 */
import { dominioDe, normalizarUrl, SERVICO_ROTULO, servicoDe } from "./links-core.ts";
import { LIMITE_FOTO_BYTES, LIMITE_FOTO_CHARS, tamanhoDataUri } from "./avatar-core.ts";

/**
 * O LOGO DO LINK, enviado por quem cadastra (06/10/2026).
 *
 * O ícone deduzido reconhece Drive, Power BI, Planilhas — e devolve o mesmo
 * monograma para todo sistema interno. Para quem procura "o sistema da
 * clínica" numa grade de vinte cards, o que se reconhece de longe é a marca.
 *
 * Mesmo caminho da foto de perfil, e pelos mesmos motivos: o Storage não está
 * ligado (habilitar é ação humana no console, AGENTS.md §6), então o logo é um
 * data URI DENTRO do documento — e por isso tem teto. O teto e o alfabeto são
 * os da foto, sem conversão: a régua em CEL (`fotoOk()`) já foi medida e
 * testada, e `linkOk()` usa os mesmos números. `test-links-do-setor.mjs`
 * reprova se os dois lados se afastarem.
 *
 * Só JPEG e PNG. SVG fica de fora pelo motivo escrito em `fotoOk()`: ele vira
 * `src` de um `<img>` na tela de todo o setor, e SVG carrega script. PNG é o
 * preferido na preparação porque logo costuma ter fundo transparente.
 */
export const LIMITE_LOGO_BYTES = LIMITE_FOTO_BYTES;
export const LIMITE_LOGO_CHARS = LIMITE_FOTO_CHARS;
/** O lado máximo do logo gravado. O selo tem 40 px de CSS; 96 cobre tela 2×. */
export const LADO_LOGO_PX = 96;

const LOGO_ACEITO = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * O logo cabe e é imagem? O `motivo` é texto de tela.
 *
 * O formato vem antes do tamanho, como em `conferirFoto`: um SVG pequeno é o
 * problema grave, e recusá-lo por "grande demais" seria a mensagem errada.
 */
export function conferirLogo(
  uri: unknown,
): { ok: true } | { ok: false; motivo: string } {
  const t = typeof uri === "string" ? uri.trim() : "";
  if (!t) return { ok: false, motivo: "Nenhuma imagem foi escolhida." };
  if (!LOGO_ACEITO.test(t) || t.length > LIMITE_LOGO_CHARS) {
    return {
      ok: false,
      motivo: "Formato não aceito. O logo precisa ser uma imagem JPEG ou PNG.",
    };
  }
  const bytes = tamanhoDataUri(t);
  if (bytes <= 0) return { ok: false, motivo: "A imagem chegou vazia." };
  if (bytes > LIMITE_LOGO_BYTES) {
    return {
      ok: false,
      motivo:
        "Mesmo reduzido, o logo ficou grande demais. Tente uma imagem mais " +
        "simples — só a marca, sem fundo fotográfico.",
    };
  }
  return { ok: true };
}

/**
 * Os tetos dos campos. Espelhados em `linkOk()`, no `firestore.rules`, e
 * `test-links-do-setor.mjs` reprova se as duas cópias se afastarem.
 *
 * Os números contam UNIDADES UTF-16, que é o que `String.length` conta aqui e o
 * que `size()` conta nas regras — a mesma unidade dos dois lados, sem conversão
 * (o mesmo raciocínio que está escrito em `nomeOk()` das regras).
 */
export const LIMITE_NOME_LINK = 80;
export const LIMITE_DESCRICAO_LINK = 300;
export const LIMITE_URL_LINK = 2048;
/** Teto do nome de uma categoria ou de uma pasta (14/10/2026). */
export const LIMITE_CLASSIFICACAO = 40;

export type LinkDoSetor = {
  /** id do documento. */
  id: string;
  /** Setor de execução dono do link — é a chave do escopo nas regras. */
  setor: string;
  nome: string;
  /** `""` quando ninguém escreveu. Nunca `undefined`: a tela testa uma coisa só. */
  descricao: string;
  /** Já passou por `normalizarUrl` na gravação. A tela confere de novo. */
  url: string;
  /** O ícone escolhido. Ausente = deduzido da URL, como no link da demanda. */
  icone?: string;
  /** O logo enviado (data URI JPEG/PNG). Quando existe, vence o ícone no selo. */
  logo?: string;
  /**
   * A organização do portfólio (14/10/2026): categoria e, dentro dela, pasta.
   * Só o ADMIN escreve (a regra de `/links` confere); ausente = sem categoria.
   * Não há cadastro de categorias à parte — a lista é a dos valores em uso, e
   * renomear uma categoria é regravar os produtos dela (`renomearClassificacao`).
   */
  categoria?: string;
  pasta?: string;
  /** E-mail de quem cadastrou. */
  createdBy: string;
  /** Milissegundos; `null` só no instante entre a gravação e o eco do servidor. */
  createdAt: number | null;
  updatedBy?: string;
  updatedAt?: number | null;
};

/** O que o formulário entrega: texto cru, do jeito que foi digitado. */
export type RascunhoDeLink = {
  nome: string;
  descricao: string;
  url: string;
};

export type CampoDoLink = "nome" | "descricao" | "url";

export type LinkConferido =
  | { ok: true; dados: RascunhoDeLink }
  | { ok: false; campo: CampoDoLink; motivo: string };

/**
 * Tem pelo menos uma letra ou um dígito — a mesma pergunta de `nomeOk()` nas
 * regras, e não "sobrou algo depois do trim". O `trim()` do JavaScript apara o
 * espaço inquebrável e o do CEL não; perguntar por letra ou dígito responde
 * igual nas duas linguagens e ainda recusa "...", "-" e o emoji solitário.
 */
const TEM_CONTEUDO = /[\p{L}\p{N}]/u;

/**
 * A régua do formulário, aplicada ANTES do banco.
 *
 * A regra do Firestore é a segunda barreira e só sabe dizer "sem permissão" —
 * a mensagem errada para quem esqueceu o nome ou colou um endereço quebrado. O
 * motivo volta com o CAMPO, para a tela apontar onde está o problema em vez de
 * deixar a pessoa adivinhar qual dos três foi recusado.
 *
 * O nome vem antes do endereço porque é o primeiro campo do formulário: a
 * pessoa corrige de cima para baixo, e apontar o segundo campo com o primeiro
 * ainda vazio a faria subir e descer.
 */
export function conferirLink(bruto: Partial<RascunhoDeLink>): LinkConferido {
  const nome = typeof bruto.nome === "string" ? bruto.nome.trim() : "";
  if (!nome || !TEM_CONTEUDO.test(nome)) {
    return { ok: false, campo: "nome", motivo: "Dê um nome ao produto." };
  }
  if (nome.length > LIMITE_NOME_LINK) {
    return {
      ok: false,
      campo: "nome",
      motivo: `O nome passa de ${LIMITE_NOME_LINK} caracteres.`,
    };
  }

  const urlBruta = typeof bruto.url === "string" ? bruto.url.trim() : "";
  if (!urlBruta) {
    return { ok: false, campo: "url", motivo: "Cole o endereço do produto." };
  }
  const url = normalizarUrl(urlBruta);
  if (!url) {
    return {
      ok: false,
      campo: "url",
      motivo: "Este endereço não é um link http ou https válido.",
    };
  }
  if (url.length > LIMITE_URL_LINK) {
    return {
      ok: false,
      campo: "url",
      motivo: `O endereço passa de ${LIMITE_URL_LINK} caracteres.`,
    };
  }

  const descricao =
    typeof bruto.descricao === "string" ? bruto.descricao.trim() : "";
  if (descricao.length > LIMITE_DESCRICAO_LINK) {
    return {
      ok: false,
      campo: "descricao",
      motivo: `A descrição passa de ${LIMITE_DESCRICAO_LINK} caracteres.`,
    };
  }

  return { ok: true, dados: { nome, descricao, url } };
}

/** Caixa e espaço sobrando não fazem dois nomes diferentes. */
function chaveDeNome(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR");
}

/**
 * O cadastro já tem este link NO MESMO SETOR? Devolve o campo e a frase que a
 * tela mostra — o campo, para o formulário apontar qual dos dois repete.
 *
 * Duas perguntas, nesta ordem:
 *
 * - MESMO ENDEREÇO é a duplicata de verdade: o mesmo painel cadastrado duas
 *   vezes, com nomes diferentes, divide quem procura entre dois cards. Compara
 *   normalizado, pelo motivo de `jaTem` em `links-core`: o segundo cadastro
 *   raramente cola a URL do mesmo jeito que o primeiro.
 * - MESMO NOME com endereço diferente é o caso em que a pessoa lê os dois cards
 *   e não sabe qual abrir. O nome é o que este cadastro existe para dar ao
 *   link; dois iguais no mesmo setor desfazem isso.
 *
 * Só dentro do setor: o B.I. e as Cantinas podem ter cada um o seu
 * "Painel de consumo" sem que um saiba do outro — eles nem se enxergam.
 *
 * `ignorarId` é o próprio link na edição; sem ele, salvar sem mudar nada
 * acusaria o link de ser duplicata de si mesmo.
 *
 * Como em `addSetor`, a conferência é contra a lista que a TELA
 * já tem. Duas pessoas cadastrando o mesmo endereço no mesmo segundo criam dois
 * documentos — e uma transação por causa de um empate que ninguém viu
 * acontecer seria caro demais para um cadastro deste tamanho.
 */
export function conflitoDeLink(
  dados: Pick<RascunhoDeLink, "nome" | "url">,
  setor: string,
  existentes: readonly LinkDoSetor[],
  ignorarId?: string,
): { campo: CampoDoLink; motivo: string } | null {
  const doSetor = existentes.filter((l) => l.setor === setor && l.id !== ignorarId);

  const alvo = normalizarUrl(dados.url);
  if (alvo) {
    const mesmoEndereco = doSetor.find((l) => normalizarUrl(l.url) === alvo);
    if (mesmoEndereco) {
      return {
        campo: "url",
        motivo: `Este endereço já está cadastrado como “${mesmoEndereco.nome}”.`,
      };
    }
  }

  const nome = chaveDeNome(dados.nome);
  const mesmoNome = doSetor.find((l) => chaveDeNome(l.nome) === nome);
  if (mesmoNome) {
    return {
      campo: "nome",
      motivo: `Já existe um produto chamado “${mesmoNome.nome}” neste portfólio.`,
    };
  }
  return null;
}

/** Texto que é texto; qualquer outra coisa vira vazio. */
function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Número finito, ou `null`. */
function instante(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * O documento lido, do jeito que a tela pode confiar — ou `null`.
 *
 * Documento ilegível é DESCARTADO, não derruba a lista: o Firestore aceita
 * escrita pelo console e pelo Admin SDK, que não passam pelas regras, e um
 * único documento torto não pode deixar a aba inteira em branco. É a mesma
 * escolha de `normalizarAta`.
 *
 * O que descarta é o mínimo para o card existir: nome e setor. Endereço
 * inválido NÃO descarta — o card aparece sem abrir nada (a tela confere a URL
 * de novo antes do `href`) e continua editável, que é o único jeito de alguém
 * consertá-lo sem abrir o console.
 *
 * As datas chegam já em milissegundos: converter o `Timestamp` do SDK é tarefa
 * do irmão, que é quem conhece o SDK.
 */
export function normalizarLinkDoSetor(id: string, bruto: unknown): LinkDoSetor | null {
  if (!bruto || typeof bruto !== "object") return null;
  const d = bruto as Record<string, unknown>;
  const nome = texto(d.nome);
  const setor = texto(d.setor);
  if (!nome || !setor) return null;

  const link: LinkDoSetor = {
    id,
    setor,
    nome,
    descricao: texto(d.descricao),
    url: typeof d.url === "string" ? d.url.trim() : "",
    createdBy: texto(d.createdBy),
    createdAt: instante(d.createdAt),
  };
  // A chave só existe quando há valor. `icone: undefined` é diferente de
  // ausente para o SDK do Firestore, e um objeto lido daqui pode voltar numa
  // escrita — é o tropeço que `aplicarIcone` já documenta em `icones-core`.
  const icone = texto(d.icone);
  if (icone) link.icone = icone;
  // O logo vai para o `src` de um `<img>`: a régua roda de novo na LEITURA,
  // porque o console e o Admin SDK escrevem sem passar pela regra. Logo que não
  // passa some do card — o selo volta ao ícone, que é a falha certa.
  if (typeof d.logo === "string" && conferirLogo(d.logo).ok) link.logo = d.logo.trim();
  // Categoria e pasta passam pela mesma régua da gravação: valor torto (vindo
  // do console) vira "sem categoria", que é a falha que não esconde o produto.
  const categoria = texto(d.categoria);
  if (categoria && conferirClassificacao(categoria).ok) link.categoria = categoria;
  const pasta = texto(d.pasta);
  if (link.categoria && pasta && conferirClassificacao(pasta).ok) link.pasta = pasta;
  const updatedBy = texto(d.updatedBy);
  if (updatedBy) link.updatedBy = updatedBy;
  if (d.updatedAt !== undefined) link.updatedAt = instante(d.updatedAt);
  return link;
}

/**
 * A ordem da grade: pelo NOME, em ordem alfabética.
 *
 * A aba antiga ordenava pelo mais recente, porque o card trazia o título de uma
 * demanda e "o link colado hoje" era o que alguém tinha vindo procurar. Num
 * catálogo com nome próprio, a pessoa procura pelo nome — e lista de nomes fora
 * da ordem alfabética obriga a ler a grade inteira para achar um.
 *
 * `sensitivity: "base"` junta caixa e acento ("Ágil" ao lado de "agenda"), e o
 * desempate pelo id garante a mesma ordem em todo render, para dois nomes
 * iguais em setores diferentes não trocarem de lugar sozinhos.
 */
export function ordenarLinks(links: readonly LinkDoSetor[]): LinkDoSetor[] {
  return [...links].sort(
    (a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * A busca da aba: nome, descrição, domínio e o nome do serviço.
 *
 * O serviço entra porque é assim que se procura uma ferramenta sem lembrar o
 * nome que alguém deu a ela: "power bi" acha os painéis do Power BI, mesmo os
 * cadastrados como "Vendas por unidade". Ele já aparece escrito no card, então
 * a busca não promete nada que a tela não mostre.
 *
 * Sem acento e sem caixa dos dois lados: quem digita "manutencao" está
 * procurando "Manutenção", e o teclado do celular nem sempre ajuda.
 */
export function casaBusca(link: LinkDoSetor, busca: string): boolean {
  const q = semAcento(busca.trim());
  if (!q) return true;
  const servico = servicoDe(link.url);
  const campos = [
    link.nome,
    link.descricao,
    // A organização também é procurável: "financeiro" acha a categoria e a
    // pasta inteiras, não só os produtos com a palavra no nome.
    link.categoria ?? "",
    link.pasta ?? "",
    dominioDe(link.url),
    servico === "generico" ? "" : SERVICO_ROTULO[servico],
  ];
  return campos.some((c) => semAcento(c).includes(q));
}

function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Categorias e pastas (14/10/2026)
// ---------------------------------------------------------------------------

/**
 * O nome de uma categoria ou pasta cabe e diz alguma coisa? Vazio é aceito:
 * é "sem categoria" / "fora de pasta". O `motivo` é texto de tela.
 */
export function conferirClassificacao(
  bruto: unknown,
): { ok: true; valor: string } | { ok: false; motivo: string } {
  const valor = typeof bruto === "string" ? bruto.trim() : "";
  if (!valor) return { ok: true, valor: "" };
  if (!TEM_CONTEUDO.test(valor)) {
    return { ok: false, motivo: "O nome precisa ter pelo menos uma letra ou um número." };
  }
  if (valor.length > LIMITE_CLASSIFICACAO) {
    return { ok: false, motivo: `O nome passa de ${LIMITE_CLASSIFICACAO} caracteres.` };
  }
  return { ok: true, valor };
}

/** Uma pasta dentro de uma categoria. `pasta: null` = os produtos soltos na categoria. */
export type GrupoDePasta = { pasta: string | null; links: LinkDoSetor[] };
/** Uma categoria e as pastas dela. `categoria: null` = "Sem categoria". */
export type GrupoDeCategoria = {
  categoria: string | null;
  total: number;
  pastas: GrupoDePasta[];
};

function compararNomes(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

/**
 * A grade organizada: categorias em ordem alfabética, com "Sem categoria" por
 * último; dentro de cada uma, primeiro os produtos soltos e depois as pastas,
 * também em ordem alfabética. Os produtos mantêm a ordem que já tinham
 * (`ordenarLinks`, por nome).
 *
 * Caixa e acento não fazem duas categorias: "Financeiro" e "financeiro" caem
 * juntas, com o rótulo da primeira que aparecer.
 */
export function agruparPorCategoria(links: readonly LinkDoSetor[]): GrupoDeCategoria[] {
  const cats = new Map<string, { rotulo: string | null; pastas: Map<string, GrupoDePasta> }>();
  for (const l of links) {
    const chaveCat = l.categoria ? chaveDeNome(l.categoria) : "";
    let cat = cats.get(chaveCat);
    if (!cat) {
      cat = { rotulo: l.categoria ?? null, pastas: new Map() };
      cats.set(chaveCat, cat);
    }
    const chavePasta = l.pasta ? chaveDeNome(l.pasta) : "";
    let pasta = cat.pastas.get(chavePasta);
    if (!pasta) {
      pasta = { pasta: l.pasta ?? null, links: [] };
      cat.pastas.set(chavePasta, pasta);
    }
    pasta.links.push(l);
  }
  return [...cats.values()]
    .map((c) => {
      const pastas = [...c.pastas.values()].sort((a, b) =>
        a.pasta === null ? -1 : b.pasta === null ? 1 : compararNomes(a.pasta, b.pasta),
      );
      return {
        categoria: c.rotulo,
        total: pastas.reduce((n, p) => n + p.links.length, 0),
        pastas,
      };
    })
    .sort((a, b) =>
      a.categoria === null ? 1 : b.categoria === null ? -1 : compararNomes(a.categoria, b.categoria),
    );
}

/**
 * As categorias em uso, e as pastas de cada uma — as sugestões do formulário
 * do admin. Sem repetição de caixa ou acento, em ordem alfabética.
 */
export function classificacoesEmUso(
  links: readonly LinkDoSetor[],
): { categorias: string[]; pastasDe: (categoria: string) => string[] } {
  const grupos = agruparPorCategoria(links).filter((g) => g.categoria !== null);
  const categorias = grupos.map((g) => g.categoria as string);
  return {
    categorias,
    pastasDe: (categoria) => {
      const g = grupos.find((x) => chaveDeNome(x.categoria as string) === chaveDeNome(categoria));
      return g ? g.pastas.flatMap((p) => (p.pasta ? [p.pasta] : [])) : [];
    },
  };
}

/** O mesmo nome de categoria ou pasta, sem olhar caixa nem espaço sobrando. */
export function mesmaClassificacao(a: string | undefined | null, b: string | undefined | null): boolean {
  return chaveDeNome(a ?? "") === chaveDeNome(b ?? "");
}
