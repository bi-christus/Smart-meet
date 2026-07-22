"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCards,
  createCard,
  updateCard,
  deleteCardById,
  moveCard,
  DEFAULT_COLUMNS,
  type Card,
  type CardInput,
} from "@/lib/kanban";
import { Icon } from "@/components/icons";
import styles from "./kanban.module.css";

type EditState =
  | { mode: "new"; columnId: string }
  | { mode: "edit"; card: Card }
  | null;

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function formatDue(due: string): string {
  const parts = due.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : due;
}

export default function KanbanPage() {
  const { profile } = useAuth();

  const sectors = useMemo(() => {
    if (!profile) return [];
    return profile.role === "admin" ? DEFAULT_SECTORS : profile.sectors ?? [];
  }, [profile]);

  const [sector, setSector] = useState<string>("");
  const [cards, setCards] = useState<Card[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [edit, setEdit] = useState<EditState>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  useEffect(() => {
    if (sectors.length && !sectors.includes(sector)) setSector(sectors[0]);
  }, [sectors, sector]);

  useEffect(() => {
    if (!sector) {
      setCards([]);
      return;
    }
    const unsub = subscribeCards(sector, setCards, (e) =>
      console.error("Erro ao carregar cards:", e),
    );
    return () => unsub();
  }, [sector]);

  useEffect(() => {
    const unsub = subscribeUsers(setUsers, () => {});
    return () => unsub();
  }, []);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);

  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.noSector}>
        Você ainda não participa de nenhum setor. Peça a um administrador para
        incluir você em um setor (Admin › Usuários).
      </div>
    );
  }

  function onDrop(colId: string) {
    if (dragId) {
      const c = cards.find((x) => x.id === dragId);
      if (c && c.columnId !== colId)
        moveCard(dragId, colId).catch(console.error);
    }
    setDragId(null);
    setOverCol(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <span className={styles.title}>Kanban</span>
        <div className={styles.sectors}>
          {sectors.map((s) => (
            <button
              key={s}
              className={`${styles.sectorBtn} ${s === sector ? styles.on : ""}`}
              onClick={() => setSector(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.board}>
        {DEFAULT_COLUMNS.map((col) => {
          const colCards = cards.filter((c) => c.columnId === col.id);
          return (
            <div
              key={col.id}
              className={`${styles.col} ${overCol === col.id ? styles.colDrop : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.id) setOverCol(col.id);
              }}
              onDrop={() => onDrop(col.id)}
            >
              <div className={styles.colHead}>
                <span
                  className={styles.colDot}
                  style={{ background: col.color }}
                />
                <span className={styles.colTitle}>{col.title}</span>
                <span className={styles.colCount}>{colCards.length}</span>
                <button
                  className={styles.colAdd}
                  title="Adicionar card"
                  onClick={() => setEdit({ mode: "new", columnId: col.id })}
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>
              <div className={styles.cards}>
                {colCards.length === 0 ? (
                  <div className={styles.emptyCol}>Sem cards</div>
                ) : (
                  colCards.map((c) => (
                    <CardItem
                      key={c.id}
                      card={c}
                      assignee={c.assignee ? usersMap[c.assignee] : undefined}
                      dragging={dragId === c.id}
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      onClick={() => setEdit({ mode: "edit", card: c })}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {edit && (
        <CardModal
          state={edit}
          sector={sector}
          actorEmail={profile.email}
          activeUsers={activeUsers}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function CardItem({
  card,
  assignee,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  card: Card;
  assignee?: UserProfile;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const overdue = card.due ? card.due < todayStr() : false;
  return (
    <div
      className={`${styles.card} ${dragging ? styles.dragging : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className={styles.cardTitle}>{card.title}</div>
      {(assignee || card.due) && (
        <div className={styles.cardMeta}>
          {assignee && (
            <div className={styles.cardAssignee}>
              <span
                className={styles.miniAvatar}
                style={{ background: assignee.color || "#555" }}
              >
                {(assignee.name?.[0] || "?").toUpperCase()}
              </span>
              <span>{assignee.name?.split(" ")[0]}</span>
            </div>
          )}
          {card.due && (
            <span className={`${styles.due} ${overdue ? styles.overdue : ""}`}>
              {formatDue(card.due)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CardModal({
  state,
  sector,
  actorEmail,
  activeUsers,
  onClose,
}: {
  state: NonNullable<EditState>;
  sector: string;
  actorEmail: string;
  activeUsers: UserProfile[];
  onClose: () => void;
}) {
  const isNew = state.mode === "new";
  const card = state.mode === "edit" ? state.card : null;
  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [columnId, setColumnId] = useState(
    state.mode === "new" ? state.columnId : state.card.columnId,
  );
  const [assignee, setAssignee] = useState(card?.assignee ?? "");
  const [due, setDue] = useState(card?.due ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      setErr("Informe um título.");
      return;
    }
    setSaving(true);
    try {
      const input: CardInput = {
        title,
        description,
        columnId,
        assignee: assignee || null,
        due: due || null,
      };
      if (isNew) {
        await createCard(sector, input, actorEmail);
      } else if (card) {
        await updateCard(card.id, {
          title: title.trim(),
          description: description.trim(),
          columnId,
          assignee: assignee || null,
          due: due || null,
        });
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar o card.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!card) return;
    if (!confirm("Remover este card? Esta ação não pode ser desfeita.")) return;
    try {
      await deleteCardById(card.id);
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível remover.");
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <span className={styles.modalTitle}>
            {isNew ? "Novo card" : "Editar card"}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Título</label>
          <input
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="O que precisa ser feito?"
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Descrição</label>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalhes, contexto, links…"
          />
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Coluna</label>
            <select
              className={styles.select}
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
            >
              {DEFAULT_COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Prazo</label>
            <input
              className={styles.input}
              type="date"
              value={due ?? ""}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Responsável</label>
          <select
            className={styles.select}
            value={assignee ?? ""}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">— Ninguém —</option>
            {activeUsers.map((u) => (
              <option key={u.email} value={u.email}>
                {u.name} · {u.email}
              </option>
            ))}
          </select>
        </div>

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
