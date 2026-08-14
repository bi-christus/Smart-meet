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

// --- foto de perfil ---------------------------------------------------------
// O teto da regra e 16407 CARACTERES, que sao os 12288 bytes de imagem de
// `LIMITE_FOTO_BYTES` convertidos (3 bytes viram 4 caracteres, mais 23 do
// prefixo). Os valores abaixo cercam esse numero pelos dois lados; o conteudo
// nao precisa ser uma imagem de verdade, so estar no alfabeto certo.
const PREFIXO_JPEG = "data:image/jpeg;base64,";
const FOTO_OK = PREFIXO_JPEG + "A".repeat(400);
const FOTO_NO_TETO = PREFIXO_JPEG + "A".repeat(16407 - PREFIXO_JPEG.length);
const FOTO_GRANDE = PREFIXO_JPEG + "A".repeat(16408 - PREFIXO_JPEG.length);
// Tem "image" no nome, o navegador desenha, e carrega script. E o caso que a
// lista de permissao existe para recusar.
const FOTO_SVG = "data:image/svg+xml;base64," + "A".repeat(400);
const PERFIL = { name: "Alguem", role: "operador", active: true, sectors: ["B.I."] };

// --- nome ------------------------------------------------------------------
// O teto e 80 UNIDADES UTF-16, que e o que `size()` conta em CEL — o mesmo
// numero de `LIMITE_NOME_CHARS`, sem conversao nenhuma (a foto passa por
// base64 no caminho; o nome, nao). Os valores abaixo cercam o numero pelos dois
// lados e cercam tambem a definicao de "tem conteudo": o espaco inquebravel e o
// caso que o `trim()` do CEL NAO apara.
const NOME_NO_TETO = "a".repeat(80);
const NOME_GRANDE = "a".repeat(81);
const NOME_NBSP = " ";
// 79 letras + um emoji = 80 code points, mas 81 unidades UTF-16. Se a regra
// contasse code points, este passaria — e o modulo, que conta unidades, ja teria
// dito nao. E a divergencia que faz a pessoa ler "sem permissao" tendo permissao.
const NOME_COM_EMOJI = "a".repeat(79) + "\u{1f600}";

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

  // --- foto de perfil: o proprio doc ---------------------------------------
  // `MEU` e o doc de quem esta autenticado; e o unico caminho em que o dono
  // escreve em /users. O que se prova aqui: a foto entra, o teto vale, o formato
  // vale, e o `hasOnly` continua barrando `role` na mesma escrita.
  const MEU = doc(`users/${PESSOAS[quem].email}`);
  const comFoto = { ...PERFIL, photo: FOTO_OK };
  caso(quem, "gravar a propria foto", "update", MEU, PERFIL, comFoto);
  caso(quem, "gravar a propria foto NO TETO", "update", MEU, PERFIL, {
    ...PERFIL,
    photo: FOTO_NO_TETO,
  });
  caso(quem, "gravar a propria foto ACIMA do teto", "update", MEU, PERFIL, {
    ...PERFIL,
    photo: FOTO_GRANDE,
  });
  caso(quem, "gravar SVG na propria foto", "update", MEU, PERFIL, {
    ...PERFIL,
    photo: FOTO_SVG,
  });
  caso(quem, "remover a propria foto", "update", MEU, comFoto, {
    ...PERFIL,
    photo: null,
  });
  // O `hasOnly` existe para isto: o caminho que grava a foto nao pode ser o que
  // promove a si mesmo a admin.
  caso(quem, "gravar foto E virar admin", "update", MEU, PERFIL, {
    ...comFoto,
    role: "admin",
  });
  caso(quem, "gravar foto E se reativar", "update", MEU, PERFIL, {
    ...comFoto,
    active: true,
    sectors: ["B.I.", "RH"],
  });
  // O login (`ensureUserProfile`) escreve exatamente este par. Se ele mudar de
  // resposta, o acesso de todo mundo muda junto.
  caso(quem, "atualizar sessao do proprio doc", "update", MEU, PERFIL, {
    ...PERFIL,
    uid: "u1",
    lastLogin: QUANDO,
  });

  // --- nome: o proprio doc -------------------------------------------------
  // Aqui esta a mudanca desta versao: trocar o proprio nome deixa de ser coisa
  // de admin. O que NAO pode mudar junto e o resto — e e por isso que os casos
  // de "nome E role" e "nome E setores" ficam do lado dos de sucesso.
  caso(quem, "gravar o proprio nome", "update", MEU, PERFIL, {
    ...PERFIL,
    name: "Nome Novo",
  });
  caso(quem, "gravar o proprio nome NO TETO", "update", MEU, PERFIL, {
    ...PERFIL,
    name: NOME_NO_TETO,
  });
  caso(quem, "gravar o proprio nome ACIMA do teto", "update", MEU, PERFIL, {
    ...PERFIL,
    name: NOME_GRANDE,
  });
  caso(quem, "gravar o proprio nome VAZIO", "update", MEU, PERFIL, {
    ...PERFIL,
    name: "",
  });
  caso(quem, "gravar o proprio nome SO COM ESPACO", "update", MEU, PERFIL, {
    ...PERFIL,
    name: "   ",
  });
  caso(quem, "gravar o proprio nome so com espaco inquebravel", "update", MEU, PERFIL, {
    ...PERFIL,
    name: NOME_NBSP,
  });
  caso(quem, "gravar nome de 79 letras + emoji (81 unidades)", "update", MEU, PERFIL, {
    ...PERFIL,
    name: NOME_COM_EMOJI,
  });
  // O `hasOnly` de novo, agora pelo caminho do nome: quem troca o proprio nome
  // nao pode aproveitar a viagem.
  caso(quem, "gravar nome E virar admin", "update", MEU, PERFIL, {
    ...PERFIL,
    name: "Nome Novo",
    role: "admin",
  });
  caso(quem, "gravar nome E entrar em outro setor", "update", MEU, PERFIL, {
    ...PERFIL,
    name: "Nome Novo",
    sectors: ["B.I.", "RH"],
  });
  // A tela de perfil grava os dois numa escrita so (`saveOwnProfile`).
  caso(quem, "gravar nome E foto na mesma escrita", "update", MEU, PERFIL, {
    ...PERFIL,
    name: "Nome Novo",
    photo: FOTO_OK,
  });

  // --- nome: o doc DE OUTRA PESSOA -----------------------------------------
  caso(quem, "gravar o nome de outra pessoa", "update", U, PERFIL, {
    ...PERFIL,
    name: "Nome Novo",
  });
  // Cadastro sem nome e como nasce a pessoa que aparece pelo e-mail em todas as
  // telas — e nao havia nada impedindo, fora a tela.
  caso(quem, "criar pessoa SEM nome", "create", U, null, {
    role: "operador",
    active: true,
    sectors: ["B.I."],
  });
  caso(quem, "criar pessoa com nome so de espaco", "create", U, null, {
    ...PERFIL,
    name: "   ",
  });

  // --- foto de perfil: o doc DE OUTRA PESSOA -------------------------------
  caso(quem, "gravar a foto de outra pessoa", "update", U, PERFIL, comFoto);
  caso(quem, "gravar foto grande em outra pessoa", "update", U, PERFIL, {
    ...PERFIL,
    photo: FOTO_GRANDE,
  });
  caso(quem, "gravar SVG na foto de outra pessoa", "update", U, PERFIL, {
    ...PERFIL,
    photo: FOTO_SVG,
  });
  caso(quem, "criar pessoa ja com foto", "create", U, null, comFoto);
  caso(quem, "criar pessoa com foto grande", "create", U, null, {
    ...PERFIL,
    photo: FOTO_GRANDE,
  });

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

  // --- config: quem enxerga qual aba ---------------------------------------
  // Estes casos NASCEM mudando de resposta, e e o unico jeito de eles nascerem:
  // na `main` o caminho /config nao existe e cai na negacao final, entao a
  // comparacao acusa todos eles. E de proposito — o script mostra o que mudou,
  // e o que tem de mudar aqui e exatamente: leitura passa a valer para todo
  // usuario ativo, escrita so para admin.
  const CFG = doc("config/permissoes");
  const QUADRO = {
    v: 1,
    abas: { dashboard: { modo: "restrito", setores: ["B.I."], pessoas: [] } },
  };
  caso(quem, "ler o quadro de permissoes", "get", CFG, QUADRO, null);
  caso(quem, "escrever o quadro de permissoes", "update", CFG, QUADRO, {
    ...QUADRO,
    abas: { dashboard: { modo: "todos", setores: [], pessoas: [] } },
  });
  caso(quem, "criar o quadro de permissoes", "create", CFG, null, QUADRO);
  caso(quem, "apagar o quadro de permissoes", "delete", CFG, QUADRO, null);
}

// Forjar autoria tem de continuar negado para todos.
// --- e-mail com MAIUSCULA no token ----------------------------------------
// O doc id de /users e minusculo, mas o e-mail do token vem do Google na caixa
// que ele quiser. Enquanto o dono so escrevia `lastLogin` — que falha em
// silencio, com `.catch(() => {})` no login — comparar cru era invisivel. Com
// `photo` no mesmo braco deixa de ser: a pessoa clicaria em salvar a foto e
// leria "sem permissao", tendo permissao.
{
  const MISTO = "Fulano.Silva@px.com.br";
  const perfil = { role: "operador", active: true, sectors: ["B.I."] };
  const tokenMisto = { uid: "u1", token: { email: MISTO, email_verified: true } };
  const docMinusculo = doc(`users/${MISTO.toLowerCase()}`);
  // Os mocks respondem pelo caminho MINUSCULO, que e onde o doc realmente esta.
  const mocks = [
    {
      function: "exists",
      args: [{ exactValue: docMinusculo }],
      result: { value: true },
    },
    {
      function: "get",
      args: [{ exactValue: docMinusculo }],
      result: { value: { data: perfil } },
    },
  ];
  const antes = { ...perfil, email: MISTO.toLowerCase(), name: "Fulano" };
  casos.push({
    rotulo: "e-mail com maiuscula · gravar a propria foto",
    tc: {
      expectation: "ALLOW",
      request: {
        auth: tokenMisto,
        time: QUANDO,
        path: docMinusculo,
        method: "update",
        resource: { data: { ...antes, photo: FOTO_OK } },
      },
      resource: { data: antes },
      functionMocks: mocks,
      pathEncoding: "PLAIN",
    },
  });
  casos.push({
    rotulo: "e-mail com maiuscula · gravar o proprio nome",
    tc: {
      expectation: "ALLOW",
      request: {
        auth: tokenMisto,
        time: QUANDO,
        path: docMinusculo,
        method: "update",
        resource: { data: { ...antes, name: "Fulano da Silva" } },
      },
      resource: { data: antes },
      functionMocks: mocks,
      pathEncoding: "PLAIN",
    },
  });
  casos.push({
    rotulo: "e-mail com maiuscula · atualizar a propria sessao",
    tc: {
      expectation: "ALLOW",
      request: {
        auth: tokenMisto,
        time: QUANDO,
        path: docMinusculo,
        method: "update",
        resource: { data: { ...antes, uid: "u1", lastLogin: QUANDO } },
      },
      resource: { data: antes },
      functionMocks: mocks,
      pathEncoding: "PLAIN",
    },
  });
}

caso("admin", "forjar deletedBy de outra pessoa", "update", doc("cards/c1"), CARD, {
  ...CARD,
  deletedAt: 1786000000000,
  deletedBy: "op@px.com.br",
});

/**
 * Quantos casos vao em cada chamada.
 *
 * A API recusa a suite inteira com um `INVALID_ARGUMENT` seco quando o corpo
 * passa do tamanho dela — nada no erro diz que foi tamanho, e ele parece erro de
 * sintaxe do ruleset. Foi o que aconteceu quando os casos da foto de perfil
 * entraram trazendo strings de 16 KB cada. Mandar em lotes tira o teto do
 * caminho: o custo e uma requisicao a mais, e o veredito por caso e o mesmo.
 */
const LOTE = 25;

async function lote(at, fonte, pedaco) {
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
        testSuite: { testCases: pedaco.map((c) => c.tc) },
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

async function rodar(at, fonte) {
  const saida = [];
  for (let i = 0; i < casos.length; i += LOTE) {
    saida.push(...(await lote(at, fonte, casos.slice(i, i + LOTE))));
  }
  return saida;
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
