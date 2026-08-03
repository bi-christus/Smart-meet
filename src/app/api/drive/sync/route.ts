import { NextResponse } from "next/server";
import {
  HttpError,
  adminDb,
  driveToken,
  getFileMeta,
  listFolder,
  requireUser,
  syncGrants,
  type Grant,
} from "@/lib/server/drive-server";
import { notifyProcessed } from "@/lib/server/notify";

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

/**
 * Corte para reprocessar avisos de reuniões que JÁ estavam processadas.
 *
 * Sem isto, ligar o e-mail dispararia um aviso para toda reunião antiga do
 * histórico de uma vez. Com a data preenchida (ISO, ex.: "2026-08-03"), só
 * entram na retentativa as reuniões criadas a partir dela; vazio = nenhuma.
 * A transição normal aguardando → processado nunca depende deste corte.
 */
const NOTIFY_START_AT = process.env.NOTIFY_START_AT;

function criadaApos(createdAt: unknown, limite: Date): boolean {
  const d =
    createdAt instanceof Date
      ? createdAt
      : typeof (createdAt as { toDate?: () => Date })?.toDate === "function"
        ? (createdAt as { toDate: () => Date }).toDate()
        : null;
  return !!d && d.getTime() >= limite.getTime();
}

function mesmosOutputs(guardados: unknown, achados: DriveOutput[]): boolean {
  if (!Array.isArray(guardados) || guardados.length !== achados.length)
    return false;
  const chave = (o: { kind?: unknown; name?: unknown }) =>
    `${String(o.kind)}|${String(o.name)}`;
  const a = (guardados as DriveOutput[]).map(chave).sort();
  const b = achados.map(chave).sort();
  return a.every((v, i) => v === b[i]);
}

type OutputKind = "transcricao" | "resumo" | "detalhada" | "didatica";
type DriveOutput = { kind: OutputKind; name: string; link: string };

/**
 * Quem recebe acesso aos documentos da reunião.
 *
 * Quem enviou o áudio entra como editor: o e-mail pede que ele *valide* a ata,
 * e validar às vezes é corrigir. Os participantes entram como leitores, para
 * que o registro não mude sem passar por quem responde por ele. Se a mesma
 * pessoa estiver nos dois papéis, o editor prevalece.
 */
function grantsDaReuniao(m: FirebaseFirestore.DocumentData): Grant[] {
  const por = new Map<string, Grant>();
  const participantes = Array.isArray(m.participants)
    ? (m.participants as unknown[])
    : [];
  for (const p of participantes) {
    const email = String(p ?? "").trim().toLowerCase();
    if (email.includes("@")) por.set(email, { email, role: "reader" });
  }
  const dono = String(m.createdBy ?? "").trim().toLowerCase();
  if (dono.includes("@")) por.set(dono, { email: dono, role: "writer" });
  return [...por.values()];
}

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
    // Casamos pelo nome CRU: os resultados podem ser Google Docs (sem extensão),
    // e um `stripExt` cortaria um ponto do próprio nome (ex.: "Reunião 29.07").
    if (!f.name.toLowerCase().startsWith(stemLower)) continue;
    const suffix = f.name.slice(stem.length);
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
    const inScope = (m: {
      driveFileId?: unknown;
      sector?: unknown;
    }): boolean =>
      !!m.driveFileId && (!sectors || sectors.includes(m.sector as string));

    // (1) reuniões aguardando com áudio no Drive
    const aguSnap = await db
      .collection("meetings")
      .where("status", "==", "aguardando")
      .get();
    const aguardando = aguSnap.docs.filter((d) => inScope(d.data()));

    // (2) reuniões JÁ processadas mas SEM arquivos linkados — o Cowork pode ter
    // criado os Docs depois, ou um estado anterior ficou vazio. Reconciliamos:
    // marcar "processado" cedo é irreversível pela busca de aguardando, então
    // esta segunda passada é a rede de segurança.
    const procSnap = await db
      .collection("meetings")
      .where("status", "==", "processado")
      .get();
    const semArquivos = procSnap.docs.filter((d) => {
      const m = d.data();
      return (
        inScope(m) &&
        (!Array.isArray(m.driveOutputs) || m.driveOutputs.length === 0)
      );
    });

    // (3) reuniões processadas, COM arquivos, que ainda não geraram aviso — o
    // envio pode ter falhado (SMTP fora do ar, cota do Gmail). Sem esta lista
    // elas nunca mais seriam reavaliadas, porque já saíram de "aguardando" e
    // não estão em (2). O corte por data evita avisar o histórico inteiro.
    const limite = NOTIFY_START_AT ? new Date(NOTIFY_START_AT) : null;
    const semAviso =
      limite && !Number.isNaN(limite.getTime())
        ? procSnap.docs.filter((d) => {
            const m = d.data();
            return (
              inScope(m) &&
              !m.notifiedAt &&
              Array.isArray(m.driveOutputs) &&
              m.driveOutputs.length > 0 &&
              criadaApos(m.createdAt, limite)
            );
          })
        : [];

    const targets = [...aguardando, ...semArquivos, ...semAviso].slice(
      0,
      BATCH_LIMIT,
    );
    if (targets.length === 0) {
      return NextResponse.json({ checked: 0, updated: 0 });
    }

    const token = await driveToken();
    const appUrl = new URL(req.url).origin;
    let updated = 0;
    let notified = 0;

    for (const doc of targets) {
      const m = doc.data();
      const isAguardando = m.status === "aguardando";
      try {
        const meta = await getFileMeta(token, m.driveFileId as string);
        if (!MARKER.test(meta.name)) continue; // Cowork ainda não terminou

        let outputs: DriveOutput[] = [];
        let files: {
          id: string;
          name: string;
          mimeType: string;
          webViewLink?: string;
        }[] = [];
        const folderId = meta.parents?.[0];
        if (folderId) {
          files = await listFolder(token, folderId);
          outputs = collectOutputs(meta.id, baseStem(meta.name), files);
        }

        if (isAguardando) {
          await doc.ref.update({ status: "processado", driveOutputs: outputs });
          updated++;
        } else if (
          outputs.length > 0 &&
          !mesmosOutputs(m.driveOutputs, outputs)
        ) {
          // já estava processado: só atualiza quando finalmente achou os arquivos
          await doc.ref.update({ driveOutputs: outputs });
          updated++;
        }

        // Acesso aos documentos gerados. Sem isto o aviso chega com links que
        // dão "você precisa de acesso": quem envia áudio pelo app não é membro
        // do Drive Compartilhado, porque quem escreve lá é a conta de serviço.
        // Só os Docs — o áudio original continua restrito, por decisão do Ítalo.
        if (outputs.length > 0) {
          const porNome = new Map(files.map((f) => [f.name, f.id]));
          for (const o of outputs) {
            const id = porNome.get(o.name);
            if (!id) continue;
            try {
              await syncGrants(token, id, grantsDaReuniao(m));
            } catch (e) {
              console.warn("drive/sync: falha ao compartilhar", o.name, e);
            }
          }
        }

        // Aviso ao autor do envio. Duas condições protegem contra e-mail ruim:
        // `notifiedAt` garante uma única mensagem por reunião, e exigir outputs
        // evita avisar "está pronto" com anexo nenhum quando os Docs ainda não
        // apareceram — nesse caso a passada de reconciliação avisa depois.
        if (!m.notifiedAt && outputs.length > 0) {
          try {
            const sent = await notifyProcessed({
              meeting: {
                title: m.title as string | undefined,
                sector: m.sector as string | undefined,
                date: m.date as string | undefined,
                createdBy: m.createdBy as string | undefined,
              },
              outputs,
              files,
              appUrl,
              token,
            });
            if (sent) {
              await doc.ref.update({ notifiedAt: new Date() });
              notified++;
            }
          } catch (e) {
            // Falha de e-mail não desfaz o processamento: sem `notifiedAt`
            // gravado, a próxima varredura tenta de novo.
            console.warn("drive/sync: aviso não enviado", doc.id, e);
          }
        }
      } catch (e) {
        // um arquivo inacessível não pode travar os outros
        console.warn("drive/sync: falha ao verificar", doc.id, e);
      }
    }

    return NextResponse.json({ checked: targets.length, updated, notified });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    console.error("drive/sync:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
