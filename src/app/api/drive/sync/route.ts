import { NextResponse } from "next/server";
import {
  HttpError,
  adminDb,
  driveToken,
  getFileMeta,
  listFolder,
  requireUser,
} from "@/lib/server/drive-server";

export const runtime = "nodejs";

/**
 * Espelha no app o trabalho do processador externo (Cowork).
 *
 * O Cowork observa as pastas do Drive, transcreve os áudios novos, RENOMEIA o
 * arquivo colocando "Transcrito" no fim e cria os arquivos de ata/relatório na
 * mesma pasta. Esta rota não faz IA: ela só LÊ o Drive e reflete o estado.
 *
 * Para cada reunião ainda "aguardando" com áudio no Drive, pergunta ao Google o
 * nome ATUAL do arquivo (o id é estável mesmo após rename). Se o nome carrega o
 * marcador, marca a reunião como "processado" e linka os arquivos de resultado.
 *
 * Duas formas de disparo: o usuário (token do Firebase) ao abrir a aba, e o cron
 * da Vercel (cabeçalho com CRON_SECRET) para rodar sem ninguém com a aba aberta.
 */

const MARKER = /transcrito/i;
/** Teto de reuniões por execução, para caber no tempo da função. */
const BATCH_LIMIT = 60;

type OutputKind = "transcricao" | "resumo" | "detalhada" | "didatica";
type DriveOutput = { kind: OutputKind; name: string; link: string };

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Nome-base = nome sem extensão e sem o marcador "Transcrito" do fim. */
function baseStem(audioName: string): string {
  return stripExt(audioName)
    .replace(/[\s\-–—]*transcrito\s*$/i, "")
    .trim();
}

function classify(suffix: string): OutputKind | null {
  const s = suffix.toLowerCase();
  if (s.includes("transcri")) return "transcricao"; // Transcrição / Transcrito
  if (s.includes("detalhad")) return "detalhada"; // Ata detalhada
  if (s.includes("didatic") || s.includes("didátic")) return "didatica"; // com/sem acento
  if (s.includes("ponto") || s.includes("importante") || s.includes("resumo"))
    return "resumo"; // Pontos importantes
  return null;
}

/**
 * Arquivos da pasta que compartilham o nome-base do áudio e trazem uma palavra
 * de resultado após um separador " - " (o padrão combinado com o Cowork).
 */
function collectOutputs(
  audioId: string,
  stem: string,
  files: { id: string; name: string; mimeType: string; webViewLink?: string }[],
): DriveOutput[] {
  const stemLower = stem.toLowerCase();
  if (!stemLower) return [];
  const out: DriveOutput[] = [];
  for (const f of files) {
    if (f.id === audioId) continue;
    if (f.mimeType === "application/vnd.google-apps.folder") continue;
    const fname = stripExt(f.name);
    if (!fname.toLowerCase().startsWith(stemLower)) continue;
    const suffix = fname.slice(stem.length);
    if (!/^\s*[-–—]\s*/.test(suffix)) continue; // exige separador após o nome-base
    const kind = classify(suffix);
    if (!kind) continue;
    out.push({ kind, name: f.name, link: f.webViewLink ?? "" });
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const cronSecret = process.env.CRON_SECRET;

    // sectors = null significa "todos" (admin ou cron)
    let sectors: string[] | null;
    if (cronSecret && authz === `Bearer ${cronSecret}`) {
      sectors = null;
    } else {
      const caller = await requireUser(req);
      sectors = caller.role === "admin" ? null : caller.sectors;
      if (sectors && sectors.length === 0) {
        return NextResponse.json({ checked: 0, updated: 0 });
      }
    }

    const db = adminDb();
    const snap = await db
      .collection("meetings")
      .where("status", "==", "aguardando")
      .get();

    const pending = snap.docs
      .filter((d) => {
        const m = d.data();
        if (!m.driveFileId) return false;
        if (sectors && !sectors.includes(m.sector)) return false;
        return true;
      })
      .slice(0, BATCH_LIMIT);

    if (pending.length === 0) {
      return NextResponse.json({ checked: 0, updated: 0 });
    }

    const token = await driveToken();
    let updated = 0;

    for (const doc of pending) {
      const driveFileId = doc.data().driveFileId as string;
      try {
        const meta = await getFileMeta(token, driveFileId);
        if (!MARKER.test(meta.name)) continue; // Cowork ainda não terminou

        let outputs: DriveOutput[] = [];
        const folderId = meta.parents?.[0];
        if (folderId) {
          const files = await listFolder(token, folderId);
          outputs = collectOutputs(meta.id, baseStem(meta.name), files);
        }

        await doc.ref.update({ status: "processado", driveOutputs: outputs });
        updated++;
      } catch (e) {
        // um arquivo inacessível não pode travar os outros
        console.warn("drive/sync: falha ao verificar", doc.id, e);
      }
    }

    return NextResponse.json({ checked: pending.length, updated });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    console.error("drive/sync:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
