/**
 * Testes do pedido de conclusão (`lib/conclusao-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar a tela não prova: que o operador não
 * conclui por engano de leitura de papel, e que o pedido some inteiro quando é
 * aprovado ou recusado. O erro aqui não tem sintoma imediato — o quadro continua
 * funcionando, a demanda continua no lugar, e o que se perde é a revisão da
 * daily, que é justamente a coisa que ninguém nota faltando até o mês fechar.
 *
 * A metade mais importante é a do PAPEL DESCONHECIDO. Cadastro sem `role`, papel
 * escrito com maiúscula, papel de uma versão futura — os três existem no banco,
 * e os três precisam cair no lado de pedir. Um `role` vazio virando "conclui
 * direto" seria a frente inteira desligada para quem tem o cadastro incompleto,
 * calada.
 */
import {
  colunaDeConclusao,
  comPedidosNoTopo,
  contarPedidos,
  patchDeAprovacao,
  patchDePedido,
  patchDeRecusa,
  pedidoDoCard,
  podeConcluirDireto,
  precisaPedirConclusao,
  temPedido,
} from "../src/lib/conclusao-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— quem conclui sozinho —");

checa("admin conclui", podeConcluirDireto("admin"));
checa("gestor conclui", podeConcluirDireto("gestor"));
checa("operador PEDE", !podeConcluirDireto("operador"));
checa(
  "a caixa e o espaço não decidem papel",
  podeConcluirDireto(" Gestor ") && podeConcluirDireto("ADMIN"),
);
checa(
  "papel ausente cai no lado de PEDIR, nunca no de concluir",
  !podeConcluirDireto(undefined) &&
    !podeConcluirDireto(null) &&
    !podeConcluirDireto(""),
);
checa(
  "papel de uma versão futura também PEDE",
  !podeConcluirDireto("supervisor") && !podeConcluirDireto("coordenador"),
);
checa("papel que nem é texto PEDE", !podeConcluirDireto(7) && !podeConcluirDireto({}));

console.log("\n— o campo do card, lido como o banco pode devolvê-lo —");

const bom = { conclusaoPedida: { por: "ana@px.com.br", em: 1000, colunaAlvo: "concluido" } };

checa("pedido inteiro é pedido", temPedido(bom));
checa("card sem o campo não tem pedido", !temPedido({}));
checa("campo null não é pedido", !temPedido({ conclusaoPedida: null }));
checa(
  "pedido sem quem pediu não é pedido — a tela mostraria 'pedido por' e nada",
  !temPedido({ conclusaoPedida: { em: 1, colunaAlvo: "concluido" } }),
);
checa(
  "pedido sem coluna alvo não é pedido — aprovar mandaria o card para fora do quadro",
  !temPedido({ conclusaoPedida: { por: "ana@px.com.br", em: 1 } }),
);
checa(
  "coluna alvo só com espaço conta como ausente",
  !temPedido({ conclusaoPedida: { por: "ana@px.com.br", em: 1, colunaAlvo: "   " } }),
);
checa(
  "hora ausente ou estragada vira 0, e o pedido continua valendo",
  pedidoDoCard({ conclusaoPedida: { por: "a@b.c", colunaAlvo: "x" } })?.em === 0 &&
    pedidoDoCard({ conclusaoPedida: { por: "a@b.c", colunaAlvo: "x", em: NaN } })?.em === 0,
);
checa(
  "o que sai é limpo, não o objeto cru do banco",
  pedidoDoCard({ conclusaoPedida: { por: "  ana@px.com.br ", em: 5, colunaAlvo: " feito " } })
    ?.colunaAlvo === "feito",
);
checa("campo que não é objeto não explode", !temPedido({ conclusaoPedida: "sim" }));

console.log("\n— quando o gesto vira pedido —");

const entregues = new Set(["concluido", "arquivo"]);
const pede = (papel, de, para) =>
  precisaPedirConclusao({ papel, colunaAtual: de, colunaDestino: para, entregues });

checa("operador arrastando para a conclusão: pede", pede("operador", "andamento", "concluido"));
checa("gestor arrastando para a conclusão: não pede", !pede("gestor", "andamento", "concluido"));
checa("admin arrastando para a conclusão: não pede", !pede("admin", "andamento", "concluido"));
checa(
  "operador arrastando entre etapas comuns: não pede nada",
  !pede("operador", "backlog", "andamento"),
);
checa(
  "reordenar DENTRO da coluna de concluídos não pergunta nada",
  !pede("operador", "concluido", "concluido"),
);
checa(
  "a segunda etapa de conclusão do setor também pede",
  pede("operador", "concluido", "arquivo"),
);
checa(
  "quadro sem etapa de conclusão nunca pede",
  !precisaPedirConclusao({
    papel: "operador",
    colunaAtual: "a",
    colunaDestino: "b",
    entregues: new Set(),
  }),
);

console.log("\n— para onde o botão aponta —");

checa(
  "a ÚLTIMA das entregues na ordem do quadro, não a primeira",
  colunaDeConclusao(["backlog", "concluido", "arquivo"], entregues) === "arquivo",
);
checa(
  "com uma só, é ela",
  colunaDeConclusao(["backlog", "andamento", "concluido"], new Set(["concluido"])) ===
    "concluido",
);
checa(
  "quadro sem etapa de conclusão devolve null, e a tela não oferece o botão",
  colunaDeConclusao(["backlog", "andamento"], new Set()) === null,
);
checa("quadro sem coluna nenhuma devolve null", colunaDeConclusao([], entregues) === null);

console.log("\n— a fila que a daily lê —");

const p = (id, pedido) => ({
  id,
  conclusaoPedida: pedido
    ? { por: "ana@px.com.br", em: 1, colunaAlvo: "concluido" }
    : null,
});
const ids = (lista) => lista.map((c) => c.id).join("");

checa(
  "os pedidos sobem para o topo",
  ids(comPedidosNoTopo([p("a"), p("b", true), p("c"), p("d", true)])) === "bdac",
  ids(comPedidosNoTopo([p("a"), p("b", true), p("c"), p("d", true)])),
);
checa(
  "quem não tem pedido mantém a ordem que veio",
  ids(comPedidosNoTopo([p("a"), p("b"), p("c")])) === "abc",
);
checa(
  "os pedidos entre si mantêm a ordem que veio",
  ids(comPedidosNoTopo([p("a", true), p("b", true)])) === "ab",
);
checa(
  "sem pedido nenhum, devolve a MESMA lista — a cópia à toa invalida memo",
  (() => {
    const lista = [p("a"), p("b")];
    return comPedidosNoTopo(lista) === lista;
  })(),
);
checa(
  "não altera a lista que recebeu",
  (() => {
    const lista = [p("a"), p("b", true)];
    const antes = ids(lista);
    comPedidosNoTopo(lista);
    return ids(lista) === antes;
  })(),
);
checa("lista vazia não explode", ids(comPedidosNoTopo([])) === "");
checa(
  "a contagem é a do quadro inteiro",
  contarPedidos([p("a"), p("b", true), p("c", true)]) === 2 && contarPedidos([]) === 0,
);
checa(
  "pedido pela metade não conta nem sobe — é o mesmo julgamento em toda parte",
  (() => {
    const meio = { id: "x", conclusaoPedida: { por: "ana@px.com.br", em: 1 } };
    return contarPedidos([meio]) === 0 && ids(comPedidosNoTopo([p("a"), meio])) === "ax";
  })(),
);

console.log("\n— as três transições —");

const patch = patchDePedido("ana@px.com.br", "concluido", 1234);
checa(
  "pedir grava quem, quando e para onde",
  patch.conclusaoPedida.por === "ana@px.com.br" &&
    patch.conclusaoPedida.em === 1234 &&
    patch.conclusaoPedida.colunaAlvo === "concluido",
);
checa("o que se grava é lido de volta como pedido", temPedido(patch));

const aprovado = patchDeAprovacao(pedidoDoCard(bom), 9999);
checa(
  "aprovar move para a coluna que o PEDIDO apontou",
  aprovado.columnId === "concluido",
);
checa(
  "aprovar reinicia o relógio da etapa — senão o card chega parado há semanas",
  aprovado.enteredAt === 9999,
);
checa(
  "aprovar apaga o pedido com null, nunca com undefined",
  aprovado.conclusaoPedida === null &&
    Object.prototype.hasOwnProperty.call(aprovado, "conclusaoPedida"),
);
checa(
  "aprovar e mover andam no MESMO patch — meia aprovação é o pior estado",
  Object.keys(aprovado).sort().join(",") === "columnId,conclusaoPedida,enteredAt",
);
checa(
  "recusar apaga o pedido com null e não toca em mais nada",
  (() => {
    const r = patchDeRecusa();
    return r.conclusaoPedida === null && Object.keys(r).length === 1;
  })(),
);
checa(
  "depois de aprovar ou recusar, o card não tem mais pedido",
  !temPedido(aprovado) && !temPedido(patchDeRecusa()),
);

console.log(
  falhas === 0 ? "\npedido de conclusão: ok" : `\npedido de conclusão: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
