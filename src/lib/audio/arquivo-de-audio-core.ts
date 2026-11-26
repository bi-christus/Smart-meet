/**
 * O que conta como áudio de reunião — a regra das três portas do envio.
 *
 * Um PDF arrastado para a área de envio virou "reunião" (Issue #248): o
 * `accept` do seletor não vale para arrastar, nada mais conferia, e o motor da
 * nuvem trata como áudio qualquer arquivo com a etiqueta `smGerar` — então o
 * PDF voltava à fila dele a cada hora. A regra mora aqui, num módulo puro
 * (AGENTS.md §4, sem SDK e sem alias "@/"), porque três lugares a aplicam e
 * têm de concordar: a tela (`handleFile`), o início do envio
 * (`startFileUpload`) e o servidor (`api/drive/upload-url`).
 *
 * A tela e o servidor quase aplicam a mesma régua; a diferença é uma só, e é
 * de propósito:
 *
 * - A TELA só passa extensão da lista. Ela olha um arquivo que a pessoa
 *   escolheu, e dizer "isto não é aceito" antes de qualquer envio é o jeito
 *   mais barato de errar.
 * - O SERVIDOR passa a mesma lista E mais ".audio". Ele também recebe a
 *   gravação do microfone, e essa sai como ".audio" com MIME vazio quando o
 *   navegador não diz o formato (`extFromMime` em use-recorder.ts). Barrar
 *   isso perderia uma reunião gravada de verdade.
 *
 * A primeira versão do servidor era lista de RECUSA (só barrava o que é
 * claramente documento), e foi descartada: "contrato.pdf.", "contrato.pdf1",
 * "contrato" sem extensão e a extensão em letra larga ("ｐｄｆ") passavam por
 * ela. Com lista de aceite, o que não está na lista não passa, escrito do
 * jeito que for.
 */

/**
 * A interseção do que o motor lista (`EXT_AUDIO`, vigia-smart-meet) com o que
 * o transcritor aceita (`EXTENSOES_AUDIO`, transcrever.py). A união foi
 * descartada: `m4b` e `mpga` o motor enxerga, mas o transcritor não aceita —
 * aceitar aqui seria prometer uma ata que a nuvem não consegue fazer.
 */
export const EXTENSOES_DE_AUDIO = [
  "mp3",
  "m4a",
  "mp4",
  "webm",
  "wav",
  "ogg",
  "oga",
  "opus",
  "aac",
  "flac",
  "aiff",
  "aif",
  "wma",
  "amr",
  "3gp",
] as const;

/**
 * O que a tela promete ("até 500 MB"). Em 1024, e não 1000, para bater com o
 * `fmtBytes` que mostra o tamanho na própria tela: com base 1000, um arquivo
 * de "490 MB" na tela seria recusado por passar de 500.
 */
export const LIMITE_DE_BYTES = 500 * 1024 * 1024;

/**
 * O `accept` do seletor de arquivo, com as extensões escritas uma a uma. O
 * "audio/*" que estava ali filtra por MIME, e o .mp4 do WhatsApp tem MIME
 * `video/mp4` — ficava de fora justamente o formato em que mais chega áudio
 * de celular. O `accept` só filtra o seletor: arrastar passa por cima dele,
 * e por isso a conferência de verdade é `conferirArquivoDeAudio`.
 */
export const ACCEPT_DE_AUDIO = EXTENSOES_DE_AUDIO.map((e) => `.${e}`).join(",");

/** Para as mensagens: os aliases (oga, aif) ficam de fora para a frase caber. */
const FORMATOS_LEGIVEIS =
  "MP3, M4A, MP4 do WhatsApp, WAV, WebM, OGG, OPUS, AAC, FLAC, AIFF, WMA, AMR ou 3GP";

/**
 * A extensão da gravação do microfone quando o navegador não informa o
 * formato (`extFromMime`). Só o servidor a aceita: na tela, um arquivo do
 * disco com esse nome não é formato que o transcritor conheça, e fica de fora
 * como qualquer outro.
 */
const EXTENSAO_DO_MICROFONE_SEM_FORMATO = "audio";

/**
 * Extensões que são documento, imagem, texto ou pacote — nunca áudio. Não é a
 * régua de aceite (essa é `EXTENSOES_DE_AUDIO`): serve para a mensagem dizer
 * "não é um áudio" em vez de "formato não aceito", que é o erro de verdade de
 * quem arrastou um PDF.
 */
const EXTENSOES_DE_DOCUMENTO = new Set([
  // texto e escritório
  "pdf", "doc", "docx", "docm", "dot", "dotx", "odt", "ott", "rtf", "txt",
  "md", "csv", "tsv", "json", "xml", "html", "htm", "xls", "xlsx", "xlsm",
  "ods", "ppt", "pptx", "pps", "ppsx", "odp", "key", "pages", "numbers",
  "epub", "eml", "msg", "ics", "vcf",
  // imagem
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif",
  "svg", "ico", "avif", "psd",
  // pacote e programa
  "zip", "rar", "7z", "tar", "gz", "exe", "msi", "bat", "cmd", "ps1", "js",
]);

/** Famílias de MIME que nunca são áudio. */
const PREFIXOS_DE_DOCUMENTO = [
  "image/",
  "text/",
  "font/",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.oasis.opendocument.",
  "application/vnd.google-apps.",
  "application/vnd.ms-word",
];

/**
 * MIMEs exatos. `application/vnd.ms-*` NÃO entra como prefixo: a família
 * inclui `application/vnd.ms-asf`, que é contêiner de áudio do Windows (WMA).
 */
const MIMES_DE_DOCUMENTO = new Set([
  "application/pdf",
  "application/msword",
  "application/rtf",
  "application/json",
  "application/xml",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-outlook",
  "application/x-msdownload",
  "application/epub+zip",
]);

/**
 * A extensão como o motor da nuvem a lê (`extDe`): depois do último ponto, em
 * minúsculas, de 1 a 5 letras ou números. Nome que começa com ponto não tem
 * extensão. Igual ao motor para que "aceito aqui" e "enxergado lá" sejam a
 * mesma pergunta.
 */
export function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf(".");
  if (i <= 0) return "";
  const e = nome.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(e) ? e : "";
}

/** O MIME sem parâmetros (`audio/webm;codecs=opus` → `audio/webm`). */
function mimeBase(tipo: string | null | undefined): string {
  return (tipo || "").split(";")[0].trim().toLowerCase();
}

/** true quando o nome OU o MIME dizem que o arquivo é documento/imagem/texto. */
export function ehDocumento(
  nome: string,
  tipo?: string | null,
): boolean {
  if (EXTENSOES_DE_DOCUMENTO.has(extensaoDe(nome))) return true;
  const mime = mimeBase(tipo);
  if (!mime) return false;
  return (
    MIMES_DE_DOCUMENTO.has(mime) ||
    PREFIXOS_DE_DOCUMENTO.some((p) => mime.startsWith(p))
  );
}

export type ArquivoParaConferir = {
  nome: string;
  /** o MIME que o navegador informou (pode vir vazio) */
  tipo?: string | null;
  /** tamanho em bytes, quando se sabe (a gravação do microfone não sabe) */
  bytes?: number | null;
};

export type Veredito =
  | { ok: true }
  | {
      ok: false;
      motivo: "documento" | "formato" | "vazio" | "grande";
      mensagem: string;
    };

const MIB = 1024 * 1024;

function recusaPorTamanho(nome: string, bytes: number): Veredito {
  // Para cima, e não arredondado: com `round`, um arquivo logo acima do
  // limite saía "tem 500 MB, e o limite é 500 MB" — a mensagem se desmentia.
  // Quem foi recusado está acima do limite, e o número tem de mostrar isso.
  const tem = Math.ceil(bytes / MIB);
  return {
    ok: false,
    motivo: "grande",
    mensagem: `“${nome}” tem ${tem} MB, e o limite é ${LIMITE_DE_BYTES / MIB} MB. Divida o áudio em partes menores e envie cada uma.`,
  };
}

function recusaPorFormato(nome: string, ext: string): Veredito {
  return {
    ok: false,
    motivo: "formato",
    mensagem: ext
      ? `Arquivos .${ext} não são aceitos. Envie o áudio em ${FORMATOS_LEGIVEIS}.`
      : `Não reconheci o formato de “${nome}”: o nome não termina em .mp3, .m4a ou outro formato de áudio. Envie o áudio em ${FORMATOS_LEGIVEIS}.`,
  };
}

function ehExtensaoDeAudio(ext: string): boolean {
  return (EXTENSOES_DE_AUDIO as readonly string[]).includes(ext);
}

function recusaPorDocumento(nome: string): Veredito {
  return {
    ok: false,
    motivo: "documento",
    mensagem: `“${nome}” não é um áudio. Envie a gravação da reunião (${FORMATOS_LEGIVEIS}).`,
  };
}

/**
 * A régua da TELA (estrita). Ordem das perguntas: o tipo antes do tamanho,
 * porque dizer "está grande demais" a quem mandou um PDF esconde o erro de
 * verdade.
 */
export function conferirArquivoDeAudio(a: ArquivoParaConferir): Veredito {
  const nome = a.nome || "arquivo";
  if (ehDocumento(nome, a.tipo)) return recusaPorDocumento(nome);

  const ext = extensaoDe(nome);
  if (!ehExtensaoDeAudio(ext)) return recusaPorFormato(nome, ext);

  if (typeof a.bytes === "number") {
    if (a.bytes <= 0) {
      return {
        ok: false,
        motivo: "vazio",
        mensagem: `“${nome}” está vazio (0 byte). Confira se a gravação foi salva por inteiro.`,
      };
    }
    if (a.bytes > LIMITE_DE_BYTES) return recusaPorTamanho(nome, a.bytes);
  }
  return { ok: true };
}

/**
 * A régua do SERVIDOR: a lista da tela mais ".audio" (ver o topo). O tamanho
 * só é conferido quando o cliente o declara: na gravação do microfone a sessão
 * abre antes de existir um total.
 */
export function recusaDoServidor(a: ArquivoParaConferir): Veredito {
  const nome = a.nome || "arquivo";
  if (ehDocumento(nome, a.tipo)) return recusaPorDocumento(nome);
  const ext = extensaoDe(nome);
  if (ext !== EXTENSAO_DO_MICROFONE_SEM_FORMATO && !ehExtensaoDeAudio(ext)) {
    return recusaPorFormato(nome, ext);
  }
  if (typeof a.bytes === "number" && a.bytes > LIMITE_DE_BYTES) {
    return recusaPorTamanho(nome, a.bytes);
  }
  return { ok: true };
}
