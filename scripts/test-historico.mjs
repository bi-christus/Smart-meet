/**
 * Testes do histórico da demanda.
 *
 * Errar aqui não aparece como erro na tela: aparece como uma linha de timeline
 * que conta a história errada — "o responsável passou para ninguém" num card
 * que só teve o prazo alterado. E quem lê acredita, porque histórico é
 * exatamente o que se consulta quando ninguém lembra o que aconteceu.
 *
 * O que estes testes protegem, em uma frase cada:
 *  - o que NÃO mudou não vira linha (ruído afoga o que importa);
 *  - o que mudou nunca deixa de virar linha (omissão é mentira em histórico);
 *  - o texto gravado é o NOME, não o e-mail nem o id.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  CAMPO_ROTULO,
  dataBR,
  diffCard,
  linhaDaMudanca,
  mudancasIniciais,
} from "../src/lib/historico-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

const rotulos = {
  pessoa: (e) =>
    ({ "italo@px.com.br": "Ítalo Araujo", "kaua@px.com.br": "Kauã Silva" })[e] ??
    e,
  coluna: (c) =>
    ({ aguardando: "Aguardando", fazendo: "Em andamento", feito: "Concluído" })[
      c
    ] ?? c,
  prioridade: (p) => ({ alta: "Alta", media: "Média", baixa: "Baixa" })[p] ?? p,
  tipo: (t) => ({ correcao: "Correção", melhoria: "Melhoria" })[t] ?? t,
};

/** Acha a mudança de um campo na lista, ou `undefined`. */
const doCampo = (lista, campo) => lista.find((m) => m.campo === campo);

// --- o caso que originou tudo: a demanda trocou de dono -------------------
const antes = {
  title: "Relatório de consumo",
  columnId: "aguardando",
  assignee: "italo@px.com.br",
  priority: "media",
  due: "2026-08-20",
  tags: ["B.I."],
  checklist: [{ done: true }, { done: false }],
};
const depois = {
  ...antes,
  columnId: "fazendo",
  assignee: "kaua@px.com.br",
};
const r1 = diffCard(antes, depois, rotulos);

checa("troca de responsável vira uma linha", !!doCampo(r1, "responsavel"));
checa(
  "e a linha diz NOME, não e-mail",
  doCampo(r1, "responsavel").de === "Ítalo Araujo" &&
    doCampo(r1, "responsavel").para === "Kauã Silva",
  JSON.stringify(doCampo(r1, "responsavel")),
);
checa(
  "a etapa vira o título da coluna, não o colId",
  doCampo(r1, "coluna").de === "Aguardando" &&
    doCampo(r1, "coluna").para === "Em andamento",
  JSON.stringify(doCampo(r1, "coluna")),
);
checa(
  "o que não mudou não vira linha",
  r1.length === 2,
  r1.map((m) => m.campo).join(", "),
);
checa(
  "a etapa vem antes do responsável (ordem de leitura)",
  r1[0].campo === "coluna",
  r1.map((m) => m.campo).join(" > "),
);

// --- nada mudou: nenhuma linha, e portanto nenhum evento ------------------
checa(
  "salvar sem mudar nada não gera linha nenhuma",
  diffCard(antes, { ...antes }, rotulos).length === 0,
);
checa(
  "reordenar a checklist sem concluir nada não gera linha",
  diffCard(
    antes,
    { ...antes, checklist: [{ done: false }, { done: true }] },
    rotulos,
  ).length === 0,
);
checa(
  "concluir um item da checklist gera o placar",
  (() => {
    const m = doCampo(
      diffCard(
        antes,
        { ...antes, checklist: [{ done: true }, { done: true }] },
        rotulos,
      ),
      "checklist",
    );
    return m?.de === "1/2" && m?.para === "2/2";
  })(),
);

// --- vazio é vazio: nulo, ausente e "" são a mesma coisa ------------------
checa(
  'trocar null por "" não é mudança',
  diffCard(
    { assignee: null, requester: "" },
    { assignee: "", requester: undefined },
    rotulos,
  ).length === 0,
);
checa(
  "tirar o responsável é mudança, e o destino é nulo",
  (() => {
    const m = doCampo(
      diffCard({ assignee: "italo@px.com.br" }, { assignee: null }, rotulos),
      "responsavel",
    );
    return m?.de === "Ítalo Araujo" && m?.para === null;
  })(),
);

// --- datas: o histórico é lido por gente ----------------------------------
checa("data vira dd/mm/aaaa", dataBR("2026-08-20") === "20/08/2026");
checa("data em outro formato passa reto", dataBR("depois") === "depois");
checa(
  "o prazo aparece no formato do Brasil",
  doCampo(diffCard(antes, { ...antes, due: "2026-09-01" }, rotulos), "prazo")
    .para === "01/09/2026",
);

// --- tags: o que entrou e o que saiu, não a lista inteira ------------------
const rTags = diffCard(
  { tags: ["B.I.", "Urgente"] },
  { tags: ["B.I.", "Infra"] },
  rotulos,
);
checa(
  "tags: registra só a diferença",
  doCampo(rTags, "tags").para === "Infra" &&
    doCampo(rTags, "tags").de === "Urgente",
  JSON.stringify(doCampo(rTags, "tags")),
);
checa(
  "tags: reordenar não é mudança",
  diffCard({ tags: ["a", "b"] }, { tags: ["b", "a"] }, rotulos).length === 0,
);

// --- descrição: guarda o fato, não o texto --------------------------------
const rDesc = diffCard(
  { description: "texto antigo, possivelmente enorme" },
  { description: "texto novo" },
  rotulos,
);
checa("descrição alterada vira linha", !!doCampo(rDesc, "descricao"));
checa(
  "descrição NÃO guarda o texto (nem o velho nem o novo)",
  doCampo(rDesc, "descricao").de === null &&
    doCampo(rDesc, "descricao").para === null,
  JSON.stringify(doCampo(rDesc, "descricao")),
);

// --- criação: com quem a demanda nasceu -----------------------------------
const iniciais = mudancasIniciais(
  {
    title: "Nova demanda",
    columnId: "aguardando",
    assignee: "kaua@px.com.br",
    due: "2026-08-30",
    description: "contexto",
    checklist: [{ done: false }],
  },
  rotulos,
);
checa(
  "a criação registra dono, etapa e prazo",
  !!doCampo(iniciais, "responsavel") &&
    !!doCampo(iniciais, "coluna") &&
    !!doCampo(iniciais, "prazo"),
  iniciais.map((m) => m.campo).join(", "),
);
checa(
  "a criação NÃO repete o conteúdo (título, descrição, checklist)",
  !doCampo(iniciais, "descricao") &&
    !doCampo(iniciais, "checklist") &&
    !doCampo(iniciais, "titulo"),
  iniciais.map((m) => m.campo).join(", "),
);
checa(
  "na criação tudo vem de lugar nenhum",
  iniciais.every((m) => m.de === null),
);

// --- a tela: cada tipo de linha sabe se explicar --------------------------
const lDesc = linhaDaMudanca({ campo: "descricao", de: null, para: null });
checa(
  "descrição: a tela recebe uma nota, não um par vazio",
  lDesc.nota === "reescrita" && lDesc.de === null && lDesc.para === null,
);
const lTags = linhaDaMudanca({ campo: "tags", de: "Urgente", para: "Infra" });
checa(
  "tags: a nota mostra entrada e saída",
  lTags.nota.includes("+ Infra") && lTags.nota.includes("− Urgente"),
  lTags.nota,
);
const lResp = linhaDaMudanca({
  campo: "responsavel",
  de: "Ítalo Araujo",
  para: "Kauã Silva",
});
checa(
  "campo comum: a tela recebe o par, sem nota",
  lResp.nota === null &&
    lResp.rotulo === CAMPO_ROTULO.responsavel &&
    lResp.para === "Kauã Silva",
);

// --- todo campo rastreado tem rótulo em português -------------------------
checa(
  "nenhum campo chega à tela sem rótulo",
  Object.values(CAMPO_ROTULO).every((v) => typeof v === "string" && v.length),
);

console.log(
  falhas === 0
    ? "\nTodos os testes de histórico passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
