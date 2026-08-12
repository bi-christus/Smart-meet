/**
 * O histórico da demanda no banco: `cards/{id}/historico`.
 *
 * POR QUE SUBCOLEÇÃO, e não um array no card. O quadro assina TODOS os cards do
 * setor em tempo real. Um array de eventos dentro do card faria cada snapshot
 * carregar o histórico inteiro de cada demanda — a tela pagaria, em toda
 * atualização, por um dado que ninguém está olhando. Na subcoleção, o histórico
 * só é lido quando alguém clica para ver.
 *
 * ATÉ ONDE ISTO É AUDITORIA. Quem escreve aqui é o navegador, não o servidor —
 * diferente de `/logs`, que o cliente nem enxerga. As regras fecham o que dá
 * para fechar: não se grava em nome de outra pessoa (`autor` tem de ser o do
 * token), não se escolhe a data (`em` tem de ser a hora do servidor), e nada é
 * editado depois de gravado. O que sobra é que alguém com acesso ao setor pode
 * criar um evento descrevendo algo que não fez — e essa mesma pessoa poderia,
 * mais simples, apenas fazer. Isto é a trilha de trabalho do quadro, honesta
 * sobre a sua origem; não é prova pericial.
 *
 * A escrita anda SEMPRE no mesmo lote da escrita do card (ver `kanban.ts`): ou
 * a mudança e o registro dela acontecem juntos, ou nenhum dos dois acontece.
 * Histórico que perde eventos em silêncio é pior do que não ter histórico,
 * porque quem lê acredita.
 */
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Acao, Evento, Mudanca } from "./historico-core";

export type { Acao, Evento, Mudanca };

/**
 * Teto de eventos lidos de uma vez.
 *
 * O bastante para cobrir a vida inteira de quase toda demanda, e um limite para
 * a que virar exceção — abrir um card não pode custar uma leitura sem fim.
 */
export const LIMITE_HISTORICO = 100;

/** Teto de mudanças por evento. Há 12 campos rastreados; isto é a folga. */
const MAX_MUDANCAS = 16;

/** Quem está fazendo, e em que quadro. */
export type ContextoHistorico = {
  /** E-mail do usuário logado — as regras exigem que bata com o token. */
  autor: string;
  /** Setor do card. Denormalizado: é o que a regra de criação consegue checar. */
  sector: string;
};

function refHistorico(cardId: string) {
  return collection(db, "cards", cardId, "historico");
}

/**
 * Põe o evento no lote que já está gravando o card.
 *
 * Não commita: quem chama é dono do lote e sabe o que mais entra nele. Devolve
 * `false` quando não havia o que registrar, para quem chama não incrementar o
 * contador do card à toa.
 */
export function anexarEvento(
  batch: WriteBatch,
  cardId: string,
  ctx: ContextoHistorico,
  acao: Acao,
  mudancas: Mudanca[],
): boolean {
  if (mudancas.length === 0 && acao !== "criada") return false;
  batch.set(doc(refHistorico(cardId)), {
    sector: ctx.sector,
    autor: ctx.autor,
    // `serverTimestamp` e não `Date.now()`: o relógio do navegador é do usuário,
    // e a regra do Firestore recusa qualquer data que não seja a do servidor.
    // Sem isso, "quando" seria só uma sugestão de quem escreveu.
    em: serverTimestamp(),
    acao,
    mudancas: mudancas.slice(0, MAX_MUDANCAS),
  });
  return true;
}

/**
 * Os eventos do card, do mais recente para o mais antigo.
 *
 * Leitura única, sem `onSnapshot`: evento gravado nunca muda, então não há o que
 * escutar. Quem abre o painel de novo relê.
 *
 * Ignora o evento cujo `em` ainda não voltou do servidor — acontece por alguns
 * milissegundos no cache local de quem acabou de salvar, e uma linha "há 56
 * anos" no topo da timeline é pior do que uma linha a menos.
 */
export async function carregarHistorico(
  cardId: string,
  sector: string,
): Promise<Evento[]> {
  const snap = await getDocs(
    query(
      refHistorico(cardId),
      // O filtro por setor não é refinamento de resultado — todo evento deste
      // card tem o mesmo setor. Ele existe porque a REGRA de leitura é escopada
      // por setor, e uma consulta do Firestore só passa numa regra dessas se
      // carregar a restrição correspondente. Mesmo contrato de /cards.
      where("sector", "==", sector),
      orderBy("em", "desc"),
      limit(LIMITE_HISTORICO),
    ),
  );
  return snap.docs
    .map((d) => {
      const dados = d.data() as {
        autor?: string;
        em?: Timestamp | null;
        acao?: Acao;
        mudancas?: Mudanca[];
      };
      return {
        id: d.id,
        autor: dados.autor ?? "",
        em: dados.em?.toMillis?.() ?? 0,
        acao: dados.acao ?? "editada",
        mudancas: dados.mudancas ?? [],
      };
    })
    .filter((e) => e.em > 0);
}

/**
 * Apaga o histórico de um card.
 *
 * O Firestore NÃO apaga subcoleção junto com o documento pai: sem esta varrida,
 * excluir a demanda deixaria os eventos no banco para sempre, sem nada que
 * chegue até eles.
 *
 * Roda ANTES de apagar o card, e não depois: a regra de leitura do histórico
 * pergunta o setor ao card pai, e com o pai já apagado a varrida seria negada —
 * o lixo ficaria exatamente onde não deveria. As duas exclusões exigem gestor,
 * então ou as duas podem acontecer, ou nenhuma começa.
 */
export async function apagarHistorico(
  cardId: string,
  sector: string,
): Promise<void> {
  // Em páginas de 400 para caber no teto de 500 operações de um lote — uma
  // demanda antiga e movimentada passa de 100 eventos com facilidade.
  for (;;) {
    const snap = await getDocs(
      // `where` pelo mesmo motivo de `carregarHistorico`: a regra é escopada.
      query(refHistorico(cardId), where("sector", "==", sector), limit(400)),
    );
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
}
