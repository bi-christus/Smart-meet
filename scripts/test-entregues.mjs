/**
 * Testes da regra de "demanda entregue".
 *
 * Esta é a regra que decide se um prazo no passado é ATRASO ou é só registro.
 * Errar para um lado faz o relatório do gestor cobrar entrega já feita; errar
 * para o outro esconde atraso real. Nenhum dos dois aparece na tela como bug —
 * aparecem como número errado, que é pior, porque alguém acredita nele.
 *
 * Quadro é personalizável por setor: quem renomeia a coluna final e quem
 * empurra "Concluído" para o meio quebram versões diferentes da regra, e é por
 * isso que ela olha para as duas coisas (posição e nome).
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  colunasEntregues,
  colunaEhTerminal,
  DEFAULT_COLUMNS,
} from "../src/lib/kanban-columns.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(`${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

const padrao = colunasEntregues(DEFAULT_COLUMNS);
checa(
  "quadro padrão: só 'Concluído' entrega",
  padrao.size === 1 && padrao.has("concluido"),
  [...padrao].join(","),
);
checa("etapa de trabalho não entrega", !padrao.has("andamento"));
checa("validação não entrega", !padrao.has("validacao"));

// Setor que renomeou a coluna final para algo que a heurística de nome não pega.
const renomeado = colunasEntregues([
  { id: "a", title: "A fazer" },
  { id: "b", title: "Em andamento" },
  { id: "c", title: "Na mão do cliente" },
]);
checa(
  "última coluna entrega mesmo com nome livre",
  renomeado.size === 1 && renomeado.has("c"),
);

// Setor que pôs "Concluído" no meio e deixou um arquivo no fim: as duas contam,
// senão a demanda concluída volta a ser cobrada enquanto não for arquivada.
const comArquivo = colunasEntregues([
  { id: "a", title: "A fazer" },
  { id: "b", title: "Concluído" },
  { id: "z", title: "Arquivo morto" },
]);
checa("'Concluído' fora da ponta conta", comArquivo.has("b"));
checa("última coluna também conta", comArquivo.has("z"));
checa("etapa de trabalho continua fora", !comArquivo.has("a"));

checa("quadro sem colunas não inventa entrega", colunasEntregues([]).size === 0);

checa("'Entregue ao setor' é terminal", colunaEhTerminal("Entregue ao setor"));
checa("'Finalizado' é terminal", colunaEhTerminal("Finalizado"));
checa("'Validação' não é terminal", !colunaEhTerminal("Validação"));
checa("'Aguardando' não é terminal", !colunaEhTerminal("Aguardando"));

if (falhas) {
  console.error(`\n${falhas} falha(s) na regra de entrega`);
  process.exit(1);
}
console.log("\nregra de entrega: ok");
