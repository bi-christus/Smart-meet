"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  columnsBySector,
  colunasEntregues,
  type Card,
  type ColumnDoc,
  type KanbanColumn,
} from "@/lib/kanban";
import {
  subscribeRecorrencias,
  subscribeOcorrencias,
  createRecorrencia,
  updateRecorrencia,
  deleteRecorrencia,
  gerarCards,
  type RecorrenciaInput,
} from "@/lib/recorrencias";
import {
  nextDateOf,
  occState,
  patternLabel,
  recDates,
  recLoadHours,
  recStatus,
  REC_KIND_COLOR,
  REC_KIND_LABEL,
  REC_KINDS,
  REC_STATE_TOKENS,
  ORD_LABEL,
  WEEKDAYS,
  type OccState,
  type Ocorrencia,
  type RecKind,
  type RecPattern,
  type Recorrencia,
} from "@/lib/recorrencias-core";
import {
  addDays,
  DOW_LABEL,
  fmtDayMonth,
  hh,
  MES_LONGO,
  relDay,
  startOfDay,
  toISO,
} from "@/lib/datas";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/modal";
import { Select, type SelectOption } from "@/components/select";
import styles from "./recorrencias.module.css";

/**
 * Recorrências — a manutenção que ninguém lembra de fazer.
 *
 * Existe para um tipo de trabalho que o Kanban sozinho perde: revisar o
 * gateway, conferir a carga da base, reprocessar o que falhou. Não é urgente —
 * por isso nunca entra na fila — mas não pode acumular, e quando cobra o preço
 * já virou incidente.
 *
 * A regra aqui não é um lembrete: é um card que NASCE no Kanban do setor na
 * data combinada, com as atividades já como checklist. Cada ciclo abre um card
 * novo, e o card antigo fica no histórico mostrando o que foi feito naquele mês
 * — em vez de um card eterno que ninguém sabe quando foi tocado pela última vez.
 */

type Draft = RecorrenciaInput & { id?: string };

/** Quem precisa de atenção primeiro aparece primeiro. */
const ORDEM_LISTA: Record<string, number> = {
  late: 0,
  doing: 1,
  open: 2,
  prev: 3,
  off: 4,
};

export default function RecorrenciasPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === "admin" || profile?.role === "gestor";

  const sectors = useMemo(
    () =>
      profile
        ? profile.role === "admin"
          ? DEFAULT_SECTORS
          : (profile.sectors ?? [])
        : [],
    [profile],
  );

  const [sectorEscolhido, setSector] = useState("");
  const [recs, setRecs] = useState<Recorrencia[]>([]);
  const [occs, setOccs] = useState<Ocorrencia[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [cols, setCols] = useState<ColumnDoc[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [mesOffset, setMesOffset] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Setor DERIVADO: enquanto o perfil não carrega, `sectors` vem vazio, e
  // corrigir a escolha por efeito renderizaria um quadro com o setor errado.
  const sector = sectors.includes(sectorEscolhido)
    ? sectorEscolhido
    : (sectors[0] ?? "");

  useEffect(() => {
    const a = subscribeRecorrencias(sectors, setRecs, (e) =>
      console.error("Erro ao carregar recorrências:", e),
    );
    const b = subscribeOcorrencias(sectors, setOccs, () => {});
    const c = subscribeCardsForSectors(sectors, setCards, () => {});
    const d = subscribeColumnsForSectors(sectors, setCols, () => {});
    return () => {
      a();
      b();
      c();
      d();
    };
  }, [sectors]);

  useEffect(() => {
    const u = subscribeUsers(setUsers, () => {});
    return () => u();
  }, []);

  const hoje = useMemo(() => startOfDay(), []);
  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const nomeDe = (email: string | null) =>
    email ? (usersMap[email]?.name ?? email) : "—";

  const colsPorSetor = useMemo(
    () => columnsBySector(cols, sectors),
    [cols, sectors],
  );
  const colunas: KanbanColumn[] = useMemo(
    () => colsPorSetor[sector] ?? [],
    [colsPorSetor, sector],
  );
  const extremos = useMemo(
    () => ({
      firstId: colunas[0]?.id ?? "",
      doneIds: colunasEntregues(colunas),
    }),
    [colunas],
  );

  const cardsPorId = useMemo(() => {
    const m: Record<string, Card> = {};
    cards.forEach((c) => (m[c.id] = c));
    return m;
  }, [cards]);

  /** Estado do ciclo: depende do card que ele abriu, não da regra. */
  const estadoDa = useMemo(
    () => (o: Ocorrencia) => occState(o, cardsPorId[o.cardId], extremos, hoje),
    [cardsPorId, extremos, hoje],
  );

  const doSetor = useMemo(
    () => recs.filter((r) => r.sector === sector),
    [recs, sector],
  );
  const occsDoSetor = useMemo(
    () => occs.filter((o) => o.sector === sector),
    [occs, sector],
  );

  const totais = useMemo(() => {
    const estados = occsDoSetor.map(estadoDa);
    return {
      carga: doSetor.reduce((s, r) => s + recLoadHours(r), 0),
      abertas: estados.filter((s) => s !== "done" && s !== "gone").length,
      atrasadas: estados.filter((s) => s === "late").length,
    };
  }, [occsDoSetor, doSetor, estadoDa]);

  const listadas = useMemo(
    () =>
      doSetor
        .map((r) => ({
          rec: r,
          st: recStatus(r, occsDoSetor, estadoDa),
          prox: nextDateOf(r, hoje),
        }))
        .sort(
          (a, b) =>
            (ORDEM_LISTA[a.st.k] ?? 9) - (ORDEM_LISTA[b.st.k] ?? 9) ||
            String(a.prox ?? "9").localeCompare(String(b.prox ?? "9")),
        ),
    [doSetor, occsDoSetor, estadoDa, hoje],
  );

  const recAberta = aberta
    ? (doSetor.find((r) => r.id === aberta) ?? null)
    : null;

  async function gerarAgora(recId: string) {
    setAviso(null);
    try {
      const r = await gerarCards(recId);
      setAviso(
        r.criados > 0
          ? `${r.criados} card(s) aberto(s) no Kanban.`
          : "Nada a gerar: o ciclo em aberto já tem card.",
      );
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não foi possível gerar.");
    }
  }

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Recorrências</h1>
            <p>Manutenção programada dos apps e serviços do setor.</p>
          </div>
        </div>
        <div className={styles.vazioTela}>
          Você ainda não participa de nenhum setor. Peça ao administrador para
          incluí-lo em um.
        </div>
      </div>
    );
  }

  const novaRec = (): Draft => ({
    name: "",
    svc: "",
    kind: "rotina",
    sector,
    owner: profile.email,
    pattern: { mode: "weekly", dow: 1, every: 1 },
    since: toISO(hoje),
    estMin: 60,
    lead: 0,
    columnId: colunas[0]?.id ?? "backlog",
    acts: [],
    note: "",
    active: true,
  });

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Recorrências — {sector}</h1>
          <p>
            Manutenção programada dos apps e serviços do setor. Cada data
            prevista abre um card novo no Kanban, já com as atividades da
            recorrência.
          </p>
        </div>
        <div className={styles.headTools}>
          <div className={styles.setorSel}>
            <Select
              value={sector}
              options={sectors.map((s) => ({ value: s, label: s }))}
              onChange={setSector}
              ariaLabel="Setor"
            />
          </div>
          {canManage && (
            <button
              className={styles.btnPri}
              onClick={() => setDraft(novaRec())}
            >
              <Icon name="plus" size={15} /> Nova recorrência
            </button>
          )}
        </div>
      </div>

      {aviso && (
        <div className={styles.aviso}>
          <Icon name="info" size={14} />
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar aviso">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {doSetor.length === 0 ? (
        <div className={styles.vazioGrande}>
          <div className={styles.vazioIcone}>
            <Icon name="recorrencias" size={30} />
          </div>
          <div className={styles.vazioTitulo}>Nenhuma recorrência cadastrada</div>
          <p>
            O setor <b>{sector}</b> ainda não tem manutenção programada. Cada
            recorrência cadastrada aqui passa a abrir um card no Kanban na data
            combinada.
            {canManage ? " Comece em Nova recorrência." : ""}
          </p>
        </div>
      ) : (
        <div className={styles.corpo}>
          <div className={styles.strip}>
            <div className={styles.stat}>
              <b>{totais.abertas}</b>
              <span>Não-concluídas</span>
            </div>
            <div
              className={`${styles.stat} ${totais.atrasadas ? styles.statAlerta : ""}`}
            >
              <b>{totais.atrasadas}</b>
              <span>{totais.atrasadas === 1 ? "Atrasada" : "Atrasadas"}</span>
            </div>
            <span className={styles.stripNota}>
              {doSetor.length}{" "}
              {doSetor.length === 1 ? "recorrência" : "recorrências"} ·{" "}
              {hh(totais.carga)} h/mês de manutenção programada
            </span>
          </div>

          <div className={styles.grid}>
            {listadas.map(({ rec, st, prox }) => (
              <RecCard
                key={rec.id}
                rec={rec}
                estado={st}
                proxima={prox}
                hoje={hoje}
                nomeDe={nomeDe}
                cardDoCiclo={st.occ ? cardsPorId[st.occ.cardId] : undefined}
                onAbrir={() => setAberta(rec.id)}
              />
            ))}
          </div>

          <Calendario
            recs={doSetor}
            occs={occsDoSetor}
            estadoDa={estadoDa}
            offset={mesOffset}
            hoje={hoje}
            onOffset={setMesOffset}
            nomeDe={nomeDe}
            cardsPorId={cardsPorId}
            onAbrirRec={setAberta}
          />
        </div>
      )}

      {/* A regra pode ter sumido embaixo do modal (outra pessoa removeu, ou o
          setor mudou). Sem uma das duas fontes não há o que editar. */}
      {(draft || recAberta) && (
        <RecModal
          rec={recAberta}
          draftInicial={draft}
          canManage={!!canManage}
          colunas={colunas}
          sector={sector}
          users={users}
          hoje={hoje}
          occs={occsDoSetor}
          cardsPorId={cardsPorId}
          estadoDa={estadoDa}
          nomeDe={nomeDe}
          autor={profile.email}
          onGerar={gerarAgora}
          onClose={() => {
            setDraft(null);
            setAberta(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cartão da regra
// ---------------------------------------------------------------------------

function RecCard({
  rec,
  estado,
  proxima,
  hoje,
  nomeDe,
  cardDoCiclo,
  onAbrir,
}: {
  rec: Recorrencia;
  estado: ReturnType<typeof recStatus>;
  proxima: string | null;
  hoje: Date;
  nomeDe: (e: string | null) => string;
  cardDoCiclo?: Card;
  onAbrir: () => void;
}) {
  const [bg, fg] = REC_STATE_TOKENS[estado.k];
  const acts = rec.acts ?? [];

  return (
    <div
      className={`${styles.card} ${estado.k === "late" ? styles.cardAtrasado : ""} ${
        rec.active === false ? styles.cardPausado : ""
      }`}
    >
      <div className={styles.cardHead}>
        <div className={styles.cardTitulo}>
          <button onClick={onAbrir}>{rec.name}</button>
          <div className={styles.cardMeta}>
            <span
              className={styles.kindDot}
              style={{ background: REC_KIND_COLOR[rec.kind] }}
            />
            {rec.svc ? `${rec.svc} · ` : ""}
            {REC_KIND_LABEL[rec.kind]}
          </div>
        </div>
        <span className={styles.estado} style={{ background: bg, color: fg }}>
          {estado.label}
        </span>
      </div>

      <div className={styles.cardCampos}>
        <div className={styles.campo}>
          <i>Próximo card</i>
          <span>
            {estado.occ && cardDoCiclo ? (
              <>
                <Link
                  href={`/kanban?setor=${encodeURIComponent(rec.sector)}&card=${estado.occ.cardId}`}
                >
                  {fmtDayMonth(estado.occ.date)}
                </Link>
                <em>
                  {" "}
                  · card aberto, {relDay(estado.occ.date, hoje)}
                </em>
              </>
            ) : proxima ? (
              <>
                {fmtDayMonth(proxima)}
                <em>
                  {" "}
                  · {relDay(proxima, hoje)}
                  {rec.lead ? ` · abre ${rec.lead}d antes` : ""}
                </em>
              </>
            ) : (
              <em>sem próxima data</em>
            )}
          </span>
        </div>
        <div className={styles.campo}>
          <i>Responsável</i>
          <span>{nomeDe(rec.owner)}</span>
        </div>
        <div className={styles.campo}>
          <i>Quando</i>
          <span>
            <span className={styles.pat}>{patternLabel(rec.pattern)}</span>
            <em> ≈{hh(rec.estMin / 60)}h</em>
          </span>
        </div>
      </div>

      <div className={styles.cardActs}>
        <h5>Atividades do card ({acts.length})</h5>
        {acts.length ? (
          acts.map((a, i) => (
            <div key={i} className={styles.act}>
              <span className={styles.actBox} />
              <span>{a}</span>
            </div>
          ))
        ) : (
          <span className={styles.actVazio}>
            Nenhuma atividade — o card nasce sem checklist.
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendário do mês (só dias úteis)
// ---------------------------------------------------------------------------

const ESTADO_LABEL: Record<OccState | "plan", string> = {
  done: "concluída",
  late: "atrasada",
  doing: "em andamento",
  open: "card aberto",
  gone: "card removido",
  plan: "prevista",
};

function Calendario({
  recs,
  occs,
  estadoDa,
  offset,
  hoje,
  onOffset,
  nomeDe,
  cardsPorId,
  onAbrirRec,
}: {
  recs: Recorrencia[];
  occs: Ocorrencia[];
  estadoDa: (o: Ocorrencia) => OccState;
  offset: number;
  hoje: Date;
  onOffset: (n: number) => void;
  nomeDe: (e: string | null) => string;
  cardsPorId: Record<string, Card>;
  onAbrirRec: (id: string) => void;
}) {
  const base = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
  const ano = base.getFullYear();
  const mes = base.getMonth();
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();

  const porDia: Record<
    number,
    { rec: Recorrencia; iso: string; occ?: Ocorrencia; estado: OccState | "plan" }[]
  > = {};
  let total = 0;
  recs.forEach((rec) => {
    if (rec.active === false) return;
    recDates(rec, new Date(ano, mes, 1), new Date(ano, mes, ultimoDia)).forEach(
      (d) => {
        const iso = toISO(d);
        const occ = occs.find((o) => o.recId === rec.id && o.date === iso);
        const estado = occ ? estadoDa(occ) : "plan";
        (porDia[d.getDate()] = porDia[d.getDate()] ?? []).push({
          rec,
          iso,
          occ,
          estado,
        });
        total++;
      },
    );
  });

  // Semanas de segunda a sexta: recorrência nunca cai em fim de semana.
  const primeiroDow = new Date(ano, mes, 1).getDay();
  const celulas: (number | null)[] = [];
  let dia = 1 - ((primeiroDow + 6) % 7);
  while (dia <= ultimoDia) {
    for (let i = 0; i < 5; i++) {
      const d = dia + i;
      celulas.push(d >= 1 && d <= ultimoDia ? d : null);
    }
    dia += 7;
  }

  return (
    <div className={styles.calBloco}>
      <div className={styles.calHead}>
        <div className={styles.calTitulo}>
          <h3>
            {MES_LONGO[mes]} de {ano}
          </h3>
          <span>
            {total} {total === 1 ? "card previsto" : "cards previstos"} no mês
          </span>
        </div>
        <div className={styles.calFerramentas}>
          <div className={styles.legenda}>
            <span>
              <i style={{ background: "var(--ok)" }} />
              concluída
            </span>
            <span>
              <i style={{ background: "var(--info)" }} />
              card aberto
            </span>
            <span>
              <i style={{ background: "var(--warn)" }} />
              em andamento
            </span>
            <span>
              <i style={{ background: "var(--danger)" }} />
              atrasada
            </span>
            <span>
              <i style={{ background: "var(--tx-3)" }} />
              prevista
            </span>
          </div>
          <div className={styles.seg}>
            <button onClick={() => onOffset(offset - 1)} aria-label="Mês anterior">
              <Icon name="chevronLeft" size={14} />
            </button>
            <button
              className={offset === 0 ? styles.segOn : ""}
              onClick={() => onOffset(0)}
            >
              Mês atual
            </button>
            <button onClick={() => onOffset(offset + 1)} aria-label="Próximo mês">
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className={styles.calGrid}>
        {["Segunda", "Terça", "Quarta", "Quinta", "Sexta"].map((d) => (
          <div key={d} className={styles.calDow}>
            {d}
          </div>
        ))}
        {celulas.map((d, i) => {
          if (d === null) return <div key={i} className={styles.calVazio} />;
          const isHoje = offset === 0 && d === hoje.getDate();
          return (
            <div
              key={i}
              className={`${styles.calDia} ${isHoje ? styles.calHoje : ""}`}
            >
              <span className={styles.calNum}>
                {d}
                {isHoje ? " · hoje" : ""}
              </span>
              {(porDia[d] ?? []).map((x, j) => {
                const label = ESTADO_LABEL[x.estado];
                const card = x.occ ? cardsPorId[x.occ.cardId] : undefined;
                const conteudo = (
                  <>
                    {x.rec.name}
                    <small>
                      {nomeDe(x.rec.owner)} · {label}
                    </small>
                  </>
                );
                const cls = `${styles.calChip} ${
                  x.estado === "plan" ? "" : styles[`chip_${x.estado}`]
                }`;
                return card && x.occ ? (
                  <Link
                    key={j}
                    className={cls}
                    href={`/kanban?setor=${encodeURIComponent(x.rec.sector)}&card=${x.occ.cardId}`}
                    title={`${x.rec.name} · ${label}`}
                  >
                    {conteudo}
                  </Link>
                ) : (
                  <button
                    key={j}
                    className={cls}
                    onClick={() => onAbrirRec(x.rec.id)}
                    title={`${x.rec.name} · ${label}`}
                  >
                    {conteudo}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className={styles.calNota}>
        Só dias úteis — a data de uma recorrência é sempre um dia da semana.
        Clique num card gerado para abri-lo no Kanban.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal da regra
// ---------------------------------------------------------------------------

function RecModal({
  rec,
  draftInicial,
  canManage,
  colunas,
  sector,
  users,
  hoje,
  occs,
  cardsPorId,
  estadoDa,
  nomeDe,
  autor,
  onGerar,
  onClose,
}: {
  rec: Recorrencia | null;
  draftInicial: Draft | null;
  canManage: boolean;
  colunas: KanbanColumn[];
  sector: string;
  users: UserProfile[];
  hoje: Date;
  occs: Ocorrencia[];
  cardsPorId: Record<string, Card>;
  estadoDa: (o: Ocorrencia) => OccState;
  nomeDe: (e: string | null) => string;
  autor: string;
  onGerar: (id: string) => void;
  onClose: () => void;
}) {
  const editando = !!rec;
  const [d, setD] = useState<Draft>(() =>
    rec
      ? {
          id: rec.id,
          name: rec.name,
          svc: rec.svc,
          kind: rec.kind,
          sector: rec.sector,
          owner: rec.owner,
          pattern: rec.pattern,
          since: rec.since,
          estMin: rec.estMin,
          lead: rec.lead,
          columnId: rec.columnId,
          acts: [...(rec.acts ?? [])],
          note: rec.note ?? "",
          active: rec.active !== false,
        }
      : (draftInicial as Draft),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((x) => ({ ...x, [k]: v }));
  const setPat = (p: Partial<RecPattern>) =>
    setD((x) => ({ ...x, pattern: { ...x.pattern, ...p } as RecPattern }));

  const proximas = useMemo(
    () =>
      recDates(
        { pattern: d.pattern, since: d.since },
        hoje,
        addDays(hoje, 420),
      )
        .slice(0, 4)
        .map((x) => fmtDayMonth(toISO(x))),
    [d.pattern, d.since, hoje],
  );

  const historico = useMemo(
    () =>
      occs
        .filter((o) => o.recId === d.id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [occs, d.id],
  );

  async function salvar() {
    if (!d.name.trim()) {
      setErro("Dê um nome à recorrência.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const { id, ...dados } = d;
      if (id) await updateRecorrencia(id, dados);
      else await createRecorrencia({ ...dados, sector }, autor);
      onClose();
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível salvar a recorrência.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!d.id) return;
    if (
      !confirm(
        `Remover a recorrência "${d.name}"? Os cards já abertos continuam no Kanban.`,
      )
    )
      return;
    try {
      await deleteRecorrencia(d.id);
      onClose();
    } catch {
      setErro("Não foi possível remover.");
    }
  }

  const membros = users.filter(
    (u) => u.active && (u.role === "admin" || (u.sectors ?? []).includes(sector)),
  );
  const donoOpts: SelectOption[] = [
    { value: "", label: "— Ninguém —" },
    ...membros.map((u) => ({ value: u.email, label: u.name || u.email })),
  ];
  const ro = !canManage;

  return (
    <Modal
      onClose={onClose}
      ariaLabel={editando ? "Editar recorrência" : "Nova recorrência"}
      overlayClassName={styles.overlay}
      className={styles.modal}
    >
      <div className={styles.modalHead}>
        <span className={styles.tagNeutra}>
          <span
            className={styles.kindDot}
            style={{ background: REC_KIND_COLOR[d.kind] }}
          />
          {REC_KIND_LABEL[d.kind]}
        </span>
        <span className={styles.tagNeutra}>{sector}</span>
        <div style={{ flex: 1 }} />
        {canManage && editando && (
          <button
            className={styles.btnGhost}
            onClick={() => set("active", !d.active)}
          >
            <Icon name={d.active ? "pause" : "recorrencias"} size={14} />
            {d.active ? "Pausar" : "Reativar"}
          </button>
        )}
        {editando && d.id && (
          <button className={styles.btnPri} onClick={() => onGerar(d.id as string)}>
            <Icon name="plus" size={14} /> Gerar card agora
          </button>
        )}
        <button className={styles.fechar} onClick={onClose} aria-label="Fechar">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className={styles.modalBody}>
        {ro && (
          <div className={styles.roBanner}>
            <Icon name="lock" size={14} />
            Somente leitura — você acompanha a recorrência, mas não altera o
            plano. Alterar é de gestor ou admin.
          </div>
        )}

        <input
          className={styles.tituloInput}
          value={d.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Ex.: Power BI — revisão de gateway e refreshes"
          maxLength={120}
          readOnly={ro}
        />

        <div className={styles.metagrid}>
          <label className={styles.field}>
            <span>Serviço / app</span>
            <input
              className={styles.input}
              value={d.svc}
              onChange={(e) => set("svc", e.target.value)}
              placeholder="Power BI"
              maxLength={80}
              readOnly={ro}
            />
          </label>
          <label className={styles.field}>
            <span>Tipo</span>
            <Select
              value={d.kind}
              options={REC_KINDS.map((k) => ({
                value: k,
                label: REC_KIND_LABEL[k],
                color: REC_KIND_COLOR[k],
              }))}
              onChange={(v) => !ro && set("kind", v as RecKind)}
              ariaLabel="Tipo"
            />
          </label>
          <label className={styles.field}>
            <span>Responsável</span>
            <Select
              value={d.owner ?? ""}
              options={donoOpts}
              onChange={(v) => !ro && set("owner", v || null)}
              ariaLabel="Responsável"
            />
          </label>
          <label className={styles.field}>
            <span>Estimativa (min)</span>
            <input
              className={styles.input}
              type="number"
              min={15}
              step={15}
              value={d.estMin}
              onChange={(e) => set("estMin", Math.max(0, Number(e.target.value)))}
              readOnly={ro}
            />
          </label>
          <label className={styles.field}>
            <span>Abre o card antes</span>
            <Select
              value={String(d.lead)}
              options={[0, 1, 2, 3, 5, 7].map((n) => ({
                value: String(n),
                label: n === 0 ? "na data" : `${n} dia(s) antes`,
              }))}
              onChange={(v) => !ro && set("lead", Number(v))}
              ariaLabel="Antecedência"
            />
          </label>
          <label className={styles.field}>
            <span>Entra na coluna</span>
            <Select
              value={d.columnId}
              options={colunas.map((c) => ({
                value: c.id,
                label: c.title,
                color: c.color,
              }))}
              onChange={(v) => !ro && set("columnId", v)}
              ariaLabel="Coluna de entrada"
            />
          </label>
        </div>

        <div className={styles.secLabel}>
          <Icon name="calendar" size={15} /> Quando o card é aberto
        </div>
        <div className={styles.padraoBox}>
          <div className={styles.padraoCampo}>
            <Select
              value={d.pattern.mode}
              options={[
                { value: "weekly", label: "Por semana" },
                { value: "monthly", label: "Por posição no mês" },
              ]}
              onChange={(v) => {
                if (ro) return;
                set(
                  "pattern",
                  v === "weekly"
                    ? { mode: "weekly", dow: d.pattern.dow || 1, every: 1 }
                    : {
                        mode: "monthly",
                        ord: 1,
                        dow: d.pattern.dow || 1,
                        everyM: 1,
                      },
                );
              }}
              ariaLabel="Modo"
            />
          </div>

          {d.pattern.mode === "weekly" ? (
            <>
              <div className={styles.padraoCampo}>
                <Select
                  value={String(d.pattern.dow)}
                  options={WEEKDAYS.map((n) => ({
                    value: String(n),
                    label: DOW_LABEL[n],
                  }))}
                  onChange={(v) => !ro && setPat({ dow: Number(v) })}
                  ariaLabel="Dia da semana"
                />
              </div>
              <div className={styles.padraoCampo}>
                <Select
                  value={String(d.pattern.every)}
                  options={[
                    { value: "1", label: "toda semana" },
                    { value: "2", label: "semana sim / semana não" },
                  ]}
                  onChange={(v) =>
                    !ro && setPat({ every: Number(v) } as Partial<RecPattern>)
                  }
                  ariaLabel="Frequência"
                />
              </div>
            </>
          ) : (
            <>
              <div className={styles.padraoCampo}>
                <Select
                  value={String(d.pattern.ord)}
                  options={[1, 2, 3, 4, -1].map((o) => ({
                    value: String(o),
                    label: ORD_LABEL[o],
                  }))}
                  onChange={(v) =>
                    !ro && setPat({ ord: Number(v) } as Partial<RecPattern>)
                  }
                  ariaLabel="Posição no mês"
                />
              </div>
              <div className={styles.padraoCampo}>
                <Select
                  value={String(d.pattern.dow)}
                  options={WEEKDAYS.map((n) => ({
                    value: String(n),
                    label: DOW_LABEL[n],
                  }))}
                  onChange={(v) => !ro && setPat({ dow: Number(v) })}
                  ariaLabel="Dia da semana"
                />
              </div>
              <div className={styles.padraoCampo}>
                <Select
                  value={String(d.pattern.everyM)}
                  options={[1, 2, 3, 6].map((n) => ({
                    value: String(n),
                    label: n === 1 ? "todo mês" : `a cada ${n} meses`,
                  }))}
                  onChange={(v) =>
                    !ro && setPat({ everyM: Number(v) } as Partial<RecPattern>)
                  }
                  ariaLabel="Intervalo em meses"
                />
              </div>
            </>
          )}

          <label className={styles.field}>
            <span>A partir de</span>
            <input
              className={styles.input}
              type="date"
              value={d.since}
              onChange={(e) => set("since", e.target.value)}
              readOnly={ro}
            />
          </label>
          <span className={styles.pat}>{patternLabel(d.pattern)}</span>
        </div>

        <div className={styles.nota}>
          <Icon name="info" size={13} />
          <span>
            Próximos cards: <b>{proximas.join(" · ") || "—"}</b>. Cada um nasce
            com as atividades abaixo como checklist. Manutenção programada{" "}
            <b>
              {hh(recLoadHours({ pattern: d.pattern, estMin: d.estMin, active: d.active }))}{" "}
              h/mês
            </b>
            .
          </span>
        </div>

        <div className={styles.secLabel}>
          <Icon name="check" size={15} /> Atividades que vão dentro do card
        </div>
        <div className={styles.acts}>
          {d.acts.map((a, i) => (
            <div key={i} className={styles.actLinha}>
              <span className={styles.actBox} />
              <input
                className={styles.input}
                value={a}
                onChange={(e) =>
                  set(
                    "acts",
                    d.acts.map((x, j) => (j === i ? e.target.value : x)),
                  )
                }
                readOnly={ro}
              />
              {canManage && (
                <button
                  className={styles.iconBtn}
                  onClick={() =>
                    set(
                      "acts",
                      d.acts.filter((_, j) => j !== i),
                    )
                  }
                  aria-label="Remover atividade"
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          ))}
          {!d.acts.length && (
            <span className={styles.actVazio}>Nenhuma atividade cadastrada.</span>
          )}
          {canManage && (
            <button
              className={styles.addAct}
              onClick={() => set("acts", [...d.acts, ""])}
            >
              + Adicionar atividade
            </button>
          )}
        </div>

        <label className={styles.field} style={{ marginTop: 16 }}>
          <span>Observação (opcional)</span>
          <textarea
            className={styles.textarea}
            value={d.note ?? ""}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Por que esta manutenção existe, o que costuma dar errado…"
            maxLength={500}
            readOnly={ro}
          />
        </label>

        {editando && (
          <>
            <div className={styles.secLabel}>
              <Icon name="recorrencias" size={15} /> Cards já gerados
              <span className={styles.secNota}>· {historico.length}</span>
            </div>
            {historico.length ? (
              <div className={styles.tabelaWrap}>
                <table className={styles.tabela}>
                  <thead>
                    <tr>
                      <th>Data prevista</th>
                      <th>Card no Kanban</th>
                      <th>Situação</th>
                      <th>Responsável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historico.map((o) => {
                      const card = cardsPorId[o.cardId];
                      const s = estadoDa(o);
                      return (
                        <tr key={o.id}>
                          <td>{fmtDayMonth(o.date)}</td>
                          <td>
                            {card ? (
                              <Link
                                href={`/kanban?setor=${encodeURIComponent(sector)}&card=${o.cardId}`}
                                className={styles.linkCard}
                              >
                                {card.title}
                              </Link>
                            ) : (
                              <span className={styles.actVazio}>
                                card removido
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              className={styles.estado}
                              style={{
                                background:
                                  s === "done"
                                    ? "var(--ok-bg)"
                                    : REC_STATE_TOKENS[
                                        s === "gone" ? "off" : s
                                      ][0],
                                color:
                                  s === "done"
                                    ? "var(--ok-tx)"
                                    : REC_STATE_TOKENS[
                                        s === "gone" ? "off" : s
                                      ][1],
                              }}
                            >
                              {ESTADO_LABEL[s]}
                            </span>
                          </td>
                          <td>{nomeDe(card?.assignee ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.actVazio}>Nenhum card gerado ainda.</div>
            )}
          </>
        )}

        {erro && <p className={styles.erro}>{erro}</p>}
      </div>

      {canManage && (
        <div className={styles.modalPe}>
          {editando && (
            <button className={styles.btnPerigo} onClick={apagar}>
              <Icon name="trash" size={14} /> Remover
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className={styles.btnGhost} onClick={onClose}>
            Cancelar
          </button>
          <button
            className={styles.btnPri}
            onClick={salvar}
            disabled={salvando || !d.name.trim()}
          >
            {salvando ? "Salvando…" : editando ? "Salvar" : "Criar recorrência"}
          </button>
        </div>
      )}
    </Modal>
  );
}
