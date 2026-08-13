/**
 * Regressao de firestore.rules, SEM emulador e SEM Java.
 *
 * O AGENTS.md dizia que testar regra do Firestore era impossivel aqui, porque o
 * emulador e um JAR e nao ha Java. Isso valia para o emulador — nao para a API
 * `firebaserules.projects.test`, que avalia um ruleset contra requisicoes
 * sinteticas no servidor do Google. Os `get()`/`exists()` sao dublados por
 * `functionMocks`, entao cada caso descreve o usuario inteiro sem banco nenhum.
 *
 * COMO RODAR (precisa do `firebase login` feito — le a credencial do CLI):
 *
 *   npm run test:regras                       # compara com a `main`
 *   node scripts/comparar-regras.mjs a.rules b.rules   # dois arquivos quaisquer
 *
 * NAO entra no `prebuild`: depende de rede e de credencial de quem esta na
 * maquina, e o portao do deploy nao pode depender de nenhuma das duas.
 *
 * Rode SEMPRE que mexer em firestore.rules. Foi ele que provou que a reescrita
 * do orcamento de acessos (Issue #61) nao mexeu em nenhuma das 153 respostas
 * fora as 7 que a lixeira introduziu de proposito — inclusive nas listagens,
 * que sao provadas estaticamente e nao dava para conferir de olho.
 *
 * Por que comparar em vez de afirmar: acertar a expectativa de 60 casos a mao e
 * ele proprio uma fonte de erro — meu primeiro teste "reprovou" o super admin
 * editando card, e o errado era o teste. A pergunta que importa nao e "esta
 * certo?", e "algo que funcionava parou de funcionar?". Essa o diff responde
 * sozinho, e as celulas que mudam sao exatamente as que a lixeira introduz.
 *
 * `resource` e campo de PRIMEIRO NIVEL do caso (o documento como esta gravado);
 * `request.resource` e o documento resultante da escrita. Trocar os dois faz
 * `cur()` ler vazio e nega quase tudo — foi o erro da primeira tentativa.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PROJ = "smart-meet-d441b";
const SUPER = "setorbiunichristus@gmail.com";
const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

async function token() {
  const cfg = JSON.parse(
    readFileSync(
      `${process.env.USERPROFILE}/.config/configstore/firebase-tools.json`,
      "utf8",
    ),
  );
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: cfg.tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("sem access_token: " + JSON.stringify(j));
  return j.access_token;
}

const doc = (p) => `/databases/(default)/documents/${p}`;
const QUANDO = new Date(1786000000000).toISOString();

function mocksDe(email, perfil, extras = []) {
  const arg = [{ exactValue: doc(`users/${email}`) }];
  return [
    { function: "exists", args: arg, result: { value: perfil !== null } },
    {
      function: "get",
      args: arg,
      result: perfil === null ? { undefined: {} } : { value: { data: perfil } },
    },
    ...extras,
  ];
}

const PESSOAS = {
  "super admin": { email: SUPER, perfil: null },
  admin: {
    email: "ia02@px.com.br",
    perfil: { role: "admin", active: true, sectors: [] },
  },
  "gestor do setor": {
    email: "gestor@px.com.br",
    perfil: { role: "gestor", active: true, sectors: ["B.I."] },
  },
  "gestor de outro setor": {
    email: "gestor2@px.com.br",
    perfil: { role: "gestor", active: true, sectors: ["RH"] },
  },
  "operador do setor": {
    email: "op@px.com.br",
    perfil: { role: "operador", active: true, sectors: ["B.I."] },
  },
  "operador de outro setor": {
    email: "op2@px.com.br",
    perfil: { role: "operador", active: true, sectors: ["RH"] },
  },
  desativado: {
    email: "ex@px.com.br",
    perfil: { role: "gestor", active: false, sectors: ["B.I."] },
  },
  "sem cadastro": { email: "novo@px.com.br", perfil: null },
};

const CARD = {
  sector: "B.I.",
  createdBy: "op@px.com.br",
  title: "Painel de consumo",
  columnId: "fazendo",
  order: -1,
};
const NA_LIXEIRA = {
  ...CARD,
  deletedAt: 1786000000000,
  deletedBy: "gestor@px.com.br",
};

const casos = [];
/** `existente` = como esta gravado; `enviado` = como fica depois da escrita. */
function caso(quem, rotulo, method, path, existente, enviado, mocksExtra = []) {
  const p = PESSOAS[quem];
  casos.push({
    rotulo: `${quem} · ${rotulo}`,
    tc: {
      // A expectativa nao importa: o veredito sai da comparacao antiga x nova.
      expectation: "ALLOW",
      request: {
        auth: { uid: "u1", token: { email: p.email, email_verified: true } },
        time: QUANDO,
        path,
        method,
        ...(enviado ? { resource: { data: enviado } } : {}),
      },
      ...(existente ? { resource: { data: existente } } : {}),
      functionMocks: mocksDe(p.email, p.perfil, mocksExtra),
      pathEncoding: "PLAIN",
    },
  });
}

const CARD_PAI = [
  {
    function: "exists",
    args: [{ exactValue: doc("cards/c1") }],
    result: { value: true },
  },
  {
    function: "get",
    args: [{ exactValue: doc("cards/c1") }],
    result: { value: { data: CARD } },
  },
];

for (const quem of Object.keys(PESSOAS)) {
  const C = doc("cards/c1");
  caso(quem, "ler card", "get", C, CARD, null);
  caso(quem, "listar cards do setor", "list", C, CARD, null);
  caso(quem, "criar card", "create", C, null, {
    ...CARD,
    createdBy: PESSOAS[quem].email,
  });
  caso(quem, "editar titulo", "update", C, CARD, {
    ...CARD,
    title: "Outro titulo",
  });
  caso(quem, "mandar para a lixeira", "update", C, CARD, {
    ...CARD,
    deletedAt: 1786000000000,
    deletedBy: PESSOAS[quem].email,
  });
  caso(quem, "restaurar da lixeira", "update", C, NA_LIXEIRA, {
    ...CARD,
    deletedAt: null,
    deletedBy: null,
  });
  caso(quem, "editar card QUE ESTA na lixeira", "update", C, NA_LIXEIRA, {
    ...NA_LIXEIRA,
    title: "Corrigido",
  });
  caso(quem, "apagar card", "delete", C, CARD, null);

  const H = doc("cards/c1/historico/e1");
  const ev = (acao) => ({
    sector: "B.I.",
    autor: PESSOAS[quem].email,
    em: QUANDO,
    acao,
    mudancas: [],
  });
  caso(quem, "evento 'editada'", "create", H, null, ev("editada"), CARD_PAI);
  caso(quem, "evento 'excluida'", "create", H, null, ev("excluida"), CARD_PAI);
  caso(quem, "apagar evento", "delete", H, { sector: "B.I." }, null);

  const U = doc("users/alguem@px.com.br");
  caso(quem, "listar pessoas", "list", U, { name: "Alguem" }, null);
  caso(quem, "ler setores", "list", doc("sectors/s1"), { name: "B.I." }, null);
  caso(
    quem,
    "listar recorrencias",
    "list",
    doc("recorrencias/r1"),
    { sector: "B.I.", name: "Backup" },
    null,
  );
  caso(
    quem,
    "editar recorrencia",
    "update",
    doc("recorrencias/r1"),
    { sector: "B.I.", name: "Backup" },
    { sector: "B.I.", name: "Backup novo" },
  );
  caso(
    quem,
    "listar reunioes",
    "list",
    doc("meetings/m1"),
    { sector: "B.I.", createdBy: "op@px.com.br" },
    null,
  );
  caso(
    quem,
    "editar reuniao",
    "update",
    doc("meetings/m1"),
    { sector: "B.I.", createdBy: "op@px.com.br" },
    { sector: "B.I.", createdBy: "op@px.com.br", title: "Nova" },
  );
  caso(
    quem,
    "listar colunas",
    "list",
    doc("columns/k1"),
    { sector: "B.I.", colId: "fazendo" },
    null,
  );
  caso(
    quem,
    "listar solicitantes",
    "list",
    doc("solicitantes/s1"),
    { name: "Fulano" },
    null,
  );
}

// Forjar autoria tem de continuar negado para todos.
caso("admin", "forjar deletedBy de outra pessoa", "update", doc("cards/c1"), CARD, {
  ...CARD,
  deletedAt: 1786000000000,
  deletedBy: "op@px.com.br",
});

async function rodar(at, fonte) {
  const r = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJ}:test`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${at}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: { files: [{ name: "firestore.rules", content: fonte }] },
        testSuite: { testCases: casos.map((c) => c.tc) },
      }),
    },
  );
  const j = await r.json();
  if (j.error) throw new Error("API: " + JSON.stringify(j.error));
  const erros = (j.issues ?? []).filter((i) => i.severity === "ERROR");
  if (erros.length) {
    throw new Error(
      "regras nao compilam:\n" + erros.map((i) => "  " + i.description).join("\n"),
    );
  }
  // SUCCESS com expectativa ALLOW = permitido; FAILURE = negado.
  return j.testResults.map((t) => (t.state === "SUCCESS" ? "permite" : "NEGA"));
}

/**
 * Sem argumento, o "antes" e a `main`. E a comparacao que importa em 9 de cada
 * 10 vezes, e faze-la a mao dava chance de comparar o arquivo com ele mesmo —
 * o que sai verde e nao prova nada.
 */
const fonteAntes = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : execSync("git show main:firestore.rules", {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      maxBuffer: 8 << 20,
    });
const fonteDepois = readFileSync(
  process.argv[3] ?? new URL("../firestore.rules", import.meta.url),
  "utf8",
);

if (fonteAntes === fonteDepois) {
  console.log("Os dois rulesets sao identicos — nada a comparar.");
  process.exit(0);
}

const at = await token();
const [antes, depois] = [
  await rodar(at, fonteAntes),
  await rodar(at, fonteDepois),
];

let mudaram = 0;
casos.forEach((c, i) => {
  if (antes[i] !== depois[i]) {
    mudaram++;
    console.log(`MUDOU  ${c.rotulo}\n         ${antes[i]} -> ${depois[i]}`);
  }
});

console.log(
  `\n${casos.length} casos comparados. ${mudaram} mudaram de resposta.` +
    (mudaram === 0 ? "  Nenhuma regressao." : ""),
);
