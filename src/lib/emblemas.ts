"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import {
  columnsBySector,
  subscribeCards,
  subscribeCardsForSectors,
  subscribeColumns,
  subscribeColumnsForSectors,
  type Card,
  type ColumnDoc,
} from "./kanban";
import { entreguesPorSetor } from "./entregas-core.ts";
import {
  CONFIG_PADRAO,
  contarEntregasPorSetorSolicitante,
  escopoDaContagem,
  montarEmblemas,
  normalizarConfigEmblemas,
  type ConfigEmblemas,
  type Contagem,
  type Emblema,
} from "./emblemas-core.ts";
import { juntarFontes } from "./async-data-core";
import { useAsyncData } from "./use-async-data";

/**
 * O acesso ao banco dos emblemas. A regra mora em `emblemas-core.ts`, o irmão.
 *
 * UM DOCUMENTO SÓ em `/config`, exatamente como `config/permissoes`, e pelos
 * mesmos três motivos escritos no cabeçalho de `permissoes.ts`: custo de leitura,
 * consistência (mudar um degrau e o nome de um setor é uma decisão só) e
 * coerência com o resto. `match /config/{doc}` em `firestore.rules` já cobre —
 * leitura de qualquer usuário autorizado, escrita só de admin —, então esta
 * frente NÃO mexe em regra nenhuma.
 */
export const CAMINHO_EMBLEMAS = { colecao: "config", doc: "emblemas" };

function ref() {
  return doc(db, CAMINHO_EMBLEMAS.colecao, CAMINHO_EMBLEMAS.doc);
}

/**
 * Assina a configuração. Documento inexistente NÃO é erro: é o estado de quem
 * nunca abriu o quadro de Emblemas, e a resposta certa para ele é a escada
 * padrão com nenhum setor nomeado.
 */
export function subscribeEmblemas(
  onData: (c: ConfigEmblemas) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    ref(),
    (snap) => onData(normalizarConfigEmblemas(snap.exists() ? snap.data() : null)),
    (e) => onError?.(e),
  );
}

/**
 * Grava o quadro inteiro. Só admin passa pela regra.
 *
 * `setDoc` SEM `merge`, de propósito e pelo mesmo motivo de `salvarPermissoes`:
 * o documento É o quadro. Um setor cujo nome o admin apagou tem de sair do
 * documento; com `merge`, o nome antigo ficaria gravado por baixo, invisível na
 * tela e pronto para voltar a valer.
 *
 * A trilha (`v`, `atualizadoEm`, `atualizadoPor`) é a mesma forma de
 * `config/permissoes`: os dois documentos de `/config` têm de se parecer, senão
 * quem abrir o console encontra duas convenções para a mesma coisa.
 */
export async function salvarEmblemas(
  cfg: ConfigEmblemas,
  atorEmail: string,
): Promise<void> {
  await setDoc(ref(), {
    v: 1,
    degraus: cfg.degraus,
    setores: cfg.setores,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: atorEmail,
  });
}

/** A configuração, para quem só quer editá-la ou lê-la sem os cards. */
export function useConfigEmblemas(): {
  config: ConfigEmblemas;
  carregando: boolean;
  erro: Error | null;
} {
  const [estado, setEstado] = useState<{
    config: ConfigEmblemas;
    carregando: boolean;
    erro: Error | null;
  }>({ config: CONFIG_PADRAO, carregando: true, erro: null });

  useEffect(() => {
    const fechar = subscribeEmblemas(
      (c) => setEstado({ config: c, carregando: false, erro: null }),
      (e) => setEstado({ config: CONFIG_PADRAO, carregando: false, erro: e }),
    );
    return () => fechar();
  }, []);

  return estado;
}

const SEM_CARDS: Card[] = [];
const SEM_COLS: ColumnDoc[] = [];

/**
 * Os emblemas de uma pessoa, contados a partir do quadro.
 *
 * QUEM PAGA A LEITURA, e por que aqui. O card do perfil abre de dois lugares —
 * `layout.tsx` (o shell, que envolve TODA página e nunca desmonta) e
 * `kanban/page.tsx`. Calcular nos pontos de chamada seria de graça no Kanban,
 * que já tem `cards` e as colunas em mãos, e caríssimo no shell: toda sessão
 * passaria a assinar a coleção de cards do setor em toda tela, inclusive para
 * quem nunca abre um perfil. E seriam duas colas iguais em dois arquivos,
 * prontas para divergir.
 *
 * Aqui é um caminho só, e é o único em que carregando/vazio/erro têm onde morar:
 * dentro do bloco, que é onde a pessoa está olhando.
 *
 * COM UM SETOR SÓ — 100% dos casos hoje — ele assina `subscribeCards(setor)`, e
 * não a variante de vários. Não é microtuning: `subscribeCardsForSectors` usa
 * `where("sector","in",[...])` e `subscribeCards` usa `where("sector","==")`, que
 * são ALVOS DE CONSULTA DIFERENTES. O SDK só reaproveita uma escuta aberta
 * quando o alvo é idêntico, e o Kanban mantém a de `==` aberta — que é
 * justamente onde os cliques em avatar acontecem. Fora do Kanban o custo nunca é
 * zero: `firebase.ts` usa `getFirestore` puro, sem cache local persistente,
 * então cada abertura de perfil é uma escuta nova.
 *
 * O FALSO VAZIO É O CAMINHO MAIS PROVÁVEL DE TODOS, e é contra ele que a guarda
 * de `sectors.length === 0` existe. `subscribeCardsForSectors([])` chama
 * `onData([])` de forma SÍNCRONA, e via `aplicarDados` isso vira `data: []` —
 * que em `async-data-core` significa "respondeu e está vazio", a mentira que
 * aquele módulo inteiro existe para matar. Nos primeiros quadros `profile` é
 * `null` e `sectors` é `[]`: sem a guarda, o bloco desenharia "nenhuma entrega"
 * antes de qualquer leitura ter acontecido.
 */
export function useEmblemasDaPessoa(
  email: string,
  setoresDaPessoa: readonly string[] | null | undefined,
  setoresDoVisualizador: readonly string[],
): {
  emblemas: Emblema[] | undefined;
  contagem: Contagem | undefined;
  config: ConfigEmblemas;
  /** `true` quando a config falhou e a escada em uso é a padrão. */
  configFalhou: boolean;
  escopo: { completo: boolean; ausentes: string[] };
  carregando: boolean;
  semSetor: boolean;
  erro: Error | null;
  tentarDeNovo: () => void;
} {
  const setores = useMemo(
    () => [...setoresDoVisualizador],
    [setoresDoVisualizador],
  );
  const semSetor = setores.length === 0;
  const chave = semSetor ? "__sem__" : setores.join("|");

  const fCards = useAsyncData<Card>(chave, (onData, onErro) => {
    // A guarda vem ANTES de assinar. Ver o cabeçalho: sem ela, o caminho de
    // `[]` responde `data: []` de forma síncrona e a tela mente.
    if (semSetor) return () => {};
    return setores.length === 1
      ? subscribeCards(setores[0], onData, onErro)
      : subscribeCardsForSectors(setores, onData, onErro);
  });

  const fCols = useAsyncData<ColumnDoc>(chave, (onData, onErro) => {
    if (semSetor) return () => {};
    return setores.length === 1
      ? subscribeColumns(setores[0], onData, onErro)
      : subscribeColumnsForSectors(setores, onData, onErro);
  });

  const { config, carregando: cfgCarregando, erro: cfgErro } = useConfigEmblemas();

  const cards = fCards.data ?? SEM_CARDS;
  const cols = fCols.data ?? SEM_COLS;

  const ent = useMemo(
    () => entreguesPorSetor(columnsBySector(cols, setores)),
    [cols, setores],
  );

  /**
   * TRÊS FONTES, UM `juntarFontes` — e a config entra como fonte sintética.
   *
   * Sem ela na conta, os chips desenhariam "Infraestrutura" e virariam
   * "Construtor" 200 ms depois. É a mesma mentira que os esqueletos deste
   * projeto existem para tirar da tela, só que no rótulo — e pior, porque um
   * texto que troca sozinho lê como defeito, não como carregamento.
   *
   * Quando a config FALHA (e não só demora), o bloco desenha com a escada padrão
   * e acende o aviso. É o único caso em que seguir com o padrão é melhor que
   * mostrar erro: sem ele, o sintoma visível — "o emblema apareceu com o nome do
   * setor" — seria indistinguível de "o admin nunca nomeou este setor".
   */
  const fonteConfig = {
    data: cfgCarregando ? undefined : [config],
    erro: cfgErro,
  };
  const tela = juntarFontes([fCards, fCols, fonteConfig]);

  const contagem = useMemo(() => {
    if (semSetor || tela.carregando || tela.erro) return undefined;
    return contarEntregasPorSetorSolicitante(cards, ent, email, config);
  }, [semSetor, tela.carregando, tela.erro, cards, ent, email, config]);

  const emblemas = useMemo(
    () => (contagem ? montarEmblemas(contagem, config) : undefined),
    [contagem, config],
  );

  const escopo = useMemo(
    () => escopoDaContagem(setores, setoresDaPessoa),
    [setores, setoresDaPessoa],
  );

  return {
    emblemas,
    contagem,
    config,
    configFalhou: !!cfgErro,
    escopo,
    // Sem setor não é "carregando": é um estado próprio, com frase própria.
    carregando: !semSetor && tela.carregando,
    semSetor,
    erro: tela.erro,
    tentarDeNovo: () => {
      fCards.tentarDeNovo();
      fCols.tentarDeNovo();
    },
  };
}
