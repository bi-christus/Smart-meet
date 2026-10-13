"use client";

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Colocacao } from "./rank-core";
import { useAsyncData } from "./use-async-data";

/**
 * O acesso ao banco das temporadas fechadas. A regra mora em
 * `temporadas-core.ts`, o irmão puro.
 *
 * SÓ LEITURA NESTE ARQUIVO, de propósito. Quem grava um documento de
 * `temporadas/{mes}` é só a rota `api/temporadas/fechar`, pelo Admin SDK — a
 * mesma razão por trás de `firestore.rules` recusar toda escrita do cliente
 * nesta coleção. Uma temporada é um FATO REGISTRADO no fechamento do mês, e
 * dar ao cliente um jeito de escrever aqui abriria uma segunda porta para o
 * mesmo resultado que o cron já garante ser único e idempotente.
 */

/** Um doc de `temporadas/{mes}` — o pódio congelado no instante do fechamento. */
/** O pódio de UM setor dentro de uma temporada fechada (#215). */
export type PodioDoSetor = {
  setor: string;
  ranking: Colocacao[];
  vencedores: string[];
  entregas: number;
};

export type TemporadaFechada = {
  mes: string;
  /** O pódio da organização inteira — o único que existia até #215. */
  ranking: Colocacao[];
  vencedores: string[];
  entregas: number;
  /**
   * Um pódio por setor (#215). O Rank é por setor, e a temporada passou a
   * guardar o de cada um no fechamento. `null` nas temporadas fechadas antes
   * disso: elas só têm o pódio geral, e ele NÃO é recalculado por setor —
   * a temporada é um fato registrado, e recontá-la depois contaria uma
   * história que ninguém viu na época.
   *
   * Uma LISTA e não um mapa por nome: nome de setor tem ponto ("B.I."), e
   * ponto em chave de mapa do Firestore vira caminho de campo em toda escrita
   * por `update`.
   */
  porSetor: PodioDoSetor[] | null;
  fechadaEm: Timestamp | null;
  fechadaPor: string;
};

function normalizarPodio(bruto: unknown): PodioDoSetor | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  if (typeof b.setor !== "string" || !b.setor) return null;
  return {
    setor: b.setor,
    ranking: Array.isArray(b.ranking) ? (b.ranking as Colocacao[]) : [],
    vencedores: Array.isArray(b.vencedores) ? (b.vencedores as string[]) : [],
    entregas: typeof b.entregas === "number" ? b.entregas : 0,
  };
}

function normalizar(id: string, data: Record<string, unknown>): TemporadaFechada {
  return {
    mes: typeof data.mes === "string" ? data.mes : id,
    ranking: Array.isArray(data.ranking) ? (data.ranking as Colocacao[]) : [],
    vencedores: Array.isArray(data.vencedores) ? (data.vencedores as string[]) : [],
    entregas: typeof data.entregas === "number" ? data.entregas : 0,
    porSetor: Array.isArray(data.porSetor)
      ? data.porSetor.map(normalizarPodio).filter((p): p is PodioDoSetor => !!p)
      : null,
    fechadaEm: (data.fechadaEm as Timestamp | undefined) ?? null,
    fechadaPor: typeof data.fechadaPor === "string" ? data.fechadaPor : "",
  };
}

/**
 * Assina uma temporada fechada. Documento inexistente NÃO é erro: é o estado
 * normal do mês corrente, que ainda não fechou — `onData(null)` é a resposta
 * certa, não uma falha de rede.
 */
export function subscribeTemporadaFechada(
  mes: string,
  onData: (t: TemporadaFechada | null) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "temporadas", mes),
    (snap) => onData(snap.exists() ? normalizar(snap.id, snap.data()) : null),
    (e) => onError?.(e),
  );
}

/** Todas as temporadas já fechadas, da mais recente para a mais antiga. */
export function listarTemporadasFechadas(
  onData: (temporadas: TemporadaFechada[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "temporadas"), orderBy("mes", "desc")),
    (snap) => onData(snap.docs.map((d) => normalizar(d.id, d.data()))),
    (e) => onError?.(e),
  );
}

/** As temporadas que uma pessoa venceu, mais recente primeiro — o rótulo do perfil. */
export function subscribeTemporadasVencidasPor(
  email: string,
  onData: (temporadas: TemporadaFechada[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(db, "temporadas"),
      where("vencedores", "array-contains", email),
      orderBy("mes", "desc"),
    ),
    (snap) => onData(snap.docs.map((d) => normalizar(d.id, d.data()))),
    (e) => onError?.(e),
  );
}

/**
 * Casca de React sobre `subscribeTemporadasVencidasPor`, no molde de
 * `useConfigEmblemas` — o card do perfil só quer os três estados prontos.
 */
export function useTemporadasVencidasPor(email: string): {
  vencidas: TemporadaFechada[] | undefined;
  carregando: boolean;
  erro: Error | null;
  tentarDeNovo: () => void;
} {
  const { data, erro, tentarDeNovo } = useAsyncData<TemporadaFechada>(
    email || "__sem_email__",
    (onData, onErro) => {
      if (!email) return () => {};
      return subscribeTemporadasVencidasPor(email, onData, onErro);
    },
  );
  return {
    vencidas: data,
    carregando: !!email && data === undefined && !erro,
    erro,
    tentarDeNovo,
  };
}
