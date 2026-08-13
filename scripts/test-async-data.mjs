/**
 * Testes da separação entre "carregando", "vazio" e "erro".
 *
 * Errar aqui não aparece como erro na tela: aparece como a tela mentindo. O app
 * inteiro dizia "Nenhuma demanda" enquanto o Firestore ainda respondia, e
 * continuava dizendo isso para sempre quando a permissão era negada — porque
 * falha virava lista vazia. As asserções abaixo são o que impede as três
 * situações de voltarem a ser a mesma coisa.
 *
 * A asserção que carrega o valor deste módulo é a segunda: snapshot vazio TEM
 * de resultar em vazio de verdade. Sem ela, "carregando" e "vazio" voltam a ser
 * indistinguíveis e o módulo não serve para nada.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  aplicarDados,
  aplicarErro,
  estadoInicial,
  juntarFontes,
  lerEstado,
} from "../src/lib/async-data-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- o começo: ninguém respondeu ainda -------------------------------------
const inicial = estadoInicial("B.I.");
checa(
  "estado inicial nao e lista vazia, e ausencia de resposta",
  inicial.data === undefined && inicial.erro === null,
  JSON.stringify(inicial),
);

// --- a asserção que separa os dois estados ---------------------------------
const vazio = aplicarDados(inicial, "B.I.", []);
checa(
  "snapshot vazio e vazio DE VERDADE, nao 'carregando'",
  Array.isArray(vazio.data) && vazio.data.length === 0,
  JSON.stringify(vazio.data),
);

const comDados = aplicarDados(inicial, "B.I.", [{ id: "c1" }]);
checa(
  "a chave atual le o que chegou",
  lerEstado(comDados, "B.I.").data?.length === 1,
);

// --- trocar de setor volta a carregando, SEM setState ----------------------
checa(
  "trocou de setor: o dado do setor antigo e descartado no render",
  lerEstado(comDados, "RH").data === undefined,
);
checa(
  "e o erro do setor antigo tambem nao vaza para o novo",
  lerEstado(aplicarErro(inicial, "B.I.", new Error("x")), "RH").erro === null,
);

// --- erro nao vira lista vazia ---------------------------------------------
const comErro = aplicarErro(comDados, "B.I.", new Error("permission-denied"));
const lidoComErro = lerEstado(comErro, "B.I.");
checa(
  "o erro chega ate a tela",
  lidoComErro.erro?.message === "permission-denied",
  String(lidoComErro.erro?.message),
);
checa(
  "e NAO se disfarca de lista vazia — isto e o que a tela mentia antes",
  lidoComErro.data === undefined,
  JSON.stringify(lidoComErro.data),
);

// --- a reconexão do Firestore reabre a tela --------------------------------
const reconectou = aplicarDados(comErro, "B.I.", [{ id: "c1" }, { id: "c2" }]);
checa(
  "snapshot novo depois de erro limpa o erro",
  reconectou.erro === null && reconectou.data?.length === 2,
  JSON.stringify({ erro: reconectou.erro, n: reconectou.data?.length }),
);

// --- snapshot atrasado de assinatura ja fechada ----------------------------
const atrasado = aplicarDados(estadoInicial("RH"), "B.I.", [{ id: "velho" }]);
checa(
  "snapshot atrasado da chave antiga nao pinta na tela da chave atual",
  lerEstado(atrasado, "RH").data === undefined,
);

// --- painel que le de mais de uma assinatura -------------------------------
const chegou = { data: [{ id: "c1" }], erro: null };
const esperando = { data: undefined, erro: null };
const falhou = { data: undefined, erro: new Error("permission-denied") };

checa(
  "todas as fontes chegaram: o painel desenha",
  juntarFontes([chegou, { data: [], erro: null }]).carregando === false,
);
checa(
  "uma fonte que ainda nao respondeu segura o painel inteiro",
  juntarFontes([chegou, esperando]).carregando === true,
);
checa(
  "fonte vazia NAO e fonte pendente — [] ja e resposta",
  juntarFontes([{ data: [], erro: null }]).carregando === false,
);
checa(
  "painel sem fonte nenhuma nao fica preso em carregando",
  juntarFontes([]).carregando === false && juntarFontes([]).erro === null,
);

// A ordem das duas perguntas e o que impede o esqueleto eterno: quem falhou
// tambem esta com `data === undefined`, entao perguntar "carregando?" primeiro
// esconderia o erro para sempre.
const misto = juntarFontes([esperando, falhou]);
checa(
  "com uma fonte falhada e outra pendente, o ERRO ganha — nao o esqueleto",
  misto.erro?.message === "permission-denied" && misto.carregando === false,
  JSON.stringify({ erro: misto.erro?.message, carregando: misto.carregando }),
);
checa(
  "e o erro que chega e o da fonte que falhou, nao um generico",
  juntarFontes([chegou, falhou]).erro?.message === "permission-denied",
);

console.log(
  falhas === 0
    ? "\nTodos os testes de estado assincrono passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
