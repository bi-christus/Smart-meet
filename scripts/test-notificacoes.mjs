/**
 * Testes das notificações da lateral.
 *
 * Os dois erros que importam aqui são de PRIVACIDADE e de RUÍDO, e nenhum
 * aparece como erro: a lateral só mostra coisa a mais. Notícia de card alheio
 * na lateral de alguém é o setor inteiro vazando para quem não pediu; notícia
 * do que a própria pessoa fez é barulho que ensina a ignorar a lateral.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  LIMITE_CARDS_CONSULTADOS,
  JANELA_MS,
  cardsParaConsultar,
  novidades,
  separarVistas,
  podarVistas,
  pendencias,
  quando,
  textoDoEvento,
} from "../src/lib/notificacoes-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

const EU = "eu@christus.edu.br";
const ANA = "ana@christus.edu.br";
const nomeDe = (e) => (e === ANA ? "Ana" : e);

const cards = [
  { id: "c1", sector: "B.I.", title: "Painel", assignee: EU },
  { id: "c2", sector: "B.I.", title: "Criado por mim", createdBy: "EU@christus.edu.br " },
  { id: "c3", sector: "B.I.", title: "Do colega", assignee: ANA, createdBy: ANA },
];
const ev = (id, autor, em, acao, mudancas = []) => ({ id, autor, em, acao, mudancas });
const eventos = new Map([
  ["c1", [
    ev("e1", ANA, 3000, "movida", [{ campo: "coluna", de: "A fazer", para: "Em andamento" }]),
    ev("e2", EU, 4000, "editada"),
  ]],
  ["c2", [ev("e3", ANA, 2000, "conclusao-aprovada")]],
  ["c3", [ev("e4", "bob@x", 5000, "editada")]],
]);

const reunioes = [
  { id: "r1", title: "Comitê", date: "2026-10-10", status: "processado", reportStatus: "rascunho", createdBy: EU },
  { id: "r2", title: "Validada", date: "2026-10-11", status: "processado", reportStatus: "validada", createdBy: EU },
  { id: "r3", title: "Processando", date: "2026-10-12", status: "processando", createdBy: EU },
  { id: "r4", title: "Da Ana", date: "2026-10-12", status: "processado", createdBy: ANA },
];
const propostas = [
  { id: "p1", meetingId: "r2", status: "pendente", proposta: { title: "X" }, sectorAlvo: "B.I." },
  { id: "p2", meetingId: "r1", status: "aceita", proposta: { title: "Nova demanda" }, sectorAlvo: "B.I.", decisao: { por: ANA, em: 6000, cardId: "c9" } },
  { id: "p3", meetingId: "r1", status: "recusada", proposta: { title: "Eu recusei" }, sectorAlvo: "B.I.", decisao: { por: EU, em: 7000 } },
  { id: "p4", meetingId: "r4", status: "aceita", proposta: { title: "Da reunião da Ana" }, sectorAlvo: "B.I.", decisao: { por: "bob@x", em: 8000 } },
];

// --- novidades: só movimentação, só do que é meu, só dos outros -----------
const AGORA = 10_000;
const lista = novidades({ email: EU, cards, eventos, nomeDe, agora: AGORA });
const ids = lista.map((n) => n.id);

checa("movimentação de outra pessoa no meu card entra", ids.includes("evento:c1:e1"), ids.join(", "));
checa("card de outra pessoa não entra", !ids.some((i) => i.includes(":c3:")));
checa("o que eu mesmo fiz não entra", !ids.includes("evento:c1:e2"));
checa(
  "o que não é movimentação não entra (conclusão aprovada, edição)",
  !ids.includes("evento:c2:e3") && !ids.includes("evento:c3:e4"),
);
checa(
  "movida diz para onde",
  textoDoEvento(eventos.get("c1")[0]) === "moveu a demanda para Em andamento",
);

const velho = new Map([
  ["c1", [ev("v1", ANA, 0, "movida", [{ campo: "coluna", de: "A", para: "B" }])]],
]);
checa(
  "movimentação com mais de sete dias some",
  novidades({ email: EU, cards, eventos: velho, nomeDe, agora: JANELA_MS + 1 }).length === 0,
);
checa(
  "createdBy vale com caixa e espaço diferentes",
  novidades({
    email: EU,
    cards,
    eventos: new Map([["c2", [ev("t1", ANA, 9000, "transferida", [{ campo: "setor", de: "B.I.", para: "RH" }])]]]),
    nomeDe,
    agora: AGORA,
  }).length === 1,
);

// --- vistas: saem da lista principal para a sub-visão ----------------------
const duas = [
  { id: "a", em: 5000 }, { id: "b", em: 3000 }, { id: "c", em: 8000 },
].map((n) => ({ ...n, icone: "", titulo: "", detalhe: "", href: "" }));
const sep = separarVistas(duas, { ate: 4000, ids: ["c"] });
checa(
  "vista pelo marco ou pelo clique vai para a sub-visão",
  sep.novas.map((n) => n.id).join() === "a" && sep.vistas.map((n) => n.id).join() === "b,c",
);
checa(
  "ids que saíram da janela são podados",
  podarVistas({ ate: 0, ids: ["a", "zumbi"] }, duas).ids.join() === "a",
);

// --- pendências: a mesma conta da tela de Relatórios IA --------------------
const pend = pendencias(EU, reunioes, propostas);
const pIds = pend.map((p) => p.id);
checa("ata não validada vira pendência", pIds.includes("validar:r1"));
checa("validada mas com proposta aberta continua pendente", pIds.includes("validar:r2"));
checa("reunião ainda processando não é pendência", !pIds.includes("validar:r3"));
checa("reunião de outra pessoa não é pendência minha", !pIds.includes("validar:r4"));
checa(
  "pendência leva ao relatório",
  pend.find((p) => p.id === "validar:r1")?.href === "/relatorios?reuniao=r1",
);

// --- teto de leituras -------------------------------------------------------
const muitos = Array.from({ length: 40 }, (_, i) => ({
  id: `m${i}`, sector: "B.I.", title: "", assignee: EU, enteredAt: i,
}));
const alvo = cardsParaConsultar(muitos, EU);
checa(
  "consulta no máximo o teto, mais novos primeiro",
  alvo.length === LIMITE_CARDS_CONSULTADOS && alvo[0].id === "m39",
);

checa("quando: minutos", quando(0 + 5 * 60000, 10 * 60000) === "há 5 min");
checa("quando: sem data é vazio", quando(0, 1000) === "");

console.log(
  falhas === 0 ? "\nnotificações: ok" : `\nnotificações: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
