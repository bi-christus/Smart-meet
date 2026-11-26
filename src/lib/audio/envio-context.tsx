"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { subscribeMeetingUpload } from "../meetings";
import { baixarCopiaLocal } from "./baixar-copia";
import {
  CONFIRMACAO_MS,
  ESTOURO_MS,
  SAIDA_MS,
  estadoDoEnvio,
  porGravidade,
  prendeOSite,
  restanteDepoisDe,
  resumirEnvios,
  type EstadoDoEnvio,
  type FaseDoEnvio,
  type RegistroLido,
  type ResumoDosEnvios,
  type ReuniaoLida,
} from "./envio-core";
import { getRecording, type RecordingRecord } from "./recording-db";
import { uploadManager } from "./uploader";

/**
 * O painel do envio mora no SHELL (Issue #250), pelo mesmo motivo da gravação:
 * quem envia um áudio de 200 MB troca de aba enquanto espera, e um painel que
 * morasse na tela de Reuniões sumiria na primeira troca — junto com o aviso de
 * não fechar o site, que é a razão de ele existir.
 *
 * Aqui fica só o ESTADO e a observação; o desenho está em
 * `components/painel-do-envio.tsx`.
 *
 * TRÊS FONTES, e nenhuma sobra:
 *  - `uploadManager.subscribe` é o aviso imediato, mas só existe nesta aba e o
 *    motor não avisa em todo ponto (o fim da gravação, por exemplo);
 *  - a releitura do IndexedDB a cada `LEITURA_MS`, só com a aba visível, pega
 *    o que o aviso perdeu — e o service worker, que nunca avisa ninguém;
 *  - o documento da reunião no Firestore é a confirmação de "concluido" quando
 *    o registro local some sem aviso (`envio-core.ts` explica por que sumir,
 *    sozinho, não basta).
 */

/** Releitura do IndexedDB: barata (um `get` por envio), e só com a aba à vista. */
const LEITURA_MS = 2500;

export type EnvioAcompanhado = {
  recordingId: string;
  meetingId: string | null;
  titulo: string;
  setor: string;
};

export type LinhaDoEnvio = EnvioAcompanhado & { estado: EstadoDoEnvio };

type Item = EnvioAcompanhado & {
  registro: RegistroLido | null | undefined;
  reuniao: ReuniaoLida | null | undefined;
  /** A última fase calculada — é ela que torna "concluido" final (ver o core). */
  fase: FaseDoEnvio;
  /** Releituras seguidas sem registro (ver `LEITURAS_SEM_REGISTRO` no core). */
  semRegistro: number;
  /** O último progresso lido com registro (ver `ultimo` no core). */
  ultimo?: { enviados: number; total: number | null };
};

/** O que o painel mostrava quando o último envio saiu da lista (ver `tirar`). */
type Retrato = {
  linhas: LinhaDoEnvio[];
  resumo: ResumoDosEnvios;
  minimizado: boolean;
};

/** De onde vem o "segurar" da confirmação (ver o efeito do relógio). */
export type OrigemDoSegurar = "ponteiro" | "foco";

type Valor = {
  linhas: LinhaDoEnvio[];
  resumo: ResumoDosEnvios | null;
  minimizado: boolean;
  /** A bolha está estourando: os componentes trocam para a saída. */
  estourando: boolean;
  /**
   * O último envio acabou de ser descartado (ou dispensado): `linhas` e
   * `resumo` são o retrato de antes, e os componentes fazem a saída de 120 ms
   * sobre ele (`SAIDA_MS`).
   */
  fechando: boolean;
  /** Sobe a cada descarte pelo painel: a faixa de recuperação relê com ele. */
  descartes: number;
  todosConcluidos: boolean;
  acompanharEnvio: (e: EnvioAcompanhado) => void;
  /** A faixa de recuperação esconde o que o painel já mostra (menos as falhas). */
  acompanha: (recordingId: string) => boolean;
  minimizar: () => void;
  restaurar: () => void;
  /** Só com tudo concluído: fecha agora, sem esperar a confirmação acabar. */
  fecharAgora: () => void;
  tentarDeNovo: (recordingId: string) => Promise<void>;
  baixarCopia: (recordingId: string) => Promise<void>;
  descartar: (recordingId: string) => Promise<void>;
  /** Tira da tela a falha sem cópia local, que não tem o que descartar. */
  dispensar: (recordingId: string) => void;
  /** O ponteiro ou o foco de teclado estão no painel: o relógio da confirmação para. */
  segurar: (origem: OrigemDoSegurar, sim: boolean) => void;
};

const nada = async () => {};

/**
 * Fora do provedor tudo vira no-op, e não erro: a tela de Reuniões e a faixa
 * de recuperação continuam funcionando onde o painel não estiver montado (um
 * teste, um arreio de tela), só sem o painel.
 */
const Ctx = createContext<Valor>({
  linhas: [],
  resumo: null,
  minimizado: false,
  estourando: false,
  fechando: false,
  descartes: 0,
  todosConcluidos: false,
  acompanharEnvio: () => {},
  acompanha: () => false,
  minimizar: () => {},
  restaurar: () => {},
  fecharAgora: () => {},
  tentarDeNovo: nada,
  baixarCopia: nada,
  descartar: nada,
  dispensar: () => {},
  segurar: () => {},
});

function lerRegistro(r: RecordingRecord | undefined): RegistroLido | null {
  if (!r) return null;
  // Só o que decide a fase: o registro inteiro carrega o `File` do áudio, e
  // guardá-lo no estado do React prenderia a referência sem necessidade.
  return {
    status: r.status,
    uploadedBytes: r.uploadedBytes,
    totalBytes: r.totalBytes,
    bytesWritten: r.bytesWritten,
    error: r.error,
    recusado: r.recusado,
    sessionUri: r.sessionUri,
  };
}

function reduzMovimento(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function assinarRede(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Recalcula a fase de um item com a leitura nova; `null` = saiu da tela. */
function comLeitura(
  it: Item,
  mudanca: Partial<Pick<Item, "registro" | "reuniao">>,
): Item | null {
  // Só a leitura do REGISTRO mexe na contagem: um aviso do Firestore no meio
  // não diz nada sobre o registro ter voltado.
  const semRegistro =
    "registro" in mudanca
      ? mudanca.registro === null
        ? it.semRegistro + 1
        : 0
      : it.semRegistro;
  const ultimo = mudanca.registro
    ? {
        enviados: mudanca.registro.uploadedBytes,
        total: mudanca.registro.totalBytes,
      }
    : it.ultimo;
  const novo = { ...it, ...mudanca, semRegistro, ultimo };
  const e = estadoDoEnvio(
    {
      registro: novo.registro,
      reuniao: novo.reuniao,
      leiturasSemRegistro: semRegistro,
      ultimo,
    },
    it.fase,
  );
  return e ? { ...novo, fase: e.fase } : null;
}

export function EnvioProvider({ children }: { children: React.ReactNode }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [minimizado, setMinimizado] = useState(false);
  const [estourandoPedido, setEstourando] = useState(false);
  // O que o painel mostrava quando o último envio saiu da lista (ver `tirar`).
  const [retrato, setRetrato] = useState<Retrato | null>(null);
  // Sobe a cada descarte (ver `descartar`).
  const [descartes, setDescartes] = useState(0);
  const online = useSyncExternalStore(
    assinarRede,
    () => navigator.onLine,
    () => true,
  );

  const aplicarRegistro = useCallback(
    (id: string, registro: RegistroLido | null) => {
      setItens((lista) => {
        const i = lista.findIndex((x) => x.recordingId === id);
        // Aviso de um envio que o painel não acompanha: a lista fica a MESMA,
        // para o React não redesenhar o shell a cada bloco de outra gravação.
        if (i < 0) return lista;
        const novo = comLeitura(lista[i], { registro });
        return novo
          ? lista.map((x, j) => (j === i ? novo : x))
          : lista.filter((_, j) => j !== i);
      });
    },
    [],
  );

  const aplicarReuniao = useCallback(
    (meetingId: string, reuniao: ReuniaoLida | null) => {
      setItens((lista) => {
        if (!lista.some((x) => x.meetingId === meetingId)) return lista;
        const out: Item[] = [];
        for (const it of lista) {
          if (it.meetingId !== meetingId) {
            out.push(it);
            continue;
          }
          const novo = comLeitura(it, { reuniao });
          if (novo) out.push(novo);
        }
        return out;
      });
    },
    [],
  );

  const reler = useCallback(
    (id: string) =>
      getRecording(id)
        .then((r) => aplicarRegistro(id, lerRegistro(r)))
        .catch(() => {
          // sem IndexedDB nesta leitura: a próxima batida tenta de novo
        }),
    [aplicarRegistro],
  );

  // Aviso imediato do motor. Uma assinatura só para todos os envios: o
  // filtro por id é o `findIndex` de `aplicarRegistro`.
  useEffect(
    () =>
      uploadManager.subscribe((rec) =>
        aplicarRegistro(rec.id, lerRegistro(rec)),
      ),
    [aplicarRegistro],
  );

  // Concluído e recusado não mudam mais: param de ser relidos e assinados.
  const vivos = itens.filter(
    (i) => i.fase !== "concluido" && i.fase !== "recusado",
  );
  const idsVivos = vivos.map((i) => i.recordingId).join("|");
  const reunioesVivas = [
    ...new Set(vivos.map((i) => i.meetingId).filter((m): m is string => !!m)),
  ].join("|");

  // A releitura do IndexedDB. Só com a aba visível: escondida, ninguém olha
  // para a barra, e a volta da aba (`visibilitychange`) relê na hora.
  useEffect(() => {
    if (!idsVivos) return;
    const ids = idsVivos.split("|");
    const ler = () => {
      if (document.visibilityState !== "visible") return;
      for (const id of ids) void reler(id);
    };
    const timer = window.setInterval(ler, LEITURA_MS);
    document.addEventListener("visibilitychange", ler);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ler);
    };
  }, [idsVivos, reler]);

  // A rede do "concluido" que esta aba não viu acontecer.
  useEffect(() => {
    if (!reunioesVivas) return;
    const saidas = reunioesVivas.split("|").map((mid) =>
      subscribeMeetingUpload(
        mid,
        (m) =>
          aplicarReuniao(
            mid,
            m && {
              uploadStatus: m.uploadStatus,
              uploadError: m.uploadError,
              uploadedBytes: m.uploadedBytes,
              totalBytes: m.totalBytes,
            },
          ),
        // Sem permissão ou sem rede: fica sem a confirmação do Firestore, e o
        // painel segue pelo IndexedDB — que é o caso comum de qualquer forma.
        () => {},
      ),
    );
    return () => saidas.forEach((sair) => sair());
  }, [reunioesVivas, aplicarReuniao]);

  const chegada: LinhaDoEnvio[] = [];
  for (const it of itens) {
    const estado = estadoDoEnvio(
      {
        registro: it.registro,
        reuniao: it.reuniao,
        online,
        leiturasSemRegistro: it.semRegistro,
        ultimo: it.ultimo,
      },
      it.fase,
    );
    if (estado) {
      chegada.push({
        recordingId: it.recordingId,
        meetingId: it.meetingId,
        titulo: it.titulo,
        setor: it.setor,
        estado,
      });
    }
  }
  const linhas = porGravidade(chegada);
  const resumo = resumirEnvios(linhas.map((l) => l.estado));
  const todosConcluidos = resumo?.fase === "concluido";
  // O pedido de estouro só vale enquanto tudo está concluído: um envio novo
  // que chega no meio da confirmação devolve o painel ao normal sem precisar
  // de um efeito para desligar a bandeira.
  const estourando = estourandoPedido && todosConcluidos;

  // `beforeunload` armado no INSTANTE em que o envio é acompanhado — e não no
  // tique de 5 s da faixa de recuperação, que deixava uma janela em que fechar
  // a aba saía sem aviso nenhum logo depois de "Registrar". Decidido pela
  // linha, e não pela fase guardada no item: é a linha que sabe se uma falha
  // ainda tem cópia local a proteger.
  const prende = linhas.some((l) =>
    prendeOSite(l.estado.fase, l.estado.temCopiaLocal),
  );
  useEffect(() => {
    if (!prende) return;
    const guarda = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guarda);
    return () => window.removeEventListener("beforeunload", guarda);
  }, [prende]);

  // Ponteiro e foco no painel, num ref e não num estado: o relógio da
  // confirmação precisa PAUSAR e retomar de onde parou, e um estado nas
  // dependências do efeito o recriaria com os 2,2 s cheios a cada passada do
  // mouse. Dois campos, e não um: tirar o ponteiro de cima não pode soltar o
  // que o foco de teclado segura, nem o contrário. `aoSegurar` é a ponte do
  // efeito em curso para quem avisa.
  const seguraRef = useRef({ ponteiro: false, foco: false });
  const aoSegurar = useRef<(() => void) | null>(null);

  const finalizar = useCallback(() => {
    setItens((lista) => lista.filter((i) => i.fase !== "concluido"));
    setEstourando(false);
    setMinimizado(false);
    // O painel some sem `pointerleave`: sem zerar aqui, a próxima confirmação
    // nasceria segurada por um ponteiro que já não está lá.
    seguraRef.current = { ponteiro: false, foco: false };
  }, []);

  // A confirmação parada, e depois o estouro.
  //
  // O relógio PARA com a aba escondida: o caso que o painel existe para
  // resolver é justamente o de quem saiu da aba esperando o envio, e essa
  // pessoa precisa ver o "Pode fechar o site" ao voltar — e não um painel que
  // já se fechou sozinho enquanto ela não olhava. E para com o ponteiro sobre
  // o painel aberto: é quem está lendo a frase até o fim.
  //
  // O FOCO SEGURA SÓ QUANDO É DE TECLADO (decidido no painel, pela última
  // entrada da pessoa). O painel abre com o foco no próprio botão (é diálogo), e segurar
  // por qualquer foco seria nunca fechar sozinho — para ninguém. Mas quem
  // chegou pelo teclado muitas vezes ouve o painel num leitor de tela, e a
  // troca de foco do estouro CORTA a fala no meio: o trecho do e‑mail e da
  // 1h30 se perdia. Essa pessoa fecha com Escape ou com "Fechar".
  //
  // `minimizado` nas dependências recomeça a contagem a cada minimizar e
  // restaurar: quem clica na pílula "Áudio enviado" perto do fim dos 2,2 s
  // via o painel entrar e já estourar.
  //
  // Com movimento reduzido não há estouro: a rede global corta a animação para
  // 0,01 ms, e esperar os 300 ms dela seria segurar um painel parado por nada.
  useEffect(() => {
    if (!todosConcluidos) return;
    if (estourando) {
      const t = window.setTimeout(finalizar, ESTOURO_MS);
      return () => clearTimeout(t);
    }
    let restante = CONFIRMACAO_MS;
    let inicio = 0;
    let t: number | undefined;
    const disparar = () => {
      t = undefined;
      if (reduzMovimento()) finalizar();
      else setEstourando(true);
    };
    const correr = () => {
      if (t !== undefined) return;
      inicio = Date.now();
      t = window.setTimeout(disparar, restante);
    };
    const pausar = () => {
      if (t === undefined) return;
      clearTimeout(t);
      t = undefined;
      restante = restanteDepoisDe(restante, inicio, Date.now());
    };
    // Minimizado, o painel não está à vista: o ponteiro "sobre ele" não conta.
    const decidir = () => {
      const s = seguraRef.current;
      if (document.hidden || ((s.ponteiro || s.foco) && !minimizado)) pausar();
      else correr();
    };
    aoSegurar.current = decidir;
    decidir();
    document.addEventListener("visibilitychange", decidir);
    return () => {
      aoSegurar.current = null;
      pausar();
      document.removeEventListener("visibilitychange", decidir);
    };
  }, [todosConcluidos, estourando, finalizar, minimizado]);

  const segurar = useCallback((origem: OrigemDoSegurar, sim: boolean) => {
    seguraRef.current = { ...seguraRef.current, [origem]: sim };
    aoSegurar.current?.();
  }, []);

  const acompanharEnvio = useCallback(
    (e: EnvioAcompanhado) => {
      setItens((lista) =>
        lista.some((i) => i.recordingId === e.recordingId)
          ? lista
          : [
              ...lista,
              {
                ...e,
                registro: undefined,
                // Sem reunião (o rascunho falhou), não há confirmação a esperar
                // do Firestore: o "concluido" vem só do aviso do motor.
                reuniao: e.meetingId ? undefined : null,
                fase: "preparando",
                semRegistro: 0,
              },
            ],
      );
      // Envio novo sempre abre o painel, mesmo com outro minimizado: é a
      // resposta ao clique em "Registrar" que a pessoa acabou de dar.
      setMinimizado(false);
      setEstourando(false);
      setRetrato(null);
      void reler(e.recordingId);
    },
    [reler],
  );

  const tentarDeNovo = useCallback(
    async (id: string) => {
      // Só o desta linha (`resume`), e não o `resumeAll` da faixa: o botão
      // mora na linha, e retomar as outras falhas junto faria os botões delas
      // sumirem sem a pessoa ter pedido.
      await uploadManager.resume(id);
      await reler(id);
    },
    [reler],
  );

  const baixarCopia = useCallback(async (id: string) => {
    const rec = await getRecording(id);
    if (!rec) throw new Error("A cópia local não existe mais.");
    await baixarCopiaLocal(rec);
  }, []);

  // A saída do painel quando o ÚLTIMO envio sai da lista por descarte ou
  // dispensa. Tirado o item, `resumo` vira nulo e os componentes devolvem
  // `null` — painel e véu sumiam no mesmo quadro do clique, a única saída do
  // painel sem transição. O retrato do que estava na tela fica por
  // `SAIDA_MS`, e os componentes fazem sobre ele a saída de 120 ms da casa.
  //
  // O que estava na tela vai num ref escrito DEPOIS de cada render (e não no
  // render): é o `tirar`, chamado num clique, quem o lê.
  const vistoRef = useRef<Retrato | null>(null);
  useEffect(() => {
    vistoRef.current = resumo ? { linhas, resumo, minimizado } : null;
  });
  useEffect(() => {
    if (!retrato) return;
    const t = window.setTimeout(() => setRetrato(null), SAIDA_MS);
    return () => clearTimeout(t);
  }, [retrato]);

  const tirar = useCallback((id: string) => {
    const visto = vistoRef.current;
    // Com movimento reduzido não há saída a esperar, como no `finalizar`.
    if (
      visto &&
      !reduzMovimento() &&
      visto.linhas.every((l) => l.recordingId === id)
    ) {
      setRetrato(visto);
    }
    setItens((lista) => lista.filter((i) => i.recordingId !== id));
  }, []);

  // A faixa de recuperação só relê no aviso do motor ou no tique de 5 s, e o
  // descarte não avisa ninguém (`uploadManager.discard` só apaga): sem este
  // contador, ela mostrava por até 5 s o áudio que acabou de ser apagado — com
  // "Baixar cópia" dando erro e o aviso de saída ainda armado.
  const descartar = useCallback(
    async (id: string) => {
      await uploadManager.discard(id);
      tirar(id);
      setDescartes((n) => n + 1);
    },
    [tirar],
  );

  const dispensar = useCallback((id: string) => tirar(id), [tirar]);

  // Minimizar e restaurar soltam ponteiro e foco: o painel troca de lugar com
  // a pílula, e o `pointerleave` de um painel que ficou invisível pode não vir.
  const minimizar = useCallback(() => {
    seguraRef.current = { ponteiro: false, foco: false };
    setMinimizado(true);
  }, []);
  const restaurar = useCallback(() => {
    seguraRef.current = { ponteiro: false, foco: false };
    setMinimizado(false);
  }, []);

  const fecharAgora = useCallback(() => {
    if (reduzMovimento()) finalizar();
    else setEstourando(true);
  }, [finalizar]);

  const ids = new Set(itens.map((i) => i.recordingId));

  // Um envio novo no meio da saída ganha da saída: o retrato só vale com a
  // lista vazia.
  const fechando = !resumo && retrato !== null;

  const valor: Valor = {
    linhas: fechando ? retrato.linhas : linhas,
    resumo: fechando ? retrato.resumo : resumo,
    minimizado: fechando ? retrato.minimizado : minimizado,
    estourando,
    fechando,
    descartes,
    todosConcluidos,
    acompanharEnvio,
    acompanha: (id) => ids.has(id),
    minimizar,
    restaurar,
    fecharAgora: () => {
      if (todosConcluidos) fecharAgora();
    },
    tentarDeNovo,
    baixarCopia,
    descartar,
    dispensar,
    segurar,
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEnvios(): Valor {
  return useContext(Ctx);
}
