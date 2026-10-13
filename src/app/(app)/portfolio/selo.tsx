"use client";

import { iconeDoLink } from "@/lib/icones-core";
import { monogramaDe, seloDoLink } from "@/lib/links-core";
import type { LinkDoSetor } from "@/lib/links-do-setor";
import { Icon } from "@/components/icons";
import styles from "./links.module.css";

/**
 * O selo de um link que NÃO se edita ali: o logo, se houver; senão o ícone
 * (escolhido ou deduzido) sobre a cor da marca; senão o monograma.
 *
 * Um componente só porque são dois lugares — o card da aba, para quem não pode
 * alterar o link, e o atalho do Início — e os dois têm de mostrar o MESMO
 * desenho: o diretor que reconhece o painel pelo logo no Início tem de achar o
 * mesmo logo na aba. O selo editável (com o seletor de ícone) continua no card.
 */
export function SeloDoLink({ link, className }: { link: LinkDoSetor; className?: string }) {
  if (link.logo) {
    return (
      <span className={`${styles.logoSelo} ${className ?? ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI conferido na leitura; next/image não otimiza data URI */}
        <img src={link.logo} alt="" />
      </span>
    );
  }
  const selo = seloDoLink(link.url);
  const icone = iconeDoLink(link);
  return (
    <span
      className={`${styles.icone} ${styles.iconeFixo} ${className ?? ""}`}
      style={{ background: selo.fundo, color: selo.tinta }}
      aria-hidden="true"
    >
      {icone ? <Icon name={icone} size={19} /> : monogramaDe(link.url)}
    </span>
  );
}
