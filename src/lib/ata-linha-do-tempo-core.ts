/**
 * A linha do tempo das reuniões de um setor — o que ela mede e onde desenha.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` e nada de React aqui
 * dentro. Quem desenha é `linha-do-tempo.tsx`; é isto que permite
 * `scripts/test-ata-linha-do-tempo.mjs` conferir a GEOMETRIA em Node puro — e
 * geometria é justamente o que "ler o código e concluir" erra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE UMA SÉRIE SÓ, E POR QUE ELA É A COR DA MARCA
 *
 * Duas ou três linhas no mesmo eixo pedem uma paleta categórica, e paleta
 * categórica é medida, não escolhida. Neste projeto ela não fecha: `--brand`
 * troca de cor com `[data-accent]` (laranja, azul, bege, terracota), e os cinco
 * status — `--ok` verde, `--warn` âmbar, `--danger` rosa, `--info` azul,
 * `--susp` roxo — já ocupam o resto do círculo. Os trios que sobram e passam no
 * validador de separação para daltonismo nos DOIS modos (aqua/amarelo/violeta,
 * magenta/verde/violeta) colidem com o significado de status dentro do mesmo
 * modal, onde as pílulas de estado da reunião aparecem.
 *
 * A saída não é espremer uma paleta ruim: é uma série só. Sem paleta
 * categórica não há par para separar, o gráfico ganha a forma de ÊNFASE (o que
 * importa na cor da marca, o resto em cinza) — que é exatamente o que a busca
 * por palavra precisa — e a linha passa a "seguir o tema" no sentido literal,
 * porque ela É o acento escolhido. Medido: `--brand` fica acima de 3:1 contra a
 * superfície nos quatro acentos, claro e escuro.
 *
 * O QUE MUDA DE MEDIDA É O EIXO Y, e uma de cada vez. Pauta, decisões e tarefas
 * são contagens da mesma reunião; plotar as três juntas seria pedir ao leitor
 * que comparasse séries que ele quase nunca compara — e a alternativa proibida
 * (dois eixos) é o erro nº 1 de gráfico. Um botão troca a medida.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "PAUTA" E NÃO "ASSUNTOS" — a palavra importa
 *
 * Na tela da ata, "Assunto" tem significado técnico: é o item SEM card, o que
 * ainda não é demanda. Chamar a medida de "assuntos" faria o gráfico parecer
 * contar só esses, quando ele conta TUDO o que a reunião registrou — assunto e
 * demanda. "Pauta" é o nome do conjunto, e é o que o eixo mede.
 *
 * O QUE ENTRA NA CONTA é `ata.itens`, e não a pauta desenhada na tela. São
 * coisas diferentes: a tela junta os itens gravados com as demandas em aberto
 * do quadro, ao vivo. Uma reunião de 2026 passaria a "ter" as demandas abertas
 * de hoje, e a linha do tempo mudaria de forma sozinha toda semana. O que a ata
 * gravou é o que aconteceu; é isso que um registro histórico mede.
 */

import { MES_CURTO, parseISO } from "./datas.ts";
import type { Ata, ItemDeAta } from "./ata-core.ts";

/** O que o eixo Y mede. Uma de cada vez — ver o cabeçalho. */
export type Medida = "pauta" | "decisoes" | "tarefas";

export const MEDIDAS: readonly Medida[] = ["pauta", "decisoes", "tarefas"];

export const MEDIDA_LABEL: Record<Medida, string> = {
  pauta: "Pauta",
  decisoes: "Decisões",
  tarefas: "Tarefas",
};

/** A frase que explica a medida — vai no subtítulo, não numa dica escondida. */
export const MEDIDA_AJUDA: Record<Medida, string> = {
  pauta: "Quantos itens cada reunião registrou — assuntos e demandas juntos.",
  decisoes: "Quantos itens saíram da reunião com uma decisão escrita.",
  tarefas: "Quantas tarefas a reunião gerou, somando todos os itens.",
};

/** Um item da pauta, do tamanho que o balão e a tabela precisam. */
export type ItemNaLinha = {
  id: string;
  /** Título do card quando é demanda; o assunto da ata quando não é. */
  titulo: string;
  ehDemanda: boolean;
  temDecisao: boolean;
  tarefas: number;
  /** Casou a palavra buscada. Sempre `false` quando não há busca. */
  casa: boolean;
};

/** Uma reunião no eixo do tempo. */
export type ReuniaoNaLinha = {
  ataId: string;
  titulo: string;
  /** `aaaa-mm-dd`. */
  data: string;
  /** Milissegundos — a posição no eixo X. Ver `quandoDaAta`. */
  quando: number;
  pauta: number;
  decisoes: number;
  tarefas: number;
  tarefasFeitas: number;
  itens: ItemNaLinha[];
  /** Quantos itens casam a palavra buscada. */
  casam: number;
  /** O TÍTULO da reunião casa a palavra — a reunião conta mesmo com 0 itens. */
  tituloCasa: boolean;
};

/**
 * O instante da reunião no eixo — dia MAIS hora de início.
 *
 * A hora entra por um motivo concreto: duas reuniões do mesmo setor no mesmo
 * dia (uma de manhã, outra à tarde) cairiam exatamente no mesmo X, uma
 * escondendo a outra, e o balão do mouse só saberia mostrar a primeira. Com a
 * hora, elas se separam sozinhas — e a posição fica mais verdadeira, não menos.
 *
 * Sem hora gravada, meio-dia: colocar em 00:00 empurraria a reunião para a
 * borda esquerda do dia e a faria parecer anterior a uma que tem "08:00"
 * escrito.
 *
 * `null` quando não há data — reunião sem data não tem lugar num eixo de tempo,
 * e inventar um (hoje, por exemplo) mentiria sobre quando ela aconteceu.
 */
export function quandoDaAta(data: string, horaInicio: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const base = parseISO(data).getTime();
  const m = /^(\d{2}):(\d{2})$/.exec(horaInicio || "");
  const minutos = m ? Number(m[1]) * 60 + Number(m[2]) : 12 * 60;
  return base + minutos * 60000;
}

/**
 * Sem acento e em minúsculas — a busca de quem digita com pressa.
 *
 * "Decisao" tem de achar "decisão", e "ESTOQUE" tem de achar "estoque". Sem
 * isto, a única busca que funciona é a que já sabe como a palavra foi escrita,
 * que é o oposto de procurar.
 */
export function normalizar(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Todo o texto de um item, para a busca.
 *
 * O TÍTULO DO CARD ENTRA, e é por isso que a função recebe como achá-lo: o item
 * que virou demanda não guarda título nenhum (o nome mora no quadro — ver
 * `ata-core.ts`). Sem isso, buscar "hortifruti" não acharia a reunião que
 * decidiu sobre a demanda "Padronizar o recebimento de hortifrúti" — e é
 * exatamente esse o tipo de pergunta que traz alguém a esta tela.
 */
export function textoBuscavel(item: ItemDeAta, titulo: string): string {
  return normalizar(
    [
      titulo,
      item.assunto,
      item.contexto,
      item.decisao,
      item.objetivo,
      ...item.tarefas.map((t) => `${t.texto} ${t.observacao}`),
    ].join(" "),
  );
}

/**
 * As reuniões do setor viradas em pontos, da mais antiga para a mais nova.
 *
 * A ORDEM AQUI É CRESCENTE, e a da lista da tela é decrescente — de propósito,
 * e são perguntas diferentes. A lista responde "qual reunião abro agora?", e a
 * resposta quase sempre é a última. O eixo responde "como isto andou?", e um
 * eixo de tempo que corre para trás é ilegível.
 */
export function montarLinhaDoTempo(opcoes: {
  atas: readonly Ata[];
  /** Como achar o título de um card. Devolve "" quando ele não está no quadro. */
  tituloDoCard: (cardId: string) => string;
  /** A palavra buscada, ou vazio. */
  termo?: string;
}): { pontos: ReuniaoNaLinha[]; semData: number } {
  const { atas, tituloDoCard } = opcoes;
  const alvo = normalizar(opcoes.termo);
  let semData = 0;

  const pontos: ReuniaoNaLinha[] = [];
  atas.forEach((ata) => {
    const quando = quandoDaAta(ata.data, ata.horaInicio);
    // Reunião sem data não some da tela — ela continua na lista de atas. O que
    // ela não tem é lugar no eixo, e o gráfico DIZ quantas ficaram de fora em
    // vez de deixar a conta não fechar em silêncio.
    if (quando === null) {
      semData++;
      return;
    }

    const itens: ItemNaLinha[] = ata.itens.map((i) => {
      const doQuadro = i.cardId ? tituloDoCard(i.cardId) : "";
      return {
        id: i.id,
        // O card que saiu do quadro não tem título para emprestar; sobra o que
        // a ata guardou, e depois disso a honestidade de dizer que não há nome.
        titulo: doQuadro || i.assunto || "Sem título na ata",
        ehDemanda: !!i.cardId,
        temDecisao: !!i.decisao,
        tarefas: i.tarefas.length,
        casa: !!alvo && textoBuscavel(i, doQuadro).includes(alvo),
      };
    });

    pontos.push({
      ataId: ata.id,
      titulo: ata.titulo,
      data: ata.data,
      quando,
      pauta: itens.length,
      decisoes: itens.filter((i) => i.temDecisao).length,
      tarefas: itens.reduce((s, i) => s + i.tarefas, 0),
      tarefasFeitas: ata.itens.reduce(
        (s, i) => s + i.tarefas.filter((t) => t.status === "concluida").length,
        0,
      ),
      itens,
      casam: itens.filter((i) => i.casa).length,
      tituloCasa: !!alvo && normalizar(ata.titulo).includes(alvo),
    });
  });

  pontos.sort((a, b) => a.quando - b.quando);
  return { pontos, semData };
}

export function valorDa(p: ReuniaoNaLinha, medida: Medida): number {
  return medida === "pauta" ? p.pauta : medida === "decisoes" ? p.decisoes : p.tarefas;
}

/** A reunião entra no destaque da busca? */
export function reuniaoCasa(p: ReuniaoNaLinha): boolean {
  return p.casam > 0 || p.tituloCasa;
}

/** O que a busca achou, para a frase acima do gráfico. */
export function resumoDaBusca(pontos: readonly ReuniaoNaLinha[]): {
  reunioes: number;
  itens: number;
} {
  return {
    reunioes: pontos.filter(reuniaoCasa).length,
    itens: pontos.reduce((s, p) => s + p.casam, 0),
  };
}

/**
 * Marcas de eixo em números redondos — 0, 5, 10 e nunca 0, 3,33, 6,67.
 *
 * O passo sobe pela escada 1 · 2 · 5 × 10ⁿ, que é a que produz número que se lê
 * de relance. Sempre começa em zero: contagem que não parte do zero exagera a
 * variação, e é o segundo jeito mais comum de um gráfico mentir.
 *
 * Com máximo zero (um setor cuja reunião não registrou nada ainda) devolve
 * [0, 1] — um eixo de altura nenhuma faria a linha ser desenhada em cima do
 * próprio eixo.
 *
 * O ÚLTIMO TICK É SEMPRE MAIOR OU IGUAL AO MAIOR VALOR, e isto não é detalhe de
 * arredondamento: é o topo da escala. A primeira versão parava a escada em
 * `max + passo/2`, e com uma pauta de 12 o eixo terminava em 10 — o ponto de 12
 * era desenhado ACIMA do plot, com `cy` negativo, fora do gráfico. Desenhava
 * bem, sem erro nenhum, e simplesmente não estava lá. Quem pegou foi o
 * renderizador, medindo; quem impede a volta é o teste que percorre todos os
 * máximos de 1 a 200.
 */
export function ticksBonitos(max: number, alvo = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const cru = max / Math.max(1, alvo);
  const potencia = Math.pow(10, Math.floor(Math.log10(cru)));
  const norm = cru / potencia;
  const bruto = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * potencia;
  // A contagem é inteira, então o passo também: 0 · 0,5 · 1 seria uma escala
  // que promete meia reunião.
  const passo = Math.max(1, Math.round(bruto));
  const topo = Math.ceil(max / passo) * passo;
  const ticks: number[] = [];
  for (let v = 0; v <= topo; v += passo) ticks.push(v);
  return ticks;
}

export type Caixa = {
  larg: number;
  alt: number;
  margem: { topo: number; dir: number; baixo: number; esq: number };
};

export type Tracado = {
  pts: { x: number; y: number; ponto: ReuniaoNaLinha }[];
  /** O `d` da linha. Vazio quando não há ponto nenhum. */
  linha: string;
  /** O `d` da área sob a linha — a mesma linha, fechada na base. */
  area: string;
  ticksY: { v: number; y: number }[];
  ticksX: { x: number; rotulo: string }[];
  /** O topo do eixo — o último tick, não o maior valor. */
  topo: number;
  plot: { x0: number; x1: number; y0: number; y1: number };
};

/**
 * De contagens para pixels — e é aqui que o teste vale mais do que o olho.
 *
 * SEGMENTOS RETOS, e nunca curva suavizada. Entre duas reuniões não existe
 * valor nenhum: a curva desenharia uma subida gradual em dias em que ninguém se
 * reuniu, que é inventar dado com aparência de dado. Reta liga dois fatos e não
 * afirma nada sobre o meio.
 *
 * UM PONTO SÓ fica no meio do plot, e não colado na esquerda: com um extremo
 * igual ao outro, a régua do tempo não tem o que dividir, e encostar o ponto
 * numa borda sugeriria um "antes" e um "depois" que não existem.
 */
export function tracar(
  pontos: readonly ReuniaoNaLinha[],
  medida: Medida,
  caixa: Caixa,
): Tracado {
  const { larg, alt, margem } = caixa;
  const x0 = margem.esq;
  const x1 = Math.max(x0 + 1, larg - margem.dir);
  const y0 = margem.topo;
  const y1 = Math.max(y0 + 1, alt - margem.baixo);
  const plot = { x0, x1, y0, y1 };

  const valores = pontos.map((p) => valorDa(p, medida));
  const ticks = ticksBonitos(Math.max(0, ...valores));
  const topo = ticks[ticks.length - 1];

  const t0 = pontos.length ? pontos[0].quando : 0;
  const t1 = pontos.length ? pontos[pontos.length - 1].quando : 0;
  const vao = t1 - t0;
  const emX = (quando: number) =>
    vao > 0 ? x0 + ((quando - t0) / vao) * (x1 - x0) : (x0 + x1) / 2;
  const emY = (v: number) => y1 - (v / topo) * (y1 - y0);

  const n = (v: number) => Math.round(v * 100) / 100;
  const pts = pontos.map((p) => ({
    x: n(emX(p.quando)),
    y: n(emY(valorDa(p, medida))),
    ponto: p,
  }));

  const linha = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const area = pts.length
    ? `${linha} L${pts[pts.length - 1].x} ${n(y1)} L${pts[0].x} ${n(y1)} Z`
    : "";

  return {
    pts,
    linha,
    area,
    ticksY: ticks.map((v) => ({ v, y: n(emY(v)) })),
    ticksX: marcasDeTempo(t0, t1, x0, x1, pontos.length),
    topo,
    plot,
  };
}

/**
 * As marcas do eixo do tempo — datas espaçadas por igual, não uma por reunião.
 *
 * Uma marca por reunião é o desenho que se escreve primeiro e que se apaga
 * depois: com dezoito reuniões, dezoito datas se atropelam na borda de baixo. E
 * o eixo é de TEMPO, então marca em intervalo regular é o que diz a verdade
 * sobre a distância entre elas — que é justamente o que uma marca por reunião
 * esconde.
 */
function marcasDeTempo(
  t0: number,
  t1: number,
  x0: number,
  x1: number,
  quantosPontos: number,
): { x: number; rotulo: string }[] {
  if (!quantosPontos) return [];
  const larguraDoPlot = x1 - x0;
  // ~90px por marca: menos que isso, "26 ago" encosta na vizinha.
  const quantas = Math.max(2, Math.min(6, Math.floor(larguraDoPlot / 90)));
  if (t1 <= t0) {
    return [{ x: (x0 + x1) / 2, rotulo: rotuloDeTempo(t0, false) }];
  }
  // Mais de um ano no eixo e "26 ago" deixa de identificar: duas reuniões de
  // agostos diferentes ganhariam a mesma marca.
  const porMes = t1 - t0 > 400 * 86400000;
  return Array.from({ length: quantas }, (_, i) => {
    const q = t0 + ((t1 - t0) * i) / (quantas - 1);
    return {
      x: Math.round((x0 + (larguraDoPlot * i) / (quantas - 1)) * 100) / 100,
      rotulo: rotuloDeTempo(q, porMes),
    };
  });
}

export function rotuloDeTempo(ms: number, porMes: boolean): string {
  const d = new Date(ms);
  return porMes
    ? `${MES_CURTO[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`
    : `${d.getDate()} ${MES_CURTO[d.getMonth()]}`;
}

/**
 * O ponto mais perto de um X — o que faz o balão aparecer sem mira.
 *
 * A alternativa é exigir que o mouse acerte um círculo de 8px, que é o
 * anti-padrão clássico de gráfico interativo: o alvo é menor que a mão. Aqui a
 * faixa inteira do gráfico é alvo, e o ponto respondido é o mais próximo no
 * eixo do tempo.
 */
export function maisPerto(pts: readonly { x: number }[], x: number): number {
  if (!pts.length) return -1;
  let melhor = 0;
  let dist = Math.abs(pts[0].x - x);
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i].x - x);
    if (d < dist) {
      dist = d;
      melhor = i;
    }
  }
  return melhor;
}
