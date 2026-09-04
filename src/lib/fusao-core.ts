/**
 * Duas demandas que são a mesma viram uma: quem pode fundir com quem, o que se
 * escolhe, e o que o resultado guarda.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * escreve é `kanban.ts`, num lote só; quem desenha é o quadro.
 *
 * O PROBLEMA. A mesma coisa entra no quadro duas vezes — pela reunião, pela ata
 * e pela mão de alguém. O conserto até aqui era copiar o conteúdo de um card no
 * outro e excluir o primeiro, o que perde checklist, comentários, links e o
 * histórico inteiro.
 *
 * A REGRA DE QUEM FUNDE COM QUEM são três campos, e eles são três porque são os
 * que o resultado PRESERVA: solicitante, setor solicitante e responsável. Não é
 * uma trava de segurança — é a definição de "estas duas são a mesma demanda".
 * Duas coisas pedidas por pessoas diferentes não são a mesma coisa dita duas
 * vezes; são duas coisas.
 *
 * CAMPO VAZIO COMBINA COM QUALQUER VALOR, e o resultado herda o preenchido.
 * Decidido com o Ítalo em 04/09/2026, e o motivo é concreto: card nascido da ata
 * nasce SEM RESPONSÁVEL, e são justamente esses os que mais duplicam. Igualdade
 * estrita bloquearia a fusão exatamente onde ela é mais necessária.
 *
 * O QUE NÃO SE ESCOLHE: nada que seja acúmulo. Checklist, comentários, links,
 * tags e proveniência entram por UNIÃO, sem perguntar. Perguntar "quais
 * comentários você quer manter?" é oferecer a alguém a chance de apagar a fala
 * de outra pessoa numa tela de arrumação — e a resposta certa é sempre "todos".
 */

import { chaveDeTag, normalizarTag } from "./tags-core.ts";
import { normalizarUrl } from "./links-core.ts";

// ---------------------------------------------------------------------------
// O que este módulo enxerga de um card
// ---------------------------------------------------------------------------

export type ItemDeChecklist = {
  id?: string;
  text: string;
  done: boolean;
  desc?: string;
};

export type ComentarioDaFusao = {
  id?: string;
  author: string;
  text: string;
  at: number;
  editedAt?: number;
};

export type LinkDaFusao = {
  id?: string;
  url: string;
  [k: string]: unknown;
};

export type TagRefDaFusao = { tipo: string; id: string; texto: string };

export type CardParaFundir = {
  id: string;
  sector: string;
  columnId: string;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  assignee?: string | null;
  requester?: string | null;
  requesterSector?: string | null;
  dimensaoId?: string | null;
  subdimensaoId?: string | null;
  startDate?: string | null;
  due?: string | null;
  tags?: string[];
  tagRefs?: TagRefDaFusao[];
  checklist?: ItemDeChecklist[];
  links?: LinkDaFusao[];
  comments?: ComentarioDaFusao[];
  meetingIds?: string[];
  ataId?: string;
  deletedAt?: number | null;
};

// ---------------------------------------------------------------------------
// Quem funde com quem
// ---------------------------------------------------------------------------

function texto(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Dois valores do mesmo campo são compatíveis para a fusão?
 *
 * Iguais, ou um deles vazio. Comparação sem caixa porque `requester` e
 * `requesterSector` são nomes escolhidos de uma lista, mas a lista já teve
 * grafias divergentes — e recusar a fusão por causa de um "B.I." contra "b.i."
 * seria recusar por um motivo que ninguém consegue enxergar na tela.
 */
function combinam(a: unknown, b: unknown): boolean {
  const x = texto(a).toLowerCase();
  const y = texto(b).toLowerCase();
  return !x || !y || x === y;
}

/** O valor que sobrevive: o preenchido, e o do vencedor no empate. */
function herdado(doVencedor: unknown, doPerdido: unknown): string | null {
  return texto(doVencedor) || texto(doPerdido) || null;
}

export type Veredito = { ok: true } | { ok: false; motivo: string };

/**
 * Estas duas demandas podem virar uma?
 *
 * O motivo sai em português e pronto para a tela: ele é mostrado ANTES de
 * qualquer soltura, no card que recusa a fusão. Recusa sem motivo, num gesto de
 * arrastar, é o mesmo que recusa sem aviso — a pessoa tenta de novo achando que
 * errou a mira.
 */
export function podemFundir(a: CardParaFundir, b: CardParaFundir): Veredito {
  if (a.id === b.id)
    return { ok: false, motivo: "É a mesma demanda." };
  if (a.sector !== b.sector)
    return {
      ok: false,
      motivo: `Uma é de ${a.sector} e a outra de ${b.sector}. Mude o setor de uma delas primeiro.`,
    };
  // Demanda na lixeira não funde, e o motivo não é técnico: fundir com uma
  // demanda excluída faria o conteúdo dela ressuscitar dentro de outra sem
  // ninguém ter restaurado nada — e restaurar é uma decisão de gestor.
  if (a.deletedAt || b.deletedAt)
    return { ok: false, motivo: "Uma delas está na lixeira." };
  if (!combinam(a.requester, b.requester))
    return {
      ok: false,
      motivo: `Solicitantes diferentes: ${texto(a.requester)} e ${texto(b.requester)}.`,
    };
  if (!combinam(a.requesterSector, b.requesterSector))
    return {
      ok: false,
      motivo: `Setores solicitantes diferentes: ${texto(a.requesterSector)} e ${texto(b.requesterSector)}.`,
    };
  if (!combinam(a.assignee, b.assignee))
    return {
      ok: false,
      motivo: "Responsáveis diferentes. Deixe as duas com o mesmo antes de fundir.",
    };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// O que a tela pergunta
// ---------------------------------------------------------------------------

/** Os campos que podem discordar, e sobre os quais alguém precisa decidir. */
export const CAMPOS_ESCOLHIVEIS = [
  "title",
  "description",
  "columnId",
  "type",
  "priority",
  "startDate",
  "due",
  "dimensao",
] as const;
export type CampoEscolhivel = (typeof CAMPOS_ESCOLHIVEIS)[number];

export const CAMPO_DA_FUSAO_ROTULO: Record<CampoEscolhivel, string> = {
  title: "Título",
  description: "Descrição",
  columnId: "Etapa",
  type: "Tipo",
  priority: "Prioridade",
  startDate: "Início",
  due: "Prazo",
  dimensao: "Dimensão",
};

/**
 * Em que os dois discordam de verdade.
 *
 * CAMPO EM QUE OS DOIS CONCORDAM NÃO VIRA PERGUNTA. Perguntar o que não tem duas
 * respostas é como se ensina a clicar em "ok" sem ler — e a partir daí a tela
 * inteira deixa de ser lida, inclusive as perguntas que importavam.
 *
 * Campo vazio dos dois lados também não é conflito: não há o que escolher entre
 * nada e nada.
 *
 * `dimensao` conta os dois ids juntos porque eles são um endereço só: escolher a
 * dimensão de um card e a subdimensão do outro produziria um par que não existe
 * na árvore de setor nenhum.
 */
export function camposEmConflito(
  a: CardParaFundir,
  b: CardParaFundir,
): CampoEscolhivel[] {
  const out: CampoEscolhivel[] = [];
  const difere = (x: unknown, y: unknown) => {
    const p = texto(x);
    const q = texto(y);
    return !!(p || q) && p !== q;
  };
  if (difere(a.title, b.title)) out.push("title");
  if (difere(a.description, b.description)) out.push("description");
  if (difere(a.columnId, b.columnId)) out.push("columnId");
  if (difere(a.type, b.type)) out.push("type");
  if (difere(a.priority, b.priority)) out.push("priority");
  if (difere(a.startDate, b.startDate)) out.push("startDate");
  if (difere(a.due, b.due)) out.push("due");
  if (
    difere(a.dimensaoId, b.dimensaoId) ||
    difere(a.subdimensaoId, b.subdimensaoId)
  )
    out.push("dimensao");
  return out;
}

/** De quem fica o valor. `"juntar"` só existe para a descrição. */
export type Lado = "vencedor" | "perdido";
export type EscolhaDeDescricao = Lado | "juntar";

export type Escolhas = {
  title: Lado;
  description: EscolhaDeDescricao;
  columnId: Lado;
  type: Lado;
  priority: Lado;
  startDate: Lado;
  due: Lado;
  dimensao: Lado;
};

/**
 * Como o diálogo abre.
 *
 * TUDO NO VENCEDOR, menos a descrição, que abre em `"juntar"` quando os dois
 * lados escreveram alguma coisa. O padrão de cada campo é o que perde menos: num
 * campo de valor único, escolher é inevitável e o vencedor é o palpite honesto;
 * numa descrição, juntar não perde nada e descartar perde um texto que alguém
 * escreveu. Quem quiser só uma delas troca em um clique — o contrário exigiria
 * descobrir que o texto sumiu.
 *
 * Campo vazio no vencedor e preenchido no perdido abre no PERDIDO: o padrão
 * "vencedor" ali significaria escolher o nada.
 */
export function escolhasIniciais(
  vencedor: CardParaFundir,
  perdido: CardParaFundir,
): Escolhas {
  const lado = (v: unknown, p: unknown): Lado =>
    !texto(v) && texto(p) ? "perdido" : "vencedor";
  return {
    title: lado(vencedor.title, perdido.title),
    description:
      texto(vencedor.description) && texto(perdido.description)
        ? "juntar"
        : lado(vencedor.description, perdido.description),
    columnId: lado(vencedor.columnId, perdido.columnId),
    type: lado(vencedor.type, perdido.type),
    priority: lado(vencedor.priority, perdido.priority),
    startDate: lado(vencedor.startDate, perdido.startDate),
    due: lado(vencedor.due, perdido.due),
    dimensao:
      !vencedor.dimensaoId && perdido.dimensaoId ? "perdido" : "vencedor",
  };
}

// ---------------------------------------------------------------------------
// As uniões
// ---------------------------------------------------------------------------

/**
 * As duas descrições, quando se escolhe juntar.
 *
 * SEPARADAS POR UM TÍTULO, e não emendadas. Dois textos escritos em momentos
 * diferentes, sobre a mesma coisa, colados um no outro viram um parágrafo em que
 * a segunda frase parece continuar a primeira — e quem ler daqui a três meses
 * não terá como saber que são duas vozes. A linha de separação custa duas
 * linhas e responde isso para sempre.
 *
 * Lado vazio não gera separador nenhum: juntar um texto com nada é o texto.
 */
export function juntarDescricoes(a: string, b: string, tituloDoB = ""): string {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!x) return y;
  if (!y) return x;
  const cabeca = tituloDoB
    ? `--- da demanda fundida: ${tituloDoB} ---`
    : "--- da demanda fundida ---";
  return `${x}\n\n${cabeca}\n${y}`;
}

/**
 * As tags das duas, sem repetir.
 *
 * Deduplicadas por `chaveDeTag`, e não por texto: "Compras" e "compras" são a
 * MESMA tag para o filtro do quadro (ver `tags-core`), e mantê-las como duas
 * produziria dois chips iguais no card e partiria a contagem do catálogo em
 * duas metades. A grafia que sobrevive é a do vencedor, porque é o card que
 * fica.
 */
export function unirTags(
  doVencedor: readonly string[] = [],
  doPerdido: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const vistas = new Set<string>();
  for (const bruta of [...doVencedor, ...doPerdido]) {
    const tag = normalizarTag(bruta);
    const chave = chaveDeTag(tag);
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);
    out.push(tag);
  }
  return out;
}

/** As referências de tag que sobrevivem — só as cujo texto ficou nas tags. */
export function unirTagRefs(
  tagsFinais: readonly string[],
  doVencedor: readonly TagRefDaFusao[] = [],
  doPerdido: readonly TagRefDaFusao[] = [],
): TagRefDaFusao[] {
  const chaves = new Set(tagsFinais.map(chaveDeTag));
  const out: TagRefDaFusao[] = [];
  const vistas = new Set<string>();
  for (const r of [...doVencedor, ...doPerdido]) {
    const chave = chaveDeTag(r?.texto ?? "");
    // Referência para uma tag que não sobreviveu à união não tem para quem
    // apontar; e duas referências para o mesmo texto tornariam ambíguo o alvo.
    if (!chave || !chaves.has(chave) || vistas.has(chave)) continue;
    vistas.add(chave);
    out.push(r);
  }
  return out;
}

/** Texto comparável de item de checklist. */
function chaveDeItem(t: string): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Os dois checklists, na ordem: os do vencedor, depois os do perdido.
 *
 * Deduplicado pelo texto normalizado, e o item do VENCEDOR fica — mas o `done`
 * é o OU dos dois. Se um lado marcou "Cotar com dois fornecedores" e o outro
 * não, a tarefa foi feita: desmarcá-la mandaria alguém fazer de novo um trabalho
 * que já está pronto, e essa é a única direção do erro que custa trabalho de
 * verdade.
 */
export function unirChecklist(
  doVencedor: readonly ItemDeChecklist[] = [],
  doPerdido: readonly ItemDeChecklist[] = [],
): ItemDeChecklist[] {
  const out: ItemDeChecklist[] = [];
  const porChave = new Map<string, number>();
  for (const item of [...doVencedor, ...doPerdido]) {
    const chave = chaveDeItem(item?.text ?? "");
    if (!chave) continue;
    const i = porChave.get(chave);
    if (i === undefined) {
      porChave.set(chave, out.length);
      out.push({ ...item, done: !!item.done });
    } else if (item.done) {
      out[i] = { ...out[i], done: true };
    }
  }
  return out;
}

/**
 * Os links das duas, deduplicados pela URL normalizada.
 *
 * `normalizarUrl` é a mesma função que a aba Links usa para decidir se um
 * endereço já está no card (`jaTem`). Comparar a URL crua deixaria passar o
 * mesmo endereço com e sem barra no fim, ou com `http` contra `https`.
 */
export function unirLinks(
  doVencedor: readonly LinkDaFusao[] = [],
  doPerdido: readonly LinkDaFusao[] = [],
): LinkDaFusao[] {
  const out: LinkDaFusao[] = [];
  const vistos = new Set<string>();
  for (const l of [...doVencedor, ...doPerdido]) {
    const chave = normalizarUrl(String(l?.url ?? ""));
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(l);
  }
  return out;
}

/**
 * Os comentários das duas, do mais antigo para o mais novo.
 *
 * ORDENADOS POR DATA e não empilhados por card, porque juntos eles voltam a ser
 * uma conversa: alguém perguntou numa demanda e outra pessoa respondeu na
 * outra, e a ordem cronológica é a única em que isso se lê.
 *
 * Deduplicado por autor + instante + texto, que é o caso real de alguém ter
 * colado o mesmo recado nas duas antes de perceber que eram a mesma demanda.
 */
export function unirComentarios(
  doVencedor: readonly ComentarioDaFusao[] = [],
  doPerdido: readonly ComentarioDaFusao[] = [],
): ComentarioDaFusao[] {
  const vistos = new Set<string>();
  return [...doVencedor, ...doPerdido]
    .filter((c) => {
      const chave = `${texto(c?.author)}|${c?.at ?? 0}|${texto(c?.text)}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .sort((x, y) => (x.at ?? 0) - (y.at ?? 0));
}

// ---------------------------------------------------------------------------
// O resultado
// ---------------------------------------------------------------------------

export type ResultadoDaFusao = {
  /** O que se grava no card que fica. */
  patchVencedor: Record<string, unknown>;
  /** O que se grava no card que sai — a marca da lixeira. */
  patchPerdido: { deletedAt: number; deletedBy: string; conclusaoPedida: null };
};

/**
 * O que as duas escritas vão dizer.
 *
 * O CARD QUE PERDE VAI PARA A LIXEIRA, não é apagado. É o padrão do app inteiro
 * — a exclusão aqui sempre foi marca, nunca sumiço (ver `lixeira-core`) — e é o
 * que permite desfazer uma fusão errada: restaurar devolve um card íntegro, com
 * o conteúdo dele intacto, porque nada foi removido de lá. O que foi para o
 * vencedor foi COPIADO.
 *
 * O pedido de conclusão do perdido é cancelado junto: ele apontava para uma
 * demanda que saiu do quadro, e deixá-lo de pé faria um card da lixeira aparecer
 * na contagem de pendências da daily.
 *
 * `agora` e `por` entram por parâmetro — relógio e sessão não moram em módulo
 * puro.
 */
export function resultadoDaFusao(args: {
  vencedor: CardParaFundir;
  perdido: CardParaFundir;
  escolhas: Escolhas;
  por: string;
  agora: number;
}): ResultadoDaFusao {
  const { vencedor: v, perdido: p, escolhas: e, por, agora } = args;

  const de = (lado: Lado) => (lado === "vencedor" ? v : p);

  const tags = unirTags(v.tags, p.tags);

  const dimensaoDe = de(e.dimensao);

  return {
    patchVencedor: {
      title: texto(de(e.title).title) || texto(v.title),
      description:
        e.description === "juntar"
          ? juntarDescricoes(v.description ?? "", p.description ?? "", p.title)
          : (texto(de(e.description).description) || ""),
      columnId: de(e.columnId).columnId || v.columnId,
      type: de(e.type).type ?? v.type ?? null,
      priority: de(e.priority).priority ?? v.priority ?? null,
      startDate: de(e.startDate).startDate ?? null,
      due: de(e.due).due ?? null,
      dimensaoId: dimensaoDe.dimensaoId ?? null,
      subdimensaoId: dimensaoDe.subdimensaoId ?? null,
      // Os três que a regra da fusão preserva. Herdados, e não escolhidos: o
      // vazio de um lado combina com o valor do outro, e é justamente por isso
      // que a fusão foi permitida.
      requester: herdado(v.requester, p.requester),
      requesterSector: herdado(v.requesterSector, p.requesterSector),
      assignee: herdado(v.assignee, p.assignee),
      // Acúmulo: entra tudo, sem perguntar.
      tags,
      tagRefs: unirTagRefs(tags, v.tagRefs, p.tagRefs),
      checklist: unirChecklist(v.checklist, p.checklist),
      links: unirLinks(v.links, p.links),
      comments: unirComentarios(v.comments, p.comments),
      // Proveniência é o que responde "de onde isto saiu?" meses depois. A
      // demanda resultante saiu das duas reuniões, não de uma.
      meetingIds: [...new Set([...(v.meetingIds ?? []), ...(p.meetingIds ?? [])])],
      ...(v.ataId || p.ataId ? { ataId: v.ataId || p.ataId } : {}),
    },
    patchPerdido: {
      deletedAt: agora,
      deletedBy: por,
      conclusaoPedida: null,
    },
  };
}
