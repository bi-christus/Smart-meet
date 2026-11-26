"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { subscribeMeetingUpload } from "../meetings";
import { baixarCopiaLocal } from "./baixar-copia";
import {
  CONFIRMACAO_MS,
  ESTOURO_MS,
  estadoDoEnvio,
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
};

type Valor = {
  linhas: LinhaDoEnvio[];
  resumo: ResumoDosEnvios | null;
  minimizado: boolean;
  /** A bolha está estourando: os componentes trocam para a saída. */
  estourando: boolean;
  todosConcluidos: boolean;
  acompanharEnvio: (e: EnvioAcompanhado) => void;
  /** A faixa de recuperação esconde o que o painel já mostra. */
  acompanha: (recordingId: string) => boolean;
  minimizar: () => void;
  restaurar: () => void;
  /** Só com tudo concluído: fecha agora, sem esperar a confirmação acabar. */
  fecharAgora: () => void;
  tentarDeNovo: (recordingId: string) => Promise<void>;
  baixarCopia: (recordingId: string) => Promise<void>;
  descartar: (recordingId: string) => Promise<void>;
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
  todosConcluidos: false,
  acompanharEnvio: () => {},
  acompanha: () => false,
  minimizar: () => {},
  restaurar: () => {},
  fecharAgora: () => {},
  tentarDeNovo: nada,
  baixarCopia: nada,
  descartar: nada,
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
  const novo = { ...it, ...mudanca };
  const e = estadoDoEnvio(
    { registro: novo.registro, reuniao: novo.reuniao },
    it.fase,
  );
  return e ? { ...novo, fase: e.fase } : null;
}

export function EnvioProvider({ children }: { children: React.ReactNode }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [minimizado, setMinimizado] = useState(false);
  const [estourandoPedido, setEstourando] = useState(false);
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

  // `beforeunload` armado no INSTANTE em que o envio é acompanhado — e não no
  // tique de 5 s da faixa de recuperação, que deixava uma janela em que fechar
  // a aba saía sem aviso nenhum logo depois de "Registrar".
  const prende = itens.some((i) => prendeOSite(i.fase));
  useEffect(() => {
    if (!prende) return;
    const guarda = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guarda);
    return () => window.removeEventListener("beforeunload", guarda);
  }, [prende]);

  const linhas: LinhaDoEnvio[] = [];
  for (const it of itens) {
    const estado = estadoDoEnvio(
      { registro: it.registro, reuniao: it.reuniao, online },
      it.fase,
    );
    if (estado) {
      linhas.push({
        recordingId: it.recordingId,
        meetingId: it.meetingId,
        titulo: it.titulo,
        setor: it.setor,
        estado,
      });
    }
  }
  const resumo = resumirEnvios(linhas.map((l) => l.estado));
  const todosConcluidos = resumo?.fase === "concluido";
  // O pedido de estouro só vale enquanto tudo está concluído: um envio novo
  // que chega no meio da confirmação devolve o painel ao normal sem precisar
  // de um efeito para desligar a bandeira.
  const estourando = estourandoPedido && todosConcluidos;

  const finalizar = useCallback(() => {
    setItens((lista) => lista.filter((i) => i.fase !== "concluido"));
    setEstourando(false);
    setMinimizado(false);
  }, []);

  // A confirmação parada, e depois o estouro.
  //
  // O relógio PARA com a aba escondida: o caso que o painel existe para
  // resolver é justamente o de quem saiu da aba esperando o envio, e essa
  // pessoa precisa ver o "Pode fechar o site" ao voltar — e não um painel que
  // já se fechou sozinho enquanto ela não olhava.
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
    const aoMudarAba = () => (document.hidden ? pausar() : correr());
    if (!document.hidden) correr();
    document.addEventListener("visibilitychange", aoMudarAba);
    return () => {
      pausar();
      document.removeEventListener("visibilitychange", aoMudarAba);
    };
  }, [todosConcluidos, estourando, finalizar]);

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
              },
            ],
      );
      // Envio novo sempre abre o painel, mesmo com outro minimizado: é a
      // resposta ao clique em "Registrar" que a pessoa acabou de dar.
      setMinimizado(false);
      setEstourando(false);
      void reler(e.recordingId);
    },
    [reler],
  );

  const tentarDeNovo = useCallback(
    async (id: string) => {
      // `resumeAll` é o mesmo "Tentar de novo" da faixa de recuperação: põe as
      // falhas de rede de volta em "uploading" e liga a bomba de cada uma.
      await uploadManager.resumeAll();
      await reler(id);
    },
    [reler],
  );

  const baixarCopia = useCallback(async (id: string) => {
    const rec = await getRecording(id);
    if (!rec) throw new Error("A cópia local não existe mais.");
    await baixarCopiaLocal(rec);
  }, []);

  const descartar = useCallback(async (id: string) => {
    await uploadManager.discard(id);
    setItens((lista) => lista.filter((i) => i.recordingId !== id));
  }, []);

  const fecharAgora = useCallback(() => {
    if (reduzMovimento()) finalizar();
    else setEstourando(true);
  }, [finalizar]);

  const ids = new Set(itens.map((i) => i.recordingId));

  const valor: Valor = {
    linhas,
    resumo,
    minimizado,
    estourando,
    todosConcluidos,
    acompanharEnvio,
    acompanha: (id) => ids.has(id),
    minimizar: () => setMinimizado(true),
    restaurar: () => setMinimizado(false),
    fecharAgora: () => {
      if (todosConcluidos) fecharAgora();
    },
    tentarDeNovo,
    baixarCopia,
    descartar,
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useEnvios(): Valor {
  return useContext(Ctx);
}
