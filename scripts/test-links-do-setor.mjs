/**
 * Testes do cadastro da aba Links.
 *
 * O que dá errado aqui não aparece como erro na tela:
 *
 *  - A RÉGUA DO FORMULÁRIO e a da REGRA discordando. Se o core aceita 81
 *    caracteres e a regra só 80, a pessoa clica em salvar e lê "sem permissão"
 *    tendo permissão — e nada no código aponta para o número.
 *  - A DUPLICATA. O mesmo painel cadastrado duas vezes, uma com `https://` e
 *    outra sem, divide quem procura entre dois cards que parecem diferentes.
 *  - O DOCUMENTO TORTO. Um só, gravado pelo console, não pode deixar a aba
 *    inteira em branco.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LIMITE_DESCRICAO_LINK,
  LIMITE_NOME_LINK,
  LIMITE_URL_LINK,
  casaBusca,
  conferirLink,
  conflitoDeLink,
  normalizarLinkDoSetor,
  ordenarLinks,
} from "../src/lib/links-do-setor-core.ts";
import { iconeDoLink } from "../src/lib/icones-core.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

/** Um link gravado, com o mínimo que a tela lê. */
function link(id, nome, url, setor = "B.I.", extra = {}) {
  return {
    id,
    setor,
    nome,
    descricao: "",
    url,
    createdBy: "op@px.com.br",
    createdAt: 1786000000000,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
console.log("— o formulário —");

{
  const r = conferirLink({
    nome: "  Painel de vendas  ",
    descricao: "  Vendas por unidade, atualizado às 6h.  ",
    url: "app.powerbi.com/groups/me/reports/123",
  });
  checa("cadastro completo passa", r.ok === true);
  checa(
    "nome e descrição saem aparados",
    r.ok && r.dados.nome === "Painel de vendas" &&
      r.dados.descricao === "Vendas por unidade, atualizado às 6h.",
  );
  checa(
    "o endereço sai normalizado pela MESMA régua do link da demanda",
    r.ok && r.dados.url === "https://app.powerbi.com/groups/me/reports/123",
    r.ok ? r.dados.url : "",
  );
}

{
  const r = conferirLink({ nome: "Pasta", url: "drive.google.com/x" });
  checa("descrição é opcional", r.ok === true && r.dados.descricao === "");
}

{
  const r = conferirLink({ nome: "", url: "drive.google.com/x" });
  checa("sem nome não passa, e o campo apontado é o nome", !r.ok && r.campo === "nome");
}
{
  // O espaço inquebrável é o que o `trim()` do CEL não apara. A pergunta é
  // "tem letra ou dígito?", e as duas linguagens respondem igual.
  const r = conferirLink({ nome: " ", url: "drive.google.com/x" });
  checa("nome feito só de espaço inquebrável não passa", !r.ok && r.campo === "nome");
}
{
  const r = conferirLink({ nome: "...", url: "drive.google.com/x" });
  checa("nome só de pontuação não passa", !r.ok && r.campo === "nome");
}
{
  const r = conferirLink({ nome: "a".repeat(LIMITE_NOME_LINK), url: "x.com" });
  checa("nome no teto passa", r.ok === true);
  const r2 = conferirLink({ nome: "a".repeat(LIMITE_NOME_LINK + 1), url: "x.com" });
  checa("nome acima do teto não passa", !r2.ok && r2.campo === "nome");
}
{
  // 79 letras + um emoji = 81 unidades UTF-16. A regra conta a mesma unidade,
  // e é isso que faz os dois lados recusarem o mesmo nome.
  const r = conferirLink({ nome: "a".repeat(79) + "\u{1f600}", url: "x.com" });
  checa("o teto conta unidades UTF-16, como `size()` da regra", !r.ok && r.campo === "nome");
}

{
  const r = conferirLink({ nome: "Painel", url: "" });
  checa("sem endereço não passa, e o campo apontado é a URL", !r.ok && r.campo === "url");
}
{
  const r = conferirLink({ nome: "Painel", url: "javascript:alert(1)" });
  checa("javascript: é recusado (o valor vai para um href)", !r.ok && r.campo === "url");
}
{
  const r = conferirLink({ nome: "Painel", url: "reunião de terça" });
  checa("texto solto não vira link", !r.ok && r.campo === "url");
}
{
  const longa = "https://x.com/" + "a".repeat(LIMITE_URL_LINK);
  const r = conferirLink({ nome: "Painel", url: longa });
  checa("endereço acima do teto não passa", !r.ok && r.campo === "url");
}

{
  const r = conferirLink({
    nome: "Painel",
    url: "x.com",
    descricao: "a".repeat(LIMITE_DESCRICAO_LINK),
  });
  checa("descrição no teto passa", r.ok === true);
  const r2 = conferirLink({
    nome: "Painel",
    url: "x.com",
    descricao: "a".repeat(LIMITE_DESCRICAO_LINK + 1),
  });
  checa("descrição acima do teto não passa", !r2.ok && r2.campo === "descricao");
}

{
  const r = conferirLink({ nome: "", url: "javascript:x" });
  checa(
    "com dois campos errados, aponta o primeiro do formulário (o nome)",
    !r.ok && r.campo === "nome",
  );
}

// ---------------------------------------------------------------------------
console.log("\n— a duplicata —");

{
  const existentes = [
    link("a", "Painel de vendas", "https://app.powerbi.com/r/1"),
    link("b", "Pasta do orçamento", "https://drive.google.com/x", "Cantinas"),
  ];

  const porEndereco = conflitoDeLink(
    { nome: "Outro nome", url: "app.powerbi.com/r/1" },
    "B.I.",
    existentes,
  );
  checa(
    "mesmo endereço, colado sem https, é duplicata — e o campo apontado é a URL",
    porEndereco?.campo === "url",
  );
  checa(
    "a frase diz com que nome ele já está cadastrado",
    (porEndereco?.motivo ?? "").includes("Painel de vendas"),
  );
  checa(
    "mesmo nome, com outra caixa e espaço sobrando, é duplicata — e o campo é o nome",
    conflitoDeLink({ nome: "  painel DE vendas ", url: "https://y.com" }, "B.I.", existentes)
      ?.campo === "nome",
  );
  checa(
    "o mesmo endereço em OUTRO setor não conta — eles nem se enxergam",
    conflitoDeLink({ nome: "Pasta", url: "drive.google.com/x" }, "B.I.", existentes) === null,
  );
  checa(
    "na edição, o próprio link não é duplicata de si mesmo",
    conflitoDeLink(
      { nome: "Painel de vendas", url: "https://app.powerbi.com/r/1" },
      "B.I.",
      existentes,
      "a",
    ) === null,
  );
  checa(
    "nome e endereço novos passam",
    conflitoDeLink({ nome: "Novo", url: "https://z.com" }, "B.I.", existentes) === null,
  );
}

// ---------------------------------------------------------------------------
console.log("\n— o documento lido —");

checa("documento sem nome é descartado", normalizarLinkDoSetor("x", { setor: "B.I.", url: "https://x.com" }) === null);
checa("documento sem setor é descartado", normalizarLinkDoSetor("x", { nome: "A", url: "https://x.com" }) === null);
checa("lixo não derruba nada", normalizarLinkDoSetor("x", "texto") === null && normalizarLinkDoSetor("x", null) === null);

{
  const l = normalizarLinkDoSetor("x", {
    setor: "B.I.",
    nome: "Painel",
    url: "javascript:alert(1)",
    createdBy: "op@px.com.br",
    createdAt: 1786000000000,
  });
  checa(
    "endereço inválido NÃO descarta — o card aparece e pode ser consertado",
    l !== null && l.url === "javascript:alert(1)",
  );
}
{
  const l = normalizarLinkDoSetor("x", { setor: "B.I.", nome: "A", url: "https://x.com", descricao: 42 });
  checa("descrição que não é texto vira vazio, nunca undefined", l?.descricao === "");
}
{
  const l = normalizarLinkDoSetor("x", { setor: "B.I.", nome: "A", url: "https://x.com" });
  checa(
    "sem ícone, a chave nem existe (o SDK recusa `undefined` numa escrita)",
    l !== null && !("icone" in l) && !("updatedBy" in l),
  );
  checa("data ausente vira null, não NaN", l?.createdAt === null);
}
{
  const l = normalizarLinkDoSetor("x", {
    setor: "B.I.",
    nome: "A",
    url: "https://docs.google.com/spreadsheets/d/1",
    icone: "trend",
  });
  checa("o ícone escolhido chega ao selo", iconeDoLink(l) === "trend");
  const semEscolha = normalizarLinkDoSetor("y", {
    setor: "B.I.",
    nome: "A",
    url: "https://docs.google.com/spreadsheets/d/1",
  });
  checa(
    "sem escolha, o selo deduz pela URL como o link da demanda",
    iconeDoLink(semEscolha) === iconeDoLink({ url: "https://docs.google.com/spreadsheets/d/1" }),
  );
}

// ---------------------------------------------------------------------------
console.log("\n— a ordem e a busca —");

{
  const ordem = ordenarLinks([
    link("3", "planilha de custos", "https://a.com"),
    link("1", "Ágil", "https://b.com"),
    link("2", "agenda", "https://c.com"),
    link("4", "Base", "https://d.com"),
  ]).map((l) => l.nome);
  checa(
    "alfabética, sem separar caixa nem acento",
    ordem.join("|") === "agenda|Ágil|Base|planilha de custos",
    ordem.join("|"),
  );
}
{
  const a = ordenarLinks([link("b", "Painel", "https://a.com"), link("a", "Painel", "https://b.com", "RH")]);
  const b = ordenarLinks([link("a", "Painel", "https://b.com", "RH"), link("b", "Painel", "https://a.com")]);
  checa(
    "nome empatado desempata pelo id, e a ordem não depende da chegada",
    a.map((l) => l.id).join() === "a,b" && b.map((l) => l.id).join() === "a,b",
  );
}

{
  const l = link("1", "Vendas por unidade", "https://app.powerbi.com/r/1", "B.I.", {
    descricao: "Relatório de manutenção predial",
  });
  checa("busca pelo nome", casaBusca(l, "vendas"));
  checa("busca pela descrição", casaBusca(l, "predial"));
  checa("busca sem acento acha com acento", casaBusca(l, "manutencao"));
  checa("busca pelo domínio", casaBusca(l, "powerbi.com"));
  checa("busca pelo serviço, mesmo fora do nome", casaBusca(l, "power bi"));
  checa("busca vazia não filtra", casaBusca(l, "   "));
  checa("o que não está em lugar nenhum não casa", !casaBusca(l, "orçamento"));
}

// ---------------------------------------------------------------------------
console.log("\n— o core é puro —");

const fonte = readFileSync(join(raiz, "src/lib/links-do-setor-core.ts"), "utf8");
checa("nada de firebase dentro do core (AGENTS.md §4)", !/from\s+["']firebase/.test(fonte));
checa("nada de react dentro do core", !/from\s+["']react["']/.test(fonte));

// ---------------------------------------------------------------------------
console.log("\n— o TypeScript e a regra do Firestore concordam —");

const rules = readFileSync(join(raiz, "firestore.rules"), "utf8");
const bloco = rules.match(/match \/links\/\{[\s\S]*?\n {4}\}/);
checa("existe bloco /links nas regras", Boolean(bloco));
if (bloco) {
  const b = bloco[0];
  const teto = (campo) => {
    const m = b.match(new RegExp(`${campo}\\.size\\(\\) <= (\\d+)`));
    return m ? Number(m[1]) : null;
  };
  checa(
    "o teto do nome é o mesmo dos dois lados",
    teto("nome") === LIMITE_NOME_LINK,
    `regra=${teto("nome")} core=${LIMITE_NOME_LINK}`,
  );
  checa(
    "o teto da descrição é o mesmo dos dois lados",
    teto("descricao") === LIMITE_DESCRICAO_LINK,
    `regra=${teto("descricao")} core=${LIMITE_DESCRICAO_LINK}`,
  );
  checa(
    "o teto do endereço é o mesmo dos dois lados",
    teto("url") === LIMITE_URL_LINK,
    `regra=${teto("url")} core=${LIMITE_URL_LINK}`,
  );
  checa("quem enxerga o setor lê", /allow read: if podeNoSetor\(cur\('setor'\)\);/.test(b));
  checa("ninguém cria em nome de outro", /souEu\(novo\('createdBy'\)\)/.test(b));
  checa(
    "setor, autor e data de criação são imutáveis no update",
    /!mudou\(\['setor', 'createdBy', 'createdAt'\]\)/.test(b),
  );
  checa("a forma do documento é travada", /keys\(\)\.hasOnly\(/.test(b));
  checa("apagar o link alheio exige gestor", /gestorNoSetor\(cur\('setor'\)\)/.test(b));
}

console.log(falhas === 0 ? "\nlinks do setor: ok" : `\nlinks do setor: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
