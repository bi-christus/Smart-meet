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
  /**
   * Quantas releituras SEGUIDAS do IndexedDB vieram sem registro. Ausente vale
   * zero. É o que tira da tela o envio descartado em OUTRA aba (ver
   * `LEITURAS_SEM_REGISTRO`).
   */
  leiturasSemRegistro?: number;
  /**
   * O último progresso lido COM registro. Quando o registro some e a reunião
   * ainda não confirmou, a barra segura este número: o espelho do Firestore
   * anda de 15 em 15 s (ou nem chegou), e sem ele a barra recuava de 80% para
   * 0% enquanto o painel decidia se o envio tinha concluído ou sido descartado.
   */
  ultimo?: { enviados: number; total: number | null };
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
 * isto antes do estouro: a troca para o ✓ leva 180 ms, e o resto é leitura.
 * Os ~2 s são o que a Issue #250 fixou, e dão para o título ("Áudio
 * enviado!") e o começo do aviso ("Pode fechar o site") — não para a frase
 * inteira, que fala da transcrição e do e‑mail. Por isso o relógio PARA em
 * três casos (ver o provedor): com a aba escondida, porque quem saiu da aba é
 * justamente quem precisa ver a confirmação ao voltar; e com o ponteiro ou o
 * foco de TECLADO no painel, porque quem está lendo (ou ouvindo) até o fim não
 * pode ver o texto estourar no meio da frase.
 */
export const CONFIRMACAO_MS = 2200;

/**
 * Releituras seguidas sem registro (2,5 s cada, só com a aba à vista) até o
 * painel desistir de um envio que a reunião ainda diz "enviando".
 *
 * Sem este teto, o envio DESCARTADO EM OUTRA ABA ficava aqui para sempre: o
 * descarte só apaga o registro, a reunião segue dizendo "enviando", e o painel
 * mantinha "Não feche o site" e o aviso de saída armado sem prazo. Três
 * leituras (~7,5 s) sobram para o caso em que o registro some porque o envio
 * CONCLUIU: quem conclui grava "concluido" na reunião ANTES de apagar o
 * registro (`settle` e `finalizePending` no `uploader.ts`), e o Firestore
 * entrega isso em fração de segundo.
 */
export const LEITURAS_SEM_REGISTRO = 3;

/**
 * Duração do estouro da bolha. PRECISA BATER COM O CSS de
 * `painel-do-envio.module.css`: a bolha leva 280 ms, o aro 70 + 230 ms e as
 * gotas 100 + 200 ms — o maior fim é 300 ms. O fechamento é por `setTimeout`
 * com este valor, nunca por `animationend`: a rede global de movimento
 * reduzido (`globals.css`) corta as animações para 0,01 ms, e o projeto não
 * tem nenhum ouvinte desses (é o que a deixa ser agressiva).
 */
export const ESTOURO_MS = 300;

/**
 * Duração da saída do painel quando o último envio é descartado (ou
 * dispensado). PRECISA BATER COM O `sai` de `painel-do-envio.module.css`
 * (120 ms, a saída da casa): o retrato do painel é tirado por `setTimeout`
 * com este valor, pelo mesmo motivo do `ESTOURO_MS`. Sem ele, painel e véu
 * sumiam no mesmo quadro do clique — a única saída do painel sem transição.
 */
export const SAIDA_MS = 120;

const MB = 1024 * 1024;
const KB = 1024;

function emUnidade(n: number, usarMb: boolean): string {
  return usarMb
    ? `${(n / MB).toFixed(1).replace(".", ",")} MB`
    : `${Math.round(n / KB)} KB`;
}

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
  return `${emUnidade(Math.min(enviados, total), usarMb)} de ${emUnidade(total, usarMb)}`;
}

/**
 * Um tamanho sozinho, no formato do painel. É o da faixa de recuperação, que
 * aparece junto do painel com a mesma falha: lado a lado, "80.0 MB" ali e
 * "80,0 MB" aqui pareciam dois arquivos diferentes.
 */
export function textoDeTamanho(n: number): string {
  return emUnidade(n, n >= MB);
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
 * apagado e reunião apagada, ou sem reunião para conferir; ou o registro
 * sumido por `LEITURAS_SEM_REGISTRO` leituras sem a reunião dizer
 * "concluido"): foi descartado, e o painel tira a linha em vez de esperar
 * para sempre.
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
  // Depois da falha de propósito: a falha que só o Firestore conhece tem
  // texto e botão próprios, e sumir com ela esconderia que o áudio não chegou.
  if (
    registro === null &&
    (leitura.leiturasSemRegistro ?? 0) >= LEITURAS_SEM_REGISTRO
  ) {
    return null;
  }
  // Ainda sem resposta: mantém o que já se mostrava. O progresso é o maior
  // entre o último lido do registro e o espelho (ver `ultimo`).
  const total = leitura.ultimo?.total ?? (reuniao?.totalBytes || null);
  const enviados = Math.max(
    leitura.ultimo?.enviados ?? 0,
    reuniao?.uploadedBytes ?? 0,
  );
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
 * aconteceu. As mensagens da casa (o servidor recusou, a cópia local
 * inconsistente) já são frases em português e passam inteiras.
 *
 * A exceção é a do arquivo que sumiu do disco: o motor manda "selecione-o
 * novamente", e não existe tela para isso — o "Tentar de novo" refaz as 12
 * tentativas e falha, e o "Baixar cópia" entrega o mesmo arquivo ilegível. A
 * única saída que funciona é descartar e registrar de novo, e é ela que a
 * frase diz.
 */
export function mensagemDoErro(erro: string | null): string | null {
  if (!erro) return null;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(erro)) {
    return "A conexão caiu no meio do envio.";
  }
  if (/não está mais acessível/i.test(erro)) {
    return "O arquivo foi movido, renomeado ou apagado do computador. Descarte este envio e registre a reunião de novo com o arquivo.";
  }
  return erro;
}

/**
 * O que fazer com arquivo recusado — no painel e na faixa de recuperação, que
 * falam dos mesmos arquivos e por isso dizem a mesma frase. "O sistema", e
 * não "o servidor"; e "veja o motivo", porque quem diz o que fazer é a
 * mensagem da recusa (dividir o áudio, trocar o formato), e uma segunda
 * instrução ao lado ("envie o áudio certo") a contradizia. No plural quando
 * são vários: a faixa dizia "2 arquivos não foram aceitos" no título e "este
 * arquivo" logo abaixo.
 */
export function avisoRecusado(quantos: number): string {
  return quantos > 1
    ? "O sistema não aceitou estes arquivos. Veja o motivo de cada um abaixo, descarte e envie de novo — os originais continuam no seu computador."
    : "O sistema não aceitou este arquivo. Veja o motivo abaixo, descarte e envie de novo — o original continua no seu computador.";
}

/**
 * Este envio ainda segura o site aberto (`beforeunload`)?
 *
 * Falha CONTA: o áudio não chegou ao Drive, e a cópia mora só neste
 * computador. Recusado NÃO conta: o servidor não vai aceitar aquele arquivo de
 * jeito nenhum, e pedir para a pessoa ficar no site por ele é prendê-la por
 * nada — a cópia original continua no computador dela.
 *
 * Falha SEM cópia local também não conta: é a que só o Firestore conhece
 * (o registro foi apagado), e ficar no site não salva nada que não exista.
 */
export function prendeOSite(fase: FaseDoEnvio, temCopiaLocal = true): boolean {
  if (fase === "falha") return temCopiaLocal;
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
  /** Quantos foram recusados — é a contagem do título e do aviso do recusado. */
  recusados: number;
  parado: MotivoParado | null;
  /**
   * Há falha, e NENHUMA delas tem cópia local. Muda o aviso: "o áudio continua
   * salvo neste computador, tente de novo" seria mentira sem registro, e a
   * linha nem tem os botões que a frase manda apertar.
   */
  falhaSemCopia: boolean;
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

  const falhas = estados.filter((e) => e.fase === "falha");
  const falhaSemCopia =
    falhas.length > 0 && falhas.every((e) => !e.temCopiaLocal);

  return {
    fase,
    fracao,
    quantos: estados.length,
    subindo: parados.length,
    recusados: fases.filter((f) => f === "recusado").length,
    parado,
    falhaSemCopia,
  };
}

const GRAVIDADE: Record<FaseDoEnvio, number> = {
  falha: 0,
  recusado: 1,
  preparando: 2,
  enviando: 2,
  concluido: 2,
};

/**
 * As linhas do painel com falha e recusado NA FRENTE, e o resto na ordem de
 * chegada (o `sort` é estável). Com a tela baixa (zoom de 200 a 400%) só a
 * lista rola, e a ordem de chegada podia deixar escondida justo a falha que dá
 * nome ao título do painel.
 */
export function porGravidade<T extends { estado: EstadoDoEnvio }>(linhas: T[]): T[] {
  return [...linhas].sort(
    (a, b) => GRAVIDADE[a.estado.fase] - GRAVIDADE[b.estado.fase],
  );
}

/*
 * O TEXTO DE CADA ESTADO mora aqui, e não no componente, porque é a parte que
 * a Issue #250 existe para acertar: a frase que manda (ou não) fechar o site.
 * Trocar "não feche" por "pode fechar" num estado errado passa em tipo, em
 * lint e na tela de quem testa com rede boa — só o `test-envio.mjs` pega.
 */

export function tituloDoPainel(resumo: ResumoDosEnvios): string {
  switch (resumo.fase) {
    case "concluido":
      return resumo.quantos > 1 ? "Áudios enviados!" : "Áudio enviado!";
    case "falha":
      return "O envio parou";
    case "recusado":
      // Na fase "recusado" nada mais anda: o que não foi recusado concluiu.
      return resumo.recusados > 1
        ? `${resumo.recusados} arquivos não foram aceitos`
        : resumo.quantos > 1
          ? "Um arquivo não foi aceito"
          : "Este arquivo não foi aceito";
    case "preparando":
      return "Preparando o envio…";
    default:
      return resumo.subindo > 1
        ? `Enviando ${resumo.subindo} áudios`
        : "Enviando o áudio";
  }
}

/**
 * O que a pessoa pode fazer com o site — a frase que importa no painel.
 *
 * "Pode continuar usando o sistema" vem junto do "não feche" de propósito: o
 * painel minimiza, e quem lê só "não feche" fica olhando a barra parada.
 * Na conclusão, o ✓ fala do ÁUDIO, e a frase diz que os documentos vêm
 * depois: na mesma tela, o verde é o chip "Processado" da esteira, e um ✓
 * sozinho seria lido como "ata pronta". "Os documentos que você escolheu", e
 * não "as atas": as duas atas são opcionais no registro, e quem não marcou
 * nenhuma receberia a promessa de algo que não vem.
 *
 * "Tentando de novo" não culpa a conexão: o mesmo estado vale para um bloco
 * que o Drive devolveu com erro 500, e "a conexão oscilou" mandaria a pessoa
 * conferir o Wi‑Fi à toa. Só o "sem-rede", que vem do navegador, fala de rede.
 */
export function avisoDoPainel(resumo: ResumoDosEnvios): string {
  switch (resumo.fase) {
    case "concluido":
      return "Pode fechar o site. A transcrição com quem falou e os documentos que você escolheu chegam por e‑mail em até cerca de 1h30.";
    case "falha":
      return resumo.falhaSemCopia
        ? "Este áudio não chegou ao Drive e não ficou cópia neste computador. Grave ou envie de novo."
        : "O áudio continua salvo neste computador. Tente de novo ou baixe uma cópia — e não feche o site enquanto isso.";
    case "recusado":
      return avisoRecusado(resumo.recusados);
    default:
      if (resumo.parado === "sem-rede") {
        return "Sem conexão. O envio continua sozinho quando a rede voltar — não feche o site.";
      }
      if (resumo.parado === "tentando") {
        return "Um trecho não subiu, e o envio está tentando de novo sozinho. Não feche o site.";
      }
      return "Não feche o site até terminar — pode continuar usando o sistema.";
  }
}

/**
 * O que a pílula mostra (`curto`), o nome do botão dela (`nome`) e a frase
 * que ela anuncia ao leitor de tela (`anuncio`).
 *
 * NEM O NOME NEM O ANÚNCIO LEVAM O PERCENTUAL, só o texto visível: o número
 * muda a cada bloco de 8 MB, e o leitor de tela relê o nome do botão que tem
 * o foco quando ele muda — e o foco vai para a pílula ao minimizar. Com o "·
 * 42%" no nome, eram umas 25 falas num áudio de 200 MB, e a região viva diria
 * o mesmo de novo a cada uma.
 */
export function textoDaPilula(resumo: ResumoDosEnvios): {
  curto: string;
  nome: string;
  anuncio: string;
} {
  const pct = `${percentual(resumo.fracao)}%`;
  switch (resumo.fase) {
    case "concluido": {
      const t = resumo.quantos > 1 ? "Áudios enviados" : "Áudio enviado";
      return {
        curto: t,
        nome: t,
        anuncio: "Áudio enviado. Pode fechar o site; os documentos chegam por e-mail.",
      };
    }
    case "falha":
      return {
        curto: "O envio parou",
        nome: "O envio parou",
        anuncio: "O envio parou. Abra o painel para tentar de novo.",
      };
    case "recusado": {
      const varios = resumo.recusados > 1;
      // O texto visível sem "Arquivo(s)": "Arquivos não aceitos" alargava a
      // pílula até cobrir o "Salvar permissões" do Admin de 660 a 740 px
      // (medido no arreio). O ícone de alerta ao lado já diz do que se trata,
      // e o nome do botão leva a frase inteira.
      return {
        curto: varios ? `${resumo.recusados} não aceitos` : "Não aceito",
        nome: varios
          ? `${resumo.recusados} arquivos não aceitos`
          : "Arquivo não aceito",
        anuncio: varios
          ? `${resumo.recusados} arquivos não foram aceitos. Abra o painel para descartá-los.`
          : "Um arquivo não foi aceito. Abra o painel para descartá-lo.",
      };
    }
    case "preparando":
      return {
        curto: "Preparando…",
        nome: "Preparando o envio",
        anuncio: "Preparando o envio do áudio.",
      };
    default: {
      // "Retomando", e não "Reconectando" (culpava a conexão por qualquer erro)
      // nem "Tentando de novo": esse alarga a pílula até ela cobrir o
      // "Salvar permissões" do Admin entre 680 e 800 px de largura.
      const antes =
        resumo.parado === "sem-rede"
          ? "Sem rede"
          : resumo.parado === "tentando"
            ? "Retomando"
            : resumo.subindo > 1
              ? `${resumo.subindo} áudios`
              : "Enviando";
      return {
        curto: `${antes} · ${pct}`,
        nome:
          resumo.parado === "sem-rede"
            ? "Envio esperando a rede"
            : resumo.parado === "tentando"
              ? "Envio tentando de novo"
              : resumo.subindo > 1
                ? `Enviando ${resumo.subindo} áudios`
                : "Enviando o áudio",
        anuncio:
          resumo.parado === "sem-rede"
            ? "O envio está esperando a conexão."
            : resumo.parado === "tentando"
              ? "O envio está tentando de novo."
              : "Enviando o áudio.",
      };
    }
  }
}

/**
 * O relógio da confirmação, que para com a aba escondida: quanto ainda falta
 * depois de um trecho visível que começou em `inicio` e parou em `agora`.
 * Separado para o teste fixar que o tempo escondido não é descontado.
 */
export function restanteDepoisDe(restante: number, inicio: number, agora: number): number {
  return Math.max(0, restante - Math.max(0, agora - inicio));
}
