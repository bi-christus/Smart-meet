/**
 * Testes das divisões da barra lateral.
 *
 * O risco aqui é de SUMIÇO CALADO: uma aba nova entra em `ABAS`, ninguém a põe
 * em nenhuma divisão, e ela deixa de aparecer na navegação sem erro em lugar
 * nenhum — a página existe, o guarda de rota a libera, e não há botão que leve
 * até ela. O primeiro bloco existe para isso.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { ABAS, abasVisiveis, normalizarPermissoes } from "../src/lib/permissoes-core.ts";
import {
  DIVISOES,
  divisaoDaAba,
  divisoesVisiveis,
} from "../src/lib/navegacao-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- o catálogo e as divisões batem ----------------------------------------
const orfas = ABAS.filter(
  (a) => DIVISOES.filter((d) => d.abas.includes(a.id)).length !== 1,
);
checa(
  "toda aba de ABAS está em exatamente uma divisão",
  orfas.length === 0,
  orfas.map((a) => a.id).join(", ") || "nenhuma fora do lugar",
);

const fantasmas = DIVISOES.flatMap((d) => d.abas).filter(
  (id) => !ABAS.some((a) => a.id === id),
);
checa(
  "nenhuma divisão cita aba que não existe",
  fantasmas.length === 0,
  fantasmas.join(", ") || "nenhuma",
);

checa(
  "Início é a primeira divisão e Portfólio a segunda",
  DIVISOES[0].id === "inicio" && DIVISOES[1].id === "portfolio",
);

// --- o que cada pessoa vê ---------------------------------------------------
const ABERTO = normalizarPermissoes({});
const ADMIN = { email: "chefe@christus.edu.br", role: "admin", sectors: [] };
const OPERADOR = { email: "op@christus.edu.br", role: "operador", sectors: ["Comercial"] };

const doAdmin = divisoesVisiveis(abasVisiveis(ADMIN, ABERTO));
checa(
  "admin vê as cinco divisões",
  doAdmin.length === DIVISOES.length,
  doAdmin.map((d) => d.id).join(", "),
);

const doOperador = divisoesVisiveis(abasVisiveis(OPERADOR, ABERTO));
checa(
  "quem não é admin não vê Configurações",
  !doOperador.some((d) => d.id === "configuracoes"),
);

// Kanban fechado para o setor do operador: a divisão Gestão continua, e o link
// dela passa a levar ao Dashboard, que é a primeira aba que sobrou.
const SEM_KANBAN = normalizarPermissoes({
  abas: { kanban: { modo: "restrito", setores: ["B.I."], pessoas: [] } },
});
const gestao = divisoesVisiveis(abasVisiveis(OPERADOR, SEM_KANBAN)).find(
  (d) => d.id === "gestao",
);
checa(
  "divisão leva à primeira aba VISÍVEL dela",
  gestao?.href === "/dashboard" && !gestao.visiveis.some((a) => a.id === "kanban"),
  gestao?.href,
);

const TUDO_REUNIAO_FECHADO = normalizarPermissoes({
  abas: Object.fromEntries(
    ["reunioes", "ata", "relatorios"].map((id) => [
      id,
      { modo: "restrito", setores: [], pessoas: [] },
    ]),
  ),
});
checa(
  "divisão sem nenhuma aba visível some da lateral",
  !divisoesVisiveis(abasVisiveis(OPERADOR, TUDO_REUNIAO_FECHADO)).some(
    (d) => d.id === "reunioes",
  ),
);

checa("divisaoDaAba acha a divisão da Ata", divisaoDaAba("ata")?.id === "reunioes");
checa("divisaoDaAba de aba desconhecida é undefined", divisaoDaAba("xyz") === undefined);

console.log(
  falhas === 0 ? "\nnavegação: ok" : `\nnavegação: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
