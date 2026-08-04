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

function parseSA(raw: string | undefined, varName: string): ServiceAccount {
  if (!raw) throw new HttpError(500, `${varName} não configurado na Vercel.`);
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new HttpError(500, `${varName} não é um JSON válido.`);
  }
}

/** Credencial principal — Firebase Admin (validar token + ler Firestore). */
function credentials(): ServiceAccount {
  return parseSA(process.env.GOOGLE_SERVICE_ACCOUNT, "GOOGLE_SERVICE_ACCOUNT");
}

/** Credencial do Drive — usa uma específica se existir, senão a principal. */
function driveCredentials(): ServiceAccount {
  return process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT
    ? parseSA(
        process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT,
        "GOOGLE_DRIVE_SERVICE_ACCOUNT",
      )
    : credentials();
}

export function driveServiceAccountEmail(): string {
  return driveCredentials().client_email;
}
export function firebaseServiceAccountEmail(): string {
  return credentials().client_email;
}

/** O Firebase pode estar em outro projeto que o da chave — por isso explícito. */
const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || "smart-meet-d441b";

let cached: App | null = null;
function adminApp(): App {
  if (!cached) {
    cached = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert(credentials() as unknown as FbServiceAccount),
          projectId: FIREBASE_PROJECT_ID,
        });
  }
  return cached;
}

/** Firestore Admin já inicializado — para rotas que escrevem sem um usuário (cron). */
export function adminDb() {
  adminApp();
  return getFirestore();
}

export async function driveToken(): Promise<string> {
  const auth = new GoogleAuth({
    credentials: driveCredentials(),
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

/**
 * Valida uma URI de sessão retomável vinda do navegador antes de o servidor
 * buscá-la. Sem isto o cliente poderia fazer o servidor requisitar qualquer
 * endereço (SSRF).
 */
export function assertUploadSessionUri(raw: unknown): string {
  if (typeof raw !== "string" || !raw) {
    throw new HttpError(400, "Sessão de upload ausente.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "Sessão de upload inválida.");
  }
  const hostOk =
    url.protocol === "https:" &&
    (url.hostname === "www.googleapis.com" ||
      url.hostname === "storage.googleapis.com");
  if (!hostOk || !url.pathname.startsWith("/upload/drive/v3/files")) {
    throw new HttpError(400, "Sessão de upload não pertence ao Google Drive.");
  }
  return url.toString();
}

/**
 * Lê o offset confirmado numa resposta 308 do protocolo retomável.
 * O header vem como `bytes=0-N` (N é inclusivo); ausência do header significa
 * que o Google ainda não persistiu byte algum.
 */
export function parseConfirmedBytes(res: Response): number {
  const range = res.headers.get("range");
  if (!range) return 0;
  const m = /bytes=(\d+)-(\d+)/.exec(range);
  if (!m) return 0;
  return Number(m[2]) + 1;
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

/** Nome atual e pasta-pai de um arquivo (o id é estável mesmo após rename). */
export async function getFileMeta(
  token: string,
  fileId: string,
): Promise<{ id: string; name: string; parents?: string[]; mimeType?: string }> {
  const r = await driveFetch(
    token,
    `${API}/files/${fileId}?fields=id,name,parents,mimeType&supportsAllDrives=true`,
  );
  return (await r.json()) as {
    id: string;
    name: string;
    parents?: string[];
    mimeType?: string;
  };
}

/** Lista os arquivos diretos de uma pasta (para achar ata/relatório/transcrição). */
export async function listFolder(
  token: string,
  folderId: string,
): Promise<
  { id: string; name: string; mimeType: string; webViewLink?: string }[]
> {
  // A pasta é por usuário e acumula ~3 a 5 arquivos por reunião. Sem seguir o
  // nextPageToken, a partir de ~50 reuniões o Drive devolveria só as 200
  // primeiras e as atas mais novas sumiriam da tela — sem erro, sem sintoma.
  // Teto de páginas para não girar para sempre se a API repetir o token.
  const MAX_PAGINAS = 25;
  const out: {
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
  }[] = [];
  let pageToken: string | undefined;

  for (let i = 0; i < MAX_PAGINAS; i++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,webViewLink)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
      pageSize: "200",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const r = await driveFetch(token, `${API}/files?${params.toString()}`);
    const body = (await r.json()) as {
      nextPageToken?: string;
      files?: {
        id: string;
        name: string;
        mimeType: string;
        webViewLink?: string;
      }[];
    };
    out.push(...(body.files ?? []));
    if (!body.nextPageToken || body.nextPageToken === pageToken) break;
    pageToken = body.nextPageToken;
  }
  return out;
}

/**
 * Acha UM arquivo pelo nome exato dentro de uma pasta.
 *
 * Existe em vez de filtrar o resultado de `listFolder` porque é uma consulta
 * direta ao Drive: não depende de paginação, não traz os outros arquivos e não
 * some se a pasta crescer. Para buscar um arquivo específico é o caminho certo.
 */
export async function findInFolder(
  token: string,
  folderId: string,
  name: string,
): Promise<{ id: string; name: string; mimeType: string; size?: string } | null> {
  const q =
    `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`;
  const url =
    `${API}/files?` +
    new URLSearchParams({
      q,
      fields: "files(id,name,mimeType,size)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
      pageSize: "5",
    }).toString();
  const r = await driveFetch(token, url);
  const body = (await r.json()) as {
    files?: { id: string; name: string; mimeType: string; size?: string }[];
  };
  return body.files?.[0] ?? null;
}

/** Baixa o conteúdo de um arquivo binário comum (não serve para Google Docs). */
export async function downloadFileText(
  token: string,
  fileId: string,
  maxBytes: number,
): Promise<string> {
  const r = await driveFetch(
    token,
    `${API}/files/${fileId}?alt=media&supportsAllDrives=true`,
  );
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new HttpError(
      413,
      `arquivo de ${buf.length} bytes excede o teto de ${maxBytes}`,
    );
  }
  return buf.toString("utf8");
}

/**
 * Grava as instruções de quem enviou na `description` do arquivo.
 *
 * É onde elas cabem e onde o Cowork consegue lê-las: `properties` do Drive
 * limita cada par a 124 bytes contando a chave, e o Cowork não fala com o
 * Firestore. `description` aceita 4096 caracteres.
 */
export async function setFileDescription(
  token: string,
  fileId: string,
  description: string,
): Promise<void> {
  await driveFetch(
    token,
    `${API}/files/${fileId}?supportsAllDrives=true&fields=id`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: description.slice(0, 4000) }),
    },
  );
}

/**
 * Exporta um Google Doc como Markdown, para o app renderizar com o próprio tema.
 *
 * Markdown e não HTML: a exportação em HTML do Google vem com ~26 KB de CSS
 * dele em cada documento, que brigaria com o tema e teria de ser removido com
 * uma limpeza frágil. Em Markdown o app controla toda a apresentação.
 *
 * O exportador do Google escapa caracteres que o Markdown trata como sintaxe
 * (`~`, `.` depois de número, `-`), e envolve os títulos em `**`. Isso é
 * desfeito aqui, uma vez, em vez de em cada componente que renderizar.
 */
export async function exportDocMarkdown(
  token: string,
  fileId: string,
): Promise<string> {
  const url =
    `${API}/files/${fileId}/export?` +
    new URLSearchParams({
      mimeType: "text/markdown",
      supportsAllDrives: "true",
    }).toString();
  const r = await driveFetch(token, url);
  const bruto = await r.text();
  return (
    bruto
      // "# **Título**" → "# Título": negrito dentro de heading vira ruído.
      .replace(/^(#{1,6}\s+)\*\*(.+?)\*\*\s*$/gm, "$1$2")
      // Escapes do exportador: \~35 min, 1\. Assunto, \- item.
      .replace(/\\([~.\-*_[\]()#+!])/g, "$1")
      .trim()
  );
}

/** Formato dos anexos do aviso: Word, que abre em qualquer lugar. */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Exporta um Google Doc como .docx para anexar no e-mail de conclusão.
 *
 * `export` só aceita arquivos nativos do Google (Docs/Sheets/Slides) e recusa
 * binários comuns — por isso quem chama filtra pelo mimeType antes.
 */
export async function exportDoc(
  token: string,
  fileId: string,
  mimeType: string = DOCX_MIME,
): Promise<Buffer> {
  const url =
    `${API}/files/${fileId}/export?` +
    new URLSearchParams({ mimeType, supportsAllDrives: "true" }).toString();
  const r = await driveFetch(token, url);
  return Buffer.from(await r.arrayBuffer());
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

/** Renomeia um arquivo já enviado (o áudio nasce com um nome provisório). */
export async function renameFile(
  token: string,
  fileId: string,
  name: string,
): Promise<{ id: string; name: string; webViewLink?: string }> {
  const r = await driveFetch(
    token,
    `${API}/files/${fileId}?supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  return (await r.json()) as { id: string; name: string; webViewLink?: string };
}

export type Grant = { email: string; role: "reader" | "writer" };

/**
 * Garante que cada e-mail tenha PELO MENOS o papel pedido no item (idempotente).
 *
 * Quem envia áudio pelo app quase nunca é membro do Drive Compartilhado — a
 * escrita é feita pela conta de serviço, não por ele. Sem uma concessão por
 * arquivo, a pessoa recebe o aviso de "está pronto" e esbarra em "você precisa
 * de acesso" ao abrir o documento.
 *
 * A concessão é por ARQUIVO porque a conta de serviço é Colaboradora: nas
 * pastas do Drive Compartilhado ela tem `canShare: false` (só um Gerente
 * compartilha pasta), mas nos arquivos que ela mesma criou tem `canShare: true`.
 *
 * NUNCA rebaixa: membros do Drive Compartilhado chegam aqui como organizer ou
 * fileOrganizer, e transformá-los em reader tiraria acesso de quem já tinha.
 * Só cria o que falta e promove reader → writer.
 */
export async function syncGrants(
  token: string,
  fileId: string,
  grants: Grant[],
): Promise<void> {
  if (grants.length === 0) return;
  const r = await driveFetch(
    token,
    `${API}/files/${fileId}/permissions?fields=permissions(id,emailAddress,role)&supportsAllDrives=true`,
  );
  const cur = (await r.json()) as {
    permissions?: { id: string; emailAddress?: string; role?: string }[];
  };
  const atual = new Map(
    (cur.permissions ?? []).map((p) => [
      (p.emailAddress || "").toLowerCase(),
      p,
    ]),
  );

  for (const { email: raw, role } of grants) {
    const email = raw.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const tem = atual.get(email);
    try {
      if (!tem) {
        await driveFetch(
          token,
          `${API}/files/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "user", role, emailAddress: email }),
          },
        );
      } else if (role === "writer" && tem.role === "reader") {
        await driveFetch(
          token,
          `${API}/files/${fileId}/permissions/${tem.id}?supportsAllDrives=true&fields=id`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "writer" }),
          },
        );
      }
    } catch (e) {
      // um compartilhamento que falha não pode derrubar os outros
      console.warn("Drive: falha ao conceder acesso a", email, e);
    }
  }
}

/** Atalho para o caso antigo: leitura para todos os e-mails informados. */
export async function syncReaders(
  token: string,
  fileId: string,
  emails: string[],
): Promise<void> {
  await syncGrants(
    token,
    fileId,
    emails.map((email) => ({ email, role: "reader" as const })),
  );
}
