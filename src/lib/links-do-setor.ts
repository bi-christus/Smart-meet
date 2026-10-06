"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { ehIconeDeLink } from "./icones-core.ts";
import {
  conferirLink,
  conflitoDeLink,
  normalizarLinkDoSetor,
  ordenarLinks,
  type LinkDoSetor,
  type RascunhoDeLink,
} from "./links-do-setor-core.ts";

/**
 * O cadastro da aba Links — o lado que fala com o Firestore.
 *
 * A regra mora em `links-do-setor-core.ts`, que é onde ela é testada. Aqui só
 * vivem a assinatura e as escritas. **Não coloque decisão neste arquivo**: o
 * partido é o mesmo de `dimensoes`/`dimensoes-core`.
 *
 * Cada link é um DOCUMENTO, e não um item de array como dentro do card. É isso
 * que dispensa as transações que o link da demanda precisava: lá, gravar a
 * lista que a tela tinha na mão apagava o link que outra pessoa colou no meio
 * tempo; aqui, editar um link não reescreve nenhum outro.
 */

export {
  LIMITE_DESCRICAO_LINK,
  LIMITE_NOME_LINK,
  casaBusca,
  conferirLink,
  conflitoDeLink,
  type CampoDoLink,
  type LinkDoSetor,
  type RascunhoDeLink,
} from "./links-do-setor-core.ts";

/** `Timestamp` do SDK → milissegundos. Qualquer outra coisa vira `null`. */
function emMs(v: unknown): number | null {
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

function lido(id: string, data: DocumentData): LinkDoSetor | null {
  return normalizarLinkDoSetor(id, {
    ...data,
    createdAt: emMs(data.createdAt),
    // Ausente continua ausente: `normalizarLinkDoSetor` só cria a chave quando
    // o documento a tem.
    ...(data.updatedAt !== undefined ? { updatedAt: emMs(data.updatedAt) } : {}),
  });
}

export function subscribeLinksDoSetor(
  setores: string[],
  onData: (links: LinkDoSetor[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (setores.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    // O limite de 30 do `in` é o mesmo de `subscribeCardsForSectors` e das
    // Recorrências: ninguém participa de 30 setores, e o admin que enxerga
    // todos fica no mesmo teto que as outras telas já têm.
    query(collection(db, "links"), where("setor", "in", setores.slice(0, 30))),
    (snap) => {
      const links = snap.docs
        // `estimate` porque o card recém-criado chega aqui ANTES de o servidor
        // carimbar a data — sem isto ele apareceria um instante sem "quando".
        .map((d) => lido(d.id, d.data({ serverTimestamps: "estimate" })))
        .filter((l): l is LinkDoSetor => l !== null);
      onData(ordenarLinks(links));
    },
    (e) => onError?.(e),
  );
}

/**
 * Confere o rascunho e a duplicata. Lança com a frase que a tela mostra.
 *
 * Lançar, e não devolver um resultado, porque a tela já trata a falha da
 * gravação num `catch` — e as duas recusas, a da régua e a do banco, chegam à
 * pessoa do mesmo jeito: uma frase no rodapé do formulário.
 */
function conferido(
  rascunho: RascunhoDeLink,
  setor: string,
  existentes: readonly LinkDoSetor[],
  ignorarId?: string,
): RascunhoDeLink {
  const r = conferirLink(rascunho);
  if (!r.ok) throw new Error(r.motivo);
  const conflito = conflitoDeLink(r.dados, setor, existentes, ignorarId);
  if (conflito) throw new Error(conflito.motivo);
  return r.dados;
}

/** O ícone como vai para o banco: o nome do catálogo, ou a chave apagada. */
function iconeParaGravar(icone: string | null) {
  return icone !== null && ehIconeDeLink(icone) ? icone : deleteField();
}

export async function criarLink(
  setor: string,
  rascunho: RascunhoDeLink,
  icone: string | null,
  autor: string,
  existentes: readonly LinkDoSetor[],
): Promise<string> {
  const dados = conferido(rascunho, setor, existentes);
  const ref = await addDoc(collection(db, "links"), {
    setor,
    ...dados,
    // Na criação, ícone automático é a chave AUSENTE — `deleteField()` só
    // serve em update, e `addDoc` o recusaria.
    ...(icone !== null && ehIconeDeLink(icone) ? { icone } : {}),
    createdBy: autor,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function editarLink(
  link: LinkDoSetor,
  rascunho: RascunhoDeLink,
  icone: string | null,
  autor: string,
  existentes: readonly LinkDoSetor[],
): Promise<void> {
  const dados = conferido(rascunho, link.setor, existentes, link.id);
  await updateDoc(doc(db, "links", link.id), {
    ...dados,
    icone: iconeParaGravar(icone),
    updatedBy: autor,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Troca só o ícone — é o clique no selo do card, sem abrir o formulário.
 *
 * Carimba `updatedBy`/`updatedAt` como qualquer edição: a regra exige, e é a
 * única trilha que este cadastro tem de quem mexeu por último.
 */
export async function definirIconeDoLinkDoSetor(
  id: string,
  icone: string | null,
  autor: string,
): Promise<void> {
  await updateDoc(doc(db, "links", id), {
    icone: iconeParaGravar(icone),
    updatedBy: autor,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Apaga de vez. Não há lixeira, e a diferença com a demanda é deliberada: o
 * link do cadastro não carrega histórico, comentário nem prazo — é uma linha
 * que qualquer pessoa do setor recadastra em dez segundos. A tela pergunta
 * antes.
 */
export async function excluirLink(id: string): Promise<void> {
  await deleteDoc(doc(db, "links", id));
}
