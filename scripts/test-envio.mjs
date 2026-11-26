/**
 * Testes do estado do painel do envio (`lib/audio/envio-core.ts`, Issue #250).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que nenhum outro portão protege:
 *
 * 1. QUANDO O PAINEL DIZ "PODE FECHAR O SITE". O registro de arquivo é apagado
 *    logo depois do `done`, e um registro sumido também é o que sobra de um
 *    envio descartado. Se alguém simplificar a regra para "sumiu = terminou",
 *    o painel manda fechar o site com o áudio pela metade — passa em tipo, em
 *    lint e na tela de quem testa com rede boa.
 * 2. QUE A CONFIRMAÇÃO NÃO VOLTA ATRÁS. Uma leitura atrasada do IndexedDB que
 *    chega depois do `done` não pode tirar o ✓ da tela.
 * 3. QUE O PERCENTUAL NÃO DIZ 100% ANTES DA HORA, e que a pílula soma bytes, e
 *    não frações.
 * 4. QUE RECUSADO NÃO PRENDE O SITE e falha prende.
 * 5. AS CONSTANTES DE TEMPO, que precisam bater com o CSS do painel.
 */
import { readFileSync } from "node:fs";
import {
  CONFIRMACAO_MS,
  ESTOURO_MS,
  estadoDoEnvio,
  mensagemDoErro,
  percentual,
  prendeOSite,
  restanteDepoisDe,
  resumirEnvios,
  textoDeBytes,
} from "../src/lib/audio/envio-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

const MB = 1024 * 1024;
const reg = (extra = {}) => ({
  status: "uploading",
  uploadedBytes: 0,
  totalBytes: 80 * MB,
  bytesWritten: 80 * MB,
  error: null,
  sessionUri: "https://sessao",
  ...extra,
});

console.log("\n— a regra de \"terminou\" —");

checa("status done conclui", estadoDoEnvio({ registro: reg({ status: "done", uploadedBytes: 80 * MB }), reuniao: undefined })?.fase === "concluido");
checa(
  "registro sumido + reunião 'concluido' conclui",
  estadoDoEnvio({ registro: null, reuniao: { uploadStatus: "concluido", totalBytes: 80 * MB } })?.fase === "concluido",
);
checa(
  "registro sumido com a reunião ainda 'enviando' NÃO conclui",
  estadoDoEnvio({ registro: null, reuniao: { uploadStatus: "enviando" } }, "enviando")?.fase === "enviando",
);
checa(
  "registro sumido com a reunião ainda por chegar NÃO conclui",
  estadoDoEnvio({ registro: null, reuniao: undefined }, "enviando")?.fase === "enviando",
);
checa(
  "e sem fase anterior fica em 'preparando', não em 'concluido'",
  estadoDoEnvio({ registro: null, reuniao: undefined })?.fase === "preparando",
);
checa(
  "registro e reunião apagados = descartado (sai da tela)",
  estadoDoEnvio({ registro: null, reuniao: null }, "enviando") === null,
);
checa(
  "o rascunho 'gravando' do arquivo também não conclui",
  estadoDoEnvio({ registro: null, reuniao: { uploadStatus: "gravando" } })?.fase === "preparando",
);

console.log("\n— a confirmação não volta atrás —");

checa(
  "leitura velha 'uploading' depois do done mantém o ✓",
  estadoDoEnvio({ registro: reg({ uploadedBytes: 72 * MB }), reuniao: undefined }, "concluido")?.fase === "concluido",
);
checa(
  "e o registro apagado depois do done também",
  estadoDoEnvio({ registro: null, reuniao: null }, "concluido")?.fase === "concluido",
);
checa(
  "recusado é final mesmo com leitura velha",
  estadoDoEnvio({ registro: reg(), reuniao: undefined }, "recusado")?.fase === "recusado",
);

console.log("\n— as fases —");

checa("sem sessão e sem byte = preparando", estadoDoEnvio({ registro: reg({ sessionUri: null }), reuniao: undefined })?.fase === "preparando");
checa("com sessão = enviando", estadoDoEnvio({ registro: reg(), reuniao: undefined })?.fase === "enviando");
checa("microfone ainda gravando = preparando", estadoDoEnvio({ registro: reg({ status: "recording", totalBytes: null }), reuniao: undefined })?.fase === "preparando");
const falha = estadoDoEnvio({ registro: reg({ status: "failed", error: "Falha na rede", uploadedBytes: 16 * MB }), reuniao: undefined });
checa("failed = falha, com o erro", falha?.fase === "falha" && falha.erro === "Falha na rede");
const semRede = estadoDoEnvio({ registro: reg({ status: "failed", error: "Failed to fetch" }), reuniao: undefined });
checa("queda de rede vira frase em português", semRede?.erro === "A conexão caiu no meio do envio.", String(semRede?.erro));
checa("e a do Firefox e a do Safari também", mensagemDoErro("NetworkError when attempting to fetch resource.") === mensagemDoErro("Load failed"));
checa("mensagem da casa passa inteira", mensagemDoErro("O arquivo original não está mais acessível.") === "O arquivo original não está mais acessível.");
checa("e com cópia local para baixar", falha?.temCopiaLocal === true);
const recusado = estadoDoEnvio({ registro: reg({ status: "failed", recusado: true, error: "Não é áudio" }), reuniao: undefined });
checa("failed + recusado = recusado", recusado?.fase === "recusado");
const soNoFirestore = estadoDoEnvio({ registro: null, reuniao: { uploadStatus: "falha", uploadError: "Gravação interrompida antes de captar áudio." } });
checa("falha que só o Firestore conhece aparece", soNoFirestore?.fase === "falha" && /interrompida/.test(soNoFirestore.erro ?? ""));
checa("mas sem prometer cópia local", soNoFirestore?.temCopiaLocal === false);

console.log("\n— parado (a animação para junto) —");

checa("erro numa tentativa = tentando", estadoDoEnvio({ registro: reg({ error: "Failed to fetch", uploadedBytes: 8 * MB }), reuniao: undefined })?.parado === "tentando");
checa("sem rede = sem-rede", estadoDoEnvio({ registro: reg(), reuniao: undefined, online: false })?.parado === "sem-rede");
checa("andando normalmente = não parado", estadoDoEnvio({ registro: reg({ uploadedBytes: 8 * MB }), reuniao: undefined })?.parado === null);

console.log("\n— percentual e bytes —");

const quase = estadoDoEnvio({ registro: reg({ uploadedBytes: 80 * MB - 1 }), reuniao: undefined });
checa("99,99% não vira 100%", percentual(quase?.fracao ?? null) === 99, String(percentual(quase?.fracao ?? null)));
checa("concluído é 100%", percentual(estadoDoEnvio({ registro: reg({ status: "done" }), reuniao: undefined })?.fracao ?? null) === 100);
checa("fração nunca passa de 1", estadoDoEnvio({ registro: reg({ uploadedBytes: 90 * MB }), reuniao: undefined })?.fracao === 1);
checa("total desconhecido = fração nula", estadoDoEnvio({ registro: reg({ totalBytes: null }), reuniao: undefined })?.fracao === null);
checa("os dois números na mesma unidade, com vírgula", textoDeBytes(34 * MB, 80 * MB) === "34,0 MB de 80,0 MB", textoDeBytes(34 * MB, 80 * MB));
checa("arquivo pequeno em KB nos dois lados", textoDeBytes(300 * 1024, 900 * 1024) === "300 KB de 900 KB", textoDeBytes(300 * 1024, 900 * 1024));
checa("total desconhecido = sem texto", textoDeBytes(10, null) === "");

console.log("\n— a pílula (vários envios) —");

const grande = estadoDoEnvio({ registro: reg({ totalBytes: 200 * MB, bytesWritten: 200 * MB, uploadedBytes: 0 }), reuniao: undefined });
const pequeno = estadoDoEnvio({ registro: reg({ status: "done", totalBytes: 2 * MB, bytesWritten: 2 * MB }), reuniao: undefined });
const r = resumirEnvios([grande, pequeno]);
checa("soma bytes, não frações (2 de 202 MB = 0%, não 50%)", percentual(r?.fracao ?? null) === 0, String(percentual(r?.fracao ?? null)));
checa("com um ainda andando, a fase é 'enviando'", r?.fase === "enviando");
checa("e só ele conta como 'subindo'", r?.subindo === 1, String(r?.subindo));
checa("todos concluídos = concluido", resumirEnvios([pequeno, pequeno])?.fase === "concluido");
checa("falha vem na frente", resumirEnvios([grande, falha])?.fase === "falha");
checa("recusado não esconde o aviso de quem ainda envia", resumirEnvios([grande, recusado])?.fase === "enviando");
checa("recusado sozinho com um concluído segura o painel", resumirEnvios([pequeno, recusado])?.fase === "recusado");
checa("recusado fica fora da conta de bytes", resumirEnvios([grande, recusado])?.fracao === 0);
checa("lista vazia = nada", resumirEnvios([]) === null);

console.log("\n— o que prende o site —");

checa("enviando prende", prendeOSite("enviando"));
checa("preparando prende (arma no instante em que começa)", prendeOSite("preparando"));
checa("falha prende (a cópia só existe aqui)", prendeOSite("falha"));
checa("recusado NÃO prende", !prendeOSite("recusado"));
checa("concluido NÃO prende", !prendeOSite("concluido"));

console.log("\n— o relógio e o CSS —");

checa("tempo visível é descontado", restanteDepoisDe(2200, 1000, 1500) === 1700);
checa("e nunca fica negativo", restanteDepoisDe(200, 0, 5000) === 0);
checa("confirmação de ~2,2 s", CONFIRMACAO_MS === 2200);
checa("estouro dentro dos 300 ms da casa", ESTOURO_MS <= 300);

// O fechamento é por setTimeout com ESTOURO_MS: se o CSS crescer além disso, a
// bolha é cortada no meio. Lê a folha e confere que nenhum fim (atraso +
// duração) das animações do estouro passa do valor.
const css = readFileSync(new URL("../src/components/painel-do-envio.module.css", import.meta.url), "utf8");
const estouro = [...css.matchAll(/animation:\s*(estoura\w*|gotaVoa\w*|aroEstoura\w*)\s+(\d+)ms(?:\s+(\d+)ms)?/g)];
checa("a folha tem as animações do estouro", estouro.length >= 3, String(estouro.length));
const maiorFim = Math.max(...estouro.map((m) => Number(m[2]) + Number(m[3] ?? 0)));
checa(`nenhuma passa de ESTOURO_MS (${ESTOURO_MS} ms)`, maiorFim <= ESTOURO_MS, `${maiorFim} ms`);
checa("nenhum ouvinte de animationend no painel", !/onAnimationEnd|animationend/.test(readFileSync(new URL("../src/components/painel-do-envio.tsx", import.meta.url), "utf8")));

console.log(
  falhas === 0 ? "\n✅ painel do envio: ok" : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
