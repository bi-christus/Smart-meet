/**
 * A árvore de dimensões e subdimensões — o modelo, sem o banco.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * fala com o banco é `dimensoes.ts`, o irmão, e é isto que permite
 * `scripts/test-dimensoes.mjs` rodar a agregação inteira em Node puro — com a
 * regra de entrega DE PRODUÇÃO, importada de `entregas-core`, e não com uma
 * cópia da expectativa.
 *
 * POR QUE ESTA COLEÇÃO EXISTE. A ata da reunião com a Direção (19/08/2026)
 * decidiu, para a primeira fase, deixar as dimensões "pré-carregadas como
 * tags". Tag não serve para o que esta aba faz: a pergunta que o gestor levou
 * para a reunião — "cadê o uso de EPI?" — inclui as subdimensões em que
 * NINGUÉM ABRIU NADA, e uma subdimensão sem card não tem tag em card nenhum.
 * O ponto cego, que é o que a árvore existe para mostrar, seria justamente o
 * que ela não conseguiria desenhar.
 *
 * E é CADASTRO, não constante em código, pelo motivo que o AGENTS.md §4 já
 * registrou sobre `DEFAULT_SECTORS`: árvore que só o deploy muda não é
 * cadastro, é código com nome de dado — e a Infra tem 34 subdimensões que
 * mudam sozinhas, sem passar por ninguém que saiba abrir um PR.
 *
 * AS SUBDIMENSÕES MORAM DENTRO DO DOCUMENTO DA DIMENSÃO, num array, e não em
 * subcoleção. São poucas (a maior dimensão da Infra tem onze), são SEMPRE lidas
 * junto com a mãe — não existe tela que queira uma subdimensão sem saber de
 * quem ela é — e subcoleção custaria uma consulta por dimensão a cada abertura
 * da aba, mais uma regra própria em `firestore.rules`. É a mesma decisão, pelo
 * mesmo motivo, que `links` dentro do card (ver o comentário do campo em
 * `kanban.ts`).
 */

// A regra de "este card conta como entregue" mora em `entregas-core` e é uma só
// no app inteiro — o Rank, os emblemas e agora a árvore leem a mesma. Ele é
// puro, então importá-lo aqui não traz SDK nenhum junto.
import { ehEntrega, type EntreguePorSetor } from "./entregas-core.ts";

// "Esta demanda está atrasada?" é UMA regra no app inteiro, e ela mora em
// `prazo-core` — a mesma que pinta o selo de prazo do card. Sem isto, o card
// diria "entregue" em verde e o galho acima dele "tem atrasada" em vermelho,
// sobre a mesma demanda.
import { estaAtrasada, inicioDoDia } from "./prazo-core.ts";

export type { EntreguePorSetor };
export { estaAtrasada, inicioDoDia };

/**
 * Uma subdimensão é PROJETO ou ROTINA, e a diferença não é decorativa.
 *
 * A ata registra o pedido nestas palavras: um item de subdimensão "pode virar
 * projeto ou ficar estático, como uma caixa que abriga vários trabalhos".
 * Projeto tem fim, então tem porcentagem de conclusão. Rotina não termina —
 * medir "40% da limpeza de banheiros" é inventar um fim que não existe, e é por
 * isso que `pctConcluido` devolve `null` para rotina em vez de zero.
 */
export type TipoDeSub = "projeto" | "rotina";

export const TIPO_LABEL: Record<TipoDeSub, string> = {
  projeto: "Projeto",
  rotina: "Rotina",
};

export type Subdimensao = {
  /** Único dentro da dimensão, e NUNCA reaproveitado — ver `proximoIdDeSub`. */
  id: string;
  nome: string;
  tipo: TipoDeSub;
};

export type Dimensao = {
  /** id do documento. */
  id: string;
  /** Setor de execução dono desta dimensão. */
  setor: string;
  nome: string;
  /** Posição na árvore. Empate desempata pelo nome — ver `ordenarDimensoes`. */
  ordem: number;
  subs: Subdimensao[];
};

/** Quanto cabe no nome de uma dimensão ou subdimensão. Espelhado nas regras. */
export const LIMITE_NOME_CHARS = 70;

/**
 * A cor de uma dimensão sai da POSIÇÃO dela, não de um campo escolhido à mão.
 *
 * São os mesmos oito passos da paleta categórica do Dashboard, que foram
 * validados para daltonismo nas duas superfícies do app (o comentário longo
 * está em `dashboard.module.css`). Deixar o gestor escolher a cor produziria,
 * na terceira dimensão cadastrada, duas faixas que ninguém separa — e a cor
 * aqui não é enfeite: é o que liga o nó da árvore à faixa do painel lateral.
 */
export const PALETA_DIMENSAO = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#9085e9",
  "#c98500",
  "#d55181",
  "#008300",
  "#e66767",
] as const;

export function corDaDimensao(ordem: number): string {
  // `%` de número negativo é negativo em JS, e ordem negativa é o que um
  // documento editado à mão no console pode ter.
  const i = ((Math.trunc(ordem) % PALETA_DIMENSAO.length) + PALETA_DIMENSAO.length) %
    PALETA_DIMENSAO.length;
  return PALETA_DIMENSAO[i];
}

// ---------------------------------------------------------------------------
// Conferência de nome
// ---------------------------------------------------------------------------

export type NomeConferido =
  | { ok: true; nome: string }
  | { ok: false; motivo: string };

/**
 * A régua do campo, aplicada ANTES do banco.
 *
 * Mesmo motivo de `conferirNomeDeSetor` em `setores-core.ts`: a regra do
 * Firestore é a segunda barreira e só sabe responder "sem permissão", que é a
 * mensagem errada para quem digitou um espaço. O teto é o mesmo dos dois lados,
 * e `test-dimensoes.mjs` reprova se um andar sem o outro.
 */
export function conferirNome(bruto: unknown, oQue: string): NomeConferido {
  if (typeof bruto !== "string") return { ok: false, motivo: `Informe o nome ${oQue}.` };
  const nome = bruto.trim();
  if (!nome) return { ok: false, motivo: `Informe o nome ${oQue}.` };
  if (nome.length > LIMITE_NOME_CHARS) {
    return { ok: false, motivo: `O nome passa de ${LIMITE_NOME_CHARS} caracteres.` };
  }
  return { ok: true, nome };
}

/**
 * Este nome já está na lista? Devolve o que está gravado, se estiver.
 *
 * Compara sem diferenciar caixa nem acento sobrando, pelo mesmo motivo de
 * `setorExistente`: "Brigada" e "brigada" cadastradas em semanas diferentes
 * viram duas caixas, e cada uma leva metade das demandas.
 */
export function nomeExistente<T extends { nome: string }>(
  nome: string,
  lista: readonly T[],
): T | undefined {
  const alvo = nome.trim().toLowerCase();
  return lista.find((x) => x.nome.trim().toLowerCase() === alvo);
}

/**
 * O próximo id de subdimensão, que NUNCA repete um já usado.
 *
 * Não é o índice do array, e essa é a decisão inteira deste helper: a demanda
 * guarda o id da subdimensão, e apagar a segunda de cinco faria a terceira
 * virar índice 2 — todas as demandas da terceira passariam a apontar para o
 * lugar da que foi apagada, em silêncio. Contar do maior número já emitido
 * resolve isso mesmo depois de exclusões, porque o maior não diminui quando
 * alguém sai do meio.
 */
export function proximoIdDeSub(subs: readonly Subdimensao[]): string {
  let maior = 0;
  for (const s of subs) {
    const n = Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0);
    if (Number.isFinite(n) && n > maior) maior = n;
  }
  return `s${maior + 1}`;
}

// ---------------------------------------------------------------------------
// Leitura do banco
// ---------------------------------------------------------------------------

function texto(v: unknown, padrao = ""): string {
  return typeof v === "string" ? v.trim() : padrao;
}

/**
 * Lê o documento como se ele pudesse estar em qualquer estado — porque pode.
 *
 * É um documento que um gestor edita, que o console do Firebase permite alterar
 * à mão e que uma versão futura deste app pode ter escrito com outro formato. A
 * escolha aqui é a OPOSTA à de `normalizarPermissoes`: lá, dado ilegível vira o
 * padrão ABERTO, porque trancar o app inteiro é pior do que uma aba a mais na
 * tela. Aqui, dado ilegível é DESCARTADO — uma subdimensão sem nome não é
 * mostrada, e é isso mesmo que se quer: ela não tem como ser lida, clicada nem
 * explicada, e desenhá-la em branco no meio da árvore só faria alguém procurar
 * o defeito na tela em vez de no cadastro.
 *
 * O que NÃO é descartado é a dimensão inteira por causa de uma subdimensão
 * torta: as outras dez continuam desenhando.
 */
export function normalizarDimensao(id: string, bruto: unknown): Dimensao | null {
  if (!bruto || typeof bruto !== "object") return null;
  const d = bruto as Record<string, unknown>;
  const nome = texto(d.nome);
  const setor = texto(d.setor);
  if (!nome || !setor) return null;

  const vistos = new Set<string>();
  const subs: Subdimensao[] = [];
  if (Array.isArray(d.subs)) {
    for (const bs of d.subs) {
      if (!bs || typeof bs !== "object") continue;
      const s = bs as Record<string, unknown>;
      const sid = texto(s.id);
      const snome = texto(s.nome);
      // Id repetido é pior do que id ausente: as duas subdimensões passariam a
      // receber as mesmas demandas, e a segunda apareceria sempre vazia.
      if (!sid || !snome || vistos.has(sid)) continue;
      vistos.add(sid);
      subs.push({
        id: sid,
        nome: snome,
        tipo: s.tipo === "projeto" ? "projeto" : "rotina",
      });
    }
  }

  const ordem = typeof d.ordem === "number" && Number.isFinite(d.ordem) ? d.ordem : 0;
  return { id, setor, nome, ordem, subs };
}

/** A ordem da árvore. Empate no número desempata pelo nome, nunca pelo acaso. */
export function ordenarDimensoes(dims: readonly Dimensao[]): Dimensao[] {
  return [...dims].sort(
    (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

// ---------------------------------------------------------------------------
// A árvore
// ---------------------------------------------------------------------------

/** Quantos dias sem sair do lugar já contam como parada. */
export const PARADA_DIAS = 15;

/** O recorte de um card que a árvore enxerga. Nada mais. */
export type CardDaArvore = {
  id: string;
  sector: string;
  columnId: string;
  title?: string;
  due?: string | null;
  enteredAt?: number;
  dimensaoId?: string | null;
  subdimensaoId?: string | null;
};

/**
 * O estado de um nó, em uma palavra.
 *
 * A ORDEM DAS PERGUNTAS É A REGRA. Atrasada vence parada, e parada vence
 * andamento, porque é assim que o gestor prioriza: um galho com demanda
 * vencida não é "em andamento" só porque alguém mexeu nele ontem.
 *
 * `vazio` é primeiro, e é o único estado que NÃO é sobre as demandas: é sobre a
 * ausência delas. Ele existe separado de "concluído" de propósito — "ninguém
 * abriu nada aqui" e "tudo o que foi aberto terminou" são fatos opostos que uma
 * contagem de pendências sozinha mostraria igual, com zero dos dois lados.
 */
export type EstadoDoNo =
  | "vazio"
  | "atrasado"
  | "parado"
  | "concluido"
  | "andamento";

export const ESTADO_LABEL: Record<EstadoDoNo, string> = {
  vazio: "nenhuma demanda",
  atrasado: "tem demanda atrasada",
  parado: "sem movimento",
  concluido: "tudo concluído",
  andamento: "em andamento",
};

/**
 * Um nó da árvore — dimensão, subdimensão ou a caixa do que não foi
 * classificado. É UM tipo só para os três, de propósito: a tela desenha o mesmo
 * componente em qualquer nível, e um tipo por nível faria a página crescer três
 * ramos de `if` que dizem a mesma coisa.
 */
export type NoDaArvore = {
  /** Estável e único na árvore. É a chave do React e do nó selecionado. */
  id: string;
  nome: string;
  nivel: 1 | 2;
  cor: string;
  /** Só em subdimensão. `null` em dimensão e no nó do não classificado. */
  tipo: TipoDeSub | null;
  /** As demandas DESTE nó — as dos filhos não entram aqui. */
  cards: CardDaArvore[];
  filhos: NoDaArvore[];
  /** De `cards` + de todos os filhos. É o que os selos e o painel leem. */
  metricas: Metricas;
  estado: EstadoDoNo;
};

export type Metricas = {
  total: number;
  entregues: number;
  abertas: number;
  atrasadas: number;
  semPrazo: number;
  /** O prazo em aberto mais próximo (aaaa-mm-dd), ou `null`. */
  proximoPrazo: string | null;
  /**
   * Há quantos dias a demanda em aberto MAIS RECENTEMENTE mexida parou.
   *
   * É o mínimo, não o máximo, e a diferença importa: um galho com uma demanda
   * de ontem e outra de dois meses atrás está vivo. O máximo diria que ele está
   * parado há dois meses, e mandaria o gestor cobrar um galho que anda.
   *
   * `null` quando não há demanda em aberto — não zero. Zero é "mexeram hoje".
   */
  diasSemMovimento: number | null;
  /** Concluídas / total. `null` quando não há demanda. */
  pctConcluido: number | null;
};

const METRICAS_VAZIAS: Metricas = {
  total: 0,
  entregues: 0,
  abertas: 0,
  atrasadas: 0,
  semPrazo: 0,
  proximoPrazo: null,
  diasSemMovimento: null,
  pctConcluido: null,
};

function medir(
  cards: readonly CardDaArvore[],
  ent: EntreguePorSetor,
  hoje: number,
): Metricas {
  if (cards.length === 0) return METRICAS_VAZIAS;
  let entregues = 0;
  let atrasadas = 0;
  let semPrazo = 0;
  let proximoPrazo: string | null = null;
  let paradaMin: number | null = null;
  const dia0 = inicioDoDia(hoje);

  for (const c of cards) {
    const feita = ehEntrega(c, ent);
    if (feita) {
      entregues++;
      continue;
    }
    if (estaAtrasada(c.due, feita, hoje)) atrasadas++;
    if (!c.due) semPrazo++;
    else if (!proximoPrazo || c.due < proximoPrazo) proximoPrazo = c.due;

    // Sem `enteredAt` (demandas anteriores ao campo) o card não conta para o
    // "parado": inventar zero diria que mexeram nele hoje, e inventar um número
    // grande acusaria de abandono uma demanda sobre a qual não se sabe nada.
    if (typeof c.enteredAt === "number") {
      const dias = Math.floor((dia0 - inicioDoDia(c.enteredAt)) / 86400000);
      const d = Math.max(0, dias);
      if (paradaMin === null || d < paradaMin) paradaMin = d;
    }
  }

  return {
    total: cards.length,
    entregues,
    abertas: cards.length - entregues,
    atrasadas,
    semPrazo,
    proximoPrazo,
    diasSemMovimento: paradaMin,
    pctConcluido: Math.round((entregues / cards.length) * 100),
  };
}

/** Soma as métricas de vários nós com as do próprio nó. */
function somar(propria: Metricas, filhos: readonly Metricas[]): Metricas {
  const todas = [propria, ...filhos];
  const total = todas.reduce((a, m) => a + m.total, 0);
  if (total === 0) return METRICAS_VAZIAS;
  const entregues = todas.reduce((a, m) => a + m.entregues, 0);
  const prazos = todas
    .map((m) => m.proximoPrazo)
    .filter((p): p is string => !!p);
  const paradas = todas
    .map((m) => m.diasSemMovimento)
    .filter((d): d is number => d !== null);
  return {
    total,
    entregues,
    abertas: total - entregues,
    atrasadas: todas.reduce((a, m) => a + m.atrasadas, 0),
    semPrazo: todas.reduce((a, m) => a + m.semPrazo, 0),
    proximoPrazo: prazos.length ? prazos.sort()[0] : null,
    diasSemMovimento: paradas.length ? Math.min(...paradas) : null,
    pctConcluido: Math.round((entregues / total) * 100),
  };
}

export function estadoDoNo(m: Metricas): EstadoDoNo {
  if (m.total === 0) return "vazio";
  if (m.atrasadas > 0) return "atrasado";
  if (m.abertas === 0) return "concluido";
  if (m.diasSemMovimento !== null && m.diasSemMovimento >= PARADA_DIAS) {
    return "parado";
  }
  return "andamento";
}

/**
 * O id do nó em que uma demanda cai.
 *
 * Uma demanda pode estar na dimensão sem estar em nenhuma subdimensão — a ata
 * prevê os dois casos, e o formulário não obriga a descer o segundo nível. Ela
 * cai então num nó "Direto na dimensão", filho da dimensão, e NÃO na primeira
 * subdimensão nem solta na raiz.
 */
export const ID_SEM_DIMENSAO = "sem-dimensao";
export const NOME_SEM_DIMENSAO = "Sem classificação";
const COR_SEM_DIMENSAO = "#78776f";
const SUFIXO_DIRETO = "direto";

/**
 * Monta a árvore inteira.
 *
 * A CAIXA DO "SEM CLASSIFICAÇÃO" NÃO É OPCIONAL. Todo card que existe hoje no
 * banco está sem dimensão — o campo nasce nesta frente. Uma árvore que só
 * mostrasse o classificado faria a aba abrir vazia no primeiro dia e dizer, sem
 * uma palavra, que o setor não tem trabalho nenhum. Ela vem por último e só
 * aparece quando tem gente dentro.
 *
 * Dimensão e subdimensão APAGADAS do cadastro deixam demandas apontando para o
 * nada. Elas também caem no "Sem classificação", e é a resposta certa: a
 * demanda continua existindo, continua visível, e o que se perdeu foi a gaveta
 * — não o trabalho.
 */
export function montarArvore(opcoes: {
  dims: readonly Dimensao[];
  cards: readonly CardDaArvore[];
  entregues: EntreguePorSetor;
  agora?: number;
}): NoDaArvore[] {
  const { dims, cards, entregues } = opcoes;
  const hoje = opcoes.agora ?? Date.now();

  /** dimensaoId → subdimensaoId → cards. `""` guarda os diretos da dimensão. */
  const porDim = new Map<string, Map<string, CardDaArvore[]>>();
  const soltos: CardDaArvore[] = [];

  const conhecidas = new Map(dims.map((d) => [d.id, d]));

  for (const c of cards) {
    const dim = c.dimensaoId ? conhecidas.get(c.dimensaoId) : undefined;
    if (!dim) {
      soltos.push(c);
      continue;
    }
    const temSub =
      !!c.subdimensaoId && dim.subs.some((s) => s.id === c.subdimensaoId);
    const chaveSub = temSub ? (c.subdimensaoId as string) : "";
    let mapa = porDim.get(dim.id);
    if (!mapa) {
      mapa = new Map();
      porDim.set(dim.id, mapa);
    }
    const lista = mapa.get(chaveSub);
    if (lista) lista.push(c);
    else mapa.set(chaveSub, [c]);
  }

  const nos: NoDaArvore[] = ordenarDimensoes(dims).map((dim, i) => {
    const cor = corDaDimensao(dim.ordem || i);
    const mapa = porDim.get(dim.id);

    const filhos: NoDaArvore[] = dim.subs.map((sub) => {
      const lista = mapa?.get(sub.id) ?? [];
      const m = medir(lista, entregues, hoje);
      return {
        id: `${dim.id}/${sub.id}`,
        nome: sub.nome,
        nivel: 2 as const,
        cor,
        tipo: sub.tipo,
        cards: lista,
        filhos: [],
        metricas: m,
        estado: estadoDoNo(m),
      };
    });

    // As diretas da dimensão viram um filho próprio, e só quando existem.
    const diretas = mapa?.get("") ?? [];
    if (diretas.length > 0) {
      const m = medir(diretas, entregues, hoje);
      filhos.push({
        id: `${dim.id}/${SUFIXO_DIRETO}`,
        nome: "Direto na dimensão",
        nivel: 2,
        cor,
        tipo: null,
        cards: diretas,
        filhos: [],
        metricas: m,
        estado: estadoDoNo(m),
      });
    }

    const metricas = somar(
      METRICAS_VAZIAS,
      filhos.map((f) => f.metricas),
    );
    return {
      id: dim.id,
      nome: dim.nome,
      nivel: 1 as const,
      cor,
      tipo: null,
      cards: [],
      filhos,
      metricas,
      estado: estadoDoNo(metricas),
    };
  });

  if (soltos.length > 0) {
    const m = medir(soltos, entregues, hoje);
    nos.push({
      id: ID_SEM_DIMENSAO,
      nome: NOME_SEM_DIMENSAO,
      nivel: 1,
      cor: COR_SEM_DIMENSAO,
      tipo: null,
      cards: soltos,
      filhos: [],
      metricas: m,
      estado: estadoDoNo(m),
    });
  }

  return nos;
}

/** Todo nó da árvore, achatado — o que a busca e o painel varrem. */
export function achatar(nos: readonly NoDaArvore[]): NoDaArvore[] {
  return nos.flatMap((n) => [n, ...achatar(n.filhos)]);
}

/** O nó de um id, em qualquer nível. */
export function acharNo(
  nos: readonly NoDaArvore[],
  id: string,
): NoDaArvore | undefined {
  for (const n of nos) {
    if (n.id === id) return n;
    const dentro = acharNo(n.filhos, id);
    if (dentro) return dentro;
  }
  return undefined;
}

/** As demandas de um nó, incluindo as dos filhos. */
export function cardsDoNo(no: NoDaArvore): CardDaArvore[] {
  return [...no.cards, ...no.filhos.flatMap(cardsDoNo)];
}

/**
 * A árvore recortada pela busca.
 *
 * Casa em QUALQUER nível — nome de dimensão, de subdimensão ou título de
 * demanda —, e um nó que casa traz os filhos inteiros junto. Foi assim que a
 * pergunta da reunião ("cadê o uso de EPI?") virou uma linha de resposta: quem
 * digita "EPI" vê as duas subdimensões com esse nome E as demandas que falam de
 * EPI dentro de outras.
 *
 * Termo vazio devolve a árvore como está, pela mesma referência: o resultado
 * alimenta memo e lista, e trocar a identidade à toa custa render.
 */
export function filtrarArvore(
  nos: readonly NoDaArvore[],
  termo: string,
): NoDaArvore[] {
  const alvo = termo.trim().toLowerCase();
  if (!alvo) return nos as NoDaArvore[];

  const casa = (t: string) => t.toLowerCase().includes(alvo);

  const podar = (no: NoDaArvore): NoDaArvore | null => {
    if (casa(no.nome)) return no;
    const filhos = no.filhos
      .map(podar)
      .filter((f): f is NoDaArvore => f !== null);
    const cards = no.cards.filter((c) => casa(c.title ?? ""));
    if (filhos.length === 0 && cards.length === 0) return null;
    return { ...no, filhos, cards };
  };

  return nos.map(podar).filter((n): n is NoDaArvore => n !== null);
}
