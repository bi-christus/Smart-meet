/**
 * Testes da organização do acervo de reuniões (`lib/acervo-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que nenhum outro portão protege:
 *
 * 1. QUE NENHUMA REUNIÃO SOME. Agrupar é o tipo de regra que erra calada: uma
 *    data vazia que não cai em mês nenhum, um "b.i." que vira seção própria com
 *    uma reunião só — a tela continua bonita e a reunião fica onde ninguém
 *    procura. A soma das seções e dos meses tem de dar o total, sempre.
 * 2. QUE A TELA NÃO INVENTA PASTA. As seções saem das reuniões, nunca da lista
 *    de setores da pessoa: o admin vê 7 setores e só 4 têm reunião.
 * 3. QUE A ORDEM NÃO MUDA ENTRE UM F5 E OUTRO. Duas reuniões no mesmo dia (22
 *    pares assim em produção, em 26/11/2026) saem pela ordem do título, e não
 *    pela que o Firestore devolveu naquela carga.
 * 4. QUE QUEM TEM UM SETOR SÓ NÃO GANHA UM CLIQUE A MAIS. 9 das 14 pessoas
 *    veem um setor; para elas o nível de setor e o filtro somem.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  SEM_DATA,
  diaDaReuniao,
  mesDaReuniao,
  montarAcervo,
  porMes,
  rotuloDoMes,
} from "../src/lib/acervo-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}
let n = 0;
const r = (sector, date, title = `Reunião ${++n}`) => ({ id: `r${n}`, sector, date, title });
const ids = (lista) => lista.map((x) => x.title).join(" | ");
const contar = (meses) => meses.reduce((s, m) => s + m.itens.length, 0);

console.log("\n— o mês e o dia de uma data —");

checa("aaaa-mm-dd vira aaaa-mm", mesDaReuniao("2026-11-25") === "2026-11");
checa("data vazia vai para o balde", mesDaReuniao("") === SEM_DATA);
checa("data ausente (documento antigo) vai para o balde", mesDaReuniao(undefined) === SEM_DATA);
checa("data torta vai para o balde", ["25/11/2026", "2026-13-01", "2026-11", "ontem"].every((d) => mesDaReuniao(d) === SEM_DATA));
checa('o rótulo é "Novembro de 2026"', rotuloDoMes("2026-11") === "Novembro de 2026");
checa('o balde chama "Sem data"', rotuloDoMes(SEM_DATA) === "Sem data");
checa('o dia sai "25 nov", sem o ano', diaDaReuniao("2026-11-25") === "25 nov");
checa("dia de data vazia é null, não lixo", diaDaReuniao("") === null && diaDaReuniao("2026-99-01") === null);

console.log("\n— a ordem dentro do mês —");

{
  const meses = porMes([
    r("B.I.", "2026-11-03", "Orçamento"),
    r("B.I.", "2026-11-10", "Zeladoria"),
    r("B.I.", "2026-11-10", "Almoxarifado"),
    r("B.I.", "2026-11-10", "Árvore de metas"),
    r("B.I.", "2026-10-30", "Fechamento"),
  ]);
  checa("os meses saem do mais recente para o mais antigo", meses.map((m) => m.chave).join(",") === "2026-11,2026-10");
  checa(
    "empate no mesmo dia desfeito pelo título, em pt-BR (Á junto do A)",
    ids(meses[0].itens) === "Almoxarifado | Árvore de metas | Zeladoria | Orçamento",
    ids(meses[0].itens),
  );
  const outra = porMes([...meses[0].itens].reverse());
  checa("a ordem não depende da ordem de chegada", ids(outra[0].itens) === ids(meses[0].itens));
}

console.log("\n— o balde sem data —");

{
  const meses = porMes([
    r("B.I.", "", "Sem dia"),
    r("B.I.", "2026-07-08", "Julho"),
    r("B.I.", undefined, "Antiga sem campo"),
    r("B.I.", "2026-11-25", "Novembro"),
  ]);
  checa("fica sempre no fim", meses.at(-1).chave === SEM_DATA, meses.map((m) => m.chave).join(","));
  checa("e guarda as duas (vazia e ausente)", meses.at(-1).itens.length === 2);
  checa("reunião sem o campo date não derruba a ordenação", contar(meses) === 4);
}

console.log("\n— as seções saem das reuniões —");

// O dado real de 26/11/2026, encolhido: 4 setores com reunião. O admin enxerga
// 7 — e montarAcervo nem recebe essa lista, que é exatamente a garantia.
const real = [
  r("B.I.", "2026-11-24", "Comitê de dados"),
  r("B.I.", "2026-11-24", "Alinhamento B.I."),
  r("B.I.", "2026-09-02", "Painel de vendas"),
  r("b.i.", "2026-08-15", "Digitada à mão"),
  r("Cantinas", "2026-11-12", "Cardápio"),
  r("Cantinas", "2026-10-01", "Fornecedores"),
  r("Infraestrutura", "2026-11-25", "Obra do bloco C"),
  r("Infraestrutura", "2026-09-30", "Manutenção"),
  r("Diretoria", "2026-11-24", "Conselho"),
];
{
  const a = montarAcervo(real);
  checa("4 seções para 4 setores com reunião (não as 7 do cadastro)", a.secoes.length === 4, a.secoes.map((s) => s.setor).join(","));
  checa("há nível de setor", a.porSetor === true);
  checa('"B.I." e "b.i." são uma seção só', a.secoes.filter((s) => s.chave === "bi").length === 1);
  const bi = a.secoes.find((s) => s.chave === "bi");
  checa('o nome da seção é a grafia mais usada ("B.I.", com pontos)', bi.setor === "B.I.", bi.setor);
  checa("e ela tem as 4 reuniões, inclusive a digitada em minúsculas", bi.total === 4 && contar(bi.meses) === 4);
  checa(
    "ordem das seções: a reunião mais recente primeiro (Infra 25/11)",
    a.secoes[0].setor === "Infraestrutura",
    a.secoes.map((s) => s.setor).join(","),
  );
  checa(
    "empate no mesmo dia (B.I. e Diretoria, 24/11) desfeito pelo nome em pt-BR",
    a.secoes.map((s) => s.setor).join(",") === "Infraestrutura,B.I.,Diretoria,Cantinas",
    a.secoes.map((s) => s.setor).join(","),
  );
  checa("os setores do filtro seguem a ordem das seções", a.setores.map((s) => s.setor).join(",") === a.secoes.map((s) => s.setor).join(","));
  checa(
    "nenhuma reunião some: seções somam o total",
    a.secoes.reduce((s, x) => s + contar(x.meses), 0) === real.length,
  );
  checa("e os meses da visão por data também", contar(a.meses) === real.length && a.naVisaoPorData === real.length);
  checa("dentro da seção, os meses vêm por mês", bi.meses.map((m) => m.chave).join(",") === "2026-11,2026-09,2026-08");
}

{
  const so = montarAcervo([r("Cantinas", "", "Sem dia"), r("Diretoria", "2026-01-05", "Antiga")]);
  checa(
    "setor só com reunião sem data vai para o fim da ordem",
    so.secoes.map((s) => s.setor).join(",") === "Diretoria,Cantinas",
    so.secoes.map((s) => s.setor).join(","),
  );
  const torta = montarAcervo([r("Cantinas", "2026-99-99", "Torta"), r("Diretoria", "2026-01-05", "Antiga")]);
  checa("data torta não empurra o setor para o topo", torta.secoes[0].setor === "Diretoria");
}

{
  const fora = montarAcervo([r("Nutrição", "2026-11-01"), r("Setor Que Nunca Existiu", "2026-11-02")]);
  checa("setor fora do cadastro e da tabela de selos aparece normalmente", fora.secoes.length === 2);
}

console.log("\n— pessoa de um setor só —");

{
  const um = montarAcervo(
    [r("Cantinas", "2026-11-12"), r("Cantinas", "2026-10-01"), r("cantinas", "2026-09-01")],
    { setor: "cantinas" },
  );
  checa("sem nível de setor", um.porSetor === false);
  checa("o filtro pedido é ignorado (não há o que filtrar)", um.filtro === null);
  checa("os meses mostram tudo", contar(um.meses) === 3 && um.meses.length === 3);
  checa("acervo vazio também não tem nível de setor", montarAcervo([]).porSetor === false && montarAcervo([]).totalGeral === 0);
}

console.log("\n— o filtro de setor (visão por data) —");

{
  const a = montarAcervo(real, { setor: "cantinas" });
  checa("com o filtro, a visão por data mostra só o setor", a.naVisaoPorData === 2 && a.filtro === "cantinas");
  checa("e as seções continuam inteiras (o filtro é só da outra visão)", a.secoes.length === 4);
  const b = montarAcervo(real, { setor: "livrosescolares" });
  checa("filtro de setor sem reunião cai para Todas, e não para um vazio", b.filtro === null && b.naVisaoPorData === real.length);
}

console.log("\n— a busca —");

{
  const a = montarAcervo(real, { busca: "conselho" });
  checa("acha pelo título", a.encontradas === 1 && a.secoes.length === 1 && a.secoes[0].setor === "Diretoria");
  checa("seção sem resultado sai da tela", !a.secoes.some((s) => s.setor === "B.I."));
  checa("o nível de setor NÃO muda por causa da busca", a.porSetor === true && a.setores.length === 4);
  checa("a seção diz quantas achou e quantas tem", a.secoes[0].encontradas === 1 && a.secoes[0].total === 1);
  const b = montarAcervo(real, { busca: "cantinas" });
  checa("acha pelo setor também", b.encontradas === 2 && b.secoes.length === 1);
  const c = montarAcervo(real, { busca: "  ALINHAMENTO   b.i. " });
  checa("caixa, espaço e ordem das palavras não importam", c.encontradas === 1, String(c.encontradas));
  const d = montarAcervo(real, { busca: "orçamento inexistente" });
  checa("sem resultado: zero seções e zero meses, total geral intacto", d.secoes.length === 0 && d.meses.length === 0 && d.totalGeral === real.length);
  const e = montarAcervo(real, { busca: "manutencao" });
  checa("busca sem acento acha título com acento", e.encontradas === 1);
  const f = montarAcervo(real, { busca: "comitê", setor: "cantinas" });
  checa("busca e filtro juntos: a interseção", f.naVisaoPorData === 0 && f.encontradas === 1);
}

console.log(falhas === 0 ? "\n✅ acervo de reuniões: ok" : `\n❌ acervo de reuniões: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
