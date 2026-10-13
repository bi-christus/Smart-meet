"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import styles from "./kanban.module.css";

/**
 * Abrir demanda direto na coluna — só título e produto (#210).
 *
 * É o formulário inicial do Pipefy aplicado ao quadro: o "+" da coluna abria o
 * modal inteiro, com quinze campos, para quem só queria anotar "ajustar filtro
 * do painel de vendas" antes de esquecer. Aqui a demanda nasce com o que se
 * sabe na hora; o resto se preenche no modal ou na passagem de etapa, quando
 * a informação existe.
 *
 * O TECLADO É O CAMINHO PRINCIPAL. Enter cria e a linha FICA ABERTA, vazia,
 * pronta para a próxima — quem sai de uma reunião com cinco demandas digita
 * cinco linhas sem tocar no mouse. Escape fecha. "Mais campos" leva o que já foi
 * digitado para o modal completo, em vez de jogar fora.
 *
 * O ERRO FICA NA LINHA, e o texto também: uma gravação negada não pode apagar o
 * título que a pessoa acabou de digitar.
 */
export function CriacaoRapida({
  coluna,
  produtos,
  onCriar,
  onMaisCampos,
  onFechar,
}: {
  /** Nome da etapa, para o placeholder dizer onde a demanda vai nascer. */
  coluna: string;
  /** As opções de produto, com "— Sem produto —" na frente. Vazia = sem seletor. */
  produtos: SelectOption[];
  onCriar: (titulo: string, produtoId: string) => Promise<void>;
  onMaisCampos: (titulo: string, produtoId: string) => void;
  onFechar: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    const t = titulo.trim();
    if (!t || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await onCriar(t, produtoId);
      // O produto FICA escolhido: as demandas anotadas em sequência quase
      // sempre são do mesmo produto, e escolher de novo a cada uma é o atrito
      // que esta linha existe para tirar.
      setTitulo("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar a demanda.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className={styles.rapida}
      // A linha mora dentro da coluna, que é alvo de soltura e abre o card ao
      // clique em alguns lugares: nada daqui pode vazar para ela.
      onClick={(e) => e.stopPropagation()}
    >
      <input
        className={styles.rapidaTitulo}
        value={titulo}
        onChange={(e) => {
          setTitulo(e.target.value);
          if (erro) setErro(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void criar();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onFechar();
          }
        }}
        placeholder={`Nova demanda em ${coluna}…`}
        aria-label={`Título da nova demanda em ${coluna}`}
        maxLength={200}
        autoFocus
        disabled={salvando}
      />
      {produtos.length > 1 && (
        <Select
          value={produtoId}
          options={produtos}
          onChange={setProdutoId}
          placeholder="— Sem produto —"
          ariaLabel="Produto do portfólio"
        />
      )}
      {erro && (
        <div className={styles.rapidaErro} role="alert">
          {erro}
        </div>
      )}
      <div className={styles.rapidaAcoes}>
        <button
          type="button"
          className={styles.rapidaMais}
          onClick={() => onMaisCampos(titulo.trim(), produtoId)}
          title="Abrir o formulário completo com o que já foi digitado"
        >
          Mais campos
        </button>
        <span className={styles.rapidaDica}>Enter cria · Esc fecha</span>
        <button
          type="button"
          className={styles.rapidaCriar}
          onClick={() => void criar()}
          disabled={salvando || !titulo.trim()}
        >
          <Icon name="plus" size={13} />
          {salvando ? "Criando…" : "Criar"}
        </button>
      </div>
    </div>
  );
}
