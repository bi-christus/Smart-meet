/**
 * Testes da tag que aponta para algo.
 *
 * A tag guardada é texto; a referência é o `id` ao lado dela. Errar aqui não
 * aparece como erro na tela: aparece como uma demanda marcada com o nome antigo
 * de outra, meses depois de alguém ter renomeado — e quem lê acredita.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { resolverTags } from "../src/lib/tags-ref.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

const titulos = new Map([
  ["d1", "Portal do aluno 2.0"], // renomeada: era "Portal do aluno"
  ["d2", "Integração com o RM"],
]);
const setores = new Map([
  ["s1", "Infraestrutura"], // renomeado: era "Infra"
]);

// --- o caso que originou tudo: renomearam o alvo ---------------------------
const citaDemanda = {
  tags: ["urgente", "Portal do aluno"],
  tagRefs: [{ tipo: "demanda", id: "d1", texto: "Portal do aluno" }],
};
const r1 = resolverTags(citaDemanda, titulos, setores);
checa(
  "demanda renomeada: a tag acompanha",
  r1.tags[1] === "Portal do aluno 2.0",
  r1.tags.join(", "),
);
checa(
  "a tag escrita à mão fica intacta",
  r1.tags[0] === "urgente",
  r1.tags.join(", "),
);
checa(
  "a referência guarda o nome novo",
  r1.tagRefs[0].texto === "Portal do aluno 2.0" && r1.tagRefs[0].id === "d1",
  JSON.stringify(r1.tagRefs[0]),
);

const citaSetor = {
  tags: ["Infra"],
  tagRefs: [{ tipo: "setor", id: "s1", texto: "Infra" }],
};
checa(
  "setor renomeado: a tag acompanha",
  resolverTags(citaSetor, titulos, setores).tags[0] === "Infraestrutura",
);

// --- estabilidade: sem mudança, mesmo objeto -------------------------------
const jaCerto = {
  tags: ["Integração com o RM"],
  tagRefs: [{ tipo: "demanda", id: "d2", texto: "Integração com o RM" }],
};
checa(
  "nada mudou: devolve o MESMO objeto (não força render)",
  resolverTags(jaCerto, titulos, setores) === jaCerto,
);
const semRef = { tags: ["Portal do aluno"] };
checa(
  "tag sem referência não é tocada, nem que o texto coincida",
  resolverTags(semRef, titulos, setores) === semRef,
);

// --- alvo apagado: o texto guardado é o que sobrou -------------------------
const orfa = {
  tags: ["Demanda que morreu"],
  tagRefs: [{ tipo: "demanda", id: "sumiu", texto: "Demanda que morreu" }],
};
checa(
  "alvo apagado: mantém o último nome conhecido",
  resolverTags(orfa, titulos, setores).tags[0] === "Demanda que morreu",
);

// --- colisão: o nome novo já existia no card ------------------------------
const colide = {
  tags: ["Integração com o RM", "Portal do aluno"],
  tagRefs: [{ tipo: "demanda", id: "d1", texto: "Portal do aluno" }],
};
const r2 = resolverTags(colide, new Map([["d1", "Integração com o RM"]]), setores);
checa(
  "colisão com tag existente: não duplica o chip",
  r2.tags.length === 1 && r2.tags[0] === "Integração com o RM",
  r2.tags.join(", "),
);
checa(
  "colisão: sobra uma referência só, e sem apontar para o vazio",
  r2.tagRefs.length === 1 && r2.tags.includes(r2.tagRefs[0].texto),
  JSON.stringify(r2.tagRefs),
);

// --- a referência não some do card por acidente ----------------------------
const duasRefs = {
  tags: ["Portal do aluno", "Infra"],
  tagRefs: [
    { tipo: "demanda", id: "d1", texto: "Portal do aluno" },
    { tipo: "setor", id: "s1", texto: "Infra" },
  ],
};
const r3 = resolverTags(duasRefs, titulos, setores);
checa(
  "duas referências no mesmo card: as duas acompanham",
  r3.tags.join("|") === "Portal do aluno 2.0|Infraestrutura",
  r3.tags.join("|"),
);
checa(
  "toda referência continua ligada a uma tag existente",
  r3.tagRefs.every((ref) => r3.tags.includes(ref.texto)),
);

console.log(
  falhas === 0
    ? "\nTodos os testes de tag-referência passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
