/**
 * Emblemas — o reconhecimento por entregas feitas a cada setor SOLICITANTE.
 *
 * Módulo puro (AGENTS.md §4). Importa só `entregas-core`, que também é puro, e é
 * de lá que vem a regra de o que conta como entrega — ela não é reescrita aqui,
 * pelo motivo escrito no cabeçalho daquele arquivo.
 *
 * OS DOIS "SETOR" DESTE APP NÃO SÃO O MESMO, e confundi-los é o jeito mais fácil
 * de errar esta frente inteira:
 *
 *  - `card.sector` é quem EXECUTA. Vale "B.I." em todo card do banco. Agrupar
 *    por ele daria um emblema só, igual para todo mundo.
 *  - `card.requesterSector` é quem PEDE — Infra, Compras, Cantina, Diretoria…
 *    É este. É o que varia, e é dele que o pedido fala.
 *
 * A ESCADA É GLOBAL, SÓ O NOME É POR SETOR. Três degraus, e o mesmo número para
 * todos os setores. A alternativa — degraus por setor — foi descartada porque
 * ela transforma a comparação entre dois emblemas em nada: "Construtor III de
 * Infra" e "Guardião III de Compras" deixariam de dizer a mesma coisa sobre
 * esforço, e o quadro do Admin viraria uma planilha de 13 linhas × 3 colunas
 * para configurar o que ninguém pediu.
 *
 * DOCUMENTO TORTO VIRA A ESCADA PADRÃO INTEIRA, nunca uma escada remendada. É a
 * decisão de projeto que mais importa aqui, e é o contrário do que parece
 * cuidadoso. Uma escada remendada — aproveitar `[20, null, 100]` como
 * `[20, 15, 100]`, por exemplo — pode ficar não-crescente, e uma escada
 * não-crescente dá o DEGRAU MÁXIMO a quem tem zero entrega. O padrão seguro
 * aqui não é "aberto" como em `permissoes-core`: lá o pior caso é uma aba
 * visível a mais, aqui é atribuir a alguém um título que ela não conquistou.
 */
import {
  ehEntrega,
  mesmaPessoa,
  type CardContavel,
  type EntreguePorSetor,
} from "./entregas-core.ts";

export const NIVEL_MAXIMO = 3;

/** Quantos emblemas o card do perfil mostra antes de resumir em "+N". */
export const TETO_EMBLEMAS = 4;

/** Nome de emblema acima disto não cabe no chip sem quebrar a faixa. */
export const LIMITE_NOME_EMBLEMA = 24;

export type Degraus = readonly [number, number, number];

/**
 * A escada padrão — MEDIDA NO BANCO em 2026-08-18, não escolhida por sensação.
 *
 * O estado real naquele dia: 84 cards vivos, 50 entregues, 5 pessoas com
 * entrega, 19 pares distintos de (pessoa × setor solicitante). O maior par era
 * 11 (Compras). O que cada escada entregaria de emblema no dia da estreia:
 *
 *     20 / 50 / 100  →  0 emblemas  (a funcionalidade desligada por constante)
 *      5 / 15 /  40  →  2 emblemas
 *      3 / 10 /  25  →  7 emblemas, 1 deles no nível 2
 *
 * 20/50/100 foi o exemplo dado no pedido, e é a ambição certa para um app com
 * anos de uso — mas com 50 entregas acumuladas ele nasceria mostrando um bloco
 * vazio para todas as cinco pessoas, e continuaria assim por muitos meses.
 * 3/10/25 põe emblema em 4 das 5 pessoas no primeiro dia, que é a diferença
 * entre um recurso que existe e um que só está no código.
 *
 * NÃO "CORRIJA" ISTO POR SENSAÇÃO: os degraus são editáveis na aba Admin, e a
 * tela de lá mostra, ao vivo, quantos emblemas cada escada entrega hoje. A
 * decisão é de quem administra, com o número na frente — não de quem lê esta
 * constante e a acha baixa.
 */
export const DEGRAUS_PADRAO: Degraus = [3, 10, 25];

export type ConfigEmblemas = {
  degraus: Degraus;
  /**
   * Chave = `chaveDeSetor(nome)`. `setor` guarda a grafia que o admin viu e
   * escolheu, para a tela não inventar uma capitalização própria.
   */
  setores: Record<string, { setor: string; nome: string }>;
};

export const CONFIG_PADRAO: ConfigEmblemas = {
  degraus: DEGRAUS_PADRAO,
  setores: {},
};

export type Contagem = {
  /** chave normalizada → o que se lê e quantas entregas. */
  porSetor: Map<string, { rotulo: string; entregues: number }>;
  /** Entregas desta pessoa em demandas sem setor solicitante preenchido. */
  semSetor: number;
  /** Todas as entregas desta pessoa, com ou sem setor. */
  total: number;
};

export type Emblema = {
  chave: string;
  /** A grafia mostrada do setor solicitante. */
  setor: string;
  /** O nome do emblema — ou o do setor, quando o admin nunca o nomeou. */
  nome: string;
  entregues: number;
  nivel: 0 | 1 | 2 | 3;
  /** Quantas entregas o próximo degrau pede. `null` no nível máximo. */
  proximoDegrau: number | null;
  /** Quantas faltam para ele. `null` no nível máximo. */
  faltam: number | null;
  /** Fração do caminho até o próximo degrau, em [0,1]. Nunca NaN. */
  progresso: number;
};

/**
 * A chave de agrupamento de um setor solicitante.
 *
 * O campo é texto livre no modal da demanda, e o banco tem "Infra", "infra " e
 * " INFRA" como se fossem três setores. Sem normalizar, a mesma pessoa apareceria
 * com três emblemas de um por três grafias do mesmo lugar.
 */
export function chaveDeSetor(nome: string): string {
  return nome.trim().toLowerCase();
}

function inteiroPositivo(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Por que esta escada não serve — ou `null` quando ela serve.
 *
 * Devolve FRASE, e uma diferente por causa, porque quem lê isto é o admin no
 * meio de editar os degraus. "Valor inválido" para três problemas distintos
 * obriga a pessoa a adivinhar qual dos três ela cometeu.
 */
export function motivoDosDegraus(
  a: unknown,
  b: unknown,
  c: unknown,
): string | null {
  const ns = [a, b, c].map(inteiroPositivo);
  if (ns.some((n) => n === null)) {
    return "Cada degrau precisa ser um número inteiro maior que zero.";
  }
  const [x, y, z] = ns as number[];
  if (!(x < y && y < z)) {
    return "Os degraus precisam crescer: o segundo maior que o primeiro, e o terceiro maior que o segundo.";
  }
  return null;
}

/**
 * Lê o documento como se ele pudesse estar em qualquer estado — e ele pode.
 *
 * É um documento que um admin edita, que o console do Firebase permite alterar à
 * mão, e que uma versão futura deste app pode ter escrito com outro formato.
 * Confiar na forma dele significaria um `undefined.length` no meio da montagem
 * do card do perfil.
 *
 * A ESCADA É TUDO OU NADA. Ver o cabeçalho: escada remendada pode ficar
 * não-crescente, e escada não-crescente dá o degrau máximo a quem tem zero.
 */
export function normalizarConfigEmblemas(bruto: unknown): ConfigEmblemas {
  if (!bruto || typeof bruto !== "object") return CONFIG_PADRAO;
  const obj = bruto as Record<string, unknown>;

  const d = obj.degraus;
  const degraus: Degraus =
    Array.isArray(d) && d.length === 3 && motivoDosDegraus(d[0], d[1], d[2]) === null
      ? [d[0] as number, d[1] as number, d[2] as number]
      : DEGRAUS_PADRAO;

  const setores: ConfigEmblemas["setores"] = {};
  const brutosSetores = obj.setores;
  if (brutosSetores && typeof brutosSetores === "object") {
    for (const [k, v] of Object.entries(brutosSetores as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const entrada = v as Record<string, unknown>;
      const setor = typeof entrada.setor === "string" ? entrada.setor.trim() : "";
      const nome = typeof entrada.nome === "string" ? entrada.nome.trim() : "";
      const chave = chaveDeSetor(k);
      if (!chave) continue;
      // Nome fora do teto é DESCARTADO, e a entrada sobrevive só pela grafia:
      // um emblema chamado por um parágrafo colado de uma planilha quebraria a
      // faixa, e cair no nome do setor é uma degradação que se lê.
      setores[chave] = {
        setor: setor || k.trim(),
        nome: nome && nome.length <= LIMITE_NOME_EMBLEMA ? nome : "",
      };
    }
  }

  return { degraus, setores };
}

/**
 * As entregas desta pessoa, agrupadas por setor solicitante.
 *
 * O RÓTULO É DETERMINÍSTICO, e essa é a única parte não óbvia. Quando o admin
 * nomeou o setor, vence a grafia que ele viu (`cfg.setores[chave].setor`); sem
 * isso, vence a MENOR grafia por `localeCompare("pt-BR")` entre as encontradas.
 * Nunca "a primeira que apareceu": a ordem do snapshot do Firestore não é
 * contrato, e o rótulo mudaria entre duas aberturas do mesmo perfil.
 */
export function contarEntregasPorSetorSolicitante(
  cards: readonly CardContavel[],
  ent: EntreguePorSetor,
  email: string,
  cfg: ConfigEmblemas,
): Contagem {
  const porSetor = new Map<string, { rotulo: string; entregues: number }>();
  let semSetor = 0;
  let total = 0;

  cards.forEach((c) => {
    if (!ehEntrega(c, ent)) return;
    if (!mesmaPessoa(c.assignee, email)) return;
    total++;

    const bruto = (c.requesterSector ?? "").trim();
    if (!bruto) {
      semSetor++;
      return;
    }
    const chave = chaveDeSetor(bruto);
    const atual = porSetor.get(chave);
    if (!atual) {
      porSetor.set(chave, { rotulo: bruto, entregues: 1 });
      return;
    }
    atual.entregues++;
    if (bruto.localeCompare(atual.rotulo, "pt-BR") < 0) atual.rotulo = bruto;
  });

  // A grafia do admin vence a do banco — ela é a que ele escolheu ver.
  for (const [chave, v] of porSetor) {
    const doAdmin = cfg.setores[chave]?.setor;
    if (doAdmin) v.rotulo = doAdmin;
  }

  return { porSetor, semSetor, total };
}

/** Em que degrau uma contagem cai. `0` = ainda não cruzou o primeiro. */
export function nivelDe(entregues: number, d: Degraus): 0 | 1 | 2 | 3 {
  if (entregues >= d[2]) return 3;
  if (entregues >= d[1]) return 2;
  if (entregues >= d[0]) return 1;
  return 0;
}

/**
 * A contagem vira a lista de emblemas, ordenada para a tela.
 *
 * A ORDEM É nível ↓, entregas ↓, nome pt-BR. O nível vem antes das entregas de
 * propósito: um emblema de nível 3 com 25 entregas vale mais, na leitura, do que
 * um de nível 2 com 24 — e ordenar só por entregas os inverteria, pondo o menor
 * troféu na frente.
 *
 * ELA INCLUI OS DE NÍVEL 0. Quem filtra é a tela, com `conquistados` — e ela
 * PRECISA dos de nível zero para desenhar a barra de "faltam N para o primeiro",
 * que é a tela principal desta frente nas primeiras semanas.
 */
export function montarEmblemas(c: Contagem, cfg: ConfigEmblemas): Emblema[] {
  const out: Emblema[] = [];

  for (const [chave, v] of c.porSetor) {
    const nivel = nivelDe(v.entregues, cfg.degraus);
    // Indexação escrita caso a caso, e não `cfg.degraus[nivel]`: a tupla tem
    // três posições e `nivel` chega a 3, então o índice cru é fora do intervalo
    // no nível máximo. O ternário guardava isso em tempo de execução e o
    // compilador não tinha como saber — e um `as` para calá-lo esconderia
    // justamente a leitura fora da tupla.
    const proximoDegrau =
      nivel === 0
        ? cfg.degraus[0]
        : nivel === 1
          ? cfg.degraus[1]
          : nivel === 2
            ? cfg.degraus[2]
            : null;
    const base =
      nivel === 0 ? 0 : nivel === 1 ? cfg.degraus[0] : nivel === 2 ? cfg.degraus[1] : cfg.degraus[2];
    const nomeDoAdmin = cfg.setores[chave]?.nome;

    out.push({
      chave,
      setor: v.rotulo,
      // Setor que o admin nunca nomeou ganha emblema com o nome do PRÓPRIO
      // setor. É silencioso de propósito: um emblema chamado "undefined" ou um
      // setor que some da lista seriam as duas outras saídas, e as duas são
      // piores do que "Infra" enquanto ninguém escolheu um nome melhor.
      nome: nomeDoAdmin || v.rotulo,
      entregues: v.entregues,
      nivel,
      proximoDegrau,
      faltam: proximoDegrau === null ? null : Math.max(0, proximoDegrau - v.entregues),
      // Denominador nunca zero: `base` só iguala `proximoDegrau` se a escada não
      // for crescente, e `normalizarConfigEmblemas` não deixa isso passar. A
      // guarda fica porque o custo dela é uma comparação e o custo de errar é
      // um NaN dentro de um `width:` de CSS.
      progresso:
        proximoDegrau === null || proximoDegrau <= base
          ? 1
          : Math.min(1, Math.max(0, (v.entregues - base) / (proximoDegrau - base))),
    });
  }

  return out.sort(
    (a, b) =>
      b.nivel - a.nivel ||
      b.entregues - a.entregues ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

/** Só os que a pessoa realmente conquistou. Nunca `undefined`. */
export function conquistados(lista: readonly Emblema[]): Emblema[] {
  return lista.filter((e) => e.nivel >= 1);
}

/**
 * Qual emblema está mais perto do próximo degrau — PELA FRAÇÃO, não pelo que
 * falta em números absolutos.
 *
 * 19 de 20 (95% do caminho) está mais perto de virar do que 95 de 100 (90%),
 * mesmo os dois faltando 5. "Faltam menos" apontaria para o segundo e mandaria a
 * pessoa para o degrau mais caro de alcançar.
 */
export function maisPertoDoProximo(lista: readonly Emblema[]): Emblema | null {
  const candidatos = lista.filter((e) => e.proximoDegrau !== null);
  if (candidatos.length === 0) return null;
  return candidatos.reduce((melhor, e) =>
    e.progresso > melhor.progresso ? e : melhor,
  );
}

/**
 * A contagem viu tudo o que precisava ver?
 *
 * A assinatura de `/cards` é escopada pelos setores de QUEM OLHA, nunca pelos da
 * pessoa mostrada — e não dá para ser diferente: a regra de `/cards` é
 * `allow read: if podeNoSetor(cur('sector'))`, e regra que depende do documento
 * NEGA A CONSULTA INTEIRA em vez de filtrar (foi a causa raiz do bug de nomes).
 * Usar os setores da pessoa transformaria todo perfil de outro setor num erro.
 *
 * O que sobra é dizer a verdade na tela: quando a pessoa mostrada trabalha em um
 * setor que quem olha não enxerga, a contagem está incompleta, e o bloco escreve
 * isso em vez de apresentar um número menor como se fosse o número.
 */
export function escopoDaContagem(
  setoresDoVisualizador: readonly string[],
  setoresDaPessoa: readonly string[] | null | undefined,
): { completo: boolean; ausentes: string[] } {
  const vejo = new Set(setoresDoVisualizador);
  const ausentes = [...new Set(setoresDaPessoa ?? [])]
    .filter((s) => s && !vejo.has(s))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { completo: ausentes.length === 0, ausentes };
}
