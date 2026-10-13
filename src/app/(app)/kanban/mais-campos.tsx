"use client";

import { Icon } from "@/components/icons";
import styles from "./kanban.module.css";

/**
 * "+ campo" — os campos que a demanda ainda não tem, a um clique (#211).
 *
 * O modal mostrava os quinze campos de uma vez, preenchidos ou não, e a demanda
 * que acabou de nascer abria como um formulário de cadastro. Agora o campo vazio
 * mora aqui, como um botão com o nome dele; clicar o põe na tela, e a partir daí
 * ele se comporta como sempre.
 *
 * Sem opção nenhuma (todos os campos já à vista), a linha não existe — um
 * "Adicionar:" seguido de nada é ruído.
 */
export function MaisCampos({
  opcoes,
  onAbrir,
}: {
  opcoes: readonly { id: string; rotulo: string }[];
  onAbrir: (id: string) => void;
}) {
  if (opcoes.length === 0) return null;
  return (
    <div className={styles.maisCampos}>
      <span className={styles.maisCamposRot}>Adicionar</span>
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          className={styles.maisCampo}
          onClick={() => onAbrir(o.id)}
        >
          <Icon name="plus" size={11} />
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
