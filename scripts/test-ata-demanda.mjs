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
 *
 * 4. QUE CORRIGIR O ASSUNTO NÃO APAGUE A REUNIÃO. `editarAssunto` mescla no
 *    item que JÁ existe. Uma versão que montasse item novo desenharia
 *    exatamente igual na tela — mesmo nome, mesma caixa — e zeraria a decisão,
 *    o objetivo e as tarefas daquela linha. O prejuízo só apareceria depois,
 *    com a ata já gravada e a reunião acabada.
 *
 * 5. A COLISÃO DE ID AO MUDAR DE REUNIÃO. Os ids são sequenciais POR ATA, então
 *    o item "3" que chega de outra ata encontra um "3" já morando lá. O
 *    resultado desenha perfeitamente — duas linhas, os dois nomes certos — e só
 *    quebra quando alguém escreve numa delas e o texto aparece na outra. Por
 *    isso a ata de destino do teste JÁ TEM um item com o id que vem chegando.
 */
import {
  classificacaoDaLinha,
  conferirAssuntoNovo,
  levarAssunto,
  conferirClassificacao,
  conferirTitulo,
  editarAssunto,
  moverAssunto,
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
  origem: "manual",
  origemAtaId: "",
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
// O único caminho do app que produz item `manual`. É o que a mesclagem com o
// documento do áudio lê para saber que aquele texto tem autor humano.
checa(
  "nasce marcado como lançado à mão",
  nasceu.valor.origem === "manual" && nasceu.valor.origemAtaId === "",
  nasceu.valor.origem,
);

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

// A linha cuja demanda saiu do quadro é REGISTRO, não trabalho: não há card
// para classificar, e contá-la encheria o alerta de linhas históricas que
// ninguém consegue resolver. Alerta que não zera é alerta que se ignora.
const pautaComOrfa = montarPauta({
  cards: [],
  ata: {
    itens: [item("7", { cardId: "sumido", assunto: "demanda que saiu", dimensaoId: "" })],
  },
  dimensoes: DIMS,
  entregues: { Cantinas: new Set() },
  hoje: new Date(2026, 7, 26).getTime(),
});
checa(
  "a linha fora do quadro existe na pauta",
  pautaComOrfa.length === 1 && pautaComOrfa[0].foraDoQuadro === true,
);
checa(
  "mas ela NÃO é cobrada por falta de dimensão",
  semClassificacao(pautaComOrfa).length === 0,
);

/**
 * O APÊNDICE DO DOCUMENTO TAMBÉM NÃO, e pela mesma razão.
 *
 * "Em aberto" e "Outros pontos" são seção do documento do Cowork, não assunto da
 * reunião (ver `ehPendenciaDaReuniao` em `ata-core`). Não há o que classificar
 * num apêndice, e cobrá-lo deixaria o alerta de "fora do mapa" travado em duas
 * linhas por ata — impossível de zerar, e por isso rápido de aprender a ignorar.
 */
const pautaComPendencia = montarPauta({
  cards: [],
  ata: {
    itens: [
      item("1", { assunto: "Em aberto", contexto: "POPs sem responsável técnico" }),
      item("2", { assunto: "Reforma Dom Luís" }),
    ],
  },
  dimensoes: DIMS,
  entregues: { Cantinas: new Set() },
  hoje: new Date(2026, 7, 26).getTime(),
});
checa(
  "o apêndice é a seção de pendências; o assunto de verdade é registro da reunião",
  pautaComPendencia.find((l) => l.item.id === "1").secao === "pendencia" &&
    pautaComPendencia.find((l) => l.item.id === "2").secao === "registrada",
  pautaComPendencia.map((l) => `${l.item.id}:${l.secao}`).join(","),
);
checa(
  "e só o assunto de verdade é cobrado por falta de dimensão",
  semClassificacao(pautaComPendencia).map((l) => l.item.id).join(",") === "2",
  semClassificacao(pautaComPendencia).map((l) => l.item.id).join(","),
);
// A pendência vai para o FIM e sai da numeração: "vamos ao dois" tem de nomear
// um assunto, e "Em aberto" não nomeia nada.
checa(
  "a pendência fica no fim e não é numerada",
  pautaComPendencia[1].item.id === "1" &&
    pautaComPendencia[1].numero === "" &&
    pautaComPendencia[0].numero === "01",
  pautaComPendencia.map((l) => `${l.item.id}:${l.numero}`).join(","),
);


console.log("\n— corrigir o assunto depois de criado —");

const antes = [
  item("1", {
    assunto: "Padrao de recebimente",
    contexto: "veio do bloco 3",
    dimensaoId: "d1",
    subdimensaoId: "s1",
    decisao: "combinado com Suprimentos",
    objetivo: "medir na proxima",
    proximaReuniao: true,
    tarefas: [{ id: "1", texto: "aplicar o formulario", responsavel: "a@b.c", prazo: "", status: "pendente", observacao: "" }],
  }),
  item("2", { assunto: "outro assunto" }),
];

const corrigido = editarAssunto(
  antes,
  "1",
  {
    assunto: "  Padrão de recebimento  ",
    contexto: "  veio do bloco 3, revisado  ",
    dimensaoId: "d1",
    subdimensaoId: "s2",
  },
  DIMS,
);
checa("o assunto corrigido passa", corrigido.ok === true, corrigido.motivo);
const alvo = corrigido.ok && corrigido.valor.find((i) => i.id === "1");
checa("o texto novo chega aparado", alvo.assunto === "Padrão de recebimento");
checa("o contexto novo também", alvo.contexto === "veio do bloco 3, revisado");
checa("a subdimensão troca", alvo.subdimensaoId === "s2");

// O CORAÇÃO DESTA FRENTE: corrigir o nome não é motivo para a reunião perder o
// que decidiu. Um `editarAssunto` que montasse item novo em vez de mesclar
// desenharia igual na tela e zeraria a tabela de tarefas de todo mundo.
checa("a decisão registrada continua lá", alvo.decisao === "combinado com Suprimentos");
checa("o objetivo continua lá", alvo.objetivo === "medir na proxima");
checa("a marca de próxima reunião continua lá", alvo.proximaReuniao === true);
checa("as tarefas continuam lá", alvo.tarefas.length === 1 && alvo.tarefas[0].texto === "aplicar o formulario");
checa("o outro item não é tocado", corrigido.valor.find((i) => i.id === "2").assunto === "outro assunto");
checa("nada é acrescentado nem removido", corrigido.valor.length === 2);
checa("o array de entrada não é mutado", antes[0].assunto === "Padrao de recebimente");

// As mesmas duas réguas da criação, chamadas daqui e não copiadas.
checa(
  "assunto apagado é recusado",
  editarAssunto(antes, "1", { assunto: "   ", dimensaoId: "d1" }, DIMS).ok === false,
);
checa(
  "dimensão apagada é recusada",
  editarAssunto(antes, "1", { assunto: "vale", dimensaoId: "" }, DIMS).ok === false,
);
checa(
  "subdimensão de OUTRA dimensão é recusada aqui também",
  editarAssunto(antes, "1", { assunto: "vale", dimensaoId: "d2", subdimensaoId: "s1" }, DIMS)
    .ok === false,
);

// Entre abrir o modal e salvar, o item pode ter sumido do array — a ata é
// editada por várias pessoas na mesma reunião. Sem esta recusa, o `map` não
// acharia nada, a escrita passaria "com sucesso" e a correção sumiria calada.
const sumiu = editarAssunto(antes, "99", { assunto: "vale", dimensaoId: "d1" }, DIMS);
checa("item que não existe mais é recusado", sumiu.ok === false);
checa("e a recusa DIZ o que aconteceu", /não está mais na pauta/.test(sumiu.motivo));

// Onde há card, quem responde pelo nome é o quadro. Gravar aqui daria a
// impressão de ter renomeado a demanda, escrevendo em dois campos que a tela
// não lê mais.
const comCard = editarAssunto(
  [item("3", { cardId: "c9", assunto: "virou demanda" })],
  "3",
  { assunto: "outro nome", dimensaoId: "d1" },
  DIMS,
);
checa("linha que já tem card é recusada", comCard.ok === false);
checa("e a recusa manda para o Kanban", /Kanban/.test(comCard.motivo));

console.log("\n— o assunto muda de reunião —");

const ORIGEM = {
  id: "ata-26-08",
  setor: "Cantinas",
  itens: [
    item("1", { assunto: "fica onde está" }),
    item("2", {
      assunto: "foi para a reunião errada",
      contexto: "o contexto veio junto",
      dimensaoId: "d1",
      subdimensaoId: "s1",
      decisao: "combinado com Suprimentos",
      objetivo: "medir na próxima",
      proximaReuniao: true,
      tarefas: [
        { id: "1", texto: "aplicar o formulário", responsavel: "a@b.c", prazo: "2026-09-10", status: "pendente", observacao: "" },
        { id: "2", texto: "agendar com o time", responsavel: "", prazo: "", status: "concluida", observacao: "" },
      ],
    }),
  ],
};
// O DESTINO JÁ TEM UM ITEM "2". É o caso que derruba tudo se o id não for
// renumerado: duas linhas com a mesma chave, e a escrita de uma caindo na
// outra. Ele vem primeiro de propósito.
const DESTINO = {
  id: "ata-02-09",
  setor: "Cantinas",
  itens: [item("1", { assunto: "ja morava aqui" }), item("2", { assunto: "e este tambem" })],
};

const movido = moverAssunto(ORIGEM, DESTINO, "2");
checa("mover passa", movido.ok === true, movido.motivo);
checa("o assunto sai da origem", movido.valor.origem.length === 1);
checa("e quem ficou é o outro", movido.valor.origem[0].id === "1");
checa("o assunto entra no destino", movido.valor.destino.length === 3);

// A ORIGEM VAI INTEIRA, e essa é a que dá vontade de trocar. "Mover" corrige um
// erro de endereço: o assunto sempre foi desta reunião e foi digitado na porta
// ao lado. Marcá-lo `herdado` faria a ata de destino afirmar que ele veio de
// outra reunião — e quem quer passar bastão usa "Levar para próxima reunião".
const doAudioMovido = moverAssunto(
  {
    ...ORIGEM,
    itens: [item("2", { origem: "reuniao" })],
  },
  DESTINO,
  "2",
);
checa(
  "a origem do item movido é PRESERVADA",
  doAudioMovido.ok && doAudioMovido.valor.destino[2].origem === "reuniao",
  doAudioMovido.ok ? doAudioMovido.valor.destino[2].origem : doAudioMovido.motivo,
);

const chegou = movido.ok && movido.valor.destino[2];
checa(
  "com id NOVO, que não colide com o que já morava lá",
  chegou.id === "3",
  `veio "${chegou.id}"`,
);
checa(
  "e os ids do destino continuam únicos",
  new Set(movido.valor.destino.map((i) => i.id)).size === 3,
);

// O item não mudou de natureza, mudou de pasta. Uma versão que remontasse o
// item desenharia igual na tela do destino e chegaria lá sem a tabela de
// tarefas — e o prejuízo só apareceria na reunião seguinte.
checa("o assunto chega inteiro", chegou.assunto === "foi para a reunião errada");
checa("o contexto vem junto", chegou.contexto === "o contexto veio junto");
checa("a classificação vem junto", chegou.dimensaoId === "d1" && chegou.subdimensaoId === "s1");
checa("a decisão vem junto", chegou.decisao === "combinado com Suprimentos");
checa("o objetivo vem junto", chegou.objetivo === "medir na próxima");
checa("a marca de próxima reunião vem junto", chegou.proximaReuniao === true);
checa("as DUAS tarefas vêm juntas", chegou.tarefas.length === 2);
checa(
  "com responsável, prazo e status intactos",
  chegou.tarefas[0].responsavel === "a@b.c" &&
    chegou.tarefas[0].prazo === "2026-09-10" &&
    chegou.tarefas[1].status === "concluida",
);
checa("nada é acrescentado nem removido na conta geral", movido.valor.origem.length + movido.valor.destino.length === 4);
checa(
  "os arrays de entrada não são mutados",
  ORIGEM.itens.length === 2 && DESTINO.itens.length === 2,
);

console.log("\n— e o que ele recusa —");

checa(
  "mover para a MESMA ata é recusado",
  moverAssunto(ORIGEM, ORIGEM, "2").ok === false,
);
checa(
  "e a recusa diz o que fazer",
  /reunião diferente/.test(moverAssunto(ORIGEM, ORIGEM, "2").motivo),
);

// A árvore de dimensões é por setor: o `dimensaoId` do item não aponta para a
// mesma caixa do outro lado, e a linha chegaria classificada em algo que não
// existe lá.
const outroSetor = moverAssunto(ORIGEM, { ...DESTINO, setor: "B.I." }, "2");
checa("mover para ata de OUTRO setor é recusado", outroSetor.ok === false);
checa("e a recusa explica a dimensão", /dimensão/.test(outroSetor.motivo));

checa(
  "item que não existe mais é recusado",
  moverAssunto(ORIGEM, DESTINO, "99").ok === false,
);

// A demanda do quadro aparece na pauta de TODA reunião do setor, vinda do
// Kanban. Mover o item não a moveria — levaria para outro dia a decisão tomada
// neste, e uma ata que empresta a decisão de outra deixou de ser registro.
const comCardMovendo = moverAssunto(
  { ...ORIGEM, itens: [item("5", { cardId: "c9", assunto: "virou demanda" })] },
  DESTINO,
  "5",
);
checa("linha que tem card é recusada", comCardMovendo.ok === false);
checa("e a recusa explica que ela já está em toda pauta", /toda reunião/.test(comCardMovendo.motivo));


console.log("\n— levar o assunto para uma reunião que já existe —");

/**
 * O CENÁRIO É O REAL, e é o defeito que este bloco protege: o setor Cantinas
 * tinha ata de 26/08, 02/09 e 09/09. Durante a reunião de 02/09 quem conduzia
 * abriu a de 26/08, discutiu os assuntos passados e clicou em "Levar para
 * próxima reunião" em vários deles. Os flags ficaram acesos sem ter para onde ir
 * — colhê-los exigiria criar uma quarta ata, duplicando a de 09/09. Sem erro na
 * tela e sem aviso: o botão acendia, e pronto.
 *
 * LEVAR NÃO É MOVER, e a diferença é o que os `checa` abaixo cobram linha por
 * linha: a origem MANTÉM o item, a decisão FICA nela, e a linha com card é
 * aceita (mover a recusa).
 */
const L_ORIGEM = {
  id: "ata-26-08",
  setor: "Cantinas",
  data: "2026-08-26",
  itens: [
    item("1", { assunto: "fica sozinho" }),
    item("2", {
      assunto: "Sistema Connect e totens",
      contexto: "totem custa cerca de R$ 5.800",
      dimensaoId: "d1",
      subdimensaoId: "s1",
      origem: "reuniao",
      decisao: "separar sistema de totem",
      objetivo: "trazer a proposta revisada",
      tarefas: [
        { id: "1", texto: "pedir nova proposta", responsavel: "a@b.c", prazo: "2026-09-01", status: "pendente", observacao: "" },
        { id: "2", texto: "conferir o contrato antigo", responsavel: "", prazo: "", status: "concluida", observacao: "" },
      ],
    }),
  ],
};
// O destino já tem um item "2": é o caso que derruba tudo se o id não for
// renumerado — duas linhas com a mesma chave, e a escrita de uma caindo na outra.
const L_DESTINO = {
  id: "ata-09-09",
  setor: "Cantinas",
  data: "2026-09-09",
  itens: [item("1", { assunto: "ja morava aqui" }), item("2", { assunto: "e este tambem" })],
};

const lv_levado = levarAssunto(L_ORIGEM, L_DESTINO, L_ORIGEM.itens[1]);
checa("levar passa", lv_levado.ok === true, lv_levado.motivo);

// A DIFERENÇA COM "MOVER", cobrada campo por campo.
checa(
  "a ORIGEM mantém o item — levar não é mover",
  lv_levado.valor.origem.length === 2 &&
    lv_levado.valor.origem.some((i) => i.assunto === "Sistema Connect e totens"),
);
/**
 * O REGISTRO MUDOU DE CAMPO, e é a correção do vazamento.
 *
 * Esta checagem cobrava `proximaReuniao === true` depois de levar. A marca ficava
 * acesa como registro da decisão — só que ela não é só registro: é o que
 * `herdarParaProxima` COLHE quando alguém clica em "Abrir a próxima reunião".
 * Levar e depois abrir punha o mesmo assunto em duas reuniões futuras, sem erro
 * e sem aviso. Em produção, a ata de 26/08/2026 das Cantinas tinha seis itens
 * nesse estado, todos já gravados na ata de 16/09.
 *
 * `levadaParaAtaId` responde a mesma pergunta e mais uma que a marca nunca
 * respondeu: PARA ONDE. É o que a tela desenha como "levado para 09/09".
 */
checa(
  "a marca é CONSUMIDA — senão 'Abrir a próxima' colhe o mesmo assunto de novo",
  lv_levado.valor.origem.find((i) => i.id === "2").proximaReuniao === false,
);
checa(
  "e o registro passa a dizer para ONDE o assunto foi",
  lv_levado.valor.origem.find((i) => i.id === "2").levadaParaAtaId === "ata-09-09",
  lv_levado.valor.origem.find((i) => i.id === "2").levadaParaAtaId,
);
checa(
  "a cópia que chega NÃO nasce se dizendo levada",
  lv_levado.valor.destino[2].levadaParaAtaId === "",
);
checa(
  "a decisão FICA na origem",
  lv_levado.valor.origem.find((i) => i.id === "2").decisao === "separar sistema de totem",
);

const lv_levadoChegou = lv_levado.valor.destino[2];
checa("a cópia entra no destino", lv_levado.valor.destino.length === 3);
checa(
  "com id NOVO, que não colide com o que já morava lá",
  lv_levadoChegou.id === "3",
  `veio "${lv_levadoChegou.id}"`,
);
checa(
  "e os ids do destino continuam únicos",
  new Set(lv_levado.valor.destino.map((i) => i.id)).size === 3,
);
// A decisão é DAQUELA reunião. Repeti-la faria a ata nova nascer afirmando que
// decidiu o que outra decidiu.
checa("a decisão NÃO vai junto", lv_levadoChegou.decisao === "");
checa(
  "o objetivo vai — ele já foi escrito olhando para a frente",
  lv_levadoChegou.objetivo === "trazer a proposta revisada",
);
checa(
  "assunto, contexto e dimensão vão junto",
  lv_levadoChegou.assunto === "Sistema Connect e totens" &&
    lv_levadoChegou.contexto === "totem custa cerca de R$ 5.800" &&
    lv_levadoChegou.dimensaoId === "d1",
);
checa(
  "só a tarefa aberta vai; a concluída fica para trás",
  lv_levadoChegou.tarefas.length === 1 && lv_levadoChegou.tarefas[0].texto === "pedir nova proposta",
);
checa(
  "e a tarefa que vai leva o responsável e o prazo que já tinha",
  lv_levadoChegou.tarefas[0].responsavel === "a@b.c" && lv_levadoChegou.tarefas[0].prazo === "2026-09-01",
);
checa("a marca de 'próxima' não se propaga para a cópia", lv_levadoChegou.proximaReuniao === false);
// A origem NÃO é preservada, e é o único campo de que isso é verdade: o item
// nasceu de um bloco do áudio de 26/08, e na reunião de 09/09 o que ele é é
// herança — áudio nenhum daquela reunião o trouxe.
checa(
  "a cópia sabe que é herdada, e de qual reunião",
  lv_levadoChegou.origem === "herdado" && lv_levadoChegou.origemAtaId === "ata-26-08",
  `${lv_levadoChegou.origem}/${lv_levadoChegou.origemAtaId}`,
);

// LINHA COM CARD É ACEITA — e é o caso mais comum do botão: "esta demanda
// continua na pauta da semana que vem". `moverAssunto` recusa card porque mover
// não moveria a demanda; levar não pretende mover nada, e como `montarPauta`
// indexa um item por card, a cópia vira A linha daquela demanda no destino.
const lv_comCard = levarAssunto(
  { ...L_ORIGEM, itens: [item("5", { cardId: "c9", objetivo: "medir o piloto" })] },
  L_DESTINO,
  item("5", { cardId: "c9", objetivo: "medir o piloto" }),
);
checa("a linha COM card é aceita", lv_comCard.ok === true, lv_comCard.motivo);
checa(
  "e a cópia dela leva o card, para não virar uma segunda linha da mesma demanda",
  lv_comCard.ok && lv_comCard.valor.destino[2].cardId === "c9",
);

// O FANTASMA: a linha que ninguém tocou não está gravada em `itens`, e o `id`
// dela é o `cardId`. Sem o segundo braço, a função devolveria os arrays
// intocados e o clique não faria nada — em silêncio, que é o defeito que ela vem
// consertar.
const lv_fantasma = levarAssunto(
  { ...L_ORIGEM, itens: [] },
  L_DESTINO,
  item("c9", { cardId: "c9", objetivo: "medir o piloto" }),
);
checa("o item fantasma é materializado na origem", lv_fantasma.valor.origem.length === 1);
checa(
  "com o destino registrado e id de item, nunca o cardId",
  lv_fantasma.valor.origem[0].levadaParaAtaId === "ata-09-09" &&
    lv_fantasma.valor.origem[0].proximaReuniao === false &&
    lv_fantasma.valor.origem[0].id === "1" &&
    lv_fantasma.valor.origem[0].cardId === "c9",
  lv_fantasma.valor.origem[0].id,
);

// ---- as quatro recusas, e as quatro são de negócio ----

checa(
  "a mesma ata é recusada",
  levarAssunto(L_ORIGEM, L_ORIGEM, L_ORIGEM.itens[1]).ok === false,
);
checa(
  "setor diferente é recusado — a dimensão só existe na árvore do setor dele",
  levarAssunto(L_ORIGEM, { ...L_DESTINO, setor: "B.I." }, L_ORIGEM.itens[1]).ok === false,
);
// Para trás no tempo não é levar, é reescrever uma reunião que já aconteceu — e é
// a única recusa que `moverAssunto` não tem, porque mover para trás é justamente
// o conserto que ele existe para fazer.
const lv_paraTras = levarAssunto(
  L_ORIGEM,
  { ...L_DESTINO, id: "ata-19-08", data: "2026-08-19" },
  L_ORIGEM.itens[1],
);
checa("reunião anterior é recusada", lv_paraTras.ok === false);
checa(
  'e a recusa aponta o "Mover", que é o botão para esse caso',
  /Mover/.test(lv_paraTras.motivo),
  lv_paraTras.motivo,
);
// Ata sem data ainda não foi marcada, e é destino legítimo.
checa(
  "destino sem data passa — a reunião ainda não foi marcada",
  levarAssunto(L_ORIGEM, { ...L_DESTINO, data: "" }, L_ORIGEM.itens[1]).ok === true,
);

// JÁ ESTÁ LÁ, pelos dois caminhos. Sem isto, dois cliques criam duas linhas
// iguais na pauta do destino — e o segundo clique é o gesto de quem não tem
// certeza se o primeiro funcionou.
const lv_jaPeloNome = levarAssunto(
  L_ORIGEM,
  {
    ...L_DESTINO,
    // Caixa e acento diferentes: a comparação é por `chaveDeAssunto`.
    itens: [item("1", { assunto: "SISTEMA CONNECT E TOTENS" })],
  },
  L_ORIGEM.itens[1],
);
checa("assunto que já está no destino é recusado, mesmo com outra caixa", lv_jaPeloNome.ok === false);
const lv_jaPeloCard = levarAssunto(
  { ...L_ORIGEM, itens: [item("5", { cardId: "c9" })] },
  { ...L_DESTINO, itens: [item("7", { cardId: "c9", assunto: "outro nome" })] },
  item("5", { cardId: "c9" }),
);
checa("demanda que já está no destino é recusada pelo card", lv_jaPeloCard.ok === false);
// Assunto vazio (a linha que entrou pelo quadro e nunca foi tocada) não pode
// casar com outro assunto vazio: sem a guarda do `!!chaveDoItem`, a primeira
// linha muda do destino barraria todas as demais.
checa(
  "assunto vazio não casa com assunto vazio",
  levarAssunto(
    { ...L_ORIGEM, itens: [item("5", { cardId: "c9", assunto: "" })] },
    { ...L_DESTINO, itens: [item("7", { cardId: "c8", assunto: "" })] },
    item("5", { cardId: "c9", assunto: "" }),
  ).ok === true,
);

console.log(
  falhas === 0
    ? "\n✅ demanda que nasce na ata: ok"
    : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
