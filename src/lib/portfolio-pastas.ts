"use client";

import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { ehIconeDeLink } from "./icones-core.ts";
import {
  conferirNomeDePasta,
  nomeRepetido,
  normalizarPasta,
  planoDeConversao,
  planoDeExclusao,
  podeMoverPasta,
  type PastaDoPortfolio,
} from "./portfolio-pastas-core.ts";

/**
 * As pastas do Portfólio — o lado que fala com o Firestore (#229).
 *
 * A regra mora em `portfolio-pastas-core.ts`, onde é testada; aqui só a
 * assinatura e as escritas. Toda escrita é de ADMIN (a regra de
 * `/pastasPortfolio` confere): a tela nem mostra os comandos aos outros.
 *
 * Toda função recebe a ÁRVORE JÁ SANEADA (`arvoreDoSetor`) que a tela tem na
 * mão, e confere contra ela antes de gravar — a regra do Firestore só sabe
 * dizer "sem permissão", e não enxerga ciclo nem nome repetido.
 */

export * from "./portfolio-pastas-core.ts";

const COLECAO = "pastasPortfolio";

function emMs(v: unknown): number | null {
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

function lida(id: string, data: DocumentData): PastaDoPortfolio | null {
  return normalizarPasta(id, {
    ...data,
    createdAt: emMs(data.createdAt),
    ...(data.updatedAt !== undefined ? { updatedAt: emMs(data.updatedAt) } : {}),
  });
}

export function subscribePastasDoPortfolio(
  setores: string[],
  onData: (pastas: PastaDoPortfolio[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (setores.length === 0) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    // O mesmo teto de 30 do `in` que a assinatura dos produtos usa.
    query(collection(db, COLECAO), where("setor", "in", setores.slice(0, 30))),
    (snap) =>
      onData(
        snap.docs
          .map((d) => lida(d.id, d.data({ serverTimestamps: "estimate" })))
          .filter((p): p is PastaDoPortfolio => p !== null),
      ),
    (e) => onError?.(e),
  );
}

function nomeConferido(
  arvore: readonly PastaDoPortfolio[],
  paiId: string | null,
  bruto: string,
  ignorarId?: string,
): string {
  const r = conferirNomeDePasta(bruto);
  if (!r.ok) throw new Error(r.motivo);
  if (nomeRepetido(arvore, paiId, r.nome, ignorarId)) {
    throw new Error(`Já existe uma pasta chamada “${r.nome}” aqui.`);
  }
  return r.nome;
}

/** Cria a pasta e devolve o id — o id nasce no cliente para a tela já abrir nela. */
export async function criarPasta(
  setor: string,
  arvore: readonly PastaDoPortfolio[],
  paiId: string | null,
  nome: string,
  autor: string,
): Promise<string> {
  const conferido = nomeConferido(arvore, paiId, nome);
  const ref = doc(collection(db, COLECAO));
  const lote = writeBatch(db);
  lote.set(ref, {
    setor,
    nome: conferido,
    ...(paiId ? { paiId } : {}),
    createdBy: autor,
    createdAt: serverTimestamp(),
  });
  await lote.commit();
  return ref.id;
}

export async function renomearPasta(
  pasta: PastaDoPortfolio,
  arvore: readonly PastaDoPortfolio[],
  nome: string,
  autor: string,
): Promise<void> {
  const conferido = nomeConferido(arvore, pasta.paiId, nome, pasta.id);
  if (conferido === pasta.nome) return;
  const lote = writeBatch(db);
  lote.update(doc(db, COLECAO, pasta.id), {
    nome: conferido,
    updatedBy: autor,
    updatedAt: serverTimestamp(),
  });
  await lote.commit();
}

/** `null` volta ao desenho de pasta de sempre. */
export async function definirIconeDaPasta(
  pasta: PastaDoPortfolio,
  icone: string | null,
  autor: string,
): Promise<void> {
  if ((pasta.icone ?? null) === icone) return;
  const lote = writeBatch(db);
  lote.update(doc(db, COLECAO, pasta.id), {
    icone: icone !== null && ehIconeDeLink(icone) ? icone : deleteField(),
    updatedBy: autor,
    updatedAt: serverTimestamp(),
  });
  await lote.commit();
}

/**
 * Põe a pasta dentro de outra (`null` = raiz). Recusa o ciclo — para dentro
 * de si mesma ou de uma filha —, como o Windows recusa.
 */
export async function moverPasta(
  pasta: PastaDoPortfolio,
  arvore: readonly PastaDoPortfolio[],
  destino: string | null,
  autor: string,
): Promise<void> {
  if (!podeMoverPasta(arvore, pasta.id, destino)) {
    throw new Error("Uma pasta não pode ir para dentro dela mesma.");
  }
  if (nomeRepetido(arvore, destino, pasta.nome, pasta.id)) {
    throw new Error(`Já existe uma pasta chamada “${pasta.nome}” no destino.`);
  }
  const lote = writeBatch(db);
  lote.update(doc(db, COLECAO, pasta.id), {
    paiId: destino ?? deleteField(),
    updatedBy: autor,
    updatedAt: serverTimestamp(),
  });
  await lote.commit();
}

/**
 * Exclui a pasta. O conteúdo SOBE para a pasta de cima, no mesmo lote: ou a
 * pasta some com tudo realocado, ou nada muda. Produto nenhum é apagado.
 */
export async function excluirPasta(
  pasta: PastaDoPortfolio,
  arvore: readonly PastaDoPortfolio[],
  produtos: readonly { id: string; setor: string; pastaId?: string }[],
  autor: string,
): Promise<void> {
  const plano = planoDeExclusao(arvore, produtos, pasta.id);
  if (!plano) return;
  // 450 por lote, com folga para o `delete` e as subpastas: o lote do
  // Firestore aceita 500 escritas, e um portfólio não chega perto disso.
  const escritas: ((l: ReturnType<typeof writeBatch>) => void)[] = [
    ...plano.pastas.map((id) => (l: ReturnType<typeof writeBatch>) =>
      l.update(doc(db, COLECAO, id), {
        paiId: plano.destino ?? deleteField(),
        updatedBy: autor,
        updatedAt: serverTimestamp(),
      }),
    ),
    ...plano.produtos.map((id) => (l: ReturnType<typeof writeBatch>) =>
      l.update(doc(db, "links", id), {
        pastaId: plano.destino ?? deleteField(),
        updatedBy: autor,
        updatedAt: serverTimestamp(),
      }),
    ),
  ];
  if (escritas.length > 450) {
    throw new Error("Esta pasta tem itens demais para excluir de uma vez. Esvazie parte dela antes.");
  }
  const lote = writeBatch(db);
  escritas.forEach((e) => e(lote));
  lote.delete(doc(db, COLECAO, pasta.id));
  await lote.commit();
}

/**
 * Converte a organização antiga (#226, categoria e pasta em texto) em pastas
 * de verdade, num lote só. Devolve quantas pastas nasceram.
 */
export async function converterOrganizacaoAntiga(
  setor: string,
  arvore: readonly PastaDoPortfolio[],
  produtos: readonly { id: string; setor: string; pastaId?: string; categoria?: string; pasta?: string }[],
  autor: string,
): Promise<number> {
  const plano = planoDeConversao(arvore, produtos.filter((l) => l.setor === setor));
  if (plano.criar.length + plano.mover.length > 450) {
    throw new Error("Produtos demais para converter de uma vez.");
  }
  const lote = writeBatch(db);
  const ids = new Map<string, string>();
  const real = (id: string | null) => (id === null ? null : (ids.get(id) ?? id));
  // As mães vêm antes das filhas no plano (a categoria é achada antes da
  // pasta), então o id provisório da mãe já foi trocado quando a filha chega.
  for (const c of plano.criar) {
    const ref = doc(collection(db, COLECAO));
    ids.set(c.idProvisorio, ref.id);
    const paiId = real(c.paiId);
    lote.set(ref, {
      setor,
      nome: c.nome,
      ...(paiId ? { paiId } : {}),
      createdBy: autor,
      createdAt: serverTimestamp(),
    });
  }
  for (const m of plano.mover) {
    const pastaId = real(m.pastaId);
    lote.update(doc(db, "links", m.produtoId), {
      pastaId: pastaId ?? deleteField(),
      categoria: deleteField(),
      pasta: deleteField(),
      updatedBy: autor,
      updatedAt: serverTimestamp(),
    });
  }
  await lote.commit();
  return plano.criar.length;
}
