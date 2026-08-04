"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
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
import { syncDrive } from "@/lib/drive-upload";
import { useRecording } from "@/lib/audio/recording-context";
import { uploadManager } from "@/lib/audio/uploader";
import { fmtBytes } from "@/lib/audio/recording-db";
import styles from "./reunioes.module.css";

const MES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

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
} | null;

const STATUS_CLASS: Record<MeetingStatus, string> = {
  aguardando: styles.st_aguardando,
  processando: styles.st_processando,
  processado: styles.st_processado,
};

/**
 * O que gerar a partir da transcrição. "Pontos importantes" vem marcado por
 * padrão; as atas são opcionais e podem ser combinadas.
 */
const OUTPUT_OPTIONS: { id: OutputKind; label: string; desc: string }[] = [
  {
    id: "resumo",
    label: "Pontos importantes",
    desc: "Resumo objetivo: decisões e o essencial da reunião.",
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
  detalhada: "relatorios",
  didatica: "reunioes",
};

export default function ReunioesPage() {
  const { profile } = useAuth();

  const sectors = useMemo(
    () =>
      profile
        ? profile.role === "admin"
          ? DEFAULT_SECTORS
          : (profile.sectors ?? [])
        : [],
    [profile],
  );

  const [sector, setSector] = useState("");
  const [mode, setMode] = useState<SendMethod>("file");
  const [output, setOutput] = useState<OutputKind[]>(["resumo"]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filter, setFilter] = useState("todas");
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recording = rec.recording;

  useEffect(() => {
    if (sectors.length && !sectors.includes(sector)) setSector(sectors[0]);
  }, [sectors, sector]);

  useEffect(() => {
    const u = subscribeMeetings(sectors, setMeetings, (e) =>
      console.error("Erro ao carregar reuniões:", e),
    );
    return () => u();
  }, [sectors]);

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

  useEffect(() => {
    const u = subscribeUsers(setUsers, () => {});
    return () => u();
  }, []);

  // A gravação encerrou (aqui ou pelo mini player em outra aba): abre o modal
  // para completar os dados. O aviso de fechar a aba agora vive no shell.
  useEffect(() => {
    if (!pendingConfirm) return;
    setConfirm({
      send: "mic",
      title: pendingConfirm.title || `Gravação — ${fmtDate(todayStr())}`,
      durationMin: pendingConfirm.durationMin,
      recordingId: pendingConfirm.recordingId,
      meetingId: pendingConfirm.meetingId,
    });
    clearPendingConfirm();
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

  const acervo =
    filter === "todas"
      ? meetings
      : meetings.filter((m) => m.sector === filter);

  async function startRecording() {
    setMicError(null);
    setBusy(true);
    try {
      await start({ sector, output });
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

  function toggleOutput(id: OutputKind) {
    if (id === "resumo") return; // Pontos importantes é obrigatório (cadeado)
    setOutput((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
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
                  onClick={() => setMode(id)}
                  disabled={recording}
                >
                  <Icon name={ic} size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.capGrid}>
            <div className={`${styles.capMain} ${styles.capBody}`} key={mode}>
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
                  MP3, WAV, WebM, M4A · até 500 MB
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
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

            <aside className={styles.capSide}>
              <div className={styles.outLbl}>
                O que gerar a partir da transcrição?
              </div>
              <div className={styles.outOptions}>
                {OUTPUT_OPTIONS.map((o) => {
                  const locked = o.id === "resumo";
                  const on = locked || output.includes(o.id);
                  const frozen = recording && !locked;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`${styles.outOption} ${on ? styles.on : ""} ${locked ? styles.outLocked : ""}`}
                      onClick={() => {
                        if (!locked && !recording) toggleOutput(o.id);
                      }}
                      disabled={frozen}
                      aria-pressed={on}
                      title={
                        locked
                          ? "Sempre gerado"
                          : frozen
                            ? "Não é possível alterar durante a gravação"
                            : undefined
                      }
                    >
                      <span className={styles.outCheck}>
                        <Icon name={locked ? "lock" : "check"} size={12} />
                      </span>
                      <span className={styles.outText}>
                        <span className={styles.outName}>{o.label}</span>
                        <span className={styles.outDesc}>{o.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </div>

        {/* ---------- esteira ---------- */}
        <div className={`${styles.panel} ${styles.queuePanel}`}>
          <div className={styles.queueHead}>
            <div className={styles.queueTitle}>
              <b>Na esteira agora</b>
              <span className={styles.queueCount}>{queue.length}</span>
            </div>
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
          </div>
          <div className={styles.queueList}>
            {queue.length === 0 ? (
              <div className={styles.queueEmpty}>
                Nada na esteira.
                <br />
                Envie um áudio para começar.
              </div>
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
                      {m.sector} · {fmtShortDate(m.date)}
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
      <div className={styles.acervo}>
        <div className={styles.acervoHead}>
          <h2>Acervo de reuniões</h2>
          <div className={styles.filters}>
            <button
              className={`${styles.filterBtn} ${filter === "todas" ? styles.on : ""}`}
              onClick={() => setFilter("todas")}
            >
              Todas
            </button>
            {sectors.map((s) => (
              <button
                key={s}
                className={`${styles.filterBtn} ${filter === s ? styles.on : ""}`}
                onClick={() => setFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {acervo.length === 0 ? (
          <div className={styles.empty}>
            Nenhuma reunião ainda. Envie um áudio acima para registrar a
            primeira.
          </div>
        ) : (
          <div className={styles.list}>
            {acervo.map((m) => (
              <div
                key={m.id}
                className={styles.item}
                onClick={() => setView(m)}
              >
                <div className={styles.itemIcon}>
                  <Icon name="reunioes" size={19} />
                </div>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{m.title}</div>
                  <div className={styles.itemMeta}>
                    <span>{fmtDate(m.date)}</span>
                    <span>· {m.sector}</span>
                    <span>· via {SEND_LABEL[m.send ?? "file"]}</span>
                    {/* só quando alguém marcou presença no modal da reunião —
                        o registro inicial não pede mais participantes */}
                    {(m.participants?.length ?? 0) > 0 && (
                      <span>· {m.participants!.length} participante(s)</span>
                    )}
                    {m.driveLink && canSeeAudio(m) && (
                      <a
                        href={m.driveLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.driveLink}
                        onClick={(e) => e.stopPropagation()}
                      >
                        · Áudio no Drive
                      </a>
                    )}
                  </div>
                </div>
                <span className={`${styles.badge} ${STATUS_CLASS[m.status]}`}>
                  {MEETING_STATUS_LABEL[m.status]}
                </span>
                <button
                  className={styles.delBtn}
                  title="Apagar gravação"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDelMeeting(m);
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <NewMeetingModal
          confirm={confirm}
          sector={sector}
          sectors={sectors}
          output={output}
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
  output,
  actorEmail,
  startFileUpload,
  onClose,
}: {
  confirm: NonNullable<Confirm>;
  sector: string;
  sectors: string[];
  output: OutputKind[];
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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A gravação já está indo para /{setor}/{e-mail} no Drive — trocar o setor
  // aqui deixaria o arquivo numa pasta e o registro em outra.
  const sectorLocked = !!confirm.recordingId;

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
          ...(obs ? { aiNotes: obs } : {}),
        });
        if (confirm.recordingId) {
          // A sessão de upload abriu antes de o campo existir, então as
          // observações só chegam ao arquivo agora.
          await uploadManager.applyTitle(confirm.recordingId, clean, obs);
        }
      } else if (confirm.file) {
        // Arquivo: o envio começa agora e segue em segundo plano, retomável.
        const { meetingId } = await startFileUpload(confirm.file, {
          sector: sec,
          output,
          title: clean,
          observacoes: obs,
        });
        if (meetingId) {
          await updateMeeting(meetingId, {
            date,
            ...(obs ? { aiNotes: obs } : {}),
          });
        }
      } else {
        await createMeeting(
          {
            title: clean,
            sector: sec,
            date,
            participants: [],
            ...(obs ? { aiNotes: obs } : {}),
            send: confirm.send,
            output,
            durationMin: confirm.durationMin,
            driveFileId: null,
            driveLink: null,
          },
          actorEmail,
        );
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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>Registrar reunião</div>
        <div className={styles.hint}>
          🎧 <b>{sendLabel}</b>
          {confirm.durationMin ? ` · ${confirm.durationMin} min` : ""}.{" "}
          {confirm.recordingId
            ? "O áudio já foi enviado ao Drive durante a gravação — se ainda faltar algum trecho, ele sobe sozinho em segundo plano."
            : confirm.file
              ? "O envio ao Drive começa ao confirmar e continua em segundo plano, retomando sozinho se a rede cair."
              : ""}{" "}
          A ata automática por IA chega na <b>Fase 4</b>.
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
          {meeting.durationMin ? ` · ${meeting.durationMin} min` : ""}. A
          transcrição e a ata automáticas chegam na <b>Fase 4</b> — por ora você
          pode colá-las abaixo.
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
  );
}
