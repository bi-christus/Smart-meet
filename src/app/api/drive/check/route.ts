import { NextResponse } from "next/server";
import {
  HttpError,
  driveToken,
  getFolderMeta,
  requireUser,
  driveServiceAccountEmail,
  firebaseServiceAccountEmail,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

/** Diagnóstico da ligação com o Drive (apenas admin). */
export async function GET(req: Request) {
  try {
    const caller = await requireUser(req);
    if (caller.role !== "admin")
      throw new HttpError(403, "Apenas administradores.");

    const sa = driveServiceAccountEmail();
    const fbSa = firebaseServiceAccountEmail();
    const root = process.env.DRIVE_ROOT_FOLDER_ID;
    if (!root) {
      return NextResponse.json({
        ok: false,
        serviceAccount: sa,
        firebaseServiceAccount: fbSa,
        error: "DRIVE_ROOT_FOLDER_ID não configurado na Vercel.",
      });
    }

    const token = await driveToken();
    const meta = await getFolderMeta(token, root);
    const sharedDrive = !!meta.driveId;
    const canWrite = meta.capabilities?.canAddChildren ?? false;

    return NextResponse.json({
      ok: sharedDrive && canWrite,
      serviceAccount: sa,
      firebaseServiceAccount: fbSa,
      folderName: meta.name,
      folderId: meta.id,
      sharedDrive,
      canWrite,
      hint: !sharedDrive
        ? "A pasta NÃO está em um Drive Compartilhado. A conta de serviço não tem cota própria, então o envio vai falhar. Mova a pasta para um Drive Compartilhado."
        : !canWrite
          ? "A conta de serviço vê a pasta, mas não pode criar arquivos. Dê a ela permissão de Gerente de conteúdo."
          : "Tudo certo: pasta em Drive Compartilhado e com permissão de escrita.",
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
