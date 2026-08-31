/**
 * Testes de "há o que perder se este modal fechar agora?" (`lib/rascunho-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROVA: que a resposta concorda com o SALVAMENTO. O modal da
 * demanda devolve `""` onde o Firestore guarda `null`, e o `submit` normaliza
 * com `trim()` antes de gravar — então "o campo mudou?" tem três respostas
 * possíveis (o que o JS acha, o que a tela acha, o que o banco acha) e só a
 * última importa. Os casos abaixo são, quase todos, essa divergência.
 *
 * Vale lembrar por que errar aqui é caro nos DOIS sentidos: perguntar demais
 * ensina a pessoa a clicar em "descartar" sem ler, e aí a proteção deixa de
 * proteger; perguntar de menos é o bug original de volta, agora com uma tela
 * afirmando que não havia nada a salvar.
 */
import {
  CAMPO_LABEL,
  camposMudados,
  houveMudanca,
  mesmoValor,
  resumoDosCampos,
} from "../src/lib/rascunho-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— vazio é vazio, venha de onde vier —");

// O formulário devolve "" para todo campo opcional em branco; o banco guarda
// null; um card criado antes do campo existir nem tem a chave. Se os três não
// forem a mesma coisa, abrir e fechar um card sem tocar em nada ja pergunta.
checa('"" e null são o mesmo campo vazio', mesmoValor("", null));
checa('"" e undefined também', mesmoValor("", undefined));
checa("null e undefined também", mesmoValor(null, undefined));
checa("mas vazio contra preenchido é mudança", !mesmoValor("", "ana@px"));
checa("e zero NÃO é vazio", !mesmoValor(0, ""), "0 é um valor de verdade");
checa("false NÃO é vazio", !mesmoValor(false, null));

console.log("\n— listas e objetos —");

checa("listas iguais não são mudança", mesmoValor(["a", "b"], ["a", "b"]));
// Reordenar tags é alteração de verdade: o banco guarda a ordem, e o card
// desenha as tags nela.
checa("reordenar É mudança", !mesmoValor(["a", "b"], ["b", "a"]));
// `[]` contra `null` dá DIFERENTE, e isso é uma armadilha de verdade: um card
// gravado antes de as tags existirem não tem a chave, e o formulário abre com
// `[]`. Por isso o modal compara o instantâneo de ABERTURA contra o de agora, e
// não contra o card cru — os dois lados passam pela mesma construção, e o campo
// que ninguém tocou sai igual dos dois.
checa("lista vazia contra null é DIFERENTE (e o modal contorna isso)", !mesmoValor([], null));
checa("por isso: abertura contra agora, e não abertura contra o card cru",
  !houveMudanca({ tags: [] }, { tags: [] }));
checa("checklist com item marcado é mudança",
  !mesmoValor([{ id: "1", text: "x", done: false }], [{ id: "1", text: "x", done: true }]));
checa("checklist idêntico não é",
  mesmoValor([{ id: "1", text: "x", done: true }], [{ id: "1", text: "x", done: true }]));
checa("objeto contra null não explode", !mesmoValor({ a: 1 }, null));

console.log("\n— o que mudou, e em que ordem —");

const abertura = {
  title: "Painel novo",
  description: "",
  assignee: "",
  due: "2026-09-10",
  tags: ["bi"],
};

checa(
  "nada tocado: nenhum campo e nenhuma pergunta",
  camposMudados(abertura, { ...abertura }).length === 0 &&
    !houveMudanca(abertura, { ...abertura }),
);
checa(
  "um campo trocado aparece sozinho",
  JSON.stringify(camposMudados(abertura, { ...abertura, due: "2026-09-11" })) ===
    '["due"]',
  JSON.stringify(camposMudados(abertura, { ...abertura, due: "2026-09-11" })),
);
// A ordem sai do objeto ATUAL, que é a ordem dos campos na tela — é ela que a
// frase lida vai seguir.
checa(
  "a ordem é a do formulário, não alfabética",
  JSON.stringify(
    camposMudados(abertura, {
      ...abertura,
      title: "Outro",
      assignee: "ana@px",
    }),
  ) === '["title","assignee"]',
  JSON.stringify(
    camposMudados(abertura, { ...abertura, title: "Outro", assignee: "ana@px" }),
  ),
);
checa(
  "preencher um opcional que estava vazio conta",
  houveMudanca(abertura, { ...abertura, assignee: "ana@px" }),
);
checa(
  "trocar '' por null NÃO conta — é o mesmo nada",
  !houveMudanca(abertura, { ...abertura, assignee: null }),
);

console.log("\n— a frase que a pessoa lê —");

checa("um campo", resumoDosCampos(["title"]) === "título", resumoDosCampos(["title"]));
checa(
  "dois campos levam 'e'",
  resumoDosCampos(["title", "due"]) === "título e prazo",
  resumoDosCampos(["title", "due"]),
);
checa(
  "três campos ainda cabem por extenso",
  resumoDosCampos(["title", "due", "assignee"]) ===
    "título, prazo e responsável",
  resumoDosCampos(["title", "due", "assignee"]),
);
checa(
  "quatro ou mais viram contagem",
  resumoDosCampos(["title", "due", "assignee", "tags"]) ===
    "título, prazo e mais 2",
  resumoDosCampos(["title", "due", "assignee", "tags"]),
);
checa(
  "a contagem fecha com o total (2 nomeados + 3 contados = 5)",
  resumoDosCampos(["title", "due", "assignee", "tags", "links"]) ===
    "título, prazo e mais 3",
  resumoDosCampos(["title", "due", "assignee", "tags", "links"]),
);
checa("lista vazia é frase vazia", resumoDosCampos([]) === "");
// Campo novo sem rótulo aparece cru em vez de sumir: sumindo, a contagem e a
// lista discordariam caladas no dia em que alguém acrescentar um campo.
checa(
  "campo sem rótulo entra pelo próprio nome",
  resumoDosCampos(["campoNovo"]) === "campoNovo",
  resumoDosCampos(["campoNovo"]),
);

console.log("\n— o dicionário cobre o formulário —");

// Estes são os campos do objeto `base` do submit (card-modal.tsx). Se alguém
// acrescentar um lá e esquecer aqui, a frase passa a mostrar o nome interno.
const CAMPOS_DO_SUBMIT = [
  "title", "description", "columnId", "type", "assignee", "requester",
  "requesterSector", "dimensaoId", "subdimensaoId", "startDate", "due",
  "priority", "tags", "tagRefs", "checklist", "links",
];
const semRotulo = CAMPOS_DO_SUBMIT.filter((c) => !CAMPO_LABEL[c]);
checa(
  "todo campo gravado pelo submit tem rótulo em português",
  semRotulo.length === 0,
  semRotulo.join(", "),
);

console.log(falhas === 0 ? "\nrascunho: ok" : `\nrascunho: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
