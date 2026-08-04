/**
 * Testes do validador do sidecar de demandas.
 *
 * Não é enfeite: este validador é a única coisa entre um arquivo JSON gerado
 * por um LLM e o banco. Se ele deixar passar uma ação que não existe, ou uma
 * proposta sem citação, a fila de validação deixa de ser revisável.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia, sem
 * reimplementação.
 */
import { validarSidecar, SCHEMA_ID } from "../src/lib/server/demandas-schema.ts";

const AUDIO = "1abcDEF";
let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(`${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
}

function base(propostas) {
  return {
    schema: SCHEMA_ID,
    driveFileId: AUDIO,
    base: "Reunião X",
    geradoEm: "2026-08-04T10:00:00-03:00",
    gerador: { skill: "processar-smart-meet" },
    transcricao: { arquivo: "x.md", truncada: false, palavras: 100 },
    catalogo: { hash: "abc", totalCards: 10 },
    propostas,
  };
}

function propostaBoa(extra = {}) {
  return {
    acao: "nova",
    certezaLLM: "alta",
    assunto: "1. Antivírus",
    resumo: "Renovar licenças do antivírus antes do vencimento.",
    evidencia: [{ citacao: "as licenças do antivírus vencem em setembro", marca: "00:12:40" }],
    conferir: [],
    proposta: {
      title: "Renovar licenças do antivírus",
      description: "Levantar quantidade e cotar.",
      type: "implementacao",
      tags: ["infra"],
      checklist: [{ text: "Levantar quantidade" }],
    },
    possivelDuplicataDe: [],
    ...extra,
  };
}

console.log("=== o que a gramática precisa RECUSAR ===\n");

for (const acao of ["ajuste", "remover", "substituir", "excluir", "delete"]) {
  const r = validarSidecar(base([propostaBoa({ acao })]), { driveFileId: AUDIO });
  checa(
    `ação "${acao}" é recusada`,
    r.ok && r.aceitas.length === 0 && r.rejeitadas.length === 1,
    r.ok ? r.rejeitadas[0]?.motivo : r.erro,
  );
}

{
  const r = validarSidecar(base([propostaBoa({ evidencia: [] })]), { driveFileId: AUDIO });
  checa(
    "proposta sem citação é recusada",
    r.ok && r.aceitas.length === 0,
    r.ok ? r.rejeitadas[0]?.motivo : r.erro,
  );
}
{
  const p = propostaBoa();
  p.proposta.type = "qualquer-coisa";
  const r = validarSidecar(base([p]), { driveFileId: AUDIO });
  checa("tipo inválido é recusado", r.ok && r.aceitas.length === 0);
}
{
  const r = validarSidecar(base([propostaBoa()]), { driveFileId: "OUTRO_AUDIO" });
  checa("sidecar de outro áudio é rejeitado inteiro", !r.ok, r.ok ? "" : r.erro);
}
{
  const s = base([propostaBoa()]);
  s.transcricao.truncada = true;
  const r = validarSidecar(s, { driveFileId: AUDIO });
  checa("transcrição truncada rejeita o lote inteiro", !r.ok, r.ok ? "" : r.erro);
}
{
  const s = base([propostaBoa()]);
  s.schema = "outro/schema@9";
  const r = validarSidecar(s, { driveFileId: AUDIO });
  checa("schema desconhecido é rejeitado", !r.ok);
}
{
  const r = validarSidecar(base(Array.from({ length: 9 }, () => propostaBoa())), {
    driveFileId: AUDIO,
  });
  checa(
    "teto de 5 propostas, e o excedente vira rejeitada visível",
    r.ok && r.aceitas.length === 5 && r.rejeitadas.length === 4,
    r.ok ? `aceitas=${r.aceitas.length} rejeitadas=${r.rejeitadas.length}` : r.erro,
  );
}

console.log("\n=== o que precisa PASSAR ===\n");

{
  const r = validarSidecar(base([]), { driveFileId: AUDIO });
  checa(
    "zero propostas é sucesso (reunião informativa)",
    r.ok && r.aceitas.length === 0 && r.rejeitadas.length === 0,
  );
}
{
  const r = validarSidecar(base([propostaBoa()]), { driveFileId: AUDIO });
  checa("proposta bem formada passa", r.ok && r.aceitas.length === 1);
  if (r.ok && r.aceitas[0]) {
    const p = r.aceitas[0];
    checa("campos de conteúdo preservados", p.proposta.title === "Renovar licenças do antivírus");
    checa("ação forçada para 'nova'", p.acao === "nova");
  }
}
{
  // Campos que a gramática não conhece precisam ser DESCARTADOS, não copiados:
  // é assim que o Cowork ficaria impedido de mandar prazo ou responsável.
  const p = propostaBoa();
  p.proposta.due = "2026-09-01";
  p.proposta.assignee = "alguem@x.com";
  p.proposta.priority = "alta";
  p.cardId = "kY8vN2pQ";
  const r = validarSidecar(base([p]), { driveFileId: AUDIO });
  const saiu = r.ok ? r.aceitas[0].proposta : {};
  checa("prazo não atravessa o validador", !("due" in saiu));
  checa("responsável não atravessa o validador", !("assignee" in saiu));
  checa("prioridade não atravessa o validador", !("priority" in saiu));
  checa("cardId não atravessa o validador", r.ok && !("cardId" in r.aceitas[0]));
}
{
  const p = propostaBoa();
  p.proposta.tags = Array.from({ length: 30 }, (_, i) => `t${i}`);
  p.proposta.checklist = Array.from({ length: 40 }, (_, i) => ({ text: `item ${i}` }));
  p.evidencia = Array.from({ length: 10 }, () => ({ citacao: "algo dito" }));
  const r = validarSidecar(base([p]), { driveFileId: AUDIO });
  const a = r.ok ? r.aceitas[0] : null;
  checa("tags limitadas a 8", a?.proposta.tags.length === 8);
  checa("checklist limitada a 10", a?.proposta.checklist.length === 10);
  checa("evidências limitadas a 3", a?.evidencia.length === 3);
}

console.log(falhas === 0 ? "\nRESULTADO: todos passaram.\n" : `\nRESULTADO: ${falhas} falha(s).\n`);
process.exitCode = falhas === 0 ? 0 : 1;
