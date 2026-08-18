/**
 * Testes do ícone do card de link.
 *
 * Esta frente erra de um jeito que NENHUM outro portão deste projeto pega, e é
 * por isso que o arquivo é mais longo do que a regra parece merecer:
 *
 *  - Nome de ícone que não tem desenho em `icons.tsx` sai como um `<svg>` VAZIO.
 *    Não é erro de tipo (o catálogo é `string`), não é classe de CSS Module
 *    faltando (`check-css-modules.mjs` não olha para isto), não é `composes`
 *    quebrado. Passa por `lint`, por `tsc`, pelo `next build` e pelo checador de
 *    CSS, e chega à produção como um quadrado em branco no lugar do selo.
 *  - `aplicarIcone` com `icone: undefined` compila e explode em tempo de
 *    execução, porque o SDK do Firestore recusa `undefined` em `updateDoc`.
 *    Só um teste que olhe a FORMA do objeto pega isso.
 *  - `ehIconeDeLink` escrito com objeto literal responde `true` para
 *    `"constructor"`. O valor vem do banco.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  COLUNAS_DA_GRADE,
  GRUPOS_DE_ICONE,
  ICONES_DE_LINK,
  aplicarIcone,
  ehIconeDeLink,
  iconeDoLink,
  iconePorNome,
  proximoIndiceNaGrade,
} from "../src/lib/icones-core.ts";
import { servicoDe } from "../src/lib/links-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const link = (extra = {}) => ({
  id: "a1",
  url: "https://exemplo.com/x",
  addedBy: "quem@px.com.br",
  addedAt: 1,
  ...extra,
});

console.log("\n— o catálogo —");

checa(
  `tem ${GRUPOS_DE_ICONE.length} grupos, todos com ${COLUNAS_DA_GRADE} entradas`,
  GRUPOS_DE_ICONE.every(
    (g) => ICONES_DE_LINK.filter((i) => i.grupo === g).length === COLUNAS_DA_GRADE,
  ),
  GRUPOS_DE_ICONE.map(
    (g) => `${g}=${ICONES_DE_LINK.filter((i) => i.grupo === g).length}`,
  ).join(" "),
);

const nomes = ICONES_DE_LINK.map((i) => i.nome);
checa(
  "nenhum nome repetido",
  new Set(nomes).size === nomes.length,
  nomes.filter((n, i) => nomes.indexOf(n) !== i).join(", "),
);
const rotulos = ICONES_DE_LINK.map((i) => i.rotulo);
checa(
  "nenhum rótulo repetido",
  new Set(rotulos).size === rotulos.length,
  rotulos.filter((r, i) => rotulos.indexOf(r) !== i).join(", "),
);
checa(
  "as entradas aparecem agrupadas, na ordem dos grupos",
  ICONES_DE_LINK.every(
    (ic, i) =>
      i === 0 ||
      GRUPOS_DE_ICONE.indexOf(ic.grupo) >=
        GRUPOS_DE_ICONE.indexOf(ICONES_DE_LINK[i - 1].grupo),
  ),
);
checa("`iconePorNome` acha o que está no catálogo", iconePorNome(nomes[0])?.nome === nomes[0]);
checa("`iconePorNome` devolve undefined para o que não está", iconePorNome("xpto") === undefined);

console.log("\n— catálogo × desenho: o guarda do quadrado em branco —");

/**
 * `icons.tsx` é lido como TEXTO, de propósito: ele tem JSX, e o strip de tipos
 * do Node não processa JSX — um `import` daqui falharia na hora.
 */
const iconsTsx = readFileSync(join(raiz, "src/components/icons.tsx"), "utf8");

for (const n of nomes) {
  // A chave do objeto `PATHS`, no começo da linha e seguida de dois-pontos. Um
  // `includes(n)` cru casaria com o nome dentro de um comentário.
  const temDesenho = new RegExp(`^\\s{2}${n}:`, "m").test(iconsTsx);
  checa(`\`${n}\` tem desenho em icons.tsx`, temDesenho);
}

/**
 * Dois ícones do catálogo não podem desenhar a mesma coisa.
 *
 * O repositório já tem três pares idênticos por acidente — `admin`/`shield`,
 * `cronograma`/`calendar` e (quase) `dashboard`/`trend`. Num menu de navegação
 * isso é inofensivo: os dois nunca aparecem lado a lado. Numa grade de trinta
 * células é pedir à pessoa que escolha entre gêmeos.
 */
function desenhoDe(nome) {
  const i = iconsTsx.search(new RegExp(`^\\s{2}${nome}:`, "m"));
  if (i < 0) return null;
  // Até a próxima chave do objeto (duas colunas de recuo, nome, dois-pontos).
  const resto = iconsTsx.slice(i + 2);
  const fim = resto.search(/^\s{2}[a-zA-Z]+:/m);
  const bloco = fim < 0 ? resto : resto.slice(0, fim);
  const ds = [...bloco.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  const outros = [...bloco.matchAll(/<(rect|circle|ellipse)\b([^/>]*)/g)].map(
    (m) => `${m[1]}${m[2].replace(/\s+/g, " ").trim()}`,
  );
  return [...ds, ...outros].sort().join("|");
}

const porDesenho = new Map();
for (const n of nomes) {
  const d = desenhoDe(n);
  checa(`\`${n}\` tem traçado legível`, !!d);
  if (!d) continue;
  porDesenho.set(d, [...(porDesenho.get(d) ?? []), n]);
}
const gemeos = [...porDesenho.values()].filter((v) => v.length > 1);
checa(
  "nenhum par do catálogo desenha a mesma coisa",
  gemeos.length === 0,
  gemeos.map((g) => g.join(" = ")).join(" · "),
);

console.log("\n— `ehIconeDeLink`: Set, e não índice em objeto literal —");

checa("aceita todo nome do catálogo", nomes.every((n) => ehIconeDeLink(n)));
checa("recusa vazio", !ehIconeDeLink(""));
checa("recusa lixo", !ehIconeDeLink("nao-existe"));
checa("recusa null e undefined", !ehIconeDeLink(null) && !ehIconeDeLink(undefined));
checa("recusa número", !ehIconeDeLink(7));
// Estes três são o teste inteiro: um `CATALOGO[n] !== undefined` passa em todos
// os de cima e falha aqui, devolvendo uma FUNÇÃO herdada de Object.prototype.
for (const herdado of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
  checa(`recusa \`${herdado}\` (herdado de Object.prototype)`, !ehIconeDeLink(herdado));
}

console.log("\n— `iconeDoLink`: escolha → dedução → monograma —");

checa(
  "escolha válida vence a dedução",
  iconeDoLink(link({ url: "https://docs.google.com/document/d/1", icone: "estrela" })) ===
    "estrela",
);
checa(
  "escolha DESCONHECIDA cai na dedução, nunca embranquece",
  iconeDoLink(link({ url: "https://docs.google.com/document/d/1", icone: "que-nao-existe" })) ===
    "relatorios",
);
checa(
  "escolha desconhecida em domínio genérico devolve null (monograma)",
  iconeDoLink(link({ url: "https://intranet.christus.com.br/x", icone: "zzz" })) === null,
);
checa(
  "sem escolha, domínio genérico devolve null",
  iconeDoLink(link({ url: "https://intranet.christus.com.br/x" })) === null,
);
checa(
  "escolha válida vale mesmo em domínio genérico",
  iconeDoLink(link({ url: "https://intranet.christus.com.br/x", icone: "banco" })) === "banco",
);

/** Um endereço por serviço reconhecido — o mapa deduzido, ponta a ponta. */
const AMOSTRAS = {
  drive: "https://drive.google.com/drive/folders/1",
  docs: "https://docs.google.com/document/d/1",
  sheets: "https://docs.google.com/spreadsheets/d/1",
  slides: "https://docs.google.com/presentation/d/1",
  forms: "https://docs.google.com/forms/d/1",
  looker: "https://lookerstudio.google.com/reporting/1",
  powerbi: "https://app.powerbi.com/view?r=1",
  youtube: "https://youtube.com/watch?v=1",
  meet: "https://meet.google.com/abc-defg-hij",
  calendar: "https://calendar.google.com/calendar/u/0",
  github: "https://github.com/bi-christus/Smart-meet",
  figma: "https://figma.com/file/1",
  notion: "https://notion.so/pagina",
  trello: "https://trello.com/b/1",
  whatsapp: "https://wa.me/5585999999999",
  pdf: "https://exemplo.com/manual.pdf",
  planilha: "https://exemplo.com/base.xlsx",
  generico: "https://intranet.christus.com.br/x",
};

for (const [servico, url] of Object.entries(AMOSTRAS)) {
  checa(
    `a amostra de \`${servico}\` é mesmo desse serviço`,
    servicoDe(url) === servico,
    `deu ${servicoDe(url)}`,
  );
  const deduzido = iconeDoLink(link({ url }));
  if (servico === "generico") {
    checa("`generico` deduz null (monograma)", deduzido === null);
  } else {
    // Sem isto existiria um padrão que a pessoa VÊ e não consegue reescolher:
    // ela troca o ícone, se arrepende, e o "Automático" devolve um desenho que
    // não está na grade.
    checa(
      `\`${servico}\` deduz \`${deduzido}\`, e ele está no catálogo oferecido`,
      typeof deduzido === "string" && ehIconeDeLink(deduzido),
    );
  }
}

console.log("\n— `aplicarIcone` —");

const lista = [
  link({ id: "a", url: "https://a.com" }),
  link({ id: "b", url: "https://b.com", title: "Bê", icone: "banco" }),
  link({ id: "c", url: "https://c.com" }),
];

checa("id inexistente devolve null", aplicarIcone(lista, "zzz", "estrela") === null);
checa("nome fora do catálogo devolve null", aplicarIcone(lista, "a", "xpto") === null);
checa("valor já igual devolve null", aplicarIcone(lista, "b", "banco") === null);
checa(
  "voltar ao automático quem já é automático devolve null",
  aplicarIcone(lista, "a", null) === null,
);

const trocado = aplicarIcone(lista, "a", "estrela");
checa("troca devolve lista nova", Array.isArray(trocado) && trocado !== lista);
checa("a lista original não é tocada", lista[0].icone === undefined);
checa("o alvo recebeu o ícone", trocado[0].icone === "estrela");
checa(
  "os outros links ficaram idênticos, por referência",
  trocado[1] === lista[1] && trocado[2] === lista[2],
);
checa(
  "a ordem e o tamanho não mudam",
  trocado.length === 3 && trocado.map((l) => l.id).join("") === "abc",
);
checa(
  "todos os outros campos do alvo sobrevivem",
  trocado[0].url === "https://a.com" &&
    trocado[0].addedBy === "quem@px.com.br" &&
    trocado[0].addedAt === 1,
);

const limpo = aplicarIcone(lista, "b", null);
checa("voltar ao automático devolve lista nova", Array.isArray(limpo));
// As DUAS asserções, e não só a primeira: `{...l, icone: undefined}` passa no
// `=== undefined` e é exatamente a forma que o `updateDoc` recusa com
// "Unsupported field value: undefined".
checa("a chave `icone` SOME do objeto", !("icone" in limpo[1]));
checa(
  "e não sobra como undefined em lugar nenhum do JSON",
  !JSON.stringify(limpo).includes("icone"),
);
checa("o título e o resto do link sobrevivem à limpeza", limpo[1].title === "Bê");
checa(
  "nenhum campo do resultado é undefined",
  limpo.every((l) => Object.values(l).every((v) => v !== undefined)),
);

console.log("\n— `proximoIndiceNaGrade`: -1 é o “Automático”, não “nenhum” —");

const T = ICONES_DE_LINK.length;
const C = COLUNAS_DA_GRADE;
const p = (a, k) => proximoIndiceNaGrade(a, k, C, T);

checa("ArrowDown de -1 entra na grade em 0", p(-1, "ArrowDown") === 0);
checa("ArrowUp da primeira linha volta ao Automático", p(0, "ArrowUp") === -1);
checa("ArrowUp de -1 fica em -1", p(-1, "ArrowUp") === -1);
checa("ArrowDown anda uma linha", p(0, "ArrowDown") === C);
checa("ArrowUp anda uma linha", p(C, "ArrowUp") === 0);
checa(
  "ArrowUp da segunda linha não pula para o Automático",
  p(C + 2, "ArrowUp") === 2,
);
checa("ArrowRight anda uma coluna", p(0, "ArrowRight") === 1);
checa("ArrowLeft anda uma coluna", p(1, "ArrowLeft") === 0);
checa("ArrowLeft da primeira célula trava (não sai pelo lado)", p(0, "ArrowLeft") === 0);
checa("ArrowLeft de -1 fica em -1", p(-1, "ArrowLeft") === -1);
checa("ArrowRight de -1 entra na grade em 0", p(-1, "ArrowRight") === 0);
checa("ArrowRight na última célula trava", p(T - 1, "ArrowRight") === T - 1);
checa(
  "ArrowDown na última linha trava (não circula)",
  p(T - 1, "ArrowDown") === T - 1,
);
checa("Home leva ao Automático de qualquer lugar", p(T - 1, "Home") === -1 && p(3, "Home") === -1);
checa("End leva à última célula", p(-1, "End") === T - 1 && p(0, "End") === T - 1);
checa("tecla desconhecida não move", p(5, "a") === 5 && p(-1, "Tab") === -1);
checa("índice fora da lista é preso antes de andar", p(999, "ArrowRight") === T - 1);
checa("índice abaixo de -1 é preso em -1", p(-99, "ArrowUp") === -1);
checa(
  "grade vazia não estoura",
  proximoIndiceNaGrade(0, "ArrowDown", C, 0) === -1,
);

console.log(
  falhas === 0 ? "\nícones de link: ok" : `\nícones de link: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
