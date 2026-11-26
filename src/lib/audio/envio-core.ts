/**
 * O que o painel do envio mostra, decidido a partir do que se sabe de UM envio
 * (Issue #250).
 *
 * Módulo puro de propósito: sem `firebase`, sem IndexedDB e sem o alias `@/`,
 * para o `scripts/test-envio.mjs` importá-lo pelo strip de tipos do Node e
 * fixar no `prebuild` a regra que decide quando o painel diz "Áudio enviado!".
 * Essa frase manda a pessoa fechar o site; dita antes da hora, é exatamente o
 * prejuízo que o painel existe para evitar.
 *
 * DUAS FONTES, porque nenhuma basta sozinha:
 *  - o registro do IndexedDB (`recording-db.ts`) tem o progresso fino, mas o
 *    de arquivo é APAGADO logo depois do `done` (`uploader.ts`, fim do
 *    `settle`): quem o lê um instante depois encontra nada, e "nada" também é
 *    o que sobra de um envio descartado;
 *  - o espelho no Firestore (`uploadStatus` da reunião) diz "concluido" mesmo
 *    quando quem terminou foi o service worker ou outra aba, mas só recebe
 *    progresso de 15 em 15 s.
 * Daí a regra de "terminou": status `done`, OU o registro sumiu e a reunião diz
 * `concluido`. Registro sumido sem essa confirmação não conclui nada — espera.
 */

export type FaseDoEnvio =
  | "preparando"
  | "enviando"
  | "concluido"
  | "falha"
  | "recusado";

/** O pedaço do `RecordingRecord` que importa aqui (o tipo inteiro mora no SDK do IndexedDB). */
export type RegistroLido = {
  status: "recording" | "uploading" | "done" | "failed";
  uploadedBytes: number;
  totalBytes: number | null;
  bytesWritten: number;
  error: string | null;
  recusado?: boolean;
  sessionUri?: string | null;
};

/** O espelho do envio no documento da reunião. */
export type ReuniaoLida = {
  uploadStatus?: string;
  uploadError?: string | null;
  uploadedBytes?: number;
  totalBytes?: number;
};

export type LeituraDoEnvio = {
  /** `undefined` = ainda não lido; `null` = lido, e não existe mais. */
  registro: RegistroLido | null | undefined;
  /**
   * `undefined` = ainda não chegou (ou a leitura falhou); `null` = não há
   * reunião para conferir — o documento foi apagado, ou o rascunho nem chegou
   * a ser criado.
   */
  reuniao: ReuniaoLida | null | undefined;
  /** `navigator.onLine`; ausente vale como conectado. */
  online?: boolean;
};

/** Por que a barra não anda — e a animação do painel para junto. */
export type MotivoParado = "sem-rede" | "tentando";

export type EstadoDoEnvio = {
  fase: FaseDoEnvio;
  /** 0..1, ou `null` quando o total não é conhecido. */
  fracao: number | null;
  enviados: number;
  total: number | null;
  /** "34,0 MB de 80,0 MB" — vazio quando o total não é conhecido. */
  bytes: string;
  erro: string | null;
  parado: MotivoParado | null;
  /**
   * Há registro local para "Tentar de novo" e "Baixar cópia". Uma falha que só
   * o Firestore conhece (a gravação morreu antes de captar áudio e o registro
   * foi apagado) não tem o que retomar, e os botões mentiriam.
   */
  temCopiaLocal: boolean;
};

/**
 * Quanto tempo a confirmação fica parada antes de o painel se fechar.
 *
 * PRECISA BATER COM O CSS no sentido de que nada no CSS pode durar mais do que
 * isto antes do estouro: a troca para o ✓ leva 180 ms, e o resto é leitura. Dois
 * segundos e pouco é o tempo de ler "Áudio enviado! Pode fechar o site" sem
 * pressa; mais que isso, o painel vira um obstáculo para quem quer continuar.
 * O relógio PARA com a aba escondida (ver o provedor): quem saiu da aba é
 * justamente quem precisa ver a confirmação ao voltar.
 */
export const CONFIRMACAO_MS = 2200;

/**
 * Duração do estouro da bolha. PRECISA BATER COM O CSS de
 * `painel-do-envio.module.css`: a bolha leva 280 ms, o aro 70 + 230 ms e as
 * gotas 100 + 200 ms — o maior fim é 300 ms. O fechamento é por `setTimeout`
 * com este valor, nunca por `animationend`: a rede global de movimento
 * reduzido (`globals.css`) corta as animações para 0,01 ms, e o projeto não
 * tem nenhum ouvinte desses (é o que a deixa ser agressiva).
 */
export const ESTOURO_MS = 300;

/** Duração da saída da casa (`modal.module.css`), que o painel usa ao minimizar. */
export const SAIDA_MS = 120;

const MB = 1024 * 1024;
const KB = 1024;

/**
 * "34,0 MB de 80,0 MB" — os dois números na MESMA unidade, escolhida pelo
 * total. Unidades diferentes ("900 KB de 1,2 MB") obrigariam a converter de
 * cabeça para saber quanto falta.
 *
 * Vírgula decimal, e não o `toFixed` cru do `fmtBytes` do IndexedDB: este
 * texto fica parado na frente da pessoa o envio inteiro.
 */
export function textoDeBytes(enviados: number, total: number | null): string {
  if (total === null || total <= 0) return "";
  const usarMb = total >= MB;
  const fmt = (n: number) =>
    usarMb
      ? `${(n / MB).toFixed(1).replace(".", ",")} MB`
      : `${Math.round(n / KB)} KB`;
  return `${fmt(Math.min(enviados, total))} de ${fmt(total)}`;
}

/**
 * Percentual inteiro para a tela. Arredonda PARA BAIXO: "100%" só aparece com
 * o envio concluído. Com arredondamento normal, 99,6% viraria 100% com a barra
 * ainda esperando o último bloco — a pessoa leria "acabou" e fecharia o site.
 */
export function percentual(fracao: number | null): number {
  if (fracao === null) return 0;
  return Math.max(0, Math.min(100, Math.floor(fracao * 100)));
}

function fracaoDe(enviados: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(1, enviados / total));
}

/**
 * O estado de um envio a partir das duas leituras.
 *
 * `anterior` é a fase que o painel já mostrava. Ela serve a duas coisas:
 *  - "concluido" e "recusado" são finais: uma leitura atrasada (o poll que
 *    volta depois do `done`, o snapshot antigo do Firestore) não pode desfazer
 *    a confirmação que já está na tela;
 *  - com o registro sumido e a reunião ainda sem resposta, o painel mantém o
 *    que mostrava em vez de pular para "preparando".
 *
 * Devolve `null` quando o envio deixou de existir sem ter concluído (registro
 * apagado e reunião apagada, ou sem reunião para conferir): foi descartado, e
 * o painel tira a linha em vez de esperar para sempre.
 */
export function estadoDoEnvio(
  leitura: LeituraDoEnvio,
  anterior: FaseDoEnvio | null = null,
): EstadoDoEnvio | null {
  const { registro, reuniao } = leitura;
  const online = leitura.online !== false;

  if (anterior === "concluido") return concluido(registro, reuniao);

  if (registro) {
    const total = registro.totalBytes;
    const enviados = registro.uploadedBytes;
    const base = {
      enviados,
      total,
      bytes: textoDeBytes(enviados, total),
      temCopiaLocal: true,
    };
    if (registro.status === "done") return concluido(registro, reuniao);
    if (registro.status === "failed") {
      return {
        ...base,
        fase: registro.recusado ? "recusado" : "falha",
        fracao: fracaoDe(enviados, total),
        erro: mensagemDoErro(registro.error),
        parado: null,
      };
    }
    // Um recusado é final mesmo que uma leitura velha o mostre "uploading".
    if (anterior === "recusado") {
      return {
        ...base,
        fase: "recusado",
        fracao: fracaoDe(enviados, total),
        erro: mensagemDoErro(registro.error),
        parado: null,
      };
    }
    // Sem sessão e sem byte enviado, ainda não começou: a barra em 0% com
    // "enviando" pareceria travada, quando o que falta é a sessão do Drive.
    const preparando =
      registro.status === "recording" ||
      (!registro.sessionUri && enviados === 0);
    return {
      ...base,
      fase: preparando ? "preparando" : "enviando",
      fracao: fracaoDe(enviados, total),
      erro: null,
      parado: !online ? "sem-rede" : registro.error ? "tentando" : null,
    };
  }

  // Daqui para baixo, o registro sumiu (ou ainda não foi lido).
  if (reuniao?.uploadStatus === "concluido") return concluido(registro, reuniao);
  if (reuniao?.uploadStatus === "falha" && registro === null) {
    const total = reuniao.totalBytes ?? null;
    const enviados = reuniao.uploadedBytes ?? 0;
    return {
      fase: "falha",
      fracao: fracaoDe(enviados, total),
      enviados,
      total,
      bytes: textoDeBytes(enviados, total),
      erro: mensagemDoErro(reuniao.uploadError ?? null),
      parado: null,
      temCopiaLocal: false,
    };
  }
  if (registro === null && reuniao === null) {
    // Um recusado descartado some do mesmo jeito; nos dois casos sai da tela.
    return null;
  }
  // Ainda sem resposta: mantém o que já se mostrava, com o progresso que o
  // espelho tiver (o do Firestore anda de 15 em 15 s, mas é melhor que nada).
  const total = reuniao?.totalBytes || null;
  const enviados = reuniao?.uploadedBytes ?? 0;
  const fase: FaseDoEnvio =
    anterior === "enviando" || anterior === "falha" || anterior === "recusado"
      ? anterior
      : "preparando";
  return {
    fase,
    fracao: fracaoDe(enviados, total),
    enviados,
    total,
    bytes: textoDeBytes(enviados, total),
    erro: null,
    parado: online ? null : "sem-rede",
    temCopiaLocal: registro !== null,
  };
}

function concluido(
  registro: RegistroLido | null | undefined,
  reuniao: ReuniaoLida | null | undefined,
): EstadoDoEnvio {
  const total =
    registro?.totalBytes ?? registro?.bytesWritten ?? reuniao?.totalBytes ?? null;
  const t = total && total > 0 ? total : null;
  return {
    fase: "concluido",
    fracao: 1,
    enviados: t ?? 0,
    total: t,
    bytes: textoDeBytes(t ?? 0, t),
    erro: null,
    parado: null,
    temCopiaLocal: false,
  };
}

/**
 * O erro do envio em português, para a tela.
 *
 * O motor guarda a mensagem crua do navegador, e a queda de rede chega como
 * "Failed to fetch" (Chrome), "NetworkError when attempting to fetch
 * resource." (Firefox) ou "Load failed" (Safari): inglês, e sem dizer o que
 * aconteceu. As mensagens da casa (o arquivo sumiu do disco, o servidor
 * recusou) já são frases em português e passam inteiras.
 */
export function mensagemDoErro(erro: string | null): string | null {
  if (!erro) return null;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(erro)) {
    return "A conexão caiu no meio do envio.";
  }
  return erro;
}

/**
 * Este envio ainda segura o site aberto (`beforeunload`)?
 *
 * Falha CONTA: o áudio não chegou ao Drive, e a cópia mora só neste
 * computador. Recusado NÃO conta: o servidor não vai aceitar aquele arquivo de
 * jeito nenhum, e pedir para a pessoa ficar no site por ele é prendê-la por
 * nada — a cópia original continua no computador dela.
 */
export function prendeOSite(fase: FaseDoEnvio): boolean {
  return fase !== "concluido" && fase !== "recusado";
}

export type ResumoDosEnvios = {
  fase: FaseDoEnvio;
  /** Fração somada pelos bytes, e não a média das frações. */
  fracao: number | null;
  quantos: number;
  /**
   * Quantos ainda sobem (preparando ou enviando). É este, e não `quantos`, que
   * vai no "Enviando 2 áudios": um já concluído ou recusado ao lado não está
   * sendo enviado, e contá-lo prometeria um envio que não existe.
   */
  subindo: number;
  parado: MotivoParado | null;
};

/**
 * Um número só para a pílula, quando há mais de um envio.
 *
 * A FRAÇÃO É PELOS BYTES: com um áudio de 200 MB e outro de 2 MB, a média das
 * frações diria 50% quando o pequeno acaba, e a pílula mentiria sobre quanto
 * falta. Recusado fica fora da conta — ele não vai andar.
 *
 * A FASE decide o título do painel e o que a pílula diz, nesta ordem:
 *  - falha primeiro: o áudio não chegou e a cópia só existe aqui — pede ação
 *    E pede o site aberto;
 *  - depois o que ainda anda: enquanto houver byte subindo, a frase que
 *    importa é "não feche o site". Um recusado ao lado não muda isso, e o
 *    título "arquivo não aceito" esconderia o aviso de quem ainda envia (a
 *    linha do recusado já diz o que fazer com ele);
 *  - recusado, quando é só o que sobrou: segura o painel aberto até alguém
 *    descartar;
 *  - "concluido" só quando TODOS concluíram — é o que dispara a bolha.
 */
export function resumirEnvios(estados: EstadoDoEnvio[]): ResumoDosEnvios | null {
  if (estados.length === 0) return null;
  const fases = estados.map((e) => e.fase);
  const fase: FaseDoEnvio = fases.includes("falha")
    ? "falha"
    : fases.includes("enviando")
      ? "enviando"
      : fases.includes("preparando")
        ? "preparando"
        : fases.includes("recusado")
          ? "recusado"
          : "concluido";

  let somaEnviados = 0;
  let somaTotal = 0;
  let conhecido = false;
  for (const e of estados) {
    if (e.fase === "recusado" || e.total === null) continue;
    conhecido = true;
    somaTotal += e.total;
    somaEnviados += Math.min(e.enviados, e.total);
  }
  const fracao =
    fase === "concluido" ? 1 : conhecido ? fracaoDe(somaEnviados, somaTotal) : null;

  const parados = estados.filter((e) => e.fase === "enviando" || e.fase === "preparando");
  const parado =
    parados.length > 0 && parados.every((e) => e.parado !== null)
      ? (parados.find((e) => e.parado === "sem-rede")?.parado ?? "tentando")
      : null;

  return { fase, fracao, quantos: estados.length, subindo: parados.length, parado };
}

/**
 * O relógio da confirmação, que para com a aba escondida: quanto ainda falta
 * depois de um trecho visível que começou em `inicio` e parou em `agora`.
 * Separado para o teste fixar que o tempo escondido não é descontado.
 */
export function restanteDepoisDe(restante: number, inicio: number, agora: number): number {
  return Math.max(0, restante - Math.max(0, agora - inicio));
}
