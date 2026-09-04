/**
 * Testes da mudança de setor de uma demanda (`lib/mover-setor-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar a tela não prova: que a demanda não some.
 * Mover é a mudança mais radical que uma demanda sofre — troca de quadro, de
 * etapa e de classificação de uma vez —, e os dois modos de falha aqui são
 * SILENCIOSOS. Um `columnId` que não existe no destino põe o card num quadro em
 * que ele não é desenhado por coluna nenhuma; um `dimensaoId` da origem que
 * sobrevive pendura a demanda num galho de outro setor. Nos dois casos nada dá
 * erro: a demanda simplesmente não aparece, e quem a procura conclui que ela foi
 * excluída.
 *
 * A terceira coisa provada aqui é a que ninguém pensaria em conferir:
 * `setoresDoHistorico`. Sem ela, a timeline de uma demanda transferida começaria
 * no dia da transferência — o histórico anterior continua gravado, mas escapa da
 * consulta, que é escopada por setor pela regra do Firestore.
 */
import {
  MAX_SETORES_ANTERIORES,
  destinosPossiveis,
  mapearColuna,
  planoDaMudanca,
  podeMover,
  setoresDoHistorico,
} from "../src/lib/mover-setor-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const operador = { role: "operador", sectors: ["B.I.", "Cantinas"] };
const deUmSetor = { role: "operador", sectors: ["B.I."] };
const gestor = { role: "gestor", sectors: ["B.I.", "Infra"] };
const admin = { role: "admin", sectors: [] };

console.log("\n— quem pode mover —");

checa("operador com os DOIS setores move", podeMover(operador, "B.I.", "Cantinas"));
checa(
  "operador com um setor só NÃO move — seria escrever em quadro que ele não vê",
  !podeMover(deUmSetor, "B.I.", "Cantinas"),
);
checa(
  "nem para dentro do próprio setor, vindo de fora",
  !podeMover(deUmSetor, "Cantinas", "B.I."),
);
checa("gestor segue a mesma regra dos dois setores", podeMover(gestor, "B.I.", "Infra"));
checa("gestor sem o destino não move", !podeMover(gestor, "B.I.", "Cantinas"));
checa(
  "admin atravessa — ele enxerga todo setor, e o cadastro dele costuma ser vazio",
  podeMover(admin, "B.I.", "Cantinas"),
);
checa("mover para o mesmo setor não é operação", !podeMover(operador, "B.I.", "B.I."));
checa(
  "setor vazio dos dois lados é recusado",
  !podeMover(operador, "", "Cantinas") && !podeMover(operador, "B.I.", ""),
);
checa("sem pessoa, não move", !podeMover(null, "B.I.", "Cantinas"));
checa(
  "cadastro sem sectors não explode e não move",
  !podeMover({ role: "operador" }, "B.I.", "Cantinas"),
);
checa(
  "sectors com lixo dentro não vira permissão",
  !podeMover({ role: "operador", sectors: [null, 7, "  "] }, "B.I.", "Cantinas"),
);

console.log("\n— o que a tela oferece —");

checa(
  "só os outros setores da pessoa, em ordem alfabética",
  destinosPossiveis(operador, "B.I.").join(",") === "Cantinas",
);
checa(
  "o setor de origem nunca aparece na lista",
  !destinosPossiveis(operador, "Cantinas").includes("Cantinas"),
);
checa(
  "quem tem um setor só não recebe destino nenhum — a ação não é oferecida",
  destinosPossiveis(deUmSetor, "B.I.").length === 0,
);
checa(
  "para o admin, a lista vem do cadastro de setores",
  destinosPossiveis(admin, "B.I.", ["Cantinas", "Infra", "B.I."]).join(",") ===
    "Cantinas,Infra",
);
checa(
  "para quem não é admin, o cadastro global NÃO amplia nada",
  destinosPossiveis(deUmSetor, "B.I.", ["Cantinas", "Infra"]).length === 0,
);

console.log("\n— a etapa equivalente no outro quadro —");

const padrao = [
  { colId: "backlog", title: "A fazer" },
  { colId: "andamento", title: "Em andamento" },
  { colId: "concluido", title: "Concluído" },
];

checa(
  "mesmo id: o caso comum, porque os setores nascem com as mesmas cinco etapas",
  mapearColuna("andamento", padrao)?.colId === "andamento" &&
    mapearColuna("andamento", padrao)?.por === "mesmo-id",
);
checa(
  "id que não existe cai na ENTRADA, que é a primeira coluna",
  mapearColuna("revisao_x9", padrao)?.colId === "backlog" &&
    mapearColuna("revisao_x9", padrao)?.por === "entrada",
);
checa(
  "mesmo NOME salva a etapa criada à mão nos dois setores, com ids diferentes",
  (() => {
    const destino = [
      { colId: "backlog", title: "A fazer" },
      { colId: "c_8h2k", title: "Em revisão" },
    ];
    const r = mapearColuna("c_zzz1", destino, "EM REVISAO");
    return r?.colId === "c_8h2k" && r?.por === "mesmo-nome";
  })(),
);
checa(
  "o id ganha do nome quando os dois casam — id é identidade, nome é rótulo",
  (() => {
    const destino = [
      { colId: "andamento", title: "Tocando" },
      { colId: "outro", title: "Em andamento" },
    ];
    return mapearColuna("andamento", destino, "Em andamento")?.colId === "andamento";
  })(),
);
checa(
  "sem o título, a segunda tentativa não acontece e cai na entrada",
  mapearColuna("c_zzz1", [{ colId: "c_8h2k", title: "Em revisão" }])?.por === "entrada",
);
checa(
  "destino sem coluna nenhuma devolve null — nunca um columnId inventado",
  mapearColuna("andamento", []) === null,
);

console.log("\n— o plano inteiro —");

const card = {
  sector: "B.I.",
  columnId: "andamento",
  assignee: "ana@px.com.br",
  dimensaoId: "d1",
  subdimensaoId: "s3",
};

const plano = planoDaMudanca({
  pessoa: operador,
  card,
  tituloDaColunaAtual: "Em andamento",
  destino: "Cantinas",
  colsDestino: padrao,
  setoresDoResponsavel: ["B.I."],
  agora: 5000,
});

checa("o setor muda", plano?.patch.sector === "Cantinas");
checa("a etapa é a equivalente", plano?.patch.columnId === "andamento");
checa(
  "a classificação de dimensão é APAGADA — ela é cadastro por setor",
  plano?.patch.dimensaoId === null && plano?.patch.subdimensaoId === null,
);
checa("e a tela é avisada disso", plano?.limpaClassificacao === true);
checa(
  "o relógio da etapa recomeça — senão o card chega dizendo que está parado",
  plano?.patch.enteredAt === 5000,
);
checa("e a demanda chega no topo, para ser vista", plano?.patch.order === -5000);
checa(
  "o responsável de fora do destino é AVISADO, não apagado",
  plano?.responsavelForaDoDestino === true &&
    !Object.prototype.hasOwnProperty.call(plano.patch, "assignee"),
);
checa(
  "responsável que participa do destino não gera aviso",
  planoDaMudanca({
    pessoa: operador,
    card: { ...card, assignee: "bia@px.com.br" },
    destino: "Cantinas",
    colsDestino: padrao,
    setoresDoResponsavel: ["B.I.", "Cantinas"],
    agora: 1,
  })?.responsavelForaDoDestino === false,
);
checa(
  "demanda sem responsável nunca gera o aviso",
  planoDaMudanca({
    pessoa: operador,
    card: { ...card, assignee: null },
    destino: "Cantinas",
    colsDestino: padrao,
    setoresDoResponsavel: [],
    agora: 1,
  })?.responsavelForaDoDestino === false,
);
checa(
  "solicitante e responsável NÃO entram no patch: quem pediu continua quem pediu",
  Object.keys(plano.patch).sort().join(",") ===
    "columnId,conclusaoPedida,dimensaoId,enteredAt,order,sector,setoresAnteriores,subdimensaoId",
  Object.keys(plano.patch).sort().join(","),
);
checa(
  "o pedido de conclusão em aberto é CANCELADO — o colunaAlvo dele é do outro quadro",
  (() => {
    const p = planoDaMudanca({
      pessoa: operador,
      card: {
        ...card,
        conclusaoPedida: { por: "bia@px.com.br", em: 1, colunaAlvo: "concluido" },
      },
      destino: "Cantinas",
      colsDestino: padrao,
      agora: 1,
    });
    return p?.cancelaPedidoDeConclusao === true && p?.patch.conclusaoPedida === null;
  })(),
);
checa(
  "sem pedido, a tela não avisa de cancelamento nenhum — mas o campo vai null igual",
  plano?.cancelaPedidoDeConclusao === false && plano?.patch.conclusaoPedida === null,
);
checa(
  "sem permissão não há plano — a tela não oferece a ação",
  planoDaMudanca({
    pessoa: deUmSetor,
    card,
    destino: "Cantinas",
    colsDestino: padrao,
    agora: 1,
  }) === null,
);
checa(
  "destino sem coluna nenhuma também não tem plano",
  planoDaMudanca({
    pessoa: operador,
    card,
    destino: "Cantinas",
    colsDestino: [],
    agora: 1,
  }) === null,
);
checa(
  "demanda não classificada não anuncia que vai limpar classificação",
  planoDaMudanca({
    pessoa: operador,
    card: { ...card, dimensaoId: null, subdimensaoId: null },
    destino: "Cantinas",
    colsDestino: padrao,
    agora: 1,
  })?.limpaClassificacao === false,
);

console.log("\n— por onde a demanda passou, e o histórico que sobrevive —");

checa("o setor de origem entra na lista", plano?.patch.setoresAnteriores.join(",") === "B.I.");
checa(
  "ir e voltar não enche a lista com o mesmo par",
  (() => {
    const volta = planoDaMudanca({
      pessoa: operador,
      card: { ...card, sector: "Cantinas", setoresAnteriores: ["B.I."] },
      destino: "B.I.",
      colsDestino: padrao,
      agora: 1,
    });
    // "B.I." é o DESTINO agora, então ele sai da lista de anteriores; sobra a
    // Cantinas, de onde a demanda está saindo.
    return volta?.patch.setoresAnteriores.join(",") === "Cantinas";
  })(),
);
checa(
  "a lista tem teto — o `in` do Firestore não aceita mais de 30 valores",
  (() => {
    const muitos = Array.from({ length: 40 }, (_, i) => `S${i}`);
    const p = planoDaMudanca({
      pessoa: admin,
      card: { ...card, setoresAnteriores: muitos },
      destino: "Cantinas",
      colsDestino: padrao,
      agora: 1,
    });
    return p?.patch.setoresAnteriores.length === MAX_SETORES_ANTERIORES;
  })(),
);
checa(
  "o atual vem primeiro na consulta do histórico",
  setoresDoHistorico({ sector: "Cantinas", setoresAnteriores: ["B.I."] }).join(",") ===
    "Cantinas,B.I.",
);
checa(
  "demanda nunca transferida devolve UM setor — a consulta de sempre",
  setoresDoHistorico({ sector: "B.I." }).join(",") === "B.I.",
);
checa(
  "o atual não aparece duas vezes, mesmo se estiver na lista de anteriores",
  setoresDoHistorico({ sector: "B.I.", setoresAnteriores: ["B.I.", "Infra"] }).join(",") ===
    "B.I.,Infra",
);
checa(
  "a consulta nunca passa de 30 valores",
  setoresDoHistorico({
    sector: "X",
    setoresAnteriores: Array.from({ length: 50 }, (_, i) => `S${i}`),
  }).length === 30,
);

console.log(
  falhas === 0 ? "\nmover de setor: ok" : `\nmover de setor: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
