/**
 * O disparo do aviso no Discord, do lado do navegador.
 *
 * POR QUE PASSA PELO SERVIDOR e não chama o webhook direto: a URL do webhook é
 * uma credencial. Quem a tem publica no canal em nome do Smart Meet, para
 * sempre, sem passar por login nenhum. Se ela viesse por `NEXT_PUBLIC_*`, ela
 * estaria no bundle de todo mundo — inclusive de quem só abriu a página.
 *
 * POR QUE SÓ DOIS IDS VÃO NO CORPO: título, setor, autor e mudanças a rota relê
 * do banco. É o mesmo princípio de `api/demandas/decidir` — o que o cliente
 * manda é sugestão, e aqui nem isso: são duas chaves de busca. Sem isso, quem
 * abrisse o console publicaria no canal do setor um aviso dizendo o que quisesse,
 * assinado como o Smart Meet.
 *
 * POR QUE FIRE-AND-FORGET: a demanda JÁ FOI GRAVADA quando esta função é
 * chamada. Esperar o Discord aqui faria o botão Salvar ficar rodando por causa
 * de uma mensagem, e um Discord fora do ar transformaria "salvar demanda" em
 * "não consigo salvar demanda". O aviso é consequência do trabalho, não parte
 * dele — e quando ele falha, a única coisa certa a fazer é seguir.
 */
import { auth } from "./firebase";

/**
 * Avisa o Discord sobre um evento que ACABOU de ser gravado.
 *
 * Nunca lança. Quem chama são as escritas de `kanban.ts`, e nenhuma delas pode
 * ganhar um caminho de erro novo por causa disto.
 */
export function avisarDiscord(cardId: string, eventoId: string | null): void {
  if (!eventoId) return;
  void (async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      await fetch("/api/discord/avisar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cardId, eventoId }),
        // A aba pode fechar logo depois de salvar — arrastar um card e sair é
        // rotina. `keepalive` faz o navegador terminar a requisição mesmo assim,
        // que é a diferença entre o aviso sair e não sair.
        keepalive: true,
      });
    } catch (e) {
      // Só o console. Um toast de "falhou o aviso" sobre uma demanda que gravou
      // certo ensina a pessoa a desconfiar de um salvamento que deu certo.
      console.warn("[aviso no discord]", e);
    }
  })();
}
