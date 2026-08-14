/**
 * Guarda as classes de CSS Module que o TSX lê. Roda no `prebuild`.
 *
 * A regra que ele protege: para cada arquivo que importa um `*.module.css`,
 * toda leitura `styles.X` tem de ter `.X` escrita naquela folha.
 *
 * Ele existe porque isto passa por TODOS os portões do projeto. CSS Modules
 * devolve `undefined` para chave inexistente; `className={undefined}` é JSX
 * válido; o tipo da folha é um índice de string, então `tsc` compila qualquer
 * chave; o `eslint` não conhece a folha; o `next build` resolve `composes` e
 * falha se o alvo sumir, mas não olha leitura; e o `prebuild` só testa módulo
 * puro, que não vê CSS. O elemento nasce sem estilo nenhum e a tela vai para
 * produção torta, calada. Foi assim que o painel "Demandas por setor
 * solicitante" foi ao ar com as faixas empilhadas na vertical (Issue #77): as
 * quatro classes que ele lia não existiam, e só olho humano na tela certa viu.
 *
 * Sete decisões deste arquivo que parecem detalhe e não são:
 *
 * 1. Os caminhos saem de `import.meta.url`, nunca do CWD — mesma razão do
 *    `check-demandas-boundary.mjs`: este é o portão do deploy e tem de dar o
 *    mesmo veredito rodando de qualquer diretório.
 * 2. Os arquivos entram por glob, não por lista literal, porque o risco real é
 *    uma TELA NOVA nascer lendo classe que não existe — e lista literal não vê
 *    o que ainda não foi escrito. Como glob que não casa nada é indistinguível
 *    de pasta limpa, zero casamentos conta como ausência e derruba o build.
 *    Sem isso, mover `src/` desligaria o guarda em silêncio.
 * 3. Folha que sumiu e leitura sem classe são contadas SEPARADO. As duas
 *    derrubam o build, mas dizem coisas opostas: uma é "o import aponta para um
 *    arquivo que não existe" (rename, quase sempre), a outra é "a classe nunca
 *    foi escrita". Misturar as duas mente no log da Vercel.
 * 4. CLASSE MONTADA DINAMICAMENTE (`styles["due_" + tom]`) é reconhecida e
 *    IGNORADA, nunca acusada. O nome só existe em tempo de execução; reprovar
 *    ali seria o guarda acusando código correto, e guarda que acusa o que está
 *    certo é guarda que alguém desliga na primeira sexta-feira. Mas ele não
 *    esconde o próprio ponto cego: a linha de sucesso diz quantas leituras
 *    dinâmicas passaram sem conferência.
 * 5. CLASSE DEFINIDA E NÃO USADA não é checada aqui, de propósito, e não por
 *    esquecimento. É código morto, e conserta-se APAGANDO uma classe; a
 *    violação daqui conserta-se ESCREVENDO uma. São instruções opostas, e
 *    imprimir as duas no mesmo log faz o operador da Vercel apagar exatamente
 *    a classe que estava faltando.
 * 6. O parser lê SELETORES, e não o arquivo inteiro — e é isso que resolve o
 *    `composes:` sem uma linha de tratamento especial. Uma varredura por
 *    `\.nome` no arquivo todo contaria `composes: x from "./outra.module.css"`
 *    como duas classes (`.module` e `.css`) e, pior, contaria `x` como
 *    definida aqui. `x` NÃO é exportada por esta folha: `composes` só empurra o
 *    nome gerado de `x` para dentro do valor da classe que compõe. Lendo só o
 *    que vem antes de `{`, nada disso chega ao conjunto de definições.
 *    Pelo mesmo motivo o que está dentro de `:global(...)` é descartado: sai
 *    para o CSS com o nome literal e nunca vira chave do objeto importado.
 * 7. `@value` e `:export` TAMBÉM viram chaves do objeto importado, e entram no
 *    conjunto de definições. Folha nenhuma do projeto usa os dois hoje. Estão
 *    aqui porque o dia em que alguém usar é o dia em que o guarda reprovaria
 *    código correto — ver a decisão 4.
 *
 * Ponto cego assumido: o guarda segue o nome com que a folha foi importada. Se
 * alguém fizer `const s = styles`, as leituras por `s.` passam sem conferência,
 * como as dinâmicas. Nenhum arquivo faz isso hoje, e cobrir esse caso exigiria
 * um parser de JavaScript de verdade — que é preço alto para um risco que uma
 * revisão de PR pega.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Raiz do repositório a partir da localização deste arquivo — não do CWD. */
const RAIZ = fileURLToPath(new URL("../", import.meta.url));

/** `globSync` devolve o separador do SO; o log tem de ser igual no Windows e no Linux. */
const paraPosix = (p) => p.split(path.sep).join("/");

/**
 * `.ts` entra junto do `.tsx` porque nada impede um módulo sem JSX de importar
 * a folha e exportar uma classe pronta — `components/skeleton.tsx` já exporta
 * `classeAparece`, e o próximo pode não ter JSX nenhum.
 */
const FONTES = ["src/**/*.tsx", "src/**/*.ts"];

const IMPORT_FOLHA =
  /import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+\.module\.css)["']/g;

// ---------------------------------------------------------------------------
// Leitura dos arquivos
// ---------------------------------------------------------------------------

/** Apaga o texto preservando o comprimento: linha e coluna do relato continuam certas. */
const branco = (s) => s.replace(/[^\n]/g, " ");

/**
 * Comentário não é leitura. `styles.foo` comentado não pede classe nenhuma, e
 * acusá-lo mandaria alguém escrever CSS para código que não roda.
 *
 * O `[^:]` antes de `//` é o mesmo cuidado do guarda da fronteira: sem ele,
 * `https://…` dentro de uma string apagaria o resto da linha.
 */
function semComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, branco)
    .replace(/(^|[^:\\])\/\/[^\n]*/gm, (m, p1) => p1 + branco(m.slice(p1.length)));
}

const linhaDe = (src, i) => src.slice(0, i).split("\n").length;

/** Onde a folha mora, a partir do arquivo que a importou. */
function caminhoDaFolha(relFonte, spec) {
  if (spec.startsWith("@/")) return paraPosix(path.posix.join("src", spec.slice(2)));
  return paraPosix(path.posix.join(path.posix.dirname(relFonte), spec));
}

// ---------------------------------------------------------------------------
// O que a folha define
// ---------------------------------------------------------------------------

/** Os nomes de classe de UM seletor — ver decisão 6 do cabeçalho. */
function classesDoSeletor(prelude, nomes) {
  if (/^\s*@/.test(prelude)) return; // @media, @supports, @keyframes…
  const limpo = prelude
    .replace(/:global\s*\([^)]*\)/g, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ");
  for (const m of limpo.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) nomes.add(m[1]);
}

/**
 * As chaves que a folha exporta para o `import`.
 *
 * A varredura anda caractere a caractere e guarda o que vem antes de `{`: esse
 * é o seletor. `}` e `;` zeram o acumulado, e é isso que mantém o corpo das
 * regras fora da conta — `composes: barraSeg;` termina em `;` e nunca chega a
 * ver uma chave. Vale para CSS aninhado também: cada `{` traz o seu seletor,
 * qualquer que seja a profundidade.
 */
function definicoesDa(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const nomes = new Set();
  let prelude = "";
  for (const c of src) {
    if (c === "{") {
      classesDoSeletor(prelude, nomes);
      prelude = "";
    } else if (c === "}" || c === ";") prelude = "";
    else prelude += c;
  }
  for (const m of src.matchAll(/@value\s+([\w-]+)\s*:/g)) nomes.add(m[1]);
  for (const m of src.matchAll(/@value\s+([^;]*?)\s+from\s/g))
    for (const n of m[1].split(",")) if (n.trim()) nomes.add(n.trim());
  for (const m of src.matchAll(/:export\s*\{([^}]*)\}/g))
    for (const d of m[1].matchAll(/([\w-]+)\s*:/g)) nomes.add(d[1]);
  return nomes;
}

// ---------------------------------------------------------------------------
// "Você quis dizer…"
// ---------------------------------------------------------------------------

/** Distância de edição, abandonada acima do teto: além dele não interessa qual é. */
function distancia(a, b, teto) {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++)
      atual[j] = Math.min(
        ant[j] + 1,
        atual[j - 1] + 1,
        ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    ant = atual;
  }
  return ant[b.length];
}

/**
 * O nome definido mais próximo do que foi lido, se houver um perto o bastante.
 *
 * Erro de digitação e erro de caixa são o caso comum, e nomear o vizinho poupa
 * quem lê o log de abrir a folha para descobrir se a classe mudou de nome ou
 * nunca existiu. Sem candidato, cala: chutar "você quis dizer `page`?" para uma
 * classe que de fato falta manda consertar a linha errada.
 */
function parecida(nome, definidas) {
  const teto = nome.length <= 5 ? 1 : 2;
  let melhor = null;
  let menor = teto + 1;
  for (const d of definidas) {
    const dist = distancia(nome.toLowerCase(), d.toLowerCase(), teto);
    if (dist < menor) {
      menor = dist;
      melhor = d;
    }
  }
  return menor <= teto ? melhor : null;
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

const fontes = [
  ...new Set(FONTES.flatMap((g) => globSync(g, { cwd: RAIZ }).map(paraPosix))),
].sort();

let semAlvo = 0;
let folhasAusentes = 0;
let leiturasSemClasse = 0;
let conferidas = 0;
let dinamicas = 0;
const folhasVistas = new Set();
/** Uma folha lida uma vez só: `relatorios.module.css` tem três consumidores. */
const cacheDefinicoes = new Map();

if (fontes.length === 0) {
  console.error(
    "✗ src: nenhum arquivo .tsx/.ts encontrado — a pasta foi renomeada ou movida? " +
      "Aponte FONTES para o novo caminho em scripts/check-css-modules.mjs.",
  );
  semAlvo++;
}

for (const rel of fontes) {
  const bruto = readFileSync(path.join(RAIZ, rel), "utf8");
  if (!bruto.includes(".module.css")) continue;
  const codigo = semComentarios(bruto);

  for (const imp of codigo.matchAll(IMPORT_FOLHA)) {
    const [, binding, spec] = imp;
    const folha = caminhoDaFolha(rel, spec);
    folhasVistas.add(folha);

    if (!existsSync(path.join(RAIZ, folha))) {
      console.error(
        `✗ ${rel}:${linhaDe(codigo, imp.index)}: importa "${spec}", e ${folha} nao existe.`,
      );
      folhasAusentes++;
      continue;
    }

    let definidas = cacheDefinicoes.get(folha);
    if (!definidas) {
      definidas = definicoesDa(readFileSync(path.join(RAIZ, folha), "utf8"));
      cacheDefinicoes.set(folha, definidas);
    }

    const b = binding.replace(/\$/g, "\\$");
    // O `(?<![\w$.])` impede que `meusStyles.x` ou `cfg.styles.x` sejam lidos
    // como a folha importada — são outros objetos, com outras chaves.
    const estaticas = new RegExp(`(?<![\\w$.])${b}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, "g");
    const dinamica = new RegExp(`(?<![\\w$.])${b}\\s*\\??\\[`, "g");

    for (const uso of codigo.matchAll(estaticas)) {
      conferidas++;
      const nome = uso[1];
      if (definidas.has(nome)) continue;
      const perto = parecida(nome, definidas);
      console.error(
        `✗ ${rel}:${linhaDe(codigo, uso.index)}: ${binding}.${nome} — ` +
          `a folha ${folha} nao define .${nome}` +
          (perto ? `; a mais parecida que ela define e .${perto}` : "") +
          ".",
      );
      leiturasSemClasse++;
    }
    dinamicas += (codigo.match(dinamica) ?? []).length;
  }
}

// ---------------------------------------------------------------------------
// Veredito
// ---------------------------------------------------------------------------

if (semAlvo > 0) {
  console.error(
    "\nO guarda de CSS Modules perdeu o alvo: nao ha o que conferir.\n" +
      "E um rename da arvore de fontes, nao uma classe faltando.\n" +
      "Aponte FONTES para o novo caminho; nao apague o guarda.\n",
  );
}
if (folhasAusentes > 0) {
  console.error(
    `\n${folhasAusentes} import(s) de CSS Module aponta(m) para folha que nao existe.\n` +
      "Nao e classe faltando: e o ARQUIVO que sumiu, quase sempre num rename.\n" +
      "Corrija o caminho do import, ou reponha a folha no lugar de onde ela saiu.\n",
  );
}
if (leiturasSemClasse > 0) {
  console.error(
    `\n${leiturasSemClasse} leitura(s) de classe que a folha nao define.\n` +
      "Escreva a classe que falta na folha, ou corrija o nome da leitura.\n" +
      "NAO apague a leitura para calar o log: ela e a que devia estar estilizada.\n" +
      "Nada mais no projeto ve este erro — CSS Modules devolve undefined,\n" +
      "className={undefined} e JSX valido, e o elemento vai para producao sem\n" +
      "estilo nenhum. Foi assim que as barras do Dashboard empilharam na\n" +
      "vertical em producao (Issue #77).\n",
  );
}
if (semAlvo > 0 || folhasAusentes > 0 || leiturasSemClasse > 0) process.exit(1);

console.log(
  `css modules: ok (${conferidas} leitura(s) conferida(s) em ${folhasVistas.size} folha(s); ` +
    `${dinamicas} montada(s) em tempo de execucao, fora do alcance)`,
);
