/**
 * Testes da regra "isto é áudio de reunião?" (`lib/audio/arquivo-de-audio-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que nenhum outro portão protege:
 *
 * 1. QUE DOCUMENTO NÃO VIRA REUNIÃO. Um PDF arrastado para a área de envio
 *    virou reunião, foi para o Drive com a etiqueta `smGerar` e o motor da
 *    nuvem passou a listá-lo a cada hora (Issue #248). Nada na tela mostra
 *    isso: aparece semanas depois, como uma reunião "aguardando" para sempre.
 *
 * 2. QUE A GRAVAÇÃO DO MICROFONE NUNCA É BARRADA NO SERVIDOR. Quando o
 *    navegador não informa o formato, a gravação sai como ".audio" com MIME
 *    vazio. Uma régua de servidor "mais segura", que exigisse a lista de
 *    extensões, recusaria a sessão de envio de uma reunião real — e o áudio
 *    ficaria preso no computador da pessoa. O teste fixa a assimetria: a tela
 *    é estrita, o servidor só recusa o que é claramente não-áudio.
 *
 * 3. O .MP4 DO WHATSAPP. É o formato em que mais chega áudio de celular, tem
 *    MIME de vídeo, e já ficou dois dias invisível para o motor uma vez.
 */
import {
  ACCEPT_DE_AUDIO,
  EXTENSOES_DE_AUDIO,
  LIMITE_DE_BYTES,
  conferirArquivoDeAudio,
  ehDocumento,
  extensaoDe,
  recusaDoServidor,
} from "../src/lib/audio/arquivo-de-audio-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}
const MB = 1024 * 1024;
const tela = (nome, tipo = "", bytes = 3 * MB) =>
  conferirArquivoDeAudio({ nome, tipo, bytes });
const servidor = (nome, tipo = "", bytes) => recusaDoServidor({ nome, tipo, bytes });

console.log("\n— a lista aceita —");

checa(
  "são as 15 extensões da interseção motor × transcritor",
  EXTENSOES_DE_AUDIO.join(" ") ===
    "mp3 m4a mp4 webm wav ogg oga opus aac flac aiff aif wma amr 3gp",
  EXTENSOES_DE_AUDIO.join(" "),
);
for (const e of EXTENSOES_DE_AUDIO) {
  const v = tela(`reuniao.${e}`);
  checa(`.${e} passa na tela, mesmo com MIME vazio`, v.ok, v.ok ? "" : v.mensagem);
}
checa("maiúscula não importa (.MP3)", tela("Reunião.MP3", "audio/mpeg").ok);
checa("m4b fica de fora (o transcritor não aceita)", !tela("livro.m4b").ok);
checa("mpga fica de fora (o transcritor não aceita)", !tela("x.mpga").ok);

console.log("\n— o seletor de arquivo —");

checa("accept traz .mp4 escrito (o do WhatsApp)", ACCEPT_DE_AUDIO.split(",").includes(".mp4"));
checa("accept NÃO usa audio/* (esconderia o .mp4)", !ACCEPT_DE_AUDIO.includes("audio/*"));
checa(
  "accept tem as 15 extensões, com ponto",
  ACCEPT_DE_AUDIO.split(",").length === 15 &&
    ACCEPT_DE_AUDIO.split(",").every((x) => /^\.[a-z0-9]+$/.test(x)),
  ACCEPT_DE_AUDIO,
);

console.log("\n— o PDF e companhia —");

const pdf = tela("Relatório de obra.pdf", "application/pdf", 900 * 1024);
checa("PDF é recusado na tela", !pdf.ok && pdf.motivo === "documento");
checa(
  "a mensagem diz o que fazer, em português",
  !pdf.ok && pdf.mensagem.includes("não é um áudio") && pdf.mensagem.includes("MP3"),
  pdf.ok ? "" : pdf.mensagem,
);
checa("PDF é recusado no servidor (portão real)", !servidor("Relatório.pdf", "application/pdf").ok);
checa("PDF sem MIME é recusado pelo nome", !servidor("Relatório.pdf", "").ok);
checa(
  "documento disfarçado (.mp3 com MIME de PDF) é recusado pelo MIME",
  !servidor("x.mp3", "application/pdf").ok && !tela("x.mp3", "application/pdf").ok,
);
for (const [nome, tipo] of [
  ["planilha.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ata.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["foto.jpg", "image/jpeg"],
  ["print.png", "image/png"],
  ["notas.txt", "text/plain"],
  ["pacote.zip", "application/zip"],
  ["slides.pptx", ""],
  ["Documento Google", "application/vnd.google-apps.document"],
]) {
  checa(`${nome} é recusado no servidor`, !servidor(nome, tipo).ok);
}
checa("ehDocumento ignora os parâmetros do MIME", ehDocumento("x", "text/plain; charset=utf-8"));

console.log("\n— o microfone passa no servidor —");

for (const [nome, tipo] of [
  ["Gravação — 2026-11-26 10h30.audio", "application/octet-stream"],
  ["Gravação — 2026-11-26 10h30.audio", ""],
  ["Gravação — 2026-11-26 10h30.webm", "audio/webm;codecs=opus"],
  ["Gravação — 2026-11-26 10h30.ogg", "audio/ogg;codecs=opus"],
  ["Gravação — 2026-11-26 10h30.m4a", "audio/mp4"],
]) {
  const v = servidor(nome, tipo);
  checa(`servidor aceita ${nome.slice(-6)} (${tipo || "MIME vazio"})`, v.ok, v.ok ? "" : v.mensagem);
}
checa("servidor sem tamanho declarado não confere tamanho", servidor("g.webm", "audio/webm").ok);

console.log("\n— formatos que o servidor deixa e a tela não —");

const mov = tela("reuniao.mov", "video/quicktime");
checa("tela recusa .mov (fora da lista)", !mov.ok && mov.motivo === "formato");
checa("servidor aceita .mov (não é documento)", servidor("reuniao.mov", "video/quicktime").ok);
const semExt = tela("gravacao", "audio/mpeg");
checa(
  "tela recusa nome sem extensão, explicando",
  !semExt.ok && semExt.motivo === "formato" && semExt.mensagem.includes("não termina"),
);

console.log("\n— WhatsApp e Windows —");

checa("Áudio do WhatsApp em .mp4 (video/mp4) passa na tela", tela("Áudio do WhatsApp.mp4", "video/mp4").ok);
checa("e no servidor", servidor("Áudio do WhatsApp.mp4", "video/mp4").ok);
checa("WhatsApp .opus sem MIME passa", tela("PTT-20261126.opus", "").ok);
checa("WMA com MIME vnd.ms-asf passa (a família vnd.ms-* não é recusada inteira)", tela("r.wma", "application/vnd.ms-asf").ok);

console.log("\n— tamanho —");

checa("exatamente 500 MB passa", tela("a.mp3", "audio/mpeg", LIMITE_DE_BYTES).ok);
const grande = tela("longa.mp3", "audio/mpeg", LIMITE_DE_BYTES + 1);
checa("1 byte acima de 500 MB é recusado", !grande.ok && grande.motivo === "grande");
checa(
  "a mensagem dá o tamanho e o limite",
  !grande.ok && grande.mensagem.includes("500 MB"),
  grande.ok ? "" : grande.mensagem,
);
checa("servidor recusa tamanho declarado acima do limite", !servidor("a.mp3", "audio/mpeg", 600 * MB).ok);
checa("arquivo vazio é recusado na tela", tela("a.mp3", "audio/mpeg", 0).motivo === "vazio");
checa(
  "o tipo vem antes do tamanho (PDF enorme é 'não é áudio', não 'grande')",
  tela("enorme.pdf", "application/pdf", 900 * MB).motivo === "documento",
);

console.log("\n— a extensão como o motor lê —");

checa("extensão em minúsculas", extensaoDe("A.Mp3") === "mp3");
checa("nome que começa com ponto não tem extensão", extensaoDe(".mp3") === "");
checa("sem ponto não tem extensão", extensaoDe("audio") === "");
checa("o último ponto é o que vale", extensaoDe("ata.final.pdf") === "pdf");
checa("lixo depois do ponto não é extensão", extensaoDe("10.30 reunião") === "");

console.log(
  falhas === 0 ? "\n✅ arquivo de áudio: ok" : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
