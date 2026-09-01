/**
 * Testes da ata de reunião (`lib/ata-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que olhar a tela não protege: a ORDEM da pauta
 * e o que ela deixa de fora. A ata que originou esta frente registrou a queixa
 * de que a reunião "gastava a hora e ninguém saía com nada para fazer amanhã";
 * a resposta desta tela é pôr o atrasado em cima e o decidido embaixo. Uma
 * pauta ordenada errado desenha exatamente igual a uma pauta certa — mesmas
 * linhas, mesmas cores — e o defeito só aparece na reunião, quando já custou a
 * hora de sete pessoas.
 *
 * A outra metade é sobre a ata continuar sendo ATA: uma demanda entregue depois
 * da reunião não pode sumir do documento que a decidiu.
 *
 * O relógio entra por parâmetro (`hoje`), como em todo teste de data deste
 * projeto: teste que lê o relógio do sistema passa hoje e falha em outubro.
 */
import {
  ESTADOS_NA_ATA,
  ESTADO_LABEL,
  STATUS_TAREFA,
  ataVazia,
  estadoNaAta,
  herdarParaProxima,
  limparTexto,
  montarPauta,
  normalizarAta,
  proximoIdDeTarefa,
  resumoDaAta,
  tarefaNova,
} from "../src/lib/ata-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

/** Quarta-feira, 26 de agosto de 2026 — a data da ata das cantinas. */
const HOJE = new Date(2026, 7, 26).getTime();
const SETOR = "Cantinas";
const ENTREGUES = { [SETOR]: new Set(["entregue"]) };

const DIMS = [
  { id: "d1", nome: "D1 · Cadeia de suprimentos", ordem: 1, subs: [{ id: "1", nome: "Estoque" }] },
  { id: "d2", nome: "D2 · Operação e gente", ordem: 2, subs: [] },
];

const card = (id, extra = {}) => ({
  id,
  sector: SETOR,
  columnId: "andamento",
  title: id,
  ...extra,
});

console.log("\n— o estado que a ata conta —");

checa(
  "card na coluna de entrega é concluída, aconteça o que acontecer com o prazo",
  estadoNaAta(card("a", { columnId: "entregue", due: "2020-01-01" }), undefined, ENTREGUES, HOJE) ===
    "concluida",
);
checa(
  "prazo no passado é atrasada",
  estadoNaAta(card("b", { due: "2026-08-20" }), undefined, ENTREGUES, HOJE) === "atrasada",
);
checa(
  "o próprio dia do prazo ainda NÃO está atrasado",
  estadoNaAta(card("c", { due: "2026-08-26" }), undefined, ENTREGUES, HOJE) !== "atrasada",
);
checa(
  "sem decisão registrada, está pendente de decisão",
  estadoNaAta(card("d"), undefined, ENTREGUES, HOJE) === "pendente",
);
// Decisão apagada e decisão que nunca existiu são a mesma coisa aqui, e é de
// propósito: as duas precisam voltar a ser faladas.
checa(
  "item com decisão em branco também é pendente",
  estadoNaAta(card("e"), { id: "e", cardId: "e", assunto: "", contexto: "", dimensaoId: "", subdimensaoId: "", decisao: "", objetivo: "", proximaReuniao: false, tarefas: [] }, ENTREGUES, HOJE) ===
    "pendente",
);
checa(
  "com decisão registrada, passa a em andamento",
  estadoNaAta(
    card("f"),
    { id: "f", cardId: "f", assunto: "", contexto: "", dimensaoId: "", subdimensaoId: "", decisao: "Aprovar o piloto", objetivo: "", proximaReuniao: false, tarefas: [] },
    ENTREGUES,
    HOJE,
  ) === "andamento",
);
checa(
  "todo estado tem rótulo",
  Object.keys(ESTADO_LABEL).length === ESTADOS_NA_ATA.length,
  `${Object.keys(ESTADO_LABEL).length} rótulos para ${ESTADOS_NA_ATA.length} estados`,
);
checa(
  "e a lista da tela cobre todos eles, sem sobra",
  ESTADOS_NA_ATA.every((e) => ESTADO_LABEL[e]) &&
    new Set(ESTADOS_NA_ATA).size === ESTADOS_NA_ATA.length,
);

console.log("\n— o assunto que ainda não é demanda —");

// Um item sem card não tem quadro: não pode herdar prazo nem coluna, e por isso
// não pode ser "atrasada" nem "concluída". Estas três checagens são a fronteira.
const semCard = (extra = {}) => ({
  id: "x",
  cardId: "",
  assunto: "Estoque",
  contexto: "",
  dimensaoId: "",
  subdimensaoId: "",
  decisao: "",
  objetivo: "",
  proximaReuniao: false,
  tarefas: [],
  ...extra,
});

checa(
  "sem card, sem decisão e sem nada pedido é REGISTRO, não pendência",
  estadoNaAta(null, semCard(), ENTREGUES, HOJE) === "registro",
);
checa(
  "sem card, mas com objetivo, volta a ser pendente decisão",
  estadoNaAta(null, semCard({ objetivo: "Fechar a cadência" }), ENTREGUES, HOJE) ===
    "pendente",
);
checa(
  "sem card, mas com tarefa, também é pendente decisão",
  estadoNaAta(
    null,
    semCard({ tarefas: [{ id: "1", texto: "t", responsavel: "", prazo: "", status: "pendente", observacao: "" }] }),
    ENTREGUES,
    HOJE,
  ) === "pendente",
);
checa(
  "sem card e com decisão, é em andamento",
  estadoNaAta(null, semCard({ decisao: "Regularizar o balanço" }), ENTREGUES, HOJE) ===
    "andamento",
);

console.log("\n— a pauta: ordem, numeração e quem entra —");

const cards = [
  card("tranquila", { dimensaoId: "d2" }),
  card("atrasada", { due: "2026-08-01", dimensaoId: "d1", subdimensaoId: "1" }),
  card("decidida", { dimensaoId: "d1" }),
  card("entregue-sem-registro", { columnId: "entregue" }),
  card("entregue-com-registro", { columnId: "entregue" }),
];
const ata = {
  itens: [
    { cardId: "decidida", decisao: "Seguir com o balanço", objetivo: "Ver o número", proximaReuniao: true, tarefas: [] },
    { cardId: "entregue-com-registro", decisao: "Fechado na reunião passada", objetivo: "", proximaReuniao: false, tarefas: [] },
  ],
};
const pauta = montarPauta({ cards, ata, dimensoes: DIMS, entregues: ENTREGUES, hoje: HOJE });
const ordem = pauta.map((l) => l.card.id).join(",");
checa("linha de card sempre traz o título dele", pauta.every((l) => l.titulo === l.card.title));

checa(
  "o atrasado vem primeiro; o decidido, depois do pendente; o concluído por último",
  ordem === "atrasada,tranquila,decidida,entregue-com-registro",
  ordem,
);
checa(
  "demanda entregue que a ata NÃO registrou fica de fora",
  !pauta.some((l) => l.card.id === "entregue-sem-registro"),
);
// É isto que faz a ata continuar sendo ata: a demanda decidida na reunião e
// entregue no dia seguinte não pode sumir do documento que a decidiu.
checa(
  "demanda entregue que a ata registrou CONTINUA nela",
  pauta.some((l) => l.card.id === "entregue-com-registro"),
);
checa(
  "a numeração é atribuída depois de ordenar, e começa em 01",
  pauta[0].numero === "01" && pauta[3].numero === "04",
  pauta.map((l) => l.numero).join(","),
);
checa(
  "a dimensão e a subdimensão viram texto ao lado",
  pauta[0].dimensao === "D1 · Cadeia de suprimentos" && pauta[0].subdimensao === "Estoque",
  `${pauta[0].dimensao} / ${pauta[0].subdimensao}`,
);
checa(
  "demanda sem classificação não inventa dimensão",
  pauta.find((l) => l.card.id === "entregue-com-registro").dimensao === "",
);
checa(
  "demanda que a ata nunca tocou entra com item vazio, não com undefined",
  pauta[0].item.decisao === "" && Array.isArray(pauta[0].item.tarefas),
);

// Dentro do MESMO estado, a dimensão ordena — e "sem classificação" vai para o
// fim, em vez de ganhar a primeira posição com `ordem` zero.
const mesmoEstado = montarPauta({
  cards: [card("sem-dim"), card("da-d2", { dimensaoId: "d2" }), card("da-d1", { dimensaoId: "d1" })],
  ata: { itens: [] },
  dimensoes: DIMS,
  entregues: ENTREGUES,
  hoje: HOJE,
});
checa(
  "no mesmo estado, ordena pela dimensão e joga a sem classificação para o fim",
  mesmoEstado.map((l) => l.card.id).join(",") === "da-d1,da-d2,sem-dim",
  mesmoEstado.map((l) => l.card.id).join(","),
);

console.log("\n— o resumo da coluna da esquerda —");

const comTarefas = {
  itens: [
    {
      cardId: "decidida",
      decisao: "Seguir",
      objetivo: "",
      proximaReuniao: false,
      tarefas: [
        { id: "1", texto: "Mapear", responsavel: "a@x", prazo: "", status: "concluida", observacao: "" },
        { id: "2", texto: "Treinar", responsavel: "", prazo: "", status: "pendente", observacao: "" },
      ],
    },
  ],
};
const r = resumoDaAta(
  montarPauta({ cards, ata: comTarefas, dimensoes: DIMS, entregues: ENTREGUES, hoje: HOJE }),
);
checa("conta uma atrasada", r.porEstado.atrasada === 1, JSON.stringify(r.porEstado));
checa("em aberto é tudo menos as concluídas", r.emAberto === 3, String(r.emAberto));
checa("conta as tarefas e as feitas", r.tarefas === 2 && r.tarefasFeitas === 1);
checa("pauta vazia não quebra o resumo", resumoDaAta([]).emAberto === 0);

console.log("\n— o que a próxima reunião herda —");

const herdado = herdarParaProxima({
  itens: [
    {
      cardId: "vai",
      decisao: "Aprovado",
      objetivo: "Validar o piloto",
      proximaReuniao: true,
      tarefas: [
        { id: "1", texto: "feita", responsavel: "", prazo: "", status: "concluida", observacao: "" },
        { id: "2", texto: "aberta", responsavel: "", prazo: "", status: "andamento", observacao: "" },
      ],
    },
    { cardId: "fica", decisao: "Encerrado", objetivo: "", proximaReuniao: false, tarefas: [] },
    {
      id: "9",
      cardId: "",
      assunto: "Sistema Connect e totens",
      contexto: "Totem custa cerca de R$ 5.800",
      dimensaoId: "d1",
      subdimensaoId: "1",
      decisao: "Separar sistema de totem",
      objetivo: "Trazer a proposta",
      proximaReuniao: true,
      tarefas: [],
    },
  ],
});
checa("só os marcados são levados", herdado.length === 2 && herdado[0].cardId === "vai");
// Sem card, assunto e classificação são a ÚNICA coisa que diz do que a linha
// trata. Deixá-los para trás levaria para a próxima reunião uma pauta de itens
// sem nome — e a numeração da tela não ajuda a lembrar do que era o "04".
checa(
  "o assunto sem card vai junto, com contexto e dimensão",
  herdado[1].assunto === "Sistema Connect e totens" &&
    herdado[1].contexto === "Totem custa cerca de R$ 5.800" &&
    herdado[1].dimensaoId === "d1" &&
    herdado[1].subdimensaoId === "1",
);
// A decisão é DESTA reunião. Repeti-la faria a ata nova nascer afirmando que
// decidiu o que outra decidiu.
checa("a decisão NÃO vai junto", herdado[0].decisao === "");
checa("o objetivo vai — ele já foi escrito olhando para a frente", herdado[0].objetivo === "Validar o piloto");
checa("a tarefa concluída fica para trás", herdado[0].tarefas.length === 1 && herdado[0].tarefas[0].texto === "aberta");
checa("e a marca de 'próxima' não se propaga sozinha", herdado[0].proximaReuniao === false);

console.log("\n— ids de tarefa: nunca reaproveitados —");

checa("a primeira é 1", proximoIdDeTarefa([]) === "1");
checa(
  "o buraco NÃO é reaproveitado",
  proximoIdDeTarefa([{ id: "1" }, { id: "3" }]) === "4",
  proximoIdDeTarefa([{ id: "1" }, { id: "3" }]),
);
checa("id não numérico não derruba a conta", proximoIdDeTarefa([{ id: "x" }, { id: "2" }]) === "3");
checa("a tarefa nova nasce pendente e vazia", tarefaNova([]).status === "pendente" && tarefaNova([]).texto === "");

console.log("\n— ler o documento em qualquer estado —");

checa("não-objeto é null", normalizarAta("a", null) === null && normalizarAta("a", 7) === null);
checa("sem setor é null — é por ele que a regra do Firestore fecha", normalizarAta("a", { titulo: "x" }) === null);

const suja = normalizarAta("a", {
  setor: SETOR,
  titulo: "   Reunião   das   cantinas  ",
  data: "26/08/2026",
  horaInicio: "9h",
  horaFim: "10:30",
  participantes: ["a@x", "a@x", 7, ""],
  itens: [
    null,
    { decisao: "sem cardId" },
    {
      cardId: "c1",
      decisao: "  Aprovar  ",
      tarefas: [
        { id: "1", texto: "ok", status: "inventado" },
        { id: "1", texto: "id repetido" },
        "isto não é tarefa",
      ],
    },
  ],
});
checa("o título é limpo", suja.titulo === "Reunião das cantinas", suja.titulo);
checa("data em formato errado vira vazio, não uma data inventada", suja.data === "");
checa("hora malformada cai fora, e a boa fica", suja.horaInicio === "" && suja.horaFim === "10:30");
checa("participante repetido e lixo saem", suja.participantes.join(",") === "a@x");
checa(
  "item sem cardId E sem assunto sai; o bom fica",
  suja.itens.length === 1 && suja.itens[0].cardId === "c1",
);
// A ata gravada antes de existir `id` de item não pode abrir quebrada. O
// migrador é o próprio `cardId`, que já era único por item — sem script, sem
// reescrever documento nenhum.
checa(
  "item antigo, sem id, herda o cardId como identidade",
  suja.itens[0].id === "c1",
  suja.itens[0].id,
);
checa("status inventado vira pendente", suja.itens[0].tarefas[0].status === "pendente");
// Descartar a segunda apagaria a tarefa de alguém por causa de um id; ela é
// renumerada. Duas linhas com a mesma `key` é o único estado que quebra a tela.
checa(
  "id repetido é renumerado, não descartado",
  suja.itens[0].tarefas.length === 2 &&
    suja.itens[0].tarefas[0].id !== suja.itens[0].tarefas[1].id,
  JSON.stringify(suja.itens[0].tarefas.map((t) => t.id)),
);
// Assunto sem card é a razão de ser da ata gerada de reunião: o setor Cantinas
// não tinha card nenhum quando a primeira nasceu, e sem isto ela abriria vazia.
const comAssunto = normalizarAta("b", {
  setor: SETOR,
  titulo: "Dimensões cantinas",
  itens: [
    { id: "1", assunto: "Estoque, recebimento e conferência", decisao: "Regularizar o balanço" },
    { id: "2", assunto: "Em aberto", contexto: "POPs sem quem assine" },
    { id: "2", assunto: "id repetido" },
  ],
});
checa("item sem card sobrevive à leitura", comAssunto.itens.length === 3);
checa(
  "id de item repetido é renumerado, como o das tarefas e pelo mesmo motivo",
  new Set(comAssunto.itens.map((i) => i.id)).size === 3,
  JSON.stringify(comAssunto.itens.map((i) => i.id)),
);

const pautaSemCard = montarPauta({
  cards: [],
  ata: comAssunto,
  dimensoes: DIMS,
  entregues: ENTREGUES,
  hoje: HOJE,
});
checa("quadro vazio não impede a pauta de existir", pautaSemCard.length === 3);
checa(
  "a linha sem card imprime o assunto como título",
  pautaSemCard.some((l) => l.titulo === "Estoque, recebimento e conferência" && l.card === null),
);
// "Outros pontos" e "Em aberto" chegam sem decisão e sem tarefa. Contados como
// pendência, abriam a pauta e empurravam para baixo o que a reunião decidiu.
checa(
  "o que não pede nada de ninguém vai para o fim, como registro",
  pautaSemCard[pautaSemCard.length - 1].estado === "registro",
  pautaSemCard.map((l) => `${l.titulo}:${l.estado}`).join(" | "),
);
checa(
  "e registro não conta como demanda em aberto",
  resumoDaAta(pautaSemCard).emAberto === 1,
  String(resumoDaAta(pautaSemCard).emAberto),
);

checa("ata vazia nasce sem item e com o setor no lugar", ataVazia(SETOR, "2026-08-26").itens.length === 0);
checa("limparTexto corta no teto", limparTexto("x".repeat(900)).length === 600);
checa("todo status de tarefa tem valor", STATUS_TAREFA.length === 3);

console.log(falhas === 0 ? "\nata: ok" : `\nata: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
