/**
 * As pastas do Portfólio — a árvore, sem o banco (14/10/2026, #229).
 *
 * Módulo puro (AGENTS.md §4): quem fala com o Firestore é `portfolio-pastas.ts`.
 *
 * DE ONDE ISTO VEIO. O #226 organizou o portfólio em "categoria" e "pasta"
 * escritas à mão no formulário de cada produto. Não havia cadastro: a pasta
 * existia enquanto algum produto tivesse aquele texto, e organizar dez
 * produtos era abrir dez formulários e digitar dez vezes o mesmo nome. O setor
 * pediu o contrário — algo visual, como o explorador do Windows: criar a pasta,
 * dar um ícone a ela e arrastar os produtos para dentro.
 *
 * Por isso a pasta virou DOCUMENTO (`/pastasPortfolio`) com nome, ícone e
 * pasta-mãe, e o produto passou a apontar para ela por `pastaId`. Pasta vazia
 * existe (é assim que se cria uma antes de enchê-la), renomear é gravar UM
 * documento, e subpasta é só `paiId` — sem o teto de dois níveis que
 * categoria/pasta impunha.
 *
 * A ÁRVORE É LIDA COM DESCONFIANÇA. O cliente impede ciclo e pasta-mãe de
 * outro setor, mas o console do Firestore não: toda função que sobe pela
 * árvore para no primeiro ciclo, e pasta cuja mãe não existe (ou é de outro
 * setor) aparece na raiz. Um documento torto não pode sumir com uma pasta
 * inteira nem travar a tela num laço.
 */

/** Teto do nome da pasta. Espelhado em `pastaOk()` das regras. */
export const LIMITE_NOME_PASTA = 40;
/** O nome que a pasta nova recebe, como o "Nova pasta" do Windows. */
export const NOME_PASTA_NOVA = "Nova pasta";

export type PastaDoPortfolio = {
  id: string;
  /** Setor dono — a chave do escopo nas regras, como no produto. */
  setor: string;
  nome: string;
  /** O ícone do catálogo de `icones-core`. Ausente = a pasta de sempre. */
  icone?: string;
  /** A pasta-mãe. `null` = na raiz do portfólio. */
  paiId: string | null;
  createdBy: string;
  createdAt: number | null;
  updatedBy?: string;
  updatedAt?: number | null;
};

/** O mínimo de um produto que a árvore precisa conhecer. */
type ComPasta = { id: string; setor: string; pastaId?: string };

const TEM_CONTEUDO = /[\p{L}\p{N}]/u;
/** O alfabeto de id do Firestore — o mesmo que a regra confere em `paiId`/`pastaId`. */
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

export function ehIdDePasta(v: unknown): v is string {
  return typeof v === "string" && ID_OK.test(v);
}

/** O nome cabe e diz alguma coisa? O `motivo` é texto de tela. */
export function conferirNomeDePasta(
  bruto: unknown,
): { ok: true; nome: string } | { ok: false; motivo: string } {
  const nome = typeof bruto === "string" ? bruto.trim() : "";
  if (!nome) return { ok: false, motivo: "Dê um nome à pasta." };
  if (!TEM_CONTEUDO.test(nome)) {
    return { ok: false, motivo: "O nome precisa ter pelo menos uma letra ou um número." };
  }
  if (nome.length > LIMITE_NOME_PASTA) {
    return { ok: false, motivo: `O nome passa de ${LIMITE_NOME_PASTA} caracteres.` };
  }
  return { ok: true, nome };
}

function chave(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR");
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function instante(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * O documento lido, ou `null`. Mesma postura de `normalizarLinkDoSetor`: o
 * ilegível some sozinho, sem levar a lista. Nome torto vira "Pasta sem nome"
 * em vez de sumir — sumir esconderia os produtos que estão dentro dela.
 */
export function normalizarPasta(id: string, bruto: unknown): PastaDoPortfolio | null {
  if (!bruto || typeof bruto !== "object") return null;
  const d = bruto as Record<string, unknown>;
  const setor = texto(d.setor);
  if (!setor) return null;
  const r = conferirNomeDePasta(d.nome);
  const pasta: PastaDoPortfolio = {
    id,
    setor,
    nome: r.ok ? r.nome : "Pasta sem nome",
    paiId: ehIdDePasta(d.paiId) && d.paiId !== id ? d.paiId : null,
    createdBy: texto(d.createdBy),
    createdAt: instante(d.createdAt),
  };
  const icone = texto(d.icone);
  if (icone) pasta.icone = icone;
  const updatedBy = texto(d.updatedBy);
  if (updatedBy) pasta.updatedBy = updatedBy;
  if (d.updatedAt !== undefined) pasta.updatedAt = instante(d.updatedAt);
  return pasta;
}

/**
 * Ordem do explorador: pelo nome, sem caixa nem acento, e com número em ordem
 * de número ("Pasta 2" antes de "Pasta 10"), como o Windows ordena.
 */
export function compararNomesDePasta(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
}

/**
 * A árvore de um setor, já saneada: a mãe que não existe no setor (apagada,
 * ou de outro setor pelo console) e a que fecha um ciclo viram raiz.
 *
 * É ESTA a lista que as outras funções recebem. Saneando uma vez aqui, nenhuma
 * delas precisa repetir a desconfiança.
 */
export function arvoreDoSetor(
  pastas: readonly PastaDoPortfolio[],
  setor: string,
): PastaDoPortfolio[] {
  const doSetor = pastas
    .filter((p) => p.setor === setor)
    .map((p) => (p.paiId !== null && !pastas.some((m) => m.id === p.paiId && m.setor === setor) ? { ...p, paiId: null } : p));
  const porId = new Map(doSetor.map((p) => [p.id, p]));
  /**
   * Sobe a partir da mãe: se voltar à própria pasta, ela FAZ PARTE de um
   * ciclo. Só essas vão para a raiz — a filha de uma pasta do ciclo continua
   * dentro dela, porque depois de o ciclo ser desfeito o caminho dela termina.
   * O teto de passos é o tamanho da árvore: mais que isso, só andando em
   * círculo (por um ciclo do qual ela não faz parte).
   */
  const noCiclo = (p: PastaDoPortfolio) => {
    let atual: string | null = p.paiId;
    for (let passos = 0; atual !== null && passos <= doSetor.length; passos++) {
      if (atual === p.id) return true;
      atual = porId.get(atual)?.paiId ?? null;
    }
    return false;
  };
  const saneadas = doSetor.map((p) => (noCiclo(p) ? { ...p, paiId: null } : p));
  return saneadas.sort((a, b) => compararNomesDePasta(a.nome, b.nome) || (a.id < b.id ? -1 : 1));
}

/** As pastas que moram diretamente em `paiId` (`null` = raiz), em ordem. */
export function filhasDe(
  arvore: readonly PastaDoPortfolio[],
  paiId: string | null,
): PastaDoPortfolio[] {
  return arvore.filter((p) => p.paiId === paiId);
}

/**
 * O caminho da raiz até a pasta, inclusive — o que o topo do explorador
 * mostra. Pasta que não existe devolve `[]` (a tela cai na raiz).
 */
export function caminhoDe(
  arvore: readonly PastaDoPortfolio[],
  id: string | null,
): PastaDoPortfolio[] {
  if (id === null) return [];
  const porId = new Map(arvore.map((p) => [p.id, p]));
  const caminho: PastaDoPortfolio[] = [];
  let atual = porId.get(id);
  while (atual && caminho.length <= arvore.length) {
    caminho.unshift(atual);
    atual = atual.paiId === null ? undefined : porId.get(atual.paiId);
  }
  return caminho;
}

/** A pasta e todas as que estão dentro dela, em qualquer profundidade. */
export function idsDaSubarvore(
  arvore: readonly PastaDoPortfolio[],
  id: string,
): Set<string> {
  const ids = new Set([id]);
  // Varre até não crescer: a árvore já vem sem ciclo, e assim a ordem da
  // lista não importa.
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const p of arvore) {
      if (p.paiId !== null && ids.has(p.paiId) && !ids.has(p.id)) {
        ids.add(p.id);
        cresceu = true;
      }
    }
  }
  return ids;
}

/**
 * A pasta pode ir para dentro de `destino`? Não pode para dentro de si mesma
 * nem de uma filha — o Windows recusa pelo mesmo motivo: a pasta sumiria da
 * árvore junto com tudo o que tem dentro. Ir para onde já está também é "não":
 * não há o que gravar.
 */
export function podeMoverPasta(
  arvore: readonly PastaDoPortfolio[],
  id: string,
  destino: string | null,
): boolean {
  const pasta = arvore.find((p) => p.id === id);
  if (!pasta || pasta.paiId === destino) return false;
  if (destino === null) return true;
  if (!arvore.some((p) => p.id === destino)) return false;
  return !idsDaSubarvore(arvore, id).has(destino);
}

/**
 * Em que pasta o produto aparece. `pastaId` que não está na árvore (pasta
 * apagada pelo console, ou de outro setor) vira raiz: o produto nunca some.
 */
export function pastaDoProduto(
  arvore: readonly PastaDoPortfolio[],
  produto: { pastaId?: string },
): string | null {
  return produto.pastaId && arvore.some((p) => p.id === produto.pastaId) ? produto.pastaId : null;
}

/**
 * Quantos produtos cada pasta tem, CONTANDO as subpastas — é o número que a
 * árvore e o ícone da pasta mostram, como o "12 itens" de uma pasta fechada.
 */
export function contagemPorPasta(
  arvore: readonly PastaDoPortfolio[],
  produtos: readonly ComPasta[],
): Map<string, number> {
  const diretos = new Map<string, number>();
  for (const l of produtos) {
    const p = pastaDoProduto(arvore, l);
    if (p) diretos.set(p, (diretos.get(p) ?? 0) + 1);
  }
  const total = new Map<string, number>();
  for (const p of arvore) {
    let n = 0;
    for (const id of idsDaSubarvore(arvore, p.id)) n += diretos.get(id) ?? 0;
    total.set(p.id, n);
  }
  return total;
}

/**
 * O nome livre para uma pasta nova entre as irmãs: "Nova pasta", e se já
 * existir, "Nova pasta (2)", "(3)"… — exatamente o que o Windows faz.
 */
export function nomeLivre(
  irmas: readonly { nome: string }[],
  base: string = NOME_PASTA_NOVA,
): string {
  const usados = new Set(irmas.map((p) => chave(p.nome)));
  if (!usados.has(chave(base))) return base;
  for (let n = 2; ; n++) {
    const nome = `${base} (${n})`;
    if (!usados.has(chave(nome))) return nome;
  }
}

/**
 * Já existe uma irmã com este nome? Duas pastas iguais lado a lado obrigam a
 * abrir as duas para saber qual é qual. `ignorarId` é a própria pasta no
 * renomear.
 */
export function nomeRepetido(
  arvore: readonly PastaDoPortfolio[],
  paiId: string | null,
  nome: string,
  ignorarId?: string,
): boolean {
  return filhasDe(arvore, paiId).some((p) => p.id !== ignorarId && chave(p.nome) === chave(nome));
}

/**
 * O que excluir uma pasta faz: as subpastas e os produtos dela sobem para a
 * pasta de cima. NADA É APAGADO além da própria pasta — produto é cadastro de
 * alguém, e sumir com ele por arrumação seria a pior surpresa possível.
 */
export function planoDeExclusao(
  arvore: readonly PastaDoPortfolio[],
  produtos: readonly ComPasta[],
  id: string,
): { destino: string | null; pastas: string[]; produtos: string[] } | null {
  const pasta = arvore.find((p) => p.id === id);
  if (!pasta) return null;
  return {
    destino: pasta.paiId,
    pastas: filhasDe(arvore, id).map((p) => p.id),
    produtos: produtos.filter((l) => pastaDoProduto(arvore, l) === id).map((l) => l.id),
  };
}

/**
 * A organização antiga (#226), por texto: `categoria` e, dentro dela, `pasta`.
 * O plano de conversão diz que pastas criar e onde cada produto vai parar.
 *
 * A categoria vira pasta na raiz, e a pasta vira subpasta dela. Nome que já
 * existe como pasta no mesmo lugar é REAPROVEITADO, e não duplicado: rodar a
 * conversão duas vezes (ou depois de alguém já ter criado "Financeiro" à mão)
 * dá o mesmo resultado.
 *
 * Os ids das pastas novas são provisórios (`novo:0`, `novo:1`…): quem grava
 * troca pelos do Firestore. O módulo puro não sabe gerar id de documento, e
 * nem deveria.
 */
export type PlanoDeConversao = {
  criar: { idProvisorio: string; nome: string; paiId: string | null }[];
  mover: { produtoId: string; pastaId: string | null }[];
};

type ComClassificacaoAntiga = ComPasta & { categoria?: string; pasta?: string };

export function planoDeConversao(
  arvore: readonly PastaDoPortfolio[],
  produtos: readonly ComClassificacaoAntiga[],
): PlanoDeConversao {
  const criar: PlanoDeConversao["criar"] = [];
  const mover: PlanoDeConversao["mover"] = [];
  const achar = (paiId: string | null, nome: string): string => {
    const existente = arvore.find((p) => p.paiId === paiId && chave(p.nome) === chave(nome));
    if (existente) return existente.id;
    const nova = criar.find((c) => c.paiId === paiId && chave(c.nome) === chave(nome));
    if (nova) return nova.idProvisorio;
    const idProvisorio = `novo:${criar.length}`;
    criar.push({ idProvisorio, nome: nome.trim().slice(0, LIMITE_NOME_PASTA), paiId });
    return idProvisorio;
  };
  for (const l of produtos) {
    if (!l.categoria) continue;
    // Produto que JÁ foi posto numa pasta nova não volta para a antiga: a
    // arrumação visual vale mais que o texto que sobrou do #226.
    const jaOrganizado = pastaDoProduto(arvore, l) !== null;
    if (jaOrganizado) {
      mover.push({ produtoId: l.id, pastaId: l.pastaId as string });
      continue;
    }
    const cat = achar(null, l.categoria);
    mover.push({ produtoId: l.id, pastaId: l.pasta ? achar(cat, l.pasta) : cat });
  }
  return { criar, mover };
}

function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** O caminho escrito ("Financeiro › Painéis"), ou `""` na raiz. */
export function caminhoEscrito(arvore: readonly PastaDoPortfolio[], id: string | null): string {
  return caminhoDe(arvore, id)
    .map((p) => p.nome)
    .join(" › ");
}

/** A pasta casa com a busca pelo nome — como no Windows, só o nome. */
export function pastaCasaBusca(pasta: PastaDoPortfolio, busca: string): boolean {
  const q = semAcento(busca.trim());
  return !!q && semAcento(pasta.nome).includes(q);
}
