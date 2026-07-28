import { NextResponse } from "next/server";
import {
  HttpError,
  assertUploadSessionUri,
  parseConfirmedBytes,
  requireUser,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

/**
 * Consulta quantos bytes o Google realmente recebeu de uma sessão retomável.
 *
 * Por que no servidor e não no navegador: a resposta 308 traz o offset no
 * header `Range`, e headers de resposta em requisições CORS só são legíveis se
 * o servidor os expuser via `Access-Control-Expose-Headers` — o que o endpoint
 * de upload do Google não garante. Feita aqui, a leitura é direta.
 *
 * É o que permite retomar com segurança depois de uma queda de rede: em vez de
 * confiar no que o navegador *acha* que enviou, perguntamos ao Google.
 */
export async function POST(req: Request) {
  try {
    await requireUser(req);

    const body = (await req.json()) as {
      sessionUri?: string;
      totalBytes?: number | null;
    };
    const sessionUri = assertUploadSessionUri(body.sessionUri);
    const total =
      typeof body.totalBytes === "number" && body.totalBytes >= 0
        ? body.totalBytes
        : null;

    const res = await fetch(sessionUri, {
      method: "PUT",
      headers: {
        // `*` na posição = "não sei onde parei, me diga"
        "Content-Range": total === null ? "bytes */*" : `bytes */${total}`,
      },
    });

    // 308 = sessão viva, upload incompleto
    if (res.status === 308) {
      return NextResponse.json({
        state: "incomplete",
        confirmedBytes: parseConfirmedBytes(res),
      });
    }

    // 200/201 = arquivo já foi fechado com sucesso
    if (res.ok) {
      const file = (await res.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        webViewLink?: string;
      };
      return NextResponse.json({ state: "complete", file });
    }

    // 404/410 = sessão expirada (vale 1 semana) — o cliente abre outra e reenvia
    if (res.status === 404 || res.status === 410) {
      return NextResponse.json({ state: "expired" });
    }

    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new HttpError(502, `Drive respondeu ${res.status}: ${detail}`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    console.error("drive/upload-status:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
