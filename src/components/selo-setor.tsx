import type { ReactNode } from "react";

import { seloDoSetor, type Forma } from "@/lib/selo-setor-core";
import styles from "./selo-setor.module.css";

/**
 * O desenho de cada forma, em viewBox 16×16.
 *
 * Tudo CHEIO, nenhuma vazada: cheio × vazado lê como estado (ativo/inativo,
 * pendente/feito), e ao lado do chip de status isso diria uma coisa que o selo
 * não quer dizer. A meia-lua é a lua de verdade, recortada, e não um círculo
 * pela metade — meio cheio lê como "metade pronta".
 *
 * `Record<Forma, …>` e não um `switch`: forma nova no core sem desenho aqui é
 * erro de tipo, e não um selo em branco na tela.
 *
 * O MESMO PESO, e não o mesmo contorno. Desenhadas na mesma caixa, as formas
 * pontudas sobravam leves: o quadrado tingia 55% do quadro e o triângulo 34%,
 * a meia-lua 26% — e um selo mais leve lê como setor "menor". Losango,
 * triângulo, pílula e meia-lua foram esticados até a área ficar entre 40% e
 * 55% (medida rasterizando cada desenho, 26/11/2026), mesmo saindo um pouco da
 * margem que o círculo e o quadrado deixam.
 */
const DESENHO: Record<Forma, ReactNode> = {
  circulo: <circle cx="8" cy="8" r="6.5" />,
  quadrado: <rect x="2" y="2" width="12" height="12" rx="2" />,
  triangulo: <path d="M8 .6 15.6 14.2H.4Z" />,
  losango: <path d="M8 0 16 8 8 16 0 8Z" />,
  gota: (
    <path d="M8 1.2C9.8 4 13.4 7.4 13.4 10.2a5.4 5.4 0 0 1-10.8 0C2.6 7.4 6.2 4 8 1.2Z" />
  ),
  pilula: <rect x=".5" y="3.75" width="15" height="8.5" rx="4.25" />,
  pentagono: <path d="M8 1.2 15 6.3l-2.7 8.2H3.7L1 6.3Z" />,
  paralelogramo: <path d="M5.2 2.5H15.5L10.8 13.5H.5Z" />,
  laco: <path d="M1 2 8 5.5 15 2V14L8 10.5 1 14Z" />,
  meialua: <path d="M7.96.7A7.3 7.3 0 1 0 15.3 8.04A5.2 5.2 0 1 1 7.96.7Z" />,
};

/**
 * O selo de um setor: o glifo E o nome, sempre os dois.
 *
 * O nome não é opcional, e é isso que deixa a cor ser só reforço: com sete
 * tons para dezoito setores, e daltonismo no meio, cor sozinha erra. Por isso
 * o componente não tem um modo "só o glifo" — o dia em que alguém precisar de
 * um, a pergunta certa é por que o nome não cabe ali.
 *
 * O glifo é `aria-hidden`: o leitor de tela já lê o nome escrito ao lado, e
 * anunciar "triângulo rosa" antes dele é ruído. O `title` no conjunto mostra o
 * nome inteiro quando ele é cortado com reticências numa coluna estreita.
 *
 * A cor entra por `data-tom` com seletores escritos na folha, e não por
 * `styles[...]` montado: o guarda `check-css-modules` não enxerga leitura
 * dinâmica, e um tom sem regra nasceria cinza sem ninguém saber.
 */
export function SeloSetor({
  setor,
  tamanho = 14,
  className,
}: {
  setor: string;
  /** Lado do glifo em px. 14 é o menor em que as dez formas foram conferidas. */
  tamanho?: number;
  className?: string;
}) {
  const { forma, tom } = seloDoSetor(setor);
  return (
    <span
      className={className ? `${styles.selo} ${className}` : styles.selo}
      title={setor}
    >
      <svg
        className={styles.glifo}
        data-tom={tom}
        data-forma={forma}
        viewBox="0 0 16 16"
        width={tamanho}
        height={tamanho}
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        {DESENHO[forma]}
      </svg>
      <span className={styles.nome}>{setor}</span>
    </span>
  );
}
