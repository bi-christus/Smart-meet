import { NextResponse } from "next/server";
import {
  HttpError,
  driveToken,
  ensureFolder,
  requireUser,
  sectorGrantees,
  syncReaders,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);

    const body = (await req.json()) as {
      name?: string;
      mimeType?: string;
      sector?: string;
      outputs?: string[];
    };
    const name = (body.name || "").trim();
    const sector = (body.sector || "").trim();
    if (!name || !sector) throw new HttpError(400, "Dados incompletos.");

    // Etiqueta lida pelo Cowork para saber o que gerar (Pontos importantes vem
    // sempre; atas conforme o pedido). Ele deriva título/setor/usuário do nome
    // do arquivo e da pasta, então basta esta chave.
    const outputs = Array.isArray(body.outputs)
      ? body.outputs.filter((o): o is string => typeof o === "string" && !!o)
      : [];
    const appProperties = outputs.length
      ? { smGerar: outputs.join(",") }
      : undefined;

    // Só pode enviar para um setor do qual participa (admin pode em qualquer um).
    if (caller.role !== "admin" && !caller.sectors.includes(sector)) {
      throw new HttpError(403, "Você não participa deste setor.");
    }

    const root = process.env.DRIVE_ROOT_FOLDER_ID;
    if (!root)
      throw new HttpError(500, "DRIVE_ROOT_FOLDER_ID não configurado na Vercel.");

    const token = await driveToken();

    // /{setor} — visível para admins e gestores do setor
    const sectorFolder = await ensureFolder(token, sector, root);
    await syncReaders(token, sectorFolder, await sectorGrantees(sector));

    // /{setor}/{usuario} — visível só para o próprio usuário (e quem herda do setor)
    const userFolder = await ensureFolder(token, caller.email, sectorFolder);
    await syncReaders(token, userFolder, [caller.email]);

    const origin = req.headers.get("origin") || "";
    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": body.mimeType || "application/octet-stream",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify({
          name,
          parents: [userFolder],
          ...(appProperties ? { appProperties } : {}),
        }),
      },
    );
    if (!initRes.ok) {
      const t = await initRes.text();
      const quota = t.includes("storageQuotaExceeded");
      throw new HttpError(
        500,
        quota
          ? "A pasta não está em um Drive Compartilhado (conta de serviço não tem cota). Mova a pasta para um Drive Compartilhado."
          : `Falha ao iniciar upload no Drive: ${t.slice(0, 300)}`,
      );
    }
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl)
      throw new HttpError(500, "Sessão de upload não retornada pelo Drive.");

    return NextResponse.json({ uploadUrl, folderId: userFolder });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    console.error("drive/upload-url:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
