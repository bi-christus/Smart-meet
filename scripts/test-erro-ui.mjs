/**
 * Testes da tradução de erro de leitura para frase acionável.
 *
 * Duas coisas aqui não são detalhe de texto, são o motivo do módulo existir:
 *
 * 1. NENHUMA PALAVRA DO FIRESTORE ATRAVESSA. O erro que chega tem
 *    `message: "Missing or insufficient permissions."` dentro. Se um dia
 *    alguém "melhorar" o componente mostrando `erro.message` para ajudar no
 *    diagnóstico, é aqui que isso para.
 * 2. NEGAÇÃO DE PERMISSÃO NÃO OFERECE "TENTAR DE NOVO". Botão que promete uma
 *    saída inexistente é pior do que botão nenhum — a pessoa clica cinco vezes
 *    antes de entender que o problema não é com ela.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  classificarErro,
  codigoDe,
  fraseDeFalha,
} from "../src/lib/erro-ui-core.ts";

/** Os códigos que o módulo traduz, mais um que ele não conhece. */
const CODIGOS = [
  "permission-denied",
  "unauthenticated",
  "unavailable",
  "resource-exhausted",
  "failed-precondition",
  "teapot",
];

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

/** O que o SDK realmente entrega: um Error com `code` pendurado. */
function erroFirebase(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// --- o texto do banco não chega na tela ------------------------------------
const CRU = "Missing or insufficient permissions.";
const negado = classificarErro(erroFirebase("permission-denied", CRU));
checa(
  "a mensagem crua do Firestore nao aparece no titulo nem na descricao",
  !negado.titulo.includes(CRU) &&
    !negado.descricao.includes(CRU) &&
    !negado.descricao.toLowerCase().includes("permissions"),
  `${negado.titulo} / ${negado.descricao}`,
);

// --- a distinção que carrega o módulo --------------------------------------
checa(
  "negacao de permissao NAO oferece tentar de novo",
  negado.classe === "permissao" && negado.podeTentarDeNovo === false,
  JSON.stringify({ classe: negado.classe, retry: negado.podeTentarDeNovo }),
);

const fora = classificarErro(erroFirebase("unavailable", "backend unreachable"));
checa(
  "falha de rede oferece tentar de novo, e e outra frase",
  fora.classe === "rede" &&
    fora.podeTentarDeNovo === true &&
    fora.titulo !== negado.titulo,
  fora.titulo,
);

// --- estar sem rede manda em cima do código --------------------------------
const offline = classificarErro(erroFirebase("unavailable", "x"), false);
checa(
  "sem conexao, a frase fala de conexao e nao de servidor",
  offline.classe === "rede" && offline.titulo !== fora.titulo,
  offline.titulo,
);
checa(
  "estar offline NAO reescreve uma negacao de permissao",
  classificarErro(erroFirebase("permission-denied", CRU), false).classe ===
    "permissao",
  "o servidor ja disse nao; consertar o wifi nao resolveria",
);

// --- prefixo de produto some ------------------------------------------------
checa(
  "o prefixo do SDK de auth e descartado",
  codigoDe(erroFirebase("auth/network-request-failed", "x")) ===
    "network-request-failed",
  codigoDe(erroFirebase("auth/network-request-failed", "x")),
);
checa(
  "e a falha de rede do auth cai na mesma classe da do firestore",
  classificarErro(erroFirebase("auth/network-request-failed", "x")).classe ===
    "rede",
);

// --- índice faltando é problema nosso, não de quem usa ---------------------
const semIndice = classificarErro(
  erroFirebase("failed-precondition", "The query requires an index."),
);
checa(
  "indice faltando nao vira 'tente de novo' — repetir daria o mesmo erro",
  semIndice.classe === "config" && semIndice.podeTentarDeNovo === false,
  semIndice.titulo,
);
checa(
  "e nao vaza a instrucao de criar indice, que so serve para quem administra",
  !semIndice.descricao.toLowerCase().includes("index") &&
    !semIndice.descricao.toLowerCase().includes("query"),
  semIndice.descricao,
);

// --- o que não se conhece ainda assim tem o que fazer ----------------------
for (const [rotulo, valor] of [
  ["codigo desconhecido", erroFirebase("teapot", "418")],
  ["erro sem code", new Error("qualquer coisa")],
  ["nao-erro", null],
  ["string solta", "quebrou"],
]) {
  const m = classificarErro(valor);
  checa(
    `${rotulo} cai no generico, com titulo e descricao preenchidos`,
    m.classe === "desconhecido" &&
      m.titulo.length > 0 &&
      m.descricao.length > 0 &&
      m.podeTentarDeNovo === true,
    m.titulo,
  );
}

// --- toda classe tem ícone, e ícone que existe ------------------------------
const ICONES_QUE_EXISTEM = ["lock", "warn", "clock", "info"];
for (const code of [
  "permission-denied",
  "unauthenticated",
  "unavailable",
  "resource-exhausted",
  "failed-precondition",
  "teapot",
]) {
  const m = classificarErro(erroFirebase(code, "x"));
  checa(
    `'${code}' usa um icone que existe em components/icons.tsx`,
    ICONES_QUE_EXISTEM.includes(m.icone),
    m.icone,
  );
}

// --- português, e sem ponto final no título --------------------------------
for (const code of [
  "permission-denied",
  "unauthenticated",
  "unavailable",
  "resource-exhausted",
  "failed-precondition",
  "teapot",
]) {
  const m = classificarErro(erroFirebase(code, "x"));
  checa(
    `'${code}': titulo e uma frase curta, sem ponto final`,
    !m.titulo.endsWith(".") && m.titulo.length <= 48,
    `${m.titulo} (${m.titulo.length})`,
  );
  checa(
    `'${code}': descricao diz o que fazer`,
    /tente|aguarde|peça|peca|verifique|avise|saia/i.test(m.descricao),
    m.descricao,
  );
}

// --- a frase de uma ACAO que falhou ---------------------------------------
// Ela nasceu duplicada em duas telas. O teste existe para que a proxima copia
// nao apareca: quem for reescrever a redacao mexe aqui, e as duas mudam juntas.

const salvar = fraseDeFalha("Nao foi possivel salvar a demanda.", { code: "permission-denied" });
checa(
  "a acao vem na frente da causa",
  salvar.startsWith("Nao foi possivel salvar a demanda."),
  salvar,
);
checa(
  "a causa nomeada entra na frase",
  /acesso/i.test(salvar),
  salvar,
);
checa(
  "a frase termina no que fazer agora",
  /peca|peça/i.test(salvar),
  salvar,
);

const generico = fraseDeFalha("Nao foi possivel salvar a demanda.", new Error("boom"));
checa(
  "erro sem codigo nao inventa causa: so acao + o que fazer",
  generico.startsWith("Nao foi possivel salvar a demanda.") &&
    !/carregar/i.test(generico),
  generico,
);

checa(
  "offline muda a frase da mesma falha",
  fraseDeFalha("X.", { code: "unavailable" }, false) !==
    fraseDeFalha("X.", { code: "unavailable" }, true),
);

// A asserção que importa: nenhum codigo cru do Firestore atravessa para a tela.
for (const code of CODIGOS) {
  const f = fraseDeFalha("Nao foi possivel remover.", { code });
  checa(
    `'${code}': a frase de acao nao vaza o codigo`,
    !f.includes(code),
    f,
  );
}

console.log(
  falhas === 0
    ? "\nTodos os testes de mensagem de erro passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
