/**
 * Testes da fusão de demandas (`lib/fusao-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar a tela não prova: que nada é perdido em
 * silêncio. A fusão escreve em dois documentos e o erro não aparece — o
 * resultado continua sendo um card plausível, com um checklist um pouco menor ou
 * um comentário a menos, e ninguém tem como notar a falta de uma linha que
 * estava na demanda que sumiu do quadro.
 *
 * As três armadilhas cobertas aqui, e cada uma custou uma decisão:
 *
 *   - TAG deduplicada por TEXTO deixaria "Compras" e "compras" como dois chips
 *     no mesmo card e partiria a contagem do catálogo em duas metades.
 *   - CHECKLIST unido sem o OU do `done` desmarcaria uma tarefa que um dos lados
 *     já tinha feito — a única direção do erro que custa trabalho de verdade.
 *   - COMENTÁRIO empilhado por card em vez de por data desmontaria a conversa:
 *     alguém perguntou numa demanda e outra pessoa respondeu na outra.
 */
import {
  CAMPOS_ESCOLHIVEIS,
  CAMPO_DA_FUSAO_ROTULO,
  camposEmConflito,
  escolhasIniciais,
  juntarDescricoes,
  podemFundir,
  resultadoDaFusao,
  unirChecklist,
  unirComentarios,
  unirLinks,
  unirTagRefs,
  unirTags,
} from "../src/lib/fusao-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const base = {
  id: "a",
  sector: "Cantinas",
  columnId: "andamento",
  title: "Repor o estoque de frios",
  requester: "Murilo Brasil",
  requesterSector: "Diretoria",
  assignee: "ana@px.com.br",
};
const outro = { ...base, id: "b", title: "Comprar frios para a cantina" };

console.log("\n— quem funde com quem —");

checa("as duas iguais nos três campos fundem", podemFundir(base, outro).ok);
checa("a mesma demanda não funde consigo", !podemFundir(base, base).ok);
checa(
  "setores diferentes não fundem, e o motivo diz o que fazer",
  (() => {
    const r = podemFundir(base, { ...outro, sector: "B.I." });
    return !r.ok && r.motivo.includes("Mude o setor");
  })(),
);
checa(
  "solicitantes diferentes não fundem",
  !podemFundir(base, { ...outro, requester: "Outra Pessoa" }).ok,
);
checa(
  "setores solicitantes diferentes não fundem",
  !podemFundir(base, { ...outro, requesterSector: "RH" }).ok,
);
checa(
  "responsáveis diferentes não fundem",
  !podemFundir(base, { ...outro, assignee: "bia@px.com.br" }).ok,
);
checa(
  "VAZIO combina com qualquer um — é o card nascido da ata, que nasce sem responsável",
  podemFundir(base, { ...outro, assignee: null }).ok &&
    podemFundir({ ...base, assignee: "" }, outro).ok,
);
checa(
  "vazio dos dois lados também combina",
  podemFundir({ ...base, assignee: null }, { ...outro, assignee: null }).ok,
);
checa(
  "a caixa não separa duas pessoas que são a mesma",
  podemFundir(base, { ...outro, requester: "murilo brasil" }).ok,
);
checa(
  "demanda na lixeira não funde — ressuscitaria conteúdo sem ninguém restaurar",
  !podemFundir(base, { ...outro, deletedAt: 123 }).ok &&
    !podemFundir({ ...base, deletedAt: 123 }, outro).ok,
);

console.log("\n— o que a tela pergunta —");

checa(
  "só os campos que discordam viram pergunta",
  camposEmConflito(base, outro).join(",") === "title",
  camposEmConflito(base, outro).join(","),
);
checa(
  "campo em que os dois concordam NÃO vira pergunta",
  !camposEmConflito(base, { ...outro, columnId: "andamento" }).includes("columnId"),
);
checa(
  "vazio dos dois lados não é conflito — não há o que escolher entre nada e nada",
  camposEmConflito(
    { ...base, due: null, description: "" },
    { ...outro, due: null, description: "" },
  ).join(",") === "title",
);
checa(
  "preenchido contra vazio É conflito: alguém precisa dizer se o valor fica",
  camposEmConflito(base, { ...outro, due: "2026-09-30" }).includes("due"),
);
checa(
  "dimensão e subdimensão contam como UM endereço",
  camposEmConflito(
    { ...base, dimensaoId: "d1", subdimensaoId: "s1" },
    { ...outro, dimensaoId: "d1", subdimensaoId: "s9" },
  ).includes("dimensao"),
);
checa(
  "todo campo escolhível tem rótulo — nenhum chega à tela sem nome",
  CAMPOS_ESCOLHIVEIS.every((c) => !!CAMPO_DA_FUSAO_ROTULO[c]),
);

console.log("\n— como o diálogo abre —");

const comTexto = { ...base, description: "Faltou frios na sexta." };
const comTexto2 = { ...outro, description: "A cantina ficou sem presunto." };

checa(
  "descrição abre em JUNTAR quando os dois lados escreveram",
  escolhasIniciais(comTexto, comTexto2).description === "juntar",
);
checa(
  "com um lado só, abre nesse lado — juntar com nada não é juntar",
  escolhasIniciais({ ...base, description: "" }, comTexto2).description === "perdido" &&
    escolhasIniciais(comTexto, { ...outro, description: "" }).description === "vencedor",
);
checa(
  "campo vazio no vencedor abre no PERDIDO — o padrão não pode ser escolher o nada",
  escolhasIniciais({ ...base, due: null }, { ...outro, due: "2026-09-30" }).due ===
    "perdido",
);
checa(
  "com valor nos dois, o padrão é o vencedor",
  escolhasIniciais({ ...base, due: "2026-01-01" }, { ...outro, due: "2026-09-30" })
    .due === "vencedor",
);

console.log("\n— as uniões —");

checa(
  "tags deduplicadas pela CHAVE, e a grafia do vencedor é a que fica",
  unirTags(["Compras", "estoque"], ["compras", "frios"]).join(",") ===
    "Compras,estoque,frios",
  unirTags(["Compras", "estoque"], ["compras", "frios"]).join(","),
);
checa(
  "a hierarquia não é achatada na união",
  unirTags(["cantinas"], ["cantinas/estoque"]).join(",") === "cantinas,cantinas/estoque",
);
checa(
  "referência para tag que não sobreviveu é descartada",
  unirTagRefs(
    ["Compras"],
    [{ tipo: "setor", id: "s1", texto: "Compras" }],
    [{ tipo: "demanda", id: "d9", texto: "Sumiu" }],
  ).length === 1,
);
checa(
  "checklist: os do vencedor primeiro, e sem repetir",
  unirChecklist(
    [{ text: "Cotar", done: false }],
    [{ text: "cotar", done: false }, { text: "Fechar", done: false }],
  )
    .map((i) => i.text)
    .join(",") === "Cotar,Fechar",
);
checa(
  "checklist: o `done` é o OU dos dois — desmarcar mandaria refazer trabalho pronto",
  (() => {
    const r = unirChecklist(
      [{ text: "Cotar", done: false }],
      [{ text: "Cotar", done: true }],
    );
    return r.length === 1 && r[0].done === true;
  })(),
);
checa(
  "item sem texto não entra",
  unirChecklist([{ text: "  ", done: false }], []).length === 0,
);
checa(
  "links deduplicados pela MESMA régua da aba Links (`jaTem`): sem esquema e com caixa",
  unirLinks(
    [{ url: "https://drive.google.com/x" }],
    [{ url: "DRIVE.GOOGLE.COM/x" }, { url: "https://outro.com" }],
  ).length === 2,
  String(
    unirLinks(
      [{ url: "https://drive.google.com/x" }],
      [{ url: "DRIVE.GOOGLE.COM/x" }, { url: "https://outro.com" }],
    ).length,
  ),
);
checa(
  "a barra final NÃO é achatada — é o que `normalizarUrl` faz, e a aba Links concorda",
  unirLinks(
    [{ url: "https://drive.google.com/x" }],
    [{ url: "https://drive.google.com/x/" }],
  ).length === 2,
);
checa(
  "link que não passa no portão da URL não entra, e dois inválidos não casam entre si",
  unirLinks([{ url: "rascunho" }], [{ url: "outra frase solta" }]).length === 0,
);
checa(
  "comentários voltam a ser UMA conversa, em ordem de data",
  unirComentarios(
    [{ author: "ana", text: "b", at: 20 }],
    [{ author: "bia", text: "a", at: 10 }],
  )
    .map((c) => c.text)
    .join(",") === "a,b",
);
checa(
  "o mesmo recado colado nas duas entra uma vez só",
  unirComentarios(
    [{ author: "ana", text: "igual", at: 5 }],
    [{ author: "ana", text: "igual", at: 5 }],
  ).length === 1,
);
checa(
  "dois comentários diferentes no mesmo instante NÃO são o mesmo",
  unirComentarios(
    [{ author: "ana", text: "um", at: 5 }],
    [{ author: "ana", text: "dois", at: 5 }],
  ).length === 2,
);

console.log("\n— juntar as duas descrições —");

const junta = juntarDescricoes("Primeiro texto.", "Segundo texto.", "A outra");
checa("os dois textos estão lá", junta.includes("Primeiro") && junta.includes("Segundo"));
checa(
  "com um separador que diz de onde veio o segundo",
  junta.includes("--- da demanda fundida: A outra ---"),
);
checa(
  "lado vazio não gera separador nenhum",
  juntarDescricoes("", "Só este") === "Só este" &&
    juntarDescricoes("Só este", "") === "Só este",
);

console.log("\n— o resultado inteiro —");

const v = {
  ...base,
  description: "Do vencedor.",
  tags: ["Compras"],
  checklist: [{ text: "Cotar", done: false }],
  comments: [{ author: "ana", text: "b", at: 20 }],
  meetingIds: ["m1"],
  assignee: null,
};
const p = {
  ...outro,
  description: "Do perdido.",
  columnId: "backlog",
  due: "2026-09-30",
  tags: ["compras", "frios"],
  checklist: [{ text: "Cotar", done: true }],
  comments: [{ author: "bia", text: "a", at: 10 }],
  meetingIds: ["m2"],
  assignee: "ana@px.com.br",
};

const r = resultadoDaFusao({
  vencedor: v,
  perdido: p,
  escolhas: { ...escolhasIniciais(v, p), title: "vencedor" },
  por: "quem@px.com.br",
  agora: 7777,
});

checa("o título escolhido fica", r.patchVencedor.title === "Repor o estoque de frios");
checa(
  "as duas descrições foram juntadas",
  String(r.patchVencedor.description).includes("Do vencedor.") &&
    String(r.patchVencedor.description).includes("Do perdido."),
);
checa(
  "o responsável VAZIO herda o preenchido — é a regra do vazio, aplicada",
  r.patchVencedor.assignee === "ana@px.com.br",
);
checa(
  "solicitante e setor solicitante são preservados",
  r.patchVencedor.requester === "Murilo Brasil" &&
    r.patchVencedor.requesterSector === "Diretoria",
);
checa("as tags entraram unidas", r.patchVencedor.tags.join(",") === "Compras,frios");
checa("o checklist ficou marcado", r.patchVencedor.checklist[0].done === true);
checa(
  "os comentários vieram em ordem de data",
  r.patchVencedor.comments.map((c) => c.text).join(",") === "a,b",
);
checa(
  "a proveniência das DUAS reuniões sobrevive",
  r.patchVencedor.meetingIds.join(",") === "m1,m2",
);
checa(
  "o prazo veio do perdido, porque o vencedor não tinha",
  r.patchVencedor.due === "2026-09-30",
);
checa(
  "o card perdido vai para a LIXEIRA, não é apagado",
  r.patchPerdido.deletedAt === 7777 && r.patchPerdido.deletedBy === "quem@px.com.br",
);
checa(
  "e o pedido de conclusão dele é cancelado — ele saiu do quadro",
  r.patchPerdido.conclusaoPedida === null,
);
checa(
  "o patch do perdido não mexe em mais nada: restaurar devolve um card íntegro",
  Object.keys(r.patchPerdido).sort().join(",") ===
    "conclusaoPedida,deletedAt,deletedBy",
);
checa(
  "nenhum campo do vencedor sai como undefined — o Firestore recusa a escrita",
  Object.values(r.patchVencedor).every((x) => x !== undefined),
);

console.log(falhas === 0 ? "\nfusão: ok" : `\nfusão: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
