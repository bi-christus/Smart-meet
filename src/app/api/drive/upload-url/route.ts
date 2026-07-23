import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

async function getAccessToken(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT não configurado");
  const credentials = JSON.parse(raw);
  const auth = new GoogleAuth({ credentials, scopes: [DRIVE_SCOPE] });
  const client = await auth.getClient();
  const res = await client.getAccessToken();
  if (!res.token) throw new Error("Falha ao obter token da conta de serviço");
  return res.token;
}

/** Localiza (ou cria) a subpasta do setor dentro do Drive Compartilhado. */
async function ensureSectorFolder(
  token: string,
  driveId: string,
  sector: string,
): Promise<string> {
  const safe = sector.replace(/'/g, "\\'");
  const q = `name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${driveId}' in parents`;
  const listUrl =
    "https://www.googleapis.com/drive/v3/files?" +
    new URLSearchParams({
      q,
      corpora: "drive",
      driveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      fields: "files(id,name)",
    }).toString();

  const r = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("Falha ao listar pastas: " + (await r.text()));
  const d = (await r.json()) as { files?: { id: string }[] };
  if (d.files && d.files.length) return d.files[0].id;

  const cr = await fetch(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: sector,
        mimeType: "application/vnd.google-apps.folder",
        parents: [driveId],
      }),
    },
  );
  if (!cr.ok) throw new Error("Falha ao criar pasta: " + (await cr.text()));
  const cd = (await cr.json()) as { id: string };
  return cd.id;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      mimeType?: string;
      sector?: string;
    };
    const name = body.name;
    if (!name) {
      return NextResponse.json({ error: "name obrigatório" }, { status: 400 });
    }
    const driveId = process.env.DRIVE_SHARED_DRIVE_ID;
    if (!driveId) throw new Error("DRIVE_SHARED_DRIVE_ID não configurado");

    const token = await getAccessToken();
    const folderId = await ensureSectorFolder(
      token,
      driveId,
      (body.sector || "Geral").toString(),
    );

    const origin = req.headers.get("origin") || "";
    const initUrl =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink";
    const initRes = await fetch(initUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": body.mimeType || "application/octet-stream",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    });
    if (!initRes.ok) {
      const t = await initRes.text();
      return NextResponse.json(
        { error: "Falha ao iniciar upload no Drive", detail: t },
        { status: 500 },
      );
    }
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) {
      return NextResponse.json(
        { error: "Sessão de upload não retornada pelo Drive" },
        { status: 500 },
      );
    }
    return NextResponse.json({ uploadUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    console.error("drive/upload-url:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
