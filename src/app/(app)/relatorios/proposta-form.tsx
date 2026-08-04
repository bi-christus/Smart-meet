"use client";

/**
 * Uma demanda proposta, pronta para virar card — com o mesmo formulário que se
 * usa para criar demanda no Kanban.
 *
 * Duas escolhas de desenho valem explicar:
 *
 * 1. A EVIDÊNCIA fica ao lado, sempre visível, nunca atrás de um clique. Uma
 *    fila que exige abrir cada item para conferir vira uma fila que se aceita
 *    no atacado — e aí a blindagem contra erro da IA é só enfeite.
 * 2. Responsável, solicitante e datas aparecem VAZIOS. A IA não os propõe de
 *    propósito: são o que a transcrição mais erra ("dia doze" e "dia dois"
 *    soam igual). Quem valida é quem decide. As datas são opcionais para a
 *    fila andar; o card avisa quando entra sem prazo.
 */
import { useEffect, useMemo, useState } from "react";
import {
  DEMAND_TYPE_LABEL,
  PRIORITY_LABEL,
  subscribeColumns,
  type ChecklistItem,
  type ColumnDoc,
  type DemandType,
  type Priority,
} from "@/lib/kanban";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import {
  subscribeSolicitantes,
  subscribeSolicitanteSetores,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import { decidirProposta, CERTEZA_LABEL, type Proposta } from "@/lib/demandas";
import { Icon } from "@/components/icons";
import { SolicitantePicker } from "@/components/solicitante-picker";
import styles from "./relatorios.module.css";

let seq = 0;
const uid = () => `it${++seq}`;

export function PropostaForm({
  proposta: p,
  sector,
  onErro,
}: {
  proposta: Proposta;
  sector: string;
  onErro: (e: string | null) => void;
}) {
  const [title, setTitle] = useState(p.proposta.title);
  const [description, setDescription] = useState(p.proposta.description);
  const [type, setType] = useState<DemandType>(
    (p.proposta.type as DemandType) ?? "implementacao",
  );
  const [priority, setPriority] = useState<Priority>("media");
  const [colunaEscolhida, setColunaEscolhida] = useState("");
  const [assignee, setAssignee] = useState("");
  const [requester, setRequester] = useState("");
  const [requesterSector, setRequesterSector] = useState("");
  const [startDate, setStartDate] = useState("");
  const [due, setDue] = useState("");
  const [tags, setTags] = useState<string[]>(p.proposta.tags ?? []);
  const [novaTag, setNovaTag] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() =>
    (p.proposta.checklist ?? []).map((it) => ({
      id: uid(),
      text: it.text,
      desc: it.desc,
      done: false,
    })),
  );
  const [novoItem, setNovoItem] = useState("");
  const [motivo, setMotivo] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const [colunas, setColunas] = useState<ColumnDoc[]>([]);
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [solicitantes, setSolicitantes] = useState<Solicitante[]>([]);
  const [setoresSol, setSetoresSol] = useState<SolicitanteSetor[]>([]);

  const alvo = p.sectorAlvo || sector;

  useEffect(() => {
    const a = subscribeColumns(alvo, setColunas);
    const b = subscribeUsers(setUsuarios);
    const c = subscribeSolicitantes(setSolicitantes);
    const d = subscribeSolicitanteSetores(setSetoresSol);
    return () => {
      a();
      b();
      c();
      d();
    };
  }, [alvo]);

  // A coluna padrão é DERIVADA, não guardada: escrever no estado dentro de um
  // efeito causaria um render extra e um instante em que o formulário mostra
  // "nenhuma coluna" antes de se corrigir sozinho.
  const colunasOrd = useMemo(
    () => [...colunas].sort((a, b) => a.order - b.order),
    [colunas],
  );
  const columnId = colunaEscolhida || colunasOrd[0]?.colId || "";

  const doSetor = useMemo(
    () => usuarios.filter((u) => u.active && (u.sectors ?? []).includes(alvo)),
    [usuarios, alvo],
  );

  function addItem() {
    const t = novoItem.trim();
    if (!t) return;
    setChecklist((c) => [...c, { id: uid(), text: t, done: false }]);
    setNovoItem("");
  }
  function editItem(i: number, v: string) {
    setChecklist((c) => c.map((it, k) => (k === i ? { ...it, text: v } : it)));
  }
  function editDesc(i: number, v: string) {
    setChecklist((c) => c.map((it, k) => (k === i ? { ...it, desc: v } : it)));
  }
  function removeItem(i: number) {
    setChecklist((c) => c.filter((_, k) => k !== i));
  }
  function addTag() {
    const t = novaTag.trim();
    if (!t || tags.includes(t)) return;
    setTags((x) => [...x, t]);
    setNovaTag("");
  }

  async function decidir(decisao: "aceitar" | "recusar") {
    onErro(null);
    if (decisao === "recusar" && !recusando) {
      setRecusando(true);
      return;
    }
    if (decisao === "aceitar" && !title.trim()) {
      onErro("A demanda precisa de um título.");
      return;
    }
    setOcupado(true);
    try {
      await decidirProposta({
        propostaId: p.id,
        decisao,
        motivo: motivo.trim() || undefined,
        edicao:
          decisao === "aceitar"
            ? {
                title: title.trim(),
                description: description.trim(),
                type,
                priority,
                columnId,
                tags,
                checklist: checklist
                  .map((it) => ({ text: it.text.trim(), desc: it.desc }))
                  .filter((it) => it.text),
                assignee: assignee || null,
                requester: requester || null,
                requesterSector: requesterSector || null,
                startDate: startDate || null,
                due: due || null,
              }
            : undefined,
      });
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível decidir.");
      setOcupado(false);
    }
  }

  return (
    <article className={styles.proposta}>
      <div className={styles.propCabeca}>
        <span className={`${styles.certeza} ${styles[`c_${p.certezaLLM}`]}`}>
          {CERTEZA_LABEL[p.certezaLLM]}
        </span>
        <span className={styles.assunto}>{p.assunto}</span>
      </div>

      <div className={styles.propCorpo}>
        <div className={styles.form}>
          <label className={styles.rot}>Título</label>
          <input
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />

          <label className={styles.rot}>Descrição</label>
          <textarea
            className={styles.area}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Contexto, requisitos, links…"
          />

          <div className={styles.linha3}>
            <div>
              <label className={styles.rot}>Tipo</label>
              <select
                className={styles.select}
                value={type}
                onChange={(e) => setType(e.target.value as DemandType)}
              >
                {Object.entries(DEMAND_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.rot}>Prioridade</label>
              <select
                className={styles.select}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={styles.rot}>Coluna</label>
              <select
                className={styles.select}
                value={columnId}
                onChange={(e) => setColunaEscolhida(e.target.value)}
              >
                {colunasOrd.map((c) => (
                    <option key={c.colId} value={c.colId}>
                      {c.title}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className={styles.linha3}>
            <div>
              <label className={styles.rot}>Responsável</label>
              <select
                className={styles.select}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Sem responsável</option>
                {doSetor.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
            </div>
            <SolicitantePicker
              setores={setoresSol}
              solicitantes={solicitantes}
              setorValue={requesterSector}
              requesterValue={requester}
              onSetor={setRequesterSector}
              onRequester={setRequester}
              classes={{ select: styles.select, input: styles.input }}
            />
          </div>

          <div className={styles.linha2}>
            <div>
              <label className={styles.rot}>Início (opcional)</label>
              <input
                type="date"
                className={styles.input}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className={styles.rot}>Prazo (opcional)</label>
              <input
                type="date"
                className={styles.input}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>
          {!due && (
            <p className={styles.avisoPrazo}>
              Sem prazo, a demanda entra no quadro marcada como “sem prazo
              definido”.
            </p>
          )}

          <label className={styles.rot}>Etiquetas</label>
          <div className={styles.tags}>
            {tags.map((t) => (
              <span key={t} className={styles.tag}>
                {t}
                <button
                  onClick={() => setTags((x) => x.filter((y) => y !== t))}
                  aria-label={`Remover ${t}`}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
            <input
              className={styles.tagInput}
              value={novaTag}
              onChange={(e) => setNovaTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="nova etiqueta…"
            />
          </div>

          <div className={styles.rot}>
            Atividades{checklist.length > 0 ? ` · ${checklist.length}` : ""}
          </div>
          {checklist.map((it, i) => (
            <div key={it.id ?? i} className={styles.checkRow}>
              <div className={styles.checkMain}>
                <input
                  className={styles.checkText}
                  value={it.text}
                  onChange={(e) => editItem(i, e.target.value)}
                  aria-label="Atividade"
                />
                <button
                  className={styles.checkDel}
                  onClick={() => removeItem(i)}
                  aria-label="Remover atividade"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              <input
                className={styles.checkDesc}
                value={it.desc ?? ""}
                onChange={(e) => editDesc(i, e.target.value)}
                placeholder="mini descrição (opcional)"
                aria-label="Descrição da atividade"
              />
            </div>
          ))}
          <div className={styles.checkAdd}>
            <input
              value={novoItem}
              onChange={(e) => setNovoItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
              placeholder="Adicionar atividade…"
              aria-label="Adicionar atividade"
            />
            <button className={styles.checkAddBtn} onClick={addItem}>
              Adicionar
            </button>
          </div>
        </div>

        <aside className={styles.evidencia}>
          <span className={styles.evidenciaRot}>O que foi dito na reunião</span>
          {p.evidencia.map((e, i) => (
            <blockquote key={i} className={styles.citacao}>
              {e.marca && <span className={styles.marca}>{e.marca}</span>}
              {e.citacao}
            </blockquote>
          ))}
          <p className={styles.resumoProp}>{p.resumo}</p>
          {p.conferir.length > 0 && (
            <ul className={styles.conferir}>
              {p.conferir.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
          {p.possivelDuplicataDe.length > 0 && (
            <p className={styles.duplicata}>
              Pode já existir — {p.possivelDuplicataDe.length} demanda(s)
              parecida(s) no quadro.
            </p>
          )}
        </aside>
      </div>

      {recusando && (
        <input
          className={styles.input}
          placeholder="Por que está recusando? (ajuda a corrigir o gerador)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={500}
        />
      )}

      <footer className={styles.propAcoes}>
        <button
          className={styles.btnNao}
          onClick={() => decidir("recusar")}
          disabled={ocupado}
        >
          {recusando ? "Confirmar recusa" : "Recusar"}
        </button>
        <button
          className={styles.btnSave}
          onClick={() => decidir("aceitar")}
          disabled={ocupado || !title.trim()}
        >
          {ocupado ? "Salvando…" : "Criar demanda"}
        </button>
      </footer>
    </article>
  );
}
