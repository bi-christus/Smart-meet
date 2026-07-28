import { NextResponse } from "next/server";
import {
  HttpError,
  driveToken,
  renameFile,
  requireUser,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

/**
 * O áudio nasce no Drive com um nome provisório (`Gravação — data hora`), pois
 * a sessão de upload é aberta no instante em que a gravação começa. Quando o
 * usuário confirma o título da reunião, renomeamos o arquivo por aqui.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);

    const body = (await req.json()) as {
      fileId?: string;
      name?: string;
      sector?: string;
    };
    const fileId = (body.fileId || "").trim();
    const name = (body.name || "").trim();
    const sector = (body.sector || "").trim();
    if (!fileId || !name) throw new HttpError(400, "Dados incompletos.");

    if (caller.role !== "admin" && sector && !caller.sectors.includes(sector)) {
      throw new HttpError(403, "Você não participa deste setor.");
    }

    const file = await renameFile(await driveToken(), fileId, name);
    return NextResponse.json(file);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    console.error("drive/rename:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
