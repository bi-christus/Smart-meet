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
  subscribeColumns,
  seedDefaultColumns,
  addColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  DEFAULT_COLUMNS,
  COLUMN_COLORS,
  PRIORITY_LABEL,
  type Card,
  type CardInput,
  type Priority,
  type ChecklistItem,
  type ColumnDoc,
} from "@/lib/kanban";
import { Icon } from "@/components/icons";
import styles from "./kanban.module.css";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function parseDue(due: string): Date {
  const [y, m, dd] = due.split("-").map(Number);
  return new Date(y, m - 1, dd);
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

  // Semeia as colunas padrão se o setor ainda não tiver nenhuma.
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
        (!q || c.title.toLowerCase().includes(q)) &&
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
          <p>Cada setor tem o seu próprio quadro de demandas.</p>
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
            placeholder="Buscar cards…"
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

      <div className={styles.board}>
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
                  title="Adicionar card"
                  onClick={() =>
                    setEdit({ mode: "new", columnId: col.colId })
                  }
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
                  <div className={styles.colempty}>Nenhum card</div>
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

  return (
    <div
      className={`${styles.kcard} ${dragging ? styles.drag : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className={styles.ktop}>
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
  onClose,
}: {
  state: NonNullable<EditState>;
  sector: string;
  columns: ColumnDoc[];
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
  const [priority, setPriority] = useState<Priority>(card?.priority ?? "media");
  const [assignee, setAssignee] = useState(card?.assignee ?? "");
  const [due, setDue] = useState(card?.due ?? "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    card?.checklist ?? [],
  );
  const [newItem, setNewItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const col = columns.find((c) => c.colId === columnId);
  const done = checklist.filter((i) => i.done).length;
  const pct = checklist.length ? Math.round((done / checklist.length) * 100) : 0;

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
  function removeItem(i: number) {
    setChecklist((c) => c.filter((_, idx) => idx !== i));
  }

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
        priority,
        checklist,
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
          priority,
          checklist,
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
          placeholder="Título do card"
          autoFocus
        />

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
              className={styles.sel}
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
            >
              {columns.map((c) => (
                <option key={c.colId} value={c.colId}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Prioridade</label>
            <select
              className={styles.sel}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
          </div>
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Responsável</label>
            <select
              className={styles.sel}
              value={assignee ?? ""}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">— Ninguém —</option>
              {activeUsers.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Prazo</label>
            <input
              className={styles.inp}
              type="date"
              value={due ?? ""}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.checkHead}>
            <label className={styles.label} style={{ marginBottom: 0 }}>
              Checklist
            </label>
            {checklist.length > 0 && (
              <>
                <div className={styles.checkBar}>
                  <div
                    className={styles.checkFill}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={styles.checkPct}>
                  {done}/{checklist.length}
                </span>
              </>
            )}
          </div>
          {checklist.map((it, i) => (
            <div key={i} className={styles.checkItem}>
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
        `Mova os ${cardCount} card(s) desta coluna para outra antes de removê-la.`,
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
