"use client";

/**
 * Fila de validação das demandas propostas a partir das reuniões.
 *
 * Regras de desenho, porque elas explicam o que parece estranho:
 *
 * - A EVIDÊNCIA fica ao lado da proposta, sempre visível, nunca atrás de um
 *   clique. Uma fila que exige abrir cada item para conferir vira uma fila que
 *   se aceita no atacado — e aí toda a blindagem contra erro da IA é teatro.
 * - Aceitar é UM item por vez. Não existe "aceitar todas": três demandas novas
 *   erradas são ruído removível, mas aprovar em bloco sem ler é o hábito que
 *   transforma erro de IA em dado de produção.
 * - Editar antes de aceitar é o caminho normal, não a exceção. O que foi
 *   editado é gravado, e é assim que vamos saber se o gerador está bom.
 * - Recusar pede motivo. É o único sinal que diz se o problema é a proposta ou
 *   o gerador.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { DEFAULT_SECTORS } from "@/lib/users";
import {
  subscribePropostas,
  subscribeLotes,
  decidirProposta,
  CERTEZA_LABEL,
  type Proposta,
  type Lote,
} from "@/lib/demandas";
import { DEMAND_TYPE_LABEL, type DemandType } from "@/lib/kanban";
import { Icon } from "@/components/icons";
import styles from "./demandas.module.css";

export default function DemandasPage() {
  const { profile } = useAuth();

  const sectors = useMemo(
    () =>
      profile
        ? profile.role === "admin"
          ? DEFAULT_SECTORS
          : (profile.sectors ?? [])
        : [],
    [profile],
  );

  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [aba, setAba] = useState<"pendentes" | "decididas">("pendentes");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const a = subscribePropostas(sectors, setPropostas, (e) =>
      console.error("Erro ao carregar propostas:", e),
    );
    const b = subscribeLotes(sectors, setLotes, (e) =>
      console.error("Erro ao carregar lotes:", e),
    );
    return () => {
      a();
      b();
    };
  }, [sectors]);

  const porLote = useMemo(() => new Map(lotes.map((l) => [l.id, l])), [lotes]);

  const pendentes = useMemo(
    () => propostas.filter((p) => p.status === "pendente"),
    [propostas],
  );
  const decididas = useMemo(
    () =>
      propostas
        .filter((p) => p.status === "aceita" || p.status === "recusada")
        .slice(0, 60),
    [propostas],
  );

  // Agrupa por reunião: decidir "isto já existe" numa proposta muda a leitura
  // da seguinte, então elas precisam ser vistas juntas.
  const grupos = useMemo(() => {
    const m = new Map<string, Proposta[]>();
    for (const p of pendentes) {
      const arr = m.get(p.loteId) ?? [];
      arr.push(p);
      m.set(p.loteId, arr);
    }
    return [...m.entries()];
  }, [pendentes]);

  const lotesComRuido = useMemo(
    () =>
      lotes.filter(
        (l) =>
          (l.rejeitadasNoIngest?.length ?? 0) > 0 || l.status === "rejeitado",
      ),
    [lotes],
  );

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <main className={styles.wrap}>
        <p className={styles.vazio}>
          Você ainda não participa de nenhum setor. Fale com o setor de B.I.
        </p>
      </main>
    );
  }

  return (
    <main className={styles.wrap}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>Demandas propostas</h1>
          <p className={styles.sub}>
            Sugestões geradas a partir das reuniões. Nada vira demanda sem você
            aceitar.
          </p>
        </div>
        <div className={styles.abas}>
          <button
            className={`${styles.aba} ${aba === "pendentes" ? styles.on : ""}`}
            onClick={() => setAba("pendentes")}
          >
            A validar{pendentes.length > 0 ? ` (${pendentes.length})` : ""}
          </button>
          <button
            className={`${styles.aba} ${aba === "decididas" ? styles.on : ""}`}
            onClick={() => setAba("decididas")}
          >
            Decididas
          </button>
        </div>
      </header>

      {erro && <p className={styles.erro}>{erro}</p>}

      {aba === "pendentes" && (
        <>
          {lotesComRuido.length > 0 && (
            <section className={styles.avisos}>
              {lotesComRuido.map((l) => (
                <p key={l.id} className={styles.aviso}>
                  <Icon name="clock" />
                  <span>
                    <strong>{l.base || "Reunião"}</strong>:{" "}
                    {l.status === "rejeitado"
                      ? `arquivo de demandas recusado — ${l.motivoRejeicao}`
                      : `${l.rejeitadasNoIngest!.length} proposta(s) descartada(s) na leitura — ${l.rejeitadasNoIngest!
                          .map((r) => r.motivo)
                          .join("; ")}`}
                  </span>
                </p>
              ))}
            </section>
          )}

          {grupos.length === 0 ? (
            <p className={styles.vazio}>
              Nenhuma proposta esperando validação. Elas aparecem aqui depois
              que uma reunião é processada.
            </p>
          ) : (
            grupos.map(([loteId, itens]) => (
              <section key={loteId} className={styles.grupo}>
                <h2 className={styles.grupoTitulo}>
                  {porLote.get(loteId)?.base || "Reunião"}
                  <span className={styles.grupoContagem}>
                    {itens.length} proposta{itens.length > 1 ? "s" : ""}
                  </span>
                </h2>
                {itens.map((p) => (
                  <CartaoProposta key={p.id} proposta={p} onErro={setErro} />
                ))}
              </section>
            ))
          )}
        </>
      )}

      {aba === "decididas" && (
        <section className={styles.grupo}>
          {decididas.length === 0 ? (
            <p className={styles.vazio}>Nada decidido ainda.</p>
          ) : (
            decididas.map((p) => (
              <article key={p.id} className={styles.decidida}>
                <span
                  className={`${styles.selo} ${
                    p.status === "aceita" ? styles.seloOk : styles.seloNao
                  }`}
                >
                  {p.status === "aceita" ? "Aceita" : "Recusada"}
                </span>
                <div>
                  <strong>{p.proposta.title}</strong>
                  <p className={styles.decididaMeta}>
                    {p.decisao?.por}
                    {p.decisao?.motivo ? ` — ${p.decisao.motivo}` : ""}
                    {p.decisao?.camposEditados?.length
                      ? ` · editou: ${p.decisao.camposEditados.join(", ")}`
                      : ""}
                  </p>
                </div>
              </article>
            ))
          )}
        </section>
      )}
    </main>
  );
}

function CartaoProposta({
  proposta: p,
  onErro,
}: {
  proposta: Proposta;
  onErro: (e: string | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [title, setTitle] = useState(p.proposta.title);
  const [description, setDescription] = useState(p.proposta.description);
  const [tipo, setTipo] = useState(p.proposta.type);
  const [prioridade, setPrioridade] = useState("media");
  const [motivo, setMotivo] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function decidir(decisao: "aceitar" | "recusar") {
    onErro(null);
    if (decisao === "recusar" && !recusando) {
      setRecusando(true);
      return;
    }
    setOcupado(true);
    try {
      // Só manda o que foi realmente alterado: `camposEditados` vira a métrica
      // de qualidade do gerador, e sujá-la com campos intocados a inutiliza.
      const edicao: Record<string, unknown> = {};
      if (title.trim() !== p.proposta.title) edicao.title = title.trim();
      if (description.trim() !== p.proposta.description)
        edicao.description = description.trim();
      if (tipo !== p.proposta.type) edicao.type = tipo;
      if (prioridade !== "media") edicao.priority = prioridade;

      await decidirProposta({
        propostaId: p.id,
        decisao,
        motivo: motivo.trim() || undefined,
        edicao: decisao === "aceitar" ? edicao : undefined,
      });
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível decidir.");
      setOcupado(false);
    }
  }

  return (
    <article className={styles.cartao}>
      <div className={styles.cartaoCabeca}>
        <span className={`${styles.certeza} ${styles[`c_${p.certezaLLM}`]}`}>
          {CERTEZA_LABEL[p.certezaLLM]}
        </span>
        <span className={styles.assunto}>{p.assunto}</span>
        {p.sectorAlvo !== p.sectorReuniao && (
          <span className={styles.crossSetor}>
            reunião de {p.sectorReuniao} → {p.sectorAlvo}
          </span>
        )}
      </div>

      <div className={styles.corpo}>
        <div className={styles.coluna}>
          {editando ? (
            <>
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
                rows={5}
              />
              <div className={styles.linha}>
                <select
                  className={styles.select}
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                >
                  {Object.entries(DEMAND_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.select}
                  value={prioridade}
                  onChange={(e) => setPrioridade(e.target.value)}
                >
                  <option value="alta">Prioridade alta</option>
                  <option value="media">Prioridade média</option>
                  <option value="baixa">Prioridade baixa</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <h3 className={styles.titulo}>{title}</h3>
              <p className={styles.desc}>{description}</p>
              <p className={styles.meta}>
                {DEMAND_TYPE_LABEL[tipo as DemandType] ?? tipo}
                {p.proposta.tags.length > 0 && ` · ${p.proposta.tags.join(", ")}`}
              </p>
              {p.proposta.checklist.length > 0 && (
                <ul className={styles.checklist}>
                  {p.proposta.checklist.map((it, i) => (
                    <li key={i}>{it.text}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {p.conferir.length > 0 && (
            <ul className={styles.conferir}>
              {p.conferir.map((c, i) => (
                <li key={i}>[CONFERIR] {c}</li>
              ))}
            </ul>
          )}

          {p.possivelDuplicataDe.length > 0 && (
            <p className={styles.duplicata}>
              Pode já existir — o gerador apontou{" "}
              {p.possivelDuplicataDe.length} demanda(s) parecida(s).
            </p>
          )}
        </div>

        {/* A evidência nunca fica escondida: é o que torna a revisão possível. */}
        <aside className={styles.evidencia}>
          <span className={styles.evidenciaRot}>O que foi dito na reunião</span>
          {p.evidencia.map((e, i) => (
            <blockquote key={i} className={styles.citacao}>
              {e.marca && <span className={styles.marca}>{e.marca}</span>}
              {e.citacao}
            </blockquote>
          ))}
          <p className={styles.resumo}>{p.resumo}</p>
        </aside>
      </div>

      {recusando && (
        <div className={styles.linha}>
          <input
            className={styles.input}
            placeholder="Por que está recusando? (ajuda a corrigir o gerador)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
          />
        </div>
      )}

      <footer className={styles.acoes}>
        <button
          className={styles.btnGhost}
          onClick={() => setEditando((v) => !v)}
          disabled={ocupado}
        >
          {editando ? "Parar de editar" : "Editar"}
        </button>
        <div className={styles.acoesDir}>
          <button
            className={styles.btnNao}
            onClick={() => decidir("recusar")}
            disabled={ocupado}
          >
            {recusando ? "Confirmar recusa" : "Recusar"}
          </button>
          <button
            className={styles.btnSim}
            onClick={() => decidir("aceitar")}
            disabled={ocupado || !title.trim()}
          >
            {ocupado ? "Salvando…" : "Aceitar e criar demanda"}
          </button>
        </div>
      </footer>
    </article>
  );
}
