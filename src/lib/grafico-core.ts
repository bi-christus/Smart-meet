/**
 * Escala de eixo: de um máximo qualquer para degraus que uma pessoa lê.
 *
 * Sem SDK e sem React, como todo `*-core` daqui: é aritmética pura, e é testada
 * em `scripts/test-grafico.mjs` no `prebuild`.
 *
 * O problema que ela resolve é pequeno e aparece em toda tela de gráfico. O
 * eixo do fluxo semanal desenhava quatro linhas em frações do maior valor da
 * série e escrevia `Math.round` de cada uma. Com máximo 8 saíam 0, 3, 5, 8 —
 * degraus desiguais, e nenhum deles um número que alguém escolheria. Pior: com
 * máximo 7 saíam 0, 2, 5, 7, e duas linhas ficavam a distâncias diferentes uma
 * da outra, sugerindo uma escala que não existe.
 *
 * A saída é sempre INTEIRA, porque tudo que este app põe em eixo é contagem de
 * demanda — meia demanda não existe, e uma linha escrita "2,5" convida a
 * procurar sentido onde não há.
 */

/**
 * Passos aceitáveis, em ordem. Cada um vale também ×10, ×100…, mas a lista é
 * literal em vez de gerada: ela é curta, e escrita assim dá para conferir de
 * relance que não há um 7 nem um 9 no meio — números que ninguém usa para
 * marcar eixo e que só apareceriam por descuido de fórmula.
 */
const PASSOS = [
  1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200,
  250, 300, 400, 500, 600, 800, 1000,
];

export type Escala = {
  /** O valor da linha mais alta — o que o topo do desenho representa. */
  teto: number;
  /** Todas as linhas, do zero ao teto, inclusive as duas pontas. */
  ticks: number[];
};

/**
 * O menor teto "redondo" que cobre `max` em até `faixas` degraus iguais.
 *
 * `faixas` é um TETO de degraus, não uma quantidade fixa. Quatro linhas para um
 * máximo de 3 dariam 0, 1, 2, 3, 4 — uma linha vazia de sobra e a barra mais
 * alta ocupando 75% da altura à toa. Quando o passo escolhido cobre o dado em
 * menos degraus, o eixo encolhe junto e a série volta a encostar no topo, que é
 * onde a comparação entre barras fica mais fácil de fazer a olho.
 */
export function escalaDoEixo(max: number, faixas = 4): Escala {
  const alvo = Math.max(1, Math.ceil(max));
  const passo = PASSOS.find((p) => p * faixas >= alvo) ?? Math.ceil(alvo / faixas);
  const degraus = Math.ceil(alvo / passo);
  return {
    teto: passo * degraus,
    ticks: Array.from({ length: degraus + 1 }, (_, i) => i * passo),
  };
}
