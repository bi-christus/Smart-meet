/**
 * Testes do selo do setor (`lib/selo-setor-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que nenhum outro portão protege:
 *
 * 1. QUE O SELO NÃO MUDA SOZINHO. Ele é aprendido: quem lê "triângulo rosa"
 *    por um mês passa a ler Cantinas sem ler o nome. Um hash trocado, uma
 *    entrada da tabela reordenada ou um setor novo empurrando os outros
 *    rebatizam todos os selos de uma vez — e a tela continua bonita, só que
 *    mentindo para quem já tinha aprendido. A tabela fica fotografada aqui.
 * 2. QUE NENHUM PAR SE CONFUNDE. Com 7 tons para 18 setores a cor repete; o
 *    que não pode é forma parecida com tom parecido. Os quatro setores com
 *    reunião hoje têm de ser os mais distintos de todos.
 * 3. QUE "B.I." CONTINUA SENDO "B.I.". O nome tem pontos e é intocável no
 *    banco; "b.i." e "BI" têm de dar o mesmo selo, sem ninguém renomear nada.
 * 4. QUE A FOLHA SABE PINTAR TODO TOM. Seletor de atributo
 *    (`[data-tom="3"]`) não é leitura de classe, e o `check-css-modules` não o
 *    vê; um tom sem regra nasceria na cor do texto, calado. Aqui o tom do core,
 *    a regra de `selo-setor.module.css` e o token de `globals.css` (nos três
 *    temas) são conferidos juntos.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  FORMAS,
  FORMAS_PARECIDAS,
  TABELA,
  TONS,
  TONS_PARECIDOS,
  chaveDoSetor,
  confunde,
  seloDoSetor,
} from "../src/lib/selo-setor-core.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}
const txt = (s) => `${s.forma}:${s.tom}`;

console.log("\n— a chave do nome —");

checa('"B.I.", "b.i." e "BI" dão a mesma chave', ["B.I.", "b.i.", "BI", " b . i "].every((n) => chaveDoSetor(n) === "bi"));
checa("acento e espaço não contam", chaveDoSetor("Medicina Veterinária") === "medicinaveterinaria");
checa("hífen não conta", chaveDoSetor("Serve-cy") === chaveDoSetor("Serve cy"));
checa("nome ausente não derruba", chaveDoSetor(undefined) === "");

console.log("\n— determinístico —");

checa("o mesmo nome dá sempre o mesmo selo", txt(seloDoSetor("Cantinas")) === txt(seloDoSetor("Cantinas")));
checa('"B.I." e "b.i." têm o mesmo selo', txt(seloDoSetor("B.I.")) === txt(seloDoSetor("b.i.")));
checa('"BI" sem pontos cai no selo de "B.I."', txt(seloDoSetor("BI")) === txt(seloDoSetor("B.I.")));
checa("caixa e acento não mudam o selo", txt(seloDoSetor("NUTRICAO")) === txt(seloDoSetor("Nutrição")));

console.log("\n— a tabela fotografada —");

// A tabela de hoje, entrada por entrada. Acrescentar no FIM é permitido;
// mudar, apagar ou reordenar o que já existe reprova — ver o cabeçalho.
const FOTO = [
  "B.I.|circulo|1", "Cantinas|triangulo|2", "Infraestrutura|quadrado|3",
  "Diretoria|losango|4", "Livros Escolares|pilula|5", "Medicina Veterinária|cruz|7",
  "Serve-cy|gota|6", "CESIU|pentagono|3", "CVU|paralelogramo|1",
  "Compras|meialua|2", "Nutrição|triangulo|1", "RH|losango|2", "CPA|gota|5",
  "Odonto|pilula|1", "Comercial|cruz|1", "UnichStore|meialua|3",
  "Pedagógico|triangulo|3", "Financeiro|pilula|4",
];
const atual = TABELA.map((e) => `${e.nome}|${e.forma}|${e.tom}`);
checa(
  "as entradas que já existiam continuam iguais e na mesma ordem",
  FOTO.every((f, i) => atual[i] === f),
  `divergem: ${FOTO.filter((f, i) => atual[i] !== f).join(", ")}`,
);

const chaves = TABELA.map((e) => chaveDoSetor(e.nome));
checa("nenhum nome da tabela repete (depois de normalizado)", new Set(chaves).size === chaves.length);
checa(
  "nenhuma combinação forma × tom repete",
  new Set(TABELA.map(txt)).size === TABELA.length,
);
checa(
  "toda forma e todo tom da tabela existem",
  TABELA.every((e) => FORMAS.includes(e.forma) && e.tom >= 1 && e.tom <= TONS),
);
checa("cada setor da tabela recebe o selo dela", TABELA.every((e) => txt(seloDoSetor(e.nome)) === txt(e)));

const pares = [];
for (let i = 0; i < TABELA.length; i++)
  for (let j = i + 1; j < TABELA.length; j++)
    if (confunde(TABELA[i], TABELA[j])) pares.push(`${TABELA[i].nome} × ${TABELA[j].nome}`);
checa("nenhum par da tabela se confunde (forma E tom parecidos)", pares.length === 0, pares.join("; "));

console.log("\n— os quatro setores com reunião, os mais distintos —");

const ativos = ["B.I.", "Cantinas", "Infraestrutura", "Diretoria"].map(seloDoSetor);
const parecido = (lista, a, b) => lista.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
let formaRuim = [];
let tomRuim = [];
for (let i = 0; i < 4; i++)
  for (let j = i + 1; j < 4; j++) {
    if (ativos[i].forma === ativos[j].forma || parecido(FORMAS_PARECIDAS, ativos[i].forma, ativos[j].forma))
      formaRuim.push(`${ativos[i].forma}×${ativos[j].forma}`);
    if (ativos[i].tom === ativos[j].tom || parecido(TONS_PARECIDOS, ativos[i].tom, ativos[j].tom))
      tomRuim.push(`${ativos[i].tom}×${ativos[j].tom}`);
  }
checa("forma diferente e não parecida entre os quatro", formaRuim.length === 0, formaRuim.join(", "));
checa("tom diferente e não confundível entre os quatro", tomRuim.length === 0, tomRuim.join(", "));

const cadastro = TABELA.slice(0, 7);
checa("os 7 do cadastro têm formas todas diferentes", new Set(cadastro.map((e) => e.forma)).size === 7);
checa("os 7 do cadastro têm tons todos diferentes", new Set(cadastro.map((e) => e.tom)).size === 7);

console.log("\n— setor que ainda não existe —");

const ocupadas = new Set(TABELA.map(txt));
const novos = [
  "Recursos Humanos", "Marketing", "Jurídico", "TI", "Secretaria", "Biblioteca",
  "Ouvidoria", "Almoxarifado", "Transporte", "Eventos", "",
];
for (let i = 0; i < 300; i++) novos.push(`Setor ${i}`);
const colidem = novos.filter((n) => ocupadas.has(txt(seloDoSetor(n))));
checa(
  "nome desconhecido nunca cai numa combinação da tabela",
  colidem.length === 0,
  colidem.slice(0, 5).join(", "),
);
const parecidosComCadastro = novos.filter((n) =>
  TABELA.slice(0, 7).some((v) => confunde(seloDoSetor(n), v)),
);
checa(
  "nem se parece com um dos 7 do cadastro (forma E tom parecidos)",
  parecidosComCadastro.length === 0,
  parecidosComCadastro.slice(0, 5).join(", "),
);
checa(
  "o selo dele é uma forma e um tom válidos",
  novos.every((n) => {
    const s = seloDoSetor(n);
    return FORMAS.includes(s.forma) && Number.isInteger(s.tom) && s.tom >= 1 && s.tom <= TONS;
  }),
);
// O selo de um setor novo depende só do nome dele. Fotografado: se o hash ou a
// sondagem mudarem, estes três trocam de desenho para quem já os via.
const fotoNovos = ["Marketing", "Jurídico", "Ouvidoria"].map((n) => `${n}=${txt(seloDoSetor(n))}`);
console.log(`   (hoje: ${fotoNovos.join(", ")})`);
checa(
  "o hash dos nomes novos continua o mesmo",
  fotoNovos.join(",") === "Marketing=losango:3,Jurídico=paralelogramo:2,Ouvidoria=losango:1",
  fotoNovos.join(","),
);
checa(
  "sobra combinação para a sondagem (a tabela não encheu)",
  TABELA.length < FORMAS.length * TONS,
);
const usos = new Map();
for (let i = 0; i < 300; i++) {
  const k = txt(seloDoSetor(`Setor ${i}`));
  usos.set(k, (usos.get(k) ?? 0) + 1);
}
// 19 é quantas combinações livres não se parecem com nenhum dos 7 do cadastro
// (contado por script em 26/11/2026). Menos que isso é o hash empilhando setores
// novos num canto; mais é a sondagem deixando passar um selo parecido.
checa(
  "o hash espalha: 300 nomes novos usam as 19 combinações seguras",
  usos.size === 19,
  `usou ${usos.size}`,
);

console.log("\n— a folha pinta todo tom —");

const folha = readFileSync(join(RAIZ, "src/components/selo-setor.module.css"), "utf8");
const globais = readFileSync(join(RAIZ, "src/app/globals.css"), "utf8");
const tons = Array.from({ length: TONS }, (_, i) => i + 1);
checa(
  "selo-setor.module.css tem regra para cada tom",
  tons.every((t) => folha.includes(`.glifo[data-tom="${t}"]`) && folha.includes(`var(--setor-${t})`)),
);
checa("e nenhuma para um tom que o core não tem", !folha.includes(`data-tom="${TONS + 1}"`));
for (const [tema, seletor] of [
  ["escuro", /:root,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/g],
  ["claro", /\[data-theme="light"\]\s*\{([^}]*)\}/g],
  ["contraste", /\[data-theme="contraste"\]\s*\{([^}]*)\}/g],
]) {
  const blocos = [...globais.matchAll(seletor)].map((m) => m[1]).filter((b) => b.includes("--setor-"));
  checa(
    `globals.css define --setor-1 a --setor-${TONS} no tema ${tema}`,
    blocos.length === 1 && tons.every((t) => new RegExp(`--setor-${t}:\\s*#[0-9a-f]{6};`, "i").test(blocos[0])),
    `${blocos.length} bloco(s) com --setor-`,
  );
}

console.log(falhas === 0 ? "\n✅ selo do setor: ok" : `\n❌ selo do setor: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
