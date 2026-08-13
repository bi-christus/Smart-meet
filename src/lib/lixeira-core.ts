/**
 * A lixeira das demandas — o que conta como excluída, e em que ordem se lê.
 *
 * Moradia em módulo puro, como `tags-ref` e `kanban-columns`: aqui não entra o
 * SDK do Firestore, então a regra é testada por `scripts/test-lixeira.mjs` sem
 * subir nada. Quem escreve no banco é `kanban.ts`.
 *
 * POR QUE MÓDULO, e não um `!!c.deletedAt` solto dentro de `kanban.ts`. Não é
 * pelo tamanho da regra — ela cabe em uma linha. É porque ela tem DOIS lados do
 * app como cliente: o navegador, por `kanban.ts`, e o servidor, nas rotas que
 * leem `/cards` pelo Admin SDK (`api/cowork/catalogo`, `api/kanban/relatorio`).
 * `kanban.ts` importa `./firebase`, o SDK do cliente — uma rota de servidor não
 * consegue importá-lo. A regra ali dentro obrigaria o servidor a reescrever a
 * sua própria cópia de "o que é uma demanda excluída", e no dia em que uma das
 * duas mudasse, o catálogo do Cowork e o relatório do gestor passariam a
 * discordar do quadro sem que nada ficasse vermelho.
 *
 * A EXCLUSÃO É REVERSÍVEL, e é por isso que ela é um campo e não um `delete`.
 * O documento continua inteiro em `/cards`: mesma coluna, mesma `order`, mesmo
 * `enteredAt`, mesmo histórico pendurado embaixo. Restaurar é apagar a marca —
 * e a demanda volta para o lugar de onde saiu, com a idade que sempre teve.
 */

/** O mínimo que a lixeira precisa enxergar de um card. */
export type ComLixeira = {
  /** ms da exclusão; ausente ou `null` = demanda viva. */
  deletedAt?: number | null;
};

/**
 * A demanda está na lixeira?
 *
 * Três formas significam "viva", e as três existem no banco de verdade: campo
 * AUSENTE (todo card anterior a esta funcionalidade), `null` (o que
 * `restaurarDaLixeira` grava) e `0` (nenhum relógio devolve zero, mas um dado
 * corrompido devolveria). `!!` responde as três de uma vez.
 *
 * A alternativa `typeof deletedAt === "number"` foi descartada de propósito.
 * Ela é mais estrita, e erra para o lado errado: se um dia alguém gravar aqui
 * um `serverTimestamp()` em vez de `Date.now()`, o campo vira objeto — e a
 * versão estrita diria "viva", devolvendo ao quadro uma demanda que alguém
 * mandou para a lixeira. Com `!!`, o pior caso é uma demanda ficar escondida a
 * mais, que é o erro que se percebe e se conserta. Falhar escondendo é a
 * escolha; falhar mostrando não é.
 */
export function naLixeira(c: ComLixeira): boolean {
  return !!c.deletedAt;
}

/** O contrário — existe para `.filter(viva)` se ler como o que faz. */
export function viva(c: ComLixeira): boolean {
  return !naLixeira(c);
}

/**
 * A lixeira em ordem de leitura: a exclusão mais recente primeiro.
 *
 * Não é `order` nem prazo. Quem abre a lixeira quase sempre acabou de apagar
 * algo por engano, e a demanda que ele procura é a última que saiu do quadro —
 * ordenar por qualquer outro critério a jogaria no meio de uma lista de coisas
 * apagadas meses atrás.
 *
 * Copia antes de ordenar: a lista chega de um snapshot que alimenta memos, e
 * `sort` no lugar mudaria o array de quem chamou.
 */
export function ordenarLixeira<T extends ComLixeira>(cards: T[]): T[] {
  return cards
    .slice()
    .sort((a, b) => quando(b.deletedAt) - quando(a.deletedAt));
}

/** Data de exclusão utilizável em comparação. Ver `naLixeira` sobre as formas. */
function quando(v: number | null | undefined): number {
  return typeof v === "number" ? v : 0;
}
