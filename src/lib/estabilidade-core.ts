/**
 * Reaproveitar o objeto anterior quando o documento não mudou (#213).
 *
 * Módulo puro (AGENTS.md §4), testado em `scripts/test-estabilidade.mjs`.
 *
 * O QUE ISTO CONSERTA. O Kanban travava. Cada snapshot do Firestore — e chega
 * um a cada escrita de QUALQUER pessoa do setor — devolve a lista inteira de
 * cards como objetos NOVOS, inclusive os trezentos que não mudaram. Para o
 * React, objeto novo é card novo: o quadro inteiro se redesenhava porque
 * alguém marcou um item de checklist numa demanda do outro lado da tela, e o
 * `memo` do card não tinha como ajudar, porque nenhuma comparação por
 * identidade sobrevive a isso.
 *
 * Aqui, o card que chega igual ao que já estava na tela devolve O MESMO objeto
 * de antes. Só o que mudou ganha identidade nova — e só ele se redesenha.
 *
 * POR QUE `JSON.stringify` e não uma comparação campo a campo: o card tem
 * listas aninhadas (checklist, comentários, links, tags) e campos que nascem
 * com o tempo; uma comparação escrita à mão esqueceria o próximo campo, e o
 * sintoma seria o pior possível — a tela mostrando o valor velho de um campo
 * que mudou. Serializar é cego para o formato, e para alguns centenas de cards
 * custa menos que um único redesenho do quadro. A ordem das chaves vem do
 * Firestore e é estável entre snapshots do mesmo documento.
 */

/**
 * A lista nova, com os itens iguais trocados pelos objetos da lista anterior.
 *
 * A ORDEM É SEMPRE A DA LISTA NOVA — reaproveitar é sobre identidade, não sobre
 * posição. E se NADA mudou, devolve a própria lista anterior: é o que deixa os
 * `useMemo` que dependem dela não recalcularem.
 */
export function reaproveitarIguais<T>(
  anterior: readonly T[],
  novo: readonly T[],
  chave: (x: T) => string,
): T[] {
  const porChave = new Map<string, { item: T; json: string }>();
  anterior.forEach((x) => porChave.set(chave(x), { item: x, json: JSON.stringify(x) }));

  let mudou = novo.length !== anterior.length;
  const out = novo.map((x, i) => {
    const antes = porChave.get(chave(x));
    const igual = !!antes && antes.json === JSON.stringify(x);
    if (!igual || anterior[i] !== antes!.item) mudou = true;
    return igual ? antes!.item : x;
  });
  return mudou ? out : (anterior as T[]);
}
