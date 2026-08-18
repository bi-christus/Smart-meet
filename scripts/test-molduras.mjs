/**
 * Testes da moldura do avatar.
 *
 * TRÊS CÓPIAS DA MESMA DECISÃO existem neste projeto, e este arquivo é o que as
 * impede de se afastarem:
 *
 *  1. `src/lib/molduras-core.ts` — o catálogo e as réguas, em TypeScript.
 *  2. `src/components/avatar.module.css` — a pintura de cada id, em CSS.
 *  3. `firestore.rules` — o teto e o alfabeto, em CEL.
 *
 * Nenhum outro portão do projeto liga as três. `check-css-modules.mjs` não
 * serve: a decisão 4 do cabeçalho dele ignora leitura dinâmica de propósito, e
 * seletor de ATRIBUTO (`[data-moldura="mar"]`) não é leitura de classe. O `tsc`
 * não lê CSS nem CEL. O resultado de uma divergência é mudo — a pessoa escolhe
 * uma moldura, o avatar não muda, e não há erro em lugar nenhum.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ALFABETO_MOLDURA,
  LIMIAR_DETALHE_PX,
  LIMITE_MOLDURA_CHARS,
  MOLDURAS,
  MOLDURA_MIN_PX,
  MOLDURA_PADRAO,
  espessuraDoAnel,
  molduraDe,
  molduraPorId,
  normalizarMoldura,
} from "../src/lib/molduras-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pintadas = MOLDURAS.filter((m) => m.id !== "nenhuma");

console.log("\n— o catálogo —");

checa("`nenhuma` é o padrão", MOLDURA_PADRAO === "nenhuma");
checa("`nenhuma` é a primeira do catálogo", MOLDURAS[0].id === "nenhuma");

const ids = MOLDURAS.map((m) => m.id);
checa("nenhum id repetido", new Set(ids).size === ids.length);
checa(
  "todo id passa pelo alfabeto da regra",
  ids.every((i) => ALFABETO_MOLDURA.test(i)),
  ids.filter((i) => !ALFABETO_MOLDURA.test(i)).join(", "),
);
checa(
  "todo id cabe no teto de caracteres",
  ids.every((i) => i.length <= LIMITE_MOLDURA_CHARS),
);

const nomes = MOLDURAS.map((m) => m.nome);
checa("nenhum nome repetido", new Set(nomes).size === nomes.length);
checa("nenhum nome vazio", nomes.every((n) => n.trim().length > 0));
// Nome de 40 caracteres quebra a grade do seletor em silêncio: a célula estica,
// as vizinhas encolhem, e ninguém associa o defeito ao catálogo.
checa(
  "nenhum nome passa de 16 caracteres",
  nomes.every((n) => n.length <= 16),
  nomes.filter((n) => n.length > 16).join(", "),
);
checa("toda moldura tem resumo", MOLDURAS.every((m) => m.resumo.trim().length > 0));

/**
 * A asserção que impede o catálogo de virar uma opção só.
 *
 * Abaixo de `LIMIAR_DETALHE_PX` toda moldura vira cor sólida — e o avatar
 * aparece em 22, 26 e 30 px na maioria esmagadora das vezes. Se duas molduras
 * simplificassem para o mesmo token, elas seriam LITERALMENTE indistinguíveis
 * nas telas em que mais aparecem, e a escolha da pessoa não faria nada.
 */
const tintas = pintadas.map((m) => m.tintaSimples);
checa(
  "as tintas simplificadas são todas DISTINTAS entre si",
  new Set(tintas).size === tintas.length,
  tintas.join(", "),
);

checa("`molduraPorId` acha o que existe", molduraPorId("aurora")?.nome === "Aurora");
checa("`molduraPorId` devolve undefined para o que não existe", molduraPorId("zzz") === undefined);

console.log("\n— `normalizarMoldura`: o portão da leitura —");

/**
 * É ESTE BLOCO que permite a regra do Firestore ser frouxa. Ele prova que nada
 * fora do catálogo chega ao `data-moldura` — e portanto que o pior caso de um
 * id desconhecido no banco é um anel que não pinta.
 */
const LIXO = [
  null,
  undefined,
  "",
  "   ",
  "xpto",
  "url(https://x/y.png)",
  "; background: red",
  "<script>alert(1)</script>",
  "a".repeat(500),
  7,
  {},
  [],
  true,
];
for (const v of LIXO) {
  checa(
    `\`${String(v).slice(0, 24)}\` vira "nenhuma"`,
    normalizarMoldura(v) === "nenhuma",
    String(normalizarMoldura(v)),
  );
}
checa("id válido sobrevive", normalizarMoldura("aurora") === "aurora");
checa("espaço e maiúscula são tolerados na leitura", normalizarMoldura("  Aurora ") === "aurora");
checa(
  "todo id do catálogo sobrevive à normalização",
  ids.every((i) => normalizarMoldura(i) === i),
);
checa(
  "a saída é SEMPRE um id do catálogo",
  [...LIXO, "aurora", "  MARCA  "].every((v) => ids.includes(normalizarMoldura(v))),
);

console.log("\n— `espessuraDoAnel`: os 12 tamanhos reais —");

/**
 * Os tamanhos em que `<Avatar>` é realmente chamado neste app, com a origem
 * escrita ao lado. A lista não é hipótese: foi levantada dos 13 pontos de
 * chamada. Ela existe aqui porque a espessura errar nos extremos é o defeito
 * que só aparece na tela certa.
 */
const REAIS = [
  [16, "cronograma/page.tsx (chip)"],
  [17, "cronograma/page.tsx (chip)"],
  [18, "admin/page.tsx (permissões)"],
  [22, "kanban/page.tsx (card)"],
  [26, "card-modal.tsx (autor)"],
  [30, "layout.tsx (topbar)"],
  [38, "admin/page.tsx (lista)"],
  [52, "rank/page.tsx (honra)"],
  [60, "layout.tsx (acesso pendente)"],
  [88, "rank/page.tsx (pódio)"],
  [96, "perfil-modal.tsx (retrato)"],
  [112, "rank/page.tsx (1º lugar)"],
];

const ESPERADO = {
  20: 1.5,
  22: 1.5,
  26: 2,
  30: 2,
  38: 2.5,
  52: 3.5,
  60: 4,
  88: 6,
  96: 6.5,
  112: 8,
};
for (const [px, esperado] of Object.entries(ESPERADO)) {
  checa(
    `${px}px → anel de ${esperado}px`,
    espessuraDoAnel(Number(px)) === esperado,
    String(espessuraDoAnel(Number(px))),
  );
}

// As DUAS pontas, que é o que uma trava de um lado só erraria.
for (const [px] of REAIS) {
  if (px < MOLDURA_MIN_PX) continue;
  const a = espessuraDoAnel(px);
  checa(`${px}px: o anel não fica abaixo de 1,5px`, a >= 1.5, String(a));
  checa(`${px}px: o anel não passa de 8% do diâmetro`, a <= px * 0.08 + 0.001, String(a));
}

let anterior = 0;
for (let px = MOLDURA_MIN_PX; px <= 160; px++) {
  const a = espessuraDoAnel(px);
  if (a < anterior) {
    checa(`monotônica em ${px}px`, false, `${anterior} → ${a}`);
    break;
  }
  anterior = a;
}
checa("a espessura nunca diminui quando o avatar cresce", true);
checa(
  "a espessura é sempre múltipla de meio pixel",
  REAIS.every(([px]) => (espessuraDoAnel(px) * 2) % 1 === 0),
);

console.log("\n— `molduraDe`: o contrato de custo zero —");

const comMoldura = { moldura: "aurora" };

/**
 * `null` E NÃO UM OBJETO VAZIO. Virado asserção porque a diferença é de CUSTO:
 * `<Avatar>` aparece dezenas de vezes por quadro do Kanban, e um objeto sempre
 * presente faria o componente montar um `<span>` a mais em volta de cada rosto
 * da tela para não pintar coisa nenhuma.
 */
checa("pessoa null devolve null", molduraDe(null, 96) === null);
checa("pessoa undefined devolve null", molduraDe(undefined, 96) === null);
checa("pessoa sem o campo devolve null", molduraDe({}, 96) === null);
checa('"nenhuma" devolve null', molduraDe({ moldura: "nenhuma" }, 96) === null);
checa("id desconhecido devolve null", molduraDe({ moldura: "zzz" }, 96) === null);
checa("moldura null devolve null", molduraDe({ moldura: null }, 96) === null);

// Os três chips pequenos do app: 1,5px em 16px é 9,4% do diâmetro, e tapa o
// rosto que o avatar existe para mostrar.
for (const px of [16, 17, 18]) {
  checa(`${px}px não recebe moldura nenhuma`, molduraDe(comMoldura, px) === null);
}
checa(
  `${MOLDURA_MIN_PX}px (o mínimo) JÁ recebe`,
  molduraDe(comMoldura, MOLDURA_MIN_PX) !== null,
);
checa("tamanho inválido devolve null", molduraDe(comMoldura, NaN) === null);

console.log("\n— o nível de detalhe —");

for (const px of [22, 26, 30]) {
  checa(`${px}px simplifica`, molduraDe(comMoldura, px)?.detalhe === "simples");
}
for (const px of [38, 52, 60, 88, 96, 112]) {
  checa(`${px}px desenha cheio`, molduraDe(comMoldura, px)?.detalhe === "cheio");
}
checa(
  `${LIMIAR_DETALHE_PX}px (o limiar) já é cheio`,
  molduraDe(comMoldura, LIMIAR_DETALHE_PX)?.detalhe === "cheio",
);
checa(
  `${LIMIAR_DETALHE_PX - 1}px ainda simplifica`,
  molduraDe(comMoldura, LIMIAR_DETALHE_PX - 1)?.detalhe === "simples",
);

console.log("\n— catálogo × folha de estilo —");

const css = readFileSync(join(raiz, "src/components/avatar.module.css"), "utf8");

for (const m of pintadas) {
  checa(
    `\`${m.id}\` tem regra cheia na folha`,
    css.includes(`.moldura[data-moldura="${m.id}"]`),
  );
  checa(
    `\`${m.id}\` tem regra simplificada na folha`,
    css.includes(`.moldura[data-detalhe="simples"][data-moldura="${m.id}"]`),
  );
  // O token da variante simplificada TEM de ser o que o catálogo declara: é o
  // que garante que as cinco continuem distinguíveis em 22px.
  const bloco = css.slice(
    css.indexOf(`.moldura[data-detalhe="simples"][data-moldura="${m.id}"]`),
  );
  const corpo = bloco.slice(0, bloco.indexOf("}"));
  checa(
    `\`${m.id}\` simplifica para \`var(${m.tintaSimples})\`, como o catálogo diz`,
    corpo.includes(`var(${m.tintaSimples})`),
    corpo.replace(/\s+/g, " ").slice(0, 90),
  );
}

// Regra órfã: um id que a folha pinta e o catálogo não conhece é uma moldura
// que ninguém consegue escolher — e a próxima pessoa perde tempo procurando
// onde ela é oferecida.
const naFolha = [...css.matchAll(/\.moldura\[data-moldura="([a-z0-9-]+)"\]/g)].map(
  (m) => m[1],
);
const orfas = [...new Set(naFolha)].filter((i) => !ids.includes(i));
checa("nenhuma regra `data-moldura` órfã na folha", orfas.length === 0, orfas.join(", "));

/**
 * NADA ANIMA — a decisão do cabeçalho de `molduras-core`, virada portão.
 *
 * Uma moldura que gira não é disparada por gesto: ela roda para sempre, e
 * quarenta pessoas podem ligar a sua na tela em que se trabalha o dia inteiro.
 */
const blocoMoldura = css.slice(css.indexOf(".moldura {"));
checa(
  "nenhuma regra de moldura tem `animation`",
  !/\.moldura[^{]*\{[^}]*animation/s.test(blocoMoldura),
);
checa(
  "nenhuma regra de moldura tem `transition`",
  !/\.moldura[^{]*\{[^}]*transition/s.test(blocoMoldura),
);

console.log("\n— catálogo × regra do Firestore —");

const rules = readFileSync(join(raiz, "firestore.rules"), "utf8");

checa("`molduraOk()` existe na regra", rules.includes("function molduraOk()"));

const teto = /m\.size\(\)\s*<=\s*(\d+)/.exec(rules.slice(rules.indexOf("function molduraOk()")));
checa(
  `o teto da regra é ${LIMITE_MOLDURA_CHARS}, o mesmo do módulo`,
  teto && Number(teto[1]) === LIMITE_MOLDURA_CHARS,
  teto ? teto[1] : "não achei",
);

const alfabeto = /m\.matches\('([^']+)'\)/.exec(rules.slice(rules.indexOf("function molduraOk()")));
checa(
  "a regex da regra é a mesma do módulo",
  alfabeto && alfabeto[1] === ALFABETO_MOLDURA.source,
  alfabeto ? `${alfabeto[1]} vs ${ALFABETO_MOLDURA.source}` : "não achei",
);

// As duas cópias precisam dar o MESMO veredito sobre a mesma bateria — não
// basta o texto ser igual, porque `matches` do CEL ancora diferente de `test`.
if (alfabeto) {
  const daRegra = new RegExp(alfabeto[1]);
  const BATERIA = ["aurora", "mar", "a-b-c", "Aurora", "a b", "url(x)", "1abc", "", "á"];
  checa(
    "as duas regex concordam sobre toda a bateria",
    BATERIA.every((t) => daRegra.test(t) === ALFABETO_MOLDURA.test(t)),
    BATERIA.filter((t) => daRegra.test(t) !== ALFABETO_MOLDURA.test(t)).join(", "),
  );
  checa("todo id do catálogo passa pela regex da regra", ids.every((i) => daRegra.test(i)));
}

// A lista do `hasOnly` do dono. `moldura` tem de estar lá — senão a gravação
// inteira do perfil é negada, porque nome, foto e moldura vão no MESMO
// `updateDoc` — e `role`/`active`/`sectors` têm de continuar de fora.
const hasOnly = /hasOnly\(\[([^\]]*)\]\)\)\);/.exec(rules);
checa("achei o `hasOnly` do dono em /users", !!hasOnly);
if (hasOnly) {
  const lista = hasOnly[1];
  checa("`moldura` entrou no hasOnly do dono", lista.includes("'moldura'"), lista);
  for (const proibido of ["role", "active", "sectors", "email", "cargo"]) {
    checa(`\`${proibido}\` continua FORA do hasOnly`, !lista.includes(`'${proibido}'`), lista);
  }
}
checa(
  "o update guarda `molduraOk()` por `mudou()`",
  rules.includes("!mudou(['moldura']) || molduraOk()"),
);
checa("o create confere `molduraOk()`", /allow create: if fotoOk\(\) && nomeOk\(\) && molduraOk\(\)/.test(rules));

console.log(falhas === 0 ? "\nmolduras: ok" : `\nmolduras: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
