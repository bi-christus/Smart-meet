/**
 * Tags do quadro: como nascem, como não se multiplicam, e como se filtra por elas.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * escreve no banco é `kanban.ts`; quem desenha é a página do Kanban e o modal
 * do card. É isto que permite `scripts/test-tags.mjs` rodar a decisão inteira em
 * Node puro — e a decisão aqui merece teste, porque ela erra em silêncio: uma
 * tag a mais no catálogo não quebra nada, só faz a busca por ela encontrar
 * metade das demandas, para sempre, sem mensagem nenhuma.
 *
 * NÃO CONFUNDIR COM `tags-ref.ts`. Aquele trata da tag que APONTA para outra
 * coisa (uma demanda, um setor) e do que acontece quando o alvo é renomeado.
 * Este trata da tag como PALAVRA: qual grafia vale, quais duas grafias são a
 * mesma coisa, e o que casa com o que na hora de filtrar. Os dois se encontram
 * no card e em nenhum outro lugar.
 *
 * O QUE FOI EMPRESTADO DO OBSIDIAN, e por quê. O ecossistema de gestão de tags
 * de lá resolveu este problema antes, e três ideias se aplicam inteiras:
 *
 *   1. UMA TAG É UM TOKEN, não uma frase. Sem "#" na frente, sem espaço no
 *      começo nem no fim, sem dois espaços no meio. Grafia livre é o que faz
 *      "Portal ", "portal" e "#Portal" virarem três entradas no catálogo.
 *   2. TAG TEM HIERARQUIA, pela barra: `cantinas/estoque` é filha de
 *      `cantinas`. Filtrar pela mãe traz as filhas. É o que impede o catálogo
 *      de virar uma lista plana de setenta palavras soltas — o motivo pelo qual
 *      todo mundo abandona tag depois do terceiro mês.
 *   3. TAG PARECIDA É AVISADA NA HORA DA CRIAÇÃO. É o que o Tag Wrangler faz
 *      depois do estrago (renomeia e funde em massa); aqui a aposta é antes,
 *      porque fundir tag exige escrever em todos os cards e este app não tem
 *      tela para isso. Avisar custa uma linha embaixo do campo; consertar
 *      custaria uma migração.
 *
 * O QUE NÃO FOI EMPRESTADO: recusar a tag parecida. O aviso oferece a existente
 * e segue o jogo. "Compras" e "Compra" PODEM ser coisas diferentes num setor
 * que ninguém aqui conhece, e um cadastro que recusa o que o usuário sabe ser
 * certo ensina a contornar o cadastro — que é como se ganha "Compras2".
 */

/** Quanto cabe numa tag. Acima disso ela deixa de caber no chip do card. */
export const LIMITE_TAG_CHARS = 40;

/**
 * Texto comparável: sem acento, em minúsculas.
 *
 * A mesma conta que o menu de sugestões do modal já fazia — mora aqui agora,
 * porque a comparação da sugestão e a comparação da criação PRECISAM ser a
 * mesma. Enquanto eram duas, o menu escondia "Infra" por já existir e o Enter
 * criava "infra" assim mesmo.
 */
export function semAcento(s: string): string {
  // `\p{M}` — "marca combinante" — e não a faixa de códigos escrita à mão.
  //
  // A versão do modal usa a faixa literal `U+0300`–`U+036F`, e ela chega ao
  // editor como caracteres INVISÍVEIS entre colchetes: a linha parece um par de
  // colchetes vazios, que é exatamente a linha que a próxima pessoa apaga
  // achando que não faz nada. A propriedade Unicode diz a mesma coisa em ASCII,
  // e diz mais: pega também as marcas que o NFD produz fora daquela faixa.
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * A grafia que vai para o banco: sem "#", sem sobra de espaço, no teto.
 *
 * Preserva maiúsculas e acentos — é assim que a tag aparece no card, e
 * "Manutenção" escrito certo vale mais do que "manutencao". Quem compara é
 * `chaveDeTag`; quem se lê é isto.
 *
 * A barra é limpa dos dois lados (`cantinas / estoque` → `cantinas/estoque`)
 * porque ela é separador de hierarquia, não pontuação: com o espaço no meio,
 * `casaComTag` deixaria de reconhecer a filha e a hierarquia sumiria sem aviso.
 */
export function normalizarTag(bruto: unknown): string {
  return String(bruto ?? "")
    .replace(/^[\s#]+/, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITE_TAG_CHARS)
    .trim();
}

/**
 * A identidade da tag: duas grafias com a mesma chave SÃO a mesma tag.
 *
 * Além do acento e da caixa, unifica os separadores que a gente troca sem
 * perceber: "portal-do-aluno", "portal_do_aluno" e "portal do aluno" são a
 * mesma coisa digitada por três pessoas. A barra NÃO entra nessa unificação —
 * ela é hierarquia, e achatá-la faria `cantinas/estoque` empatar com
 * `cantinas estoque`, que é uma tag plana de nome parecido.
 *
 * Plural também não entra aqui, e é decisão: "Processo" e "Processos" viram
 * chaves diferentes de propósito. Empatá-las cedo demais faria o app
 * transformar uma na outra em silêncio, e "Compra" (o pedido) contra "Compras"
 * (o setor) é um empate que quebraria dado real. Quem cuida disso é
 * `parecidas`, que avisa em vez de decidir.
 */
export function chaveDeTag(tag: string): string {
  return semAcento(normalizarTag(tag)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** As partes da hierarquia: `cantinas/estoque/frios` → 3 níveis. */
export function niveisDaTag(tag: string): string[] {
  return chaveDeTag(tag)
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Esta tag responde por aquele filtro?
 *
 * Igual, ou descendente dela na hierarquia. `cantinas` casa com
 * `cantinas/estoque`; `cantina` não casa com nada de `cantinas`, porque prefixo
 * de TEXTO não é prefixo de hierarquia — sem o corte na barra, filtrar por "a"
 * traria o quadro inteiro.
 */
export function casaComTag(tag: string, filtro: string): boolean {
  const t = chaveDeTag(tag);
  const f = chaveDeTag(filtro);
  if (!f) return false;
  return t === f || t.startsWith(`${f}/`);
}

/** O mínimo que este módulo precisa enxergar de um card. */
export type CardComTags = { tags?: string[] | null };

export type TagDoQuadro = {
  /** A grafia mais usada no quadro — é ela que vai no chip do filtro. */
  tag: string;
  /** Em quantos cards ela aparece, contando as filhas na hierarquia. */
  n: number;
  /** Quantos níveis acima dela existem no catálogo. 0 = raiz. */
  nivel: number;
};

/**
 * O catálogo de tags do quadro, ordenado por uso e depois por nome.
 *
 * ORDENA POR USO porque é isso que faz a barra de filtro ser útil no primeiro
 * segundo: a tag que o setor repete toda semana aparece primeiro, e o resto
 * tem ordem estável em vez da ordem de chegada do Firestore.
 *
 * A CONTAGEM DA MÃE INCLUI AS FILHAS. Um chip `cantinas` que diz "3" e traz 11
 * cards ao ser clicado é um número que contradiz o próprio clique — e como o
 * clique filtra pela hierarquia (`casaComTag`), a contagem tem de contar do
 * mesmo jeito. Um card com `cantinas` e `cantinas/estoque` conta uma vez só na
 * mãe, senão o total do chip passaria do total do quadro.
 *
 * A GRAFIA QUE SOBREVIVE é a mais usada, não a primeira encontrada: se onze
 * cards dizem "Portal do aluno" e um diz "portal do Aluno", o chip mostra a
 * grafia dos onze. Empate desempata pela ordem alfabética, para não depender de
 * quem o Firestore devolveu antes.
 */
export function catalogoDeTags(cards: readonly CardComTags[]): TagDoQuadro[] {
  /**
   * chave → grafias próprias, grafias herdadas da filha, e cards que a acionam.
   *
   * As duas listas de grafia existem porque uma tag-mãe pode não ter sido
   * digitada nunca: `Cantinas/Estoque` cria o chip `cantinas` sozinha. Sem a
   * herdada, o nome dele sairia da CHAVE — em minúsculas, sem acento — e a
   * barra mostraria "cantinas" ao lado de "Cantinas/Estoque", como se fossem
   * duas famílias. A grafia herdada é o pedaço correspondente da filha.
   */
  const porChave = new Map<
    string,
    { grafias: Map<string, number>; herdadas: Map<string, number>; cards: Set<number> }
  >();

  cards.forEach((c, i) => {
    (c.tags ?? []).forEach((bruta) => {
      const tag = normalizarTag(bruta);
      const chave = chaveDeTag(tag);
      if (!chave) return;
      // A tag e todas as suas ascendentes: `cantinas/estoque` alimenta também o
      // chip `cantinas`, mesmo que nenhum card use a mãe sozinha. Sem isto, a
      // raiz de uma hierarquia só existiria se alguém a tivesse digitado solta.
      const partes = chave.split("/");
      const partesDoTexto = tag.split("/");
      for (let k = 1; k <= partes.length; k++) {
        const ancestral = partes.slice(0, k).join("/");
        const entrada = porChave.get(ancestral) ?? {
          grafias: new Map<string, number>(),
          herdadas: new Map<string, number>(),
          cards: new Set<number>(),
        };
        if (k === partes.length) {
          entrada.grafias.set(tag, (entrada.grafias.get(tag) ?? 0) + 1);
        } else {
          const pedaco = partesDoTexto.slice(0, k).join("/");
          entrada.herdadas.set(pedaco, (entrada.herdadas.get(pedaco) ?? 0) + 1);
        }
        entrada.cards.add(i);
        porChave.set(ancestral, entrada);
      }
    });
  });

  const maisUsada = (m: Map<string, number>): string | undefined =>
    m.size
      ? [...m.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
        )[0][0]
      : undefined;

  // A grafia PRÓPRIA ganha da herdada, sempre: quem digitou "Cantinas" solta
  // decidiu como ela se escreve, e uma filha escrita de outro jeito não desfaz
  // essa decisão. A chave é o último recurso, e só sobra em tag sem letra.
  const nomeDe = (
    chave: string,
    v: { grafias: Map<string, number>; herdadas: Map<string, number> },
  ): string => maisUsada(v.grafias) ?? maisUsada(v.herdadas) ?? chave;

  return [...porChave.entries()]
    .map(([chave, v]) => ({
      tag: nomeDe(chave, v),
      n: v.cards.size,
      nivel: chave.split("/").length - 1,
    }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, "pt-BR"));
}

/**
 * Distância de edição, com corte — quantas letras separam duas palavras.
 *
 * Para de contar assim que passa de `teto`: interessa saber se são parecidas,
 * não o quanto são diferentes, e a matriz inteira de duas frases de 40
 * caracteres é trabalho jogado fora a cada tecla digitada no campo de tag.
 */
export function distancia(a: string, b: string, teto = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      atual.push(v);
      if (v < menor) menor = v;
    }
    // Linha inteira acima do teto: nenhuma continuação desce de novo.
    if (menor > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Quanto de diferença ainda conta como "a mesma tag digitada torto".
 *
 * Cresce com o tamanho porque errar uma letra em "RH" muda a palavra e errar
 * uma em "Levantamento de requisitos" é escorregão de teclado. Sem essa escala,
 * um teto fixo de 2 empataria "RH" com "TI".
 */
function tetoDe(n: number): number {
  if (n <= 4) return 0;
  if (n <= 8) return 1;
  return 2;
}

/**
 * As tags do catálogo que provavelmente são ESTA tag escrita de outro jeito.
 *
 * Três parentescos, e cada um pegou um caso visto em dado real:
 *
 *   - MESMA CHAVE: "Portal-do-aluno" contra "portal do aluno". É empate, não
 *     semelhança — vem primeiro por isso.
 *   - PLURAL: "Processo" contra "Processos". O `chaveDeTag` não achata plural
 *     de propósito (ver lá); é aqui que ele é reconhecido, para avisar.
 *   - ERRO DE DIGITAÇÃO: distância de edição dentro do teto do tamanho.
 *
 * Devolve a GRAFIA do catálogo, não a chave: é ela que vai no aviso e é ela que
 * a pessoa aceita com um clique. Ordenado do parentesco mais forte para o mais
 * fraco, porque a primeira é a que o botão vai oferecer.
 */
export function parecidas(nova: string, catalogo: readonly string[]): string[] {
  const alvo = chaveDeTag(nova);
  if (!alvo) return [];
  const t = tetoDe(alvo.length);

  const semPlural = (s: string) => s.replace(/(oes|aes|ns|es|s)$/u, "");

  return catalogo
    .map((tag) => {
      const c = chaveDeTag(tag);
      if (!c || c === alvo) return { tag, peso: c === alvo ? 0 : 99 };
      if (semPlural(c) === semPlural(alvo) && semPlural(c).length >= 3)
        return { tag, peso: 1 };
      // Hierarquia não é semelhança: `cantinas/estoque` e `cantinas/compras`
      // ficam a 7 letras uma da outra, mas são irmãs de propósito — a barra é
      // exatamente a ferramenta que a pessoa usou para separá-las.
      if (c.includes("/") !== alvo.includes("/")) return { tag, peso: 99 };
      const d = distancia(c, alvo, t);
      return { tag, peso: d <= t ? 2 + d : 99 };
    })
    .filter((x) => x.peso < 99)
    .sort((a, b) => a.peso - b.peso || a.tag.localeCompare(b.tag, "pt-BR"))
    .map((x) => x.tag);
}

export type TagConferida =
  | {
      ok: true;
      /** A grafia normalizada, pronta para gravar. */
      tag: string;
      /**
       * A tag do catálogo que É esta, escrita de outro jeito.
       *
       * Presente = o campo deve gravar ESTA, e não a digitada. Empate de chave
       * não é escolha do usuário: são a mesma tag, e manter as duas grafias
       * partiria o filtro em duas metades para sempre.
       */
      mesma?: string;
      /** As parecidas de verdade — o aviso que a pessoa aceita ou ignora. */
      parecidas: string[];
    }
  | { ok: false; motivo: string };

/**
 * A régua do campo de tag, aplicada ANTES do banco.
 *
 * Devolve as três respostas separadas de propósito: recusa (não dá para
 * gravar), empate (grava a grafia que já existe) e semelhança (grava o que foi
 * pedido, e avisa). Juntá-las num booleano faria a tela ter de adivinhar qual
 * das três aconteceu — que é como se escreve a mensagem errada.
 */
export function conferirTag(
  bruto: unknown,
  catalogo: readonly string[] = [],
): TagConferida {
  const tag = normalizarTag(bruto);
  if (!tag) return { ok: false, motivo: "Escreva a tag." };
  // O teto já foi aplicado por `normalizarTag` cortando o texto. Recusar aqui
  // seria negar o que o corte já resolveu; o que sobra é o caso de a tag ter
  // virado só pontuação depois de tirar o "#" e os espaços.
  if (!chaveDeTag(tag))
    return { ok: false, motivo: "Essa tag não tem nenhuma letra ou número." };

  const chave = chaveDeTag(tag);
  const mesma = catalogo.find((c) => chaveDeTag(c) === chave && c !== tag);
  const todas = parecidas(tag, catalogo);
  return {
    ok: true,
    tag,
    mesma,
    parecidas: todas.filter((c) => chaveDeTag(c) !== chave),
  };
}

/** Como o filtro combina duas tags marcadas. */
export type ModoDeTags = "ou" | "e";

/**
 * Os cards que respondem às tags marcadas.
 *
 * `"ou"` é o padrão da tela e o padrão de todo filtro por rótulo que existe: a
 * pessoa marca duas tags para ver as duas coisas, não a interseção delas. O
 * `"e"` está aqui porque a interseção é a pergunta seguinte ("o que é de
 * cantinas E está atrasado?") e não tem outro jeito de fazê-la.
 *
 * Sem nada marcado devolve tudo — filtro vazio é filtro desligado, nunca
 * quadro vazio.
 */
export function filtrarPorTags<C extends CardComTags>(
  cards: readonly C[],
  marcadas: readonly string[],
  modo: ModoDeTags = "ou",
): C[] {
  const alvos = marcadas.map(chaveDeTag).filter(Boolean);
  if (!alvos.length) return [...cards];
  return cards.filter((c) => {
    const doCard = (c.tags ?? []).map(normalizarTag).filter(Boolean);
    const bate = (alvo: string) => doCard.some((t) => casaComTag(t, alvo));
    return modo === "e" ? alvos.every(bate) : alvos.some(bate);
  });
}

/** Este card responde a alguma das tags marcadas? — para acender o destaque. */
export function cardTemTag(
  card: CardComTags,
  marcadas: readonly string[],
  modo: ModoDeTags = "ou",
): boolean {
  return filtrarPorTags([card], marcadas, modo).length > 0;
}

// ---------------------------------------------------------------------------
// Vocabulário — o catálogo como LÍNGUA, para quem escreve tag de fora do app
// ---------------------------------------------------------------------------

/**
 * O mínimo que o vocabulário precisa enxergar de um card.
 *
 * `setor` e não `sector`: este módulo é puro e não conhece o `Card` do
 * Firestore — quem chama monta a forma. A rota do Cowork já traduz o campo para
 * português na resposta dela, e é ela quem chama.
 */
export type CardDoVocabulario = CardComTags & { setor?: string | null };

/**
 * Quantos cards uma tag precisa ter para entrar no vocabulário.
 *
 * DOIS, e este número é a Issue inteira. Tag que aparece em um card só não liga
 * coisa nenhuma a coisa nenhuma — e ligar demandas é a única razão de a tag
 * existir aqui. Oferecê-la de volta a quem gera tag nova é ensinar o erro a se
 * repetir: a IA vê "orcamento-antivirus-2026" no vocabulário, conclui que é
 * assim que se nomeia tag neste setor, e inventa a próxima no mesmo molde.
 */
export const VOCABULARIO_MIN_USO = 2;

/** Quantas tags por setor viajam. O vocabulário vai dentro de um prompt. */
export const VOCABULARIO_TETO = 60;

/**
 * A língua de tags de cada setor: o que ele repete, e com que grafia.
 *
 * POR SETOR, e nunca junto. A tag é o vocabulário de UM quadro — "estoque"
 * quer dizer uma coisa nas Cantinas e outra na Infra, e uma lista única
 * convidaria quem gera a proposta a marcar a demanda da cantina com a palavra
 * que a T.I. usa. O resultado seria pior do que tag inventada: seria tag
 * inventada com cara de tag legítima.
 *
 * FORA DO VOCABULÁRIO NÃO É "PROIBIDO". Quem lê isto continua podendo escrever
 * tag nova — o teto de quantas é assunto do prompt, não deste módulo. O que a
 * peneira faz é decidir o que se OFERECE, e oferecer é o gesto que empurra.
 *
 * Ordenado por uso, que é a ordem em que `catalogoDeTags` já devolve: a tag que
 * o setor repete toda semana é a que tem de ser lida primeiro por quem só vai
 * ler as dez primeiras.
 */
export function vocabularioDeTags(
  cards: readonly CardDoVocabulario[],
  opcoes?: { minUso?: number; teto?: number },
): Record<string, TagDoQuadro[]> {
  const minUso = opcoes?.minUso ?? VOCABULARIO_MIN_USO;
  const teto = opcoes?.teto ?? VOCABULARIO_TETO;

  const porSetor = new Map<string, CardDoVocabulario[]>();
  for (const c of cards) {
    const setor = String(c.setor ?? "").trim();
    // Card sem setor não pertence a língua nenhuma. Ele existe (documento
    // editado à mão, importação antiga), e juntá-lo num balde "" criaria um
    // setor fantasma no meio da resposta.
    if (!setor) continue;
    const lista = porSetor.get(setor);
    if (lista) lista.push(c);
    else porSetor.set(setor, [c]);
  }

  const out: Record<string, TagDoQuadro[]> = {};
  for (const [setor, doSetor] of porSetor) {
    const vocab = catalogoDeTags(doSetor)
      .filter((t) => t.n >= minUso)
      .slice(0, teto);
    // Setor cujas tags são todas de uso único não entra com uma lista vazia: a
    // chave presente e vazia lê como "este setor não usa tag", e o que ela quer
    // dizer é o contrário — ele usa, e usa tudo errado.
    if (vocab.length > 0) out[setor] = vocab;
  }
  return out;
}
