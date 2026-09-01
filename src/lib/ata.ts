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
  herdarParaProxima,
  limparTexto,
  normalizarAta,
  type Ata,
  type ItemDeAta,
  type TarefaDeAta,
} from "./ata-core.ts";

/**
 * A ata de reunião — o lado que fala com o Firestore.
 *
 * A regra mora em `ata-core.ts`, que é onde ela é testada. Aqui só vivem a
 * assinatura e as escritas. **Não coloque decisão neste arquivo**: o partido é
 * o mesmo de `dimensoes`/`dimensoes-core` e de `setores`/`setores-core`.
 *
 * UMA ESCRITA POR ATA, e não uma por item. Os itens moram num array dentro do
 * documento, pelo mesmo motivo que as subdimensões moram dentro da dimensão
 * (ver o cabeçalho de `dimensoes-core`): são poucos, são SEMPRE lidos junto — não
 * existe tela que queira um item de ata sem saber de que reunião ele é — e
 * subcoleção custaria uma consulta por ata mais uma regra própria em
 * `firestore.rules`.
 *
 * O QUE ISSO COBRA: duas pessoas editando a MESMA ata ao mesmo tempo escrevem o
 * array inteiro, e a última grava por cima. Numa reunião isso é aceitável e
 * quase teórico — quem preenche a ata é o facilitador, um por reunião, e todo
 * mundo está olhando para a mesma tela. Se um dia duas pessoas passarem a
 * escrever junto, o conserto é `arrayUnion`/`arrayRemove` por item, não uma
 * subcoleção.
 */

export * from "./ata-core.ts";

export function subscribeAtas(
  setor: string,
  onData: (atas: Ata[]) => void,
  onError?: (e: Error) => void,
): () => void {
  if (!setor) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, "atas"), where("setor", "==", setor)),
    (snap) => {
      // Documento ilegível é DESCARTADO, não derruba a lista — mesma escolha de
      // `subscribeDimensoes`, e o porquê está em `normalizarAta`.
      const lidas = snap.docs
        .map((d) => normalizarAta(d.id, d.data()))
        .filter((a): a is Ata => a !== null);
      // Mais recente primeiro: a reunião de que se fala é quase sempre a última.
      // Empate de data desempata pelo título, para a lista não dançar entre dois
      // snapshots do Firestore.
      lidas.sort(
        (a, b) =>
          (a.data < b.data ? 1 : a.data > b.data ? -1 : 0) ||
          a.titulo.localeCompare(b.titulo, "pt-BR"),
      );
      onData(lidas);
    },
    (e) => onError?.(e),
  );
}

export type NovaAta = {
  setor: string;
  titulo: string;
  data: string;
  horaInicio?: string;
  horaFim?: string;
  local?: string;
  facilitador?: string;
  participantes?: string[];
  meetingId?: string | null;
  /** Itens herdados da ata anterior — ver `herdarParaProxima`. */
  itens?: ItemDeAta[];
};

export async function criarAta(nova: NovaAta, createdBy: string): Promise<string> {
  const titulo = limparTexto(nova.titulo, 120);
  if (!titulo) throw new Error("Dê um título à reunião.");
  if (!nova.setor) throw new Error("A ata precisa de um setor.");
  const ref = await addDoc(collection(db, "atas"), {
    setor: nova.setor,
    titulo,
    data: nova.data,
    horaInicio: nova.horaInicio ?? "",
    horaFim: nova.horaFim ?? "",
    local: limparTexto(nova.local, 80),
    facilitador: nova.facilitador ?? "",
    participantes: nova.participantes ?? [],
    meetingId: nova.meetingId ?? null,
    itens: nova.itens ?? [],
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/**
 * Grava o cabeçalho da reunião. NÃO toca nos itens.
 *
 * As duas escritas são separadas de propósito: corrigir a hora de início no
 * meio da reunião não pode ter como efeito colateral gravar por cima da tabela
 * de tarefas que alguém está preenchendo na outra ponta.
 */
export async function salvarCabecalho(
  id: string,
  patch: Partial<Pick<Ata, "titulo" | "data" | "horaInicio" | "horaFim" | "local" | "facilitador" | "participantes" | "meetingId">>,
): Promise<void> {
  const limpo = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  if (!Object.keys(limpo).length) return;
  await updateDoc(doc(db, "atas", id), limpo);
}

/** Grava os itens da ata inteiros — ver o cabeçalho sobre o custo disso. */
export async function salvarItens(id: string, itens: ItemDeAta[]): Promise<void> {
  await updateDoc(doc(db, "atas", id), { itens });
}

export async function deleteAta(id: string): Promise<void> {
  await deleteDoc(doc(db, "atas", id));
}

/**
 * Abre a próxima reunião já com o que esta deixou pendente.
 *
 * É o botão "Levar para próxima reunião" cobrando a promessa: sem ele, marcar o
 * item seria um enfeite que ninguém colhe, e a reunião seguinte recomeçaria do
 * zero — que é exatamente a queixa registrada na ata que originou esta tela.
 */
export async function abrirProxima(
  anterior: Ata,
  dados: { titulo: string; data: string },
  createdBy: string,
): Promise<string> {
  return criarAta(
    {
      setor: anterior.setor,
      titulo: dados.titulo,
      data: dados.data,
      local: anterior.local,
      facilitador: anterior.facilitador,
      participantes: anterior.participantes,
      itens: herdarParaProxima(anterior),
    },
    createdBy,
  );
}

export type { Ata, ItemDeAta, TarefaDeAta };
