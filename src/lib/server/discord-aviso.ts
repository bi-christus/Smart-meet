/**
 * Publicar no Discord um evento que já está gravado — do lado do servidor.
 *
 * ESTE ARQUIVO NASCEU DE UM FURO, e a nota fica para quem for mexer. O gancho
 * do aviso entrou nas cinco escritas de `kanban.ts`, que são as do NAVEGADOR.
 * Mas duas demandas nascem aqui dentro, pelo Admin SDK, sem passar por lá: a
 * proposta de reunião aceita em `api/demandas/decidir`, e os cards de
 * manutenção que o cron abre em `api/recorrencias/gerar`. Nas duas o card
 * entrava no quadro e o canal ficava mudo.
 *
 * A regra que sai disso: quem cria card ou evento pelo Admin SDK chama daqui.
 * Não existe caminho HTTP para o servidor falar consigo mesmo — ele já está
 * dentro, e um `fetch` na própria rota só acrescentaria um salto de rede e a
 * necessidade de forjar um token.
 *
 * A rota `api/discord/avisar` virou a casca de autenticação em volta de
 * `publicarEvento`: ela confere quem chama e delega. Uma implementação só.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { enviarAviso } from "./discord";
import {
  canalDoEvento,
  deveAvisar,
  montarAviso,
  montarResumoDeRecorrencias,
  resolverWebhook,
  type Canal,
  type CardDoAviso,
  type EventoDoAviso,
} from "@/lib/discord-core";
import { rotuloPrioridade, rotuloTipo } from "@/lib/demanda-rotulos";
import type { Acao, Mudanca } from "@/lib/historico-core";

/** Só o que o aviso lê do card. O resto do documento não interessa aqui. */
type CardDoc = {
  sector?: string;
  title?: string;
  columnId?: string;
  assignee?: string | null;
  requester?: string | null;
  requesterSector?: string | null;
  due?: string | null;
  priority?: string;
  type?: string;
};

type EventoDoc = {
  autor?: string;
  em?: { toMillis?: () => number } | null;
  acao?: Acao;
  mudancas?: Mudanca[];
  discordAt?: unknown;
};

export type Resultado = { enviado: boolean; motivo?: string };

/** O evento já virou mensagem. Erro de controle, não de falha. */
class JaAvisado extends Error {}

/** Nome de gente a partir do e-mail, com o e-mail como plano B. */
async function pessoas(
  db: Firestore,
  emails: string[],
): Promise<Map<string, { name: string; discordId: string | null }>> {
  const unicos = [
    ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ];
  const out = new Map<string, { name: string; discordId: string | null }>();
  if (unicos.length === 0) return out;
  const docs = await db.getAll(
    ...unicos.map((e) => db.collection("users").doc(e)),
  );
  docs.forEach((d, i) => {
    const dados = d.data() as { name?: string; discordId?: string } | undefined;
    out.set(unicos[i], {
      name: dados?.name?.trim() || unicos[i],
      // Ausente enquanto a pessoa não vinculou a conta — e o aviso sai igual,
      // só sem a menção. Quem preenche é `api/discord/interactions`.
      discordId: dados?.discordId?.trim() || null,
    });
  });
  return out;
}

/**
 * Para onde ESTE assunto avisa, lendo o ambiente. `null` = ninguém configurou.
 *
 * O canal entra por parâmetro, e não é deduzido aqui, porque quem sabe o
 * assunto é quem chama: `publicarEvento` traduz a ação em canal, o resumo das
 * recorrências vai sempre para `alertas`, e o resumo do dia para `resumo`.
 * Deduzir aqui obrigaria esta função a conhecer os três casos.
 */
export function webhookDe(sector: string, canal: Canal): string | null {
  return resolverWebhook({
    canal,
    setor: sector,
    padrao: process.env.DISCORD_WEBHOOK_URL,
    porSetor: process.env.DISCORD_WEBHOOK_URLS,
    porCanal: process.env.DISCORD_WEBHOOK_CANAIS,
  });
}

/**
 * A base do link que abre o card.
 *
 * Nunca da origem da requisição: o cron chama a URL interna do deploy, e o link
 * levaria a um endereço que não existe para quem clica. Mesma decisão de
 * `src/lib/server/notify.ts`.
 */
export function appUrl(): string | null {
  return (process.env.APP_URL || "").trim().replace(/\/+$/, "") || null;
}

/**
 * Monta e publica o aviso de UM evento. Idempotente.
 *
 * A MARCA VEM ANTES DO ENVIO, e é isso que impede a mensagem duplicada. Duas
 * chamadas para o mesmo evento — um retry, um duplo clique — chegam juntas e as
 * duas leem `discordAt` vazio; só a transação decide quem ganha. Marcar depois
 * do envio deixaria a janela aberta exatamente durante a chamada de rede, que é
 * o pedaço lento.
 *
 * O preço é que a falha de envio precisa DESFAZER a marca: evento registrado
 * como avisado sem nunca ter sido perderia para sempre o reenvio, que é a única
 * correção possível.
 */
export async function publicarEvento(
  db: Firestore,
  cardId: string,
  eventoId: string,
): Promise<Resultado> {
  const cardRef = db.collection("cards").doc(cardId);
  const evRef = cardRef.collection("historico").doc(eventoId);
  const [cardSnap, evSnap] = await db.getAll(cardRef, evRef);

  if (!cardSnap.exists || !evSnap.exists) {
    return { enviado: false, motivo: "sem-card-ou-evento" };
  }

  const card = cardSnap.data() as CardDoc;
  const ev = evSnap.data() as EventoDoc;
  const sector = (card.sector ?? "").trim();

  if (ev.discordAt) return { enviado: false, motivo: "ja-avisado" };

  const acao = ev.acao ?? "editada";
  const mudancas = ev.mudancas ?? [];
  if (!deveAvisar(acao, mudancas)) {
    return { enviado: false, motivo: "sem-noticia" };
  }

  const url = webhookDe(sector, canalDoEvento(acao));
  // Sem webhook configurado o app funciona igual — é o estado de qualquer
  // Preview antes de alguém colar a variável. Não é erro.
  if (!url) return { enviado: false, motivo: "sem-webhook" };

  const [quem, colsSnap] = await Promise.all([
    pessoas(db, [ev.autor ?? "", card.assignee ?? ""]),
    db.collection("columns").where("sector", "==", sector).get(),
  ]);
  const etapa =
    colsSnap.docs
      .map((d) => d.data() as { colId?: string; title?: string })
      .find((c) => c.colId === card.columnId)?.title ?? null;

  const autorEmail = (ev.autor ?? "").trim().toLowerCase();
  const respEmail = (card.assignee ?? "").trim().toLowerCase();
  const resp = respEmail ? quem.get(respEmail) : null;

  const cardDoAviso: CardDoAviso = {
    id: cardId,
    sector,
    title: card.title ?? "",
    etapa,
    responsavel: resp?.name ?? null,
    responsavelDiscordId: resp?.discordId ?? null,
    solicitante: card.requester ?? null,
    setorSolicitante: card.requesterSector ?? null,
    prazo: card.due ?? null,
    prioridade: card.priority ?? null,
    tipo: card.type ?? null,
  };

  const eventoDoAviso: EventoDoAviso = {
    id: eventoId,
    autor: quem.get(autorEmail)?.name ?? autorEmail,
    // `em` é `serverTimestamp()` e pode estar nulo por alguns milissegundos —
    // mesmo caso que `carregarHistorico` trata. A hora atual é a aproximação
    // certa: o evento acabou de ser gravado.
    em: ev.em?.toMillis?.() ?? Date.now(),
    acao,
    mudancas,
  };

  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(evRef);
      if (atual.data()?.discordAt) throw new JaAvisado();
      tx.update(evRef, { discordAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    if (e instanceof JaAvisado) return { enviado: false, motivo: "ja-avisado" };
    throw e;
  }

  try {
    await enviarAviso(
      url,
      montarAviso({
        card: cardDoAviso,
        evento: eventoDoAviso,
        appUrl: appUrl(),
        rotulo: { prioridade: rotuloPrioridade, tipo: rotuloTipo },
      }),
    );
  } catch (e) {
    await evRef.update({ discordAt: FieldValue.delete() }).catch(() => {});
    throw e;
  }

  return { enviado: true };
}

/**
 * Publica sem nunca lançar, para quem chama de dentro de outra operação.
 *
 * Aceitar uma proposta e abrir os cards do dia são operações que JÁ TERMINARAM
 * quando o aviso é tentado. Um webhook fora do ar não pode transformar "aceitei
 * a demanda" em erro na tela de quem aceitou, nem derrubar a rodada do cron
 * depois de os cards já estarem no quadro.
 *
 * É o mesmo princípio do fire-and-forget do navegador, mas COM `await`: a
 * função serverless morre no instante em que devolve a resposta, e uma promessa
 * solta morreria junto — sem ter enviado nada, e sem ninguém saber.
 */
export async function publicarEventoSemQuebrar(
  db: Firestore,
  cardId: string,
  eventoId: string,
): Promise<void> {
  try {
    await publicarEvento(db, cardId, eventoId);
  } catch (e) {
    console.warn("discord: aviso não saiu para", cardId, e);
  }
}

/**
 * UMA mensagem para a rodada inteira do cron de recorrências.
 *
 * E não um aviso por card, que é a escolha óbvia e a errada: o cron pode abrir
 * dezenas de cards às 06:10, e vinte mensagens seguidas no canal, todas iguais
 * menos o título, é o jeito de fazer alguém silenciar o canal. Canal silenciado
 * apaga também os avisos que importam — preço alto demais por uma rotina
 * automática que ninguém precisa acompanhar card a card.
 *
 * Sem marca de idempotência aqui, ao contrário de `publicarEvento`: a chamada
 * acontece uma vez por rodada, e a rodada já é protegida contra repetição pela
 * transação que cria a ocorrência (um card por data prevista). Não há evento
 * único a marcar.
 */
export async function publicarResumoDeRecorrencias(args: {
  sector: string;
  cards: { id: string; title: string; responsavel?: string | null }[];
}): Promise<Resultado> {
  const { sector, cards } = args;
  if (cards.length === 0) return { enviado: false, motivo: "nada-a-dizer" };

  // `alertas`, e não `novas`: a rodada do cron não é notícia de demanda
  // nascendo — é rotina automática, e o canal de entrada existe para o trabalho
  // que alguém pediu. Misturar as duas faz `#demandas-novas` amanhecer com
  // quinze linhas de manutenção todo dia.
  const url = webhookDe(sector, "alertas");
  if (!url) return { enviado: false, motivo: "sem-webhook" };

  // A montagem é regra e mora no módulo puro, com teste; o que sobra para cá é
  // resolver o destino e mandar.
  await enviarAviso(
    url,
    montarResumoDeRecorrencias({ sector, cards, appUrl: appUrl() }),
  );
  return { enviado: true };
}
