/**
 * Testes do cadastro de setores de execução.
 *
 * DUAS CÓPIAS DA MESMA DECISÃO existem, e este arquivo é o que as impede de se
 * afastarem:
 *
 *  1. `src/lib/setores-core.ts` — a régua do nome, em TypeScript.
 *  2. `firestore.rules` — a mesma régua, em CEL.
 *
 * Nenhum outro portão do projeto liga as duas. O `tsc` não lê CEL, e
 * `comparar-regras.mjs` responde se a regra MUDOU de resposta, não se ela
 * concorda com o TypeScript ao lado. Uma divergência aqui é muda: a pessoa
 * digita um nome que a tela aceita, o Firestore nega, e a mensagem na tela é
 * "sem permissão" — que não conta nada do que aconteceu.
 *
 * A parte mais importante do arquivo é a de `setoresVisiveis`: ela é a regra
 * que decide o que NOVE TELAS enxergam, e errar para o lado frouxo mostra
 * demanda de setor alheio.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LIMITE_SETOR_CHARS,
  SETORES_SEMENTE,
  conferirNomeDeSetor,
  nomesDosSetores,
  normalizarSetores,
  setorExistente,
  setoresOferecidos,
  setoresVisiveis,
} from "../src/lib/setores-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log("\n— o piso —");

checa("o piso não é vazio", SETORES_SEMENTE.length > 0);
checa(
  "o piso é a grafia que está no banco",
  SETORES_SEMENTE.includes("B.I."),
  SETORES_SEMENTE.join(", "),
);

console.log("\n— a régua do nome —");

checa("nome comum passa", conferirNomeDeSetor("Diretoria").ok);
checa(
  "o nome volta aparado",
  conferirNomeDeSetor("  Diretoria  ").nome === "Diretoria",
);
checa("vazio é recusado", !conferirNomeDeSetor("").ok);
checa("só espaço é recusado", !conferirNomeDeSetor("   ").ok);
checa("o que não é texto é recusado", !conferirNomeDeSetor(undefined).ok);
checa("número é recusado", !conferirNomeDeSetor(42).ok);
checa(
  "o teto de caracteres é respeitado",
  conferirNomeDeSetor("x".repeat(LIMITE_SETOR_CHARS)).ok,
);
checa(
  "um caractere além do teto é recusado",
  !conferirNomeDeSetor("x".repeat(LIMITE_SETOR_CHARS + 1)).ok,
);
// Acento conta como um caractere para o `.length` do JS e para o `size()` do
// CEL. Se um dia contarem diferente, é por esta linha que se descobre.
checa(
  "nome acentuado longo é medido igual nos dois lados",
  conferirNomeDeSetor("ç".repeat(LIMITE_SETOR_CHARS)).ok &&
    !conferirNomeDeSetor("ç".repeat(LIMITE_SETOR_CHARS + 1)).ok,
);
checa(
  "a recusa explica o motivo",
  typeof conferirNomeDeSetor("").motivo === "string" &&
    conferirNomeDeSetor("").motivo.length > 0,
);

console.log("\n— duplicata —");

const cadastro = [
  { id: "a", nome: "Compras" },
  { id: "b", nome: "Diretoria" },
];
checa("acha o igual", setorExistente("Compras", cadastro)?.id === "a");
checa(
  "acha o igual sem diferenciar caixa",
  setorExistente("compras", cadastro)?.id === "a",
);
checa(
  "acha o igual com espaço sobrando",
  setorExistente("  COMPRAS ", cadastro)?.id === "a",
);
checa("não inventa o que não tem", setorExistente("RH", cadastro) === undefined);

console.log("\n— a leitura da coleção —");

const bruto = [
  { id: "1", nome: "  RH  " },
  { id: "2", nome: "Compras" },
  { id: "3", nome: "compras" }, // duplicata por caixa
  { id: "4", nome: "" }, // vazio
  { id: "5", nome: 7 }, // tipo errado
  { id: "6" }, // sem nome
  { nome: "Sem id" }, // sem id
  null,
  "texto solto",
  { id: "7", nome: "Pós-graduação" },
  { id: "8", nome: "Processos" },
];
const lidos = normalizarSetores(bruto);
checa(
  "documento quebrado não derruba a lista",
  lidos.length === 4,
  JSON.stringify(lidos),
);
checa("o nome volta aparado", lidos.some((s) => s.nome === "RH"));
checa(
  "duplicata por caixa entra uma vez só",
  lidos.filter((s) => s.nome.toLowerCase() === "compras").length === 1,
);
checa(
  "a ordem é pt-BR, e não a tabela de código",
  nomesDosSetores(lidos).join("|") === "Compras|Pós-graduação|Processos|RH",
  nomesDosSetores(lidos).join("|"),
);
checa("o que não é lista vira lista vazia", normalizarSetores(null).length === 0);
checa("objeto solto vira lista vazia", normalizarSetores({}).length === 0);

console.log("\n— quem enxerga o quê —");

const TODOS = ["B.I.", "Compras", "Diretoria"];

checa("sem pessoa, nada", setoresVisiveis(null, TODOS).length === 0);
checa(
  "sem pessoa, nada (undefined)",
  setoresVisiveis(undefined, TODOS).length === 0,
);
checa(
  "admin vê o cadastro inteiro, e não o próprio `sectors`",
  setoresVisiveis({ role: "admin", sectors: ["B.I."] }, TODOS).join("|") ===
    TODOS.join("|"),
);
// A linha que impede o desastre: cadastro que ainda não chegou não pode apagar
// a tela do admin — é ele quem conserta o cadastro.
checa(
  "admin com cadastro vazio cai no piso, nunca em lista vazia",
  setoresVisiveis({ role: "admin", sectors: [] }, []).join("|") ===
    SETORES_SEMENTE.join("|"),
);
checa(
  "gestor vê só o `sectors` dele",
  setoresVisiveis({ role: "gestor", sectors: ["Diretoria"] }, TODOS).join("|") ===
    "Diretoria",
);
checa(
  "operador vê só o `sectors` dele",
  setoresVisiveis({ role: "operador", sectors: ["B.I."] }, TODOS).join("|") ===
    "B.I.",
);
// O cadastro OFERECE, não PERMITE. Apagar a linha não pode trancar quem já
// está no setor — quem permite é `firestore.rules`.
checa(
  "setor fora do cadastro continua visível para quem está nele",
  setoresVisiveis({ role: "gestor", sectors: ["Apagado"] }, TODOS).join("|") ===
    "Apagado",
);
checa(
  "não-admin sem setor nenhum vê lista vazia, e não o piso",
  setoresVisiveis({ role: "operador", sectors: [] }, TODOS).length === 0,
);
checa(
  "`sectors` ausente vira lista vazia, e não erro",
  setoresVisiveis({ role: "operador" }, TODOS).length === 0,
);
checa(
  "papel desconhecido não vira admin",
  setoresVisiveis({ role: "diretor", sectors: ["X"] }, TODOS).join("|") === "X",
);
checa(
  "o resultado é uma cópia, e não o array do cadastro",
  setoresVisiveis({ role: "admin" }, TODOS) !== TODOS,
);

console.log("\n— o que o formulário oferece —");

checa(
  "oferece o cadastro",
  setoresOferecidos(TODOS, []).join("|") === "B.I.|Compras|Diretoria",
);
checa(
  "oferece também o que já está gravado e saiu do cadastro",
  setoresOferecidos(TODOS, ["Apagado"]).includes("Apagado"),
);
checa(
  "não repete o que já está no cadastro",
  setoresOferecidos(TODOS, ["Compras"]).filter((s) => s === "Compras")
    .length === 1,
);
checa(
  "cadastro vazio cai no piso",
  setoresOferecidos([], []).join("|") === SETORES_SEMENTE.join("|"),
);
checa(
  "gravado em branco não vira opção",
  !setoresOferecidos(TODOS, ["  "]).includes("  "),
);

console.log("\n— o core é puro —");

const fonte = readFileSync(join(raiz, "src/lib/setores-core.ts"), "utf8");
checa(
  "nada de firebase dentro do core (AGENTS.md §4)",
  !/from\s+["']firebase/.test(fonte),
);
checa("nada de react dentro do core", !/from\s+["']react["']/.test(fonte));

console.log("\n— o TypeScript e a regra do Firestore concordam —");

const rules = readFileSync(join(raiz, "firestore.rules"), "utf8");
const bloco = rules.match(/match \/setores\/\{[\s\S]*?\n {4}\}/);
checa("existe bloco /setores nas regras", Boolean(bloco));
if (bloco) {
  const teto = bloco[0].match(/size\(\) <= (\d+)/);
  checa(
    "o teto de caracteres da regra é o mesmo do core",
    teto ? Number(teto[1]) === LIMITE_SETOR_CHARS : false,
    teto ? `regra=${teto[1]} core=${LIMITE_SETOR_CHARS}` : "não achei o teto",
  );
  checa(
    "qualquer usuário ativo lê o cadastro",
    /allow read: if isAuthorized\(\);/.test(bloco[0]),
  );
  checa(
    "só admin escreve no cadastro",
    /allow create: if isAdmin\(\)/.test(bloco[0]) &&
      /allow update, delete: if isAdmin\(\);/.test(bloco[0]),
  );
  checa(
    "a regra recusa nome vazio, como o core",
    /!= ''/.test(bloco[0]),
    bloco[0],
  );
}

console.log(falhas === 0 ? "\nsetores: ok" : `\nsetores: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
