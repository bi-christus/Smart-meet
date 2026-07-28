import { NextResponse } from "next/server";
import {
  HttpError,
  assertUploadSessionUri,
  parseConfirmedBytes,
  requireUser,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

/** `bytes 0-262143/*` ou `bytes 262144-300000/300001` — nada além disso. */
const CONTENT_RANGE_RE = /^bytes \d+-\d+\/(\d+|\*)$/;

/**
 * Caminho alternativo: repassa um bloco de áudio ao Drive pelo servidor.
 *
 * O caminho normal é o navegador falar direto com a sessão retomável do Google
 * (rápido e sem custo de função). Se o `Content-Range` for barrado no preflight
 * CORS em algum ambiente, o `UploadManager` liga o modo proxy e passa a usar
 * esta rota — o envio fica mais lento, mas nada se perde.
 *
 * Blocos precisam caber no limite de corpo da Vercel (4,5 MB), por isso o
 * cliente usa 4 MB no modo proxy.
 */
export async function POST(req: Request) {
  try {
    await requireUser(req);

    const sessionUri = assertUploadSessionUri(req.headers.get("x-session-uri"));
    const contentRange = req.headers.get("x-content-range") || "";
    if (!CONTENT_RANGE_RE.test(contentRange)) {
      throw new HttpError(400, "Content-Range inválido.");
    }

    const bytes = await req.arrayBuffer();

    const res = await fetch(sessionUri, {
      method: "PUT",
      headers: {
        "Content-Range": contentRange,
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    });

    if (res.status === 308) {
      return NextResponse.json({
        state: "incomplete",
        confirmedBytes: parseConfirmedBytes(res),
      });
    }
    if (res.ok) {
      const file = (await res.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        webViewLink?: string;
      };
      return NextResponse.json({ state: "complete", file });
    }
    if (res.status === 404 || res.status === 410) {
      return NextResponse.json({ state: "expired" });
    }

    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new HttpError(502, `Drive respondeu ${res.status}: ${detail}`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    console.error("drive/upload-chunk:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
