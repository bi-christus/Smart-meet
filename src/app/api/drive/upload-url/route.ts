import { NextResponse } from "next/server";
import {
  HttpError,
  driveToken,
  ensureFolder,
  requireUser,
  sectorGrantees,
  syncReaders,
} from "@/lib/server/drive-server";
import { paraSmGerar } from "@/lib/atas-do-envio-core";
import { recusaDoServidor } from "@/lib/audio/arquivo-de-audio-core";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);

    const body = (await req.json()) as {
      name?: string;
      mimeType?: string;
      sector?: string;
      outputs?: unknown;
      observacoes?: string;
      size?: unknown;
    };
    const name = (body.name || "").trim();
    const sector = (body.sector || "").trim();
    if (!name || !sector) throw new HttpError(400, "Dados incompletos.");

    /**
     * Instruções de quem enviou, para a IA seguir ao gerar os documentos.
     *
     * Vai no campo `description` do arquivo, e não em `properties`: uma
     * propriedade do Drive cabe em 124 bytes contando a chave — não serve nem
     * para uma frase. `description` aceita 4096 caracteres, e o motor do Cowork
     * já lê esse campo na listagem.
     */
    const observacoes = (body.observacoes || "").trim().slice(0, 4000);

    // Etiqueta lida pelo Cowork para saber o que gerar (Pontos importantes vem
    // sempre; atas conforme o pedido). Usamos `properties` (PÚBLICO — legível por
    // qualquer cliente com acesso ao arquivo), e NÃO `appProperties`, que é
    // privado ao OAuth client que gravou (o Cowork leria null).
    //
    // A lista passa pela normalização da casa: só valores que o motor
    // conhece, "resumo" sempre. Antes, qualquer texto entrava como veio. Sem
    // lista nenhuma, a etiqueta não é gravada — e o motor gera tudo, que é o
    // comportamento combinado para quem não disse o que quer.
    const properties = Array.isArray(body.outputs)
      ? { smGerar: paraSmGerar(body.outputs) }
      : undefined;

    // Só pode enviar para um setor do qual participa (admin pode em qualquer um).
    if (caller.role !== "admin" && !caller.sectors.includes(sector)) {
      throw new HttpError(403, "Você não participa deste setor.");
    }

    // A terceira porta do tipo de arquivo. A tela já confere antes de abrir o
    // modal, mas abas antigas continuam abertas com o código velho — foi
    // assim que um PDF virou reunião. É barreira contra ENGANO (aba antiga,
    // arquivo arrastado), não contra quem chama de propósito: o nome e o MIME
    // são o que o cliente declara, e quem quiser mentir neles passa. O dano
    // de passar fica na pasta da própria pessoa. Régua: a lista de áudio da
    // tela, mais ".audio" para o microfone sem formato
    // (`arquivo-de-audio-core.ts`). 413 e 415, e não 400, porque o cliente
    // trata os dois como recusa definitiva e não tenta de novo.
    const veredito = recusaDoServidor({
      nome: name,
      tipo: body.mimeType,
      bytes: typeof body.size === "number" ? body.size : null,
    });
    if (!veredito.ok) {
      throw new HttpError(
        veredito.motivo === "grande" ? 413 : 415,
        veredito.mensagem,
      );
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
          ...(properties ? { properties } : {}),
          ...(observacoes ? { description: observacoes } : {}),
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
