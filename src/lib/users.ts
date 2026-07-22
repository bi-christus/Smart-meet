import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
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
    if (!data.active) return null; // desativado → sem acesso
    // Campos de sessão (best-effort; não bloqueia o login se falhar).
    void updateDoc(ref, {
      uid: user.uid,
      lastLogin: serverTimestamp(),
    }).catch(() => {});
    return { email, ...data };
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
