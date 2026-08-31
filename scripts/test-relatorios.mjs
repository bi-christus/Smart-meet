/**
 * Testes da organização de "Relatórios IA" (`lib/relatorios-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar a tela nunca prova: que o card está na
 * pasta certa e na ordem certa. Agrupamento errado não deixa rastro visual — a
 * tela continua bonita, as pastas continuam com contagem, tudo parece bem. O
 * defeito só aparece meses depois, quando alguém procura a ata de uma reunião do
 * RH, abre a pasta do RH e não acha.
 *
 * Por isso a maior parte das afirmações aqui é sobre EMPATE e sobre BORDA: duas
 * reuniões no mesmo dia, dois jeitos de escrever o mesmo setor, busca por
 * palavras que estão em campos diferentes.
 */
import {
  casaBusca,
  ordenarRecentes,
  organizar,
} from "../src/lib/relatorios-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const r = (id, title, sector, date) => ({ id, title, sector, date });

const REUNIOES = [
  r("a", "Comitê de orçamento", "B.I.", "2026-08-20"),
  r("b", "Alinhamento de matrículas", "B.I.", "2026-08-20"),
  r("c", "Fechamento de julho", "B.I.", "2026-07-30"),
  r("d", "Plano de cargos", "RH", "2026-08-14"),
  r("e", "Feedback semestral", "RH", "2026-06-02"),
  r("f", "Conselho", "Diretoria", "2026-08-25"),
];
/** Só três estão resolvidas: as outras ainda pedem decisão. */
const RESOLVIDAS = new Set(["c", "e", "d"]);
const resolvida = (x) => RESOLVIDAS.has(x.id);

console.log("\n— o que pede decisão sai das pastas —");

const o = organizar(REUNIOES, resolvida);
// `f` é 25/08. `a` e `b` empatam em 20/08 e o título desempata: "Alinhamento"
// antes de "Comitê" — daí `b` vir antes de `a`, e não a ordem em que entraram.
checa(
  "as pendentes ficam soltas, em evidência e na ordem certa",
  o.pendentes.map((x) => x.id).join(",") === "f,b,a",
  o.pendentes.map((x) => x.id).join(","),
);
checa(
  "TODO item de TODA pasta está resolvido",
  o.pastas.every((p) => p.itens.every(resolvida)),
);
checa("o total conta os dois grupos", o.total === 6, String(o.total));
checa(
  "as pastas somam exatamente as resolvidas",
  o.pastas.reduce((n, p) => n + p.itens.length, 0) === 3,
);

console.log("\n— uma pasta por setor, em ordem de nome —");

checa(
  "só os setores QUE TÊM resolvida viram pasta",
  o.pastas.map((p) => p.setor).join(",") === "B.I.,RH",
  o.pastas.map((p) => p.setor).join(","),
);
// Diretoria tem reunião, mas nenhuma resolvida: pasta vazia na tela seria a
// promessa de um arquivo que não existe.
checa("setor sem nenhuma resolvida NÃO vira pasta vazia", !o.pastas.some((p) => p.setor === "Diretoria"));
checa("e nenhuma pasta nasce vazia", o.pastas.every((p) => p.itens.length > 0));

console.log("\n— o nome do setor sai INTACTO —");

// "B.I." com os pontos é intocável: setor é cadastro, e exibir uma versão
// "limpa" faria esta tela discordar de todas as outras.
checa('"B.I." mantém os pontos no rótulo', o.pastas[0].setor === "B.I.", o.pastas[0].setor);

const misturado = organizar(
  [r("x", "Um", "B.I.", "2026-08-01"), r("y", "Dois", "b.i.", "2026-08-02")],
  () => true,
);
checa(
  "duas grafias do mesmo setor viram UMA pasta",
  misturado.pastas.length === 1 && misturado.pastas[0].itens.length === 2,
  `${misturado.pastas.length} pasta(s)`,
);
checa(
  "e o rótulo é o da primeira que apareceu, não uma versão normalizada",
  misturado.pastas[0].setor === "B.I.",
  misturado.pastas[0].setor,
);

console.log("\n— ordem: mais recente primeiro, empate pelo título —");

checa(
  "dentro da pasta, a mais recente vem antes",
  organizar(REUNIOES, resolvida).pastas[1].itens.map((x) => x.id).join(",") === "d,e",
);
// Duas reuniões no mesmo dia é o caso comum (uma manhã de comitês). Sem
// desempate, a ordem vira a que o Firestore devolveu — e muda a cada F5.
const mesmoDia = ordenarRecentes([
  r("1", "Zebra", "X", "2026-08-20"),
  r("2", "Alfa", "X", "2026-08-20"),
]);
checa(
  "empate de data desfeito pelo título, em pt-BR",
  mesmoDia.map((x) => x.id).join(",") === "2,1",
  mesmoDia.map((x) => x.id).join(","),
);
checa(
  "ordenar não mexe na lista de quem chamou",
  (() => {
    const orig = [r("1", "B", "X", "2026-01-01"), r("2", "A", "X", "2026-09-09")];
    const antes = orig.map((x) => x.id).join(",");
    ordenarRecentes(orig);
    return orig.map((x) => x.id).join(",") === antes;
  })(),
);

console.log("\n— busca —");

// Campo vazio é o estado NORMAL desta tela: esconder tudo enquanto ninguém
// digitou seria a tela nascendo mentindo. (O contrário da busca do Discord,
// onde o vazio vinha de um comando mal digitado.)
checa("termo vazio casa com tudo", casaBusca(REUNIOES[0], "") && casaBusca(REUNIOES[3], "   "));
checa("acha pelo título", casaBusca(REUNIOES[0], "orçamento"));
checa("acha sem acento", casaBusca(REUNIOES[0], "orcamento"));
checa("acha pelo SETOR", casaBusca(REUNIOES[3], "rh"));
// Lembrar de uma reunião por "aquela do RH sobre cargos" é tão comum quanto
// lembrar pelo título — e cada palavra está num campo diferente.
checa(
  "palavras em campos DIFERENTES casam juntas",
  casaBusca(REUNIOES[3], "rh cargos"),
);
checa("ordem das palavras não importa", casaBusca(REUNIOES[3], "cargos rh"));
checa("palavra que não existe não casa", !casaBusca(REUNIOES[3], "rh orçamento"));

const buscado = organizar(REUNIOES, resolvida, "b.i.");
checa(
  "a busca recorta os dois grupos ao mesmo tempo",
  buscado.pendentes.length === 2 && buscado.pastas.length === 1,
  `${buscado.pendentes.length} pendentes, ${buscado.pastas.length} pasta(s)`,
);
checa("e o total acompanha o recorte", buscado.total === 3, String(buscado.total));

const semNada = organizar(REUNIOES, resolvida, "xyzzy");
checa(
  "busca sem resultado devolve os dois grupos vazios, sem quebrar",
  semNada.pendentes.length === 0 && semNada.pastas.length === 0 && semNada.total === 0,
);

console.log("\n— casos degenerados —");

const vazio = organizar([], () => true);
checa("lista vazia não quebra", vazio.pendentes.length === 0 && vazio.pastas.length === 0);
const tudoPendente = organizar(REUNIOES, () => false);
checa(
  "nada resolvido: nenhuma pasta, tudo em evidência",
  tudoPendente.pastas.length === 0 && tudoPendente.pendentes.length === 6,
);
const tudoResolvido = organizar(REUNIOES, () => true);
checa(
  "tudo resolvido: nada em evidência, três pastas",
  tudoResolvido.pendentes.length === 0 && tudoResolvido.pastas.length === 3,
  `${tudoResolvido.pastas.length} pasta(s)`,
);

console.log(falhas === 0 ? "\nrelatórios: ok" : `\nrelatórios: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
