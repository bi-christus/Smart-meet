"use client";

import { useTemporadasVencidasPor } from "@/lib/temporadas";
import { rotuloMes } from "@/lib/temporadas-core";
import type { UserProfile } from "@/lib/users";
import { classeAparece, SkeletonRow } from "./skeleton";
import { ErrorState } from "./error-state";
import { Icon } from "./icons";
import styles from "./temporadas-perfil.module.css";

/**
 * As temporadas que uma pessoa venceu, no card do perfil.
 *
 * ESTÁTICO, e não `dynamic()` como `EmblemasDoPerfil` — aquele é sob demanda
 * porque arrasta `lib/kanban` (e com ele `historico.ts`, `discord.ts`) para o
 * pacote do shell. Este componente só lê `lib/temporadas`, um wrapper fino
 * sobre o Firestore que o app já paga em toda página autenticada; não há peso
 * extra a proteger.
 *
 * DEVOLVE `null` QUANDO NÃO HÁ NENHUMA. A maioria das pessoas nunca venceu uma
 * temporada, e isso não é erro nem pendência — é só ausência de conquista, do
 * mesmo jeito que uma pessoa sem moldura escolhida não tem um card dizendo
 * "sem moldura". Um bloco permanente de "0 temporadas" para quase todo mundo
 * seria ruído no perfil de quem só quer ver o que a pessoa fez.
 */
export function TemporadasDoPerfil({ pessoa }: { pessoa: UserProfile }) {
  const { vencidas, carregando, erro, tentarDeNovo } = useTemporadasVencidasPor(
    pessoa.email,
  );

  if (carregando) {
    return (
      <section className={styles.bloco} aria-label="Temporadas vencidas">
        <SkeletonRow rows={1} texto="Conferindo temporadas…" />
      </section>
    );
  }

  if (erro) {
    return (
      <section className={styles.bloco} aria-label="Temporadas vencidas">
        <ErrorState error={erro} onRetry={tentarDeNovo} size="compact" />
      </section>
    );
  }

  const lista = vencidas ?? [];
  if (lista.length === 0) return null;

  return (
    <section
      className={`${styles.bloco} ${classeAparece}`}
      aria-label="Temporadas vencidas"
    >
      <div className={styles.cabeca}>
        <Icon name="trofeu" size={14} />
        <span>Temporadas vencidas</span>
      </div>
      <div className={styles.faixa}>
        {lista.map((t) => (
          <span
            key={t.mes}
            className={styles.chip}
            title={`Campeã(o) da temporada de ${rotuloMes(t.mes)}`}
          >
            {rotuloMes(t.mes)}
          </span>
        ))}
      </div>
    </section>
  );
}
