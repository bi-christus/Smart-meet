import type { ReactNode } from "react";

import styles from "./empty-state.module.css";
import { Icon } from "./icons";
import { classeAparece } from "./skeleton";

/**
 * O que a tela mostra quando a resposta chegou e não tinha nada dentro.
 *
 * ATENÇÃO AO QUE ELE NÃO É: isto não é "ainda não sei". Enquanto o `data` do
 * `useAsyncData` for `undefined`, o lugar é do `<Skeleton>`. Este componente só
 * entra depois de `data` ser um array de verdade e ter comprimento zero. Trocar
 * um pelo outro é exatamente o defeito que as Issues #33, #34 e #35 existem
 * para consertar — o app afirmando que não há nada enquanto ainda procura.
 *
 * POR QUE COMPONENTE, E NÃO OITO VEZES À MÃO: o app tinha nove classes de CSS
 * para a mesma ideia (`empty`, `vazio`, `vazioTela`, `vazioPainel`,
 * `vazioGrande`, `colempty`, `histVazio`, `actVazio`, `queueEmpty`) e oito
 * delas eram uma linha de texto cinza. O estado vazio é o único lugar do app
 * onde investimento de design se justifica de sobra: é visto raramente, e é
 * justamente quando a pessoa mais precisa de orientação sobre o que fazer.
 * Para investir uma vez só em vez de nove, precisa ser um componente.
 *
 * A ANATOMIA — ícone, título, explicação, ação — foi tirada do vazio de
 * Recorrências, o único do app que já tinha as quatro partes.
 *
 * @param icon        nome do ícone em `icons.tsx` (ex.: `"kanban"`).
 * @param title       a frase curta, sem ponto final.
 * @param description por que está vazio e o que isso significa. Aceita nós
 *                    (`<b>{setor}</b>`) porque nomear o setor na frase é o que
 *                    a torna sobre a situação de quem lê.
 * @param action      opcional: um `<button>` ou `<a>` cru. A aparência de botão
 *                    do app é aplicada aqui, por descendência.
 * @param size        `"compact"` dentro de painel ou de coluna de Kanban.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "large",
  tom = "vazio",
}: {
  icon: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "large" | "compact";
  /** Uso interno do `<ErrorState>`; telas passam o padrão. */
  tom?: "vazio" | "erro";
}) {
  const compacto = size === "compact";
  const classes = [
    styles.painel,
    compacto ? styles.compacto : "",
    tom === "erro" ? styles.erro : "",
    // O painel toma o lugar de um esqueleto: entra com o mesmo crossfade de
    // 150ms do conteúdo real, para a troca não ser um corte seco. Reusar a
    // classe do `<Skeleton>` evita um segundo keyframe dizendo a mesma coisa —
    // e ela já é tratada pelo bloco global de movimento reduzido.
    classeAparece,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // `role="alert"` só no erro: falha de leitura interrompe o que a pessoa
    // ia fazer e precisa ser anunciada. "Não há nada aqui" é informação de
    // rotina — anunciar com a mesma urgência ensinaria a ignorar as duas.
    <div className={classes} role={tom === "erro" ? "alert" : undefined}>
      <div className={styles.icone}>
        <Icon name={icon} size={compacto ? 19 : 30} />
      </div>
      <div className={styles.titulo}>{title}</div>
      {description ? <p className={styles.descricao}>{description}</p> : null}
      {action ? <div className={styles.acao}>{action}</div> : null}
    </div>
  );
}
