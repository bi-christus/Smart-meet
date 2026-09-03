/**
 * A ata de uma reunião que já foi processada — criada, ou mesclada na que existe.
 *
 * O servidor lê o documento "Pontos importantes" no Drive e trabalha com
 * `ata-de-reuniao-core`. Nada de IA: a estrutura já está no documento — o porquê
 * inteiro está no cabeçalho daquele módulo.
 *
 * TRÊS MODOS, e o que os distingue é a presença de `ataId`:
 *
 *   1. `{ meetingId, setor }` — CRIA a ata. É o caminho original, e nada nele
 *      mudou.
 *   2. `{ meetingId, ataId, preview: true }` — devolve o PLANO da mesclagem e
 *      não escreve nada. É o que a tela de conferência lê.
 *   3. `{ meetingId, ataId, aprovados: number[] }` — recomputa o plano e aplica
 *      só os blocos aprovados, em transação.
 *
 * POR QUE OS MODOS 2 E 3 EXISTEM. A ata de uma reunião semanal nasce ANTES de o
 * áudio ficar pronto: a equipe lança os assuntos que quer discutir, e "Levar
 * para próxima reunião" já deixou lá o que ficou pendurado. Com só o modo 1, a
 * única saída era criar uma SEGUNDA ata da mesma reunião no mesmo setor — mesma
 * data, mesmo título na lista, uma com o que as pessoas lançaram e outra com o
 * que o áudio trouxe, e nenhuma sabendo da outra. Foi o estado da ata de
 * 02/09/2026 das Cantinas.
 *
 * O PLANO É RECOMPUTADO AQUI, SEMPRE. Do cliente vem só a lista de índices
 * aprovados. Aceitar o plano montado lá seria aceitar `itens` arbitrários numa
 * rota que roda com o Admin SDK — ver o parágrafo das autorizações logo abaixo.
 *
 * ⚠️ NÃO recebe fileId do cliente, pela mesma razão de `api/drive/doc`: aceitar
 * um id arbitrário transformaria esta rota num proxy de leitura do Drive
 * Compartilhado inteiro, com a conta de serviço. O arquivo é resolvido a partir
 * dos `driveOutputs` da reunião.
 *
 * ⚠️ DUAS AUTORIZAÇÕES, E NENHUMA DELAS É OPCIONAL. Esta rota usa o Admin SDK,
 * e o Admin SDK IGNORA `firestore.rules` — aqui a checagem em TypeScript não é
 * a primeira barreira, é a única. É a lição que `check-demandas-boundary.mjs`
 * registra sobre `api/demandas/expurgar`, e é por isso que este arquivo entrou
 * na lista de alvos daquele guarda.
 *
 *   1. Ler a reunião: admin, dono do envio, ou gestor do setor DELA — a mesma
 *      de `api/drive/doc`.
 *   2. Escrever a ata: pertencer ao setor de DESTINO. As duas são necessárias
 *      porque elas são setores diferentes com frequência: a reunião das
 *      cantinas correu no setor B.I. e a ata dela pertence a Cantinas. Checar
 *      só a primeira deixaria qualquer gestor plantar ata em setor alheio.
 *
 * NO MODO MESCLAGEM o setor de destino NÃO vem do cliente: ele é lido da ata
 * alvo, e a autorização 2 é cobrada contra ele. Com `setor` vindo do corpo do
 * pedido, um `ataId` de outro setor passaria pela checagem carregando o nome do
 * setor de quem pediu — a porta exata que a autorização 2 existe para fechar.
 *
 * ESTA ROTA NÃO CRIA CARD, e nunca vai criar. Um card só nasce por decisão
 * humana em `api/demandas/decidir`.
 */
import { NextResponse } from "next/server";
import {
  HttpError,
  adminDb,
  driveToken,
  exportDocMarkdown,
  requireUser,
} from "@/lib/server/drive-server";
import {
  aplicarMesclagem,
  lerPontosImportantes,
  ligarCards,
  montarAtaDaReuniao,
  planejarMesclagem,
  type ReuniaoDaAta,
} from "@/lib/ata-de-reuniao-core";
import { normalizarAta, type DimensaoDaPauta } from "@/lib/ata-core";
// As tres regras desta rota moram num modulo puro, com teste — ver o cabecalho
// de `ata-gerar-core.ts`.
import { ehJaExiste, idDaAta, paraQuemPediu } from "@/lib/ata-gerar-core";

export const runtime = "nodejs";

/** O id do arquivo dentro de um link do Docs — igual ao de `api/drive/doc`. */
function idDoLink(link: string): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]{20,})/.exec(link || "");
  return m ? m[1] : null;
}

function limpo(v: unknown, teto: number): string {
  return String(v ?? "").trim().slice(0, teto);
}

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const meetingId = limpo(body.meetingId, 200);
    const ataId = limpo(body.ataId, 200);
    const preview = body.preview === true;
    /**
     * A ÚNICA COISA QUE VEM DO CLIENTE NO MODO MESCLAGEM.
     *
     * O plano inteiro é recomputado aqui dentro, do mesmo documento — ver
     * `mesclar`. Aceitar o plano montado no cliente seria aceitar `itens`
     * arbitrários numa rota que roda com o Admin SDK, e o Admin SDK IGNORA
     * `firestore.rules`: aqui a checagem em TypeScript não é a primeira
     * barreira, é a única. É a lição que o cabeçalho deste arquivo já registra.
     */
    const aprovados = Array.isArray(body.aprovados)
      ? (body.aprovados as unknown[]).filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n),
        )
      : null;

    if (!meetingId) throw new HttpError(400, "Reunião não informada.");

    const db = adminDb();
    const snap = await db.collection("meetings").doc(meetingId).get();
    if (!snap.exists) throw new HttpError(404, "Reunião não encontrada.");
    const m = snap.data()!;

    // ---- autorização 1: ler esta reunião ----
    const setorDaReuniao = (m.sector as string) ?? "";
    const dono = String(m.createdBy ?? "").toLowerCase() === caller.email;
    const podeLer =
      caller.role === "admin" ||
      dono ||
      (caller.role === "gestor" && caller.sectors.includes(setorDaReuniao));
    if (!podeLer) throw new HttpError(403, "Você não tem acesso a esta reunião.");

    /**
     * O SETOR DE DESTINO — e no modo mesclagem ele NÃO vem do cliente.
     *
     * Criar ata é escolher o setor: o áudio sobe pelo setor de quem gravou e o
     * assunto costuma pertencer a outro (a primeira ata desta tela é isso —
     * reunião do B.I., ata das Cantinas). Mesclar é diferente: o setor já está
     * decidido, ele é o da ata que vai receber. Derivá-lo do documento em vez de
     * confiar no corpo do pedido fecha a porta que a autorização 2 existe para
     * fechar — com `setor` vindo do cliente, um `ataId` de outro setor passaria
     * pela checagem carregando o nome do setor de quem pediu.
     */
    const ataSnap = ataId ? await db.collection("atas").doc(ataId).get() : null;
    if (ataId && !ataSnap?.exists) throw new HttpError(404, "Ata não encontrada.");
    const ata = ataSnap?.exists ? normalizarAta(ataSnap.id, ataSnap.data()) : null;
    if (ataId && !ata) {
      throw new HttpError(422, "Esta ata está num estado que não dá para ler.");
    }
    const setor = ata ? ata.setor : limpo(body.setor, 80);
    if (!setor) throw new HttpError(400, "Setor de destino não informado.");

    // ---- autorização 2: escrever no setor de destino ----
    if (caller.role !== "admin" && !caller.sectors.includes(setor)) {
      throw new HttpError(403, `Você não participa do setor "${setor}".`);
    }

    if (m.status !== "processado") {
      throw new HttpError(
        409,
        "Esta reunião ainda não foi processada. A ata sai do documento que o processamento gera.",
      );
    }

    /**
     * Idempotência em DOIS passos, e o segundo é o que fecha a corrida.
     *
     * A consulta sozinha era um check-then-add: dois pedidos simultâneos — duas
     * pessoas do setor, ou a mesma pessoa em duas abas — rodavam a leitura
     * antes de qualquer escrita, nenhum achava nada, e os dois gravavam.
     * Nasciam duas atas com o mesmo `meetingId` e o mesmo setor, mesmo título e
     * mesma data na lista; a partir dali as decisões da reunião se dividiam
     * entre as duas conforme quem tinha aberto qual, e nada na tela dizia que
     * havia duas.
     *
     * PASSO 1, a consulta, continua — e não por hábito: ela é a única coisa que
     * enxerga as atas gravadas ANTES desta versão, que têm id aleatório. Sem
     * ela, gerar de novo a ata de uma reunião antiga criaria uma segunda, e a
     * primeira — com as decisões já escritas dentro — ficaria órfã.
     *
     * PASSO 2 é o `create()` com id determinístico, logo abaixo. `create` falha
     * com ALREADY_EXISTS quando o documento já está lá, e essa falha é atômica
     * no servidor do Firestore: dos dois pedidos simultâneos, um grava e o
     * outro recebe a recusa e devolve o id do vencedor.
     *
     * O campo único da consulta segue de propósito: somar `setor` exigiria um
     * índice composto novo, e o filtro em memória custa nada — uma reunião gera
     * uma ata, duas no limite.
     *
     * NADA DISSO VALE NO MODO MESCLAGEM, e é por isso que ele está dentro do
     * `if`. A idempotência daqui protege contra criar a segunda ata da mesma
     * reunião; quem já disse em qual ata quer mesclar não está criando nada, e
     * uma ata que já tenha `meetingId` é precisamente o caso de puxar o áudio de
     * novo depois de mais alguém ter escrito na pauta. A idempotência de lá é de
     * outra natureza e está em `planejarMesclagem`: por construção, o plano da
     * segunda passada não acha nada para fazer.
     */
    if (!ata) {
      const jaExiste = await db
        .collection("atas")
        .where("meetingId", "==", meetingId)
        .get();
      const mesma = jaExiste.docs.find((d) => d.data().setor === setor);
      if (mesma) {
        return NextResponse.json({ id: mesma.id, jaExistia: true });
      }
    }

    // ---- o documento ----
    const outputs = Array.isArray(m.driveOutputs)
      ? (m.driveOutputs as { kind: string; name: string; link: string }[])
      : [];
    const alvo = outputs.find((o) => o.kind === "resumo");
    if (!alvo) {
      throw new HttpError(
        422,
        'Esta reunião não tem o documento "Pontos importantes", que é de onde a pauta sai.',
      );
    }
    const fileId = idDoLink(alvo.link);
    if (!fileId) {
      throw new HttpError(422, "O link deste documento não é um Google Doc.");
    }
    const markdown = await exportDocMarkdown(await driveToken(), fileId);

    // ---- a árvore do setor de destino, para classificar os assuntos ----
    const dimsSnap = await db
      .collection("dimensoes")
      .where("setor", "==", setor)
      .get();
    const dimensoes: DimensaoDaPauta[] = dimsSnap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        nome: String(x.nome ?? ""),
        ordem: Number(x.ordem ?? 0),
        subs: Array.isArray(x.subs)
          ? (x.subs as { id?: unknown; nome?: unknown }[]).map((s) => ({
              id: String(s.id ?? ""),
              nome: String(s.nome ?? ""),
            }))
          : [],
      };
    });

    const cards = await cardsDaReuniao(db, setor, meetingId);

    /**
     * ---- modo mesclagem: puxar o documento para uma ata que já tem pauta ----
     *
     * O CASO QUE FALTAVA, e que criava ata duplicada. A ata de uma reunião
     * semanal nasce ANTES do áudio ficar pronto: a equipe lança os assuntos que
     * quer discutir, e "Levar para próxima reunião" já deixou lá o que ficou
     * pendurado da semana passada. Depois o áudio processa. Sem este braço, o
     * único caminho era o de cima — que cria uma SEGUNDA ata da mesma reunião no
     * mesmo setor, mesma data, mesmo título na lista, uma com o que as pessoas
     * lançaram e outra com o que o áudio trouxe.
     *
     * `preview` NÃO ESCREVE NADA. É o que sustenta a tela de conferência: quem
     * conduz a reunião vê o que vai entrar, em que linha, e aprova. Sem ela, a
     * mesclagem pediria confiança cega num casamento de texto — e a ata é
     * registro, não rascunho.
     */
    if (ata) {
      const doc = lerPontosImportantes(markdown);

      if (preview || aprovados === null) {
        return NextResponse.json({
          id: ata.id,
          plano: planejarMesclagem({
            blocos: doc.blocos,
            itens: ata.itens,
            cards,
            dimensoes,
          }),
          citados: doc.citados,
        });
      }

      /**
       * A GRAVAÇÃO É EM TRANSAÇÃO, e o plano é recomputado DENTRO dela.
       *
       * Os itens moram num array dentro do documento, e a escrita é do array
       * inteiro (cabeçalho de `ata.ts`) — quem gravar por último vence. Entre a
       * conferência e o clique de aplicar cabe uma reunião inteira de alguém
       * escrevendo decisão na outra ponta, e sem a transação essa escrita seria
       * apagada por um plano montado sobre uma leitura velha.
       *
       * Recomputar o plano com os itens frescos também é o que mantém a régua de
       * ouro válida no instante da escrita: um campo que alguém acabou de
       * preencher deixa de estar vazio, e o documento não o sobrescreve. Os
       * índices aprovados continuam apontando para os mesmos blocos — eles vêm
       * do documento, que não mudou.
       */
      const ref = db.collection("atas").doc(ata.id);
      const resultado = await db.runTransaction(async (tx) => {
        const fresco = await tx.get(ref);
        if (!fresco.exists) throw new HttpError(404, "Ata não encontrada.");
        const agora = normalizarAta(fresco.id, fresco.data());
        if (!agora) {
          throw new HttpError(422, "Esta ata está num estado que não dá para ler.");
        }
        const plano = planejarMesclagem({
          blocos: doc.blocos,
          itens: agora.itens,
          cards,
          dimensoes,
        });
        const itens = aplicarMesclagem({
          itens: agora.itens,
          blocos: doc.blocos,
          plano,
          aprovados,
          dimensoes,
        });
        /**
         * `citados` VAI JUNTO, e é a única coisa do cabeçalho que vai.
         *
         * São os nomes que a gravação citou, e a ata feita à mão antes da reunião
         * não tem nenhum — é informação que só o documento tem. União e nunca
         * substituição: quem já estava lá foi posto por alguém.
         *
         * Horário, local e facilitador NÃO vão, pelo mesmo motivo escrito em
         * `montarAtaDaReuniao`: o documento fala deles em prosa ("início por
         * volta de 17h33"), e ler prosa como se fosse campo é o jeito mais
         * rápido de encher uma ata de dado errado com cara de dado certo. Título
         * e data também não: numa ata que já existe, os dois foram digitados por
         * quem esteve lá.
         */
        const citados = [...new Set([...agora.citados, ...doc.citados])];
        tx.update(ref, { itens, citados, meetingId });
        return { entraram: itens.length - agora.itens.length, citados: citados.length };
      });

      return NextResponse.json({ id: ata.id, mesclou: true, ...resultado });
    }

    const reuniao: ReuniaoDaAta = {
      id: meetingId,
      title: String(m.title ?? ""),
      date: String(m.date ?? ""),
      participants: Array.isArray(m.participants)
        ? (m.participants as unknown[]).filter(
            (p): p is string => typeof p === "string" && !!p,
          )
        : [],
      createdBy: String(m.createdBy ?? ""),
    };

    const nova = montarAtaDaReuniao({ markdown, reuniao, setor, dimensoes });
    nova.itens = ligarCards(nova.itens, cards);

    const ref = db.collection("atas").doc(idDaAta(meetingId, setor));
    try {
      await ref.create({
        ...nova,
        createdAt: new Date(),
        createdBy: caller.email,
      });
    } catch (e) {
      // ALREADY_EXISTS (código 6 do gRPC) é o outro pedido tendo chegado
      // primeiro — o desfecho CERTO da corrida, e não uma falha. Devolvemos o
      // id, que é o mesmo, com a mesma resposta de quem achou na consulta.
      if (ehJaExiste(e)) {
        return NextResponse.json({ id: ref.id, jaExistia: true });
      }
      throw e;
    }

    return NextResponse.json({ id: ref.id, jaExistia: false });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    /**
     * O LOG LEVA O ERRO INTEIRO; a resposta leva uma frase em português.
     *
     * Eram duas coisas erradas de uma vez. Para fora, `e.message` ia cru: quando
     * a conta de serviço perde acesso ao Doc, `driveFetch` lança
     * `Drive API 404: {json do Google}` — e o modal imprimia esse JSON, em
     * inglês, com id de arquivo, para quem só queria gerar a ata.
     *
     * Para dentro, o `console.error` só rodava em `status >= 500` e logava a
     * MENSAGEM, jogando o stack fora. É o defeito que AGENTS.md §5 registra
     * sobre as 13 rotas de `api/`: elas capturam o próprio erro, devolvem JSON,
     * nada propaga para o Next, e o que sobra no log não diz onde quebrou.
     * Agora todo status >= 400 loga o objeto inteiro.
     */
    console.error("ata/gerar:", e);
    return NextResponse.json(
      {
        error: paraQuemPediu(
          e instanceof HttpError ? { status: e.status, message: e.message } : null,
        ),
      },
      { status },
    );
  }
}

/**
 * Os cards do setor de destino que esta mesma reunião já produziu, com o
 * assunto que os originou.
 *
 * O caminho é card → `propostaId` → proposta → `assunto`, e o assunto é, por
 * contrato do sidecar, o cabeçalho do bloco em "Pontos importantes". É isso que
 * torna o casamento exato em vez de heurístico.
 *
 * `meetingIds` é filtrado em memória em vez de por `array-contains`: somado ao
 * `sector` daria um índice composto novo, e um setor tem dezenas de cards.
 */
async function cardsDaReuniao(
  db: FirebaseFirestore.Firestore,
  setor: string,
  meetingId: string,
): Promise<{ id: string; assunto: string }[]> {
  const cards = await db.collection("cards").where("sector", "==", setor).get();
  const daReuniao = cards.docs.filter((d) => {
    const c = d.data();
    if (c.deletedAt) return false;
    const ids = Array.isArray(c.meetingIds) ? (c.meetingIds as unknown[]) : [];
    return ids.includes(meetingId) && typeof c.propostaId === "string";
  });
  if (!daReuniao.length) return [];

  const propostas = await Promise.all(
    daReuniao.map((d) =>
      db.collection("demandPropostas").doc(String(d.data().propostaId)).get(),
    ),
  );
  return daReuniao
    .map((d, i) => ({
      id: d.id,
      assunto: String(propostas[i].data()?.assunto ?? ""),
    }))
    .filter((x) => !!x.assunto);
}
