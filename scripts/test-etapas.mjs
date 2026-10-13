/**
 * Testes dos campos por etapa (`lib/etapas-core.ts`, #212).
 *
 * O QUE ESTE ARQUIVO PROVA, e que olhar a tela não prova:
 *
 * 1. A CAIXA NÃO ABRE QUANDO NÃO DEVE. Voltar o card, reordenar na mesma coluna
 *    e entrar numa etapa cujos campos já estão preenchidos não podem perguntar
 *    nada — uma caixa que aparece sem motivo ensina a fechá-la sem ler.
 * 2. O COMENTÁRIO É DA PASSAGEM, não do card: ele é pedido toda vez que a
 *    demanda entra na etapa, mesmo que ela já tenha comentários antigos.
 * 3. A LEITURA DA CONFIGURAÇÃO AGUENTA LIXO. A coluna é escrita pela tela, pelo
 *    console e por versões antigas; um campo desconhecido não pode derrubar o
 *    quadro.
 */
import {
  CAMPOS_DA_ETAPA,
  CAMPO_DA_ETAPA_ROTULO,
  SUGESTAO_POR_ETAPA,
  campoPreenchido,
  exigenciasDaEtapa,
  normalizarExigencias,
  oQueAPassagemPede,
} from "../src/lib/etapas-core.ts";
import { DEFAULT_COLUMNS } from "../src/lib/kanban-columns.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const ORDEM = DEFAULT_COLUMNS.map((c) => c.id);
const ANDAMENTO = [
  { campo: "assignee", obrigatorio: true },
  { campo: "due", obrigatorio: true },
  { campo: "checklist", obrigatorio: false },
];
const vazio = { title: "x" };

console.log("\n— quando a caixa abre —");

const pede = oQueAPassagemPede({
  origem: "backlog",
  destino: "andamento",
  ordem: ORDEM,
  exigencias: ANDAMENTO,
  card: vazio,
});
checa(
  "de A fazer para Em andamento, sem nada preenchido, pede os três",
  pede.map((e) => e.campo).join(",") === "assignee,due,checklist",
  pede.map((e) => e.campo).join(","),
);
checa(
  "e diz quais são obrigatórios",
  pede.filter((e) => e.obrigatorio).map((e) => e.campo).join(",") === "assignee,due",
);
checa(
  "só pede o que falta",
  oQueAPassagemPede({
    origem: "backlog",
    destino: "andamento",
    ordem: ORDEM,
    exigencias: ANDAMENTO,
    card: { assignee: "a@b.c", due: "2026-10-20" },
  }).map((e) => e.campo).join(",") === "checklist",
);
checa(
  "com tudo preenchido, a caixa não abre",
  oQueAPassagemPede({
    origem: "backlog",
    destino: "andamento",
    ordem: ORDEM,
    exigencias: ANDAMENTO,
    card: { assignee: "a@b.c", due: "2026-10-20", checklist: [{ text: "a", done: false }] },
  }).length === 0,
);
checa(
  "pular etapas também é avançar — de A fazer direto para Validação pede o da Validação",
  oQueAPassagemPede({
    origem: "backlog",
    destino: "validacao",
    ordem: ORDEM,
    exigencias: SUGESTAO_POR_ETAPA.validacao,
    card: vazio,
  }).length === 1,
);

console.log("\n— quando a caixa NÃO abre —");

checa(
  "voltar para uma etapa anterior não pergunta nada",
  oQueAPassagemPede({
    origem: "validacao",
    destino: "andamento",
    ordem: ORDEM,
    exigencias: ANDAMENTO,
    card: vazio,
  }).length === 0,
);
checa(
  "reordenar na mesma coluna não pergunta nada",
  oQueAPassagemPede({
    origem: "andamento",
    destino: "andamento",
    ordem: ORDEM,
    exigencias: ANDAMENTO,
    card: vazio,
  }).length === 0,
);
checa(
  "etapa sem configuração não pergunta nada",
  oQueAPassagemPede({
    origem: "backlog",
    destino: "andamento",
    ordem: ORDEM,
    exigencias: [],
    card: vazio,
  }).length === 0,
);
checa(
  "card vindo de uma coluna apagada conta como avanço",
  oQueAPassagemPede({
    origem: "coluna-que-sumiu",
    destino: "andamento",
    ordem: ORDEM,
    exigencias: ANDAMENTO,
    card: vazio,
  }).length === 3,
);

console.log("\n— o comentário é da passagem —");

checa(
  "comentário nunca conta como preenchido, mesmo com comentários antigos no card",
  campoPreenchido({ comments: [{ text: "antigo" }] }, "comentario") === false,
);
checa(
  "e por isso Aguardando sempre pede o motivo da espera",
  oQueAPassagemPede({
    origem: "andamento",
    destino: "aguardando",
    ordem: ORDEM,
    exigencias: SUGESTAO_POR_ETAPA.aguardando,
    card: { assignee: "a@b.c" },
  }).map((e) => e.campo).join(",") === "comentario",
);

console.log("\n— o que conta como preenchido —");

checa("texto em branco não é responsável", !campoPreenchido({ assignee: "   " }, "assignee"));
checa("lista vazia não é checklist", !campoPreenchido({ checklist: [] }, "checklist"));
checa("um link basta", campoPreenchido({ links: [{ url: "https://a.b" }] }, "links"));
checa("sem prazo é prazo vazio", !campoPreenchido({ due: null }, "due"));

console.log("\n— a configuração gravada é lida com desconfiança —");

const lida = normalizarExigencias([
  { campo: "due", obrigatorio: true },
  { campo: "inventado", obrigatorio: true },
  "lixo",
  null,
  { campo: "assignee", obrigatorio: "sim" },
  { campo: "due", obrigatorio: false },
]);
checa(
  "campo desconhecido e lixo saem; o repetido fica uma vez, com o primeiro valor",
  JSON.stringify(lida) ===
    JSON.stringify([
      { campo: "assignee", obrigatorio: false },
      { campo: "due", obrigatorio: true },
    ]),
  JSON.stringify(lida),
);
checa("e sai na ordem do catálogo, não na de gravação", lida[0].campo === "assignee");
checa("o que não é lista vira lista vazia", normalizarExigencias(undefined).length === 0);

console.log("\n— o catálogo —");

checa(
  "todo campo tem rótulo",
  CAMPOS_DA_ETAPA.every((c) => !!CAMPO_DA_ETAPA_ROTULO[c]),
);
checa(
  "a sugestão só fala de etapas que existem no quadro padrão",
  Object.keys(SUGESTAO_POR_ETAPA).every((id) => ORDEM.includes(id)),
);
checa(
  "e só de campos do catálogo",
  Object.values(SUGESTAO_POR_ETAPA).flat().every((e) => CAMPOS_DA_ETAPA.includes(e.campo)),
);

// A etapa nunca configurada pede o que a sugestão diz — senão a caixa de
// passagem nunca abre num quadro novo (13/10/2026).
checa(
  "etapa padrão sem configuração usa a sugestão",
  exigenciasDaEtapa("andamento", undefined).map((e) => e.campo).join() === "assignee,due,checklist",
  JSON.stringify(exigenciasDaEtapa("andamento", undefined)),
);
checa(
  "lista vazia gravada é respeitada (o gestor tirou tudo)",
  exigenciasDaEtapa("andamento", []).length === 0,
);
checa(
  "configuração gravada vence a sugestão",
  exigenciasDaEtapa("andamento", [{ campo: "tags", obrigatorio: true }]).map((e) => e.campo).join() === "tags",
);
checa(
  "etapa criada à mão sem configuração não pede nada",
  exigenciasDaEtapa("revisao-juridica", undefined).length === 0,
);
checa(
  "passagem para Em andamento de card vazio pede responsável, prazo e checklist",
  oQueAPassagemPede({
    origem: "backlog",
    destino: "andamento",
    ordem: DEFAULT_COLUMNS.map((c) => c.id),
    exigencias: exigenciasDaEtapa("andamento", undefined),
    card: {},
  }).length === 3,
);

console.log(falhas === 0 ? "\netapas: ok" : `\netapas: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
