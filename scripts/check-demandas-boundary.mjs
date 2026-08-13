/**
 * Guarda a fronteira de segurança das demandas. Roda no `prebuild`.
 *
 * A regra que ele protege: o caminho automático (Cowork → Drive → ingest) NUNCA
 * escreve em /cards e NUNCA apaga nada. Um card só nasce por decisão humana em
 * `api/demandas/decidir`.
 *
 * Isso é fácil de furar sem má intenção — alguém "otimiza" o ingest para já
 * criar o card das propostas de confiança alta, o code review não pega, e a
 * garantia que o Ítalo pediu deixa de existir em silêncio. Um comentário não
 * segura isso; um build vermelho segura.
 *
 * Quatro decisões deste arquivo que parecem detalhe e não são:
 *
 * 1. Os caminhos saem de `import.meta.url`, nunca do CWD. Este é o portão do
 *    deploy: tem de dar o mesmo veredito rodando de qualquer diretório. Com
 *    caminho relativo ao CWD, rodar de fora do repo acusava "arquivo nao
 *    encontrado" nos dois alvos e mandava o operador caçar uma escrita em
 *    /cards que nunca existiu.
 * 2. Ausência de alvo e violação de regra são contadas separado. As duas
 *    derrubam o build — falhar fechado é de propósito —, mas dizem coisas
 *    opostas: uma é "a regra foi furada", a outra é "o alvo da regra sumiu,
 *    provavelmente num rename". Misturar as duas mente no log da Vercel.
 * 3. As rotas do Cowork entram por glob, não por lista literal, porque o risco
 *    real é uma rota NOVA nascer com POST — e lista literal não vê o que ainda
 *    não existe. Como glob que não casa nada é indistinguível de pasta limpa,
 *    zero casamentos conta como ausência e derruba o build também. Sem isso,
 *    renomear a pasta desligaria o guarda em silêncio.
 * 4. Existe uma TERCEIRA categoria além de proibir e de perder o alvo: EXIGIR.
 *    Um alvo pode declarar padrões que ele precisa CONTER, e o build cai se
 *    algum sumir.
 *
 *    Ela nasceu por causa de `api/demandas/expurgar`, a rota que apaga demanda
 *    e histórico de vez. Ela usa o Admin SDK, e o Admin SDK IGNORA
 *    `firestore.rules` — de propósito, porque é justamente o teto de acessos
 *    das regras que impedia o admin comum de excluir (Issue #59). O efeito
 *    colateral é que ali a autorização em TypeScript não é a primeira barreira:
 *    é a única. Tirar o `requireUser` daquele arquivo não quebra teste, não
 *    quebra tipo, não quebra lint e não quebra tela. Passa verde e abre uma
 *    rota anônima de exclusão em produção.
 *
 *    Proibir não alcança esse caso: o perigo não é uma linha ruim aparecer, é
 *    uma linha boa desaparecer, e ninguém escreve um padrão para a ausência de
 *    algo que não sabe nomear. Por isso a exigência aponta para o que TEM de
 *    estar lá.
 *
 *    Requisito ausente é contado à parte, e não junto das violações, pelo mesmo
 *    princípio da decisão 2: a mensagem das violações fala do caminho
 *    automático e do /cards, e imprimi-la aqui mentiria sobre a causa. Violação
 *    se conserta APAGANDO a linha ofensora; requisito se conserta REPONDO a
 *    defesa. São instruções opostas para quem lê o log da Vercel às pressas.
 *
 *    Os padrões exigidos são de UMA LINHA (`[^\n]*`, não `[\s\S]*`) de caso
 *    pensado. Casar por linha erra para o lado seguro: uma reescrita legítima
 *    que espalhe a checagem em três linhas derruba o build e obriga alguém a
 *    olhar a rota de expurgo e atualizar o padrão no mesmo PR. O erro contrário
 *    — um padrão frouxo casando com qualquer coisa a 200 caracteres de
 *    distância — passaria verde para sempre, e um guarda que nunca reprova é
 *    indistinguível de um guarda que não existe.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Raiz do repositório a partir da localização deste arquivo — não do CWD. */
const RAIZ = fileURLToPath(new URL("../", import.meta.url));

/** `globSync` devolve o separador do SO; o log tem de ser igual no Windows e no Linux. */
const paraPosix = (p) => p.split(path.sep).join("/");

const PROIBIDOS_INGEST = [
  { padrao: /collection\(\s*["'`]cards["'`]\s*\)/, motivo: 'escreve/le a colecao "cards"' },
  { padrao: /\.delete\s*\(/, motivo: "apaga documento" },
  { padrao: /deleteDoc|FieldValue\.delete/, motivo: "apaga documento ou campo" },
  { padrao: /\btx\.set\s*\(/, motivo: "usa set() — deve usar create(), que falha se ja existir" },
];

const PROIBIDOS_COWORK = [
  { padrao: /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/, motivo: "expoe verbo de escrita" },
  // Escrita no Firestore especificamente. Um `.update(` solto pegaria
  // `createHash().update()`, que nao tem nada a ver com banco.
  {
    padrao: /(?:doc|collection)\s*\([^)]*\)\s*\.\s*(?:set|update|create|delete)\s*\(/,
    motivo: "escreve no Firestore",
  },
  { padrao: /\b(?:tx|batch)\s*\.\s*(?:set|update|create|delete)\s*\(/, motivo: "escreve via transacao/lote" },
  { padrao: /runTransaction|writeBatch|\.batch\s*\(/, motivo: "abre transacao ou lote de escrita" },
];

/**
 * O que a rota de expurgo tem de CONTER. Cada item diz o que falta e o que
 * fazer — quem lê isto no log da Vercel pode não ter escrito a rota.
 */
const EXIGIDOS_EXPURGO = [
  {
    padrao: /\brequireUser\s*\(/,
    exigencia: "nao chama requireUser — a rota apagaria demanda sem saber quem pediu",
    reponha: "volte a abrir o handler com `const caller = await requireUser(req);`",
  },
  {
    padrao: /\brole\b[^\n]*\bgestor\b/,
    exigencia: "nao exige papel gestor — operador passaria a apagar demanda de vez",
    reponha:
      "volte a checar o papel numa linha so, no formato " +
      '`caller.role === "gestor" || caller.role === "admin"`',
  },
  {
    padrao: /\bsectors\b[^\n]*\bincludes\b/,
    exigencia:
      "nao confere o setor do chamador — gestor de um setor esvaziaria a lixeira de outro",
    reponha:
      "volte a checar o escopo numa linha so, no formato " +
      '`caller.role !== "admin" && !caller.sectors.includes(sector)`',
  },
  {
    // Aceita as duas formas de fazer a pergunta: o predicado compartilhado de
    // `lixeira-core` (o certo) ou o campo cru (o que veio antes dele). O que
    // NAO pode e a pergunta sumir — dai a rota apagaria demanda viva.
    padrao: /\bnaLixeira\s*\(|\bdeletedAt\b/,
    exigencia:
      "nao distingue demanda viva de demanda na lixeira — apagaria de vez um card que ainda esta no quadro",
    reponha:
      "volte a recusar, antes de apagar, o card que `naLixeira()` (src/lib/lixeira-core.ts) reprovar",
  },
];

const REGRAS = [
  { arquivo: "src/lib/server/demand-ingest.ts", proibidos: PROIBIDOS_INGEST },
  {
    glob: "src/app/api/cowork/**/route.ts",
    ondeSumiu: "src/app/api/cowork",
    proibidos: PROIBIDOS_COWORK,
  },
  {
    arquivo: "src/app/api/demandas/expurgar/route.ts",
    exigidos: EXIGIDOS_EXPURGO,
    seSumiu:
      "a rota de expurgo mudou de lugar, ou a exclusao definitiva voltou para o navegador? " +
      "Se mudou de lugar, aponte a regra para o novo caminho em scripts/check-demandas-boundary.mjs. " +
      "Se voltou para o cliente, o teto de acessos das regras derruba o admin de novo (Issue #59).",
  },
];

let ausentes = 0;
let violacoes = 0;
let faltando = 0;

/** Devolve os arquivos a inspecionar; lista vazia já contabilizou a ausência. */
function alvosDe(regra) {
  if (regra.arquivo) {
    if (!existsSync(path.join(RAIZ, regra.arquivo))) {
      console.error(
        `✗ ${regra.arquivo}: arquivo esperado nao existe — ` +
          (regra.seSumiu ??
            "renomearam o caminho automatico? " +
              "Aponte a regra para o novo caminho em scripts/check-demandas-boundary.mjs."),
      );
      ausentes++;
      return [];
    }
    return [regra.arquivo];
  }
  const achados = globSync(regra.glob, { cwd: RAIZ }).map(paraPosix).sort();
  if (achados.length === 0) {
    console.error(
      `✗ ${regra.ondeSumiu}: nenhuma rota do caminho automatico encontrada — a pasta foi renomeada ou movida? ` +
        "Aponte a regra para o novo caminho em scripts/check-demandas-boundary.mjs.",
    );
    ausentes++;
  }
  return achados;
}

for (const regra of REGRAS) {
  for (const rel of alvosDe(regra)) {
    const src = readFileSync(path.join(RAIZ, rel), "utf8");
    // Sem comentarios: a palavra "cards" aparece legitimamente na documentacao.
    const codigo = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const { padrao, motivo } of regra.proibidos ?? []) {
      if (padrao.test(codigo)) {
        console.error(`✗ ${rel}: ${motivo}  [${padrao}]`);
        violacoes++;
      }
    }

    for (const { padrao, exigencia, reponha } of regra.exigidos ?? []) {
      if (!padrao.test(codigo)) {
        console.error(`✗ ${rel}: ${exigencia}  [${padrao}]\n  → ${reponha}.`);
        faltando++;
      }
    }
  }
}

if (ausentes > 0) {
  console.error(
    `\n${ausentes} alvo(s) da fronteira de demandas nao existe(m) mais.\n` +
      "O guarda perdeu o alvo — e um rename, nao uma regra furada.\n" +
      "Aponte a regra para o novo caminho; nao apague a regra.\n",
  );
}
if (violacoes > 0) {
  console.error(
    `\n${violacoes} violacao(oes) da fronteira de demandas.\n` +
      "O caminho automatico nao pode escrever em /cards nem apagar nada.\n" +
      "Um card so nasce em api/demandas/decidir, por decisao humana.\n",
  );
}
if (faltando > 0) {
  console.error(
    `\n${faltando} exigencia(s) da fronteira de demandas sumiu(ram) do codigo.\n` +
      "Nao e regra furada nem rename: e uma defesa que foi RETIRADA.\n" +
      "A rota de expurgo apaga card e historico com o Admin SDK, que ignora\n" +
      "firestore.rules — o que ela nao checar em TypeScript ninguem checa depois.\n" +
      "Reponha a checagem, seguindo a instrucao de cada linha acima.\n" +
      "Se a checagem continua la e so mudou de forma, atualize o padrao neste\n" +
      "arquivo (scripts/check-demandas-boundary.mjs) no MESMO PR — nunca depois,\n" +
      "e nunca apagando a exigencia.\n",
  );
}
if (ausentes > 0 || violacoes > 0 || faltando > 0) process.exit(1);

console.log("fronteira de demandas: ok");
