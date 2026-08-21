"use client";

import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  conferirNome,
  nomeExistente,
  normalizarDimensao,
  ordenarDimensoes,
  proximoIdDeSub,
  type Dimensao,
  type Subdimensao,
  type TipoDeSub,
} from "./dimensoes-core.ts";

/**
 * A árvore de dimensões — o lado que fala com o Firestore.
 *
 * A regra mora em `dimensoes-core.ts`, que é onde ela é testada. Aqui só vivem
 * a assinatura e as escritas. **Não coloque decisão neste arquivo**: o partido
 * é o mesmo de `setores`/`setores-core` e de `permissoes`/`permissoes-core`.
 */

export {
  ESTADO_LABEL,
  ID_SEM_DIMENSAO,
  LIMITE_NOME_CHARS,
  NOME_SEM_DIMENSAO,
  PARADA_DIAS,
  TIPO_LABEL,
  acharNo,
  achatar,
  cardsDoNo,
  conferirNome,
  corDaDimensao,
  estaAtrasada,
  filtrarArvore,
  montarArvore,
  nomeExistente,
  ordenarDimensoes,
  type CardDaArvore,
  type Dimensao,
  type EstadoDoNo,
  type Metricas,
  type NoDaArvore,
  type Subdimensao,
  type TipoDeSub,
} from "./dimensoes-core.ts";

export function subscribeDimensoes(
  setor: string,
  onData: (dims: Dimensao[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (!setor) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, "dimensoes"), where("setor", "==", setor)),
    (snap) => {
      // Documento ilegível é DESCARTADO, não derruba a lista — ver o comentário
      // de `normalizarDimensao`.
      const lidas = snap.docs
        .map((d) => normalizarDimensao(d.id, d.data()))
        .filter((d): d is Dimensao => d !== null);
      onData(ordenarDimensoes(lidas));
    },
    (e) => onError?.(e),
  );
}

/**
 * Cadastra a dimensão, recusando o nome repetido antes de gravar.
 *
 * A conferência de duplicata acontece contra a lista que a TELA já tem, pela
 * mesma escolha (e com a mesma honestidade) de `addSetor`: duas pessoas
 * cadastrando "Brigada" no mesmo segundo criam dois documentos, porque o
 * Firestore não tem unicidade sem transação — e transação por causa de um
 * cadastro que um punhado de gestores edita seria caro por um empate que
 * ninguém viu acontecer.
 *
 * A `ordem` sai do fim da lista, e é ela que decide a COR da dimensão na árvore
 * (`corDaDimensao`). Por isso ela é gravada no cadastro em vez de derivada da
 * posição no array em memória: a cor de uma dimensão não pode trocar porque
 * outra foi apagada.
 */
export async function addDimensao(
  setor: string,
  nome: string,
  existentes: readonly Dimensao[],
): Promise<string> {
  const conferido = conferirNome(nome, "da dimensão");
  if (!conferido.ok) throw new Error(conferido.motivo);
  const igual = nomeExistente(conferido.nome, existentes);
  if (igual) return igual.id;
  const proximaOrdem =
    existentes.reduce((maior, d) => Math.max(maior, d.ordem), -1) + 1;
  const ref = await addDoc(collection(db, "dimensoes"), {
    setor,
    nome: conferido.nome,
    ordem: proximaOrdem,
    subs: [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renomearDimensao(id: string, nome: string): Promise<void> {
  const conferido = conferirNome(nome, "da dimensão");
  if (!conferido.ok) throw new Error(conferido.motivo);
  await updateDoc(doc(db, "dimensoes", id), { nome: conferido.nome });
}

/**
 * Tira a dimensão do cadastro. NÃO mexe em demanda nenhuma.
 *
 * É de propósito, e a tela diz isso antes de perguntar — mesma decisão de
 * `deleteSetor`. As demandas que apontavam para ela reaparecem no nó "Sem
 * classificação" da árvore, que existe para isso e tem teste próprio. Apagar em
 * cascata apagaria trabalho de gente por causa de uma linha de cadastro.
 */
export async function deleteDimensao(id: string): Promise<void> {
  await deleteDoc(doc(db, "dimensoes", id));
}

/**
 * As escritas de subdimensão são todas do mesmo naipe: ler o array atual da
 * dimensão, devolvê-lo modificado.
 *
 * Não é transação, e a razão é a mesma da duplicata acima: o cadastro é editado
 * por um punhado de gestores, quase sempre um de cada vez, e o pior caso de uma
 * corrida é a subdimensão de um sobrescrever a do outro num cadastro que
 * qualquer um refaz em dez segundos. `arrayUnion` não serve aqui porque três
 * das quatro operações (renomear, trocar o tipo, remover) precisam do item
 * ANTIGO para produzir o novo.
 */
async function gravarSubs(dim: Dimensao, subs: Subdimensao[]): Promise<void> {
  await updateDoc(doc(db, "dimensoes", dim.id), {
    // `nome` viaja junto porque a regra do Firestore exige que o documento
    // resultante tenha nome não vazio em todo update — e `request.resource.data`
    // é o documento inteiro, não o patch.
    nome: dim.nome,
    subs,
  });
}

export async function addSubdimensao(
  dim: Dimensao,
  nome: string,
  tipo: TipoDeSub,
): Promise<string> {
  const conferido = conferirNome(nome, "da subdimensão");
  if (!conferido.ok) throw new Error(conferido.motivo);
  const igual = nomeExistente(conferido.nome, dim.subs);
  if (igual) return igual.id;
  const id = proximoIdDeSub(dim.subs);
  await gravarSubs(dim, [...dim.subs, { id, nome: conferido.nome, tipo }]);
  return id;
}

export async function editarSubdimensao(
  dim: Dimensao,
  subId: string,
  patch: { nome?: string; tipo?: TipoDeSub },
): Promise<void> {
  let nome: string | undefined;
  if (patch.nome !== undefined) {
    const conferido = conferirNome(patch.nome, "da subdimensão");
    if (!conferido.ok) throw new Error(conferido.motivo);
    nome = conferido.nome;
  }
  await gravarSubs(
    dim,
    dim.subs.map((s) =>
      s.id === subId
        ? { ...s, ...(nome !== undefined ? { nome } : {}), ...(patch.tipo ? { tipo: patch.tipo } : {}) }
        : s,
    ),
  );
}

/**
 * Remove a subdimensão da dimensão. Como em `deleteDimensao`, não toca em
 * demanda: as que apontavam para ela passam a aparecer direto na dimensão.
 *
 * O id sai da lista e NÃO volta a ser emitido — ver `proximoIdDeSub`.
 */
export async function removerSubdimensao(
  dim: Dimensao,
  subId: string,
): Promise<void> {
  await gravarSubs(
    dim,
    dim.subs.filter((s) => s.id !== subId),
  );
}
