/**
 * Testes de `reaproveitarIguais` (`lib/estabilidade-core.ts`, #213).
 *
 * O QUE ESTE ARQUIVO PROVA: que o card igual volta com a MESMA identidade (é
 * isso que deixa o quadro não se redesenhar inteiro a cada snapshot) e — o mais
 * importante — que o card que MUDOU nunca volta com o objeto velho. O primeiro
 * erro custa desempenho; o segundo mostraria na tela um valor que já não é o do
 * banco, e ninguém perceberia.
 */
import { reaproveitarIguais } from "../src/lib/estabilidade-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const id = (x) => x.id;
const a1 = { id: "a", title: "A", checklist: [{ text: "x", done: false }] };
const b1 = { id: "b", title: "B" };
const anterior = [a1, b1];

// Um snapshot novo: os MESMOS dados, em objetos novos — o que o Firestore faz.
const igual = reaproveitarIguais(anterior, [{ ...a1, checklist: [{ text: "x", done: false }] }, { ...b1 }], id);
checa("nada mudou: devolve a própria lista anterior", igual === anterior);

// Só o item do checklist do A mudou.
const mudouA = reaproveitarIguais(
  anterior,
  [{ ...a1, checklist: [{ text: "x", done: true }] }, { ...b1 }],
  id,
);
checa("a lista é nova quando algo mudou", mudouA !== anterior);
checa("o card que mudou NÃO volta com o objeto velho", mudouA[0] !== a1 && mudouA[0].checklist[0].done === true);
checa("o card que não mudou volta com o MESMO objeto", mudouA[1] === b1);

const reordenada = reaproveitarIguais(anterior, [{ ...b1 }, { ...a1 }], id);
checa("a ordem é a da lista nova", reordenada[0].id === "b" && reordenada[1].id === "a");
checa("e reaproveita mesmo fora do lugar", reordenada[0] === b1 && reordenada[1] === a1);
checa("trocar a ordem conta como mudança", reordenada !== anterior);

const comNovo = reaproveitarIguais(anterior, [{ ...a1 }, { ...b1 }, { id: "c", title: "C" }], id);
checa("card novo entra como veio", comNovo.length === 3 && comNovo[2].id === "c");
checa("e os antigos continuam reaproveitados", comNovo[0] === a1 && comNovo[1] === b1);

const semUm = reaproveitarIguais(anterior, [{ ...a1 }], id);
checa("card que saiu, sai", semUm.length === 1 && semUm[0] === a1);

const doZero = reaproveitarIguais([], [{ ...a1 }], id);
checa("sem lista anterior, devolve a nova", doZero.length === 1 && doZero[0].id === "a");

console.log(falhas === 0 ? "\nestabilidade: ok" : `\nestabilidade: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
