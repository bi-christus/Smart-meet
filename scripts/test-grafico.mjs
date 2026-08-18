/**
 * Testes de `src/lib/grafico-core.ts`.
 *
 * Eixo errado é da mesma família de erro que data errada: não quebra a tela,
 * não cai no log, e entrega um desenho com cara de desenho certo. Uma barra
 * medida contra um teto que não é o teto continua sendo uma barra bonita — só
 * que a comparação entre ela e a vizinha passa a mentir, e ninguém confere
 * régua de gráfico.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { escalaDoEixo } from "../src/lib/grafico-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

function eixo(max, faixas) {
  const e = escalaDoEixo(max, faixas);
  return `${e.teto}|${e.ticks.join(",")}`;
}

// ---- a promessa central: o teto COBRE o dado, sempre --------------------
// Um teto abaixo do máximo desenharia a barra maior atravessando o topo do
// gráfico. É o único erro daqui que produz pixel visivelmente quebrado, e é o
// que a varredura abaixo fecha para toda contagem plausível de demanda.
{
  let cobre = true;
  let inteiros = true;
  let dentroDoLimite = true;
  for (let max = 0; max <= 2000; max++) {
    const { teto, ticks } = escalaDoEixo(max);
    if (teto < max) cobre = false;
    if (!ticks.every(Number.isInteger)) inteiros = false;
    if (ticks.length > 5) dentroDoLimite = false;
  }
  checa("o teto nunca fica abaixo do máximo, de 0 a 2000", cobre);
  checa("todo degrau é inteiro — contagem de demanda não tem metade", inteiros);
  checa("nunca passa de `faixas` degraus (4 + o zero)", dentroDoLimite);
}

// ---- os degraus são iguais e começam no zero ----------------------------
{
  let regulares = true;
  for (let max = 1; max <= 2000; max++) {
    const { ticks } = escalaDoEixo(max);
    if (ticks[0] !== 0) regulares = false;
    const p = ticks[1] - ticks[0];
    for (let i = 2; i < ticks.length; i++)
      if (ticks[i] - ticks[i - 1] !== p) regulares = false;
  }
  checa("os degraus são iguais entre si e o primeiro é zero", regulares);
}

// ---- os casos que o eixo antigo desenhava torto -------------------------
checa("máximo 8 vira 0,2,4,6,8", eixo(8) === "8|0,2,4,6,8");
checa("máximo 7 sobe para o mesmo 8, sem degrau quebrado", eixo(7) === "8|0,2,4,6,8");
checa("máximo 13 vira 0,4,8,12,16", eixo(13) === "16|0,4,8,12,16");
checa("máximo 30 vira 0,8,16,24,32", eixo(30) === "32|0,8,16,24,32");
checa("máximo 100 cai redondo em 0,25,50,75,100", eixo(100) === "100|0,25,50,75,100");

// ---- séries pequenas encolhem o eixo em vez de sobrar linha ------------
// Uma semana com uma demanda só não pode desenhar uma barra de 25% de altura
// contra um teto 4 inventado: o painel passa a parecer vazio quando não está.
checa("máximo 1 usa um degrau só", eixo(1) === "1|0,1");
checa("máximo 3 usa três degraus de 1", eixo(3) === "3|0,1,2,3");
checa("máximo 5 encolhe para 0,2,4,6", eixo(5) === "6|0,2,4,6");

// ---- as bordas ---------------------------------------------------------
// Série inteira zerada acontece de verdade: setor novo, ou filtro que não casa
// nada. Teto zero seria divisão por zero em quem escala a altura.
checa("série zerada ainda devolve um eixo utilizável", eixo(0) === "1|0,1");
checa("máximo fracionário arredonda para cima", eixo(4.2) === "6|0,2,4,6");
checa("negativo é tratado como zero", eixo(-3) === "1|0,1");
// A faixa da fila usa dois degraus, não quatro — o parâmetro precisa valer.
checa("com duas faixas o eixo respeita o teto de degraus", eixo(12, 2) === "12|0,6,12");
checa("acima da lista de passos ainda cobre o dado", escalaDoEixo(99999).teto >= 99999);

console.log(
  falhas === 0
    ? "\nTodos os testes de gráfico passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
