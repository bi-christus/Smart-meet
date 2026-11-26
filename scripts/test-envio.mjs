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
 * 4. QUE RECUSADO NÃO PRENDE O SITE e falha prende — menos a falha sem cópia
 *    local, que não tem o que proteger.
 * 5. QUE O ENVIO DESCARTADO EM OUTRA ABA SAI DA TELA, em vez de dizer "não
 *    feche o site" para sempre — sem levar junto o que só sumiu por ter
 *    concluído.
 * 6. AS CONSTANTES DE TEMPO, que precisam bater com o CSS do painel.
 */
import { readFileSync } from "node:fs";
import {
  CONFIRMACAO_MS,
  ESTOURO_MS,
  LEITURAS_SEM_REGISTRO,
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

console.log("\n— o envio descartado em outra aba —");

const enviandoSemRegistro = (n) =>
  estadoDoEnvio(
    { registro: null, reuniao: { uploadStatus: "enviando" }, leiturasSemRegistro: n },
    "enviando",
  );
checa(
  `até ${LEITURAS_SEM_REGISTRO - 1} leituras sem registro, ainda espera`,
  enviandoSemRegistro(LEITURAS_SEM_REGISTRO - 1)?.fase === "enviando",
);
checa(
  `com ${LEITURAS_SEM_REGISTRO} seguidas e a reunião ainda 'enviando', sai da tela`,
  enviandoSemRegistro(LEITURAS_SEM_REGISTRO) === null,
);
checa(
  "e a reunião ainda por chegar também não segura para sempre",
  estadoDoEnvio({ registro: null, reuniao: undefined, leiturasSemRegistro: LEITURAS_SEM_REGISTRO }, "enviando") === null,
);
checa(
  "mas o que sumiu por ter CONCLUÍDO continua concluindo",
  estadoDoEnvio({ registro: null, reuniao: { uploadStatus: "concluido" }, leiturasSemRegistro: 99 }, "enviando")?.fase === "concluido",
);
checa(
  "e a falha que só o Firestore conhece não some calada",
  estadoDoEnvio({ registro: null, reuniao: { uploadStatus: "falha" }, leiturasSemRegistro: 99 }, "falha")?.fase === "falha",
);
checa(
  "registro lido zera a conta (o core só olha o número que recebe)",
  estadoDoEnvio({ registro: reg(), reuniao: { uploadStatus: "enviando" }, leiturasSemRegistro: 99 }, "enviando")?.fase === "enviando",
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

const tentando = estadoDoEnvio({ registro: reg({ error: "Failed to fetch", uploadedBytes: 8 * MB }), reuniao: undefined });
const semRedeAgora = estadoDoEnvio({ registro: reg(), reuniao: undefined, online: false });
const andando = estadoDoEnvio({ registro: reg({ uploadedBytes: 8 * MB }), reuniao: undefined });
checa("erro numa tentativa = tentando", tentando?.parado === "tentando");
checa("sem rede = sem-rede", semRedeAgora?.parado === "sem-rede");
checa("andando normalmente = não parado", andando?.parado === null);
// O resumo decide a pílula e o aviso com mais de um envio: um só que ainda
// anda basta para a animação seguir, porque há byte subindo.
checa("um parado e outro andando = o resumo não para", resumirEnvios([tentando, andando])?.parado === null);
checa("os dois parados, um sem rede = sem-rede", resumirEnvios([tentando, semRedeAgora])?.parado === "sem-rede");
checa("os dois tentando = tentando", resumirEnvios([tentando, tentando])?.parado === "tentando");

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
checa("falha sem cópia é marcada (o aviso não promete cópia)", resumirEnvios([soNoFirestore])?.falhaSemCopia === true);
checa("falha com cópia não é", resumirEnvios([falha])?.falhaSemCopia === false);
checa("basta uma falha com cópia para o aviso falar dela", resumirEnvios([falha, soNoFirestore])?.falhaSemCopia === false);
checa("sem falha nenhuma, não é", resumirEnvios([grande])?.falhaSemCopia === false);

console.log("\n— o que prende o site —");

checa("enviando prende", prendeOSite("enviando"));
checa("preparando prende (arma no instante em que começa)", prendeOSite("preparando"));
checa("falha prende (a cópia só existe aqui)", prendeOSite("falha"));
checa("e a falha com cópia local, lida da linha, também", prendeOSite(falha.fase, falha.temCopiaLocal));
checa("falha SEM cópia local NÃO prende (não há o que proteger)", !prendeOSite(soNoFirestore.fase, soNoFirestore.temCopiaLocal));
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
//
// O leitor entende a declaração inteira, e não um formato só: no atalho
// `animation`, o 1º tempo é a duração e o 2º o atraso EM QUALQUER POSIÇÃO
// (depois da curva também), em ms ou em s; e `animation-duration` e
// `animation-delay` soltos na mesma regra valem por cima. Uma regex que lia só
// "nome 280ms 70ms" deixava passar um atraso escrito depois da curva — e o
// portão ficava verde com a bolha cortada. O que não der para ler reprova.
const NOMES_DO_ESTOURO = /\b(estouraBolha|aroEstoura|gotaVoa)\b/;
function tempoEmMs(s) {
  const m = /^(-?\d*\.?\d+)(ms|s)$/.exec(s.trim());
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : NaN;
}
/** Separa por vírgula FORA de parênteses — a curva `cubic-bezier(…)` tem as suas. */
function porVirgula(s) {
  const partes = [];
  let fundo = 0;
  let atual = "";
  for (const c of s) {
    if (c === "(") fundo++;
    if (c === ")") fundo--;
    if (c === "," && fundo === 0) {
      partes.push(atual);
      atual = "";
    } else atual += c;
  }
  partes.push(atual);
  return partes.map((p) => p.trim()).filter(Boolean);
}
/** Cada animação do estouro na folha, com { nome, fim } ou { nome, erro }. */
function animacoesDoEstouro(folha) {
  const achadas = [];
  // Blocos sem chave dentro: as regras (também as de dentro do @media) e os
  // passos dos @keyframes, que não têm `animation` e ficam de fora sozinhos.
  for (const [, , corpo] of folha.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const decl = corpo
      .split(";")
      .map((d) => d.split(":"))
      .filter((d) => d.length >= 2)
      .map(([p, ...v]) => [p.trim(), v.join(":").trim()]);
    const solta = (p) => decl.filter(([q]) => q === p).map(([, v]) => v).at(-1);
    const duracaoSolta = solta("animation-duration");
    const atrasoSolto = solta("animation-delay");
    const nomeSolto = solta("animation-name");
    const atalhos = decl
      .filter(([p]) => p === "animation")
      .flatMap(([, v]) => porVirgula(v))
      .filter((a) => NOMES_DO_ESTOURO.test(a));
    if (!atalhos.length && nomeSolto && NOMES_DO_ESTOURO.test(nomeSolto)) atalhos.push(nomeSolto);
    for (const a of atalhos) {
      const nome = NOMES_DO_ESTOURO.exec(a)[1];
      const tempos = a
        .replace(/\([^)]*\)/g, "")
        .split(/\s+/)
        .filter((t) => /^-?\d*\.?\d+m?s$/.test(t))
        .map(tempoEmMs);
      const duracao = duracaoSolta !== undefined ? tempoEmMs(duracaoSolta) : tempos[0];
      const atraso = atrasoSolto !== undefined ? tempoEmMs(atrasoSolto) : (tempos[1] ?? 0);
      if (!Number.isFinite(duracao) || !Number.isFinite(atraso)) {
        achadas.push({ nome, erro: `não deu para ler "${a}"` });
      } else achadas.push({ nome, fim: duracao + atraso });
    }
  }
  return achadas;
}

// O próprio leitor, contra os formatos que a regex antiga deixava passar.
const lido = (css) => animacoesDoEstouro(css).map((x) => x.fim ?? x.erro).join("|");
checa("leitor: atraso depois da curva", lido(".a{animation: gotaVoa 200ms cubic-bezier(0.2, 0, 0, 1) 150ms backwards}") === "350");
checa("leitor: tempo em segundos", lido(".a{animation: aroEstoura .25s .1s}") === "350");
checa("leitor: animation-delay solto vale por cima", lido(".a{animation: estouraBolha 280ms; animation-delay: 90ms}") === "370");
checa("leitor: só animation-name + duration soltos", lido(".a{animation-name: gotaVoa; animation-duration: 310ms}") === "310");
checa("leitor: sem duração legível reprova", /não deu/.test(lido(".a{animation: gotaVoa forwards}")));

const css = readFileSync(new URL("../src/components/painel-do-envio.module.css", import.meta.url), "utf8");
const estouro = animacoesDoEstouro(css);
checa("a folha tem as animações do estouro", estouro.length >= 3, String(estouro.length));
const ilegiveis = estouro.filter((x) => x.erro);
checa("todas legíveis", ilegiveis.length === 0, ilegiveis.map((x) => x.erro).join("; "));
const maiorFim = Math.max(...estouro.map((x) => x.fim ?? Infinity));
checa(`nenhuma passa de ESTOURO_MS (${ESTOURO_MS} ms)`, maiorFim <= ESTOURO_MS, `${maiorFim} ms`);
checa("nenhum ouvinte de animationend no painel", !/onAnimationEnd|animationend/.test(readFileSync(new URL("../src/components/painel-do-envio.tsx", import.meta.url), "utf8")));

console.log(
  falhas === 0 ? "\n✅ painel do envio: ok" : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
