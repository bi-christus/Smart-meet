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
  cardsParaConsultar,
  naoVistas,
  novidades,
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

// --- novidades: só o que é meu, e só o que os outros fizeram ----------------
const lista = novidades({ email: EU, cards, eventos, reunioes, propostas, nomeDe });
const ids = lista.map((n) => n.id);

checa("card de outra pessoa não entra", !ids.some((i) => i.includes(":c3:")), ids.join(", "));
checa("o que eu mesmo fiz não entra", !ids.includes("evento:c1:e2"));
checa("createdBy vale com caixa e espaço diferentes", ids.includes("evento:c2:e3"));
checa("proposta da minha reunião aceita por outro entra", ids.includes("proposta:p2"));
checa("proposta que eu mesmo decidi não entra", !ids.includes("proposta:p3"));
checa("proposta de reunião alheia não entra", !ids.includes("proposta:p4"));
checa("mais recente primeiro", lista[0]?.id === "proposta:p2", ids.join(", "));
checa(
  "aceita leva ao card que nasceu",
  lista[0]?.href === "/kanban?setor=B.I.&card=c9",
  lista[0]?.href,
);
checa(
  "movida diz para onde",
  textoDoEvento(eventos.get("c1")[0]) === "moveu a demanda para Em andamento",
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

checa("não vistas conta só depois do marco", naoVistas(lista, 5000) === 1);
checa("quando: minutos", quando(0 + 5 * 60000, 10 * 60000) === "há 5 min");
checa("quando: sem data é vazio", quando(0, 1000) === "");

console.log(
  falhas === 0 ? "\nnotificações: ok" : `\nnotificações: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
