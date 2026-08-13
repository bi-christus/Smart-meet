"use client";

import { useEffect, useEffectEvent, useState } from "react";

import {
  aplicarDados,
  aplicarErro,
  estadoInicial,
  lerEstado,
  type EstadoAsync,
} from "./async-data-core";

/**
 * Casca fina sobre os `subscribe*` que já existem.
 *
 * A regra mora em `async-data-core.ts`, que é onde ela é testada; aqui só vive
 * o ciclo de vida da assinatura. **Não coloque lógica neste arquivo** — foi
 * partido assim exatamente para que a parte que decide alguma coisa seja
 * testável em Node puro, como `historico-core` e `recorrencias-core`.
 */
export type Assinar<T> = (
  onData: (v: T[]) => void,
  onErro: (e: Error) => void,
) => () => void;

/**
 * Assina uma coleção e devolve os três estados possíveis, sem confundi-los.
 *
 * @param chave   identidade da assinatura (o setor, ou `sectors.join("|")`).
 *                Mudou a chave, reassina e volta a "carregando".
 * @param assinar fecha sobre os parâmetros do `subscribe*` correspondente.
 *                NÃO precisa de `useCallback`: `useEffectEvent` sempre lê a
 *                versão mais recente sem reassinar. Foi por isso que ele entrou
 *                aqui — com `useCallback`, um `assinar` recriado a cada render
 *                fecharia e reabriria a assinatura do Firestore sem parar.
 */
export function useAsyncData<T>(
  chave: string,
  assinar: Assinar<T>,
): {
  data: T[] | undefined;
  erro: Error | null;
  /** Fecha a assinatura e abre outra. É o que o botão do `<ErrorState>` chama. */
  tentarDeNovo: () => void;
} {
  // "Tentar de novo" é uma chave nova, e não um caminho novo.
  //
  // O ciclo de vida já sabe reagir a troca de chave: fecha a assinatura velha,
  // abre outra e volta a "carregando" — que é exatamente o que uma nova
  // tentativa precisa fazer. Um `refazer` separado seria um segundo caminho
  // até o mesmo estado, com a chance de os dois discordarem um dia.
  //
  // O contador entra no fim da chave e não colide nem com nome de setor que
  // tenha espaço ("Recursos Humanos"): o sufixo é sempre só dígitos, então duas
  // chaves diferentes nunca produzem a mesma cadeia.
  const [tentativa, setTentativa] = useState(0);
  const chaveDaVez = `${chave} ${tentativa}`;

  const [estado, setEstado] = useState<EstadoAsync<T>>(() =>
    estadoInicial<T>(chaveDaVez),
  );

  const abrir = useEffectEvent((k: string) =>
    assinar(
      (v) => setEstado((a) => aplicarDados(a, k, v)),
      (e) => setEstado((a) => aplicarErro(a, k, e)),
    ),
  );

  useEffect(() => {
    const fechar = abrir(chaveDaVez);
    return () => fechar();
  }, [chaveDaVez]);

  // Derivado no render, e não com `setState` no efeito: zerar o estado ao
  // trocar de setor dentro do efeito seria cascata de render — o mesmo erro de
  // lint que este projeto já carrega nove vezes e que as Issues #6, #7 e #8
  // existem para matar. Não reintroduza aqui.
  return {
    ...lerEstado(estado, chaveDaVez),
    tentarDeNovo: () => setTentativa((n) => n + 1),
  };
}
