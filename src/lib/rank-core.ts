/**
 * A ordem do pódio — quem fica em que degrau, e o que acontece nos empates.
 *
 * Módulo puro (AGENTS.md §4): sem `firebase/firestore`, sem React. Quem conta as
 * entregas é a tela, que já tem os cards e as colunas na mão; o que mora aqui é
 * a parte que erra calada — a colocação.
 *
 * POR QUE ISTO NÃO É UM `sort` DENTRO DA PÁGINA. Um `sort` decrescente resolve a
 * ordem e não resolve nenhuma das duas perguntas que um pódio faz: quem
 * EMPATOU, e onde a lista CORTA. As duas se cruzam justo na borda — duas pessoas
 * com o mesmo número na oitava posição —, e o jeito errado de resolver isso
 * (`slice(0, 8)`) escolhe uma das duas pela ordem alfabética do e-mail e manda a
 * outra embora. Ninguém percebe: a tela fica bonita, com oito nomes, e a pessoa
 * que sumiu tem exatamente a mesma quantidade de entregas de quem ficou.
 */

/** Quantas POSIÇÕES o pódio mostra. Não é quantas pessoas — ver `montarRank`. */
export const TETO_RANK = 8;

/** As posições que ficam nos degraus altos; o resto vai para a fila de honra. */
export const POSICOES_DO_PODIO = 3;

export type Participante = {
  /** Identidade estável — na tela, o e-mail do responsável. */
  chave: string;
  /** O que se lê na tela. Só desempata a ORDEM de quem já empatou em número. */
  rotulo: string;
  entregues: number;
};

export type Colocacao = Participante & {
  /** 1, 2, 2, 4… — quem empata divide a posição, e a seguinte pula. */
  posicao: number;
};

/**
 * Ordena, coloca e corta.
 *
 * **Empate divide a posição, e a próxima pula.** Duas pessoas com nove entregas
 * são as duas em segundo, e quem vem depois é o quarto. É a convenção de
 * competição ("standard competition ranking"), e ela é a única que não mente:
 * numerar 1, 2, 3 quem entregou 12, 9 e 9 afirma que o terceiro entregou menos
 * que o segundo.
 *
 * **O TETO É DE POSIÇÕES, NÃO DE PESSOAS**, e é por isso que este corte não é um
 * `slice`. Se duas pessoas empatam na oitava, as duas ficam — o pódio mostra
 * nove nomes em oito degraus. Cortar no oitavo NOME escolheria entre elas pelo
 * critério que existe só para ordenar o desenho (o rótulo), e a perdedora teria
 * exatamente o mesmo número da que ficou. Um pódio que desempata por ordem
 * alfabética não é um pódio, é um sorteio com aparência de mérito.
 *
 * **Zero não é colocação.** Quem não entregou nada não entra — nem no fim da
 * lista. Um degrau com "0" ao lado do nome não informa quem trabalhou pouco;
 * informa que a pessoa existe, o que a aba Usuários já faz sem expor ninguém.
 */
export function montarRank(
  participantes: Participante[],
  teto: number = TETO_RANK,
): Colocacao[] {
  const validos = participantes.filter(
    (p) => Number.isFinite(p.entregues) && p.entregues > 0,
  );

  const ordenados = [...validos].sort(
    (a, b) =>
      b.entregues - a.entregues || a.rotulo.localeCompare(b.rotulo, "pt-BR"),
  );

  const saida: Colocacao[] = [];
  let posicao = 0;
  let anterior: number | null = null;

  ordenados.forEach((p, i) => {
    // `i + 1` e não `posicao + 1`: é isto que faz a posição PULAR depois de um
    // empate. Com dois segundos lugares, o terceiro da lista é o quarto do
    // pódio, e quem incrementa de um em um jamais chega a esse número.
    if (anterior === null || p.entregues !== anterior) posicao = i + 1;
    anterior = p.entregues;
    if (posicao > teto) return;
    saida.push({ ...p, posicao });
  });

  return saida;
}

/**
 * O maior número do pódio — a régua das alturas dos degraus.
 *
 * Fica aqui, e não na tela, porque a lista já pode vir vazia e `Math.max()` sem
 * argumento nenhum responde `-Infinity`. Uma altura calculada a partir disso não
 * quebra nada visível: ela produz um degrau de tamanho negativo, que o navegador
 * desenha como zero, e o pódio some sem nenhum erro em lugar nenhum.
 */
export function maiorEntrega(colocacoes: Colocacao[]): number {
  return colocacoes.reduce((m, c) => Math.max(m, c.entregues), 0);
}

/**
 * A altura do bloco de cada degrau, em pixels.
 *
 * Mora aqui, e não na folha de estilo, porque a altura é a ÚNICA coisa que
 * diferencia visualmente um degrau do outro — a cor não faz isso de propósito
 * (ver `rank.module.css`). Uma regra que decide sozinha o que a tela afirma
 * sobre quem ganhou merece teste.
 *
 * POR QUE NÃO É SÓ PROPORCIONAL À CONTAGEM, que foi como nasceu. Com 29, 28 e
 * 22 entregas — números reais de agosto de 2026 — a proporção pura devolve três
 * blocos de altura quase igual, e a silhueta de escada, que é o que faz alguém
 * reconhecer um pódio antes de ler qualquer número, simplesmente não aparece. O
 * desenho passa a depender de o mês ter sido desigual.
 *
 * Por isso a altura é PISO POR COLOCAÇÃO mais um acréscimo proporcional: o piso
 * garante a escada em qualquer temporada, e o acréscimo devolve a informação que
 * a proporção pura dava — a distância entre as contagens continua legível dentro
 * de cada degrau.
 *
 * A ESCADA É INVARIANTE, e é isso que o teste guarda: colocação melhor nunca
 * produz bloco mais baixo. Ela se sustenta porque o degrau da frente sempre tem
 * contagem maior ou igual (é o que `montarRank` garante) e porque a diferença
 * entre dois pisos é maior que o acréscimo inteiro. Mexer nos números abaixo sem
 * manter essa relação quebra o pódio de um jeito que só aparece no mês em que as
 * contagens ficarem parecidas — quer dizer, tarde.
 */
const PISO_POR_POSICAO: Record<number, number> = { 1: 132, 2: 96, 3: 74 };

/** Quanto a contagem pode acrescentar sobre o piso. Menor que a menor distância entre pisos (22). */
const ACRESCIMO_POR_CONTAGEM = 20;

export function alturaDoDegrau(
  posicao: number,
  entregues: number,
  maior: number,
): number {
  const piso = PISO_POR_POSICAO[posicao] ?? PISO_POR_POSICAO[3];
  // `min(1, …)` não é paranoia: `maior` vem da lista INTEIRA, e um dia em que
  // ele chegar menor que a contagem deste degrau o acréscimo estouraria o teto
  // e derrubaria a escada em silêncio.
  const fracao = Math.min(1, Math.max(0, entregues) / Math.max(1, maior));
  return piso + Math.round(fracao * ACRESCIMO_POR_CONTAGEM);
}

/**
 * Onde cada colocação fica na fileira — e quando NÃO existe pódio.
 *
 * A tela virou uma fileira só: ninguém mais fica abaixo de ninguém. Os três
 * primeiros continuam sobre plintos; do quarto em diante as pessoas ficam DE PÉ
 * no mesmo chão, ao lado. As três funções abaixo são a parte disso que erra
 * calada, e por isso moram num módulo puro com teste.
 */

/** Quantos plintos o palco comporta antes de virar outra coisa. */
export const MAX_PLINTOS = 4;

export type Cena = {
  /** Quem sobe em plinto — vazio quando não há pódio a montar. */
  degraus: Colocacao[];
  /** Quem fica de pé no chão, ao lado. */
  plateia: Colocacao[];
};

/**
 * Divide a temporada entre plintos e chão.
 *
 * O MÊS EM QUE NÃO HÁ PÓDIO É REAL, e é o estado da tela nos primeiros dias de
 * toda temporada. `montarRank` corta por POSIÇÃO, não por pessoa (é a decisão
 * documentada lá em cima, e ela não envelheceu): no dia 2, trinta pessoas com
 * uma entrega cada devolvem trinta colocações — **todas em primeiro**. Filtrar
 * `posicao <= 3` ali entrega trinta plintos da mesma altura, que é uma fileira
 * de blocos idênticos com "1º" escrito trinta vezes. Não quebra nada: nem lint,
 * nem tsc, nem prebuild. Só a tela do dia 2.
 *
 * Um pódio precisa de DEGRAU, e degrau precisa de duas coisas: níveis
 * diferentes (senão não há em relação a que subir) e poucas peças (uma
 * plataforma de dez plintos é um gráfico de barras). Faltando qualquer uma
 * delas, a cena inteira vira fileira — todo mundo de pé, lado a lado, ninguém
 * escondido atrás de um "+N". Quem está em primeiro continua com o anel da
 * marca e o troféu: o que se perde é o plinto, não a colocação.
 */
export function partirCena(colocacoes: Colocacao[]): Cena {
  const topo = colocacoes.filter((c) => c.posicao <= POSICOES_DO_PODIO);
  const niveis = new Set(topo.map((c) => c.posicao)).size;
  const temPodio = topo.length > 0 && topo.length <= MAX_PLINTOS && niveis >= 2;
  if (!temPodio) return { degraus: [], plateia: colocacoes };
  return {
    degraus: topo,
    plateia: colocacoes.filter((c) => c.posicao > POSICOES_DO_PODIO),
  };
}

/**
 * O lugar de cada um na fileira — o 1º no meio, os outros descendo para as duas
 * bordas: … 6º 4º 2º **1º** 3º 5º 7º …
 *
 * Devolve o valor de `order` do CSS, e não um índice de array, e essa troca é
 * uma REVERSÃO consciente da regra que este projeto seguia (ver o comentário de
 * `Cena` em `page.tsx`): até aqui a reordenação acontecia no array, para que o
 * DOM saísse na mesma ordem em que o pódio é lido. Com TRÊS degraus as duas
 * ordens eram igualmente defensáveis — "2º, 1º, 3º" é uma sequência que faz
 * sentido lida em voz alta. Com OITO, não são: quem usa leitor de tela ouviria
 * "8º, 6º, 4º, 2º, 1º, 3º, 5º, 7º", e um rank tem exatamente uma sequência
 * significativa, que é 1, 2, 3… Por isso o DOM agora sai em ordem de
 * colocação — dentro de um `<ol>`, que é o que a tela sempre afirmou e nunca
 * teve — e o desenho da pirâmide fica com o `order`. Ninguém perde: não há nada
 * focável na fileira, então não existe ordem de tabulação a embaralhar.
 *
 * O ARGUMENTO É O ÍNDICE, E NÃO A COLOCAÇÃO, e isso é o que mantém o campeão no
 * meio da TELA. Alternando por colocação, um empate manda os dois empatados
 * para o mesmo lado (as duas são pares, ou as duas ímpares) — com nove pessoas
 * e um empate na oitava, a fileira fica com quatro à esquerda e duas à direita,
 * e o pódio inteiro desliza 83px para fora do centro. Medido. Alternando por
 * índice, os lados nunca diferem em mais de uma pessoa, e como as larguras
 * caem junto com a colocação, os dois braços saem do mesmo tamanho.
 *
 * De brinde, o empate fica mais bonito do que era: dois segundos lugares
 * passam a CERCAR o primeiro, um de cada lado, em vez de se amontoarem à
 * esquerda dele.
 */
export function ordemNaFileira(indice: number): number {
  return indice % 2 === 0 ? indice / 2 : -((indice + 1) / 2);
}

/** Diâmetro do rosto de quem está de pé no chão, quando existe pódio. */
export const TAM_PLATEIA = 52;

/**
 * O rosto de quem está de pé — maior quando o pódio não existe.
 *
 * Sem plintos, a fileira é tudo o que a tela tem, e 52px seria pedir para uma
 * cena inteira ser lida em miniatura. Mas ela também pode ter trinta pessoas
 * (ver `partirCena`), e trinta rostos de 88px não cabem em tela nenhuma. O
 * diâmetro cai por faixa de tamanho da fileira, e nunca abaixo dos 52px que o
 * pódio já usa — abaixo disso o rosto deixa de ser reconhecível, que é a única
 * régua desta tela.
 */
export function escalaDaFileira(quantos: number): number {
  if (!Number.isFinite(quantos) || quantos <= 6) return 88;
  if (quantos <= 12) return 68;
  return TAM_PLATEIA;
}
