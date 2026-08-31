/**
 * Testes da colocação do pódio.
 *
 * O que se testa aqui não é "sabe ordenar" — é o que acontece nas duas bordas
 * que um `sort` decrescente resolve errado sem dar nenhum sinal:
 *
 *  - O EMPATE. Numerar 1, 2, 3 quem entregou 12, 9 e 9 afirma que o terceiro
 *    entregou menos que o segundo. A tela fica perfeita, e o número dela mente.
 *  - O CORTE. Duas pessoas empatadas na oitava posição: `slice(0, 8)` escolhe
 *    uma pela ordem alfabética do rótulo — que existe só para ordenar o desenho
 *    — e manda a outra embora com exatamente o mesmo número de entregas.
 *
 * Nenhum dos dois vira erro de tipo, de lint ou de build. O sintoma é uma
 * pessoa que sumiu do pódio, e quem repara é ela.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  MAX_PLINTOS,
  POSICOES_DO_PODIO,
  TETO_RANK,
  alturaDoDegrau,
  escalaDaFileira,
  maiorEntrega,
  montarRank,
  ordemNaFileira,
  partirCena,
} from "../src/lib/rank-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

/** Atalho: monta participantes a partir de pares [rótulo, entregas]. */
function pessoas(...pares) {
  return pares.map(([rotulo, entregues]) => ({
    chave: `${rotulo.toLowerCase()}@px.com.br`,
    rotulo,
    entregues,
  }));
}

const posicoes = (r) => r.map((c) => c.posicao).join(",");
const rotulos = (r) => r.map((c) => c.rotulo).join(",");

// --- ordem e colocação sem empate ----------------------------------------
const SIMPLES = montarRank(pessoas(["Ana", 3], ["Bruno", 12], ["Carla", 7]));
checa(
  "ordena pela contagem, não pela ordem de entrada",
  rotulos(SIMPLES) === "Bruno,Carla,Ana",
  rotulos(SIMPLES),
);
checa("sem empate, as posições são 1,2,3", posicoes(SIMPLES) === "1,2,3");

// --- empate: divide a posição e PULA a seguinte ---------------------------
const EMPATE = montarRank(
  pessoas(["Ana", 12], ["Bruno", 9], ["Carla", 9], ["Davi", 4]),
);
checa(
  "empate divide a posição e a próxima pula (1,2,2,4)",
  posicoes(EMPATE) === "1,2,2,4",
  posicoes(EMPATE),
);
checa(
  "entre empatados, a ordem do desenho é o rótulo em pt-BR",
  rotulos(EMPATE) === "Ana,Bruno,Carla,Davi",
  rotulos(EMPATE),
);
const TODOS_IGUAIS = montarRank(pessoas(["Ana", 5], ["Bruno", 5], ["Carla", 5]));
checa(
  "todo mundo empatado fica todo mundo em primeiro",
  posicoes(TODOS_IGUAIS) === "1,1,1",
  posicoes(TODOS_IGUAIS),
);

// --- o corte é de POSIÇÕES, não de pessoas -------------------------------
// Nove pessoas, todas com números diferentes: sobram oito.
const NOVE = montarRank(
  pessoas(
    ["A", 20], ["B", 19], ["C", 18], ["D", 17], ["E", 16],
    ["F", 15], ["G", 14], ["H", 13], ["I", 12],
  ),
);
checa(
  "nove pessoas em nove posições: entram oito",
  NOVE.length === TETO_RANK && rotulos(NOVE) === "A,B,C,D,E,F,G,H",
  rotulos(NOVE),
);
// As mesmas nove, mas as duas últimas empatadas na oitava: entram NOVE.
const EMPATE_NA_BORDA = montarRank(
  pessoas(
    ["A", 20], ["B", 19], ["C", 18], ["D", 17], ["E", 16],
    ["F", 15], ["G", 14], ["H", 13], ["I", 13],
  ),
);
checa(
  "empate na oitava posição mantém as DUAS pessoas (nove nomes, oito degraus)",
  EMPATE_NA_BORDA.length === 9 &&
    posicoes(EMPATE_NA_BORDA) === "1,2,3,4,5,6,7,8,8",
  posicoes(EMPATE_NA_BORDA),
);
// E o empate ANTES da borda empurra a nona para fora, porque a posição pula.
const EMPATE_ANTES = montarRank(
  pessoas(
    ["A", 20], ["B", 20], ["C", 18], ["D", 17], ["E", 16],
    ["F", 15], ["G", 14], ["H", 13], ["I", 12],
  ),
);
checa(
  "empate no topo empurra a última para fora do teto (posição 9 não entra)",
  posicoes(EMPATE_ANTES) === "1,1,3,4,5,6,7,8" && EMPATE_ANTES.length === 8,
  posicoes(EMPATE_ANTES),
);

// --- zero e lixo não sobem no pódio --------------------------------------
checa(
  "quem não entregou nada não vira degrau",
  montarRank(pessoas(["Ana", 0], ["Bruno", 3])).length === 1,
);
checa(
  "número negativo, NaN e ausente também ficam de fora",
  montarRank([
    { chave: "a", rotulo: "A", entregues: -2 },
    { chave: "b", rotulo: "B", entregues: NaN },
    { chave: "c", rotulo: "C", entregues: undefined },
    { chave: "d", rotulo: "D", entregues: Infinity },
    { chave: "e", rotulo: "E", entregues: 1 },
  ]).length === 1,
);
checa("lista vazia devolve lista vazia, sem estourar", montarRank([]).length === 0);

// --- a entrada não é mexida ----------------------------------------------
const ORIGINAL = pessoas(["Ana", 3], ["Bruno", 12]);
const COPIA = JSON.stringify(ORIGINAL);
montarRank(ORIGINAL);
checa(
  "montarRank não reordena o array que recebeu",
  JSON.stringify(ORIGINAL) === COPIA,
);

// --- a régua das alturas --------------------------------------------------
// `Math.max()` sem argumento responde -Infinity, e uma altura tirada disso não
// quebra nada visível: o degrau vira zero e o pódio some, calado.
checa(
  "maiorEntrega devolve 0 no vazio, e nunca -Infinity",
  maiorEntrega([]) === 0 && maiorEntrega(SIMPLES) === 12,
);

// --- a escada: a altura do bloco de cada degrau ---------------------------
// A silhueta de escada é o que faz alguém reconhecer um pódio antes de ler um
// número. Ela some quando a altura é só proporcional à contagem e o mês foi
// parelho — o desenho passa a depender de o mês ter sido desigual, e o mês em
// que ele quebra é justamente o que ninguém testou.
const ESCADA = (r) =>
  r
    .filter((c) => c.posicao <= POSICOES_DO_PODIO)
    .map((c) => alturaDoDegrau(c.posicao, c.entregues, maiorEntrega(r)));

const desce = (alturas) => alturas.every((a, i) => i === 0 || a < alturas[i - 1]);

checa(
  "contagens quase iguais ainda desenham escada",
  desce(ESCADA(montarRank(pessoas(["Ana", 29], ["Bruno", 28], ["Carla", 27])))),
  ESCADA(montarRank(pessoas(["Ana", 29], ["Bruno", 28], ["Carla", 27]))).join(" > "),
);

checa(
  "contagens muito distantes também",
  desce(ESCADA(montarRank(pessoas(["Ana", 40], ["Bruno", 3], ["Carla", 1])))),
  ESCADA(montarRank(pessoas(["Ana", 40], ["Bruno", 3], ["Carla", 1]))).join(" > "),
);

checa(
  "empate no 2º lugar dá dois blocos de altura igual",
  (() => {
    const r = montarRank(pessoas(["Ana", 10], ["Bruno", 6], ["Carla", 6]));
    const [a, b, c] = ESCADA(r);
    return a > b && b === c;
  })(),
);

// Varredura: nenhuma combinação de contagens pode inverter a escada. O piso por
// colocação é maior que o acréscimo inteiro, e é isso que o laço confere.
checa(
  "colocação melhor nunca vira bloco mais baixo, em nenhuma combinação",
  (() => {
    for (let a = 1; a <= 40; a++)
      for (let b = 1; b <= a; b++)
        for (let c = 1; c <= b; c++) {
          const r = montarRank(pessoas(["A", a], ["B", b], ["C", c]));
          const alturas = ESCADA(r);
          for (let i = 1; i < alturas.length; i++) {
            const anterior = r.filter((x) => x.posicao <= POSICOES_DO_PODIO)[i - 1];
            const atual = r.filter((x) => x.posicao <= POSICOES_DO_PODIO)[i];
            const empate = anterior.posicao === atual.posicao;
            if (empate ? alturas[i] !== alturas[i - 1] : alturas[i] >= alturas[i - 1])
              return false;
          }
        }
    return true;
  })(),
);

checa(
  "altura não depende de `maior` inconsistente — nada estoura o teto",
  alturaDoDegrau(1, 99, 1) === alturaDoDegrau(1, 1, 1) &&
    alturaDoDegrau(3, 0, 0) < alturaDoDegrau(2, 0, 0),
);

// --- a cena: quem sobe em plinto, quem fica de pe ------------------------
// O corte de `montarRank` e de POSICAO, nao de pessoa. No dia 2 de qualquer
// temporada todo mundo tem uma entrega, todo mundo esta em primeiro, e um
// filtro `posicao <= 3` devolve a lista INTEIRA. Nada fica vermelho: o sintoma
// e uma fileira de trinta plintos identicos com "1o" escrito trinta vezes.
const cena = (...pares) => partirCena(montarRank(pessoas(...pares)));
const forma = (c) => `${c.degraus.length}+${c.plateia.length}`;

checa(
  "tres niveis viram tres plintos, e o resto fica de pe",
  forma(cena(["A", 9], ["B", 6], ["C", 4], ["D", 2], ["E", 1])) === "3+2",
);

checa(
  "empate no 2o lugar ainda e podio — quatro plintos cabem",
  forma(cena(["A", 9], ["B", 6], ["C", 6])) === "3+0",
  JSON.stringify(cena(["A", 9], ["B", 6], ["C", 6]).degraus.map((d) => d.posicao)),
);

checa(
  "empate no 1o com um terceiro atras continua sendo podio",
  forma(cena(["A", 9], ["B", 9], ["C", 4])) === "3+0",
);

checa(
  "TODO MUNDO EMPATADO NAO E PODIO: um nivel so nao tem em relacao a que subir",
  forma(cena(["A", 1], ["B", 1], ["C", 1])) === "0+3",
);

checa(
  "uma pessoa sozinha nao e podio — bloco unico no centro e retrato",
  forma(cena(["A", 7])) === "0+1",
);

checa(
  "o dia 2 da temporada: trinta pessoas com uma entrega cada",
  (() => {
    const trinta = Array.from({ length: 30 }, (_, i) => [`P${i}`, 1]);
    const c = cena(...trinta);
    // `montarRank` devolve as trinta, todas em 1o — e e por isso que a cena
    // inteira tem de virar fileira em vez de trinta plintos.
    return c.degraus.length === 0 && c.plateia.length === 30;
  })(),
);

checa(
  "mais plintos que o teto derruba o podio, mesmo com niveis diferentes",
  (() => {
    // Um primeiro e TRES segundos: quatro pecas no topo, dois niveis — cabe,
    // e e exatamente o limite.
    const noLimite = cena(["A", 9], ["B", 5], ["C", 5], ["D", 5]);
    // Um primeiro e QUATRO segundos: cinco pecas. Passa do limite, e a cena
    // inteira vira fileira — plataforma de cinco plintos e grafico de barras.
    const passou = cena(["A", 9], ["B", 5], ["C", 5], ["D", 5], ["E", 5]);
    return (
      noLimite.degraus.length === MAX_PLINTOS &&
      passou.degraus.length === 0 &&
      passou.plateia.length === 5
    );
  })(),
);

checa(
  "partirCena nao reordena nem duplica ninguem",
  (() => {
    const r = montarRank(pessoas(["A", 9], ["B", 6], ["C", 4], ["D", 2]));
    const c = partirCena(r);
    const juntos = [...c.degraus, ...c.plateia].map((x) => x.rotulo).sort();
    return juntos.join(",") === "A,B,C,D";
  })(),
);

// --- a piramide: o 1o no meio, os outros descendo para as bordas ---------
// A ordem visual sai do INDICE, e nao da colocacao. Com a colocacao, um empate
// manda os dois empatados para o mesmo lado (as duas posicoes sao pares, ou as
// duas impares) e o podio inteiro desliza para fora do centro da tela.
const visual = (n) =>
  Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => ordemNaFileira(a) - ordemNaFileira(b));

checa(
  "a ordem visual poe o indice 0 no centro e alterna para as bordas",
  visual(9).join(",") === "7,5,3,1,0,2,4,6,8",
  visual(9).join(","),
);

checa(
  "quem vem antes no ranking fica mais perto do centro",
  Array.from({ length: 9 }, (_, i) => i).every(
    (i) => i === 0 || Math.abs(ordemNaFileira(i)) >= Math.abs(ordemNaFileira(i - 1)),
  ),
);

checa(
  "os dois bracos nunca diferem em mais de uma pessoa — o campeao fica no meio",
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30].every((n) => {
    const ordens = Array.from({ length: n }, (_, i) => ordemNaFileira(i));
    const esq = ordens.filter((o) => o < 0).length;
    const dir = ordens.filter((o) => o > 0).length;
    return Math.abs(esq - dir) <= 1;
  }),
);

checa(
  "empate CERCA o primeiro em vez de se amontoar de um lado so",
  // Colocacoes 1,2,2 -> indices 0,1,2 -> um de cada lado do centro.
  ordemNaFileira(1) < 0 && ordemNaFileira(2) > 0,
);

// --- o rosto de quem esta de pe ------------------------------------------
checa(
  "sem podio a fileira cresce o rosto, e encolhe conforme enche",
  escalaDaFileira(3) === 88 &&
    escalaDaFileira(6) === 88 &&
    escalaDaFileira(7) === 68 &&
    escalaDaFileira(30) === 52,
  `${escalaDaFileira(3)}/${escalaDaFileira(7)}/${escalaDaFileira(30)}`,
);

checa(
  "entrada degenerada nunca devolve undefined nem NaN",
  // `size={undefined}` no <Avatar> vira `width="NaN"` no DOM, sem erro nenhum.
  [0, -1, 1.5, NaN, undefined].every((n) => {
    const t = escalaDaFileira(n);
    return Number.isFinite(t) && t >= 52;
  }),
);

// --- as constantes que a tela usa para partir o desenho -------------------
checa(
  "o pódio alto cabe dentro do teto",
  POSICOES_DO_PODIO > 0 && POSICOES_DO_PODIO < TETO_RANK,
  `${POSICOES_DO_PODIO} de ${TETO_RANK}`,
);

console.log(falhas === 0 ? "\nrank: ok" : `\nrank: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
