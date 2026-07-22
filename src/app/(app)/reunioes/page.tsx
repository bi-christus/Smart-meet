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
  type Meeting,
  type MeetingStatus,
  type SendMethod,
  type OutputKind,
} from "@/lib/meetings";
import { Icon } from "@/components/icons";
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
function fmtTimer(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

type Confirm = {
  send: SendMethod;
  title: string;
  durationMin?: number;
} | null;

const STATUS_CLASS: Record<MeetingStatus, string> = {
  aguardando: styles.st_aguardando,
  processando: styles.st_processando,
  processado: styles.st_processado,
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
  const [output, setOutput] = useState<OutputKind>("ambas");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filter, setFilter] = useState("todas");
  const [view, setView] = useState<Meeting | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [onlineLink, setOnlineLink] = useState("");

  // gravação
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (sectors.length && !sectors.includes(sector)) setSector(sectors[0]);
  }, [sectors, sector]);

  useEffect(() => {
    const u = subscribeMeetings(sectors, setMeetings, (e) =>
      console.error("Erro ao carregar reuniões:", e),
    );
    return () => u();
  }, [sectors]);

  useEffect(() => {
    const u = subscribeUsers(setUsers, () => {});
    return () => u();
  }, []);

  // limpeza ao desmontar
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Seu navegador não suporta gravação de áudio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = window.setInterval(
        () => setRecSeconds((s) => s + 1),
        1000,
      );
    } catch {
      setMicError(
        "Não foi possível acessar o microfone. Permita o acesso e tente novamente.",
      );
    }
  }

  function stopRecording() {
    const secs = recSeconds;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    setRecSeconds(0);
    setConfirm({
      send: "mic",
      title: `Gravação — ${fmtDate(todayStr())}`,
      durationMin: Math.max(1, Math.round(secs / 60)),
    });
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    setConfirm({
      send: "file",
      title: file.name.replace(/\.[^.]+$/, ""),
    });
  }

  function connectOnline() {
    setConfirm({
      send: "online",
      title: onlineLink ? `Reunião online` : `Reunião online`,
    });
    setOnlineLink("");
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
        <p>
          Início do fluxo — grave ou envie o áudio da reunião. (O processamento
          por IA chega na Fase 4.)
        </p>
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
                  className={`${styles.micCircle} ${recording ? styles.micRecording : ""}`}
                >
                  <Icon name="mic" size={26} />
                </div>
                {recording ? (
                  <>
                    <div className={styles.recTime}>{fmtTimer(recSeconds)}</div>
                    <div className={styles.recLabel}>
                      <span className={styles.recDot} /> Gravando…
                    </div>
                    <div className={styles.eq}>
                      {Array.from({ length: 7 }).map((_, i) => (
                        <i key={i} />
                      ))}
                    </div>
                    <div className={styles.center}>
                      <button
                        className={`${styles.btnPri} ${styles.btnStop}`}
                        onClick={stopRecording}
                      >
                        <Icon name="stop" size={15} /> Parar e enviar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.micTitle}>Gravar pelo microfone</div>
                    <div className={styles.micSub}>
                      Grave a reunião presencial direto no navegador.
                    </div>
                    <div className={styles.center}>
                      <button className={styles.btnPri} onClick={startRecording}>
                        <Icon name="mic" size={15} /> Iniciar gravação
                      </button>
                    </div>
                    {micError && (
                      <div className={styles.err} style={{ marginTop: 12 }}>
                        {micError}
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

          <div className={styles.outLbl}>O que gerar a partir da transcrição?</div>
          <div className={styles.seg}>
            {(
              [
                ["detalhada", "Ata detalhada"],
                ["didatica", "Ata didática"],
                ["ambas", "Ambas"],
              ] as [OutputKind, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                className={`${styles.segBtn} ${output === id ? styles.on : ""}`}
                onClick={() => setOutput(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.infoBanner}>
            <Icon name="shield" size={15} />O áudio ficará vinculado ao setor{" "}
            <b>&nbsp;{sector}</b>&nbsp;e será processado pela IA na Fase 4.
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
                  </div>
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
                    <span>· {m.participants?.length || 0} participante(s)</span>
                  </div>
                </div>
                <span className={`${styles.badge} ${STATUS_CLASS[m.status]}`}>
                  {MEETING_STATUS_LABEL[m.status]}
                </span>
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
          activeUsers={activeUsers}
          actorEmail={profile.email}
          onClose={() => setConfirm(null)}
        />
      )}

      {view && (
        <MeetingModal
          meeting={view}
          activeUsers={activeUsers}
          sectors={sectors}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}

function NewMeetingModal({
  confirm,
  sector,
  sectors,
  output,
  activeUsers,
  actorEmail,
  onClose,
}: {
  confirm: NonNullable<Confirm>;
  sector: string;
  sectors: string[];
  output: OutputKind;
  activeUsers: UserProfile[];
  actorEmail: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(confirm.title);
  const [sec, setSec] = useState(sector);
  const [date, setDate] = useState(todayStr());
  const [participants, setParticipants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const avail = activeUsers.filter(
    (u) => u.sectors?.includes(sec) || u.role === "admin",
  );

  function toggleP(email: string) {
    setParticipants((cur) =>
      cur.includes(email) ? cur.filter((x) => x !== email) : [...cur, email],
    );
  }

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      setErr("Informe o título.");
      return;
    }
    setSaving(true);
    try {
      await createMeeting(
        {
          title,
          sector: sec,
          date,
          participants,
          send: confirm.send,
          output,
          durationMin: confirm.durationMin,
        },
        actorEmail,
      );
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível registrar a reunião.");
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
          {confirm.durationMin ? ` · ${confirm.durationMin} min` : ""} · a IA vai
          gerar a ata na <b>Fase 4</b>. Por ora, a reunião entra na esteira como{" "}
          <b>Aguardando</b>.
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
            {avail.length === 0 ? (
              <span style={{ color: "var(--tx-3)", fontSize: 12 }}>
                Nenhum usuário neste setor.
              </span>
            ) : (
              avail.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  className={`${styles.secToggle} ${participants.includes(u.email) ? styles.sel : ""}`}
                  onClick={() => toggleP(u.email)}
                >
                  {u.name?.split(" ")[0] || u.email}
                </button>
              ))
            )}
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
  onClose,
}: {
  meeting: Meeting;
  activeUsers: UserProfile[];
  sectors: string[];
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
