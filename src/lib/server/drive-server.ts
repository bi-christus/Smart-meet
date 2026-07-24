import { GoogleAuth } from "google-auth-library";
import {
  getApps,
  initializeApp,
  cert,
  type App,
  type ServiceAccount as FbServiceAccount,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com/drive/v3";
export const SUPER_ADMIN_EMAIL = "setorbiunichristus@gmail.com";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};
type UserDoc = {
  email?: string;
  role?: string;
  sectors?: string[];
  active?: boolean;
};

function credentials(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw)
    throw new HttpError(500, "GOOGLE_SERVICE_ACCOUNT não configurado na Vercel.");
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new HttpError(500, "GOOGLE_SERVICE_ACCOUNT não é um JSON válido.");
  }
}

export function serviceAccountEmail(): string {
  return credentials().client_email;
}

let cached: App | null = null;
function adminApp(): App {
  if (!cached) {
    cached = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert(credentials() as unknown as FbServiceAccount),
        });
  }
  return cached;
}

export async function driveToken(): Promise<string> {
  const auth = new GoogleAuth({
    credentials: credentials(),
    scopes: [DRIVE_SCOPE],
  });
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  if (!t.token)
    throw new HttpError(500, "Falha ao obter token da conta de serviço.");
  return t.token;
}

export type Caller = { email: string; role: string; sectors: string[] };

/** Valida o token do Firebase e devolve o perfil (papel/setores) do chamador. */
export async function requireUser(req: Request): Promise<Caller> {
  const h = req.headers.get("authorization") || "";
  const idToken = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!idToken) throw new HttpError(401, "Não autenticado.");
  adminApp();
  const decoded = await getAuth()
    .verifyIdToken(idToken)
    .catch(() => null);
  const email = (decoded?.email || "").toLowerCase();
  if (!email) throw new HttpError(401, "Token inválido ou expirado.");

  const snap = await getFirestore().collection("users").doc(email).get();
  const data = snap.exists ? (snap.data() as UserDoc) : null;
  const isSuper = email === SUPER_ADMIN_EMAIL;
  if (!isSuper && (!data || data.active !== true))
    throw new HttpError(403, "Seu acesso ainda não foi liberado.");

  return {
    email,
    role: isSuper ? "admin" : (data?.role ?? "operador"),
    sectors: data?.sectors ?? [],
  };
}

/** Quem enxerga a pasta do setor: admins + gestores daquele setor. */
export async function sectorGrantees(sector: string): Promise<string[]> {
  adminApp();
  const snap = await getFirestore()
    .collection("users")
    .where("active", "==", true)
    .get();
  const out = new Set<string>([SUPER_ADMIN_EMAIL]);
  snap.forEach((d) => {
    const u = d.data() as UserDoc;
    const email = (u.email || d.id).toLowerCase();
    if (u.role === "admin") out.add(email);
    else if (
      u.role === "gestor" &&
      Array.isArray(u.sectors) &&
      u.sectors.includes(sector)
    )
      out.add(email);
  });
  return [...out];
}

async function driveFetch(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...((init?.headers as Record<string, string>) || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new HttpError(
      r.status === 404 ? 404 : 500,
      `Drive API ${r.status}: ${body.slice(0, 400)}`,
    );
  }
  return r;
}

export async function getFolderMeta(token: string, id: string) {
  const r = await driveFetch(
    token,
    `${API}/files/${id}?fields=id,name,driveId,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`,
  );
  return (await r.json()) as {
    id: string;
    name: string;
    driveId?: string;
    mimeType: string;
    capabilities?: { canAddChildren?: boolean };
  };
}

/** Acha (ou cria) uma subpasta pelo nome dentro de um pai. */
export async function ensureFolder(
  token: string,
  name: string,
  parentId: string,
): Promise<string> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`;
  const url =
    `${API}/files?` +
    new URLSearchParams({
      q,
      fields: "files(id,name)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    }).toString();
  const r = await driveFetch(token, url);
  const d = (await r.json()) as { files?: { id: string }[] };
  if (d.files && d.files.length) return d.files[0].id;

  const cr = await driveFetch(token, `${API}/files?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  return ((await cr.json()) as { id: string }).id;
}

/** Garante que os e-mails informados tenham leitura no item (idempotente). */
export async function syncReaders(
  token: string,
  fileId: string,
  emails: string[],
): Promise<void> {
  const r = await driveFetch(
    token,
    `${API}/files/${fileId}/permissions?fields=permissions(id,emailAddress)&supportsAllDrives=true`,
  );
  const cur = (await r.json()) as { permissions?: { emailAddress?: string }[] };
  const have = new Set(
    (cur.permissions ?? []).map((p) => (p.emailAddress || "").toLowerCase()),
  );
  for (const raw of emails) {
    const email = raw.toLowerCase();
    if (!email || have.has(email)) continue;
    try {
      await driveFetch(
        token,
        `${API}/files/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "user",
            role: "reader",
            emailAddress: email,
          }),
        },
      );
    } catch (e) {
      // não bloqueia o upload se um compartilhamento específico falhar
      console.warn("Drive: falha ao conceder acesso a", email, e);
    }
  }
}
