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
