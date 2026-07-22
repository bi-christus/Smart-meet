"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeUsers,
  saveUser,
  setUserActive,
  deleteUser,
  DEFAULT_SECTORS,
  ROLE_LABEL,
  type UserProfile,
  type Role,
  type UserInput,
} from "@/lib/users";
import { Icon } from "@/components/icons";
import styles from "./admin.module.css";

const SUBTABS = [
  { id: "usuarios", label: "Usuários", enabled: true },
  { id: "permissoes", label: "Permissões", enabled: false },
  { id: "setores", label: "Setores", enabled: false },
  { id: "equipe", label: "Equipe", enabled: false },
  { id: "logs", label: "Logs", enabled: false },
];

const ROLES: Role[] = ["admin", "gestor", "operador"];

export default function AdminPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<UserProfile | "new" | null>(null);

  useEffect(() => {
    const unsub = subscribeUsers(setUsers, (e) => {
      console.error("Erro ao carregar usuários:", e);
      setUsers([]);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.cargo ?? "").toLowerCase().includes(q),
    );
  }, [users, search]);

  if (profile?.role !== "admin") {
    return (
      <div className={styles.noperm}>
        Esta área é exclusiva de administradores.
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Admin</h1>
        <p>Gerencie usuários, setores e permissões do Smart Meeting.</p>
      </div>

      <div className={styles.subnav}>
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.subnavBtn} ${t.id === "usuarios" ? styles.on : ""}`}
            disabled={!t.enabled}
          >
            {t.label}
            {!t.enabled && <span className={styles.soon}>em breve</span>}
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Icon name="search" size={15} />
          <input
            className={styles.search}
            placeholder="Buscar por nome, e-mail ou cargo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className={styles.btnPrimary} onClick={() => setEditing("new")}>
          <Icon name="plus" size={16} /> Adicionar usuário
        </button>
      </div>

      {users === null ? (
        <div className={styles.empty}>Carregando usuários…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {search
            ? "Nenhum usuário encontrado."
            : "Nenhum usuário cadastrado ainda."}
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((u) => (
            <UserRow
              key={u.email}
              user={u}
              isYou={u.email === profile.email}
              onEdit={() => setEditing(u)}
            />
          ))}
        </div>
      )}

      {editing && (
        <UserModal
          user={editing === "new" ? null : editing}
          actorEmail={profile.email}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function UserRow({
  user,
  isYou,
  onEdit,
}: {
  user: UserProfile;
  isYou: boolean;
  onEdit: () => void;
}) {
  const inicial = (user.name?.trim()[0] || user.email[0] || "U").toUpperCase();
  const roleClass =
    user.role === "admin"
      ? styles.roleadmin
      : user.role === "gestor"
        ? styles.rolegestor
        : styles.roleoperador;

  async function toggleActive() {
    try {
      await setUserActive(user.email, !user.active);
    } catch (e) {
      console.error(e);
      alert("Não foi possível alterar o status.");
    }
  }

  async function remove() {
    if (
      !confirm(
        `Remover ${user.name || user.email}? Esta ação não pode ser desfeita.`,
      )
    )
      return;
    try {
      await deleteUser(user.email);
    } catch (e) {
      console.error(e);
      alert("Não foi possível remover.");
    }
  }

  return (
    <div className={`${styles.row} ${!user.active ? styles.rowInactive : ""}`}>
      <span
        className={styles.avatarFallback}
        style={{ background: user.color || "#555" }}
      >
        {inicial}
      </span>

      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={styles.rowName}>{user.name || "(sem nome)"}</span>
          {user.cargo && <span className={styles.rowCargo}>· {user.cargo}</span>}
          {isYou && <span className={styles.you}>você</span>}
          {!user.active && <span className={styles.you}>inativo</span>}
        </div>
        <div className={styles.rowEmail}>{user.email}</div>
        {(user.sectors?.length ?? 0) > 0 && (
          <div className={styles.rowSectors}>
            {user.sectors.map((s) => (
              <span key={s} className={styles.secChip}>
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <span className={`${styles.roleBadge} ${roleClass}`}>
        {ROLE_LABEL[user.role]}
      </span>

      <div className={styles.actions}>
        {!isYou && (
          <button
            className={styles.iconBtn}
            title={user.active ? "Desativar" : "Ativar"}
            onClick={toggleActive}
          >
            <Icon name={user.active ? "check" : "x"} size={15} />
          </button>
        )}
        <button className={styles.iconBtn} title="Editar" onClick={onEdit}>
          <Icon name="edit" size={15} />
        </button>
        {!isYou && (
          <button className={styles.iconBtn} title="Remover" onClick={remove}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function UserModal({
  user,
  actorEmail,
  onClose,
}: {
  user: UserProfile | null;
  actorEmail: string;
  onClose: () => void;
}) {
  const isNew = user === null;
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [cargo, setCargo] = useState(user?.cargo ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "operador");
  const [sectors, setSectors] = useState<string[]>(user?.sectors ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleSector(s: string) {
    setSectors((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    );
  }

  async function submit() {
    setErr(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErr("Informe um e-mail válido.");
      return;
    }
    if (!name.trim()) {
      setErr("Informe o nome.");
      return;
    }
    setSaving(true);
    try {
      const input: UserInput = { email: cleanEmail, name, cargo, role, sectors };
      await saveUser(input, actorEmail, isNew);
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar. Verifique suas permissões.");
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>
          {isNew ? "Adicionar usuário" : "Editar usuário"}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>E-mail (login Google)</label>
          <input
            className={styles.input}
            type="email"
            placeholder="pessoa@christus.edu.br"
            value={email}
            disabled={!isNew}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Nome</label>
          <input
            className={styles.input}
            placeholder="Nome completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Cargo</label>
          <input
            className={styles.input}
            placeholder="Ex.: Analista de B.I."
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Papel</label>
          <select
            className={styles.select}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Setores</label>
          <div className={styles.secGrid}>
            {DEFAULT_SECTORS.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.secToggle} ${sectors.includes(s) ? styles.sel : ""}`}
                onClick={() => toggleSector(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {err && <div className={styles.err}>{err}</div>}

        <div className={styles.modalActions}>
          <button
            className={styles.btnGhost}
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className={styles.btnSave}
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Salvando…" : isNew ? "Adicionar" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
