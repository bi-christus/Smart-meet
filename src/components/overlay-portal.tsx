"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Leva o diálogo para fora da página, direto no `<body>`.
 *
 * O PROBLEMA que isto resolve: `.content` do app-shell é `position: relative`
 * com `z-index: 1`, e isso cria um CONTEXTO DE EMPILHAMENTO. Todo z-index de
 * dentro dele — inclusive o 80 do overlay — é resolvido lá dentro, e o bloco
 * inteiro vale 1 na raiz. O cabeçalho vale 40 e o mini player vale 70, os dois
 * na raiz. Ou seja: o modal nascia POR BAIXO dos dois, cortado em cima pela
 * barra do topo e embaixo pelo player. Subir o z-index do overlay não
 * adiantaria nada — ele nem chega a competir com o cabeçalho.
 *
 * Tirar o `z-index: 1` do `.content` também não é a saída: os menus de
 * `select` e `combobox` valem 90, e sem o contexto eles passariam a cobrir o
 * cabeçalho quando a página rolasse. O contexto de empilhamento está certo; o
 * que estava errado era o diálogo morar dentro dele.
 *
 * NÃO APAGUE ISTO por causa do que vem agora. O `.tabEnter` já teve um
 * `transform`, e durante os 300ms da troca de aba ele virava bloco de contenção
 * — ali dentro, `position: fixed` deixava de ser relativo à janela. Esse motivo
 * morreu junto com o transform (a troca de aba hoje é só opacidade, 120ms). Os
 * DOIS motivos de cima continuam de pé, e sozinhos já bastam: sem o portal, o
 * modal volta a nascer por baixo do cabeçalho e do mini player.
 */
export function OverlayPortal({ children }: { children: ReactNode }) {
  // No prerender do Next não existe `document`. Na prática este retorno nunca
  // acontece no navegador: diálogo só aparece depois de alguém clicar.
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
