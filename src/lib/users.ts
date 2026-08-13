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
import { conferirFoto, corDeAvatar } from "./avatar-core.ts";

// A regra do avatar mora em `avatar-core`, que é puro; aqui ela é reexportada
// para quem JÁ importa este módulo — o modal da foto, que precisa do `photo` e
// da escrita na mesma linha de import.
//
// Quem NÃO deve vir por aqui é componente de desenho: `<Avatar>` importa direto
// do módulo puro, e é assim que ele evita arrastar `firebase/firestore` para
// dentro de todo lugar que mostra o rosto de alguém. As duas portas são de
// propósito, e a diferença entre elas é quem já paga o SDK.
export {
  avatarDe,
  conferirFoto,
  corDeAvatar,
  inicialDe,
  LADO_FOTO_PX,
  LIMITE_FOTO_BYTES,
  tamanhoDataUri,
  type Avatar,
  type PessoaDoAvatar,
} from "./avatar-core.ts";

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
  /**
   * Foto de perfil como data URI, ou ausente/null para quem não escolheu uma.
   *
   * Vem junto no `subscribeUsers`, e é essa a razão de o tamanho ser trancado
   * em `avatar-core.ts`: este campo é baixado por todo cliente em toda tela.
   */
  photo?: string | null;
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

/**
 * Cor de avatar estável a partir do e-mail.
 *
 * A paleta e o hash mudaram de casa para `avatar-core.ts` — é regra de avatar, e
 * regra tem de caber no módulo puro para ser testada. O nome antigo fica como
 * apelido porque é por ele que o resto do app pergunta.
 */
export const pickColor = corDeAvatar;

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

// ---------------------------------------------------------------------------
// Foto de perfil — a única escrita em /users que NÃO é de admin.
//
// Quem grava é o dono do doc, pelo braço do `hasOnly(['uid','lastLogin',
// 'photo'])` em firestore.rules. As duas funções abaixo escrevem só `photo`, e
// nada mais: mandar qualquer outro campo junto faz a regra negar a escrita
// inteira, inclusive a foto.
// ---------------------------------------------------------------------------

/**
 * Grava a foto do próprio usuário. Lança com a mensagem pronta para a tela
 * quando a imagem não passa.
 *
 * A conferência acontece AQUI, antes de ir ao banco, e a regra do Firestore é a
 * segunda barreira — não a primeira. A regra não sabe dizer "recorte mais perto
 * do rosto"; ela responde "sem permissão", que é a mensagem errada para quem
 * escolheu uma foto grande demais e não fez nada de errado.
 */
export async function setUserPhoto(
  email: string,
  foto: string,
): Promise<void> {
  const conferida = conferirFoto(foto);
  if (!conferida.ok) throw new Error(conferida.motivo);
  await updateDoc(doc(db, "users", email.trim().toLowerCase()), {
    photo: foto.trim(),
  });
}

/**
 * Tira a foto e volta para a inicial.
 *
 * Grava `null` em vez de apagar o campo (`deleteField`) pelo mesmo motivo da
 * lixeira em `kanban.ts`: a regra precisa de um valor para examinar, e `null` é
 * o que `fotoOk()` aceita explicitamente. Campo que some do documento é campo
 * que a regra não vê.
 */
export async function removeUserPhoto(email: string): Promise<void> {
  await updateDoc(doc(db, "users", email.trim().toLowerCase()), { photo: null });
}
