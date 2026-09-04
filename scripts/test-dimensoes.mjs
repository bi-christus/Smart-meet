/**
 * Testes da árvore de dimensões.
 *
 * O que este arquivo protege, em ordem de quanto dói errar:
 *
 *  1. **Demanda nenhuma some da árvore.** É a garantia mais cara: um card que
 *     aponta para uma dimensão apagada, ou que nunca foi classificado, tem de
 *     cair no "Sem classificação" — nunca desaparecer. Uma árvore que engole
 *     demanda não dá erro, não fica vermelha e não deixa rastro; ela só mostra
 *     menos trabalho do que existe, e quem olha acredita.
 *  2. **O id da subdimensão nunca é reaproveitado.** Ele é o que a demanda
 *     guarda. Reciclar um id depois de uma exclusão remanejaria demandas de uma
 *     subdimensão para outra, em silêncio.
 *  3. **A régua do nome é a mesma no TypeScript e em CEL.** Nenhum outro portão
 *     do projeto liga as duas — o `tsc` não lê CEL.
 *  4. **"Atrasada" concorda com o resto do app.** A conta usa `ehEntrega` de
 *     `entregas-core`, a mesma do Rank e dos emblemas, e não uma cópia.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ESTADO_LABEL,
  ID_SEM_DIMENSAO,
  LIMITE_NOME_CHARS,
  PALETA_DIMENSAO,
  PARADA_DIAS,
  acharNo,
  achatar,
  cardsDoNo,
  conferirNome,
  corDaDimensao,
  estadoDoNo,
  estaAtrasada,
  ID_SEM_TAG,
  demandasDaArvore,
  filtrarArvore,
  montarArvore,
  montarArvorePorTag,
  nomeExistente,
  normalizarDimensao,
  ordenarDimensoes,
  proximoIdDeSub,
} from "../src/lib/dimensoes-core.ts";
import { entreguesPorSetor } from "../src/lib/entregas-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

// As colunas de verdade, para a regra de entrega ser a de produção.
const COLS = [
  { id: "backlog", title: "A fazer" },
  { id: "andamento", title: "Em andamento" },
  { id: "concluido", title: "Concluído" },
];
const ENT = entreguesPorSetor({ Infra: COLS });

const HOJE = new Date(2026, 7, 20, 15, 30).getTime(); // 20/08/2026, meio da tarde
const DIA = 86400000;

console.log("\n— a régua do nome —");

checa("nome comum passa", conferirNome("Brigada", "da dimensão").ok);
checa("o nome volta aparado", conferirNome("  Brigada  ", "x").nome === "Brigada");
checa("vazio é recusado", !conferirNome("", "x").ok);
checa("só espaço é recusado", !conferirNome("   ", "x").ok);
checa("o que não é texto é recusado", !conferirNome(undefined, "x").ok);
checa("número é recusado", !conferirNome(42, "x").ok);
checa("o teto é respeitado", conferirNome("x".repeat(LIMITE_NOME_CHARS), "x").ok);
checa(
  "um caractere além do teto é recusado",
  !conferirNome("x".repeat(LIMITE_NOME_CHARS + 1), "x").ok,
);
// Acento conta um caractere para o `.length` do JS e para o `size()` do CEL.
checa(
  "nome acentuado é medido igual dos dois lados",
  conferirNome("ç".repeat(LIMITE_NOME_CHARS), "x").ok &&
    !conferirNome("ç".repeat(LIMITE_NOME_CHARS + 1), "x").ok,
);
checa(
  "o nome mais longo do documento da Infra cabe",
  conferirNome("Higiene, Hospitalidade e Logística Interna", "x").ok,
);
checa("a recusa explica o motivo", conferirNome("", "da dimensão").motivo.includes("dimensão"));

console.log("\n— duplicata —");

const lista = [
  { id: "a", nome: "Brigada" },
  { id: "b", nome: "Compras" },
];
checa("acha o igual", nomeExistente("Brigada", lista)?.id === "a");
checa("acha sem diferenciar caixa", nomeExistente("brigada", lista)?.id === "a");
checa("acha com espaço sobrando", nomeExistente("  BRIGADA ", lista)?.id === "a");
checa("não inventa o que não tem", nomeExistente("RH", lista) === undefined);

console.log("\n— id de subdimensão —");

checa("a primeira é s1", proximoIdDeSub([]) === "s1");
checa(
  "conta a partir do maior já emitido",
  proximoIdDeSub([{ id: "s1" }, { id: "s2" }, { id: "s3" }]) === "s4",
);
// A garantia nº 2 do cabeçalho: apagar do meio não recicla id.
checa(
  "apagar do meio NÃO recicla o id",
  proximoIdDeSub([{ id: "s1" }, { id: "s3" }]) === "s4",
);
checa(
  "id fora do padrão não confunde a conta",
  proximoIdDeSub([{ id: "legado" }, { id: "s7" }]) === "s8",
);

console.log("\n— leitura defensiva do documento —");

const dim = normalizarDimensao("d1", {
  nome: "  Pessoas  ",
  setor: "Infra",
  ordem: 3,
  subs: [
    { id: "s1", nome: "Ciclo de pessoal", tipo: "rotina" },
    { id: "s2", nome: "  Disciplina  ", tipo: "projeto" },
    { id: "s2", nome: "Repetida" }, // id repetido
    { id: "s3", nome: "" }, // sem nome
    { id: "", nome: "Sem id" },
    { nome: "Sem id nenhum" },
    null,
    "texto solto",
    { id: "s9", nome: "Sem tipo" }, // tipo ausente
  ],
});
checa("nome e setor voltam aparados", dim?.nome === "Pessoas");
checa("subdimensão quebrada não derruba a dimensão", dim?.subs.length === 3, JSON.stringify(dim?.subs));
checa("id repetido entra uma vez só", dim?.subs.filter((s) => s.id === "s2").length === 1);
checa("o nome da subdimensão volta aparado", dim?.subs[1]?.nome === "Disciplina");
checa("tipo ausente vira rotina, não projeto", dim?.subs[2]?.tipo === "rotina");
checa("sem nome, a dimensão inteira é descartada", normalizarDimensao("x", { setor: "Infra" }) === null);
checa("sem setor, a dimensão inteira é descartada", normalizarDimensao("x", { nome: "Solta" }) === null);
checa("documento que não é objeto é descartado", normalizarDimensao("x", null) === null);
checa("ordem ausente vira 0", normalizarDimensao("x", { nome: "A", setor: "S" })?.ordem === 0);

console.log("\n— ordem e cor —");

const ordenadas = ordenarDimensoes([
  { id: "c", nome: "Zebra", ordem: 1, setor: "S", subs: [] },
  { id: "a", nome: "Alfa", ordem: 1, setor: "S", subs: [] },
  { id: "b", nome: "Beta", ordem: 0, setor: "S", subs: [] },
]);
checa("ordena pelo número", ordenadas[0].id === "b");
checa("empate desempata pelo nome", ordenadas[1].id === "a" && ordenadas[2].id === "c");
checa("a paleta tem oito passos", PALETA_DIMENSAO.length === 8);
checa("a cor dá a volta na paleta", corDaDimensao(0) === corDaDimensao(8));
checa("ordem negativa não quebra a cor", typeof corDaDimensao(-3) === "string" && corDaDimensao(-3).startsWith("#"));

console.log("\n— atraso —");

checa(
  "prazo de ontem, em aberto, está atrasada",
  estaAtrasada("2026-08-19", false, HOJE),
);
checa(
  "prazo de HOJE não está atrasada",
  !estaAtrasada("2026-08-20", false, HOJE),
);
// A hora do dia não pode mudar o veredito — foi por isso que `inicioDoDia` existe.
checa(
  "a hora do dia não muda o veredito",
  !estaAtrasada("2026-08-20", false, new Date(2026, 7, 20, 23, 59).getTime()),
);
checa(
  "demanda ENTREGUE com prazo vencido não está atrasada",
  !estaAtrasada("2026-01-01", true, HOJE),
);
checa(
  "sem prazo não está atrasada",
  !estaAtrasada(null, false, HOJE),
);

console.log("\n— a árvore —");

const DIMS = [
  {
    id: "d1",
    setor: "Infra",
    nome: "Soft Services",
    ordem: 0,
    subs: [
      { id: "s1", nome: "Controle de uso de EPI", tipo: "projeto" },
      { id: "s2", nome: "Carga e descarga", tipo: "rotina" },
    ],
  },
  { id: "d2", setor: "Infra", nome: "Pessoas", ordem: 1, subs: [] },
];

const card = (id, extra) => ({
  id,
  sector: "Infra",
  columnId: "backlog",
  title: "Demanda " + id,
  enteredAt: HOJE - DIA,
  ...extra,
});

const CARDS = [
  card("a", { dimensaoId: "d1", subdimensaoId: "s1", due: "2026-08-19" }), // atrasada
  card("b", { dimensaoId: "d1", subdimensaoId: "s1", columnId: "concluido", due: "2026-01-01" }), // entregue
  card("c", { dimensaoId: "d1", subdimensaoId: null }), // direto na dimensão
  card("d", { dimensaoId: "d1", subdimensaoId: "apagada" }), // sub que não existe mais
  card("e", { dimensaoId: "sumiu", subdimensaoId: "s1" }), // dimensão que não existe mais
  card("f", {}), // nunca classificada
  card("g", { dimensaoId: "d2", enteredAt: HOJE - 40 * DIA }), // parada
];

const arvore = montarArvore({ dims: DIMS, cards: CARDS, entregues: ENT, agora: HOJE });

// A garantia nº 1 do cabeçalho.
const todos = arvore.flatMap(cardsDoNo).map((c) => c.id).sort();
checa(
  "NENHUMA demanda some da árvore",
  todos.join(",") === "a,b,c,d,e,f,g",
  todos.join(","),
);
checa(
  "demanda com dimensão apagada cai no Sem classificação",
  cardsDoNo(acharNo(arvore, ID_SEM_DIMENSAO)).some((c) => c.id === "e"),
);
checa(
  "demanda com subdimensão apagada fica NA dimensão dela",
  cardsDoNo(acharNo(arvore, "d1")).some((c) => c.id === "d"),
);
checa(
  "demanda nunca classificada cai no Sem classificação",
  cardsDoNo(acharNo(arvore, ID_SEM_DIMENSAO)).some((c) => c.id === "f"),
);
checa("o Sem classificação vem por último", arvore[arvore.length - 1].id === ID_SEM_DIMENSAO);
checa(
  "sem demanda solta, o Sem classificação não existe",
  montarArvore({ dims: DIMS, cards: [card("z", { dimensaoId: "d1" })], entregues: ENT, agora: HOJE })
    .every((n) => n.id !== ID_SEM_DIMENSAO),
);
// A caixa "Direto na dimensão" existe onde há demanda sem subdimensão (d1 tem
// a "c" e a "d", d2 tem a "g") e NÃO existe quando toda demanda desceu o
// segundo nível — senão toda dimensão da árvore ganharia um galho vazio.
checa(
  "a caixa Direto na dimensão nasce onde há demanda sem subdimensão",
  acharNo(arvore, "d1/direto") !== undefined && acharNo(arvore, "d2/direto") !== undefined,
);
checa(
  "a caixa Direto na dimensão NÃO nasce quando toda demanda tem subdimensão",
  montarArvore({
    dims: DIMS,
    cards: [card("z", { dimensaoId: "d1", subdimensaoId: "s1" })],
    entregues: ENT,
    agora: HOJE,
  }).every((n) => n.filhos.every((f) => !f.id.endsWith("/direto"))),
);

console.log("\n— métricas —");

const s1 = acharNo(arvore, "d1/s1");
checa("a subdimensão conta as suas duas demandas", s1.metricas.total === 2);
checa("a entregue conta como entregue", s1.metricas.entregues === 1);
checa("a vencida em aberto conta como atrasada", s1.metricas.atrasadas === 1);
checa("projeto tem porcentagem", s1.metricas.pctConcluido === 50);
checa("o próximo prazo é o menor em aberto", s1.metricas.proximoPrazo === "2026-08-19");

const s2 = acharNo(arvore, "d1/s2");
checa("subdimensão sem demanda tem métricas zeradas", s2.metricas.total === 0);
checa("subdimensão sem demanda não tem porcentagem", s2.metricas.pctConcluido === null);
checa("subdimensão sem demanda é 'vazio'", s2.estado === "vazio");

const d1 = acharNo(arvore, "d1");
checa("a dimensão soma os filhos", d1.metricas.total === 4, String(d1.metricas.total));
checa("a dimensão herda o atraso do filho", d1.estado === "atrasado");

const d2 = acharNo(arvore, "d2");
checa(
  "40 dias sem sair do lugar é 'parado'",
  d2.estado === "parado",
  `${d2.estado} / ${d2.metricas.diasSemMovimento}d`,
);
checa(
  "o corte de parada é o do módulo",
  estadoDoNo({ total: 1, entregues: 0, abertas: 1, atrasadas: 0, semPrazo: 1, proximoPrazo: null, diasSemMovimento: PARADA_DIAS, pctConcluido: 0 }) === "parado" &&
    estadoDoNo({ total: 1, entregues: 0, abertas: 1, atrasadas: 0, semPrazo: 1, proximoPrazo: null, diasSemMovimento: PARADA_DIAS - 1, pctConcluido: 0 }) === "andamento",
);
checa(
  "tudo entregue é 'concluido', e não 'vazio'",
  estadoDoNo({ total: 2, entregues: 2, abertas: 0, atrasadas: 0, semPrazo: 0, proximoPrazo: null, diasSemMovimento: null, pctConcluido: 100 }) === "concluido",
);
// O mínimo, e não o máximo: um galho com uma demanda de ontem está vivo.
checa(
  "sem movimento é a demanda mais recente, não a mais velha",
  d1.metricas.diasSemMovimento === 1,
  String(d1.metricas.diasSemMovimento),
);
checa("todo estado tem rótulo", Object.keys(ESTADO_LABEL).length === 5);

console.log("\n— busca —");

checa("termo vazio devolve a mesma árvore", filtrarArvore(arvore, "  ") === arvore);
const achado = filtrarArvore(arvore, "EPI");
checa("a busca acha a subdimensão pelo nome", achado.length === 1 && achado[0].id === "d1");
checa(
  "o nó que casa traz os filhos inteiros",
  cardsDoNo(acharNo(achado, "d1/s1")).length === 2,
);
const porTitulo = filtrarArvore(arvore, "Demanda g");
checa("a busca acha pelo título da demanda", porTitulo.length === 1 && porTitulo[0].id === "d2");
checa("busca sem resultado devolve vazio", filtrarArvore(arvore, "zzzz").length === 0);
checa(
  "a busca não diferencia caixa",
  filtrarArvore(arvore, "epi").length === 1,
);

console.log("\n— achatar —");
checa(
  "achatar traz todo mundo uma vez",
  achatar(arvore).length === arvore.length + arvore.reduce((a, n) => a + n.filhos.length, 0),
);
checa("nó inexistente devolve undefined", acharNo(arvore, "nao-existe") === undefined);

console.log("\n— o core é puro —");

const fonte = readFileSync(join(raiz, "src/lib/dimensoes-core.ts"), "utf8");
checa("nada de firebase dentro do core (AGENTS.md §4)", !/from\s+["']firebase/.test(fonte));
checa("nada de react dentro do core", !/from\s+["']react["']/.test(fonte));

console.log("\n— o TypeScript e a regra do Firestore concordam —");

const rules = readFileSync(join(raiz, "firestore.rules"), "utf8");
const bloco = rules.match(/match \/dimensoes\/\{[\s\S]*?\n {4}\}/);
checa("existe bloco /dimensoes nas regras", Boolean(bloco));
if (bloco) {
  const teto = bloco[0].match(/size\(\) <= (\d+)/);
  checa(
    "o teto de caracteres da regra é o mesmo do core",
    teto ? Number(teto[1]) === LIMITE_NOME_CHARS : false,
    teto ? `regra=${teto[1]} core=${LIMITE_NOME_CHARS}` : "não achei o teto",
  );
  checa("quem enxerga o setor lê", /allow read: if podeNoSetor\(cur\('setor'\)\);/.test(bloco[0]));
  checa("só gestor ou admin escreve", /gestorNoSetor\(/.test(bloco[0]));
  checa("a regra recusa nome vazio, como o core", /!= ''/.test(bloco[0]));
  checa(
    "o setor é imutável no update",
    /novo\('setor'\) == cur\('setor'\)/.test(bloco[0]),
    bloco[0],
  );
}

// ---------------------------------------------------------------------------
// O eixo por TAG
// ---------------------------------------------------------------------------
//
// O que estes testes protegem, e que olhar a tela não pega: a CONTAGEM. No eixo
// por dimensão cada demanda mora num lugar só; no eixo por tag ela aparece em
// todos os galhos das suas tags, de propósito. A linha que separa "aparece duas
// vezes" (certo, é o ponto do eixo) de "é contada duas vezes" (errado, e o
// número fica inflado para sempre sem ninguém desconfiar) é fina, e é só isto
// que a segura.

console.log("\n— a árvore agrupada por tag —");

const ENT_VAZIO = {};
const porTag = (cards) => montarArvorePorTag({ cards, entregues: ENT_VAZIO });
const cardT = (id, tags, extra = {}) => ({
  id,
  sector: "Cantinas",
  columnId: "andamento",
  title: `Demanda ${id}`,
  tags,
  ...extra,
});
const nomes = (nos) => nos.map((n) => n.nome).join(",");

{
  const a = porTag([
    cardT("1", ["estoque"]),
    cardT("2", ["estoque", "compras"]),
    cardT("3", ["compras"]),
    cardT("4", []),
  ]);
  checa(
    "os galhos saem do mais cheio para o mais vazio, e o 'Sem tag' fica por último",
    nomes(a) === "compras,estoque,Sem tag" || nomes(a) === "estoque,compras,Sem tag",
    nomes(a),
  );
  checa("o 'Sem tag' é sempre o último", a[a.length - 1].id === ID_SEM_TAG);
  checa(
    "a demanda com DUAS tags aparece nos dois galhos — é o ponto do eixo",
    a.filter((n) => cardsDoNo(n).some((c) => c.id === "2")).length === 2,
  );
  checa(
    "quem não tem tag nenhuma cai no 'Sem tag', nunca some",
    cardsDoNo(a[a.length - 1]).map((c) => c.id).join(",") === "4",
  );
  checa(
    "toda demanda do setor está na árvore, uma vez só",
    demandasDaArvore(a).length === 4,
    String(demandasDaArvore(a).length),
  );
}

{
  const a = porTag([
    cardT("1", ["Cantinas/Estoque"]),
    cardT("2", ["cantinas/frios"]),
    cardT("3", ["Cantinas"]),
  ]);
  const mae = a.find((n) => n.id === "tag:cantinas");
  checa("a barra vira hierarquia: a mãe existe", !!mae);
  checa(
    "e as filhas penduram nela, no nível 2",
    mae.filhos.length === 2 && mae.filhos.every((f) => f.nivel === 2),
    String(mae.filhos.length),
  );
  checa(
    "a filha herda a COR da mãe — cores diferentes desmanchariam a família",
    mae.filhos.every((f) => f.cor === mae.cor),
  );
  checa(
    "a mãe conta as filhas junto com as suas",
    mae.metricas.total === 3,
    String(mae.metricas.total),
  );
  checa(
    "a demanda marcada só com a mãe fica NA mãe, não numa filha inventada",
    mae.cards.map((c) => c.id).join(",") === "3",
  );
  checa(
    "nenhum galho carrega o selo de projeto/rotina: ele é conceito de subdimensão",
    achatar(a).every((n) => n.tipo === null),
  );
}

checa(
  "mãe e filha no MESMO card não contam duas vezes",
  (() => {
    const a = porTag([cardT("1", ["cantinas", "cantinas/estoque"])]);
    const mae = a.find((n) => n.id === "tag:cantinas");
    // A tag ancestral é ignorada: a filha já pendura a demanda debaixo da mãe.
    return mae.metricas.total === 1 && mae.cards.length === 0;
  })(),
);
checa(
  "duas filhas irmãs do mesmo card não contam duas vezes na mãe",
  (() => {
    const a = porTag([cardT("1", ["cantinas/estoque", "cantinas/frios"])]);
    const mae = a.find((n) => n.id === "tag:cantinas");
    return mae.filhos.length === 2 && mae.metricas.total === 1;
  })(),
);
checa(
  "tag de TRÊS níveis dobra no segundo, e não cria um terceiro recuo",
  (() => {
    const a = porTag([cardT("1", ["cantinas/estoque/frios"])]);
    const mae = a.find((n) => n.id === "tag:cantinas");
    return (
      mae.filhos.length === 1 &&
      mae.filhos[0].id === "tag:cantinas/estoque" &&
      mae.filhos[0].filhos.length === 0
    );
  })(),
);
checa(
  "duas tags do card que dobram no MESMO galho contam uma vez",
  (() => {
    const a = porTag([cardT("1", ["cantinas/estoque/frios", "cantinas/estoque/secos"])]);
    return a[0].metricas.total === 1;
  })(),
);
checa(
  "duas grafias da mesma tag são UM galho, com a grafia mais usada",
  (() => {
    const a = porTag([
      cardT("1", ["Estoque"]),
      cardT("2", ["estoque"]),
      cardT("3", ["Estoque"]),
    ]);
    return a.length === 1 && a[0].nome === "Estoque" && a[0].metricas.total === 3;
  })(),
);
checa(
  "tag sem letra nenhuma não vira galho — o card cai no 'Sem tag'",
  (() => {
    const a = porTag([cardT("1", ["###"])]);
    return a.length === 1 && a[0].id === ID_SEM_TAG;
  })(),
);
checa(
  "quadro sem tag nenhuma devolve só o 'Sem tag'",
  (() => {
    const a = porTag([cardT("1", null), cardT("2", [])]);
    return a.length === 1 && a[0].id === ID_SEM_TAG && a[0].metricas.total === 2;
  })(),
);
checa("quadro sem demanda devolve árvore vazia", porTag([]).length === 0);
checa(
  "a busca da tela funciona no eixo novo sem código novo",
  (() => {
    const a = porTag([cardT("1", ["estoque"]), cardT("2", ["compras"])]);
    const r = filtrarArvore(a, "estoque");
    return r.length === 1 && r[0].nome === "estoque";
  })(),
);
checa(
  "e `acharNo` acha o galho pelo id, como no eixo antigo",
  (() => {
    const a = porTag([cardT("1", ["cantinas/estoque"])]);
    return acharNo(a, "tag:cantinas/estoque")?.nome === "estoque";
  })(),
);
checa(
  "o atraso é medido pela MESMA regra do resto do app",
  (() => {
    const a = montarArvorePorTag({
      cards: [cardT("1", ["estoque"], { due: "2020-01-01" })],
      entregues: ENT_VAZIO,
      agora: Date.parse("2026-09-04T12:00:00Z"),
    });
    return a[0].metricas.atrasadas === 1 && a[0].estado === "atrasado";
  })(),
);
checa(
  "no eixo por DIMENSÃO a deduplicação não mudou nada",
  (() => {
    const a = montarArvore({
      dims: [{ id: "d1", setor: "Cantinas", nome: "Operação", ordem: 0, subs: [] }],
      cards: [
        { id: "1", sector: "Cantinas", columnId: "a", dimensaoId: "d1" },
        { id: "2", sector: "Cantinas", columnId: "a" },
      ],
      entregues: ENT_VAZIO,
    });
    return demandasDaArvore(a).length === 2;
  })(),
);

console.log(falhas === 0 ? "\ndimensoes: ok" : `\ndimensoes: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
