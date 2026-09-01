/**
 * Testes do corte por mês da coluna de conclusão (`lib/concluidas-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que olhar o quadro não protege: a BORDA do mês.
 * Um corte que erra por um dia desenha uma coluna que parece perfeitamente
 * normal — os cards estão lá, na ordem certa, com a contagem batendo — e o
 * defeito só aparece no dia 1º, quando a entrega de ontem some da tela de quem
 * a fez. Por isso quase toda afirmação aqui é sobre o último milissegundo de um
 * mês e o primeiro do seguinte.
 *
 * O relógio entra por parâmetro em tudo, como em todo teste de data deste
 * projeto: teste que lê o relógio do sistema passa hoje e reprova em outubro.
 */
import {
  concluidaNoMes,
  inicioDoMes,
  rotuloDoMes,
  separarConcluidas,
} from "../src/lib/concluidas-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const ms = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

/** Terça, 15 de setembro de 2026, meio-dia. */
const AGORA = ms(2026, 9, 15);

console.log("\n— o começo do mês —");

checa(
  "é a meia-noite do dia 1º, no fuso local",
  inicioDoMes(AGORA) === ms(2026, 9, 1, 0, 0),
  new Date(inicioDoMes(AGORA)).toString(),
);
checa(
  "o próprio dia 1º já está no seu mês",
  inicioDoMes(ms(2026, 9, 1, 0, 0)) === ms(2026, 9, 1, 0, 0),
);
checa(
  "vira o ano sem tropeçar: janeiro de 2027",
  inicioDoMes(ms(2027, 1, 3)) === ms(2027, 1, 1, 0, 0),
);
// Fevereiro é o mês em que aritmética de data erra, e 2028 é bissexto.
checa(
  "29 de fevereiro de 2028 é de fevereiro",
  inicioDoMes(ms(2028, 2, 29)) === ms(2028, 2, 1, 0, 0),
);

console.log("\n— a borda do mês —");

const dentro = (t) => concluidaNoMes({ enteredAt: t }, AGORA);

checa("o último milissegundo de agosto está FORA", !dentro(ms(2026, 9, 1, 0, 0) - 1));
checa("a meia-noite do dia 1º está DENTRO", dentro(ms(2026, 9, 1, 0, 0)));
checa("hoje está dentro", dentro(AGORA));
// O card movido para "Concluído" hoje à noite — o relógio de quem lê é meio-dia.
checa("mais tarde no mesmo mês está dentro", dentro(ms(2026, 9, 30, 23, 59)));
checa("o mês passado está fora", !dentro(ms(2026, 8, 31, 23, 59)));
checa("o ano passado está fora", !dentro(ms(2025, 9, 15)));

console.log("\n— card sem enteredAt —");

/**
 * A decisão que mais muda o que aparece na tela: card sem o campo conta como
 * ANTIGO. `enteredAt` é gravado na criação e em todo movimento, então quem não
 * o tem é anterior a ele existir — das mais velhas do quadro. Contá-lo como
 * recente manteria à vista para sempre justamente o que o corte existe para
 * tirar da frente.
 */
checa("campo ausente é antigo", !concluidaNoMes({}, AGORA));
checa("campo null é antigo", !concluidaNoMes({ enteredAt: null }, AGORA));
checa("campo zero é antigo", !concluidaNoMes({ enteredAt: 0 }, AGORA));
// Se um dia alguém gravar um `serverTimestamp()` aqui, o campo vira objeto — e
// a comparação `>=` com objeto responderia `false` calada. `typeof` responde a
// mesma coisa, mas por um motivo que se lê.
checa(
  "campo de outro tipo é antigo, não explode",
  !concluidaNoMes({ enteredAt: { seconds: 1 } }, AGORA),
);

console.log("\n— partir a coluna em duas —");

const col = [
  { id: "a", enteredAt: ms(2026, 9, 14) },
  { id: "b", enteredAt: ms(2026, 8, 20) },
  { id: "c", enteredAt: ms(2026, 9, 2) },
  { id: "d" },
  { id: "e", enteredAt: ms(2025, 12, 31) },
];
const { recentes, antigas } = separarConcluidas(col, AGORA);

checa("as do mês ficam", recentes.map((c) => c.id).join("") === "ac", recentes.map((c) => c.id).join(""));
checa("o resto vai para baixo", antigas.map((c) => c.id).join("") === "bde", antigas.map((c) => c.id).join(""));
checa("nada se perde no caminho", recentes.length + antigas.length === col.length);
/**
 * A ORDEM DE CADA LADO É A QUE CHEGOU. Quem chama já ordenou a coluna por
 * `order` (que em card movido é `-now`, ou seja, o mais recente em cima).
 * Reordenar aqui criaria uma segunda regra de ordenação, e as duas divergiriam
 * no primeiro card que alguém arrastasse à mão.
 */
checa(
  "a ordem de chegada é preservada dos dois lados",
  recentes[0].id === "a" && antigas[0].id === "b" && antigas[2].id === "e",
);
checa(
  "a lista de quem chamou não é mexida",
  col.map((c) => c.id).join("") === "abcde",
);

console.log("\n— os vazios —");

checa("coluna vazia devolve dois vazios", (() => {
  const r = separarConcluidas([], AGORA);
  return r.recentes.length === 0 && r.antigas.length === 0;
})());
checa("coluna só de antigas não inventa recente", separarConcluidas([{ id: "x" }], AGORA).recentes.length === 0);
checa(
  "coluna só de recentes não deixa nada embaixo",
  separarConcluidas([{ enteredAt: AGORA }], AGORA).antigas.length === 0,
);

console.log("\n— o rótulo do mês —");

checa("é o mês por extenso, com o ano", rotuloDoMes(AGORA) === "setembro de 2026", rotuloDoMes(AGORA));
checa("janeiro sai certo", rotuloDoMes(ms(2027, 1, 9)) === "janeiro de 2027", rotuloDoMes(ms(2027, 1, 9)));
checa("dezembro sai certo", rotuloDoMes(ms(2026, 12, 1)) === "dezembro de 2026", rotuloDoMes(ms(2026, 12, 1)));

console.log(falhas === 0 ? "\nconcluídas: ok" : `\nconcluídas: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
