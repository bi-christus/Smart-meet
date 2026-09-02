/**
 * As três regras da rota que monta a ata — sem SDK, para poderem ser testadas.
 *
 * Módulo puro (AGENTS.md §4): `api/ata/gerar/route.ts` importa daqui e não tem
 * mais nenhuma decisão dentro dela. As três respondem perguntas que só se
 * descobre erradas em produção, e nenhuma delas quebra teste, tipo ou tela
 * quando se estraga:
 *
 *   1. Qual é o id da ata desta reunião neste setor? (idempotência)
 *   2. Este erro do Firestore é "o outro pedido chegou primeiro"?
 *   3. O que a pessoa lê quando dá errado?
 *
 * A terceira é a que mais importa e a menos óbvia: sem ela, o corpo cru da
 * resposta do Google — em inglês, com id de arquivo dentro — ia direto para o
 * modal de quem só queria gerar a ata.
 */

import { createHash } from "node:crypto";

/**
 * O id da ata, derivado de `meetingId` + setor.
 *
 * Determinístico de propósito: é ele que transforma "conferir se já existe" em
 * "tentar criar e deixar o banco recusar". Sem isso a idempotência era um
 * check-then-add, e dois cliques simultâneos criavam duas atas da mesma
 * reunião — com as decisões dividindo-se entre elas conforme quem abriu qual.
 *
 * HASH, e não os dois valores concatenados: o nome do setor é texto livre.
 * "B.I." tem ponto, o próximo pode ter barra, e barra não pode aparecer em id
 * de documento do Firestore. SHA-256 truncado em 32 hexadecimais dá 128 bits
 * para um par que na prática tem algumas centenas de valores — colisão aqui é
 * impossível de observar —, e o id curto continua legível no console do
 * Firebase.
 */
export function idDaAta(meetingId: string, setor: string): string {
  return createHash("sha256")
    .update(`${meetingId}|${setor}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * O `create()` recusado porque o documento já estava lá.
 *
 * Três formas da mesma resposta, porque o Admin SDK não promete uma só: o
 * código numérico do gRPC (6), o nome em kebab que o SDK do cliente usa, e a
 * mensagem em texto. Reconhecer só uma delas faria a corrida — o caso que este
 * arquivo existe para tratar — virar erro 500 na cara de quem clicou.
 */
export function ehJaExiste(e: unknown): boolean {
  const codigo = (e as { code?: unknown })?.code;
  if (codigo === 6 || codigo === "already-exists") return true;
  return /already exists/i.test(String((e as { message?: unknown })?.message ?? ""));
}

/**
 * O que a pessoa lê no modal — nunca o que o Google respondeu.
 *
 * As mensagens de erro desta rota são escritas em português e falam da ata;
 * essas passam inteiras. A exceção é a que vem de dentro do `driveFetch`, que
 * carrega o corpo cru da resposta do Drive (`Drive API 404: {…json…}`) e é a
 * única coisa ali que alguém de fora não deveria ver — em inglês, com id de
 * arquivo, para quem só queria gerar a ata.
 *
 * Recebe `status` e `message` soltos, e não o erro: `HttpError` mora em
 * `drive-server.ts`, que carrega o Admin SDK junto e não pode ser importado por
 * um módulo puro.
 */
export function paraQuemPediu(erro: {
  status: number;
  message: string;
} | null): string {
  if (!erro) return "Não foi possível gerar a ata.";
  if (!/^Drive API/.test(erro.message)) return erro.message;
  return erro.status === 404
    ? "O documento desta reunião não está mais acessível no Drive. Ele pode ter sido movido para a lixeira ou deixado de ser compartilhado com o sistema."
    : "Não foi possível ler o documento desta reunião no Drive. Tente de novo em alguns minutos.";
}
