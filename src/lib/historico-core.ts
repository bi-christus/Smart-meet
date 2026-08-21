/**
 * Histórico da demanda — o que mudou, quando, e por quem.
 *
 * Moradia em módulo puro, como `kanban-columns` e `tags-ref`: aqui não entra o
 * SDK do Firestore, então a regra é testada por `scripts/test-historico.mjs` sem
 * subir nada. Quem escreve no banco é `historico.ts`.
 *
 * O PROBLEMA que isto resolve: até aqui o card guardava só o estado ATUAL. Se
 * a demanda estava com o Ítalo e hoje está com o Kauã, não havia como saber
 * quando passou, nem quem passou — e a pergunta "por que isso mudou de dono na
 * semana da entrega?" não tinha resposta em lugar nenhum do sistema.
 *
 * Três decisões que valem ser lidas antes de mexer:
 *
 * 1. UM EVENTO POR SALVAMENTO, não um por campo. Quem move o card e troca o
 *    responsável no mesmo Salvar fez UMA coisa; virar duas linhas na timeline
 *    esconderia que foram a mesma decisão.
 *
 * 2. `de` e `para` são TEXTO JÁ RESOLVIDO, não e-mail nem id. Mesma filosofia
 *    de `tags-ref`: o usuário pode ser desativado e a coluna renomeada, e o
 *    histórico precisa continuar legível dez meses depois. O nome congelado é o
 *    nome de quando aconteceu — que é exatamente o que a pergunta quer saber.
 *
 * 3. A DESCRIÇÃO não guarda o texto, só o fato de ter mudado. São até 4 mil
 *    caracteres por edição; guardar as duas pontas faria o histórico de uma
 *    demanda pesar mais do que a demanda. O texto atual está no card, a um
 *    clique de distância.
 */

// Módulo puro importando módulo puro: `links-core` também não conhece o SDK, e
// só o que se lê da URL entra aqui — o domínio, para a linha caber na timeline.
// Com extensão, como `recorrencias-core` importa `datas`: quem roda este arquivo
// pelo strip de tipos do Node exige o caminho completo.
import { dominioDe } from "./links-core.ts";

export type CampoRastreado =
  | "titulo"
  | "descricao"
  | "coluna"
  | "responsavel"
  | "solicitante"
  | "setorSolicitante"
  | "prazo"
  | "inicio"
  | "prioridade"
  | "tipo"
  | "tags"
  | "links"
  | "checklist"
  | "dimensao"
  | "subdimensao";

export const CAMPO_ROTULO: Record<CampoRastreado, string> = {
  titulo: "Título",
  descricao: "Descrição",
  coluna: "Etapa",
  responsavel: "Responsável",
  solicitante: "Solicitante",
  setorSolicitante: "Setor solicitante",
  prazo: "Prazo",
  inicio: "Início",
  prioridade: "Prioridade",
  tipo: "Tipo",
  tags: "Tags",
  links: "Links",
  checklist: "Checklist",
  dimensao: "Dimensão",
  subdimensao: "Subdimensão",
};

/** Ordem de leitura da timeline — o que muda o dono e a etapa vem primeiro. */
const ORDEM: CampoRastreado[] = [
  "coluna",
  "responsavel",
  "prazo",
  "inicio",
  "prioridade",
  "titulo",
  "tipo",
  "dimensao",
  "subdimensao",
  "solicitante",
  "setorSolicitante",
  "tags",
  "links",
  "checklist",
  "descricao",
];

export type Mudanca = {
  campo: CampoRastreado;
  /** Como estava. `null` = não havia valor. */
  de: string | null;
  /** Como ficou. `null` = o campo foi esvaziado. */
  para: string | null;
};

export type Acao =
  | "criada"
  | "editada"
  | "movida"
  | "excluida"
  | "restaurada";

export const ACAO_ROTULO: Record<Acao, string> = {
  criada: "abriu a demanda",
  editada: "editou a demanda",
  movida: "arrastou o card",
  excluida: "mandou para a lixeira",
  restaurada: "trouxe de volta da lixeira",
};

/**
 * Ações que viram evento mesmo sem nenhuma mudança de campo.
 *
 * "editada" e "movida" só existem por causa de um par de valores: sem o par não
 * há o que contar, e a linha seria ruído entre as que importam. "criada",
 * "excluida" e "restaurada" são o contrário — o verbo É o fato inteiro. Mandar
 * para a lixeira não tem "de → para" que informe alguma coisa: `deletedAt`
 * saindo de vazio para uma data é o mesmo verbo escrito duas vezes, e ocuparia
 * a linha da timeline com a repetição.
 *
 * Mora aqui, e não no `if` de `anexarEvento`, porque é regra e tem teste. Um
 * verbo novo esquecido nesta lista faz a ação acontecer SEM deixar rastro — o
 * modo de falha mais caro do histórico, porque é o único que a tela não mostra:
 * tudo funciona, e o registro simplesmente não existe.
 */
export function registraSemMudancas(acao: Acao): boolean {
  return acao === "criada" || acao === "excluida" || acao === "restaurada";
}

export type Evento = {
  id: string;
  /** E-mail de quem fez. Cru de propósito: é a chave do avatar e do nome atual. */
  autor: string;
  /** Milissegundos. Vem do relógio do servidor, não do navegador. */
  em: number;
  acao: Acao;
  mudancas: Mudanca[];
};

/** O recorte do card que o histórico enxerga. */
export type EstadoCard = {
  title?: string;
  description?: string;
  columnId?: string;
  assignee?: string | null;
  requester?: string | null;
  requesterSector?: string | null;
  due?: string | null;
  startDate?: string | null;
  priority?: string;
  type?: string;
  /**
   * O NOME da dimensão, não o id — e é o ponto inteiro destes dois campos.
   *
   * O histórico guarda texto congelado: o que se lê na timeline é o nome de
   * quando aconteceu, não um id resolvido na hora de exibir (o cabeçalho deste
   * arquivo explica por quê). Guardar o id aqui faria a timeline escrever
   * "Dimensão: de abc123 para xyz789" no dia em que o cadastro fosse renomeado
   * ou apagado.
   *
   * Quem traduz id → nome é o MODAL, que já tem o cadastro carregado para
   * desenhar o seletor. É por isso que `Rotulos` não ganhou um resolvedor novo:
   * ele obrigaria as três telas que montam rótulos — inclusive o Cronograma,
   * que atravessa vários setores — a assinar o cadastro de dimensões de todos
   * eles para registrar um campo que nenhuma delas edita.
   *
   * Ausente nos dois lados = nada mudou, que é a resposta certa para quem editou
   * a demanda por uma tela que não mexe em dimensão.
   */
  dimensaoNome?: string | null;
  subdimensaoNome?: string | null;
  tags?: string[];
  /** Só a URL: é por ela que o diff compara, e o resto do link não é notícia. */
  links?: { url: string }[];
  checklist?: { done?: boolean }[];
};

/**
 * Como transformar um id em nome de gente.
 *
 * Fica fora do módulo: quem sabe o nome do responsável é a tela, que tem a lista
 * de usuários assinada. Passar as funções mantém a regra pura e testável com
 * dublês.
 */
export type Rotulos = {
  pessoa: (email: string) => string;
  coluna: (colId: string) => string;
  prioridade: (p: string) => string;
  tipo: (t: string) => string;
};

/** aaaa-mm-dd → dd/mm/aaaa. Qualquer outra coisa passa reto. */
export function dataBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Vazio é vazio: `undefined`, `null` e `""` viram todos `null`. */
function ou0(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** Rótulo do valor, ou `null` quando não há valor para rotular. */
function rotular(
  v: string | null | undefined,
  f: (x: string) => string,
): string | null {
  const t = ou0(v);
  return t === null ? null : f(t) || t;
}

function contarFeitos(lista?: { done?: boolean }[]): string {
  const itens = lista ?? [];
  return `${itens.filter((i) => i.done).length}/${itens.length}`;
}

/**
 * O que mudou entre dois estados do card.
 *
 * Só os campos que respondem a "quem mexeu e o que aconteceu". `order`, `rev` e
 * `enteredAt` mudam junto com a etapa e não dizem nada sozinhos; `comments` tem
 * a própria trilha, com autor e data, dentro do card.
 *
 * Devolve lista VAZIA quando nada relevante mudou — e nesse caso quem chama não
 * grava evento nenhum. Reordenar a checklist sem concluir nada, por exemplo, é
 * uma escrita no card que não vira linha na timeline: seria ruído entre as
 * linhas que importam.
 */
export function diffCard(
  antes: EstadoCard,
  depois: EstadoCard,
  r: Rotulos,
): Mudanca[] {
  const out: Partial<Record<CampoRastreado, Mudanca>> = {};

  const par = (
    campo: CampoRastreado,
    de: string | null,
    para: string | null,
  ) => {
    if (de !== para) out[campo] = { campo, de, para };
  };

  par("titulo", ou0(antes.title), ou0(depois.title));
  par(
    "coluna",
    rotular(antes.columnId, r.coluna),
    rotular(depois.columnId, r.coluna),
  );
  par(
    "responsavel",
    rotular(antes.assignee, r.pessoa),
    rotular(depois.assignee, r.pessoa),
  );
  par("solicitante", ou0(antes.requester), ou0(depois.requester));
  par(
    "setorSolicitante",
    ou0(antes.requesterSector),
    ou0(depois.requesterSector),
  );
  par(
    "prazo",
    rotular(antes.due, dataBR),
    rotular(depois.due, dataBR),
  );
  par(
    "inicio",
    rotular(antes.startDate, dataBR),
    rotular(depois.startDate, dataBR),
  );
  par(
    "prioridade",
    rotular(antes.priority, r.prioridade),
    rotular(depois.priority, r.prioridade),
  );
  par("tipo", rotular(antes.type, r.tipo), rotular(depois.type, r.tipo));
  par("dimensao", ou0(antes.dimensaoNome), ou0(depois.dimensaoNome));
  par("subdimensao", ou0(antes.subdimensaoNome), ou0(depois.subdimensaoNome));

  // Descrição: só o fato. Ver o cabeçalho do arquivo.
  if (ou0(antes.description) !== ou0(depois.description)) {
    out.descricao = { campo: "descricao", de: null, para: null };
  }

  // Tags: o que entrou e o que saiu, não a lista inteira duas vezes. Uma lista
  // de oito tags repetida a cada edição não deixa ver qual foi a que mudou.
  const tagsAntes = antes.tags ?? [];
  const tagsDepois = depois.tags ?? [];
  const saiu = tagsAntes.filter((t) => !tagsDepois.includes(t));
  const entrou = tagsDepois.filter((t) => !tagsAntes.includes(t));
  if (saiu.length || entrou.length) {
    out.tags = {
      campo: "tags",
      de: saiu.length ? saiu.join(", ") : null,
      para: entrou.length ? entrou.join(", ") : null,
    };
  }

  // Links: mesmo molde das tags, e pelo mesmo motivo — o que entrou e o que
  // saiu. Mas mostrando o DOMÍNIO, não a URL: uma do Drive tem 90 caracteres, e
  // três delas numa linha só transformariam a timeline em parede de texto.
  // A comparação é por URL, não pelo objeto: renomear o título de um link é
  // arrumação, não mudança de para onde a demanda aponta.
  const urlsAntes = (antes.links ?? []).map((l) => l.url);
  const urlsDepois = (depois.links ?? []).map((l) => l.url);
  const linksSairam = urlsAntes.filter((u) => !urlsDepois.includes(u));
  const linksEntraram = urlsDepois.filter((u) => !urlsAntes.includes(u));
  if (linksSairam.length || linksEntraram.length) {
    const legivel = (lista: string[]) =>
      lista.map((u) => dominioDe(u) || u).join(", ");
    out.links = {
      campo: "links",
      de: linksSairam.length ? legivel(linksSairam) : null,
      para: linksEntraram.length ? legivel(linksEntraram) : null,
    };
  }

  // Checklist: o placar. Concluir um item é o progresso que o quadro cobra;
  // corrigir a redação de um item não é notícia.
  const placarAntes = contarFeitos(antes.checklist);
  const placarDepois = contarFeitos(depois.checklist);
  if (placarAntes !== placarDepois) {
    out.checklist = { campo: "checklist", de: placarAntes, para: placarDepois };
  }

  return ORDEM.map((c) => out[c]).filter((m): m is Mudanca => !!m);
}

/**
 * O que a linha de criação mostra.
 *
 * Só o que RESPONDE POR ALGUÉM e muda ao longo da vida da demanda. Título,
 * descrição, tipo e tags também existem no primeiro dia, mas são o conteúdo da
 * demanda — estão no card, a um clique, e repeti-los aqui empurraria para
 * baixo a única coisa que a linha de criação tem de dizer: com quem ela nasceu
 * e para quando.
 */
const CAMPOS_NA_CRIACAO: CampoRastreado[] = [
  "coluna",
  "responsavel",
  "inicio",
  "prazo",
  "prioridade",
];

/**
 * O estado inicial como lista de mudanças, para o evento de criação.
 *
 * Sem isto a primeira linha da timeline seria só "abriu a demanda", e a
 * pergunta mais comum — "com quem ela nasceu?" — continuaria sem resposta.
 * Vem do mesmo `diffCard`, contra um card vazio: um formato só para a tela
 * desenhar, e uma regra só para manter.
 */
export function mudancasIniciais(card: EstadoCard, r: Rotulos): Mudanca[] {
  return diffCard({}, card, r).filter((m) =>
    CAMPOS_NA_CRIACAO.includes(m.campo),
  );
}

/** Uma linha de mudança pronta para a tela desenhar. */
export type LinhaMudanca = {
  rotulo: string;
  /** Preenchidos juntos: é o par "era isto → virou aquilo". */
  de: string | null;
  para: string | null;
  /** Quando a mudança não é um par de valores, o que dizer no lugar. */
  nota: string | null;
};

/**
 * Traduz uma mudança para o que se lê na timeline.
 *
 * Fica aqui, e não no JSX, porque é regra: "tags" e "links" não têm par de
 * valores, têm entrada e saída; "descrição" não tem valor nenhum. Escondido no
 * componente, isso não teria teste.
 */
export function linhaDaMudanca(m: Mudanca): LinhaMudanca {
  const rotulo = CAMPO_ROTULO[m.campo];
  if (m.campo === "descricao") {
    return { rotulo, de: null, para: null, nota: "reescrita" };
  }
  if (m.campo === "tags" || m.campo === "links") {
    const partes: string[] = [];
    if (m.para) partes.push(`+ ${m.para}`);
    if (m.de) partes.push(`− ${m.de}`);
    return { rotulo, de: null, para: null, nota: partes.join("   ") };
  }
  return { rotulo, de: m.de, para: m.para, nota: null };
}
