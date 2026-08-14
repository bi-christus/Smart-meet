"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import {
  normalizarPermissoes,
  PERMISSOES_ABERTAS,
  type Permissoes,
} from "./permissoes-core";

/**
 * O acesso ao banco da configuração de abas. A regra mora em
 * `permissoes-core.ts` — aqui só há leitura, escrita e ciclo de vida.
 *
 * UM DOCUMENTO SÓ, e não um por aba nem um campo por usuário. São três motivos,
 * e os três são sobre custo:
 *
 *  - **Regras.** Toda tela do app precisa desta configuração para montar a barra
 *    do topo. Um documento por aba seriam oito leituras — e leitura no Firestore
 *    é paga por documento, em toda sessão de todo usuário.
 *  - **Consistência.** Trocar o modo de uma aba e a lista dela são a mesma
 *    decisão; em documentos separados, elas poderiam entrar pela metade.
 *  - **Coerência com o resto.** Guardar a permissão dentro de cada `/users`
 *    espalharia a mesma decisão por N documentos, e responder "quem vê o
 *    Dashboard?" viraria uma varredura da coleção inteira.
 */
export const CAMINHO_PERMISSOES = { colecao: "config", doc: "permissoes" };

function ref() {
  return doc(db, CAMINHO_PERMISSOES.colecao, CAMINHO_PERMISSOES.doc);
}

/**
 * Assina a configuração em tempo real.
 *
 * Documento inexistente NÃO é erro: é o estado de quem nunca abriu o quadro de
 * Permissões, e a resposta certa para ele é "tudo liberado".
 */
export function subscribePermissoes(
  onData: (p: Permissoes) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    ref(),
    (snap) => onData(normalizarPermissoes(snap.exists() ? snap.data() : null)),
    (e) => onError?.(e),
  );
}

/**
 * Grava o quadro inteiro. Só admin passa pela regra do Firestore.
 *
 * `setDoc` sem `merge`, de propósito: o documento É o quadro, e uma aba que sai
 * do modo restrito tem de sair do documento também. Com `merge`, a lista antiga
 * ficaria gravada embaixo, invisível na tela e pronta para voltar a valer no dia
 * em que alguém trocasse o modo de novo.
 */
export async function salvarPermissoes(
  permissoes: Permissoes,
  atorEmail: string,
): Promise<void> {
  await setDoc(ref(), {
    v: 1,
    abas: permissoes.abas,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: atorEmail,
  });
}

/**
 * As permissões, para quem só quer desenhar a barra do topo.
 *
 * FALHA DE LEITURA VIRA "TUDO LIBERADO", e não um estado de erro na tela. É a
 * decisão mais importante deste arquivo, e é o contrário do que o resto do app
 * faz — em toda outra tela, erro tem de aparecer como erro (AGENTS.md §3). A
 * diferença é o que está em jogo: aqui a falha não deixa de mostrar um painel,
 * ela deixa de mostrar a NAVEGAÇÃO INTEIRA. Uma pane de rede transformaria o
 * app numa tela sem barra do topo, sem caminho para lugar nenhum e sem nada
 * dizendo o que aconteceu — e a aba de onde isso se conserta seria uma das
 * escondidas. O aperto de verdade não está aqui: quem nega leitura de dado é
 * `firestore.rules`, e ela não depende desta assinatura.
 *
 * `carregando` existe para o app NÃO desenhar a barra antes de saber: mostrar
 * oito abas e recolher três meio segundo depois é a mesma mentira que os
 * esqueletos deste projeto existem para tirar da tela, só que na navegação.
 */
export function usePermissoes(): {
  permissoes: Permissoes;
  carregando: boolean;
} {
  const [estado, setEstado] = useState<{
    permissoes: Permissoes;
    carregando: boolean;
  }>({ permissoes: PERMISSOES_ABERTAS, carregando: true });

  useEffect(() => {
    const fechar = subscribePermissoes(
      (p) => setEstado({ permissoes: p, carregando: false }),
      (e) => {
        console.error("[permissões] leitura falhou; abas liberadas:", e);
        setEstado({ permissoes: PERMISSOES_ABERTAS, carregando: false });
      },
    );
    return () => fechar();
  }, []);

  return estado;
}
