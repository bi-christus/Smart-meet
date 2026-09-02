/**
 * Testes da linha do tempo das reuniões (`lib/ata-linha-do-tempo-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que olhar a tela não protege:
 *
 * 1. A GEOMETRIA. Ler código para concluir sobre coordenada é o que falha nesta
 *    frente — já falhou antes neste projeto, num avatar que saía 30x41. Aqui o
 *    teste mede: o primeiro ponto encosta na borda esquerda do plot, o último na
 *    direita, o valor máximo bate no topo do eixo e o zero bate na base. Um
 *    gráfico com a escala invertida ou com um ponto fora do plot desenha
 *    perfeitamente bem — só está errado.
 *
 * 2. QUE A ESCALA COMECE EM ZERO e ande em número redondo. Eixo que começa no
 *    menor valor exagera a variação, e é o segundo jeito mais comum de um
 *    gráfico mentir; passo fracionário promete meia reunião.
 *
 * 3. QUE A CONTA SEJA DO QUE A ATA GRAVOU. Contar a pauta desenhada na tela
 *    (que junta as demandas abertas do quadro, ao vivo) faria a reunião de
 *    agosto mudar de altura sozinha toda semana.
 *
 * 4. QUE A BUSCA ACHE O QUE ESTÁ NO CARD. O item que virou demanda não guarda
 *    título nenhum — o nome mora no quadro. Uma busca que só olhasse a ata não
 *    acharia a reunião que decidiu sobre a demanda pelo nome dela, que é a
 *    pergunta mais provável desta tela.
 *
 * 5. DUAS REUNIÕES NO MESMO DIA. Sem a hora no eixo, as duas caem no mesmo X, o
 *    balão só sabe mostrar a primeira e a segunda vira invisível.
 */
import {
  MEDIDAS,
  maisPerto,
  montarLinhaDoTempo,
  normalizar,
  quandoDaAta,
  resumoDaBusca,
  reuniaoCasa,
  rotuloDeTempo,
  textoBuscavel,
  ticksBonitos,
  tracar,
  valorDa,
} from "../src/lib/ata-linha-do-tempo-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const tarefa = (extra = {}) => ({
  id: "1",
  texto: "aplicar o formulário",
  responsavel: "",
  prazo: "",
  status: "pendente",
  observacao: "",
  ...extra,
});

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

const ata = (id, data, extra = {}) => ({
  id,
  setor: "Cantinas",
  titulo: `Reunião ${id}`,
  data,
  horaInicio: "",
  horaFim: "",
  local: "",
  facilitador: "",
  participantes: [],
  citados: [],
  meetingId: null,
  itens: [],
  ...extra,
});

const SEM_CARDS = () => "";

console.log("\n— quando a reunião cai no eixo —");

checa("sem data não entra no eixo", quandoDaAta("", "09:00") === null);
checa("data mal formada também não", quandoDaAta("26/08/2026", "") === null);

const manha = quandoDaAta("2026-08-26", "08:00");
const tarde = quandoDaAta("2026-08-26", "14:30");
checa("a hora separa duas reuniões do mesmo dia", manha < tarde);
checa(
  "e a distância entre elas é a real",
  tarde - manha === 6.5 * 3600000,
  `veio ${(tarde - manha) / 3600000}h`,
);

// Sem hora, meio-dia: em 00:00 a reunião pareceria anterior a uma que tem
// "08:00" escrito, o que e uma afirmacao que ninguem fez.
const semHora = quandoDaAta("2026-08-26", "");
checa("sem hora, meio-dia", semHora > manha && semHora < quandoDaAta("2026-08-26", "23:00"));

console.log("\n— a busca de quem digita com pressa —");

checa("tira acento", normalizar("Decisão") === "decisao");
checa("tira caixa alta", normalizar("ESTOQUE") === "estoque");
checa("aguenta nulo", normalizar(null) === "");

const cheio = item("1", {
  cardId: "c1",
  assunto: "assunto da ata",
  contexto: "contexto",
  decisao: "decidiu",
  objetivo: "objetivo",
  tarefas: [tarefa({ texto: "aplicar", observacao: "observado" })],
});
const texto = textoBuscavel(cheio, "Padronizar o recebimento de hortifrúti");
checa("o título do CARD entra na busca", texto.includes("hortifruti"));
checa("o contexto entra", texto.includes("contexto"));
checa("a decisão entra", texto.includes("decidiu"));
checa("o objetivo entra", texto.includes("objetivo"));
checa("o texto da tarefa entra", texto.includes("aplicar"));
checa("a observação da tarefa entra", texto.includes("observado"));

console.log("\n— as reuniões viram pontos —");

const ATAS = [
  ata("b", "2026-09-02", {
    titulo: "Reunião de setembro",
    horaInicio: "09:00",
    itens: [
      item("1", { decisao: "decidiu", tarefas: [tarefa(), tarefa({ id: "2", status: "concluida" })] }),
      item("2", { cardId: "c1" }),
      item("3", { assunto: "fila do caixa" }),
    ],
  }),
  ata("a", "2026-08-26", {
    horaInicio: "14:00",
    itens: [item("1", { decisao: "decidiu" })],
  }),
  ata("z", "", { titulo: "reunião sem data" }),
];

const { pontos, semData } = montarLinhaDoTempo({
  atas: ATAS,
  tituloDoCard: (id) => (id === "c1" ? "Padronizar o recebimento de hortifrúti" : ""),
});

checa("a reunião sem data fica de fora do eixo", pontos.length === 2);
checa("e a tela sabe quantas ficaram", semData === 1);
checa("a ordem é do mais antigo para o mais novo", pontos[0].ataId === "a", `veio ${pontos[0].ataId}`);

const set = pontos[1];
checa("a pauta conta o que a ATA gravou", set.pauta === 3, `veio ${set.pauta}`);
checa("as decisões contam só quem tem decisão escrita", set.decisoes === 1);
checa("as tarefas somam todos os itens", set.tarefas === 2);
checa("e as concluídas são contadas à parte", set.tarefasFeitas === 1);
checa(
  "o item com card empresta o título do quadro",
  set.itens.find((i) => i.id === "2").titulo === "Padronizar o recebimento de hortifrúti",
);
checa("o item sem card usa o assunto da ata", set.itens.find((i) => i.id === "3").titulo === "fila do caixa");
checa("e o que é demanda se declara", set.itens.find((i) => i.id === "2").ehDemanda === true);

// O card foi para a lixeira: o titulo do quadro nao existe mais, e sobra o que
// a ata guardou. Sem isto a linha apareceria sem nome nenhum no balao.
const orfa = montarLinhaDoTempo({
  atas: [ata("o", "2026-08-26", { itens: [item("1", { cardId: "sumido", assunto: "" })] })],
  tituloDoCard: SEM_CARDS,
}).pontos[0];
checa(
  "card fora do quadro e sem assunto ainda tem nome",
  orfa.itens[0].titulo === "Sem título na ata",
  `veio "${orfa.itens[0].titulo}"`,
);

console.log("\n— em que reunião se falou daquilo —");

const buscado = montarLinhaDoTempo({
  atas: ATAS,
  tituloDoCard: (id) => (id === "c1" ? "Padronizar o recebimento de hortifrúti" : ""),
  termo: "HORTIFRUTI",
}).pontos;
const comMatch = buscado.find((p) => p.ataId === "b");
checa("a busca acha pelo título do card, sem acento e em caixa alta", comMatch.casam === 1);
checa("e marca o item que casou", comMatch.itens.find((i) => i.id === "2").casa === true);
checa("a reunião que não casa fica com zero", buscado.find((p) => p.ataId === "a").casam === 0);
checa("o resumo conta reuniões e itens", JSON.stringify(resumoDaBusca(buscado)) === '{"reunioes":1,"itens":1}');

// O titulo da reuniao tambem responde: "em que reuniao se falou de setembro?"
const porTitulo = montarLinhaDoTempo({
  atas: ATAS,
  tituloDoCard: SEM_CARDS,
  termo: "setembro",
}).pontos.find((p) => p.ataId === "b");
checa("o título da reunião também casa", porTitulo.tituloCasa === true);
checa("e ela entra no destaque mesmo sem item casando", reuniaoCasa(porTitulo) === true);

checa("sem termo, nada casa", montarLinhaDoTempo({ atas: ATAS, tituloDoCard: SEM_CARDS }).pontos.every((p) => p.casam === 0 && !p.tituloCasa));

console.log("\n— as três medidas —");

checa("são três", MEDIDAS.length === 3);
checa("pauta lê a pauta", valorDa(set, "pauta") === 3);
checa("decisões lê as decisões", valorDa(set, "decisoes") === 1);
checa("tarefas lê as tarefas", valorDa(set, "tarefas") === 2);

console.log("\n— a escala do eixo Y —");

checa("máximo zero ainda dá um eixo", JSON.stringify(ticksBonitos(0)) === "[0,1]");
checa("sempre começa em zero", ticksBonitos(37)[0] === 0);

// O BUG QUE O RENDERIZADOR PEGOU E ESTE TESTE NÃO PEGAVA. A primeira versão
// parava a escada em `max + passo/2`: com uma pauta de 12 o eixo terminava em
// 10, e o ponto de 12 era desenhado com `cy` NEGATIVO — acima do plot, fora do
// gráfico, sem erro nenhum. Um máximo só não prova escala; a varredura prova.
const topoSempreCobre = [];
for (let m = 1; m <= 200; m++) {
  const t = ticksBonitos(m);
  if (t.at(-1) < m) topoSempreCobre.push(`${m}→${t.at(-1)}`);
}
checa(
  "o topo cobre o maior valor, para TODO máximo de 1 a 200",
  topoSempreCobre.length === 0,
  topoSempreCobre.slice(0, 5).join(", "),
);
checa("e o caso que quebrou: 12 termina em 15", ticksBonitos(12).at(-1) === 15, JSON.stringify(ticksBonitos(12)));

const passosDesiguais = [];
for (let m = 1; m <= 200; m++) {
  const t = ticksBonitos(m);
  const p = t[1] - t[0];
  if (t.some((v, i) => i > 0 && v - t[i - 1] !== p)) passosDesiguais.push(m);
}
checa("e o passo é sempre o mesmo do começo ao fim", passosDesiguais.length === 0, passosDesiguais.slice(0, 5).join(", "));
checa("os passos são inteiros", ticksBonitos(3).every(Number.isInteger), JSON.stringify(ticksBonitos(3)));
checa("passo redondo em 10", JSON.stringify(ticksBonitos(10)) === "[0,5,10]", JSON.stringify(ticksBonitos(10)));
checa("e em 8, com quatro marcas", JSON.stringify(ticksBonitos(8)) === "[0,2,4,6,8]", JSON.stringify(ticksBonitos(8)));
checa("passo redondo em 100", ticksBonitos(100).at(-1) === 100 && ticksBonitos(100).includes(50));
checa("nunca devolve um tick só", ticksBonitos(1).length >= 2);

console.log("\n— a geometria: onde cada coisa é desenhada —");

const CAIXA = { larg: 900, alt: 320, margem: { topo: 20, dir: 24, baixo: 34, esq: 40 } };
const X0 = 40;
const X1 = 900 - 24;
const Y0 = 20;
const Y1 = 320 - 34;

const t = tracar(pontos, "pauta", CAIXA);

checa("o primeiro ponto encosta na esquerda do plot", t.pts[0].x === X0, `veio ${t.pts[0].x}`);
checa("o último encosta na direita", t.pts.at(-1).x === X1, `veio ${t.pts.at(-1).x}`);
checa("o plot é o esperado", JSON.stringify(t.plot) === JSON.stringify({ x0: X0, x1: X1, y0: Y0, y1: Y1 }));

// A pauta maxima e 3 e o topo do eixo e 3: o ponto tem de bater no teto do
// plot. Escala invertida desenha igualmente bem, e esta so ao contrario.
checa("o topo do eixo é o último tick", t.topo === t.ticksY.at(-1).v);
checa(
  "o maior valor bate no teto do plot",
  t.pts.find((p) => p.ponto.pauta === 3).y === Y0,
  `veio ${t.pts.find((p) => p.ponto.pauta === 3).y}`,
);
checa("o tick zero fica na base", t.ticksY[0].v === 0 && t.ticksY[0].y === Y1);
checa(
  "valor maior desenha MAIS ALTO (y menor)",
  t.pts.find((p) => p.ponto.pauta === 3).y < t.pts.find((p) => p.ponto.pauta === 1).y,
);
checa("nenhum ponto sai do plot", t.pts.every((p) => p.x >= X0 && p.x <= X1 && p.y >= Y0 && p.y <= Y1));

checa("a linha começa com M", t.linha.startsWith("M"));
checa("e tem um L por ponto seguinte", (t.linha.match(/L/g) || []).length === t.pts.length - 1);
checa("a área fecha no Z", t.area.endsWith("Z"));
checa("e desce até a base antes de fechar", t.area.includes(`L${t.pts.at(-1).x} ${Y1}`));

console.log("\n— os casos que quebram um gráfico —");

const soUm = tracar([pontos[0]], "pauta", CAIXA);
checa("um ponto só fica no MEIO, não colado na borda", soUm.pts[0].x === (X0 + X1) / 2, `veio ${soUm.pts[0].x}`);
checa("com um ponto só a marca de tempo é uma", soUm.ticksX.length === 1);

const nenhum = tracar([], "pauta", CAIXA);
checa("sem ponto nenhum não explode", nenhum.pts.length === 0 && nenhum.linha === "" && nenhum.area === "");
checa("e ainda assim há eixo", nenhum.ticksY.length >= 2);

// Duas reunioes no mesmo dia, horas diferentes: sem a hora no eixo as duas
// cairiam no mesmo X e a segunda seria invisivel.
const mesmoDia = montarLinhaDoTempo({
  atas: [
    ata("m1", "2026-08-26", { horaInicio: "08:00", itens: [item("1")] }),
    ata("m2", "2026-08-26", { horaInicio: "16:00", itens: [item("1"), item("2")] }),
  ],
  tituloDoCard: SEM_CARDS,
}).pontos;
const td = tracar(mesmoDia, "pauta", CAIXA);
checa("duas reuniões no mesmo dia não se sobrepõem", td.pts[0].x !== td.pts[1].x);

console.log("\n— as marcas de tempo —");

checa("são no máximo seis", t.ticksX.length <= 6);
checa("a primeira encosta na esquerda", t.ticksX[0].x === X0);
checa("a última na direita", t.ticksX.at(-1).x === X1);
checa("dia e mês quando o vão é curto", rotuloDeTempo(quandoDaAta("2026-08-26", ""), false) === "26 ago");
checa("mês e ano quando o vão passa de um ano", rotuloDeTempo(quandoDaAta("2026-08-26", ""), true) === "ago/26");

console.log("\n— o alvo do mouse é a faixa inteira, não o pontinho —");

const alvos = [{ x: 10 }, { x: 100 }, { x: 200 }];
checa("acha o mais perto à esquerda", maisPerto(alvos, 12) === 0);
checa("acha o do meio mesmo longe", maisPerto(alvos, 140) === 1);
checa("acha o último passando dele", maisPerto(alvos, 5000) === 2);
checa("lista vazia devolve -1", maisPerto([], 10) === -1);

console.log(
  falhas === 0
    ? "\n✅ linha do tempo das reuniões: ok"
    : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
