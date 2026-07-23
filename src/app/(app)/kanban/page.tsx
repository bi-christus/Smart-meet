"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCards,
  createCard,
  updateCard,
  deleteCardById,
  moveCard,
  addComment,
  subscribeColumns,
  seedDefaultColumns,
  addColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  DEFAULT_COLUMNS,
  COLUMN_COLORS,
  PRIORITY_LABEL,
  DEMAND_TYPES,
  DEMAND_TYPE_LABEL,
  DEMAND_TYPE_COLOR,
  tagColor,
  type Card,
  type CardInput,
  type Priority,
  type ChecklistItem,
  type ColumnDoc,
  type DemandType,
  type Comment,
} from "@/lib/kanban";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import styles from "./kanban.module.css";

const PRIORITY_COLOR: Record<Priority, string> = {
  alta: "#fb7185",
  media: "#f5b13d",
  baixa: "#78776f",
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function parseDue(due: string): Date {
  const [y, m, dd] = due.split("-").map(Number);
  return new Date(y, m - 1, dd);
}
function toStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayStr(): string {
  return toStr(new Date());
}
function plusDays(dateStr: string, n: number): string {
  const d = parseDue(dateStr);
  d.setDate(d.getDate() + n);
  return toStr(d);
}
function fmtShort(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}
function dueInfo(
  due?: string | null,
): { label: string; tone: "late" | "soon" | "ok" } | null {
  if (!due) return null;
  const today = startOfToday();
  const d = parseDue(due);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const tone: "late" | "soon" | "ok" =
    diff < 0 ? "late" : diff <= 3 ? "soon" : "ok";
  let label: string;
  if (diff === 0) label = "Hoje";
  else if (diff === 1) label = "Amanhã";
  else if (diff === -1) label = "Ontem";
  else if (diff < 0) label = `${Math.abs(diff)}d atrás`;
  else label = fmtShort(d);
  return { label, tone };
}
function agingDays(enteredAt?: number): number {
  if (!enteredAt) return 0;
  return Math.floor((Date.now() - enteredAt) / 86400000);
}
function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return fmtShort(new Date(ts));
}

type EditState =
  | { mode: "new"; columnId: string }
  | { mode: "edit"; card: Card }
  | null;
type ColEditState = { mode: "new" } | { mode: "edit"; col: ColumnDoc } | null;

export default function KanbanPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === "admin" || profile?.role === "gestor";

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
  const [cards, setCards] = useState<Card[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [fireColumns, setFireColumns] = useState<ColumnDoc[]>([]);
  const [colsLoaded, setColsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [prio, setPrio] = useState<"" | Priority>("");
  const [edit, setEdit] = useState<EditState>(null);
  const [colEdit, setColEdit] = useState<ColEditState>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const seededRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (sectors.length && !sectors.includes(sector)) setSector(sectors[0]);
  }, [sectors, sector]);

  useEffect(() => {
    if (!sector) {
      setCards([]);
      return;
    }
    const u = subscribeCards(sector, setCards, (e) =>
      console.error("Erro ao carregar cards:", e),
    );
    return () => u();
  }, [sector]);

  useEffect(() => {
    setColsLoaded(false);
    if (!sector) {
      setFireColumns([]);
      return;
    }
    const u = subscribeColumns(
      sector,
      (cols) => {
        setFireColumns(cols);
        setColsLoaded(true);
      },
      (e) => console.error("Erro ao carregar colunas:", e),
    );
    return () => u();
  }, [sector]);

  useEffect(() => {
    if (
      colsLoaded &&
      sector &&
      fireColumns.length === 0 &&
      canManage &&
      !seededRef.current.has(sector)
    ) {
      seededRef.current.add(sector);
      seedDefaultColumns(sector).catch(console.error);
    }
  }, [colsLoaded, fireColumns.length, sector, canManage]);

  useEffect(() => {
    const u = subscribeUsers(setUsers, () => {});
    return () => u();
  }, []);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (!q ||
          c.title.toLowerCase().includes(q) ||
          (c.tags ?? []).some((t) => t.toLowerCase().includes(q))) &&
        (!prio || c.priority === prio),
    );
  }, [cards, search, prio]);

  const displayCols: ColumnDoc[] = fireColumns.length
    ? fireColumns
    : DEFAULT_COLUMNS.map((c, i) => ({
        id: `_fb_${c.id}`,
        sector,
        colId: c.id,
        title: c.title,
        color: c.color,
        order: i,
      }));
  const colsReal = fireColumns.length > 0;
  const canEditCols = canManage && colsReal;

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.noSector}>
        Você ainda não participa de nenhum setor. Peça a um administrador para
        incluir você em um setor (Admin › Usuários).
      </div>
    );
  }

  function onColDrop(col: ColumnDoc) {
    if (dragCardId) {
      const c = cards.find((x) => x.id === dragCardId);
      if (c && c.columnId !== col.colId)
        moveCard(dragCardId, col.colId).catch(console.error);
    } else if (dragColId && colsReal && dragColId !== col.id) {
      const ids = fireColumns.map((c) => c.id);
      const from = ids.indexOf(dragColId);
      const to = ids.indexOf(col.id);
      if (from >= 0 && to >= 0) {
        const [m] = ids.splice(from, 1);
        ids.splice(to, 0, m);
        reorderColumns(ids).catch(console.error);
      }
    }
    setDragCardId(null);
    setDragColId(null);
    setOverCol(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Quadro — {sector}</h1>
          <p>Demandas do setor: crie, priorize e acompanhe até a entrega.</p>
        </div>
      </div>

      <div className={styles.filters}>
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
        <div className={styles.searchwrap}>
          <Icon name="search" size={15} />
          <input
            className={styles.search}
            placeholder="Buscar por título ou tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={styles.select}
          value={prio}
          onChange={(e) => setPrio(e.target.value as "" | Priority)}
        >
          <option value="">Qualquer prioridade</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>
      </div>

      <div className={styles.board} key={sector}>
        {displayCols.map((col) => {
          const colCards = filtered.filter((c) => c.columnId === col.colId);
          return (
            <div
              key={col.id}
              className={`${styles.col} ${overCol === col.id ? styles.colDrop : ""} ${dragColId === col.id ? styles.colDragging : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.id) setOverCol(col.id);
              }}
              onDrop={() => onColDrop(col)}
            >
              <div
                className={styles.colstripe}
                style={{ background: col.color }}
              />
              <div className={styles.colhead}>
                {canEditCols && (
                  <span
                    className={styles.colGrip}
                    draggable
                    onDragStart={() => setDragColId(col.id)}
                    onDragEnd={() => {
                      setDragColId(null);
                      setOverCol(null);
                    }}
                    title="Arraste para reordenar a coluna"
                  >
                    <GripDots />
                  </span>
                )}
                <span className={styles.colTitle}>{col.title}</span>
                <span className={styles.colCount}>{colCards.length}</span>
                <div style={{ flex: 1 }} />
                <button
                  className={styles.iconbtn}
                  title="Adicionar demanda"
                  onClick={() => setEdit({ mode: "new", columnId: col.colId })}
                >
                  <Icon name="plus" size={15} />
                </button>
                {canEditCols && (
                  <button
                    className={styles.iconbtn}
                    title="Editar coluna"
                    onClick={() => setColEdit({ mode: "edit", col })}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                )}
              </div>
              <div className={styles.collist}>
                {colCards.length === 0 ? (
                  <div className={styles.colempty}>Nenhuma demanda</div>
                ) : (
                  colCards.map((c) => (
                    <CardItem
                      key={c.id}
                      card={c}
                      col={col}
                      assignee={c.assignee ? usersMap[c.assignee] : undefined}
                      dragging={dragCardId === c.id}
                      onDragStart={() => setDragCardId(c.id)}
                      onDragEnd={() => {
                        setDragCardId(null);
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

        {canEditCols && (
          <button
            className={styles.addColBtn}
            onClick={() => setColEdit({ mode: "new" })}
          >
            <Icon name="plus" size={15} /> Nova coluna
          </button>
        )}
        <div style={{ flex: "none", width: 6 }} />
      </div>

      {edit && (
        <CardModal
          state={edit}
          sector={sector}
          columns={displayCols}
          actorEmail={profile.email}
          activeUsers={activeUsers}
          usersMap={usersMap}
          onClose={() => setEdit(null)}
        />
      )}

      {colEdit && (
        <ColumnModal
          state={colEdit}
          sector={sector}
          order={displayCols.length}
          cardCount={
            colEdit.mode === "edit"
              ? cards.filter((c) => c.columnId === colEdit.col.colId).length
              : 0
          }
          onClose={() => setColEdit(null)}
        />
      )}
    </div>
  );
}

function GripDots() {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="2" cy="2" r="1.3" />
      <circle cx="8" cy="2" r="1.3" />
      <circle cx="2" cy="7" r="1.3" />
      <circle cx="8" cy="7" r="1.3" />
      <circle cx="2" cy="12" r="1.3" />
      <circle cx="8" cy="12" r="1.3" />
    </svg>
  );
}

function CardItem({
  card,
  col,
  assignee,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  card: Card;
  col: ColumnDoc;
  assignee?: UserProfile;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const di = dueInfo(card.due);
  const aging = col.colId === "aguardando" ? agingDays(card.enteredAt) : 0;
  const items = card.checklist ?? [];
  const done = items.filter((i) => i.done).length;
  const tags = card.tags ?? [];
  const comments = card.comments?.length ?? 0;
  const typeColor = card.type ? DEMAND_TYPE_COLOR[card.type] : "";

  return (
    <div
      className={`${styles.kcard} ${dragging ? styles.drag : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className={styles.ktop}>
        {card.type && (
          <span
            className={styles.kType}
            style={{ background: typeColor + "22", color: typeColor }}
          >
            <span className={styles.kTypeDot} style={{ background: typeColor }} />
            {DEMAND_TYPE_LABEL[card.type]}
          </span>
        )}
        {card.priority && (
          <span className={`${styles.prio} ${styles["prio_" + card.priority]}`}>
            {PRIORITY_LABEL[card.priority]}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span className={styles.grip}>
          <GripDots />
        </span>
      </div>
      <div className={styles.ktitle}>{card.title}</div>
      {tags.length > 0 && (
        <div className={styles.kTags}>
          {tags.slice(0, 4).map((t) => (
            <span key={t} className={styles.kTag}>
              <span className={styles.kTagDot} style={{ background: tagColor(t) }} />
              {t}
            </span>
          ))}
          {tags.length > 4 && (
            <span className={styles.kTag}>+{tags.length - 4}</span>
          )}
        </div>
      )}
      <div className={styles.kmeta}>
        {di && (
          <span className={`${styles.chip} ${styles["due_" + di.tone]}`}>
            <Icon name="calendar" size={12} />
            {di.label}
          </span>
        )}
        {aging >= 1 && (
          <span className={`${styles.aging} ${aging >= 7 ? styles.hot : ""}`}>
            <Icon name="clock" size={12} />
            {aging}d parado
          </span>
        )}
        {items.length > 0 && (
          <span className={styles.mini}>
            <Icon name="check" size={12} />
            {done}/{items.length}
          </span>
        )}
        {comments > 0 && (
          <span className={styles.mini}>
            <Icon name="chat" size={12} />
            {comments}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {assignee && (
          <span
            className={styles.miniAvatar}
            style={{ background: assignee.color || "#555" }}
            title={assignee.name}
          >
            {(assignee.name?.[0] || "?").toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

function CardModal({
  state,
  sector,
  columns,
  actorEmail,
  activeUsers,
  usersMap,
  onClose,
}: {
  state: NonNullable<EditState>;
  sector: string;
  columns: ColumnDoc[];
  actorEmail: string;
  activeUsers: UserProfile[];
  usersMap: Record<string, UserProfile>;
  onClose: () => void;
}) {
  const isNew = state.mode === "new";
  const card = state.mode === "edit" ? state.card : null;

  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [columnId, setColumnId] = useState(
    state.mode === "new" ? state.columnId : state.card.columnId,
  );
  const [type, setType] = useState<DemandType>(card?.type ?? "implementacao");
  const [priority, setPriority] = useState<Priority>(card?.priority ?? "media");
  const [assignee, setAssignee] = useState(card?.assignee ?? "");
  const [requester, setRequester] = useState(
    card?.requester ?? (isNew ? actorEmail : ""),
  );
  const [startDate, setStartDate] = useState(card?.startDate ?? todayStr());
  const [due, setDue] = useState(
    card?.due ?? plusDays(todayStr(), 7),
  );
  const [tags, setTags] = useState<string[]>(card?.tags ?? []);
  const [newTag, setNewTag] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    card?.checklist ?? [],
  );
  const [newItem, setNewItem] = useState("");
  const [comments, setComments] = useState<Comment[]>(card?.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const col = columns.find((c) => c.colId === columnId);
  const doneCount = checklist.filter((i) => i.done).length;
  const pct = checklist.length
    ? Math.round((doneCount / checklist.length) * 100)
    : 0;

  const columnOptions: SelectOption[] = columns.map((c) => ({
    value: c.colId,
    label: c.title,
    color: c.color,
  }));
  const typeOptions: SelectOption[] = DEMAND_TYPES.map((t) => ({
    value: t,
    label: DEMAND_TYPE_LABEL[t],
    color: DEMAND_TYPE_COLOR[t],
  }));
  const priorityOptions: SelectOption[] = (
    ["alta", "media", "baixa"] as Priority[]
  ).map((p) => ({
    value: p,
    label: PRIORITY_LABEL[p],
    color: PRIORITY_COLOR[p],
  }));
  const userOptions = (noneLabel: string): SelectOption[] => [
    { value: "", label: noneLabel },
    ...activeUsers.map((u) => ({
      value: u.email,
      label: u.name || u.email,
      color: u.color,
    })),
  ];

  function addTag() {
    const t = newTag.trim();
    if (!t || tags.includes(t)) {
      setNewTag("");
      return;
    }
    setTags((cur) => [...cur, t]);
    setNewTag("");
  }
  function removeTag(t: string) {
    setTags((cur) => cur.filter((x) => x !== t));
  }
  function addItem() {
    const t = newItem.trim();
    if (!t) return;
    setChecklist((c) => [...c, { text: t, done: false }]);
    setNewItem("");
  }
  function toggleItem(i: number) {
    setChecklist((c) =>
      c.map((x, idx) => (idx === i ? { ...x, done: !x.done } : x)),
    );
  }
  function editItem(i: number, text: string) {
    setChecklist((c) => c.map((x, idx) => (idx === i ? { ...x, text } : x)));
  }
  function editItemDesc(i: number, desc: string) {
    setChecklist((c) => c.map((x, idx) => (idx === i ? { ...x, desc } : x)));
  }
  function removeItem(i: number) {
    setChecklist((c) => c.filter((_, idx) => idx !== i));
  }

  async function postComment() {
    const text = newComment.trim();
    if (!text || !card) return;
    const comment: Comment = { author: actorEmail, text, at: Date.now() };
    setPosting(true);
    try {
      await addComment(card.id, comment);
      setComments((c) => [...c, comment]);
      setNewComment("");
    } catch (e) {
      console.error(e);
      setErr("Não foi possível comentar.");
    } finally {
      setPosting(false);
    }
  }

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      setErr("Informe um título.");
      return;
    }
    if (!startDate || !due) {
      setErr("Defina a data de início e o prazo de entrega.");
      return;
    }
    setSaving(true);
    try {
      const base = {
        title: title.trim(),
        description: description.trim(),
        columnId,
        type,
        assignee: assignee || null,
        requester: requester || null,
        startDate: startDate || null,
        due: due || null,
        priority,
        tags,
        checklist,
      };
      if (isNew) {
        const input: CardInput = base;
        await createCard(sector, input, actorEmail);
      } else if (card) {
        await updateCard(card.id, base);
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar a demanda.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!card) return;
    if (!confirm("Remover esta demanda? Esta ação não pode ser desfeita."))
      return;
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
        <div className={styles.mhead}>
          {col && (
            <span className={styles.mchip}>
              <span className={styles.mdot} style={{ background: col.color }} />
              {col.title}
            </span>
          )}
          <span className={styles.mchip}>{sector}</span>
        </div>

        <input
          className={styles.mtitle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título da demanda"
          autoFocus
        />

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Tipo</label>
            <Select
              value={type}
              options={typeOptions}
              onChange={(v) => setType(v as DemandType)}
              ariaLabel="Tipo da demanda"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Prioridade</label>
            <Select
              value={priority}
              options={priorityOptions}
              onChange={(v) => setPriority(v as Priority)}
              ariaLabel="Prioridade"
            />
          </div>
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Solicitante</label>
            <Select
              value={requester ?? ""}
              options={userOptions("— Não definido —")}
              onChange={setRequester}
              placeholder="— Não definido —"
              ariaLabel="Solicitante"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Responsável</label>
            <Select
              value={assignee ?? ""}
              options={userOptions("— Ninguém —")}
              onChange={setAssignee}
              placeholder="— Ninguém —"
              ariaLabel="Responsável"
            />
          </div>
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Início</label>
            <input
              className={styles.inp}
              type="date"
              value={startDate ?? ""}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Prazo de entrega</label>
            <input
              className={styles.inp}
              type="date"
              value={due ?? ""}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Coluna</label>
            <Select
              value={columnId}
              options={columnOptions}
              onChange={setColumnId}
              ariaLabel="Coluna"
            />
          </div>
          <div className={styles.field} />
        </div>

        <div className={styles.sectionLabel}>Tags</div>
        <div className={styles.tagsEdit}>
          {tags.map((t) => (
            <span key={t} className={styles.tagChip}>
              <span className={styles.tagDot} style={{ background: tagColor(t) }} />
              {t}
              <button
                className={styles.tagDel}
                onClick={() => removeTag(t)}
                title="Remover tag"
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          <input
            className={styles.tagInput}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Adicionar tag + Enter"
          />
        </div>

        <div className={styles.sectionLabel}>Descrição</div>
        <textarea
          className={styles.textarea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Contexto, requisitos, links…"
        />

        <div className={styles.sectionLabel}>
          Checklist
          {checklist.length > 0 ? ` · ${doneCount}/${checklist.length}` : ""}
        </div>
        {checklist.length > 0 && (
          <div className={styles.checkBar} style={{ marginBottom: 10 }}>
            <div className={styles.checkFill} style={{ width: `${pct}%` }} />
          </div>
        )}
        {checklist.map((it, i) => (
          <div key={i} className={styles.checkRow}>
            <div className={styles.checkMain}>
              <input
                type="checkbox"
                className={styles.checkBox}
                checked={it.done}
                onChange={() => toggleItem(i)}
              />
              <input
                className={`${styles.checkText} ${it.done ? styles.checkDone : ""}`}
                value={it.text}
                onChange={(e) => editItem(i, e.target.value)}
              />
              <button
                className={styles.checkDel}
                onClick={() => removeItem(i)}
                title="Remover item"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <input
              className={styles.checkDesc}
              value={it.desc ?? ""}
              onChange={(e) => editItemDesc(i, e.target.value)}
              placeholder="mini descrição (opcional)"
            />
          </div>
        ))}
        <div className={styles.checkAdd}>
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder="Adicionar item…"
          />
          <button className={styles.checkAddBtn} onClick={addItem}>
            Adicionar
          </button>
        </div>

        {!isNew && (
          <>
            <div className={styles.sectionLabel}>
              Comentários{comments.length ? ` · ${comments.length}` : ""}
            </div>
            <div className={styles.comments}>
              {comments.length === 0 ? (
                <div className={styles.noComments}>
                  Nenhum comentário ainda.
                </div>
              ) : (
                [...comments]
                  .sort((a, b) => a.at - b.at)
                  .map((c, i) => {
                    const u = usersMap[c.author];
                    const name = u?.name || c.author;
                    return (
                      <div key={i} className={styles.comment}>
                        <span
                          className={styles.cAvatar}
                          style={{ background: u?.color || "#555" }}
                        >
                          {(name[0] || "?").toUpperCase()}
                        </span>
                        <div className={styles.cBody}>
                          <div className={styles.cHead}>
                            <span className={styles.cName}>
                              {name.split(" ")[0]}
                            </span>
                            <span className={styles.cTime}>
                              {relTime(c.at)}
                            </span>
                          </div>
                          <div className={styles.cText}>{c.text}</div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
            <div className={styles.commentAdd}>
              <textarea
                className={styles.commentInput}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Escreva um comentário…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    postComment();
                  }
                }}
              />
              <button
                className={styles.commentBtn}
                onClick={postComment}
                disabled={posting || !newComment.trim()}
              >
                {posting ? "…" : "Comentar"}
              </button>
            </div>
          </>
        )}

        {err && <div className={styles.err}>{err}</div>}

        <div className={styles.mactions}>
          {!isNew && (
            <button className={styles.btnDanger} onClick={remove}>
              <Icon name="trash" size={15} /> Excluir
            </button>
          )}
          <div className={styles.spacer} />
          <button className={styles.btnGhost} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button className={styles.btnSave} onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : isNew ? "Criar demanda" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnModal({
  state,
  sector,
  order,
  cardCount,
  onClose,
}: {
  state: NonNullable<ColEditState>;
  sector: string;
  order: number;
  cardCount: number;
  onClose: () => void;
}) {
  const isNew = state.mode === "new";
  const col = state.mode === "edit" ? state.col : null;
  const [title, setTitle] = useState(col?.title ?? "");
  const [color, setColor] = useState(col?.color ?? COLUMN_COLORS[1]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      setErr("Informe o nome da coluna.");
      return;
    }
    setSaving(true);
    try {
      if (isNew) await addColumn(sector, title, color, order);
      else if (col) await updateColumn(col.id, { title: title.trim(), color });
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar a coluna.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!col) return;
    if (cardCount > 0) {
      setErr(
        `Mova as ${cardCount} demanda(s) desta coluna para outra antes de removê-la.`,
      );
      return;
    }
    if (!confirm("Remover esta coluna?")) return;
    try {
      await deleteColumn(col.id);
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível remover.");
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420 }}
      >
        <div className={styles.mtitle} style={{ fontSize: 19 }}>
          {isNew ? "Nova coluna" : "Editar coluna"}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Nome</label>
          <input
            className={styles.inp}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Em revisão"
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Cor</label>
          <div className={styles.colorRow}>
            {COLUMN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.colorSwatch} ${color === c ? styles.colorOn : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
        </div>

        {err && <div className={styles.err}>{err}</div>}

        <div className={styles.mactions}>
          {!isNew && (
            <button className={styles.btnDanger} onClick={remove}>
              <Icon name="trash" size={15} /> Excluir
            </button>
          )}
          <div className={styles.spacer} />
          <button className={styles.btnGhost} onClick={onClose} disabled={saving}>
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
