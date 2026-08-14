/**
 * Testes de quem enxerga qual aba.
 *
 * Esta é a primeira regra do app que decide ACESSO na interface, e ela erra em
 * duas direções que não se parecem nada:
 *
 *  - FROUXA demais, uma aba restrita aparece para quem não devia. O sintoma é
 *    silencioso: a tela abre e funciona, e ninguém reclama de ver a mais.
 *  - APERTADA demais, alguém fica trancado fora de uma aba — e o caso extremo,
 *    o que este arquivo existe sobretudo para impedir, é o ADMIN trancado fora
 *    da aba Admin. Não haveria conserto pela interface: a única tela de onde a
 *    configuração se edita seria uma das escondidas, e a mensagem na tela
 *    ("sem acesso") não diria nada disso a quem a lê. O conserto seria pelo
 *    console do Firebase.
 *
 * Por isso a maior parte do arquivo não testa o caminho feliz: testa documento
 * torto, campo faltando, tipo errado e caixa de e-mail — que é o estado em que
 * um documento editável por gente e por versões futuras deste app realmente
 * chega.
 *
 * O último bloco confere o catálogo contra o que existe em disco: aba cujo
 * `href` não tem página, e página de aba que não está no catálogo. É a única
 * conferência daqui que não é sobre a regra, e ela existe porque `ABAS` virou a
 * ÚNICA fonte da barra do topo — aba que sai do catálogo some da navegação sem
 * nenhum erro em lugar nenhum.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ABAS,
  ABAS_CONFIGURAVEIS,
  PERMISSOES_ABERTAS,
  abaDaRota,
  abaPorId,
  abasVisiveis,
  normalizarPermissoes,
  podeVerAba,
  regraFechadaParaTodos,
  regraPadrao,
} from "../src/lib/permissoes-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

const ADMIN = { email: "chefe@christus.edu.br", role: "admin", sectors: [] };
const GESTOR = { email: "gestor@christus.edu.br", role: "gestor", sectors: ["B.I."] };
const OPERADOR = {
  email: "op@christus.edu.br",
  role: "operador",
  sectors: ["Comercial"],
};

/** Um quadro em que só o Dashboard é restrito, ao setor B.I. */
const SO_BI = normalizarPermissoes({
  abas: { dashboard: { modo: "restrito", setores: ["B.I."], pessoas: [] } },
});

// --- o invariante que não pode cair jamais --------------------------------
// Admin enxerga TODA aba, inclusive as restritas a setores que ele não tem e as
// que foram fechadas para todo mundo. Sem isto não existe caminho de volta.
const TUDO_FECHADO = normalizarPermissoes({
  abas: Object.fromEntries(
    ABAS_CONFIGURAVEIS.map((a) => [
      a.id,
      { modo: "restrito", setores: [], pessoas: [] },
    ]),
  ),
});
checa(
  "admin enxerga TODAS as abas mesmo com o quadro inteiro fechado",
  ABAS.every((a) => podeVerAba(a.id, ADMIN, TUDO_FECHADO)),
  `${abasVisiveis(ADMIN, TUDO_FECHADO).length}/${ABAS.length} visíveis`,
);
checa(
  "com o quadro inteiro fechado, o não-admin fica só com Início",
  abasVisiveis(GESTOR, TUDO_FECHADO)
    .map((a) => a.id)
    .join(",") === "inicio",
  abasVisiveis(GESTOR, TUDO_FECHADO)
    .map((a) => a.id)
    .join(",") || "(nenhuma)",
);
checa(
  "a aba Admin nunca é liberada a não-admin, aconteça o que acontecer",
  !podeVerAba("admin", GESTOR, PERMISSOES_ABERTAS) &&
    !podeVerAba(
      "admin",
      GESTOR,
      // Mesmo com o e-mail dele escrito à mão numa regra de `admin`, que é o
      // que aconteceria se alguém editasse o documento pelo console.
      normalizarPermissoes({
        abas: { admin: { modo: "restrito", pessoas: [GESTOR.email] } },
      }),
    ),
);
checa(
  "Início não é configurável e nunca some da barra",
  abaPorId("inicio").configuravel === false &&
    podeVerAba("inicio", OPERADOR, TUDO_FECHADO),
);

// --- o padrão é ABERTO, em todas as formas de "não sei" -------------------
const TORTOS = [
  undefined,
  null,
  0,
  "",
  "restrito",
  [],
  {},
  { abas: null },
  { abas: "tudo" },
  { abas: [] },
  { abas: { dashboard: null } },
  { abas: { dashboard: "restrito" } },
  { abas: { dashboard: {} } },
  { abas: { naoExisteEssaAba: { modo: "restrito" } } },
];
checa(
  "documento torto nunca tranca ninguém fora do que já via",
  TORTOS.every((t) =>
    podeVerAba("dashboard", OPERADOR, normalizarPermissoes(t)),
  ),
  `${TORTOS.length} entradas`,
);

// ONDE O PADRÃO ABERTO PARA. `modo` ilegível vira "todos" (acima); `modo`
// LEGÍVEL vale, mesmo que a lista ao lado dele não dê para ler. A diferença é
// que aqui alguém DISSE "restrito" — cair em "todos" seria abrir uma aba que
// foi mandada fechar, e o motivo do padrão aberto (não trancar o app inteiro)
// não se aplica: admin atravessa a regra e conserta, o que o teste do topo
// deste arquivo garante.
const LISTA_ILEGIVEL = normalizarPermissoes({
  abas: { dashboard: { modo: "restrito", setores: "B.I." } },
});
checa(
  "modo legível com lista ilegível FECHA a aba — e o admin continua entrando",
  !podeVerAba("dashboard", GESTOR, LISTA_ILEGIVEL) &&
    podeVerAba("dashboard", ADMIN, LISTA_ILEGIVEL),
);
checa(
  "modo desconhecido cai em 'todos', e não em 'restrito'",
  normalizarPermissoes({ abas: { kanban: { modo: "so-o-chefe" } } }).abas.kanban
    .modo === "todos",
);
checa(
  "aba fora do catálogo é descartada na leitura",
  !("naoExisteEssaAba" in
    normalizarPermissoes({ abas: { naoExisteEssaAba: { modo: "restrito" } } })
      .abas),
);
checa(
  "lista com lixo dentro vira lista de textos, sem duplicata",
  JSON.stringify(
    normalizarPermissoes({
      abas: {
        kanban: {
          modo: "restrito",
          setores: ["B.I.", "B.I.", " B.I. ", 7, null, "", "  "],
        },
      },
    }).abas.kanban.setores,
  ) === '["B.I."]',
);

// --- a união: setor OU pessoa ---------------------------------------------
checa(
  "restrito ao setor B.I.: quem é de B.I. entra",
  podeVerAba("dashboard", GESTOR, SO_BI),
);
checa(
  "restrito ao setor B.I.: quem é do Comercial não entra",
  !podeVerAba("dashboard", OPERADOR, SO_BI),
);
checa(
  "a restrição de UMA aba não respinga nas outras",
  podeVerAba("kanban", OPERADOR, SO_BI) &&
    podeVerAba("links", OPERADOR, SO_BI),
);
const SO_ELE = normalizarPermissoes({
  abas: {
    dashboard: { modo: "restrito", setores: [], pessoas: [OPERADOR.email] },
  },
});
checa(
  "restrito à pessoa: ela entra mesmo sem estar no setor",
  podeVerAba("dashboard", OPERADOR, SO_ELE) &&
    !podeVerAba("dashboard", GESTOR, SO_ELE),
);
checa(
  "setor e pessoa somam (união), não se exigem (interseção)",
  (() => {
    const p = normalizarPermissoes({
      abas: {
        dashboard: {
          modo: "restrito",
          setores: ["B.I."],
          pessoas: [OPERADOR.email],
        },
      },
    });
    return podeVerAba("dashboard", GESTOR, p) && podeVerAba("dashboard", OPERADOR, p);
  })(),
);
checa(
  "quem não tem setor nenhum não entra por setor",
  !podeVerAba("dashboard", { ...GESTOR, sectors: [] }, SO_BI) &&
    !podeVerAba("dashboard", { ...GESTOR, sectors: null }, SO_BI),
);

// --- caixa do e-mail ------------------------------------------------------
// O e-mail do token vem do Google na caixa que ele quiser, e o doc de /users é
// minúsculo. É o mesmo cuidado que `souEu()` tem em firestore.rules — aqui o
// preço de errar é a pessoa liberada na tela de Admin não ver a aba liberada.
checa(
  "e-mail escrito com maiúscula na regra libera a mesma pessoa",
  podeVerAba(
    "dashboard",
    OPERADOR,
    normalizarPermissoes({
      abas: {
        dashboard: { modo: "restrito", pessoas: ["OP@Christus.Edu.Br"] },
      },
    }),
  ),
);
checa(
  "e-mail com maiúscula no token também casa",
  podeVerAba("dashboard", { ...OPERADOR, email: "OP@CHRISTUS.EDU.BR" }, SO_ELE),
);
checa(
  "e-mail vazio não casa com regra de lista vazia por acidente",
  !podeVerAba(
    "dashboard",
    { email: "", role: "operador", sectors: [] },
    normalizarPermissoes({
      abas: { dashboard: { modo: "restrito", pessoas: [] } },
    }),
  ),
);

// --- sem pessoa, sem aba --------------------------------------------------
checa(
  "sem perfil ninguém vê aba nenhuma",
  !podeVerAba("kanban", null, PERMISSOES_ABERTAS) &&
    !podeVerAba("kanban", undefined, PERMISSOES_ABERTAS) &&
    abasVisiveis(null, PERMISSOES_ABERTAS).length === 0,
);
checa(
  "aba que não existe é sempre negada, para qualquer papel",
  !podeVerAba("financeiro", ADMIN, PERMISSOES_ABERTAS),
);

// --- o aviso da tela ------------------------------------------------------
checa(
  "regraFechadaParaTodos só acusa o restrito com as duas listas vazias",
  regraFechadaParaTodos({ modo: "restrito", setores: [], pessoas: [] }) &&
    !regraFechadaParaTodos({ modo: "restrito", setores: ["B.I."], pessoas: [] }) &&
    !regraFechadaParaTodos({ modo: "restrito", setores: [], pessoas: ["a@b.c"] }) &&
    !regraFechadaParaTodos(regraPadrao()),
);

// --- o casamento rota → aba ----------------------------------------------
checa(
  "'/' é Início, e só ele",
  abaDaRota("/").id === "inicio" && abaDaRota("/kanban").id === "kanban",
);
checa(
  "subcaminho e query pertencem à aba de onde saíram",
  abaDaRota("/relatorios/abc123").id === "relatorios" &&
    abaDaRota("/kanban?setor=B.I.&card=x").id === "kanban",
);
checa(
  "rota fora do catálogo não é aba nenhuma (e por isso não é negada)",
  abaDaRota("/qualquer-coisa") === undefined,
);
checa(
  "toda aba do catálogo se reconhece pela própria href",
  ABAS.every((a) => abaDaRota(a.href)?.id === a.id),
);

// --- catálogo × páginas em disco ------------------------------------------
// A barra do topo é desenhada SÓ a partir de `ABAS`. Uma página que exista sem
// entrada aqui não tem como ser alcançada pela navegação; uma entrada sem
// página leva a um 404 com a aba marcada como ativa. Nenhum dos dois é erro de
// tipo, de lint ou de build — só de gente abrindo o app.
const daqui = dirname(fileURLToPath(import.meta.url));
const raizApp = join(daqui, "..", "src", "app", "(app)");
const pastas = readdirSync(raizApp, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const semPagina = ABAS.filter(
  (a) => a.href !== "/" && !existsSync(join(raizApp, a.href.slice(1), "page.tsx")),
);
checa(
  "toda aba do catálogo tem page.tsx em disco",
  semPagina.length === 0,
  semPagina.map((a) => a.href).join(", ") || "nenhuma faltando",
);

const semAba = pastas.filter((p) => !ABAS.some((a) => a.href === `/${p}`));
checa(
  "toda página em (app)/ está no catálogo de abas",
  semAba.length === 0,
  semAba.join(", ") || "nenhuma sobrando",
);

console.log(
  falhas === 0
    ? "\npermissões: ok"
    : `\npermissões: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
