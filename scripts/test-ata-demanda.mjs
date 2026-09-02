/**
 * Testes da demanda que nasce na ata (`lib/ata-demanda-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que olhar a tela não protege:
 *
 * 1. A OBRIGATORIEDADE DA DIMENSÃO. Ela é uma régua de negócio, não de
 *    formulário — vem do "Mapa de Domínios e Estrutura" das Cantinas, que diz
 *    que meta, procedimento, manual e decisão vivem todos em "Domínio × alguma
 *    coisa". Um botão que passa a aceitar dimensão vazia desenha exatamente
 *    igual a um que recusa, e o defeito só aparece meses depois, na árvore de
 *    Dimensões, como um monte de demanda em "Sem classificação".
 *
 * 2. O VÍNCULO DO CARD COM O ITEM FANTASMA. `montarPauta` inventa um item que
 *    não está gravado, com `id` igual ao `cardId`. Promover essa linha tem de
 *    CRIAR o item; devolver o array intocado deixaria o pior estado possível —
 *    card no quadro e ata ainda chamando aquilo de assunto — e o teste é a
 *    única coisa que reprova isso sem uma reunião de verdade acontecer.
 *
 * 3. QUE A CONTAGEM DE "FORA DO MAPA" OLHE AS DUAS ORIGENS. Onde há card, quem
 *    responde pela dimensão é o card; onde não há, o item. Uma contagem que
 *    olhasse só uma delas diria "0 linhas sem dimensão" com metade da pauta
 *    fora do mapa.
 */
import {
  classificacaoDaLinha,
  conferirAssuntoNovo,
  conferirClassificacao,
  conferirTitulo,
  semClassificacao,
  vincularCard,
  LIMITE_ASSUNTO_CHARS,
} from "../src/lib/ata-demanda-core.ts";
import { montarPauta } from "../src/lib/ata-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const DIMS = [
  {
    id: "d1",
    nome: "D1 · Cadeia de Suprimentos",
    ordem: 1,
    subs: [
      { id: "s1", nome: "Estoque" },
      { id: "s2", nome: "Compras" },
    ],
  },
  { id: "d2", nome: "D2 · Operação e Gente", ordem: 2, subs: [] },
];

const item = (id, extra = {}) => ({
  id,
  cardId: "",
  assunto: `assunto ${id}`,
  contexto: "",
  dimensaoId: "",
  subdimensaoId: "",
  decisao: "",
  objetivo: "",
  proximaReuniao: false,
  tarefas: [],
  ...extra,
});

console.log("\n— a dimensão é obrigatória —");

checa(
  "sem dimensão, recusa",
  conferirClassificacao({ dimensaoId: "", subdimensaoId: "" }, DIMS).ok === false,
);

checa(
  "a recusa DIZ o que fazer",
  /Escolha a dimensão/.test(
    conferirClassificacao({ dimensaoId: "" }, DIMS).motivo,
  ),
);

// A frase muda quando o setor não tem árvore: "escolha a dimensão" mandaria a
// pessoa procurar um campo que não tem uma única opção dentro.
checa(
  "setor sem árvore manda cadastrar, não escolher",
  /Dimensões/.test(conferirClassificacao({ dimensaoId: "" }, []).motivo),
);

checa(
  "dimensão que existe passa",
  conferirClassificacao({ dimensaoId: "d1", subdimensaoId: "" }, DIMS).ok === true,
);

// Este é o caso que aparece sozinho com o tempo: a dimensão escolhida ontem foi
// apagada do cadastro hoje, e um id órfão desenha igual a nenhum id.
checa(
  "dimensão apagada do cadastro é recusada",
  conferirClassificacao({ dimensaoId: "fantasma" }, DIMS).ok === false,
);

console.log("\n— a subdimensão continua opcional, mas tem de ser da dimensão —");

checa(
  "sem subdimensão passa (a demanda mora direto na dimensão)",
  conferirClassificacao({ dimensaoId: "d1", subdimensaoId: "" }, DIMS).ok === true,
);

checa(
  "dimensão sem filho nenhum passa",
  conferirClassificacao({ dimensaoId: "d2", subdimensaoId: "" }, DIMS).ok === true,
);

checa(
  "subdimensão de OUTRA dimensão é recusada",
  conferirClassificacao({ dimensaoId: "d2", subdimensaoId: "s1" }, DIMS).ok === false,
);

checa(
  "subdimensão certa passa",
  conferirClassificacao({ dimensaoId: "d1", subdimensaoId: "s2" }, DIMS).ok === true,
);

console.log("\n— o título da linha —");

checa("título vazio recusa", conferirTitulo("  ", "o assunto").ok === false);
checa(
  "título é aparado e cabe no teto",
  conferirTitulo(`  ${"a".repeat(400)}  `, "o assunto").valor.length ===
    LIMITE_ASSUNTO_CHARS,
);

console.log("\n— o assunto novo —");

const semDim = conferirAssuntoNovo(
  { assunto: "Padrão de recebimento", dimensaoId: "" },
  [],
  DIMS,
);
checa("assunto sem dimensão não nasce", semDim.ok === false);

const nasceu = conferirAssuntoNovo(
  {
    assunto: "  Padrão de recebimento  ",
    contexto: "veio do bloco 3",
    dimensaoId: "d1",
    subdimensaoId: "s1",
  },
  [item("1"), item("2")],
  DIMS,
);
checa("assunto com dimensão nasce", nasceu.ok === true);
checa("id novo não colide com os que já existem", nasceu.valor.id === "3");
checa("nasce SEM card — a fronteira de demandas", nasceu.valor.cardId === "");
checa("o texto chega aparado", nasceu.valor.assunto === "Padrão de recebimento");
checa("a classificação chega junto", nasceu.valor.dimensaoId === "d1");
checa("nasce sem decisão e sem tarefa", !nasceu.valor.decisao && nasceu.valor.tarefas.length === 0);

console.log("\n— o vínculo com o card recém-criado —");

const gravados = [item("1"), item("2", { assunto: "outro" })];
const ligado = vincularCard(gravados, "2", "cardABC");
checa("o item gravado recebe o cardId", ligado.find((i) => i.id === "2").cardId === "cardABC");
checa("o outro item não é tocado", ligado.find((i) => i.id === "1").cardId === "");
checa("nada é acrescentado", ligado.length === 2);
checa(
  "o array de entrada não é mutado",
  gravados.find((i) => i.id === "2").cardId === "",
);

// O CASO QUE DERRUBA TUDO: promover a linha que nunca foi tocada. O item
// fantasma não está no array, e o `id` dele é o `cardId` — devolver o array
// intocado deixaria o card no quadro e a ata ainda chamando aquilo de assunto.
const fantasma = item("cardVelho", { cardId: "cardVelho", assunto: "" });
const comFantasma = vincularCard(gravados, "cardVelho", "cardNovo", fantasma);
checa("o item fantasma vira item de verdade", comFantasma.length === 3);
checa(
  "e ele aponta para o card novo",
  comFantasma[2].cardId === "cardNovo",
);
checa(
  "com id próprio, e nunca o cardId de origem",
  comFantasma[2].id === "3",
  `veio "${comFantasma[2].id}"`,
);

console.log("\n— quantas linhas estão fora do mapa —");

const CARDS = [
  { id: "c1", sector: "Cantinas", columnId: "backlog", title: "com dimensão", dimensaoId: "d1" },
  { id: "c2", sector: "Cantinas", columnId: "backlog", title: "sem dimensão" },
];
const ATA = {
  itens: [
    item("1", { cardId: "c1" }),
    item("9", { assunto: "assunto classificado", dimensaoId: "d2" }),
    item("10", { assunto: "assunto solto" }),
  ],
};
const pauta = montarPauta({
  cards: CARDS,
  ata: ATA,
  dimensoes: DIMS,
  entregues: { Cantinas: new Set() },
  hoje: new Date(2026, 7, 26).getTime(),
});

const fora = semClassificacao(pauta);
checa("a pauta inteira foi montada", pauta.length === 4, `veio ${pauta.length}`);
checa(
  "duas linhas estão fora do mapa: o card sem dimensão e o assunto solto",
  fora.length === 2,
  `veio ${fora.length}`,
);
checa(
  "o card sem dimensão está entre elas",
  fora.some((l) => l.card?.id === "c2"),
);
checa(
  "o assunto solto está entre elas",
  fora.some((l) => !l.card && l.item.id === "10"),
);
checa(
  "o card COM dimensão não entra",
  !fora.some((l) => l.card?.id === "c1"),
);

// Onde há card, quem responde é o card — dimensão é estado, e estado vem do
// quadro. Um item da ata com dimensão própria NÃO pode encobrir um card sem.
const linhaDoC1 = pauta.find((l) => l.card?.id === "c1");
checa(
  "a classificação da linha com card vem do CARD",
  classificacaoDaLinha(linhaDoC1).dimensaoId === "d1",
);
const linhaSolta = pauta.find((l) => !l.card && l.item.id === "9");
checa(
  "a classificação da linha sem card vem do ITEM",
  classificacaoDaLinha(linhaSolta).dimensaoId === "d2",
);

console.log(
  falhas === 0
    ? "\n✅ demanda que nasce na ata: ok"
    : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
