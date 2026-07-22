"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeMeetings,
  createMeeting,
  updateMeeting,
  deleteMeetingById,
  MEETING_STATUS_LABEL,
  type Meeting,
  type MeetingStatus,
} from "@/lib/meetings";
import { Icon } from "@/components/icons";
import styles from "./reunioes.module.css";

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDate(d: string): string {
  const parts = d.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}

type Edit = { mode: "new" } | { mode: "view"; meeting: Meeting } | null;

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

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filter, setFilter] = useState<string>("todas");
  const [edit, setEdit] = useState<Edit>(null);

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

  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);

  const shown =
    filter === "todas" ? meetings : meetings.filter((m) => m.sector === filter);

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.empty}>
        Você ainda não participa de nenhum setor. Peça a um administrador para
        incluir você em um setor (Admin › Usuários).
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1>Reuniões</h1>
          <p>
            Grave ou envie o áudio e a IA gera a ata (Fase 4). Por ora, registre
            reuniões manualmente.
          </p>
        </div>
        <button
          className={styles.btnPrimary}
          onClick={() => setEdit({ mode: "new" })}
        >
          <Icon name="plus" size={16} /> Nova reunião
        </button>
      </div>

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

      {shown.length === 0 ? (
        <div className={styles.empty}>
          Nenhuma reunião ainda.
          <br />
          Clique em “Nova reunião” para registrar a primeira.
        </div>
      ) : (
        <div className={styles.list}>
          {shown.map((m) => (
            <div
              key={m.id}
              className={styles.item}
              onClick={() => setEdit({ mode: "view", meeting: m })}
            >
              <div className={styles.itemIcon}>
                <Icon name="reunioes" size={19} />
              </div>
              <div className={styles.itemMain}>
                <div className={styles.itemTitle}>{m.title}</div>
                <div className={styles.itemMeta}>
                  <span>{fmtDate(m.date)}</span>
                  <span>· {m.sector}</span>
                  <span>· {m.participants?.length || 0} participante(s)</span>
                </div>
              </div>
              <span
                className={`${styles.badge} ${m.status === "processado" ? styles.st_processado : styles.st_aguardando}`}
              >
                {MEETING_STATUS_LABEL[m.status]}
              </span>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <MeetingModal
          state={edit}
          sectors={sectors}
          defaultSector={filter !== "todas" ? filter : sectors[0]}
          activeUsers={activeUsers}
          actorEmail={profile.email}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function MeetingModal({
  state,
  sectors,
  defaultSector,
  activeUsers,
  actorEmail,
  onClose,
}: {
  state: NonNullable<Edit>;
  sectors: string[];
  defaultSector: string;
  activeUsers: UserProfile[];
  actorEmail: string;
  onClose: () => void;
}) {
  const isNew = state.mode === "new";
  const m = state.mode === "view" ? state.meeting : null;
  const [title, setTitle] = useState(m?.title ?? "");
  const [sector, setSector] = useState(m?.sector ?? defaultSector);
  const [date, setDate] = useState(m?.date ?? todayStr());
  const [participants, setParticipants] = useState<string[]>(
    m?.participants ?? [],
  );
  const [transcript, setTranscript] = useState(m?.transcript ?? "");
  const [ata, setAta] = useState(m?.ata ?? "");
  const [status, setStatus] = useState<MeetingStatus>(m?.status ?? "aguardando");
  const [tab, setTab] = useState<"ata" | "transcript">("ata");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleP(email: string) {
    setParticipants((cur) =>
      cur.includes(email) ? cur.filter((x) => x !== email) : [...cur, email],
    );
  }

  const avail = activeUsers.filter(
    (u) => u.sectors?.includes(sector) || u.role === "admin",
  );

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      setErr("Informe o título.");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await createMeeting({ title, sector, date, participants }, actorEmail);
      } else if (m) {
        await updateMeeting(m.id, {
          title: title.trim(),
          sector,
          date,
          participants,
          transcript,
          ata,
          status,
        });
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar a reunião.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!m) return;
    if (!confirm("Remover esta reunião? Esta ação não pode ser desfeita."))
      return;
    try {
      await deleteMeetingById(m.id);
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível remover.");
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>
          {isNew ? "Nova reunião" : "Reunião"}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Título</label>
          <input
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Alinhamento semanal — B.I."
            autoFocus
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
            {avail.length === 0 ? (
              <span style={{ color: "var(--tx-3)", fontSize: 12 }}>
                Nenhum usuário atribuído a este setor.
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

        {!isNew && (
          <>
            <div className={styles.hint}>
              🎧 O envio/gravação de áudio e a geração automática da ata chegam
              na <b>Fase 4</b>. Por ora, você pode colar a transcrição e a ata
              manualmente.
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
                <option value="processado">Processado</option>
              </select>
            </div>
          </>
        )}

        {err && <div className={styles.err}>{err}</div>}

        <div className={styles.modalActions}>
          {!isNew && (
            <button className={styles.btnDanger} onClick={remove}>
              Remover
            </button>
          )}
          <div className={styles.spacer} />
          <button
            className={styles.btnGhost}
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button className={styles.btnSave} onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : isNew ? "Criar" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
