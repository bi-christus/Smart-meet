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

// ---------------------------------------------------------------------------
// O vínculo, do lado da tela.
//
// Ao contrário do aviso, ESTAS DUAS ESPERAM e ESTAS DUAS LANÇAM: a pessoa está
// olhando o botão que apertou, e "não deu" precisa chegar até ela. É a
// diferença entre um efeito colateral do trabalho e uma ação que alguém pediu.
// ---------------------------------------------------------------------------

async function cabecalho(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("Faça login de novo para continuar.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

async function conferir(r: Response): Promise<unknown> {
  const dados = (await r.json().catch(() => null)) as { error?: string } | null;
  if (!r.ok) throw new Error(dados?.error || "Não deu para falar com o servidor.");
  return dados;
}

/**
 * Pede o endereço da autorização do Discord.
 *
 * Quem abre a janela é a tela, e não esta função — e isso não é detalhe de
 * organização: `window.open` chamado DEPOIS de um `await` já não conta como
 * resposta a um clique, e o navegador bloqueia. A tela abre a aba primeiro e
 * manda o endereço para ela quando ele chega.
 */
export async function iniciarVinculoDiscord(): Promise<{ url: string }> {
  const r = await fetch("/api/discord/oauth/iniciar", {
    method: "POST",
    headers: await cabecalho(),
  });
  return (await conferir(r)) as { url: string };
}

export type CodigoDeVinculo = { codigo: string; expiraEmSegundos: number };

/** Pede um código novo. O anterior desta pessoa morre no mesmo pedido. */
export async function gerarCodigoDiscord(): Promise<CodigoDeVinculo> {
  const r = await fetch("/api/discord/vinculo", {
    method: "POST",
    headers: await cabecalho(),
  });
  return (await conferir(r)) as CodigoDeVinculo;
}

/** Desfaz o vínculo pelo lado do app. */
export async function desvincularDiscord(): Promise<void> {
  const r = await fetch("/api/discord/vinculo", {
    method: "DELETE",
    headers: await cabecalho(),
  });
  await conferir(r);
}
