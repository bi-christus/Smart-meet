"use client";

import type { ReactNode } from "react";
import { Modal } from "./modal";
import { Icon } from "./icons";
import styles from "./filtros.module.css";

/**
 * O botão que abre a busca e os filtros de uma tela (#239).
 *
 * POR QUE OS FILTROS SAÍRAM DA LINHA. No Kanban eram a busca, três seletores,
 * dois botões e uma linha inteira de tags, todos visíveis o tempo todo, para
 * um uso que é de vez em quando: na maior parte do dia o quadro é olhado
 * inteiro. O que a tela precisa dizer o tempo todo é SE há filtro ligado — é
 * o contador do botão —, e não quais são as opções.
 *
 * O contador é o que impede o filtro esquecido: sem ele, um quadro filtrado
 * com o pop-up fechado pareceria um quadro com menos demandas.
 */
export function BotaoFiltros({
  ativos,
  onClick,
  rotulo = "Buscar e filtrar",
}: {
  ativos: number;
  onClick: () => void;
  rotulo?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.botao} ${ativos > 0 ? styles.botaoAtivo : ""}`}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={ativos > 0 ? `${rotulo} — ${ativos} ativo(s)` : rotulo}
    >
      <Icon name="search" size={15} />
      <span>{rotulo}</span>
      {ativos > 0 && <span className={styles.n}>{ativos}</span>}
    </button>
  );
}

/**
 * O pop-up centralizado. A busca fica no topo, focada ao abrir, e cada filtro
 * vem numa `<SecaoFiltro>`.
 *
 * SEM BOTÃO DE APLICAR. Tudo o que muda aqui muda a tela na hora, atrás do
 * véu — quem digita vê o quadro encolher enquanto digita. Um "Aplicar" faria
 * a pessoa montar o filtro às cegas e só depois descobrir que ele zerou a
 * tela. Fechar o pop-up, por isso, nunca desfaz nada.
 */
export function PainelFiltros({
  titulo = "Buscar e filtrar",
  busca,
  onBusca,
  placeholder,
  ativos,
  onLimpar,
  resultado,
  onClose,
  children,
}: {
  titulo?: string;
  /**
   * Sem `onBusca`, o pop-up abre sem a linha de busca e com o título no lugar
   * dela — é o caso do Dashboard, que recorta por pessoa e não por texto.
   */
  busca?: string;
  onBusca?: (v: string) => void;
  placeholder?: string;
  ativos: number;
  onLimpar: () => void;
  /** "12 demandas", por exemplo — o efeito do filtro sem fechar o pop-up. */
  resultado?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      onClose={onClose}
      ariaLabel={titulo}
      overlayClassName={styles.overlay}
      className={styles.painel}
    >
      {onBusca ? (
        <div className={styles.buscaLinha}>
          <Icon name="search" size={17} />
          <input
            className={styles.busca}
            placeholder={placeholder}
            value={busca ?? ""}
            onChange={(e) => onBusca(e.target.value)}
            // Abrir o pop-up é, quase sempre, querer digitar. O foco vai direto
            // para a busca, e não para o primeiro botão que o `<Modal>` acharia.
            autoFocus
            aria-label={placeholder}
          />
          {busca && (
            <button
              type="button"
              className={styles.limparBusca}
              onClick={() => onBusca("")}
              aria-label="Apagar a busca"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ) : (
        <div className={styles.buscaLinha}>
          <Icon name="filter" size={17} />
          <span className={styles.titulo}>{titulo}</span>
        </div>
      )}

      {children && <div className={styles.corpo}>{children}</div>}

      <div className={styles.pe}>
        {resultado && (
          <span className={styles.resultado} role="status">
            {resultado}
          </span>
        )}
        <span className={styles.grow} />
        {ativos > 0 && (
          <button type="button" className={styles.limpar} onClick={onLimpar}>
            Limpar tudo
          </button>
        )}
        <button type="button" className={styles.pronto} onClick={onClose}>
          Pronto
        </button>
      </div>
    </Modal>
  );
}

/** Uma seção do pop-up: rótulo pequeno em cima, controles embaixo. */
export function SecaoFiltro({
  titulo,
  acoes,
  children,
}: {
  titulo: string;
  /** Controles que ficam à direita do rótulo (modo das tags, por exemplo). */
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.secao}>
      <div className={styles.secaoHead}>
        <span className={styles.secaoTit}>{titulo}</span>
        {acoes}
      </div>
      {children}
    </section>
  );
}

/**
 * Opções de escolha única em pílulas, para listas curtas (prioridade, por
 * exemplo). Lista longa, como a de pessoas, continua no `<Select>`: doze
 * pílulas de nome viram uma parede de texto.
 */
export function PilulasFiltro<V extends string>({
  valor,
  opcoes,
  onChange,
}: {
  valor: V;
  opcoes: { value: V; label: string; color?: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div className={styles.pilulas} role="radiogroup">
      {opcoes.map((o) => {
        const on = o.value === valor;
        return (
          <button
            key={o.value || "_"}
            type="button"
            role="radio"
            aria-checked={on}
            className={`${styles.pilula} ${on ? styles.pilulaOn : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.color && (
              <span className={styles.ponto} style={{ background: o.color }} />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
