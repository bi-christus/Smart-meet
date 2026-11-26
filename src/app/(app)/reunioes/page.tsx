"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import {
  subscribeMeetings,
  createMeeting,
  updateMeeting,
  deleteMeetingById,
  MEETING_STATUS_LABEL,
  SEND_LABEL,
  DRIVE_OUTPUT_LABEL,
  type Meeting,
  type MeetingStatus,
  type SendMethod,
  type OutputKind,
  type DriveOutputKind,
} from "@/lib/meetings";
import { Icon } from "@/components/icons";
import { OverlayPortal } from "@/components/overlay-portal";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import { useAsyncData } from "@/lib/use-async-data";
import { syncDrive } from "@/lib/drive-upload";
import { useRecording } from "@/lib/audio/recording-context";
import { uploadManager } from "@/lib/audio/uploader";
import { fmtBytes, getRecording } from "@/lib/audio/recording-db";
import { useEnvios } from "@/lib/audio/envio-context";
import { mensagemDoErro } from "@/lib/audio/envio-core";
import {
  ACCEPT_DE_AUDIO,
  conferirArquivoDeAudio,
} from "@/lib/audio/arquivo-de-audio-core";
import {
  ATAS_PADRAO,
  alternarAta,
  normalizarEscolha,
} from "@/lib/atas-do-envio-core";
import { SeloSetor } from "@/components/selo-setor";
import { Acervo } from "./acervo";
import styles from "./reunioes.module.css";

const MES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/**
 * Listas vazias constantes, para os cálculos rodarem antes de os dados
 * chegarem. Fora do componente porque `?? []` no corpo cria um array novo a
 * cada render, e os `useMemo` que dependem dele recalculariam sempre.
 */
const SEM_MEETINGS: Meeting[] = [];
const SEM_USERS: UserProfile[] = [];

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDate(d: string): string {
  const [y, m, dd] = d.split("-");
  return dd && m && y ? `${dd}/${m}/${y}` : d;
}
function fmtShortDate(d: string): string {
  const [, m, dd] = d.split("-").map(Number) as unknown as number[];
  return `${dd} ${MES[(m ?? 1) - 1]}`;
}
function fmtTimer(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Dados que abrem o modal de confirmação.
 * `meetingId` já vem preenchido nas gravações por microfone: o registro nasce
 * junto com a gravação, então o modal apenas completa os dados.
 */
type Confirm = {
  send: SendMethod;
  title: string;
  durationMin?: number;
  recordingId?: string | null;
  meetingId?: string | null;
  /** caminho "enviar arquivo": o envio só começa quando o usuário confirma */
  file?: File | null;
  /** microfone: a escolha de documentos com que a sessão do Drive abriu */
  output?: string[];
} | null;

const STATUS_CLASS: Record<MeetingStatus, string> = {
  aguardando: styles.st_aguardando,
  processando: styles.st_processando,
  processado: styles.st_processado,
};

/**
 * O que sai de cada áudio — a lista que o modal "Registrar reunião" mostra.
 *
 * Esta lista responde "o que vou receber?", e por isso tem de ser HONESTA com o
 * que a nuvem gera de fato, e não com o que o app gostaria que ela gerasse:
 *
 * - DOIS TÊM CADEADO porque saem sempre: a transcrição com quem falou (é dela
 *   que todo o resto nasce) e os Pontos importantes. A transcrição nem é um
 *   `OutputKind` — o motor não a procura no `smGerar` —, mas esconder da lista
 *   um documento que sempre chega faria a pergunta ser respondida errado.
 * - A PAUTA DA REUNIÃO SAIU. Ela estava aqui com cadeado, como "sempre
 *   gerada", e a nuvem nunca a gerou (Issue #251): a lista prometia um
 *   documento que não chegava. Volta quando a nuvem passar a fazê-la. O tipo
 *   `DriveOutputKind` "pauta" e o ícone dela continuam, porque servem para
 *   EXIBIR uma pauta que exista no Drive.
 * - As atas detalhada e didática são escolha. A detalhada vem marcada
 *   (`ATAS_PADRAO`, Issue #248).
 *
 * A escolha mora no modal, e não mais num painel ao lado da área de envio: no
 * painel ela era feita ANTES de escolher o áudio, longe do botão que confirma,
 * e as pessoas esqueciam de marcar.
 */
type OpcaoDeSaida =
  | { id: OutputKind; label: string; desc: string; sempre?: false }
  | { id: DriveOutputKind; label: string; desc: string; sempre: true };

const OUTPUT_OPTIONS: OpcaoDeSaida[] = [
  // Nos dois de cadeado, a descrição É o "sempre vem". Explicar o conteúdo
  // deles quebrava "Transcrição com quem falou" em duas linhas e crescia o
  // modal em 34 px (medido) só para repetir o que o nome já diz — o que a
  // pessoa precisa saber deles é que não se escolhe.
  {
    id: "transcricao",
    label: "Transcrição com quem falou",
    desc: "Sempre vem.",
    sempre: true,
  },
  {
    id: "resumo",
    label: "Pontos importantes",
    desc: "Sempre vem.",
    sempre: true,
  },
  {
    id: "detalhada",
    label: "Ata detalhada",
    desc: "Registro completo, ponto a ponto.",
  },
  {
    id: "didatica",
    label: "Ata didática",
    desc: "Explicada e fácil de entender.",
  },
];

/** Ícone de cada arquivo gerado pelo Cowork. */
const OUTPUT_ICON: Record<DriveOutputKind, string> = {
  transcricao: "chat",
  resumo: "check",
  // "prancheta" e não "ata": este documento é a pauta de trabalho que a aba Ata
  // consome, e usar o mesmo ícone das atas o faria parecer uma quarta ata para
  // ler — que é exatamente o que ele não é.
  pauta: "prancheta",
  detalhada: "relatorios",
  didatica: "reunioes",
};

export default function ReunioesPage() {
  const { profile } = useAuth();

  const sectors = useSetoresDaPessoa(profile);

  const [sector, setSector] = useState("");
  const [mode, setMode] = useState<SendMethod>("file");
  /**
   * A esteira e o acervo vêm da MESMA assinatura.
   *
   * `queue` é um `useMemo` sobre `meetings`, filtrando quem está aguardando ou
   * processando — não é uma segunda fonte. Logo, um estado de carregamento
   * governa as duas superfícies: elas entram no esqueleto juntas e saem juntas.
   * Tratá-las como independentes seria inventar uma espera que não existe.
   */
  const fMeetings = useAsyncData<Meeting>(sectors.join("|"), (onData, onErro) =>
    subscribeMeetings(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );
  const meetings = fMeetings.data ?? SEM_MEETINGS;
  const users = fUsers.data ?? SEM_USERS;
  /** Vale para a esteira e para o acervo, pela mesma razão. */
  const carregando = fMeetings.data === undefined && !fMeetings.erro;

  const [view, setView] = useState<Meeting | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [onlineLink, setOnlineLink] = useState("");
  const [delMeeting, setDelMeeting] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState(false);

  // gravação — toda a durabilidade (disco + envio retomável) vive no hook
  const {
    state: rec,
    devices,
    deviceId,
    setDeviceId,
    start,
    stop,
    pause,
    resume,
    startFileUpload,
    pendingConfirm,
    clearPendingConfirm,
  } = useRecording();
  const [micError, setMicError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /** Por que o último arquivo escolhido foi recusado (não é áudio, grande demais). */
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recording = rec.recording;

  // Ajustado no render, com guarda, e não em efeito (lint: setState em
  // cascata) — o mesmo do Kanban.
  if (sectors.length && !sectors.includes(sector)) setSector(sectors[0]);

  // Reflete o trabalho do Cowork: pergunta ao servidor se algum áudio já virou
  // "Transcrito". Dispara ao abrir a aba, ao focá-la e a cada 45s — mas só
  // enquanto houver reunião aguardando com áudio no Drive. O snapshot do
  // Firestore atualiza a tela sozinho quando o status muda.
  const pendingCount = useMemo(
    () =>
      meetings.filter((m) => m.status === "aguardando" && m.driveFileId).length,
    [meetings],
  );
  const lastSyncRef = useRef(0);
  useEffect(() => {
    if (!pendingCount) return;
    const run = () => {
      if (Date.now() - lastSyncRef.current < 20000) return;
      lastSyncRef.current = Date.now();
      void syncDrive().catch(() => {});
    };
    run();
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(run, 45000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [pendingCount]);

  // A gravação encerrou (aqui ou pelo mini player em outra aba): abre o modal
  // para completar os dados. O aviso de fechar a aba agora vive no shell.
  //
  // O modal abre no RENDER, guardado pelo eco do pedido — e não num efeito
  // com `setConfirm`, que o lint reprova. Limpar o pedido continua num efeito
  // porque é estado de OUTRO componente (o provedor da gravação), e o React
  // não deixa atualizar outro componente durante este render.
  const [pedidoAtendido, setPedidoAtendido] = useState<typeof pendingConfirm>(null);
  if (pendingConfirm && pendingConfirm !== pedidoAtendido) {
    setPedidoAtendido(pendingConfirm);
    setConfirm({
      send: "mic",
      title: pendingConfirm.title || `Gravação — ${fmtDate(todayStr())}`,
      durationMin: pendingConfirm.durationMin,
      recordingId: pendingConfirm.recordingId,
      meetingId: pendingConfirm.meetingId,
      output: pendingConfirm.output,
    });
  }
  useEffect(() => {
    if (pendingConfirm) clearPendingConfirm();
  }, [pendingConfirm, clearPendingConfirm]);

  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);

  const queue = useMemo(
    () =>
      meetings
        .filter((m) => m.status === "aguardando" || m.status === "processando")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [meetings],
  );
  const aguard = queue.filter((m) => m.status === "aguardando").length;
  const proc = queue.filter((m) => m.status === "processando").length;

  async function startRecording() {
    setMicError(null);
    setBusy(true);
    try {
      // A sessão do Drive abre AGORA, no início da gravação, e grava o
      // `smGerar` nela — antes de existir o modal onde a escolha mora. Por
      // isso vai o padrão, e o modal do fim corrige o arquivo se a pessoa
      // mudar (`applyTitle` → rota rename).
      await start({ sector, output: normalizarEscolha(ATAS_PADRAO) });
    } catch (e) {
      setMicError(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Encerra a gravação e abre o modal. O envio ao Drive já começou minutos
   * atrás e continua sozinho — o modal só completa os dados da reunião.
   */
  async function stopRecording() {
    setBusy(true);
    try {
      await stop(); // o modal abre via pendingConfirm (efeito acima)
    } catch (e) {
      setMicError(
        e instanceof Error ? e.message : "Não foi possível encerrar a gravação.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    // Primeira porta, antes do modal: o `accept` do seletor não vale para
    // arrastar, e um PDF solto aqui já virou reunião. Recusar agora, com a
    // razão na tela, custa menos do que deixar a pessoa preencher o modal e
    // errar no fim. Na própria área, e não num `alert`: o alerta some ao
    // fechar, e a pessoa volta a olhar a área sem saber o que trocar.
    const veredito = conferirArquivoDeAudio({
      nome: file.name,
      tipo: file.type,
      bytes: file.size,
    });
    if (!veredito.ok) {
      setFileError(veredito.mensagem);
      return;
    }
    setFileError(null);
    setConfirm({
      send: "file",
      title: file.name.replace(/\.[^.]+$/, ""),
      file,
    });
  }

  function connectOnline() {
    setConfirm({ send: "online", title: "Reunião online" });
    setOnlineLink("");
  }

  /** Apaga a reunião do sistema + o áudio local (permanente). */
  async function doDelete() {
    if (!delMeeting) return;
    setDeleting(true);
    try {
      if (delMeeting.recordingId) {
        await uploadManager.discard(delMeeting.recordingId).catch(() => {});
      }
      await deleteMeetingById(delMeeting.id);
      if (view?.id === delMeeting.id) setView(null);
      setDelMeeting(null);
    } catch (e) {
      console.error(e);
      alert("Não foi possível apagar. Tente novamente.");
    } finally {
      setDeleting(false);
    }
  }

  /** O áudio é visível só para quem enviou, gestores do setor e admins. */
  function canSeeAudio(m: Meeting): boolean {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    if (m.createdBy === profile.email) return true;
    return (
      profile.role === "gestor" && (profile.sectors ?? []).includes(m.sector)
    );
  }

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.noSector}>
        Você ainda não participa de nenhum setor. Peça a um administrador para
        incluir você em um setor (Admin › Usuários).
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Reuniões</h1>
      </div>

      <div className={styles.grid}>
        {/* ---------- captura ---------- */}
        <div className={`${styles.panel} ${styles.capPanel}`}>
          <div className={styles.capTop}>
            <select
              className={styles.sectorSel}
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              title="Setor da reunião"
            >
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className={styles.modeTabs}>
              {(
                [
                  ["file", "Enviar arquivo", "upload"],
                  ["mic", "Microfone", "mic"],
                  ["online", "Online", "online"],
                ] as [SendMethod, string, string][]
              ).map(([id, label, ic]) => (
                <button
                  key={id}
                  className={`${styles.modeTab} ${mode === id ? styles.on : ""}`}
                  onClick={() => {
                    setMode(id);
                    // A recusa é de um arquivo que já saiu da tela: ao voltar
                    // para "Enviar arquivo", ela reapareceria sem motivo.
                    setFileError(null);
                  }}
                  disabled={recording}
                >
                  <Icon name={ic} size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.capBody} key={mode}>
            {mode === "file" && (
              <div
                className={`${styles.dropzone} ${dragOver ? styles.dropOver : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
              >
                <div className={styles.dropIcon}>
                  <Icon name="upload" size={24} />
                </div>
                <div className={styles.dropTitle}>
                  Arraste o áudio aqui ou clique para selecionar
                </div>
                <div className={styles.dropSub}>
                  MP3, M4A, MP4 do WhatsApp, WAV, WebM, OGG… · até 500 MB
                </div>
                {fileError && (
                  <div className={styles.dropErr} role="alert">
                    <Icon name="warn" size={14} />
                    <span>{fileError}</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_DE_AUDIO}
                  hidden
                  onChange={(e) => {
                    handleFile(e.target.files?.[0] ?? undefined);
                    // Sem limpar, escolher de novo o MESMO arquivo (depois de
                    // cancelar o modal) não dispara `change`, e o clique
                    // parece não fazer nada.
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            {mode === "mic" && (
              <div className={styles.micBox}>
                <div
                  className={`${styles.micCircle} ${
                    recording
                      ? rec.paused
                        ? styles.micPaused
                        : styles.micRecording
                      : ""
                  }`}
                >
                  <Icon name="mic" size={26} />
                </div>
                {recording ? (
                  <>
                    <div className={styles.recTime}>{fmtTimer(rec.elapsedMs)}</div>
                    <div
                      className={`${styles.recLabel} ${rec.paused ? styles.recLabelPaused : ""}`}
                    >
                      <span
                        className={`${styles.recDot} ${rec.paused ? styles.recDotPaused : ""}`}
                      />
                      {rec.paused ? "Pausado" : "Gravando…"}
                    </div>

                    {/* barras movidas pelo nível real: também servem de
                        prova visual de que há som entrando */}
                    <div className={styles.eq}>
                      {Array.from({ length: 7 }).map((_, i) => (
                        <i
                          key={i}
                          style={{
                            height: `${Math.max(
                              4,
                              Math.round(
                                rec.level * 26 * (0.55 + 0.45 * Math.sin(i * 1.7 + rec.elapsedMs / 90)),
                              ),
                            )}px`,
                          }}
                        />
                      ))}
                    </div>

                    {rec.silent && (
                      <div className={styles.silentAlert}>
                        <Icon name="clock" size={14} />
                        Nenhum som detectado há mais de 30 s. Confira se o
                        microfone certo está selecionado e se não está mudo.
                      </div>
                    )}

                    <SafetyBar
                      written={rec.bytesWritten}
                      uploaded={rec.uploadedBytes}
                    />

                    <div className={styles.center}>
                      <button
                        className={styles.btnPause}
                        onClick={rec.paused ? resume : pause}
                        disabled={busy}
                      >
                        {rec.paused ? "Retomar" : "Pausar"}
                      </button>
                      <button
                        className={`${styles.btnPri} ${styles.btnStop}`}
                        onClick={stopRecording}
                        disabled={busy}
                      >
                        <Icon name="stop" size={15} />{" "}
                        {busy ? "Encerrando…" : "Parar e enviar"}
                      </button>
                    </div>
                    {rec.warning && (
                      <div className={styles.silentAlert} style={{ marginTop: 10 }}>
                        {rec.warning}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className={styles.micTitle}>Gravar pelo microfone</div>
                    <div className={styles.micSub}>
                      Grave a reunião presencial direto no navegador. O áudio é
                      salvo no disco a cada 5 segundos e enviado ao Drive
                      durante a reunião.
                    </div>

                    {devices.length > 1 && (
                      <div className={styles.micDevice}>
                        <label htmlFor="micDevice">Microfone</label>
                        <select
                          id="micDevice"
                          className={styles.select}
                          value={deviceId}
                          onChange={(e) => setDeviceId(e.target.value)}
                        >
                          <option value="">Padrão do sistema</option>
                          {devices.map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Microfone ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className={styles.center}>
                      <button
                        className={styles.btnPri}
                        onClick={startRecording}
                        disabled={busy}
                      >
                        <Icon name="mic" size={15} />{" "}
                        {busy ? "Abrindo microfone…" : "Iniciar gravação"}
                      </button>
                    </div>
                    {micError && (
                      <div className={styles.err} style={{ marginTop: 12 }}>
                        {micError}
                      </div>
                    )}
                    {/* gravação encerrada sozinha (microfone caiu, etc.): o áudio
                        já gravado está a salvo e sendo enviado */}
                    {!micError && rec.warning && (
                      <div className={styles.silentAlert} style={{ marginTop: 12 }}>
                        <Icon name="shield" size={14} />
                        {rec.warning}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {mode === "online" && (
              <div className={styles.onlineBox}>
                <div className={styles.onlineTitle}>
                  <Icon name="online" size={17} /> Reunião online
                </div>
                <div className={styles.onlineSub}>
                  Cole o link da reunião (Meet / Teams / Zoom) para captura do
                  áudio.
                </div>
                <div className={styles.onlineRow}>
                  <input
                    className={styles.onlineInput}
                    placeholder="https://meet.google.com/..."
                    value={onlineLink}
                    onChange={(e) => setOnlineLink(e.target.value)}
                  />
                  <button className={styles.btnPri} onClick={connectOnline}>
                    Conectar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------- esteira ---------- */}
        <div className={`${styles.panel} ${styles.queuePanel}`}>
          <div className={styles.queueHead}>
            <div className={styles.queueTitle}>
              <b>Na esteira agora</b>
              {/* Some enquanto não se sabe: "0" e "Esteira em dia" são
                  afirmações, e afirmar que está tudo processado antes de
                  perguntar é o pior jeito de errar nesta tela — quem acabou de
                  enviar um áudio leria que ele não existe. */}
              {!carregando && (
                <span className={styles.queueCount}>{queue.length}</span>
              )}
            </div>
            {!carregando && (
              <div
                className={`${styles.queueStatus} ${aguard ? styles.qsWarn : styles.qsOk}`}
              >
                <Icon name={aguard ? "clock" : "check"} size={15} />
                {aguard ? (
                  <span>
                    <b>{aguard} áudio(s)</b> aguardando · {proc} processando
                  </span>
                ) : proc ? (
                  <span>
                    <b>{proc}</b> em processamento agora
                  </span>
                ) : (
                  <span>Esteira em dia — tudo processado.</span>
                )}
              </div>
            )}
          </div>
          <div className={styles.queueList}>
            {fMeetings.erro ? (
              <ErrorState
                error={fMeetings.erro}
                size="compact"
                onRetry={fMeetings.tentarDeNovo}
              />
            ) : carregando ? (
              <SkeletonRow rows={2} texto="Carregando a esteira…" />
            ) : queue.length === 0 ? (
              <EmptyState
                size="compact"
                icon="check"
                title="Nada na esteira"
                description="Envie um áudio acima para começar."
              />
            ) : (
              queue.map((m) => (
                <div
                  key={m.id}
                  className={styles.queueItem}
                  onClick={() => setView(m)}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    className={`${styles.qIcon} ${m.status === "processando" ? styles.qProc : ""}`}
                  >
                    <Icon
                      name={m.status === "processando" ? "wave" : "clock"}
                      size={16}
                    />
                  </div>
                  <div className={styles.qMain}>
                    <div className={styles.qName}>{m.title}</div>
                    <div className={styles.qMeta}>
                      {/* O mesmo selo do acervo logo abaixo: o setor tem de
                          ter a mesma cara nas duas metades da tela. */}
                      <SeloSetor setor={m.sector} /> · {fmtShortDate(m.date)}
                      {m.durationMin ? ` · ${m.durationMin}min` : ""} · via{" "}
                      {SEND_LABEL[m.send ?? "file"]}
                    </div>
                    <span className={`${styles.chip} ${STATUS_CLASS[m.status]}`}>
                      {MEETING_STATUS_LABEL[m.status]}
                    </span>
                    <UploadChip meeting={m} />
                  </div>
                  <button
                    className={styles.delBtn}
                    title="Apagar gravação"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDelMeeting(m);
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ---------- acervo ---------- */}
      {/* Mesma fonte da esteira, então o mesmo `carregando`: as duas saem do
          esqueleto no mesmo instante, porque é uma assinatura só. */}
      <Acervo
        meetings={meetings}
        carregando={carregando}
        erro={fMeetings.erro}
        onTentarDeNovo={fMeetings.tentarDeNovo}
        onOpen={setView}
        onDelete={setDelMeeting}
        canSeeAudio={canSeeAudio}
      />

      {confirm && (
        <NewMeetingModal
          confirm={confirm}
          sector={sector}
          sectors={sectors}
          actorEmail={profile.email}
          startFileUpload={startFileUpload}
          onClose={() => setConfirm(null)}
        />
      )}

      {view && (
        <MeetingModal
          meeting={view}
          activeUsers={activeUsers}
          sectors={sectors}
          canSeeAudio={canSeeAudio(view)}
          onClose={() => setView(null)}
        />
      )}

      {delMeeting && (
        <OverlayPortal>
          <div
            className={styles.overlay}
            onClick={() => !deleting && setDelMeeting(null)}
          >
            <div
              className={styles.confirmBox}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.delIcon}>
                <Icon name="trash" size={22} />
              </div>
              <div className={styles.modalTitle}>Apagar gravação?</div>
              <p className={styles.delWarn}>
                Você vai apagar <b>“{delMeeting.title}”</b>. Esta ação é{" "}
                <b>permanente</b>: a gravação será removida do sistema e{" "}
                <b>não poderá ser recuperada</b>.
              </p>
              <div className={styles.mactions}>
                <button
                  className={styles.btnGhost}
                  onClick={() => setDelMeeting(null)}
                  disabled={deleting}
                >
                  Cancelar
                </button>
                <button
                  className={styles.btnDangerSolid}
                  onClick={doDelete}
                  disabled={deleting}
                >
                  {deleting ? "Apagando…" : "Apagar permanentemente"}
                </button>
              </div>
            </div>
          </div>
        </OverlayPortal>
      )}
    </div>
  );
}

/** Quanto do áudio já está seguro: em disco e no Drive. */
function SafetyBar({
  written,
  uploaded,
}: {
  written: number;
  uploaded: number;
}) {
  const pct = written > 0 ? Math.min(100, (uploaded / written) * 100) : 0;
  return (
    <div className={styles.safety}>
      <div className={styles.safetyLine}>
        <Icon name="shield" size={13} />
        <span>
          <b>{fmtBytes(written)}</b> salvos no computador ·{" "}
          <b>{fmtBytes(uploaded)}</b> já no Drive
        </span>
      </div>
      <div className={styles.uploadBar}>
        <div className={styles.uploadFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Selo de envio na esteira — só aparece enquanto o áudio não chegou inteiro. */
function UploadChip({ meeting }: { meeting: Meeting }) {
  const s = meeting.uploadStatus;
  if (!s || s === "concluido") return null;
  const total = meeting.totalBytes ?? 0;
  const sent = meeting.uploadedBytes ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  return (
    <span
      className={`${styles.chip} ${s === "falha" ? styles.st_falha : styles.st_enviando}`}
      title={meeting.uploadError ?? undefined}
    >
      {s === "gravando"
        ? "Gravando…"
        : s === "falha"
          ? "Envio interrompido"
          : `Enviando áudio ${pct}%`}
    </span>
  );
}

function NewMeetingModal({
  confirm,
  sector,
  sectors,
  actorEmail,
  startFileUpload,
  onClose,
}: {
  confirm: NonNullable<Confirm>;
  sector: string;
  sectors: string[];
  actorEmail: string;
  startFileUpload: (
    file: File,
    opts: {
      sector: string;
      output: OutputKind[];
      title: string;
      observacoes?: string;
    },
  ) => Promise<{ recordingId: string; meetingId: string | null }>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(confirm.title);
  const [sec, setSec] = useState(sector);
  const [date, setDate] = useState(todayStr());
  const [observacoes, setObservacoes] = useState("");
  // Nasce do que a gravação usou ao abrir a sessão (microfone) ou do padrão,
  // com a Ata detalhada marcada (arquivo). Estado DESTE modal, e não da
  // página: a escolha vale para um áudio, e herdar a do envio anterior faria
  // a pessoa receber o que pediu para outra reunião.
  const [escolha, setEscolha] = useState<OutputKind[]>(() =>
    normalizarEscolha(confirm.output ?? ATAS_PADRAO),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { acompanharEnvio } = useEnvios();

  // A gravação já está indo para /{setor}/{e-mail} no Drive — trocar o setor
  // aqui deixaria o arquivo numa pasta e o registro em outra.
  const sectorLocked = !!confirm.recordingId;
  // "Online" ainda não tem áudio: mostrar o que será gerado dele prometeria
  // documentos de uma gravação que não existe.
  const temAudio = !!confirm.recordingId || !!confirm.file;

  // Participantes NÃO são pedidos aqui: registrar a reunião tem que ser rápido.
  // Quem quiser marcar quem estava presente faz isso depois, no modal da
  // reunião — o campo continua existindo lá.

  async function submit() {
    setErr(null);
    const clean = title.trim();
    if (!clean) {
      setErr("Informe o título.");
      return;
    }
    // Guardadas no registro E no arquivo do Drive. O registro é para você ver
    // depois o que foi pedido; o Drive é o único lugar onde o Cowork consegue
    // ler, já que ele não fala com o Firestore.
    const obs = observacoes.trim();
    setSaving(true);
    try {
      if (confirm.meetingId) {
        // Microfone: o registro nasceu junto com a gravação e o áudio já está
        // a caminho do Drive. Aqui só completamos os dados.
        await updateMeeting(confirm.meetingId, {
          title: clean,
          date,
          output: escolha,
          ...(obs ? { aiNotes: obs } : {}),
        });
      } else if (confirm.file) {
        // Arquivo: o envio começa agora e segue em segundo plano, retomável.
        // A escolha vai na abertura da sessão, que grava o `smGerar`.
        const { recordingId, meetingId } = await startFileUpload(confirm.file, {
          sector: sec,
          output: escolha,
          title: clean,
          observacoes: obs,
        });
        // O painel do envio abre AGORA, antes do `updateMeeting` e antes de
        // este modal fechar: é ele que arma o aviso de não fechar o site, e
        // cada instante entre "Registrar" e o aviso é um instante em que a
        // pessoa fecha a aba achando que o áudio já foi (#250).
        acompanharEnvio({ recordingId, meetingId, titulo: clean, setor: sec });
        if (meetingId) {
          await updateMeeting(meetingId, {
            date,
            ...(obs ? { aiNotes: obs } : {}),
          });
        }
      } else {
        // Online, ou microfone cujo rascunho não pôde ser criado no início.
        await createMeeting(
          {
            title: clean,
            sector: sec,
            date,
            participants: [],
            ...(obs ? { aiNotes: obs } : {}),
            send: confirm.send,
            // O padrão com a detalhada é para áudio. A online não mostra a
            // lista, e gravar a escolha que ninguém viu contaria como pedido
            // da detalhada — justo o número de adesão que motivou a #248.
            output: temAudio ? escolha : normalizarEscolha([]),
            durationMin: confirm.durationMin,
            driveFileId: null,
            driveLink: null,
          },
          actorEmail,
        );
      }
      if (confirm.recordingId) {
        // Lido ANTES do `applyTitle`, que apaga o registro de um envio já
        // concluído: depois dele, "não existe" não diria se o áudio chegou.
        const antes = await getRecording(confirm.recordingId).catch(
          () => undefined,
        );
        // Microfone: a sessão de upload abriu antes de o campo existir, então
        // as observações — e a escolha, que abriu com o padrão — só chegam ao
        // arquivo agora (ou quando o envio terminar, se ainda não terminou).
        // Fora do if/else de propósito: quando o rascunho falhou no início
        // da gravação, o caminho é o `createMeeting`, e dentro do primeiro
        // ramo o áudio ficava com o título provisório e a escolha padrão.
        await uploadManager.applyTitle(
          confirm.recordingId,
          clean,
          obs,
          escolha,
        );
        // Quase sempre o áudio do microfone já chegou durante a gravação e só
        // falta a cauda (menos de 256 KB): o painel abre só se ainda falta,
        // e aí costuma confirmar em segundos. Abrir para um envio que já
        // terminou seria uma confirmação de nada. E nunca para uma gravação
        // de 0 byte (microfone mudo ou negado): não há áudio a enviar, e o
        // painel ofereceria "Tentar de novo" e "Baixar cópia" de nada — ou,
        // pior, diria "Áudio enviado!" se o Drive aceitasse fechar o vazio.
        if (antes && antes.status !== "done" && antes.bytesWritten > 0) {
          acompanharEnvio({
            recordingId: confirm.recordingId,
            meetingId: antes.meetingId ?? confirm.meetingId ?? null,
            titulo: clean,
            setor: antes.sector || sec,
          });
        }
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(
        e instanceof Error
          ? e.message
          : "Não foi possível registrar a reunião.",
      );
      setSaving(false);
    }
  }

  const sendLabel =
    confirm.send === "mic"
      ? "Gravação por microfone"
      : confirm.send === "online"
        ? "Reunião online"
        : "Envio de arquivo";

  return (
    <OverlayPortal>
      <div className={styles.overlay} onClick={onClose}>
        <div
          className={`${styles.modal} ${styles.modalRegistrar}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.modalTitle}>Registrar reunião</div>
          <div className={styles.hint}>
            🎧 <b>{sendLabel}</b>
            {confirm.durationMin ? ` · ${confirm.durationMin} min` : ""}.{" "}
            {/* "Em segundo plano" se lia como "posso sair", segundos antes de
                o painel do envio dizer "Não feche o site" (#250): quem fecha
                no Firefox ou no Safari para o envio até voltar. */}
            {confirm.recordingId
              ? "O áudio já foi enviado ao Drive durante a gravação — se ainda faltar algum trecho, ele termina de subir em instantes; deixe o site aberto até lá."
              : confirm.file
                ? "O envio começa ao confirmar. Deixe o site aberto até ele terminar — se a rede cair, ele retoma sozinho."
                : ""}
            {temAudio
              ? // "Da lista", e não "marcados": os de cadeado não têm marca e
                // também vêm. O hífen de e‑mail é o inseparável (U+2011), para
                // a linha não quebrar em "e-" / "mail".
                " Depois, a transcrição e os documentos da lista abaixo aparecem na reunião e chegam por e‑mail."
              : ""}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Título</label>
            <input
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>Setor</label>
              <select
                className={styles.select}
                value={sec}
                onChange={(e) => setSec(e.target.value)}
                disabled={sectorLocked}
                title={
                  sectorLocked
                    ? "O áudio já está sendo enviado para a pasta deste setor."
                    : undefined
                }
              >
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Data</label>
              <input
                className={styles.input}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {temAudio && (
            <div className={styles.field}>
              <div className={styles.label} id="saidas-do-envio">
                O que você vai receber
              </div>
              <div
                className={styles.outOptions}
                role="group"
                aria-labelledby="saidas-do-envio"
              >
                {OUTPUT_OPTIONS.map((o) =>
                  o.sempre ? (
                    // Não é botão: não há o que alternar. Fica na lista porque
                    // ela responde "o que vou receber?" (ver OUTPUT_OPTIONS).
                    <div
                      key={o.id}
                      className={`${styles.outOption} ${styles.outLocked}`}
                      role="checkbox"
                      aria-checked="true"
                      aria-disabled="true"
                      title="Sempre vem"
                    >
                      <span className={styles.outCheck}>
                        <Icon name="lock" size={12} />
                      </span>
                      <span className={styles.outText}>
                        <span className={styles.outName}>{o.label}</span>
                        <span className={styles.outDesc}>{o.desc}</span>
                      </span>
                    </div>
                  ) : (
                    <button
                      key={o.id}
                      type="button"
                      role="checkbox"
                      aria-checked={escolha.includes(o.id)}
                      className={`${styles.outOption} ${escolha.includes(o.id) ? styles.on : ""}`}
                      onClick={() => {
                        // `o.sempre` falso estreita a união para `OutputKind`:
                        // é o que faz o compilador recusar, no dia em que
                        // alguém tornar alternável uma entrada de cadeado, um
                        // `smGerar` com um valor que o motor não conhece.
                        setEscolha((cur) => alternarAta(cur, o.id));
                      }}
                      disabled={saving}
                    >
                      <span className={styles.outCheck}>
                        <Icon name="check" size={12} />
                      </span>
                      <span className={styles.outText}>
                        <span className={styles.outName}>{o.label}</span>
                        <span className={styles.outDesc}>{o.desc}</span>
                      </span>
                    </button>
                  ),
                )}
              </div>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Observações para a IA (opcional)</label>
            <textarea
              className={styles.input}
              rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              maxLength={4000}
              placeholder="Ex.: não citar nomes de pessoas nesta reunião — usar o setor no lugar."
            />
            <div className={styles.hintSmall}>
              Vale para a ata e os demais documentos. Use para o que a IA não tem
              como saber sozinha: trocar um nome por um setor, corrigir uma
              grafia, pedir foco num assunto.
            </div>
          </div>

          {err && <div className={styles.err}>{err}</div>}

          <div className={styles.mactions}>
            <div className={styles.spacer} />
            <button className={styles.btnGhost} onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className={styles.btnSave} onClick={submit} disabled={saving}>
              {saving ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

function MeetingModal({
  meeting,
  activeUsers,
  sectors,
  canSeeAudio,
  onClose,
}: {
  meeting: Meeting;
  activeUsers: UserProfile[];
  sectors: string[];
  canSeeAudio: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(meeting.title);
  const [sector, setSector] = useState(meeting.sector);
  const [date, setDate] = useState(meeting.date);
  const [participants, setParticipants] = useState<string[]>(
    meeting.participants ?? [],
  );
  const [transcript, setTranscript] = useState(meeting.transcript ?? "");
  const [ata, setAta] = useState(meeting.ata ?? "");
  const [status, setStatus] = useState<MeetingStatus>(meeting.status);
  const [tab, setTab] = useState<"ata" | "transcript">("ata");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const avail = activeUsers.filter(
    (u) => u.sectors?.includes(sector) || u.role === "admin",
  );
  const uploadErro = mensagemDoErro(meeting.uploadError ?? null);

  function toggleP(email: string) {
    setParticipants((cur) =>
      cur.includes(email) ? cur.filter((x) => x !== email) : [...cur, email],
    );
  }

  async function save() {
    setErr(null);
    if (!title.trim()) {
      setErr("Informe o título.");
      return;
    }
    setSaving(true);
    try {
      await updateMeeting(meeting.id, {
        title: title.trim(),
        sector,
        date,
        participants,
        transcript,
        ata,
        status,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remover esta reunião? Esta ação não pode ser desfeita."))
      return;
    try {
      await deleteMeetingById(meeting.id);
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível remover.");
    }
  }

  return (
    <OverlayPortal>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalTitle}>Reunião</div>

          <div className={styles.field}>
            <label className={styles.label}>Título</label>
            <input
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label}>Setor</label>
              <select
                className={styles.select}
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              >
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Data</label>
              <input
                className={styles.input}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Participantes</label>
            <div className={styles.secGrid}>
              {avail.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  className={`${styles.secToggle} ${participants.includes(u.email) ? styles.sel : ""}`}
                  onClick={() => toggleP(u.email)}
                >
                  {u.name?.split(" ")[0] || u.email}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.hint}>
            🎧 Origem: <b>{SEND_LABEL[meeting.send ?? "file"]}</b>
            {meeting.durationMin ? ` · ${meeting.durationMin} min` : ""}.{" "}
            {/* O "Fase 4" que estava aqui prometia um futuro que já chegou e
                desmentia o modal de registro, que diz o que acontece hoje. A
                online não tem áudio, então nada chega sozinho para ela. */}
            {/* "Chegam depois" só é verdade para quem ainda espera: com o envio
                parado nada vai chegar, e com a reunião processada já chegou.
                Dizer o mesmo nos três casos mandava esperar quem precisava
                agir (#250). */}
            {meeting.send === "online"
              ? "Reunião online não tem áudio no Drive: se tiver a transcrição ou a ata, cole abaixo."
              : meeting.uploadStatus === "falha"
                ? // O motivo passa pelo `mensagemDoErro`, que diz "a conexão
                  // caiu" no lugar do "Failed to fetch" cru do navegador. E o
                  // fim não promete "tentar de novo": o recusado também grava
                  // "falha", e para ele tentar de novo não existe.
                  //
                  // O motivo vem numa frase PRÓPRIA, e não entre parênteses:
                  // os motivos são frases inteiras, com maiúscula e às vezes
                  // duas orações, e no meio desta viravam "(“x.mp4” tem 612
                  // MB, e o limite é 500 MB. Divida o áudio…), então…". E
                  // "enquanto não chegar", e não "nada será gerado": uma falha
                  // de rede ainda se resolve com "Tentar de novo".
                  `O áudio não chegou ao Drive, e enquanto não chegar nada é gerado.${uploadErro ? ` Motivo: ${uploadErro}${/[.!?]$/.test(uploadErro) ? "" : "."}` : ""} Se ele foi enviado deste computador, o aviso do envio (no canto de baixo ou no topo da tela) mostra o que fazer.`
                : meeting.status === "processado"
                  ? canSeeAudio && meeting.driveOutputs?.some((o) => o.link)
                    ? // "De quem enviou", e não "no seu": admin e gestor do
                      // setor também veem estes botões, e o e‑mail da rotina
                      // segue a pasta do Drive (/{setor}/{e‑mail} de quem enviou).
                      "Esta reunião já foi processada: a transcrição e os documentos estão nos botões abaixo e no e‑mail de quem enviou."
                    : "Esta reunião já foi processada. Se precisar, cole a transcrição ou a ata abaixo."
                  : "A transcrição e os documentos chegam depois e aparecem aqui quando ficam prontos; se precisar, cole abaixo."}
          </div>

          {meeting.driveLink && canSeeAudio && (
            <a
              href={meeting.driveLink}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.driveBtn}
            >
              <Icon name="upload" size={14} /> Abrir áudio no Drive
            </a>
          )}

          {canSeeAudio &&
            meeting.driveOutputs &&
            meeting.driveOutputs.length > 0 && (
              <div className={styles.outLinks}>
                {meeting.driveOutputs
                  .filter((o) => o.link)
                  .map((o, i) => (
                    <a
                      key={i}
                      href={o.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.driveBtn}
                    >
                      <Icon name={OUTPUT_ICON[o.kind]} size={14} /> Abrir{" "}
                      {DRIVE_OUTPUT_LABEL[o.kind]}
                    </a>
                  ))}
              </div>
            )}

          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === "ata" ? styles.on : ""}`}
              onClick={() => setTab("ata")}
            >
              Ata
            </button>
            <button
              className={`${styles.tab} ${tab === "transcript" ? styles.on : ""}`}
              onClick={() => setTab("transcript")}
            >
              Transcrição
            </button>
          </div>
          {tab === "ata" ? (
            <textarea
              className={styles.textarea}
              value={ata}
              onChange={(e) => setAta(e.target.value)}
              placeholder="Ata da reunião…"
            />
          ) : (
            <textarea
              className={styles.textarea}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Transcrição do áudio…"
            />
          )}

          <div className={styles.field} style={{ marginTop: 14 }}>
            <label className={styles.label}>Status</label>
            <select
              className={styles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value as MeetingStatus)}
            >
              <option value="aguardando">Aguardando</option>
              <option value="processando">Processando</option>
              <option value="processado">Processado</option>
            </select>
          </div>

          {err && <div className={styles.err}>{err}</div>}

          <div className={styles.mactions}>
            <button className={styles.btnDanger} onClick={remove}>
              <Icon name="trash" size={15} /> Excluir
            </button>
            <div className={styles.spacer} />
            <button className={styles.btnGhost} onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button className={styles.btnSave} onClick={save} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
