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
import {
  subscribeSolicitantes,
  subscribeSolicitanteSetores,
  addSolicitante,
  deleteSolicitante,
  addSolicitanteSetor,
  deleteSolicitanteSetor,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import { Icon } from "@/components/icons";
import { OverlayPortal } from "@/components/overlay-portal";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import { useAsyncData } from "@/lib/use-async-data";
import styles from "./admin.module.css";

/** Vazias constantes: `?? []` no corpo recria o array e invalida os `useMemo`. */
const SEM_SETORES: SolicitanteSetor[] = [];
const SEM_PESSOAS: Solicitante[] = [];

const SUBTABS = [
  { id: "usuarios", label: "Usuários", enabled: true },
  { id: "solicitantes", label: "Solicitantes", enabled: true },
  { id: "permissoes", label: "Permissões", enabled: false },
  { id: "setores", label: "Setores", enabled: false },
  { id: "logs", label: "Logs", enabled: false },
];

const ROLES: Role[] = ["admin", "gestor", "operador"];

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState("usuarios");
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<UserProfile | "new" | null>(null);

  /**
   * A aba de Usuários já era a única do app que distinguia carregando de
   * vazio, com `UserProfile[] | null`. Essa lógica fica exatamente como está —
   * o que muda é o que acontecia no erro.
   *
   * Antes, falhar virava `setUsers([])`: a falha se disfarçava de "nenhum
   * usuário cadastrado ainda", e o motivo real ia para o console. Agora o erro
   * tem estado próprio e o `null` continua significando só "ainda não sei".
   */
  const [erroUsers, setErroUsers] = useState<Error | null>(null);
  const [tentativaUsers, setTentativaUsers] = useState(0);

  useEffect(() => {
    const unsub = subscribeUsers(
      (lista) => {
        setUsers(lista);
        // Snapshot novo limpa o erro: o Firestore reconecta sozinho, e a tela
        // tem de sair da falha sem ninguém recarregar a página.
        setErroUsers(null);
      },
      (e) => setErroUsers(e),
    );
    return () => unsub();
  }, [tentativaUsers]);

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
            className={`${styles.subnavBtn} ${t.id === tab ? styles.on : ""}`}
            disabled={!t.enabled}
            onClick={() => t.enabled && setTab(t.id)}
          >
            {t.label}
            {!t.enabled && <span className={styles.soon}>em breve</span>}
          </button>
        ))}
      </div>

      {tab === "usuarios" && (
        <>
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

      {erroUsers ? (
        <ErrorState
          error={erroUsers}
          onRetry={() => setTentativaUsers((n) => n + 1)}
        />
      ) : users === null ? (
        <SkeletonRow rows={5} texto="Carregando os usuários…" />
      ) : filtered.length === 0 ? (
        /* Com busca ativa isto é vazio DE VERDADE — a lista chegou e o filtro
           não achou ninguém. Continua aqui de propósito. */
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
        </>
      )}

      {tab === "solicitantes" && <SolicitantesAdmin />}

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

function SolicitantesAdmin() {
  /**
   * Duas colunas, duas assinaturas, dois estados independentes — de propósito.
   *
   * São coleções separadas: a de setores pode responder antes da de pessoas, e
   * segurar as duas juntas seria inventar uma espera. Antes, as duas jogavam o
   * erro fora e as duas colunas afirmavam "ainda não tem nenhum" desde o
   * primeiro quadro.
   */
  const fSetores = useAsyncData<SolicitanteSetor>("todos", (onData, onErro) =>
    subscribeSolicitanteSetores(onData, onErro),
  );
  const fPessoas = useAsyncData<Solicitante>("todos", (onData, onErro) =>
    subscribeSolicitantes(onData, onErro),
  );
  const setores = fSetores.data ?? SEM_SETORES;
  const pessoas = fPessoas.data ?? SEM_PESSOAS;

  const [newSetor, setNewSetor] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function addSetor() {
    const n = newSetor.trim();
    if (!n || busy) return;
    if (setores.some((s) => s.name.toLowerCase() === n.toLowerCase())) {
      setNewSetor("");
      return;
    }
    setBusy(true);
    try {
      await addSolicitanteSetor(n);
      setNewSetor("");
    } catch (e) {
      console.error(e);
      alert("Não foi possível adicionar o setor.");
    } finally {
      setBusy(false);
    }
  }
  async function removeSetor(id: string, name: string) {
    if (!confirm(`Remover o setor solicitante "${name}"?`)) return;
    try {
      await deleteSolicitanteSetor(id);
    } catch (e) {
      console.error(e);
      alert("Não foi possível remover.");
    }
  }
  async function addPessoa() {
    const n = newName.trim();
    if (!n || busy) return;
    if (pessoas.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      setNewName("");
      return;
    }
    setBusy(true);
    try {
      await addSolicitante(n);
      setNewName("");
    } catch (e) {
      console.error(e);
      alert("Não foi possível adicionar o solicitante.");
    } finally {
      setBusy(false);
    }
  }
  async function removePessoa(id: string, name: string) {
    if (!confirm(`Remover o solicitante "${name}"?`)) return;
    try {
      await deleteSolicitante(id);
    } catch (e) {
      console.error(e);
      alert("Não foi possível remover.");
    }
  }

  return (
    <div className={styles.solGrid}>
      <div className={styles.solCol}>
        <div className={styles.solHead}>Setores solicitantes</div>
        <div className={styles.solAdd}>
          <input
            className={styles.input}
            placeholder="Ex.: Comercial"
            value={newSetor}
            onChange={(e) => setNewSetor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSetor();
            }}
          />
          <button
            className={styles.btnPrimary}
            onClick={addSetor}
            disabled={busy || !newSetor.trim()}
          >
            <Icon name="plus" size={15} /> Adicionar
          </button>
        </div>
        {fSetores.erro ? (
          <ErrorState
            error={fSetores.erro}
            size="compact"
            onRetry={fSetores.tentarDeNovo}
          />
        ) : fSetores.data === undefined ? (
          <SkeletonRow rows={3} texto="Carregando os setores solicitantes…" />
        ) : setores.length === 0 ? (
          <EmptyState
            size="compact"
            icon="users"
            title="Nenhum setor solicitante ainda"
            description="Cadastre acima os setores que costumam pedir demandas — eles viram opção no formulário do Kanban."
          />
        ) : (
          <div className={styles.solList}>
            {setores.map((s) => (
              <div key={s.id} className={styles.solItem}>
                <span>{s.name}</span>
                <button
                  className={styles.iconBtn}
                  title="Remover"
                  onClick={() => removeSetor(s.id, s.name)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.solCol}>
        <div className={styles.solHead}>Solicitantes</div>
        <div className={styles.solAdd}>
          <input
            className={styles.input}
            placeholder="Nome do solicitante"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPessoa();
            }}
          />
          <button
            className={styles.btnPrimary}
            onClick={addPessoa}
            disabled={busy || !newName.trim()}
          >
            <Icon name="plus" size={15} /> Adicionar
          </button>
        </div>
        {fPessoas.erro ? (
          <ErrorState
            error={fPessoas.erro}
            size="compact"
            onRetry={fPessoas.tentarDeNovo}
          />
        ) : fPessoas.data === undefined ? (
          <SkeletonRow rows={3} texto="Carregando os solicitantes…" />
        ) : pessoas.length === 0 ? (
          <EmptyState
            size="compact"
            icon="users"
            title="Nenhum solicitante ainda"
            description="Cadastre acima quem costuma pedir demandas — os nomes viram opção no formulário do Kanban."
          />
        ) : (
          <div className={styles.solList}>
            {pessoas.map((p) => (
              <div key={p.id} className={styles.solItem}>
                <span>{p.name}</span>
                <button
                  className={styles.iconBtn}
                  title="Remover"
                  onClick={() => removePessoa(p.id, p.name)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
    <OverlayPortal>
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
    </OverlayPortal>
  );
}
