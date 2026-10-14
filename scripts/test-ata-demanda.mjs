/**
 * Testes da demanda que nasce na ata (`lib/ata-demanda-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que olhar a tela não protege:
 *
 * 1. QUE A CLASSIFICAÇÃO SAIU SEM APAGAR NADA (#206). A dimensão era
 *    obrigatória aqui até 13/10/2026. Ela saiu do app, mas continua gravada
 *    nos itens antigos — e corrigir, mover ou levar um assunto não pode ser o
 *    gesto que a apaga, ou a branch `arquivo/dimensoes` volta sem os dados.
 *
 * 2. O VÍNCULO DO CARD COM O ITEM FANTASMA. `montarPauta` inventa um item que
 *    não está gravado, com `id` igual ao `cardId`. Promover essa linha tem de
 *    CRIAR o item; devolver o array intocado deixaria o pior estado possível —
 *    card no quadro e ata ainda chamando aquilo de assunto — e o teste é a
 *    única coisa que reprova isso sem uma reunião de verdade acontecer.
 *
 * 3. A PENDÊNCIA DO DOCUMENTO NÃO É ASSUNTO. "Em aberto" e "Outros pontos" vão
 *    para o fim da pauta e saem da numeração.
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
 *
 * 6. QUE DESFAZER O LEVAR SEJA O INVERSO EXATO DE LEVAR (#227). Desfazer apaga
 *    uma linha de OUTRA ata; casar a cópia errada apagaria o assunto que alguém
 *    lançou lá à mão com o mesmo nome, e nada na tela daqui mostraria o estrago.
 */
import {
  conferirAssuntoNovo,
  levarAssunto,
  conferirTitulo,
  editarAssunto,
  moverAssunto,
  vincularCard,
  ataDaLevada,
  desfazerLevada,
  haPerdas,
  itemDeOrigemDaCopia,
  LIMITE_ASSUNTO_CHARS,
} from "../src/lib/ata-demanda-core.ts";
import { herdarParaProxima, montarPauta } from "../src/lib/ata-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

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

console.log("\n— o título da linha —");

checa("título vazio recusa", conferirTitulo("  ", "o assunto").ok === false);
checa(
  "título é aparado e cabe no teto",
  conferirTitulo(`  ${"a".repeat(400)}  `, "o assunto").valor.length ===
    LIMITE_ASSUNTO_CHARS,
);

console.log("\n— o assunto novo —");

const semNome = conferirAssuntoNovo({ assunto: "   " }, []);
checa("assunto sem nome não nasce", semNome.ok === false);

// Sem dimensão nenhuma, e é o caso comum agora: a classificação saiu (#206).
const nasceu = conferirAssuntoNovo(
  { assunto: "  Padrão de recebimento  ", contexto: "veio do bloco 3" },
  [item("1"), item("2")],
);
checa("assunto com nome nasce, sem pedir dimensão", nasceu.ok === true);
checa("id novo não colide com os que já existem", nasceu.valor.id === "3");
checa("nasce SEM card — a fronteira de demandas", nasceu.valor.cardId === "");
checa("o texto chega aparado", nasceu.valor.assunto === "Padrão de recebimento");
checa(
  "nasce sem classificação",
  nasceu.valor.dimensaoId === "" && nasceu.valor.subdimensaoId === "",
);
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

console.log("\n— a linha fora do quadro e o apêndice do documento —");

// A linha cuja demanda saiu do quadro é REGISTRO, não trabalho: ela continua
// na pauta, marcada, porque a decisão da reunião não some com o card.
const pautaComOrfa = montarPauta({
  cards: [],
  ata: {
    itens: [item("7", { cardId: "sumido", assunto: "demanda que saiu" })],
  },
  entregues: { Cantinas: new Set() },
  hoje: new Date(2026, 7, 26).getTime(),
});
checa(
  "a linha fora do quadro existe na pauta",
  pautaComOrfa.length === 1 && pautaComOrfa[0].foraDoQuadro === true,
);

/**
 * "Em aberto" e "Outros pontos" são seção do documento do Cowork, não assunto da
 * reunião (ver `ehPendenciaDaReuniao` em `ata-core`).
 */
const pautaComPendencia = montarPauta({
  cards: [],
  ata: {
    itens: [
      item("1", { assunto: "Em aberto", contexto: "POPs sem responsável técnico" }),
      item("2", { assunto: "Reforma Dom Luís" }),
    ],
  },
  entregues: { Cantinas: new Set() },
  hoje: new Date(2026, 7, 26).getTime(),
});
checa(
  "o apêndice é a seção de pendências; o assunto de verdade é registro da reunião",
  pautaComPendencia.find((l) => l.item.id === "1").secao === "pendencia" &&
    pautaComPendencia.find((l) => l.item.id === "2").secao === "registrada",
  pautaComPendencia.map((l) => `${l.item.id}:${l.secao}`).join(","),
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
  },
);
checa("o assunto corrigido passa", corrigido.ok === true, corrigido.motivo);
const alvo = corrigido.ok && corrigido.valor.find((i) => i.id === "1");
checa("o texto novo chega aparado", alvo.assunto === "Padrão de recebimento");
checa("o contexto novo também", alvo.contexto === "veio do bloco 3, revisado");
// Corrigir o nome não é motivo para apagar a classificação antiga (#206).
checa(
  "a classificação antiga do item continua lá",
  alvo.dimensaoId === "d1" && alvo.subdimensaoId === "s1",
);

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

// A mesma régua da criação, chamada daqui e não copiada.
checa(
  "assunto apagado é recusado",
  editarAssunto(antes, "1", { assunto: "   " }).ok === false,
);

// Entre abrir o modal e salvar, o item pode ter sumido do array — a ata é
// editada por várias pessoas na mesma reunião. Sem esta recusa, o `map` não
// acharia nada, a escrita passaria "com sucesso" e a correção sumiria calada.
const sumiu = editarAssunto(antes, "99", { assunto: "vale" });
checa("item que não existe mais é recusado", sumiu.ok === false);
checa("e a recusa DIZ o que aconteceu", /não está mais na pauta/.test(sumiu.motivo));

// Onde há card, quem responde pelo nome é o quadro. Gravar aqui daria a
// impressão de ter renomeado a demanda, escrevendo em dois campos que a tela
// não lê mais.
const comCard = editarAssunto(
  [item("3", { cardId: "c9", assunto: "virou demanda" })],
  "3",
  { assunto: "outro nome" },
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
checa("a classificação antiga vem junto, intacta", chegou.dimensaoId === "d1" && chegou.subdimensaoId === "s1");
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

// A ata é escopada por setor: o assunto chegaria a uma reunião que as pessoas
// do setor dele talvez nem enxerguem.
const outroSetor = moverAssunto(ORIGEM, { ...DESTINO, setor: "B.I." }, "2");
checa("mover para ata de OUTRO setor é recusado", outroSetor.ok === false);
checa("e a recusa fala do setor", /mesmo setor/.test(outroSetor.motivo));

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
  "assunto, contexto e a classificação antiga vão junto",
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
  "setor diferente é recusado — a ata é escopada por setor",
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

/**
 * DESFAZER O LEVAR (#227) — levar era gesto de mão única.
 *
 * A pauta não tem "remover assunto", e o chip "levado para 09/09" só sumia
 * excluindo a ata de destino. O que estes `checa` cobram é que desfazer seja o
 * INVERSO exato de levar: a origem volta a ser o que era (sem ponteiro E sem a
 * marca, senão "Abrir a próxima" colhe o assunto de volta), e o destino volta a
 * ser o que era — sem tocar nas linhas que já moravam lá.
 */
console.log("\n— desfazer o levar —");

const D_ORIGEM = { ...L_ORIGEM, itens: lv_levado.valor.origem };
const D_DESTINO = { ...L_DESTINO, itens: lv_levado.valor.destino };
const desfeito = desfazerLevada(D_ORIGEM, D_DESTINO, "2");
checa("desfazer passa", desfeito.ok === true, desfeito.motivo);
checa(
  "a origem volta sem o ponteiro E sem a marca",
  desfeito.valor.origem.find((i) => i.id === "2").levadaParaAtaId === "" &&
    desfeito.valor.origem.find((i) => i.id === "2").proximaReuniao === false,
);
checa(
  "e com a decisão de hoje — desfazer não é apagar a linha daqui",
  desfeito.valor.origem.find((i) => i.id === "2").decisao === "separar sistema de totem" &&
    desfeito.valor.origem.length === 2,
);
checa(
  "o destino volta a ser exatamente o que era",
  JSON.stringify(desfeito.valor.destino) === JSON.stringify(L_DESTINO.itens),
);
checa("a cópia foi achada", desfeito.valor.copiaEncontrada === true);
checa(
  "cópia intocada não tem nada a avisar",
  haPerdas(desfeito.valor.perdas) === false,
  JSON.stringify(desfeito.valor.perdas),
);
checa(
  "e a linha volta a poder ser levada",
  levarAssunto(
    { ...L_ORIGEM, itens: desfeito.valor.origem },
    { ...L_DESTINO, itens: desfeito.valor.destino },
    desfeito.valor.origem.find((i) => i.id === "2"),
  ).ok === true,
);

// O QUE FOI ESCRITO LÁ sai junto com a cópia, e a tela tem de avisar antes.
const trabalhada = D_DESTINO.itens.map((i) =>
  i.id === "3"
    ? {
        ...i,
        decisao: "fechar com o fornecedor B",
        objetivo: "outro objetivo",
        tarefas: [
          { ...i.tarefas[0], status: "concluida" },
          { id: "9", texto: "nasceu lá", responsavel: "", prazo: "", status: "pendente", observacao: "" },
        ],
        levadaParaAtaId: "ata-16-09",
      }
    : i,
);
const perdas = desfazerLevada(D_ORIGEM, { ...D_DESTINO, itens: trabalhada }, "2").valor.perdas;
checa("avisa a decisão escrita lá", perdas.decisao === true);
checa("avisa o objetivo editado lá", perdas.objetivoEditado === true);
checa("conta a tarefa que nasceu lá", perdas.tarefasNovas === 1, String(perdas.tarefasNovas));
checa(
  "conta a tarefa concluída lá",
  perdas.tarefasConcluidas === 1,
  String(perdas.tarefasConcluidas),
);
checa("avisa que a cópia já foi levada adiante", perdas.levadaAdiante === "ata-16-09");

// LINHA COM CARD casa pelo card, e o homônimo lançado à mão lá NÃO é a cópia.
const C_ORIGEM = { ...L_ORIGEM, itens: [item("5", { cardId: "c9", assunto: "" })] };
const C_DESTINO = { ...L_DESTINO, itens: [item("1", { assunto: "" })] };
const cLevado = levarAssunto(C_ORIGEM, C_DESTINO, C_ORIGEM.itens[0]);
const cDesfeito = desfazerLevada(
  { ...C_ORIGEM, itens: cLevado.valor.origem },
  { ...C_DESTINO, itens: cLevado.valor.destino },
  "5",
);
checa(
  "linha com card: a cópia sai pelo card, e o vizinho sem nome fica",
  cDesfeito.ok === true &&
    cDesfeito.valor.destino.length === 1 &&
    cDesfeito.valor.destino[0].id === "1",
);
const homonimo = desfazerLevada(
  D_ORIGEM,
  {
    ...L_DESTINO,
    itens: [item("1", { assunto: "Sistema Connect e totens", origem: "manual" })],
  },
  "2",
);
checa(
  "o homônimo lançado à mão lá NÃO é apagado — o mesmo nome não é a mesma linha",
  homonimo.ok === true &&
    homonimo.valor.copiaEncontrada === false &&
    homonimo.valor.destino.length === 1,
);
checa(
  "e mesmo sem achar a cópia, o ponteiro daqui sai — senão o chip fica sem saída",
  homonimo.valor.origem.find((i) => i.id === "2").levadaParaAtaId === "",
);

// O CAMINHO ANTIGO: "Abrir a próxima reunião" cria a ata e deixa só a marca.
const marcada = {
  ...L_ORIGEM,
  itens: L_ORIGEM.itens.map((i) => (i.id === "2" ? { ...i, proximaReuniao: true } : i)),
};
const aberta = { id: "ata-02-09", setor: "Cantinas", data: "2026-09-02", itens: herdarParaProxima(marcada) };
checa(
  "o item colhido por 'Abrir a próxima' é achado pela procura",
  ataDaLevada(marcada.id, marcada.itens[1], [marcada, L_DESTINO, aberta]) === "ata-02-09",
);
checa(
  "linha nunca levada não aponta para lugar nenhum",
  ataDaLevada(marcada.id, marcada.itens[0], [marcada, aberta]) === "",
);
checa(
  "ponteiro para ata apagada não aponta para lugar nenhum",
  ataDaLevada(D_ORIGEM.id, D_ORIGEM.itens[1], [D_ORIGEM]) === "",
);
const antigo = desfazerLevada(marcada, aberta, "2");
checa(
  "desfazer o caminho antigo apaga a marca e a cópia herdada",
  antigo.ok === true &&
    antigo.valor.origem.find((i) => i.id === "2").proximaReuniao === false &&
    antigo.valor.destino.length === 0,
);

// AS RECUSAS
checa("mesma ata recusa", desfazerLevada(D_ORIGEM, D_ORIGEM, "2").ok === false);
checa(
  "setores diferentes recusa",
  desfazerLevada(D_ORIGEM, { ...D_DESTINO, setor: "B.I." }, "2").ok === false,
);
checa("linha que não está na origem recusa", desfazerLevada(D_ORIGEM, D_DESTINO, "99").ok === false);
checa("linha nunca levada recusa", desfazerLevada(D_ORIGEM, D_DESTINO, "1").ok === false);
checa(
  "levada para OUTRA reunião recusa — não apaga a linha errada",
  desfazerLevada(D_ORIGEM, { ...D_DESTINO, id: "ata-16-09" }, "2").ok === false,
);

// VISTO DO DESTINO (#231): é lá que a pessoa procura o "Desfazer", porque é lá
// que o assunto indesejado aparece.
console.log("\n— desfazer visto do destino —");
const copiaLa = D_DESTINO.itens[2];
checa(
  "a cópia acha a linha de origem que a deixou",
  itemDeOrigemDaCopia(copiaLa, D_ORIGEM, D_DESTINO.id)?.id === "2",
);
checa(
  "e desfazer por esse item tira a própria cópia",
  desfazerLevada(D_ORIGEM, D_DESTINO, itemDeOrigemDaCopia(copiaLa, D_ORIGEM, D_DESTINO.id).id)
    .valor.destino.every((i) => i.origemAtaId !== D_ORIGEM.id),
);
checa(
  "linha que mora lá desde sempre não tem origem a desfazer",
  itemDeOrigemDaCopia(D_DESTINO.itens[0], D_ORIGEM, D_DESTINO.id) === null,
);
checa(
  "cópia de uma linha levada para OUTRA reunião não oferece desfazer aqui",
  itemDeOrigemDaCopia(copiaLa, D_ORIGEM, "ata-16-09") === null,
);
checa(
  "cópia cuja origem já foi desfeita não oferece desfazer de novo",
  itemDeOrigemDaCopia(copiaLa, { ...D_ORIGEM, itens: desfeito.valor.origem }, D_DESTINO.id) === null,
);
checa(
  "caminho antigo: a herança de 'Abrir a próxima' acha a origem pela marca",
  itemDeOrigemDaCopia(aberta.itens[0], marcada, aberta.id)?.id === "2",
);

console.log(
  falhas === 0
    ? "\n✅ demanda que nasce na ata: ok"
    : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
