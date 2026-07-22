import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  onSnapshot,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";

/** E-mail super admin (bootstrap). Precisa bater com o valor em firestore.rules. */
export const SUPER_ADMIN_EMAIL = "setorbiunichristus@gmail.com";

export type Role = "admin" | "gestor" | "operador";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  operador: "Operador",
};

export type UserProfile = {
  email: string;
  name: string;
  role: Role;
  cargo: string;
  sectors: string[];
  active: boolean;
  color: string;
  uid?: string | null;
};

const DEFAULT_COLOR = "#ff6a2b";

/**
 * Carrega o perfil do usuário no Firestore.
 * - Se existir e estiver ativo, retorna o perfil (e atualiza uid/lastLogin).
 * - Se for o super admin sem perfil, cria o perfil admin (bootstrap).
 * - Caso contrário retorna null (usuário não autorizado).
 */
export async function ensureUserProfile(
  user: User,
): Promise<UserProfile | null> {
  const email = (user.email ?? "").toLowerCase();
  if (!email) return null;

  const ref = doc(db, "users", email);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data() as Omit<UserProfile, "email">;
    const isSuper = email === SUPER_ADMIN_EMAIL;
    if (!data.active && !isSuper) return null; // desativado → sem acesso
    // Campos de sessão (best-effort; não bloqueia o login se falhar).
    void updateDoc(ref, {
      uid: user.uid,
      lastLogin: serverTimestamp(),
    }).catch(() => {});
    // O super admin é sempre admin ativo (à prova de auto-bloqueio).
    return isSuper
      ? { email, ...data, role: "admin", active: true }
      : { email, ...data };
  }

  // Sem perfil: apenas o super admin é criado automaticamente.
  if (email === SUPER_ADMIN_EMAIL) {
    const profile: UserProfile = {
      email,
      name: user.displayName ?? "Administrador",
      role: "admin",
      cargo: "Administrador",
      sectors: [],
      active: true,
      color: DEFAULT_COLOR,
      uid: user.uid,
    };
    await setDoc(ref, {
      ...profile,
      createdAt: serverTimestamp(),
      createdBy: "bootstrap",
      lastLogin: serverTimestamp(),
    });
    return profile;
  }

  return null; // não autorizado
}

// ---------------------------------------------------------------------------
// Gestão de usuários (aba Admin) — exige papel admin (garantido pelas regras).
// ---------------------------------------------------------------------------

/** Setores padrão (serão editáveis no Firestore na aba Admin › Setores). */
export const DEFAULT_SECTORS = [
  "B.I.",
  "Compras",
  "Cantinas",
  "Nutrição",
  "Infraestrutura",
  "RH",
  "CESIU",
  "CVU",
];

const AVATAR_COLORS = [
  "#ff6a2b",
  "#37d39b",
  "#f5b13d",
  "#c77dff",
  "#54b8ff",
  "#ff8f6b",
  "#6e79ff",
];

/** Cor de avatar estável a partir do e-mail. */
export function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export type UserInput = {
  email: string;
  name: string;
  role: Role;
  cargo: string;
  sectors: string[];
  color?: string;
};

/** Assina a lista de usuários em tempo real (ordenada por nome). */
export function subscribeUsers(
  onData: (users: UserProfile[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "users"),
    (snap) => {
      const list = snap.docs.map((d) => ({
        email: d.id,
        ...(d.data() as Omit<UserProfile, "email">),
      }));
      list.sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email, "pt-BR"),
      );
      onData(list);
    },
    (e) => onError?.(e),
  );
}

/** Cria ou atualiza um usuário. `isNew` controla os campos de criação. */
export async function saveUser(
  input: UserInput,
  actorEmail: string,
  isNew: boolean,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const ref = doc(db, "users", email);
  const base = {
    email,
    name: input.name.trim(),
    role: input.role,
    cargo: input.cargo.trim(),
    sectors: input.sectors,
    color: input.color || pickColor(email),
  };
  if (isNew) {
    await setDoc(ref, {
      ...base,
      active: true,
      uid: null,
      createdAt: serverTimestamp(),
      createdBy: actorEmail,
      lastLogin: null,
    });
  } else {
    await updateDoc(ref, base);
  }
}

export async function setUserActive(
  email: string,
  active: boolean,
): Promise<void> {
  await updateDoc(doc(db, "users", email.toLowerCase()), { active });
}

export async function deleteUser(email: string): Promise<void> {
  await deleteDoc(doc(db, "users", email.toLowerCase()));
}
