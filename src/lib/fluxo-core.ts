/**
 * As séries semanais do Dashboard — entradas, entregas e fila — sem Firebase.
 *
 * Isto morava dentro de `dashboard/page.tsx`, num `calcularFluxo` que ninguém
 * conseguia testar sem montar a tela inteira. Saiu de lá quando a janela deixou
 * de ser "as últimas N semanas" e passou a aceitar intervalo escolhido à mão: a
 * conta de encaixar duas datas quaisquer em semanas cheias é exatamente o tipo
 * de regra que erra por um dia e ninguém percebe olhando o gráfico, porque um
 * gráfico deslocado em uma semana continua parecendo um gráfico certo.
 *
 * Não importa `firebase/firestore` de propósito (AGENTS.md §4): o card entra
 * pela forma que interessa (`CardFluxo`), e o `Timestamp` do Firestore satisfaz
 * essa forma sem o SDK precisar aparecer aqui.
 */

import {
  DOW_SHORT,
  MES_CURTO,
  addDays,
  startOfDay,
  startOfWeek,
} from "./datas.ts";

/**
 * O tanto de card que o cálculo lê — e nada além disso.
 *
 * `createdAt` é o `Timestamp` do Firestore, mas descrito estruturalmente. Um
 * `Timestamp` de verdade tem `.seconds`, então ele encaixa aqui sem conversão;
 * o teste passa um objeto literal, e é essa a razão de o tipo ser estrutural.
 */
export type CardFluxo = {
  createdAt?: { seconds?: number } | null;
  enteredAt?: number | null;
};

/**
 * De quanto em quanto tempo a série anda.
 *
 * A semana continua sendo o passo padrão — é a unidade em que o setor conversa
 * ("quantas entraram esta semana?") e a única que aguenta uma janela de um ano
 * sem virar uma parede de barras. O dia entrou porque a semana esconde o que
 * acontece DENTRO dela: uma segunda-feira que recebe trinta demandas e quatro
 * dias parados desenham a mesma coluna de uma semana distribuída, e as duas
 * pedem providências opostas.
 */
export type Granularidade = "dia" | "semana";

/** O nome do passo no singular, para o texto que fala de uma coluna. */
export const PASSO_LABEL: Record<Granularidade, string> = {
  dia: "dia",
  semana: "semana",
};

/** O mesmo no plural, para o texto que fala da janela inteira. */
export const PASSO_PLURAL: Record<Granularidade, string> = {
  dia: "dias",
  semana: "semanas",
};

/**
 * "um dia" · "uma semana" — o passo com o artigo certo.
 *
 * Existe porque `um ${PASSO_LABEL[g]}` monta "um semana", e concordância errada
 * num botão de dois é o tipo de defeito que passa em revisão de código e não
 * passa na tela. Aqui as duas formas estão escritas, não deduzidas.
 */
export const PASSO_UM: Record<Granularidade, string> = {
  dia: "um dia",
  semana: "uma semana",
};

/**
 * Uma coluna da série — um dia ou uma semana, conforme a granularidade.
 *
 * Chamava-se `Semana` enquanto só existia um passo. O nome mudou porque o tipo
 * mudou de significado, e tipo com nome que mente é pior do que tipo sem nome:
 * a próxima pessoa a ler `semanas[i].parcial` num gráfico por dia concluiria
 * que o campo fala de outra coisa.
 */
export type Passo = {
  /** Início do passo, à meia-noite local (segunda-feira, quando é semana). */
  inicio: Date;
  /** Último dia do passo, à meia-noite local (o próprio dia, quando é dia). */
  fim: Date;
  /**
   * `aaaa-mm-dd` do início — identidade do passo, nunca texto de tela.
   *
   * É ela que vai na `key` do React. Os dois rótulos REPETEM de um ano para o
   * outro ("13–19/07" existe em 2025 e em 2026), e a janela por datas alcança
   * cinco anos: com o rótulo na chave, dois passos distintos passariam a
   * disputar o mesmo nó, e o React reaproveitaria a coluna errada.
   */
  chave: string;
  /** "13–19/07" ou "13/07" — o rótulo curto, que vai embaixo da coluna. */
  rotulo: string;
  /** "13 a 19 jul" ou "seg, 13 jul" — por extenso, para tooltip e leitor de tela. */
  rotuloLongo: string;
  /** O passo que ainda está correndo: os números dele estão pela metade. */
  parcial: boolean;
};

export type Fluxo = {
  /** A granularidade com que estas séries foram contadas. */
  granularidade: Granularidade;
  passos: Passo[];
  entradas: number[];
  entregas: number[];
  /** Fila acumulada no fim de cada semana, já contando o que existia antes. */
  fila: number[];
  /** `entradas[i] - entregas[i]`: positivo é fila crescendo naquela semana. */
  saldo: number[];
  p85: number;
  amostra: number;
  totalEntradas: number;
  totalEntregas: number;
  /** Entregas por passo, contando só os passos COMPLETOS da janela. */
  vazaoMedia: number;
  /** O que já estava em aberto quando a janela começou. */
  filaInicial: number;
};

/** O recorte de tempo do painel: janela ancorada em hoje, ou datas escolhidas. */
export type Janela =
  | { modo: "recentes"; semanas: number }
  | { modo: "intervalo"; de: string; ate: string };

/** Quantas semanas cada opção do seletor cobre. */
export const PERIODOS = [4, 12, 26, 52] as const;
export type Periodo = (typeof PERIODOS)[number];

export const PERIODO_LABEL: Record<Periodo, string> = {
  // Quatro semanas entrou junto com a leitura por dia: 28 colunas se leem uma a
  // uma, e 84 (que é o que as 12 semanas viram em dias) já não. Sem uma janela
  // curta, a granularidade por dia nasceria útil só no papel.
  4: "Últimas 4 semanas",
  12: "Últimas 12 semanas",
  26: "Últimos 6 meses",
  52: "Últimos 12 meses",
};

/**
 * Teto de semanas que a janela personalizada pode gerar.
 *
 * Não é medo de estourar memória: 260 barras num SVG de 1120 unidades dariam
 * 4px de passo, e o gráfico deixaria de ser legível muito antes de ficar lento.
 * Cinco anos também é mais do que o app tem de dados. Quando o intervalo passa
 * daqui, a janela é cortada pelo FIM — as semanas mais recentes ficam, porque é
 * de lá que vem a leitura que interessa.
 */
export const MAX_SEMANAS = 260;

/**
 * O mesmo teto, por granularidade.
 *
 * O do dia é mais apertado pelo mesmo motivo, aplicado a um passo sete vezes
 * menor: 400 colunas num SVG de 1120 unidades já dão menos de 3px por dia. Um
 * ano de dias cabe; cinco, não — e cinco anos de dias é uma pergunta que se faz
 * por semana, não por dia.
 */
export const MAX_PASSOS: Record<Granularidade, number> = {
  semana: MAX_SEMANAS,
  dia: 400,
};

function anoDe(d: Date): number {
  return d.getFullYear();
}

/**
 * "13 a 19 jul" · "29 set a 5 out" · "29 dez 2025 a 4 jan 2026".
 *
 * O ano só aparece quando a semana não é do ano de referência, e aí aparece nos
 * DOIS lados: numa semana que atravessa o réveillon, escrever o ano só numa das
 * pontas seria pior que omitir — o leitor completaria a outra com o ano errado.
 */
export function rotuloSemana(inicio: Date, fim: Date, anoRef: number): string {
  const foraDoAno = anoDe(inicio) !== anoRef || anoDe(fim) !== anoRef;
  const parte = (d: Date) =>
    `${d.getDate()} ${MES_CURTO[d.getMonth()]}${foraDoAno ? ` ${anoDe(d)}` : ""}`;
  // Mesmo mês, mesmo ano, ano corrente: o mês sai só da segunda ponta ("13 a 19
  // jul"). Repeti-lo seria metade do rótulo dizendo o que a outra metade já diz.
  if (
    inicio.getMonth() === fim.getMonth() &&
    anoDe(inicio) === anoDe(fim) &&
    !foraDoAno
  )
    return `${inicio.getDate()} a ${parte(fim)}`;
  return `${parte(inicio)} a ${parte(fim)}`;
}

/**
 * "13–19/07" · "29/09–05/10" — o rótulo do eixo x.
 *
 * Era só a segunda-feira ("13/07"), e o eixo inteiro lia como uma fileira de
 * DIAS: quem batia o olho entendia "3 demandas no dia 13", não "3 na semana de
 * 13 a 19". A frase embaixo do eixo dizia que a coluna era uma semana, mas o
 * número em cima dela continuava dizendo o contrário — e, entre uma legenda e
 * um número, ganha o número.
 *
 * Dentro do mesmo mês o mês sai uma vez só, no fim ("13–19/07"), porque
 * repeti-lo custaria três caracteres em cada rótulo — e é a largura do rótulo
 * que decide quantas semanas o eixo consegue nomear antes de ter de pular de
 * duas em duas. Travessão, e não hífen: é intervalo, não composição.
 */
export function rotuloEixo(inicio: Date, fim: Date): string {
  const dd = (d: Date) => String(d.getDate()).padStart(2, "0");
  const mm = (d: Date) => String(d.getMonth() + 1).padStart(2, "0");
  return inicio.getMonth() === fim.getMonth()
    ? `${dd(inicio)}–${dd(fim)}/${mm(fim)}`
    : `${dd(inicio)}/${mm(inicio)}–${dd(fim)}/${mm(fim)}`;
}

/**
 * "seg, 13 jul" · "qua, 31 dez 2025" — o dia por extenso.
 *
 * O dia da semana vem junto, e não é enfeite: numa série por dia, o vale que
 * mais aparece é o do fim de semana, e sem o "sáb"/"dom" no tooltip a leitura
 * vira "caiu de 8 para 0, o que houve?" toda sexta-feira. O ano, como no rótulo
 * de semana, só entra quando o dia é de outro ano que não o de referência.
 */
export function rotuloDia(d: Date, anoRef: number): string {
  const ano = anoDe(d) !== anoRef ? ` ${anoDe(d)}` : "";
  return `${DOW_SHORT[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MES_CURTO[d.getMonth()]}${ano}`;
}

/** "13/07" — o rótulo do eixo x quando cada coluna é um dia. */
export function rotuloEixoDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/** Quantos dias o passo cobre. É o que transforma "semana" em aritmética. */
function diasDoPasso(gran: Granularidade): number {
  return gran === "dia" ? 1 : 7;
}

function montarPasso(
  inicio: Date,
  hoje: Date,
  anoRef: number,
  gran: Granularidade,
): Passo {
  const dias = diasDoPasso(gran);
  const fim = addDays(inicio, dias - 1);
  return {
    inicio,
    fim,
    chave: isoDe(inicio),
    rotulo: gran === "dia" ? rotuloEixoDia(inicio) : rotuloEixo(inicio, fim),
    rotuloLongo:
      gran === "dia" ? rotuloDia(inicio, anoRef) : rotuloSemana(inicio, fim, anoRef),
    // Parcial é o passo que CONTÉM hoje e ainda não fechou. Janela que termina
    // no passado não tem passo parcial nenhum: já aconteceu todo.
    parcial:
      inicio.getTime() <= hoje.getTime() &&
      hoje.getTime() < addDays(inicio, dias).getTime(),
  };
}

/** Onde o passo que contém esta data começa. */
function inicioDoPasso(d: Date, gran: Granularidade): Date {
  return gran === "dia" ? startOfDay(d) : startOfWeek(d);
}

/**
 * `aaaa-mm-dd` em `Date` local, ou `null` se não for uma data de verdade.
 *
 * Não usa `parseISO` de `datas.ts`: aquele confia no formato e devolve
 * `Invalid Date` para lixo, e aqui a entrada vem de um `input` que o usuário
 * pode esvaziar no meio da digitação. O `null` é o estado "ainda não escolheu",
 * e ele precisa ser distinguível de "escolheu 1º de janeiro".
 */
export function parseData(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (
    dt.getFullYear() !== Number(y) ||
    dt.getMonth() !== Number(mo) - 1 ||
    dt.getDate() !== Number(d)
  )
    return null; // 31/02 e afins, que o `Date` aceita rolando para março
  return startOfDay(dt);
}

/** `Date` de volta em `aaaa-mm-dd`, que é o que o `input type=date` lê. */
export function isoDe(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * As semanas da janela, sempre de segunda a domingo, sempre pelo menos uma.
 *
 * O intervalo escolhido à mão é ENCAIXADO em semanas cheias: quem digita 15/07
 * a 20/07 (uma terça e um domingo) recebe a semana de 13 a 19 mais a de 20 a 26.
 * Recortar a semana pela data digitada daria uma coluna de dois dias ao lado de
 * colunas de sete, desenhadas com a mesma largura — comparar altura de barra que
 * soma períodos diferentes é a forma mais silenciosa de mentir num gráfico.
 *
 * Fim antes do início não é erro que precise de tela: as pontas trocam de lugar.
 * Quem escolhe data num seletor passa, sim, pelo estado em que a segunda data
 * ainda é anterior à primeira — e um painel que pisca "sem dados" no meio da
 * digitação é pior do que um painel que mostra o intervalo pedido.
 */
export function janelaDePassos(
  hoje: Date,
  janela: Janela,
  gran: Granularidade = "semana",
): Passo[] {
  const anoRef = anoDe(hoje);
  const dias = diasDoPasso(gran);
  const teto = MAX_PASSOS[gran];
  const montar = (base: Date, n: number) =>
    Array.from({ length: n }, (_, i) =>
      montarPasso(addDays(base, i * dias), hoje, anoRef, gran),
    );

  if (janela.modo === "recentes") {
    // `semanas` continua sendo o tamanho da janela EM SEMANAS, granularidade à
    // parte: trocar de "por semana" para "por dia" tem de manter o recorte de
    // tempo no lugar e mudar só a espessura da fatia. Um seletor que mudasse as
    // duas coisas ao mesmo tempo seria impossível de usar para comparar.
    const semanas = Math.max(1, Math.floor(janela.semanas));
    const n = Math.max(1, Math.min(teto, (semanas * 7) / dias));
    const primeira = addDays(inicioDoPasso(hoje, gran), -(n - 1) * dias);
    return montar(primeira, n);
  }

  const a = parseData(janela.de);
  const b = parseData(janela.ate);
  if (!a || !b) return [];
  const [ini, fim] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  const primeira = inicioDoPasso(ini, gran);
  const ultima = inicioDoPasso(fim, gran);
  const total =
    Math.round((ultima.getTime() - primeira.getTime()) / (86400000 * dias)) + 1;
  const n = Math.max(1, Math.min(teto, total));
  // Corte pelo FIM: janela grande demais perde os passos antigos, não os novos.
  return montar(addDays(ultima, -(n - 1) * dias), n);
}

/**
 * A janela em semanas — o que a tela chama quando precisa só das datas-limite.
 *
 * Continua existindo porque é a pergunta que `escolherJanela` faz para
 * pré-preencher os campos de data, e ali a granularidade não importa: o começo
 * da janela de 12 semanas é o mesmo, esteja o gráfico desenhando dias ou
 * semanas.
 */
export function janelaDeSemanas(hoje: Date, janela: Janela): Passo[] {
  return janelaDePassos(hoje, janela, "semana");
}

/**
 * O intervalo que a janela cobre de verdade, em milissegundos: `[ini, fim)`.
 *
 * É o que permite ao recorte de tempo valer para os painéis que NÃO desenham
 * série — prazos, carga, divisão por tipo. Sem isto, o seletor de período
 * mudaria um painel e deixaria os outros quatro falando de outro recorte, que é
 * o defeito que ele existe para consertar.
 */
export function limitesDaJanela(
  passos: readonly Passo[],
): { ini: number; fim: number } | null {
  if (!passos.length) return null;
  const ultimo = passos[passos.length - 1];
  return {
    ini: passos[0].inicio.getTime(),
    // O fim é EXCLUSIVO, e vale o dia seguinte ao último: `fim` é meia-noite do
    // último dia, e comparar contra ele jogaria fora tudo o que aconteceu nele.
    fim: addDays(ultimo.fim, 1).getTime(),
  };
}

/**
 * Esta demanda estava VIVA em algum momento da janela?
 *
 * A pergunta não é "nasceu dentro dela". Uma demanda aberta em março e ainda
 * parada hoje é o caso que mais interessa a quem olha prazos e carga, e um
 * recorte que a descartasse por causa da data de nascimento esconderia
 * justamente o que está atrasado há mais tempo. Então:
 *
 *   - nasceu depois do fim da janela → fora (ainda não existia);
 *   - foi entregue antes do começo   → fora (já tinha acabado);
 *   - qualquer outro caso            → dentro.
 *
 * Com a janela padrão terminando hoje, isto devolve exatamente o conjunto que a
 * tela mostrava antes de o recorte existir — a mudança não reescreve nenhum
 * número de quem não mexer no seletor.
 */
export function ativaNaJanela<C extends CardFluxo>(
  c: C,
  entregueEm: number | null,
  ini: number,
  fim: number,
): boolean {
  const nasceu = criadoEm(c);
  if (nasceu !== null && nasceu >= fim) return false;
  if (entregueEm !== null && entregueEm < ini) return false;
  return true;
}

export function criadoEm(c: CardFluxo): number | null {
  if (c.createdAt?.seconds) return c.createdAt.seconds * 1000;
  return c.enteredAt ?? null;
}

export function percentil(ordenado: number[], p: number): number {
  if (!ordenado.length) return 0;
  const i = Math.min(ordenado.length - 1, Math.floor(p * ordenado.length));
  return ordenado[i];
}

/**
 * As séries da janela, a partir do que o app guarda — e só do que ele guarda.
 *
 * Ver o cabeçalho de `dashboard/page.tsx`: não existe histórico de movimentação,
 * então entrada é a criação do card e entrega é o momento em que ele entrou na
 * etapa de entrega. É aproximação declarada, não número exato disfarçado.
 *
 * Genérica em `C` por causa do `concluido`: quem chama passa o `Card` inteiro do
 * Kanban, e um predicado sobre `Card` NÃO é um predicado sobre `CardFluxo` — ele
 * promete ler campos que a forma mínima não tem. Amarrar os dois ao mesmo `C`
 * mantém a checagem de pé; a alternativa seria um `as` na chamada, que é o mesmo
 * erro com a mensagem desligada.
 */
export function calcularFluxo<C extends CardFluxo>(
  cards: C[],
  concluido: (c: C) => boolean,
  hoje: Date,
  janela: Janela,
  gran: Granularidade = "semana",
): Fluxo {
  const passos = janelaDePassos(hoje, janela, gran);
  const n = passos.length;
  if (!n)
    return {
      granularidade: gran,
      passos,
      entradas: [],
      entregas: [],
      fila: [],
      saldo: [],
      p85: 0,
      amostra: 0,
      totalEntradas: 0,
      totalEntregas: 0,
      vazaoMedia: 0,
      filaInicial: 0,
    };

  const dias = diasDoPasso(gran);
  const primeira = passos[0].inicio.getTime();
  const depoisDoFim = addDays(passos[n - 1].inicio, dias).getTime();
  const indiceDa = (ms: number) => {
    if (ms < primeira || ms >= depoisDoFim) return -1;
    return Math.floor((ms - primeira) / (86400000 * dias));
  };

  const entradas = new Array<number>(n).fill(0);
  const entregas = new Array<number>(n).fill(0);
  /** Dias entre criação e conclusão, uma entrada por card entregue no período. */
  const duracoes: number[] = [];
  let filaInicial = 0;

  cards.forEach((c) => {
    const nasceu = criadoEm(c);
    const entregue = concluido(c) ? (c.enteredAt ?? null) : null;

    if (nasceu !== null) {
      const i = indiceDa(nasceu);
      if (i >= 0) entradas[i]++;
      // Fila que já existia quando a janela começou.
      else if (nasceu < primeira && (entregue === null || entregue >= primeira))
        filaInicial++;
    }

    if (entregue !== null) {
      const i = indiceDa(entregue);
      if (i >= 0) {
        entregas[i]++;
        if (nasceu !== null && entregue >= nasceu)
          duracoes.push(Math.max(0, Math.round((entregue - nasceu) / 86400000)));
      }
    }
  });

  const fila: number[] = [];
  const saldo: number[] = [];
  let acc = filaInicial;
  for (let i = 0; i < n; i++) {
    acc = Math.max(0, acc + entradas[i] - entregas[i]);
    fila.push(acc);
    saldo.push(entradas[i] - entregas[i]);
  }

  // A vazão média ignora o passo em curso: dividir um passo pela metade pelo
  // mesmo divisor dos completos puxa a média para baixo todo início de semana, e
  // o número que serve para prometer prazo passaria a variar conforme o dia em
  // que alguém abriu o Dashboard.
  const completas = passos.filter((s) => !s.parcial).length;
  const entregasCompletas = entregas.reduce(
    (a, b, i) => a + (passos[i].parcial ? 0 : b),
    0,
  );

  return {
    granularidade: gran,
    passos,
    entradas,
    entregas,
    fila,
    saldo,
    p85: percentil(
      [...duracoes].sort((a, b) => a - b),
      0.85,
    ),
    amostra: duracoes.length,
    totalEntradas: entradas.reduce((a, b) => a + b, 0),
    totalEntregas: entregas.reduce((a, b) => a + b, 0),
    vazaoMedia: completas ? entregasCompletas / completas : 0,
    filaInicial,
  };
}
