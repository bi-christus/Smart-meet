/**
 * Apaga de vez uma demanda que já está na lixeira — o card E o histórico dele.
 *
 * Por que isto é servidor e não um `deleteDoc` no navegador: o histórico mora
 * numa subcoleção (`cards/{id}/historico`), e o Firestore não apaga subcoleção
 * junto com o pai. Do cliente, apagar de verdade significa varrer os eventos
 * num `writeBatch` — e as regras do Firestore limitam ACESSOS A DOCUMENTO por
 * avaliação: 10 numa operação isolada, 20 no lote inteiro. A nossa regra de
 * `/cards` custa 8 acessos por operação para um admin comum e 14 para um
 * gestor, porque `isAdmin()` é perguntado duas vezes (dentro de
 * `isGestorOrAdmin()` e de novo dentro de `canSeeSector()`). É por isso que
 * hoje admin comum não consegue excluir nada: o lote estoura o teto e volta
 * "permission denied" (Issue #59).
 *
 * As três saídas foram medidas antes de escolher esta:
 *  - lotes menores: caberiam 2 documentos por lote (20 ÷ 8), então um histórico
 *    de 60 eventos viraria 30 commits de rede — lento e capaz de parar no meio;
 *  - deletes individuais: 8 < 10 salva o admin e deixa o GESTOR de fora
 *    (14 > 10), ou seja, conserta para quem reclamou e mantém quebrado para
 *    quem mais usa;
 *  - servidor com Admin SDK: o Admin SDK ignora `firestore.rules`, então o teto
 *    simplesmente não existe neste caminho.
 *
 * Ficou a terceira, pelo mesmo motivo que `api/demandas/decidir` e
 * `api/recorrencias/gerar` já são rotas: operação sobre muitos documentos não é
 * trabalho de navegador.
 *
 * O preço dessa escolha, dito na cara: como o Admin SDK passa por cima das
 * regras, a autorização desta rota é a ÚNICA barreira que existe. Não há
 * segunda linha em CEL para pegar um descuido daqui. Por isso
 * `scripts/check-demandas-boundary.mjs` passou a EXIGIR — e não só proibir —
 * que este arquivo continue chamando `requireUser`, checando papel, checando
 * setor e olhando `deletedAt`.
 */
import { NextResponse } from "next/server";

import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
// Módulo puro, sem SDK: é a MESMA definição de "está na lixeira" que o quadro
// usa. Reescrevê-la aqui criaria duas verdades sobre o que é uma demanda
// excluída, e no dia em que uma mudasse, esta rota apagaria — de vez — algo que
// a tela ainda considera vivo. É o tipo de divergência que não fica vermelha.
import { naLixeira, ordenarLixeira } from "@/lib/lixeira-core";

export const runtime = "nodejs";
// O mesmo teto que o relatório usa. É o orçamento de tempo em que o teto de
// demandas por chamada, logo abaixo, foi calculado para caber.
export const maxDuration = 60;

/**
 * Quantas demandas um "esvaziar a lixeira" apaga por requisição.
 *
 * Cada expurgo é uma consulta à subcoleção `historico` mais as exclusões que
 * ela devolver — na prática algumas idas e voltas de rede por demanda, não uma.
 * Com orçamento de 60 s e a conta pessimista de ~1 s por demanda, 50 deixa ~10 s
 * de folga para o cold start, a leitura da lixeira e os dois registros em /logs.
 *
 * O número é conservador de propósito: estourar o tempo da função no meio de
 * uma operação irreversível é o pior desfecho possível aqui — parte apagada,
 * resposta nenhuma, e quem clicou sem saber o que aconteceu. Sobrar trabalho é
 * barato: a resposta devolve `restantes`, e a tela pede de novo.
 */
const TETO_POR_CHAMADA = 50;

type Corpo = { sector?: string; id?: string };

function limpo(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** O que esta rota precisa saber de um card para decidir e para registrar. */
type Alvo = { id: string; title: string; deletedAt?: number | null };

/** Lê do documento só o que o expurgo usa, já com os textos limitados. */
function alvoDe(id: string, dados: FirebaseFirestore.DocumentData): Alvo {
  return {
    id,
    title: limpo(dados.title, 120),
    deletedAt: dados.deletedAt as number | null | undefined,
  };
}

export async function POST(req: Request) {
  try {
    const caller = await requireUser(req);

    // Papel antes de qualquer leitura: um operador não precisa nem descobrir se
    // o setor que ele mandou existe.
    const podeExpurgar = caller.role === "gestor" || caller.role === "admin";
    if (!podeExpurgar) {
      throw new HttpError(403, "Apagar de vez é ação de gestor ou administrador.");
    }

    const body = (await req.json().catch(() => ({}))) as Corpo;
    const sector = limpo(body.sector, 80);
    if (!sector) throw new HttpError(400, "Setor não informado.");
    if (body.id !== undefined && typeof body.id !== "string") {
      throw new HttpError(400, "Demanda inválida.");
    }
    const id = limpo(body.id, 200);

    // O escopo real: admin enxerga todos os setores, gestor só os dele. Sem
    // isto, o gestor de um setor esvaziaria a lixeira de qualquer outro.
    if (caller.role !== "admin" && !caller.sectors.includes(sector)) {
      throw new HttpError(403, "Você não participa deste setor.");
    }

    const db = adminDb();
    const cards = db.collection("cards");

    /** O que vai ser apagado nesta chamada, e quanto havia para apagar. */
    let alvos: Alvo[];
    let naLata: number;

    if (id) {
      const snap = await cards.doc(id).get();
      const dados = snap.exists ? snap.data() : undefined;

      // 404, e não 403, quando o setor do card não bate com o do corpo: quem
      // chegou até aqui já provou ser gestor/admin do setor que pediu, então a
      // única informação que um 403 acrescentaria é "este id existe em ALGUM
      // outro setor" — um oráculo de existência de graça. A mensagem é a mesma
      // de card inexistente de propósito.
      if (!dados || dados.sector !== sector) {
        throw new HttpError(404, "Demanda não encontrada na lixeira deste setor.");
      }

      const alvo = alvoDe(snap.id, dados);
      // A trava que separa esta rota de uma arma apontada para o quadro: só
      // apaga o que alguém JÁ mandou para a lixeira, por decisão consciente e
      // reversível. Sem ela, um id vindo do cliente apagaria demanda viva.
      if (!naLixeira(alvo)) {
        throw new HttpError(
          409,
          "Esta demanda não está na lixeira. Exclua-a antes de apagar de vez.",
        );
      }

      alvos = [alvo];
      naLata = 1;
    } else {
      // Consulta só por setor e filtro de `deletedAt` em memória, pelo mesmo
      // motivo que o quadro faz assim: consulta sobre um campo não devolve os
      // documentos que NÃO TÊM o campo, e todo card anterior à lixeira está
      // nessa situação. Um `where` aqui também exigiria índice composto para
      // ganhar nada — a leitura por setor é a mesma que o relatório já faz.
      const snap = await cards.where("sector", "==", sector).get();
      // A MESMA ordem em que o painel da lixeira mostra as demandas (exclusão
      // mais recente primeiro). Quando o teto por chamada corta a lista, o que
      // ficou de fora é o fim do que a pessoa está vendo, não um sorteio.
      const excluidas = ordenarLixeira(
        snap.docs.map((d) => alvoDe(d.id, d.data())).filter(naLixeira),
      );

      naLata = excluidas.length;
      if (naLata === 0) {
        return NextResponse.json({ ok: true, apagados: 0, restantes: 0 });
      }
      alvos = excluidas.slice(0, TETO_POR_CHAMADA);
    }

    /**
     * O registro é aberto ANTES de apagar, e fechado depois.
     *
     * A regra da casa é escrita e registro no mesmo lote; aqui não há lote que
     * caiba os dois — `recursiveDelete` usa um `BulkWriter`, não uma transação.
     * Então o registro se parte em dois, e a metade que importa vai na frente:
     * se a função morrer no meio do expurgo, /logs ainda diz quem pediu, de
     * qual setor e quais demandas — com o título, que depois de apagado não
     * existe em lugar nenhum. Registrar só no fim perderia exatamente o caso em
     * que o registro é a única coisa que sobra.
     */
    const logRef = db.collection("logs").doc();
    await logRef.create({
      tipo: id ? "demandas.expurgada" : "demandas.lixeira-esvaziada",
      sector,
      por: caller.email,
      em: new Date(),
      demandas: alvos,
      pedidos: alvos.length,
      totalNaLixeira: naLata,
      status: "iniciado",
    });

    // Uma demanda por vez: `recursiveDelete` já paraleliza os deletes por
    // dentro (BulkWriter), e disparar vários em paralelo só adiantaria o
    // estouro de cota sem encurtar o pior caso.
    let apagados = 0;
    for (const alvo of alvos) {
      try {
        await db.recursiveDelete(cards.doc(alvo.id));
        apagados++;
      } catch (e) {
        // Uma demanda que resiste não pode levar as outras junto: o que falhou
        // continua na lixeira e volta na próxima chamada, contado em `restantes`.
        console.error("demandas/expurgar: falha ao apagar", alvo.id, e);
      }
    }

    const restantes = Math.max(0, naLata - apagados);
    await logRef
      .update({
        status: "concluido",
        apagados,
        restantes,
        terminadoEm: new Date(),
      })
      .catch((e) => {
        // O expurgo já aconteceu; o fechamento do registro é o que falhou. Vale
        // o aviso no log da função, não uma resposta de erro para quem pediu.
        console.error("demandas/expurgar: falha ao fechar o registro", e);
      });

    if (apagados === 0) {
      throw new HttpError(
        500,
        "Não foi possível apagar agora. Tente de novo em instantes.",
      );
    }

    return NextResponse.json({ ok: true, apagados, restantes });
  } catch (e) {
    // Só mensagem de `HttpError` abaixo de 500 atravessa para a tela. As outras
    // rotas devolvem `e.message` cru; aqui isso mandaria para o navegador o
    // texto de erro do Firestore ou o nome da variável de ambiente que falta.
    // Quem pediu precisa saber o que fazer, não como o servidor é por dentro.
    const status = e instanceof HttpError ? e.status : 500;
    const paraTela =
      e instanceof HttpError && e.status < 500
        ? e.message
        : "Não foi possível apagar a demanda agora. Tente de novo em instantes.";
    if (status >= 500) {
      console.error("demandas/expurgar:", e instanceof Error ? e.message : e);
    }
    return NextResponse.json({ error: paraTela }, { status });
  }
}
