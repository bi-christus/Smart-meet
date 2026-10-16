/**
 * O código de versão das demandas de produto — M0001, C0001 (#242).
 *
 * Módulo puro (AGENTS.md §4), testado em `scripts/test-codigo.mjs`. Quem lê e
 * grava é `kanban.ts`; quem aplica ao histórico é `scripts/migrar-codigos.mjs`.
 *
 * DE ONDE VEIO. Gente do setor já numerava à mão no título ("M0003 - filtro de
 * data", "C012 tela branca"), para poder dizer "a C012 entrou na versão de
 * sexta". Funcionava para quem lembrava de numerar, e a numeração dependia de
 * olhar qual foi o último número usado. Aqui o número vira campo, e sai do
 * título.
 *
 * O QUE GANHA CÓDIGO: demanda ligada a um produto do Portfólio (`produtoId`)
 * cujo tipo é melhoria ou correção. Produto é o "app" — é a ele que a versão
 * pertence. Implementação, relatório e manutenção não entram: não são versão
 * de nada.
 *
 * A SÉRIE É POR PRODUTO E POR CATEGORIA, na ordem em que as demandas nasceram:
 * a primeira melhoria do Painel de Matrículas é M0001 dele, e o Painel de
 * Estoque tem a sua própria M0001. Uma série só para o setor inteiro faria o
 * número dizer quantas demandas o SETOR teve, e não em que ponto do app aquela
 * mudança entrou.
 *
 * O NÚMERO NÃO VOLTA. Demanda excluída continua dona do seu código, e a
 * próxima pega o seguinte. Reaproveitar faria duas mudanças diferentes do
 * mesmo app terem o mesmo nome em momentos diferentes — que é exatamente o que
 * um código de versão existe para impedir.
 */

export type Prefixo = "M" | "C";

const PREFIXO_DO_TIPO: Record<string, Prefixo> = {
  melhoria: "M",
  correcao: "C",
};

/** Quatro dígitos: um app com dez mil correções tem problemas maiores. */
const DIGITOS = 4;

export function prefixoDoTipo(tipo: string | null | undefined): Prefixo | null {
  return (tipo && PREFIXO_DO_TIPO[tipo]) || null;
}

export function formatarCodigo(prefixo: Prefixo, n: number): string {
  return `${prefixo}${String(n).padStart(DIGITOS, "0")}`;
}

export function lerCodigo(
  codigo: string | null | undefined,
): { prefixo: Prefixo; n: number } | null {
  const m = /^([MC])(\d{1,6})$/.exec((codigo ?? "").trim().toUpperCase());
  if (!m) return null;
  return { prefixo: m[1] as Prefixo, n: Number(m[2]) };
}

/** O recorte do card que a numeração enxerga. */
export type CardCodigo = {
  id: string;
  type?: string | null;
  produtoId?: string | null;
  codigo?: string | null;
  /** O produto de quando o código foi dado. Diferente do atual = código velho. */
  codigoProduto?: string | null;
};

/**
 * O código que a tela mostra — ou nenhum.
 *
 * Só vale se ainda bate com o card: mesmo produto e mesma categoria de quando
 * foi dado. Uma melhoria que virou relatório, ou que trocou de produto, guarda
 * o campo (o número não volta), mas não o exibe — "M0004" num relatório diria
 * que aquilo é versão de um app que já não é o dele.
 */
export function codigoVisivel(c: CardCodigo): string | null {
  const lido = lerCodigo(c.codigo);
  if (!lido || !c.produtoId) return null;
  if (lido.prefixo !== prefixoDoTipo(c.type)) return null;
  if ((c.codigoProduto ?? null) !== c.produtoId) return null;
  return formatarCodigo(lido.prefixo, lido.n);
}

/**
 * A série de que este card precisa de um código novo, ou `null`.
 *
 * `null` quando não se qualifica (sem produto, tipo fora da lista) ou quando
 * já tem o código certo. Trocar de categoria ou de produto pede código novo na
 * série nova; o antigo fica gravado e para de aparecer (`codigoVisivel`).
 */
export function precisaDeCodigo(c: CardCodigo): Prefixo | null {
  const prefixo = prefixoDoTipo(c.type);
  if (!prefixo || !c.produtoId) return null;
  return codigoVisivel(c) ? null : prefixo;
}

/**
 * O próximo número da série, olhando TODOS os cards do produto — os da
 * lixeira inclusive, porque o número não volta. Conta tanto o código atual
 * quanto os que ficaram para trás numa troca de categoria: a C0007 que virou
 * melhoria continua dona do 7 na série C.
 */
export function proximoNumero(
  cards: CardCodigo[],
  produtoId: string,
  prefixo: Prefixo,
): number {
  let max = 0;
  for (const c of cards) {
    if ((c.codigoProduto ?? c.produtoId) !== produtoId) continue;
    const lido = lerCodigo(c.codigo);
    if (lido && lido.prefixo === prefixo && lido.n > max) max = lido.n;
  }
  return max + 1;
}

/**
 * Tira do título o código que alguém escreveu à mão.
 *
 * Só no COMEÇO ou no FIM do título, e só com o formato de código: letra M ou
 * C, TRÊS dígitos ou mais, e um separador opcional. Três porque é o mínimo que
 * quem numerava à mão usava (C001, M0002), e com um ou dois a regra comeria
 * "sala M3" e "turma C12". No meio da frase nunca: "a M0003 quebrou o C002"
 * é texto sobre códigos, não o código desta demanda. Entre colchetes ou parênteses também vale: "[M0002] Filtro".
 */
export function tirarCodigoDoTitulo(titulo: string): {
  titulo: string;
  achado: { prefixo: Prefixo; n: number } | null;
} {
  const t = titulo.trim();
  const inicio =
    /^[[(]?\s*([MmCc])\s?-?\s?(\d{3,6})(?![\p{L}\d])\s*[\])]?\s*(?:[-–—:|.]\s*)?(?=\S)/u.exec(t);
  if (inicio) {
    return {
      titulo: t.slice(inicio[0].length).trim(),
      achado: { prefixo: inicio[1].toUpperCase() as Prefixo, n: Number(inicio[2]) },
    };
  }
  const fim = /(?<=\S)\s*(?:[-–—:|]\s*)?(?<![\p{L}\d])[[(]?\s*([MmCc])\s?-?\s?(\d{3,6})\s*[\])]?$/u.exec(t);
  if (fim) {
    return {
      titulo: t.slice(0, fim.index).trim(),
      achado: { prefixo: fim[1].toUpperCase() as Prefixo, n: Number(fim[2]) },
    };
  }
  return { titulo: t, achado: null };
}

/** O recorte do card que a migração lê. */
export type CardMigracao = CardCodigo & {
  title: string;
  sector: string;
  /** Milissegundos de criação; 0 = desconhecido (vai para o fim da série). */
  criadoEm: number;
};

export type Alteracao = {
  id: string;
  codigo?: string;
  codigoProduto?: string;
  title?: string;
};

/**
 * O plano de migração do histórico: código para toda demanda que se
 * qualifica, na ordem em que nasceu, e o código manual tirado do título.
 *
 * A NUMERAÇÃO É REFEITA, e não herdada do título. O que estava escrito à mão
 * tinha buracos e repetições (cada pessoa contava do seu jeito), e "na ordem
 * de aparecimento" foi o pedido. O código manual só serve para ser removido.
 *
 * Demanda com código no título mas SEM produto, ou com tipo fora da lista, não
 * é tocada: sem produto não há série a que ela pertença, e tirar o código do
 * título apagaria a única pista de qual era. Ela volta em `semSerie`, para
 * alguém classificar à mão — e uma nova rodada da migração a numera.
 *
 * Idempotente: rodar duas vezes não muda nada na segunda. Card que já tem o
 * código certo mantém o seu, e a série continua dele.
 */
export function planoDeMigracao(cards: CardMigracao[]): {
  alteracoes: Alteracao[];
  semSerie: CardMigracao[];
} {
  const alteracoes = new Map<string, Alteracao>();
  const semSerie: CardMigracao[] = [];
  const mexer = (id: string) => {
    let a = alteracoes.get(id);
    if (!a) alteracoes.set(id, (a = { id }));
    return a;
  };

  for (const c of cards) {
    const { titulo, achado } = tirarCodigoDoTitulo(c.title);
    if (!achado) continue;
    if (!prefixoDoTipo(c.type) || !c.produtoId) {
      semSerie.push(c);
      continue;
    }
    if (titulo && titulo !== c.title) mexer(c.id).title = titulo;
  }

  const ordem = [...cards].sort(
    (a, b) =>
      (a.criadoEm || Infinity) - (b.criadoEm || Infinity) ||
      a.id.localeCompare(b.id),
  );
  // Os já numerados entram primeiro na conta, para a série continuar deles.
  const vistos: CardCodigo[] = cards.filter((c) => lerCodigo(c.codigo));
  for (const c of ordem) {
    const prefixo = precisaDeCodigo(c);
    if (!prefixo) continue;
    const n = proximoNumero(vistos, c.produtoId!, prefixo);
    const codigo = formatarCodigo(prefixo, n);
    const a = mexer(c.id);
    a.codigo = codigo;
    a.codigoProduto = c.produtoId!;
    vistos.push({ ...c, codigo, codigoProduto: c.produtoId });
  }

  return { alteracoes: [...alteracoes.values()], semSerie };
}
