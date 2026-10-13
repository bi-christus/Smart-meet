"use client";

import Link from "next/link";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/icons";
import { dueInfo } from "@/lib/prazo-core";
import {
  SAUDE_ROTULO,
  rotuloDoSelo,
  type AndamentoDoProduto,
  type CardDoProduto,
} from "@/lib/produtos-core";
import type { LinkDoSetor } from "@/lib/links-do-setor";
import { SeloDoLink } from "./selo";
import styles from "./links.module.css";

/** Quantas entregas a gaveta lista. O histórico inteiro mora no Kanban. */
const ULTIMAS_ENTREGAS = 5;

/**
 * A gaveta do produto — o andamento dele, sem sair do Portfólio (#209).
 *
 * Abre pelo selo "N em andamento" do card, e só ele: o clique no NOME continua
 * abrindo o produto, porque o Portfólio é acesso rápido antes de tudo. Quem
 * entra aqui quer saber três coisas, na ordem em que estão desenhadas: onde as
 * demandas estão, o que vence primeiro, e o que já saiu.
 *
 * CADA DEMANDA É UM LINK PARA O CARD NO QUADRO (`/kanban?setor=…&card=…`, o
 * mesmo caminho do Cronograma). A gaveta não edita nada: ela é leitura, e o
 * lugar de mexer na demanda continua sendo o Kanban.
 */
export function ProdutoGaveta({
  produto,
  andamento,
  onFechar,
}: {
  produto: LinkDoSetor;
  andamento: AndamentoDoProduto;
  onFechar: () => void;
}) {
  const doCard = (c: CardDoProduto) =>
    `/kanban?setor=${encodeURIComponent(c.sector)}&card=${encodeURIComponent(c.id)}`;
  const maiorEtapa = Math.max(...andamento.porEtapa.map((e) => e.n), 1);

  return (
    <Modal
      onClose={onFechar}
      ariaLabel={`Andamento de ${produto.nome}`}
      overlayClassName={styles.overlay}
      className={`${styles.modal} ${styles.gaveta}`}
    >
      <div className={styles.gavetaHead}>
        <SeloDoLink link={produto} />
        <div className={styles.gavetaTitulo}>
          <span className={styles.modalTitulo}>{produto.nome}</span>
          <span className={`${styles.saude} ${styles["saude_" + andamento.saude]}`}>
            <i aria-hidden />
            {rotuloDoSelo(andamento)} · {SAUDE_ROTULO[andamento.saude]}
          </span>
        </div>
        <button
          type="button"
          className={styles.editar}
          onClick={onFechar}
          aria-label="Fechar o andamento"
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className={styles.gavetaCorpo}>
        <section>
          <h3 className={styles.gavetaSecao}>Onde estão</h3>
          <ul className={styles.etapas}>
            {andamento.porEtapa.map((e) => (
              <li key={e.colId}>
                <span className={styles.etapaNome}>{e.title}</span>
                {/* A barra é proporcional à maior etapa, e o número vem escrito
                    ao lado: cor e comprimento sozinhos não dizem quantas. */}
                <span className={styles.etapaTrilho}>
                  <span
                    className={styles.etapaBarra}
                    style={{ width: `${(e.n / maiorEtapa) * 100}%` }}
                  />
                </span>
                <b className={styles.etapaN}>{e.n}</b>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className={styles.gavetaSecao}>Próximos prazos</h3>
          {andamento.proximosPrazos.length === 0 ? (
            <p className={styles.gavetaVazio}>
              Nenhuma demanda aberta deste produto tem prazo definido.
            </p>
          ) : (
            <ul className={styles.demandas}>
              {andamento.proximosPrazos.map((c) => {
                const di = dueInfo(c.due, false);
                return (
                  <li key={c.id}>
                    <Link href={doCard(c)} className={styles.demanda}>
                      <span className={styles.demandaTitulo}>{c.title}</span>
                      {di && (
                        <span className={`${styles.prazo} ${styles["prazo_" + di.tone]}`}>
                          {di.label}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h3 className={styles.gavetaSecao}>Últimas entregas</h3>
          {andamento.entregues.length === 0 ? (
            <p className={styles.gavetaVazio}>
              Nenhuma demanda deste produto foi entregue ainda.
            </p>
          ) : (
            <ul className={styles.demandas}>
              {andamento.entregues.slice(0, ULTIMAS_ENTREGAS).map((c) => (
                <li key={c.id}>
                  <Link href={doCard(c)} className={styles.demanda}>
                    <span className={styles.demandaTitulo}>{c.title}</span>
                    {c.enteredAt ? (
                      <span className={styles.prazo}>
                        {new Date(c.enteredAt).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
