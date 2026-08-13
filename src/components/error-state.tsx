"use client";

import { useSyncExternalStore } from "react";

import { classificarErro } from "@/lib/erro-ui-core";
import { EmptyState } from "./empty-state";

/**
 * O que a tela mostra quando a leitura falhou — e que até agora não existia.
 *
 * O BURACO QUE ELE TAPA: erro só aparecia na UI em ação DO USUÁRIO (os doze
 * `styles.err`/`styles.erro` espalhados pelos formulários). Em LEITURA, as
 * dezesseis assinaturas jogavam o `onError` fora com `() => {}` ou o
 * despejavam num `console.error`. Se a regra do Firestore negasse ou a rede
 * caísse, as oito páginas ficavam permanentemente no estado vazio, visualmente
 * idênticas a "não há nada aqui". Num projeto que quebra o build para proteger
 * a fronteira de demandas, engolir dezesseis falhas de permissão em silêncio
 * era incoerente com a própria cultura.
 *
 * QUEM DECIDE A FRASE NÃO É ESTE ARQUIVO: a classificação mora em
 * `lib/erro-ui-core.ts`, que é módulo puro e por isso é testado em Node no
 * prebuild — inclusive a asserção de que nenhuma palavra do Firestore
 * atravessa até aqui. Este componente só desenha o que aquele decidiu.
 *
 * @param error   o `erro` devolvido pelo `useAsyncData`.
 * @param onRetry o que "tentar de novo" significa nesta tela. É obrigatório de
 *                propósito: um padrão silencioso — recarregar a página inteira,
 *                por exemplo — resolveria o tipo e deixaria o botão mentindo em
 *                quem esquecesse de ligá-lo.
 * @param size    `"compact"` dentro de painel ou de coluna de Kanban.
 */
export function ErrorState({
  error,
  onRetry,
  size = "large",
}: {
  error: unknown;
  onRetry: () => void;
  size?: "large" | "compact";
}) {
  const online = useSyncExternalStore(assinarConexao, estaOnline, sempreOnline);
  const mensagem = classificarErro(error, online);

  return (
    <EmptyState
      tom="erro"
      size={size}
      icon={mensagem.icone}
      title={mensagem.titulo}
      description={mensagem.descricao}
      action={
        // Sem botão quando repetir daria o mesmo resultado. Oferecer "tentar de
        // novo" para uma negação de permissão promete uma saída que não existe,
        // e a pessoa clica cinco vezes antes de entender que o problema não é
        // com ela.
        mensagem.podeTentarDeNovo ? (
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        ) : undefined
      }
    />
  );
}

/**
 * A conexão é assinada, e não lida uma vez.
 *
 * Quem está offline vê "você está sem conexão"; quando a internet volta, a
 * frase tem de deixar de ser essa sozinha — senão o painel continua culpando a
 * rede depois de ela voltar, e a pessoa fica esperando um botão que já
 * funcionaria.
 */
function assinarConexao(aoMudar: () => void) {
  window.addEventListener("online", aoMudar);
  window.addEventListener("offline", aoMudar);
  return () => {
    window.removeEventListener("online", aoMudar);
    window.removeEventListener("offline", aoMudar);
  };
}

const estaOnline = () => navigator.onLine;

/** No servidor não há navegador para consultar; assumir online é o que faz o
 *  HTML do servidor bater com o do cliente no caso comum. */
const sempreOnline = () => true;
