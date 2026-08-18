/**
 * Testes de "este card conta como entrega, e de quem".
 *
 * O QUE ESTE ARQUIVO PROVA, e que nenhum outro prova: que a regra usada pelo
 * pódio do Rank e a usada pelos emblemas do perfil são A MESMA. Antes desta
 * frente, ela morava inline num `useMemo` de `rank/page.tsx`, e os emblemas
 * teriam de reimplementá-la — com o pior sintoma possível: o pódio e o emblema
 * discordando sobre a mesma demanda, cada um com o próprio jeito de comparar
 * e-mail, e ninguém sabendo qual dos dois está certo.
 *
 * O mapa de colunas é montado com `colunasEntregues` DE VERDADE, importado de
 * `kanban-columns.ts`. Escrever `new Set(["concluido"])` à mão aqui testaria a
 * expectativa em vez da regra — e o dia em que `colunaEhTerminal` mudasse, este
 * teste continuaria verde afirmando algo que deixou de ser verdade.
 */
import {
  ehEntrega,
  entregasPorPessoa,
  entreguesPorSetor,
  mesmaPessoa,
} from "../src/lib/entregas-core.ts";
import { colunasEntregues } from "../src/lib/kanban-columns.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— o mapa vem de `colunasEntregues`, não de uma cópia —");

/** O quadro real de todo setor do banco hoje. */
const PADRAO = [
  { id: "backlog", title: "A fazer" },
  { id: "andamento", title: "Em andamento" },
  { id: "aguardando", title: "Aguardando" },
  { id: "validacao", title: "Validação" },
  { id: "concluido", title: "Concluído" },
];

/** O setor que renomeou a última coluna: ela continua entregando na ponta. */
const RENOMEADO = [
  { id: "a", title: "A fazer" },
  { id: "b", title: "Em andamento" },
  { id: "c", title: "Entregue ao cliente" },
];

/** O setor que pôs "Concluído" no meio e deixou o arquivo no fim. */
const COM_ARQUIVO = [
  { id: "a", title: "A fazer" },
  { id: "b", title: "Concluído" },
  { id: "c", title: "Arquivo morto" },
];

const ent = entreguesPorSetor({
  "B.I.": PADRAO,
  RH: RENOMEADO,
  Infra: COM_ARQUIVO,
});

checa(
  "o mapa é o mesmo que `colunasEntregues` devolve",
  [...ent["B.I."]].join() === [...colunasEntregues(PADRAO)].join(),
);
checa("no quadro padrão, só a última entrega", [...ent["B.I."]].join() === "concluido");
checa(
  "última coluna com nome inventado conta",
  ent.RH.has("c") && !ent.RH.has("b"),
  [...ent.RH].join(),
);
// Comportamento DOCUMENTADO em `kanban-columns.ts`: as duas fontes se somam. O
// teste o fixa para ele não mudar sem alguém ver.
checa(
  '"Concluído" no meio conta E "Arquivo morto" na ponta também',
  ent.Infra.has("b") && ent.Infra.has("c"),
  [...ent.Infra].join(),
);
checa("setor sem coluna nenhuma devolve conjunto vazio", entreguesPorSetor({ X: [] }).X.size === 0);

console.log("\n— `ehEntrega` —");

const card = (o) => ({ sector: "B.I.", columnId: "concluido", ...o });

checa("card na coluna de entrega conta", ehEntrega(card({}), ent));
checa("card em outra coluna não conta", !ehEntrega(card({ columnId: "andamento" }), ent));
// Setor que não está no mapa: o `?? false` existe para isto. Sem ele seria um
// `undefined.has` no meio da montagem do pódio.
checa("setor desconhecido não estoura e não conta", !ehEntrega(card({ sector: "Zzz" }), ent));
checa(
  "cada setor usa o quadro DELE",
  ehEntrega({ sector: "RH", columnId: "c" }, ent) &&
    !ehEntrega({ sector: "B.I.", columnId: "c" }, ent),
);

console.log("\n— `mesmaPessoa`: exata, e o teste diz por quê —");

checa("casa exato", mesmaPessoa("a@px.com.br", "a@px.com.br"));
checa("null não casa com ninguém", !mesmaPessoa(null, "a@px.com.br"));
checa("undefined não casa com ninguém", !mesmaPessoa(undefined, "a@px.com.br"));
checa("vazio não casa com ninguém", !mesmaPessoa("", "a@px.com.br"));
// A COMPARAÇÃO É EXATA DE PROPÓSITO. O pódio compara assim hoje — o e-mail é a
// chave crua de um Map —, e normalizar a caixa AQUI faria o emblema e o pódio
// pararem de concordar, que é exatamente o que este módulo existe para impedir.
// Consertar a caixa é frente própria: ela mexe no pódio, no filtro de
// responsável e no `usersMap` de sete telas.
checa(
  "caixa diferente NÃO casa — e isso é decisão, não defeito",
  !mesmaPessoa("A@px.com.br", "a@px.com.br"),
);

console.log("\n— `entregasPorPessoa` —");

const cards = [
  card({ assignee: "ana@px" }),
  card({ assignee: "ana@px" }),
  card({ assignee: "bia@px" }),
  card({ assignee: null }), // entregue, sem dono
  card({ assignee: "" }), // idem, gravado como vazio
  card({ columnId: "andamento", assignee: "ana@px" }), // não entregue
  { sector: "RH", columnId: "c", assignee: "ana@px" }, // outro quadro
];

const { por, total } = entregasPorPessoa(cards, ent);

checa("ana tem 3 (2 no B.I. e 1 no RH)", por.get("ana@px") === 3, String(por.get("ana@px")));
checa("bia tem 1", por.get("bia@px") === 1);
// As duas afirmações são verdade e respondem a perguntas diferentes: "o setor
// entregou" e "fulano entregou". Somar `por` para achar o total daria um número
// menor que o real, sem nada na tela explicando a diferença.
checa("o total INCLUI as entregas sem responsável", total === 6, String(total));
checa(
  "a soma de `por` é MENOR que o total, e isso é esperado",
  [...por.values()].reduce((a, b) => a + b, 0) === 4,
);
checa("ninguém sem responsável vira chave", !por.has("") && !por.has("null"));
checa("card não entregue não conta para ninguém", por.get("ana@px") !== 4);

const vazio = entregasPorPessoa([], ent);
checa("lista vazia devolve total 0 e mapa vazio", vazio.total === 0 && vazio.por.size === 0);

console.log(
  falhas === 0 ? "\nentregas: ok" : `\nentregas: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
