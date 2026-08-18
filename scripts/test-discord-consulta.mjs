/**
 * Testes dos comandos de consulta.
 *
 * O jeito de errar aqui é diferente do resto do Discord: a pessoa PERGUNTOU. Ela
 * vai agir com base no que leu, e uma lista cortada sem aviso — ou ordenada por
 * qualquer coisa que não seja urgência — faz alguém deixar passar o prazo
 * achando que viu tudo. É pior do que não responder.
 *
 * Três moedas:
 *
 *  - A ORDEM. Atrasada primeiro, sem prazo por último. A ordem que sai de graça
 *    da consulta é a de criação, e ela põe a demanda de março na frente da que
 *    vence amanhã.
 *
 *  - O CORTE. Cortar na borda dos 2000 caracteres apagaria justamente a linha
 *    que diz quantas ficaram de fora.
 *
 *  - A BUSCA SEM ACENTO. Quem digita no celular não acentua; "relatorio" tem de
 *    achar "Relatório", senão a busca parece quebrada.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  LIMITE_RESPOSTA,
  TETO_LISTA,
  combina,
  montarBusca,
  montarMinhasDemandas,
  normalizar,
  ordenarPorUrgencia,
} from "../src/lib/discord-consulta-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

const HOJE = "2026-08-18";
const APP = "https://app.exemplo.com";
const d = (id, title, extra = {}) => ({
  id,
  sector: "B.I.",
  title,
  etapa: "Em andamento",
  entregue: false,
  ...extra,
});

// --- normalizar e combinar -------------------------------------------------
checa("acento sai da comparação", normalizar("Relatório") === "relatorio");
checa("caixa também", normalizar("  PAINEL  ") === "painel");
checa(
  "buscar sem acento acha com acento",
  combina("Relatório do RH", "relatorio"),
);
checa(
  "as palavras podem vir em qualquer ordem",
  combina("Painel de consumo do refeitório", "refeitorio painel"),
);
checa(
  "palavra que não está no título não casa",
  !combina("Painel de consumo", "refeitório"),
);
checa(
  "termo vazio casa com NADA — devolver o quadro inteiro faria alguém achar que digitou certo",
  !combina("Painel de consumo", "   "),
);

// --- a ordem de leitura ----------------------------------------------------
const MISTURA = [
  d("sem", "Sem prazo"),
  d("futura", "Vence em setembro", { prazo: "2026-09-30" }),
  d("atrasada", "Venceu em julho", { prazo: "2026-07-01" }),
  d("hoje", "Vence hoje", { prazo: HOJE }),
  d("bem-atrasada", "Venceu em março", { prazo: "2026-03-10" }),
];
checa(
  "atrasada primeiro, da mais antiga; sem prazo por último",
  ordenarPorUrgencia(MISTURA, HOJE)
    .map((c) => c.id)
    .join(",") === "bem-atrasada,atrasada,hoje,futura,sem",
  ordenarPorUrgencia(MISTURA, HOJE).map((c) => c.id).join(","),
);
checa(
  "o que vence hoje NÃO conta como atraso",
  ordenarPorUrgencia(MISTURA, HOJE)[2].id === "hoje",
);
checa(
  "ordenar não mexe na lista de quem chamou",
  MISTURA[0].id === "sem",
);

// --- /minhas-demandas ------------------------------------------------------
const minhas = montarMinhasDemandas({ cards: MISTURA, hoje: HOJE, appUrl: APP });
checa("o cabeçalho conta quantas são", minhas.includes("**Suas demandas em aberto — 5**"));
checa("e quantas estão atrasadas", minhas.includes("2 atrasadas"));
checa(
  "o atraso vem por extenso, não como cor — no Discord a linha é texto puro",
  minhas.includes("**atrasada desde 10/03**"),
  minhas.split("\n")[1],
);
checa("cada linha leva ao card", minhas.includes(`(${APP}/kanban?setor=B.I.&card=bem-atrasada)`));
checa("o que ainda não venceu não é chamado de atrasado", minhas.includes("prazo 30/09"));

checa(
  "demanda entregue não entra na lista de abertas",
  !montarMinhasDemandas({
    cards: [d("pronta", "Já entregue", { entregue: true, etapa: "Concluído" })],
    hoje: HOJE,
  }).includes("Já entregue"),
);
checa(
  "quadro limpo é resposta de verdade, não erro",
  montarMinhasDemandas({ cards: [], hoje: HOJE }).includes(
    "não tem nenhuma demanda em aberto",
  ),
);
checa(
  "e demanda só entregue conta como quadro limpo",
  montarMinhasDemandas({
    cards: [d("pronta", "Já entregue", { entregue: true })],
    hoje: HOJE,
  }).includes("não tem nenhuma demanda em aberto"),
);

// --- o corte, que é onde dói ----------------------------------------------
const TRINTA = Array.from({ length: 30 }, (_, i) =>
  d(`c${i}`, `Demanda número ${i} com um título comprido o bastante para gastar espaço de verdade`, {
    prazo: "2026-07-01",
  }),
);
const cortada = montarMinhasDemandas({ cards: TRINTA, hoje: HOJE, appUrl: APP });
checa("a resposta cabe no teto do Discord", cortada.length <= LIMITE_RESPOSTA, `${cortada.length}`);
const anuncio = /…e mais (\d+) —/.exec(cortada);
const listadas = cortada.split("\n").filter((l) => l.startsWith("• ")).length;
checa(
  "o corte é anunciado, e a conta fecha: 30 = listadas + anunciadas",
  !!anuncio && listadas + Number(anuncio[1]) === 30,
  `${listadas} listadas + ${anuncio?.[1]} anunciadas`,
);
checa(
  "nunca passa do teto de linhas, mesmo cabendo",
  listadas <= TETO_LISTA,
  `${listadas}`,
);

// --- /demanda --------------------------------------------------------------
const QUADRO = [
  d("a", "Painel de consumo do refeitório", { prazo: "2026-07-01", responsavel: "Kauã" }),
  d("b", "Relatório do RH", { prazo: "2026-09-01", responsavel: "Ítalo" }),
  d("c", "Painel antigo do RH", { entregue: true, etapa: "Concluído", responsavel: "Ítalo" }),
];
const busca = montarBusca({ termo: "painel", cards: QUADRO, hoje: HOJE, appUrl: APP });
checa("acha as duas com 'painel'", busca.includes("**2 demandas"));
checa(
  "a busca inclui as ENTREGUES — 'aquilo ficou pronto?' é metade das perguntas",
  busca.includes("Painel antigo do RH"),
);
checa("e a entregue vem marcada", /Painel antigo do RH.*✓/.test(busca));
checa("o responsável aparece", busca.includes("Kauã"));
checa(
  "sem resultado, a resposta ensina a tentar de novo",
  montarBusca({ termo: "coisa que não existe", cards: QUADRO, hoje: HOJE }).includes(
    "acento",
  ),
);
checa(
  "busca vazia pede o que procurar em vez de despejar o quadro",
  montarBusca({ termo: "  ", cards: QUADRO, hoje: HOJE }).includes("Diga o que procurar"),
);
checa(
  "singular quando é uma só",
  montarBusca({ termo: "relatório", cards: QUADRO, hoje: HOJE }).includes("**1 demanda com"),
);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ consultas no discord: ok");
process.exit(falhas ? 1 : 0);
