"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { Combobox } from "@/components/combobox";
import {
  DEMAND_TYPES,
  DEMAND_TYPE_LABEL,
  KNOWN_PRIORITIES,
  PRIORITY_LABEL,
  type Card,
  type ChecklistItem,
  type DemandType,
  type Priority,
} from "@/lib/kanban";
import { normalizarUrl, type CardLink } from "@/lib/links-core";
import { normalizarTag } from "@/lib/tags-core";
import { ehFimDeSemanaISO } from "@/lib/datas";
import {
  CAMPO_DA_ETAPA_ROTULO,
  type CampoDaEtapa,
  type ExigenciaDaEtapa,
} from "@/lib/etapas-core";
import styles from "./kanban.module.css";

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
}

/** O que a caixa entrega para quem grava: campos do card e o comentário. */
export type ColheitaDaPassagem = {
  campos: Partial<Omit<Card, "id">>;
  comentario: string;
};

/**
 * A caixa de passagem de etapa (#212).
 *
 * Abre quando o card é arrastado para uma etapa que pede campos que ele ainda
 * não tem — e SÓ esses: o que já está preenchido não é perguntado de novo. É o
 * "formulário da fase" do Pipefy, e é pequena de propósito: quem arrastou quer
 * mover, e a caixa existe para colher o mínimo que a etapa precisa, não para
 * virar o modal completo no meio do gesto.
 *
 * OBRIGATÓRIO TRAVA O BOTÃO; sugerido pode ficar em branco. Cancelar devolve o
 * card para onde estava — o movimento ainda não aconteceu (ver `onColDrop`), e
 * por isso não há nada a desfazer.
 *
 * O que foi preenchido grava junto com o movimento, no mesmo lote e com o
 * histórico (`moveCard`).
 */
export function PassagemDeEtapa({
  card,
  destino,
  pede,
  pessoas,
  produtos,
  solicitantes,
  autor,
  onConfirmar,
  onCancelar,
}: {
  card: Card;
  /** Quem está movendo — assina o link colado aqui, como no modal. */
  autor: string;
  destino: string;
  pede: readonly ExigenciaDaEtapa[];
  /** Responsáveis possíveis, com "— Ninguém —" na frente. */
  pessoas: SelectOption[];
  /** Produtos do Portfólio do setor, com "— Sem produto —" na frente. */
  produtos: SelectOption[];
  solicitantes: SelectOption[];
  onConfirmar: (c: ColheitaDaPassagem) => Promise<void>;
  onCancelar: () => void;
}) {
  const [assignee, setAssignee] = useState(card.assignee ?? "");
  const [due, setDue] = useState(card.due ?? "");
  const [startDate, setStartDate] = useState(card.startDate ?? "");
  const [priority, setPriority] = useState<string>(card.priority ?? "media");
  const [type, setType] = useState<string>(card.type ?? "implementacao");
  const [produtoId, setProdutoId] = useState(card.produtoId ?? "");
  const [requester, setRequester] = useState(card.requester ?? "");
  const [tagsTexto, setTagsTexto] = useState("");
  const [itens, setItens] = useState<ChecklistItem[]>([]);
  const [novoItem, setNovoItem] = useState("");
  const [description, setDescription] = useState(card.description ?? "");
  const [link, setLink] = useState("");
  const [comentario, setComentario] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const tags = tagsTexto
    .split(",")
    .map(normalizarTag)
    .filter(Boolean);
  const urlDoLink = normalizarUrl(link);

  /** O campo foi respondido NESTA caixa? É o que decide se o botão libera. */
  function respondido(c: CampoDaEtapa): boolean {
    switch (c) {
      case "assignee":
        return !!assignee;
      case "due":
        return !!due;
      case "startDate":
        return !!startDate;
      case "priority":
        return !!priority;
      case "type":
        return !!type;
      case "produtoId":
        return !!produtoId;
      case "requester":
        return !!requester;
      case "tags":
        return tags.length > 0;
      case "checklist":
        return itens.length > 0;
      case "description":
        return !!description.trim();
      case "links":
        return !!urlDoLink;
      case "comentario":
        return !!comentario.trim();
    }
  }

  const faltam = pede.filter((e) => e.obrigatorio && !respondido(e.campo));

  function colher(): ColheitaDaPassagem {
    const campos: Partial<Omit<Card, "id">> = {};
    const quer = (c: CampoDaEtapa) => pede.some((e) => e.campo === c) && respondido(c);
    if (quer("assignee")) campos.assignee = assignee;
    if (quer("due")) campos.due = due;
    if (quer("startDate")) campos.startDate = startDate;
    if (quer("priority")) campos.priority = priority as Priority;
    if (quer("type")) campos.type = type as DemandType;
    if (quer("produtoId")) campos.produtoId = produtoId;
    if (quer("requester")) campos.requester = requester;
    // Tags, checklist e links SOMAM ao que o card já tem: a caixa só aparece
    // quando a lista está vazia, mas outra pessoa pode ter mexido no card
    // enquanto ela estava aberta.
    if (quer("tags")) campos.tags = [...new Set([...(card.tags ?? []), ...tags])];
    if (quer("checklist")) campos.checklist = [...(card.checklist ?? []), ...itens];
    if (quer("description")) campos.description = description.trim();
    if (quer("links") && urlDoLink) {
      const novo: CardLink = {
        id: uid(),
        url: urlDoLink,
        addedBy: autor,
        addedAt: Date.now(),
      };
      campos.links = [...(card.links ?? []), novo];
    }
    return { campos, comentario: quer("comentario") ? comentario.trim() : "" };
  }

  async function confirmar() {
    if (faltam.length || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await onConfirmar(colher());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mover a demanda.");
      setSalvando(false);
    }
  }

  function rotulo(e: ExigenciaDaEtapa) {
    return (
      <label className={styles.label}>
        {CAMPO_DA_ETAPA_ROTULO[e.campo]}
        {e.obrigatorio ? (
          <span className={styles.passagemObrig}> · obrigatório</span>
        ) : (
          <span className={styles.passagemOpc}> · se souber</span>
        )}
      </label>
    );
  }

  function campo(e: ExigenciaDaEtapa) {
    switch (e.campo) {
      case "assignee":
        return (
          <Select value={assignee} options={pessoas} onChange={setAssignee} ariaLabel="Responsável" />
        );
      case "due":
      case "startDate": {
        const valor = e.campo === "due" ? due : startDate;
        const set = e.campo === "due" ? setDue : setStartDate;
        return (
          <>
            <input
              type="date"
              className={styles.inp}
              value={valor}
              onChange={(ev) => set(ev.target.value)}
              aria-label={CAMPO_DA_ETAPA_ROTULO[e.campo]}
            />
            {/* Aviso e não recusa: a regra de dia útil mora no modal, que é
                onde a data é planejada. Aqui ela é anotada no meio do gesto. */}
            {!!valor && ehFimDeSemanaISO(valor) && (
              <div className={styles.avisoDataNota}>Essa data cai num fim de semana.</div>
            )}
          </>
        );
      }
      case "priority":
        return (
          <Select
            value={priority}
            options={KNOWN_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            onChange={setPriority}
            ariaLabel="Prioridade"
          />
        );
      case "type":
        return (
          <Select
            value={type}
            options={DEMAND_TYPES.map((t) => ({ value: t, label: DEMAND_TYPE_LABEL[t] }))}
            onChange={setType}
            ariaLabel="Tipo"
          />
        );
      case "produtoId":
        return (
          <Combobox
            value={produtoId}
            options={produtos}
            onChange={setProdutoId}
            placeholder="— Sem produto —"
            ariaLabel="Produto do portfólio"
          />
        );
      case "requester":
        return (
          <Combobox
            value={requester}
            options={solicitantes}
            onChange={setRequester}
            placeholder="Digite para buscar…"
            ariaLabel="Solicitante"
          />
        );
      case "tags":
        return (
          <input
            className={styles.inp}
            value={tagsTexto}
            onChange={(ev) => setTagsTexto(ev.target.value)}
            placeholder="separadas por vírgula"
            aria-label="Tags"
          />
        );
      case "checklist":
        return (
          <div className={styles.passagemLista}>
            {itens.map((it, i) => (
              <div key={it.id ?? i} className={styles.passagemItem}>
                <span>{it.text}</span>
                <button
                  type="button"
                  className={styles.checkDel}
                  onClick={() => setItens(itens.filter((_, j) => j !== i))}
                  aria-label={`Remover ${it.text}`}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
            <input
              className={styles.inp}
              value={novoItem}
              onChange={(ev) => setNovoItem(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && novoItem.trim()) {
                  ev.preventDefault();
                  setItens([...itens, { id: uid(), text: novoItem.trim(), done: false }]);
                  setNovoItem("");
                }
              }}
              placeholder="Item do checklist — Enter adiciona"
              aria-label="Adicionar item ao checklist"
            />
          </div>
        );
      case "description":
        return (
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            aria-label="Descrição"
          />
        );
      case "links":
        return (
          <>
            <input
              className={styles.inp}
              value={link}
              onChange={(ev) => setLink(ev.target.value)}
              placeholder="Colar o link…"
              inputMode="url"
              aria-label="Link"
            />
            {!!link.trim() && !urlDoLink && (
              <div className={styles.avisoDataNota}>
                Endereço inválido — cole um link começando com http:// ou https://.
              </div>
            )}
          </>
        );
      case "comentario":
        return (
          <textarea
            className={styles.textarea}
            value={comentario}
            onChange={(ev) => setComentario(ev.target.value)}
            placeholder={`O que muda ao entrar em ${destino}? Aguardando o quê, ou quem?`}
            aria-label="Comentário da passagem"
          />
        );
    }
  }

  return (
    <Modal
      onClose={onCancelar}
      podeFechar={() => !salvando}
      ariaLabel={`Mover para ${destino}`}
      overlayClassName={styles.overlay}
      className={`${styles.modal} ${styles.passagem}`}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="kanban" size={12} /> Mover para {destino}
        </span>
      </div>
      <div className={styles.passagemTitulo}>{card.title}</div>
      <p className={styles.passagemIntro}>
        Esta etapa pede {pede.length === 1 ? "um campo" : "alguns campos"} que a
        demanda ainda não tem.
      </p>

      {pede.map((e) => (
        <div key={e.campo} className={styles.field}>
          {rotulo(e)}
          {campo(e)}
        </div>
      ))}

      {erro && <div className={styles.err}>{erro}</div>}
      <div className={styles.passagemAcoes}>
        <button type="button" className={styles.btnGhost} onClick={onCancelar} disabled={salvando}>
          Cancelar
        </button>
        <button
          type="button"
          className={styles.btnSave}
          onClick={() => void confirmar()}
          disabled={salvando || faltam.length > 0}
          title={
            faltam.length
              ? `Falta: ${faltam.map((f) => CAMPO_DA_ETAPA_ROTULO[f.campo]).join(", ")}`
              : undefined
          }
        >
          {salvando ? "Movendo…" : `Mover para ${destino}`}
        </button>
      </div>
    </Modal>
  );
}
