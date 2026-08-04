/**
 * Traz para o banco as propostas de demanda que o Cowork deixou no Drive.
 *
 * ⚠️ FRONTEIRA DE SEGURANÇA — este arquivo NUNCA escreve em /cards.
 *
 * Ele grava exclusivamente em /demandLotes, /demandPropostas e /logs. Um card
 * só nasce por decisão humana, em `POST /api/demandas/decidir`. Existe um teste
 * automático (`npm run check:demandas`) que falha o build se esta regra for
 * quebrada — a proteção precisa sobreviver a quem editar isto no futuro sem ler
 * este comentário.
 *
 * A entrega é *pull*: o Cowork deposita o arquivo e vai embora. Se a máquina
 * dele desligar no meio, o arquivo já está no Drive e a próxima varredura
 * ingere. Não há retry, fila nem endpoint de status para dar errado.
 */
import {
  adminDb,
  findInFolder,
  downloadFileText,
} from "./drive-server";
import {
  validarSidecar,
  nomeDoSidecar,
  MAX_SIDECAR_BYTES,
  type PropostaNova,
  type Rejeitada,
} from "./demandas-schema";

export type ResultadoIngest = {
  estado: "criado" | "sem-arquivo" | "ja-ingerido" | "rejeitado" | "erro";
  propostas?: number;
  rejeitadas?: number;
  motivo?: string;
};

/**
 * IDs determinísticos. Com `create()` (que falha se já existir), reprocessar a
 * mesma reunião não duplica nada — o segundo ingest colide e para.
 */
function idDoLote(driveFileId: string, revisao: number): string {
  return `${driveFileId}__r${revisao}`;
}
function idDaProposta(driveFileId: string, revisao: number, i: number): string {
  return `${driveFileId}__r${revisao}__${String(i).padStart(2, "0")}`;
}

export async function ingestDemandas(args: {
  token: string;
  meetingId: string;
  meeting: FirebaseFirestore.DocumentData;
  driveFileId: string;
  pastaId: string;
  base: string;
}): Promise<ResultadoIngest> {
  const { token, meetingId, meeting, driveFileId, pastaId, base } = args;
  const db = adminDb();
  const revisao = 1; // revisões >1 são da Fase 3 (reprocessamento)
  const loteId = idDoLote(driveFileId, revisao);

  // Já ingerido? Sai antes de gastar chamada ao Drive.
  const jaExiste = await db.collection("demandLotes").doc(loteId).get();
  if (jaExiste.exists) return { estado: "ja-ingerido" };

  const arquivo = await findInFolder(token, pastaId, nomeDoSidecar(base));
  if (!arquivo) return { estado: "sem-arquivo" };

  let bruto: unknown;
  try {
    const texto = await downloadFileText(token, arquivo.id, MAX_SIDECAR_BYTES);
    bruto = JSON.parse(texto);
  } catch (e) {
    return {
      estado: "erro",
      motivo: e instanceof Error ? e.message : "falha ao ler o arquivo",
    };
  }

  const v = validarSidecar(bruto, { driveFileId });
  if (!v.ok) {
    // Lote recusado inteiro ainda vira registro: sem isto, "o Cowork não gerou
    // demandas" e "o Cowork gerou lixo que foi descartado" ficam idênticos.
    await db
      .collection("demandLotes")
      .doc(loteId)
      .create({
        meetingId,
        driveFileId,
        base,
        revisao,
        status: "rejeitado",
        motivoRejeicao: v.erro,
        sectorReuniao: (meeting.sector as string) ?? "",
        totais: { propostas: 0, pendentes: 0, aceitas: 0, recusadas: 0 },
        criadoEm: new Date(),
      })
      .catch(() => {});
    return { estado: "rejeitado", motivo: v.erro };
  }

  const sectorReuniao = (meeting.sector as string) ?? "";
  const agora = new Date();

  // Uma transação por lote: ou o lote e todas as propostas entram, ou nada
  // entra. Um lote com metade das propostas mostraria ao humano uma fila que
  // não corresponde ao documento que ele recebeu por e-mail.
  try {
    await db.runTransaction(async (tx) => {
      const loteRef = db.collection("demandLotes").doc(loteId);
      tx.create(loteRef, {
        meetingId,
        driveFileId,
        base,
        revisao,
        status: v.aceitas.length === 0 ? "resolvido" : "pendente",
        sectorReuniao,
        gerador: v.sidecar.gerador,
        catalogo: v.sidecar.catalogo,
        geradoEm: v.sidecar.geradoEm,
        rejeitadasNoIngest: v.rejeitadas,
        totais: {
          propostas: v.aceitas.length,
          pendentes: v.aceitas.length,
          aceitas: 0,
          recusadas: 0,
        },
        criadoEm: agora,
      });

      v.aceitas.forEach((p: PropostaNova, i: number) => {
        const ref = db
          .collection("demandPropostas")
          .doc(idDaProposta(driveFileId, revisao, i));
        tx.create(ref, {
          loteId,
          meetingId,
          driveFileId,
          revisao,
          // Na Fase 1 só há demanda NOVA, então o setor de destino é sempre o
          // da reunião. Quando entrar o vínculo com card existente, o alvo
          // passa a vir do card — e pode ser outro setor.
          sectorReuniao,
          sectorAlvo: sectorReuniao,
          acao: "nova",
          certezaLLM: p.certezaLLM,
          assunto: p.assunto,
          resumo: p.resumo,
          evidencia: p.evidencia,
          conferir: p.conferir,
          proposta: p.proposta,
          possivelDuplicataDe: p.possivelDuplicataDe,
          status: "pendente",
          criadoEm: agora,
        });
      });

      tx.create(db.collection("logs").doc(), {
        tipo: "demandas.ingest",
        meetingId,
        loteId,
        driveFileId,
        sector: sectorReuniao,
        propostas: v.aceitas.length,
        rejeitadas: v.rejeitadas.map((r: Rejeitada) => r.motivo),
        em: agora,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ALREADY_EXISTS é corrida entre duas varreduras simultâneas, não erro.
    if (/already exists/i.test(msg)) return { estado: "ja-ingerido" };
    return { estado: "erro", motivo: msg };
  }

  return {
    estado: "criado",
    propostas: v.aceitas.length,
    rejeitadas: v.rejeitadas.length,
  };
}
