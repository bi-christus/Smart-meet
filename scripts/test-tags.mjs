/**
 * Testes da higiene e do filtro de tags (`lib/tags-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar o quadro não prova: que duas grafias da
 * mesma tag são reconhecidas como uma só. O erro aqui não tem sintoma — o
 * catálogo simplesmente ganha uma entrada a mais, o filtro por ela encontra
 * metade das demandas, e ninguém descobre porque não existe tela que mostre
 * "estas duas tags deveriam ser a mesma". É o tipo de defeito que só um teste
 * pega antes, porque depois ele já virou dado.
 *
 * A outra metade é sobre o CONTRÁRIO: que o app não funda o que não deve. Achar
 * semelhança demais é pior do que achar de menos — um aviso que aparece toda
 * vez ensina a ignorar o aviso, e aí ele não serve nem quando está certo.
 */
import {
  LIMITE_TAG_CHARS,
  cardTemTag,
  casaComTag,
  catalogoDeTags,
  chaveDeTag,
  conferirTag,
  distancia,
  filtrarPorTags,
  niveisDaTag,
  normalizarTag,
  parecidas,
  semAcento,
  VOCABULARIO_MIN_USO,
  VOCABULARIO_TETO,
  vocabularioDeTags,
} from "../src/lib/tags-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— a grafia que vai para o banco —");

checa("tira o # da frente", normalizarTag("#Portal") === "Portal");
checa("tira vários # e o espaço junto", normalizarTag("  ##  Portal ") === "Portal");
checa("colapsa espaço do meio", normalizarTag("Portal   do  aluno") === "Portal do aluno");
checa(
  "preserva maiúscula e acento — é o que se lê no card",
  normalizarTag(" Manutenção Preventiva ") === "Manutenção Preventiva",
);
checa(
  "encosta a barra nos dois lados: ela é hierarquia, não pontuação",
  normalizarTag("cantinas / estoque") === "cantinas/estoque",
);
checa("corta no teto", normalizarTag("x".repeat(80)).length === LIMITE_TAG_CHARS);
checa("null e número não explodem", normalizarTag(null) === "" && normalizarTag(7) === "7");
checa("sem acento é o de sempre", semAcento("Manutenção") === "manutencao");

console.log("\n— a identidade: duas grafias, uma tag —");

const mesmas = [
  ["Portal", "portal"],
  ["Portal", "  #PORTAL  "],
  ["Manutenção", "manutencao"],
  ["portal-do-aluno", "Portal do Aluno"],
  ["portal_do_aluno", "portal do aluno"],
];
mesmas.forEach(([a, b]) =>
  checa(`"${a}" e "${b}" são a mesma tag`, chaveDeTag(a) === chaveDeTag(b), `${chaveDeTag(a)} vs ${chaveDeTag(b)}`),
);

// O que NÃO pode empatar. Cada um destes já apareceu em cadastro de verdade.
const diferentes = [
  ["Processo", "Processos", "plural é decisão de quem cadastra, não do app"],
  ["cantinas/estoque", "cantinas estoque", "a barra separa hierarquia; o espaço, não"],
  ["RH", "TI", "duas letras, duas coisas"],
];
diferentes.forEach(([a, b, por]) =>
  checa(`"${a}" ≠ "${b}" — ${por}`, chaveDeTag(a) !== chaveDeTag(b)),
);

console.log("\n— hierarquia —");

checa("níveis saem separados", niveisDaTag("Cantinas/Estoque/Frios").join("|") === "cantinas|estoque|frios");
checa("a mãe casa com a filha", casaComTag("cantinas/estoque", "cantinas"));
checa("a mãe casa com a neta", casaComTag("cantinas/estoque/frios", "Cantinas"));
checa("a filha NÃO casa com a mãe", !casaComTag("cantinas", "cantinas/estoque"));
checa("irmãs não casam", !casaComTag("cantinas/estoque", "cantinas/compras"));
// Sem o corte na barra, isto traria o quadro inteiro.
checa("prefixo de texto não é prefixo de hierarquia", !casaComTag("cantinas", "cant"));
checa("filtro vazio não casa com nada", !casaComTag("cantinas", "  "));

console.log("\n— o catálogo do quadro —");

const cards = [
  { tags: ["Portal do aluno", "Cantinas/Estoque"] },
  { tags: ["Portal do aluno"] },
  { tags: ["portal do Aluno"] },
  { tags: ["Cantinas/Compras"] },
  { tags: ["Cantinas", "Cantinas/Estoque"] },
  { tags: [] },
  { tags: null },
  { tags: ["  #  "] },
];
const cat = catalogoDeTags(cards);
const acha = (t) => cat.find((x) => chaveDeTag(x.tag) === chaveDeTag(t));

checa(
  "a grafia que sobrevive é a mais usada, não a primeira",
  acha("portal do aluno").tag === "Portal do aluno",
  acha("portal do aluno").tag,
);
checa("as três grafias contam como uma tag só", acha("portal do aluno").n === 3, String(acha("portal do aluno").n));
checa(
  "a mãe existe no catálogo mesmo quase ninguém a digitando sozinha",
  !!acha("cantinas"),
);
// A mãe inferida herda a grafia da filha. Sem isso o nome dela sairia da CHAVE
// — minúscula e sem acento — e a barra mostraria "cantinas" ao lado de
// "Cantinas/Estoque", como se fossem duas famílias diferentes.
const soFilhas = catalogoDeTags([
  { tags: ["Manutenção/Elétrica"] },
  { tags: ["Manutenção/Hidráulica"] },
]);
checa(
  "mãe que ninguém digitou herda a grafia da filha, com acento e maiúscula",
  soFilhas.find((x) => x.nivel === 0)?.tag === "Manutenção",
  soFilhas.map((x) => x.tag).join("|"),
);
// E a grafia PRÓPRIA ganha da herdada: quem digitou a mãe solta decidiu.
const comMae = catalogoDeTags([
  { tags: ["cantinas"] },
  { tags: ["cantinas"] },
  { tags: ["Cantinas/Estoque"] },
]);
checa(
  "grafia própria da mãe ganha da herdada da filha",
  comMae.find((x) => x.nivel === 0)?.tag === "cantinas",
  comMae.map((x) => x.tag).join("|"),
);
checa(
  "e a contagem da mãe inclui as filhas, sem contar o mesmo card duas vezes",
  acha("cantinas").n === 3,
  String(acha("cantinas").n),
);
checa("a filha conta só o que é dela", acha("cantinas/estoque").n === 2, String(acha("cantinas/estoque").n));
checa("o nível vem junto", acha("cantinas").nivel === 0 && acha("cantinas/estoque").nivel === 1);
checa("tag que é só pontuação não entra", !cat.some((x) => !chaveDeTag(x.tag)));
// "Cantinas" e "Portal do aluno" empatam em 3; o desempate é alfabético, e é
// isso que faz a barra de chips ficar parada entre dois snapshots do Firestore.
checa(
  "ordena por uso, e o empate pelo nome",
  cat.map((x) => `${x.tag}:${x.n}`).join(", ") ===
    "Cantinas:3, Portal do aluno:3, Cantinas/Estoque:2, Cantinas/Compras:1",
  cat.map((x) => `${x.tag}:${x.n}`).join(", "),
);
checa("lista vazia devolve catálogo vazio", catalogoDeTags([]).length === 0);

console.log("\n— distância de edição —");

checa("igual é zero", distancia("portal", "portal") === 0);
checa("uma letra trocada é 1", distancia("portal", "portao") === 1);
checa("tamanho muito diferente estoura o teto sem calcular", distancia("rh", "levantamento", 3) === 4);
checa("o teto trunca em vez de crescer", distancia("abcdefgh", "zyxwvuts", 2) === 3);

console.log("\n— tag parecida: avisar sem decidir —");

const catalogo = [
  "Portal do aluno",
  "Processos",
  "Manutenção",
  "Cantinas/Estoque",
  "Cantinas/Compras",
  "RH",
];

checa(
  "plural é apontado",
  parecidas("Processo", catalogo).includes("Processos"),
  parecidas("Processo", catalogo).join("|"),
);
checa(
  "erro de digitação é apontado",
  parecidas("Manutencão", catalogo).includes("Manutenção"),
);
checa(
  "hífen contra espaço é EMPATE, e vem primeiro",
  parecidas("portal-do-aluno", catalogo)[0] === "Portal do aluno",
);
// Achar demais é o defeito que desliga o aviso na cabeça de quem usa.
checa(
  "irmãs de hierarquia não são 'parecidas' — a barra foi a pessoa que pôs",
  !parecidas("Cantinas/Estoque", catalogo).includes("Cantinas/Compras"),
  parecidas("Cantinas/Estoque", catalogo).join("|"),
);
checa("duas letras não se parecem com nada", parecidas("TI", catalogo).length === 0);
checa("tag nova de verdade não gera aviso", parecidas("Orçamento 2027", catalogo).length === 0);
checa("catálogo vazio não gera aviso", parecidas("Portal", []).length === 0);

console.log("\n— a régua do campo —");

const vazia = conferirTag("  ");
checa("vazia é recusada com motivo", !vazia.ok && !!vazia.motivo);
const soPonto = conferirTag("###");
checa("só pontuação é recusada", !soPonto.ok, JSON.stringify(soPonto));

const empate = conferirTag("PORTAL DO ALUNO", catalogo);
checa("empate devolve a grafia que já existe", empate.ok && empate.mesma === "Portal do aluno");
checa(
  "e o empate NÃO aparece de novo na lista de parecidas",
  empate.ok && !empate.parecidas.includes("Portal do aluno"),
);

const parecida = conferirTag("Processo", catalogo);
checa(
  "parecida passa (não é recusa) e avisa",
  parecida.ok && !parecida.mesma && parecida.parecidas.includes("Processos"),
);

const nova = conferirTag("#  Orçamento 2027 ", catalogo);
checa("a normalizada é a que sai", nova.ok && nova.tag === "Orçamento 2027", JSON.stringify(nova));

console.log("\n— filtrar e destacar —");

const quadro = [
  { id: "a", tags: ["Cantinas/Estoque"] },
  { id: "b", tags: ["Cantinas"] },
  { id: "c", tags: ["Portal do aluno", "cantinas/compras"] },
  { id: "d", tags: [] },
  { id: "e", tags: ["portal do aluno"] },
];
const ids = (l) => l.map((c) => c.id).join("");

checa("sem nada marcado, o filtro está desligado", ids(filtrarPorTags(quadro, [])) === "abcde");
checa(
  "a mãe traz as filhas",
  ids(filtrarPorTags(quadro, ["Cantinas"])) === "abc",
  ids(filtrarPorTags(quadro, ["Cantinas"])),
);
checa(
  "ou: as duas coisas",
  ids(filtrarPorTags(quadro, ["Cantinas/Estoque", "Portal do aluno"], "ou")) === "ace",
);
checa(
  "e: só a interseção",
  ids(filtrarPorTags(quadro, ["Cantinas", "Portal do aluno"], "e")) === "c",
);
checa(
  "a grafia do filtro não importa",
  ids(filtrarPorTags(quadro, ["  #PORTAL-DO-ALUNO "])) === "ce",
);
checa("o destaque responde igual ao filtro", cardTemTag(quadro[0], ["Cantinas"]) && !cardTemTag(quadro[3], ["Cantinas"]));
checa(
  "o filtro não altera a lista que recebeu",
  (() => {
    const antes = ids(quadro);
    filtrarPorTags(quadro, ["Cantinas"]);
    return ids(quadro) === antes;
  })(),
);

console.log("\n— o vocabulário que viaja para quem gera tag de fora —");

const quadroDeDois = [
  // Cantinas: "estoque" é a língua da casa; o resto é tag de uso único.
  { setor: "Cantinas", tags: ["Estoque", "orcamento-freezer-2026"] },
  { setor: "Cantinas", tags: ["estoque", "compras"] },
  { setor: "Cantinas", tags: ["Estoque"] },
  { setor: "Cantinas", tags: ["compras", "reforma-do-balcao-bloco-c"] },
  // B.I.: "estoque" NÃO existe aqui, e é isso que o teste do vazamento prova.
  { setor: "B.I.", tags: ["Power BI"] },
  { setor: "B.I.", tags: ["power bi", "dashboard"] },
  { setor: "B.I.", tags: ["dashboard"] },
  // Sem setor: existe no banco, não pertence a língua nenhuma.
  { setor: "", tags: ["orfa"] },
];

const vocab = vocabularioDeTags(quadroDeDois);
const nomes = (setor) => (vocab[setor] ?? []).map((t) => t.tag).join(",");

checa(
  "separa por setor: a língua de um quadro não é a do outro",
  Object.keys(vocab).sort().join(",") === "B.I.,Cantinas",
  Object.keys(vocab).join(","),
);
checa(
  "a tag de UM card só fica de fora — ela não liga nada",
  !nomes("Cantinas").includes("orcamento-freezer-2026") &&
    !nomes("Cantinas").includes("reforma-do-balcao-bloco-c"),
  nomes("Cantinas"),
);
checa(
  "sobra o que o setor repete, do mais usado para o menos",
  nomes("Cantinas") === "Estoque,compras",
  nomes("Cantinas"),
);
checa(
  "a grafia que viaja é a MAIS USADA, não a primeira encontrada",
  nomes("Cantinas").startsWith("Estoque"),
  nomes("Cantinas"),
);
checa(
  "tag de um setor não vaza para o outro",
  !nomes("B.I.").includes("Estoque") && !nomes("Cantinas").includes("Power BI"),
  `${nomes("B.I.")} | ${nomes("Cantinas")}`,
);
checa(
  "card sem setor não inventa um setor de nome vazio",
  !Object.prototype.hasOwnProperty.call(vocab, ""),
  Object.keys(vocab).join(","),
);
checa(
  "setor que só tem tag de uso único some, em vez de entrar vazio",
  !Object.prototype.hasOwnProperty.call(
    vocabularioDeTags([{ setor: "Zelador", tags: ["so-esta"] }]),
    "Zelador",
  ),
);
checa(
  "a mãe da hierarquia entra mesmo com as filhas de uso único",
  (() => {
    const v = vocabularioDeTags([
      { setor: "Infra", tags: ["rede/wifi-bloco-a"] },
      { setor: "Infra", tags: ["rede/switch-do-lab"] },
    ]);
    const t = (v["Infra"] ?? []).map((x) => x.tag);
    // `rede` conta 2 (as duas filhas) e sobrevive; cada filha conta 1 e sai.
    return t.length === 1 && t[0] === "rede";
  })(),
);
checa(
  "o teto corta a cauda, e corta pelo fim (o menos usado)",
  (() => {
    // `t0` aparece em 2 cards, `t29` em 31: a ordem por uso é conhecida.
    const cards = [];
    for (let i = 0; i < 30; i++)
      for (let k = 0; k < i + 2; k++) cards.push({ setor: "X", tags: [`t${i}`] });
    const v = vocabularioDeTags(cards, { teto: 5 });
    return (
      v["X"].length === 5 &&
      v["X"][0].tag === "t29" &&
      v["X"][4].tag === "t25"
    );
  })(),
);
checa(
  "o mínimo de uso é configurável — a regra é do chamador, não do módulo",
  (() => {
    const v = vocabularioDeTags(quadroDeDois, { minUso: 1 });
    return nomes2(v, "Cantinas").includes("orcamento-freezer-2026");
  })(),
);
checa(
  "os padrões estão declarados e são os que a Issue pediu",
  VOCABULARIO_MIN_USO === 2 && VOCABULARIO_TETO === 60,
);

function nomes2(v, setor) {
  return (v[setor] ?? []).map((t) => t.tag).join(",");
}

console.log(falhas === 0 ? "\ntags: ok" : `\ntags: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
