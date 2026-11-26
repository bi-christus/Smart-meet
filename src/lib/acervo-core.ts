/**
 * Como o acervo de reuniões se organiza na tela — sem Firebase.
 *
 * O acervo era uma grade só, com as 93 reuniões soltas, sem nenhum cabeçalho:
 * a ordem vinha escondida da consulta (`date` decrescente, sem desempate) e o
 * setor aparecia como texto cinza no meio da linha. Achar "a reunião de
 * Infraestrutura de setembro" era rolar a tela inteira lendo cinza.
 *
 * A organização pedida (Ítalo, 26/11/2026) é POR SETOR e, dentro dele, POR MÊS,
 * com uma segunda visão só POR DATA. Agrupar e ordenar é regra que erra CALADA
 * — a tela continua bonita com a reunião no mês errado — e por isso mora aqui,
 * com teste, e não no componente.
 *
 * TRÊS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. Os grupos saem das REUNIÕES, nunca da lista de setores da pessoa. O admin
 *    enxerga os 7 setores do cadastro e só 4 têm reunião: partir da lista
 *    desenharia 3 pastas vazias, e pasta vazia num acervo lê como "sumiu".
 * 2. Com no máximo UM setor com reunião, o nível de setor some. É o caso de
 *    9 das 14 pessoas: para elas, uma pasta única com o nome do próprio setor é
 *    um clique a mais para chegar no que já era tudo.
 * 3. O mês é o do campo `date` (o dia da reunião, que a pessoa escolhe), e não
 *    o de `createdAt`. Em 7 reuniões os dois discordam; a reunião de 30/09
 *    enviada em 02/10 é de setembro para quem procura.
 */

import { casaBusca, ordenarRecentes, type ReuniaoNaTela } from "./relatorios-core.ts";
import { normalizar } from "./discord-consulta-core.ts";
import { rotuloMes } from "./temporadas-core.ts";
import { MES_CURTO } from "./datas.ts";
import { chaveDoSetor } from "./selo-setor-core.ts";

export type ReuniaoDoAcervo = ReuniaoNaTela;

/** A chave do balde das reuniões sem data válida. Fica sempre no FIM. */
export const SEM_DATA = "sem-data";

/**
 * As partes de um `aaaa-mm-dd` de verdade, ou `null`.
 *
 * O formulário da reunião não valida a data (`MeetingModal` grava o que vier,
 * inclusive vazio). Hoje há 0 casos, mas sem esta conferência uma data torta
 * viraria "undefined de 2026" no cabeçalho — ou sumiria, que é pior.
 */
function partesDaData(date: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return [ano, mes, dia];
}

/** `aaaa-mm` do dia da reunião, ou `SEM_DATA`. */
export function mesDaReuniao(date: string): string {
  return partesDaData(date) ? date.slice(0, 7) : SEM_DATA;
}

/**
 * "Novembro de 2026" — ou "Sem data" para o balde do fim.
 *
 * Não se chama `rotuloDoMes`, que é o de `concluidas-core.ts` e recebe um
 * instante em ms: o mesmo nome com outro argumento é a troca de import que só o
 * `tsc` pega — e pega tarde, depois de alguém já ter estranhado a tela.
 */
export function rotuloDaChaveDoMes(chave: string): string {
  return chave === SEM_DATA ? "Sem data" : rotuloMes(chave);
}

/**
 * "25 nov", ou `null` quando a data não é data.
 *
 * Sem o ano de propósito: a reunião aparece sempre debaixo do cabeçalho do mês,
 * que já diz o ano. `fmtDayMonth` de `datas.ts` não serve aqui: para data
 * vazia ou torta devolve "1 jan" (uma data plausível e falsa), e "NaN
 * undefined" quando o campo nem existe — e é justamente o caso que o balde
 * existe para mostrar.
 */
export function diaDaReuniao(date: string): string | null {
  const p = partesDaData(date);
  return p ? `${p[2]} ${MES_CURTO[p[1] - 1]}` : null;
}

export type MesDoAcervo<T> = {
  /** `aaaa-mm` ou `SEM_DATA`. */
  chave: string;
  rotulo: string;
  itens: T[];
};

export type SetorDoAcervo = {
  /** A chave normalizada (`chaveDoSetor`): "B.I." e "b.i." caem na mesma. */
  chave: string;
  /** O nome como está escrito — "B.I." com os pontos. */
  setor: string;
  /** Quantas reuniões o setor tem, sem busca. */
  total: number;
};

export type SecaoDoAcervo<T> = SetorDoAcervo & {
  /** Quantas casam com a busca — o número do cabeçalho da seção. */
  encontradas: number;
  meses: MesDoAcervo<T>[];
};

export type Acervo<T> = {
  /** Reuniões ao todo, antes da busca. Zero aqui é "não há reunião nenhuma". */
  totalGeral: number;
  /**
   * Se o nível de setor aparece: há mais de um setor com reunião.
   *
   * Sai do conjunto INTEIRO, nunca do resultado da busca. Se saísse da busca,
   * digitar uma palavra que só existe em B.I. faria as seções sumirem e a tela
   * inteira mudar de forma no meio da digitação.
   */
  porSetor: boolean;
  /** Os setores com reunião, na ordem das seções — é a lista dos filtros. */
  setores: SetorDoAcervo[];
  /** Visão por setor: só as seções com resultado na busca. */
  secoes: SecaoDoAcervo<T>[];
  /** Quantas reuniões casam com a busca (sem o filtro de setor). */
  encontradas: number;
  /** Visão por data: os meses, com a busca e o filtro de setor aplicados. */
  meses: MesDoAcervo<T>[];
  /** Quantas reuniões a visão por data mostra. */
  naVisaoPorData: number;
  /**
   * O filtro de setor que VALEU, ou `null` (todas).
   *
   * Pode diferir do pedido: o setor escolhido pode ter perdido a última
   * reunião (apagada), ou a pessoa pode ter um setor só. Filtro que não
   * corresponde a nada na tela esconderia tudo sem dizer por quê.
   */
  filtro: string | null;
};

/** Mais recente primeiro; o balde sem data no fim. */
function ordenarMeses<T>(meses: MesDoAcervo<T>[]): MesDoAcervo<T>[] {
  return meses.sort((a, b) => {
    if (a.chave === SEM_DATA) return 1;
    if (b.chave === SEM_DATA) return -1;
    return b.chave.localeCompare(a.chave);
  });
}

export function porMes<T extends ReuniaoDoAcervo>(itens: readonly T[]): MesDoAcervo<T>[] {
  const meses = new Map<string, T[]>();
  for (const r of ordenarRecentes([...itens])) {
    const chave = mesDaReuniao(r.date);
    const lista = meses.get(chave);
    if (lista) lista.push(r);
    else meses.set(chave, [r]);
  }
  return ordenarMeses(
    [...meses.entries()].map(([chave, lista]) => ({
      chave,
      rotulo: rotuloDaChaveDoMes(chave),
      itens: lista,
    })),
  );
}

/**
 * Se a reunião responde ao termo buscado — `casaBusca` de Relatórios IA, mais o
 * setor pela CHAVE.
 *
 * Só `casaBusca` não basta aqui: o `normalizar` dela guarda a pontuação, então
 * "bi" não achava nenhuma reunião de "B.I." — logo acima da seção que se chama
 * B.I. e cujo selo é o mesmo de "BI". Esta tela afirma que as três grafias são
 * um setor só, e a busca tem de concordar com ela.
 *
 * `casaBusca` fica como está, e não ganha esta regra: Relatórios IA não faz a
 * promessa das grafias, e mexer nela mudaria o que a outra tela acha. Cada
 * palavra casa se `casaBusca` a aceitar sozinha — chamada, e não copiada, para
 * as duas buscas não se separarem no dia em que a de lá mudar — OU, sem
 * pontuação, dentro da chave do setor. A palavra que é só pontuação ("-") vira
 * chave vazia e não vale pela segunda via — "" está contido em tudo, e um traço
 * digitado acharia o acervo inteiro.
 */
function casaAcervo(r: ReuniaoDoAcervo, termo: string): boolean {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  const setor = chaveDoSetor(r.sector);
  return palavras.every((p) => {
    if (casaBusca(r, p)) return true;
    const chave = chaveDoSetor(p);
    return chave !== "" && setor.includes(chave);
  });
}

/**
 * O nome que a seção mostra: a grafia MAIS USADA entre as reuniões dela.
 *
 * Não a primeira que apareceu (que é a ordem do Firestore, e muda entre
 * cargas) nem a da mais recente (uma reunião com "b.i." digitado à mão
 * rebatizaria a seção de 67 reuniões com "B.I."). Empate desfeito pela ordem
 * pt-BR, para o rótulo não depender de quem chegou primeiro.
 */
function grafiaMaisUsada(grafias: Map<string, number>): string {
  return [...grafias.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
  )[0][0];
}

/**
 * Organiza o acervo nas duas visões de uma vez.
 *
 * As duas saem juntas porque dividem o mesmo trabalho (a busca e a ordem dos
 * setores) e porque a tela troca de uma para outra sem nova consulta.
 *
 * @param busca  termo livre; casa título OU setor (`casaAcervo`: a regra de
 *               Relatórios IA — "a do RH" é tão comum quanto "a do orçamento" —
 *               mais "bi" achando "B.I.").
 * @param setor  chave (`chaveDoSetor`) do filtro da visão por data; `null` é
 *               todas.
 */
export function montarAcervo<T extends ReuniaoDoAcervo>(
  reunioes: readonly T[],
  { busca = "", setor = null }: { busca?: string; setor?: string | null } = {},
): Acervo<T> {
  type Grupo = { grafias: Map<string, number>; todas: T[]; recente: string };
  const grupos = new Map<string, Grupo>();
  for (const r of reunioes) {
    const chave = chaveDoSetor(r.sector);
    let g = grupos.get(chave);
    if (!g) {
      g = { grafias: new Map(), todas: [], recente: "" };
      grupos.set(chave, g);
    }
    g.grafias.set(r.sector, (g.grafias.get(r.sector) ?? 0) + 1);
    g.todas.push(r);
    // Só data válida conta para "mais recente": uma torta ("2026-99-99")
    // ganharia de todas na comparação de texto e jogaria o setor para o topo.
    if (mesDaReuniao(r.date) !== SEM_DATA && r.date > g.recente) g.recente = r.date;
  }

  /**
   * A ordem das seções: o setor que teve reunião mais recente primeiro.
   *
   * Alfabética seria estável, mas poria "B.I." sempre em cima mesmo num mês em
   * que só Infraestrutura se reuniu — e a primeira seção é a única que nasce
   * aberta. Pela mais recente, abrir a tela mostra o que acabou de acontecer.
   * Empate (mesmo dia) desfeito pela ordem pt-BR do nome.
   */
  const ordem = [...grupos.entries()]
    .map(([chave, g]) => ({ chave, g, setor: grafiaMaisUsada(g.grafias) }))
    .sort(
      (a, b) =>
        b.g.recente.localeCompare(a.g.recente) ||
        a.setor.localeCompare(b.setor, "pt-BR"),
    );

  const setores: SetorDoAcervo[] = ordem.map(({ chave, g, setor }) => ({
    chave,
    setor,
    total: g.todas.length,
  }));
  const porSetor = setores.length > 1;

  const secoes: SecaoDoAcervo<T>[] = [];
  let encontradas = 0;
  for (const { chave, g, setor } of ordem) {
    const achadas = g.todas.filter((r) => casaAcervo(r, busca));
    encontradas += achadas.length;
    if (achadas.length === 0) continue;
    secoes.push({
      chave,
      setor,
      total: g.todas.length,
      encontradas: achadas.length,
      meses: porMes(achadas),
    });
  }

  const filtro =
    porSetor && setor !== null && grupos.has(setor) ? setor : null;
  const daData = reunioes.filter(
    (r) =>
      (filtro === null || chaveDoSetor(r.sector) === filtro) &&
      casaAcervo(r, busca),
  );

  return {
    totalGeral: reunioes.length,
    porSetor,
    setores,
    secoes,
    encontradas,
    meses: porMes(daData),
    naVisaoPorData: daData.length,
    filtro,
  };
}
