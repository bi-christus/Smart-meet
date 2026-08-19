"use client";

import { useMemo } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { useAsyncData } from "./use-async-data";
import {
  conferirNomeDeSetor,
  nomesDosSetores,
  normalizarSetores,
  setorExistente,
  setoresVisiveis,
  type PessoaDoSetor,
  type Setor,
} from "./setores-core.ts";

/**
 * O cadastro de setores de execução — o lado que fala com o Firestore.
 *
 * A regra mora em `setores-core.ts`, que é onde ela é testada. Aqui só vivem a
 * assinatura, as duas escritas e o gancho que as telas chamam. **Não coloque
 * decisão neste arquivo**: o partido é o mesmo de `historico`/`historico-core`
 * e de `permissoes`/`permissoes-core`.
 */

export {
  conferirNomeDeSetor,
  nomesDosSetores,
  setorExistente,
  setoresOferecidos,
  setoresVisiveis,
  SETORES_SEMENTE,
  LIMITE_SETOR_CHARS,
  type Setor,
} from "./setores-core.ts";

/** Vazias constantes: `?? []` no corpo recria o array e invalida os `useMemo`. */
const SEM_SETORES: Setor[] = [];

type SetorDoc = { id: string; nome: unknown };

export function subscribeSetores(
  onData: (list: Setor[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "setores"),
    (snap) => {
      const brutos: SetorDoc[] = snap.docs.map((d) => ({
        id: d.id,
        nome: (d.data() as { name?: unknown }).name,
      }));
      onData(normalizarSetores(brutos));
    },
    (e) => onError?.(e),
  );
}

/**
 * Cadastra o setor, recusando o repetido antes de gravar.
 *
 * A conferência de duplicata acontece contra a lista que a TELA já tem, e não
 * contra uma leitura nova: é a mesma escolha de `garantirSetorSolicitante`, e
 * ela é honesta sobre o que garante. Duas pessoas cadastrando "Compras" no
 * mesmo segundo criam dois documentos — o Firestore não tem unicidade sem
 * transação, e uma transação por causa de um cadastro que um punhado de admins
 * edita seria pagar caro por um empate que ninguém viu acontecer. Quando
 * acontecer, `normalizarSetores` já esconde o segundo da lista.
 */
export async function addSetor(
  nome: string,
  existentes: readonly Setor[],
): Promise<string> {
  const conferido = conferirNomeDeSetor(nome);
  if (!conferido.ok) throw new Error(conferido.motivo);
  const igual = setorExistente(conferido.nome, existentes);
  if (igual) return igual.nome;
  await addDoc(collection(db, "setores"), {
    name: conferido.nome,
    createdAt: serverTimestamp(),
  });
  return conferido.nome;
}

/**
 * Tira o setor do cadastro. NÃO mexe em card, coluna, reunião nem usuário.
 *
 * É de propósito, e a tela diz isso antes de perguntar. Apagar em cascata
 * apagaria demanda de gente por causa de uma linha de cadastro; deixar o dado
 * de pé faz o setor sumir de onde se ESCOLHE setor e continuar aparecendo para
 * quem já está nele — que é o que `setoresOferecidos` e `setoresVisiveis`
 * garantem, cada um do seu lado.
 */
export async function deleteSetor(id: string): Promise<void> {
  await deleteDoc(doc(db, "setores", id));
}

/**
 * O cadastro inteiro, para as telas que o ADMINISTRAM (a aba Admin).
 *
 * Devolve os três estados sem confundi-los, como todo `useAsyncData` deste
 * projeto: `undefined` é "ainda não respondeu", `[]` é "respondeu e está
 * vazio". A aba Admin é o único lugar que precisa saber a diferença.
 */
export function useCadastroDeSetores(): {
  setores: Setor[] | undefined;
  erro: Error | null;
  tentarDeNovo: () => void;
} {
  const f = useAsyncData<Setor>("todos", (onData, onErro) =>
    subscribeSetores(onData, onErro),
  );
  return { setores: f.data, erro: f.erro, tentarDeNovo: f.tentarDeNovo };
}

/**
 * Os setores que ESTA pessoa enxerga — o que as nove telas perguntam.
 *
 * NÃO ASSINA O CADASTRO PARA QUEM NÃO É ADMIN, e essa é a parte que importa:
 * os setores de um não-admin saem do `sectors` do próprio perfil, que o
 * `useAuth` já tem em memória. Assinar `/setores` para essa pessoa seria um
 * listener a mais em nove telas para produzir uma lista que o gancho descarta.
 *
 * O efeito colateral bom é que o caminho comum não tem espera nenhuma: quem não
 * é admin recebe a lista definitiva no primeiro render, sem passar pelo piso.
 * Para o admin, a lista começa em `SETORES_SEMENTE` e vira o cadastro quando
 * ele chega — a chave de assinatura das telas muda junto e elas reassinam, que
 * é exatamente o que `useAsyncData` foi feito para tratar.
 */
export function useSetoresDaPessoa(pessoa: PessoaDoSetor | null | undefined): string[] {
  const ehAdmin = pessoa?.role === "admin";
  const f = useAsyncData<Setor>(ehAdmin ? "todos" : "__nao__", (onData, onErro) => {
    // A guarda vem ANTES de assinar, como em `useEmblemasDaPessoa`.
    if (!ehAdmin) {
      onData([]);
      return () => {};
    }
    return subscribeSetores(onData, onErro);
  });

  const cadastro = f.data ?? SEM_SETORES;
  const nomes = useMemo(() => nomesDosSetores(cadastro), [cadastro]);

  // `pessoa` é o `profile` do contexto de auth, que é um `useState` — a
  // identidade dele só muda quando o perfil muda de verdade. É a mesma
  // dependência que as nove telas já usavam no `useMemo` que este gancho
  // substitui, e é o que impede o array de voltar novo a cada render e fazer
  // as páginas reassinarem o Firestore sem parar.
  return useMemo(() => setoresVisiveis(pessoa, nomes), [pessoa, nomes]);
}
