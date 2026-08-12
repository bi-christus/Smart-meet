/**
 * Carregando, vazio e erro — separados no TIPO, não num booleano.
 *
 * O PROBLEMA que isto resolve é o defeito mais visível do app: toda página
 * inicializa a lista como `[]` e desenha a mensagem de vazio ANTES de o
 * `onSnapshot` responder. Quem abre o Kanban lê "Nenhuma demanda" por alguns
 * décimos de segundo tendo trezentas — e, quando a rede está ruim, por bem
 * mais. Pior: se as regras do Firestore negarem a leitura, a tela fica no vazio
 * PARA SEMPRE, indistinguível de "não há nada aqui".
 *
 * POR QUE `undefined` E NÃO UM `loading: boolean`: um booleano é um segundo
 * campo que pode DISCORDAR do array. `loading === false` com `data === []`
 * quer dizer "vazio"; `loading === true` com o mesmo `[]` quer dizer
 * "carregando" — e nada impede alguém de esquecer de virar o booleano num
 * caminho de erro, ou de simplesmente ler o array e ignorar o resto. Com
 * `T[] | undefined` não existem dois campos para discordar: `undefined` é a
 * ÚNICA forma de dizer "ainda não respondeu", e quem desenhar a mensagem de
 * vazio sem tratar o `undefined` leva erro de tipo. A promessa aqui é o tipo
 * tornar o estado impossível de errar, não haver mais um estado para cuidar.
 *
 * POR QUE O ESTADO CARREGA A PRÓPRIA CHAVE: ao trocar de setor, os dados na
 * mão são do setor ANTIGO. Zerá-los com `setState` dentro do efeito seria
 * cascata de render — e o erro de lint que este projeto já tem nove vezes.
 * Guardando a chave junto do valor, o render descarta sozinho o que não é da
 * chave atual. É o mesmo padrão que o filtro de responsável do Kanban já usa.
 *
 * Módulo PURO de propósito: sem `react`, sem `firebase`, sem `@/`. É o que
 * permite `scripts/test-async-data.mjs` rodar em Node puro, sem subir nada.
 * Quem fala com o React é a casca em `use-async-data.ts`.
 */

export type EstadoAsync<T> = {
  /** A chave da assinatura a que estes dados pertencem. */
  chave: string;
  /** `undefined` = a assinatura ainda não respondeu. `[]` = respondeu vazio. */
  data: T[] | undefined;
  erro: Error | null;
};

export function estadoInicial<T>(chave: string): EstadoAsync<T> {
  return { chave, data: undefined, erro: null };
}

/**
 * Chegou snapshot da assinatura `chave`.
 *
 * Um snapshot novo limpa o erro: o Firestore reconecta sozinho, e a tela tem de
 * voltar do estado de falha sem ninguém recarregar a página.
 */
export function aplicarDados<T>(
  _atual: EstadoAsync<T>,
  chave: string,
  dados: T[],
): EstadoAsync<T> {
  return { chave, data: dados, erro: null };
}

/**
 * A assinatura `chave` falhou.
 *
 * `data` volta a `undefined`, e não a `[]`: erro não é "não há nada", é "não
 * sabemos". Transformar falha em lista vazia é como o app mentia antes.
 */
export function aplicarErro<T>(
  _atual: EstadoAsync<T>,
  chave: string,
  erro: Error,
): EstadoAsync<T> {
  return { chave, data: undefined, erro };
}

/**
 * O que o render lê. Dado de outra chave é dado que ainda não chegou.
 *
 * Resolve dois problemas com a mesma linha: o reset ao trocar de setor, e o
 * snapshot atrasado de uma assinatura já fechada — ele grava sob a chave velha
 * e é descartado aqui, em vez de pintar na tela o quadro do setor anterior.
 */
export function lerEstado<T>(
  estado: EstadoAsync<T>,
  chaveAtual: string,
): { data: T[] | undefined; erro: Error | null } {
  if (estado.chave !== chaveAtual) return { data: undefined, erro: null };
  return { data: estado.data, erro: estado.erro };
}
