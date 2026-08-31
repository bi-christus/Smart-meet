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

import { MES_CURTO, addDays, startOfDay, startOfWeek } from "./datas.ts";

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

export type Semana = {
  /** Segunda-feira, à meia-noite local. */
  inicio: Date;
  /** Domingo da mesma semana, à meia-noite local. */
  fim: Date;
  /** "13/07" — o que cabe embaixo de uma coluna de gráfico. */
  rotulo: string;
  /** "13 a 19 jul" — a semana INTEIRA, para o tooltip e para o leitor de tela. */
  rotuloLongo: string;
  /** A semana que ainda está correndo: os números dela estão pela metade. */
  parcial: boolean;
};

export type Fluxo = {
  semanas: Semana[];
  entradas: number[];
  entregas: number[];
  /** Fila acumulada no fim de cada semana, já contando o que existia antes. */
  fila: number[];
  /** `entradas[i] - entregas[i]`: positivo é fila crescendo naquela semana. */
  saldo: number[];
  p85: number;
  amostra: number;
  entregas4: number;
  totalEntradas: number;
  totalEntregas: number;
  /** Entregas por semana, contando só as semanas COMPLETAS da janela. */
  vazaoMedia: number;
  /** O que já estava em aberto quando a janela começou. */
  filaInicial: number;
};

/** O recorte de tempo do painel: janela ancorada em hoje, ou datas escolhidas. */
export type Janela =
  | { modo: "recentes"; semanas: number }
  | { modo: "intervalo"; de: string; ate: string };

/** Quantas semanas cada opção do seletor cobre. */
export const PERIODOS = [12, 26, 52] as const;
export type Periodo = (typeof PERIODOS)[number];

export const PERIODO_LABEL: Record<Periodo, string> = {
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

function montarSemana(inicio: Date, hoje: Date, anoRef: number): Semana {
  const fim = addDays(inicio, 6);
  return {
    inicio,
    fim,
    rotulo: `${inicio.getDate()}/${String(inicio.getMonth() + 1).padStart(2, "0")}`,
    rotuloLongo: rotuloSemana(inicio, fim, anoRef),
    // Parcial é a semana que CONTÉM hoje e ainda não fechou no domingo. Janela
    // que termina no passado não tem semana parcial nenhuma: já aconteceu toda.
    parcial:
      inicio.getTime() <= hoje.getTime() &&
      hoje.getTime() < addDays(inicio, 7).getTime(),
  };
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
export function janelaDeSemanas(hoje: Date, janela: Janela): Semana[] {
  const anoRef = anoDe(hoje);
  if (janela.modo === "recentes") {
    const n = Math.max(1, Math.min(MAX_SEMANAS, Math.floor(janela.semanas)));
    const primeira = addDays(startOfWeek(hoje), -(n - 1) * 7);
    return Array.from({ length: n }, (_, i) =>
      montarSemana(addDays(primeira, i * 7), hoje, anoRef),
    );
  }

  const a = parseData(janela.de);
  const b = parseData(janela.ate);
  if (!a || !b) return [];
  const [ini, fim] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  const primeira = startOfWeek(ini);
  const ultima = startOfWeek(fim);
  const total =
    Math.round((ultima.getTime() - primeira.getTime()) / (86400000 * 7)) + 1;
  const n = Math.max(1, Math.min(MAX_SEMANAS, total));
  // Corte pelo FIM: janela grande demais perde as semanas antigas, não as novas.
  const base = addDays(ultima, -(n - 1) * 7);
  return Array.from({ length: n }, (_, i) =>
    montarSemana(addDays(base, i * 7), hoje, anoRef),
  );
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
): Fluxo {
  const semanas = janelaDeSemanas(hoje, janela);
  const n = semanas.length;
  if (!n)
    return {
      semanas,
      entradas: [],
      entregas: [],
      fila: [],
      saldo: [],
      p85: 0,
      amostra: 0,
      entregas4: 0,
      totalEntradas: 0,
      totalEntregas: 0,
      vazaoMedia: 0,
      filaInicial: 0,
    };

  const primeira = semanas[0].inicio.getTime();
  const depoisDoFim = addDays(semanas[n - 1].inicio, 7).getTime();
  const indiceDa = (ms: number) => {
    if (ms < primeira || ms >= depoisDoFim) return -1;
    return Math.floor((ms - primeira) / (86400000 * 7));
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

  // A vazão média ignora a semana em curso: dividir uma semana pela metade pelo
  // mesmo divisor das completas puxa a média para baixo todo início de semana, e
  // o número que serve para prometer prazo passaria a variar conforme o dia em
  // que alguém abriu o Dashboard.
  const completas = semanas.filter((s) => !s.parcial).length;
  const entregasCompletas = entregas.reduce(
    (a, b, i) => a + (semanas[i].parcial ? 0 : b),
    0,
  );

  return {
    semanas,
    entradas,
    entregas,
    fila,
    saldo,
    p85: percentil(
      [...duracoes].sort((a, b) => a - b),
      0.85,
    ),
    amostra: duracoes.length,
    entregas4: entregas.slice(-4).reduce((a, b) => a + b, 0),
    totalEntradas: entradas.reduce((a, b) => a + b, 0),
    totalEntregas: entregas.reduce((a, b) => a + b, 0),
    vazaoMedia: completas ? entregasCompletas / completas : 0,
    filaInicial,
  };
}
