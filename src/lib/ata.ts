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
  writeBatch,
  type WriteBatch,
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
// A régua da demanda que nasce na ata — obrigatoriedade da dimensão inclusive.
// Reexportada daqui pelo mesmo motivo de tudo o mais neste arquivo: quem monta
// a tela lê um módulo só.
export * from "./ata-demanda-core.ts";

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
  citados?: string[];
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
    citados: nova.citados ?? [],
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
  patch: Partial<
    Pick<
      Ata,
      | "titulo"
      | "data"
      | "horaInicio"
      | "horaFim"
      | "local"
      | "facilitador"
      | "participantes"
      | "citados"
      | "meetingId"
    >
  >,
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

/**
 * A mesma escrita de `salvarItens`, mas DENTRO de um lote que outro já abriu.
 *
 * Existe por causa de um caso só, e ele justifica a segunda porta: a demanda que
 * nasce na ata. `createCard` grava o card e a primeira linha do histórico num
 * `writeBatch`; o `cardId` precisa entrar no item da pauta no MESMO lote, senão
 * o pior estado possível fica alcançável — card de verdade no quadro e a ata
 * ainda chamando aquilo de assunto, com a próxima tentativa criando um card
 * duplicado porque nada na ata diz que o primeiro existe.
 *
 * É a regra de AGENTS.md §4 aplicada onde ela ainda não estava: escrita e
 * registro andam no mesmo lote, ou as duas entram ou nenhuma.
 *
 * Não devolve promessa de propósito — quem faz `commit()` é quem abriu o lote.
 */
export function salvarItensNoLote(
  batch: WriteBatch,
  id: string,
  itens: ItemDeAta[],
): void {
  batch.update(doc(db, "atas", id), { itens });
}

/**
 * O assunto muda de reunião — as DUAS atas no mesmo lote, ou nenhuma.
 *
 * É a segunda porta do `writeBatch` neste arquivo, e a razão é a mesma da
 * primeira (`salvarItensNoLote`): existe um estado intermediário que não pode
 * ser alcançável. Em duas escritas soltas, a falha da segunda deixa o assunto
 * NAS DUAS atas (se a remoção falhou) ou em NENHUMA (se a inclusão falhou) — e
 * o segundo caso apaga silenciosamente a decisão e as tarefas que a reunião
 * registrou, sem nada na tela para dizer que sumiram.
 *
 * O que o lote NÃO resolve, e é o preço conhecido deste modelo (ver o cabeçalho
 * deste arquivo): os dois arrays são gravados inteiros, a partir do snapshot
 * que a tela tinha. Se alguém estiver escrevendo na ata de destino no mesmo
 * instante, a última gravação vence. Numa reunião isso é quase teórico — quem
 * preenche a ata é o facilitador, um por reunião —, e o conserto, se um dia
 * fizer falta, é `arrayUnion`/`arrayRemove` por item, não uma subcoleção.
 *
 * As regras aprovam sem mudança nenhuma: as duas atas são do MESMO setor (a
 * régua está em `moverAssunto`), e cada escrita do lote é avaliada sozinha
 * contra `allow update`, que só cobra o setor imutável e o título não vazio.
 */
export async function moverItensEntreAtas(
  origem: { id: string; itens: ItemDeAta[] },
  destino: { id: string; itens: ItemDeAta[] },
): Promise<void> {
  const batch = writeBatch(db);
  salvarItensNoLote(batch, origem.id, origem.itens);
  salvarItensNoLote(batch, destino.id, destino.itens);
  await batch.commit();
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
  /**
   * O QUE O FORMULÁRIO COLETOU, inteiro — e não só título e data.
   *
   * Era `{ titulo, data }`, e os outros cinco campos do modal caíam no chão: a
   * ata nova nascia com o local e o facilitador da reunião ANTERIOR e sem
   * horário nenhum, mesmo com a pessoa tendo acabado de digitar "Sala 3,
   * 14h–15h, facilitador Fulano". Nada na tela dizia que aquilo tinha sido
   * ignorado.
   *
   * A ata anterior continua servindo de ponto de partida — mas como valor
   * INICIAL do formulário (`inicial`, na tela), que é onde esse papel cabe.
   */
  dados: {
    titulo: string;
    data: string;
    horaInicio?: string;
    horaFim?: string;
    local?: string;
    facilitador?: string;
    participantes?: string[];
  },
  createdBy: string,
): Promise<string> {
  return criarAta(
    {
      setor: anterior.setor,
      titulo: dados.titulo,
      data: dados.data,
      horaInicio: dados.horaInicio ?? "",
      horaFim: dados.horaFim ?? "",
      local: dados.local ?? anterior.local,
      facilitador: dados.facilitador ?? anterior.facilitador,
      participantes: dados.participantes ?? anterior.participantes,
      // Os citados NÃO vão junto: são quem apareceu NAQUELA gravação. A próxima
      // reunião tem a sua, e herdar a lista faria a ata nova nascer afirmando
      // presença de gente que ainda não entrou na sala.
      itens: herdarParaProxima(anterior),
    },
    createdBy,
  );
}

export type { Ata, ItemDeAta, TarefaDeAta };
