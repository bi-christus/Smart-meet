"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  columnsBySector,
  DEMAND_TYPE_COLOR,
  DEMAND_TYPE_LABEL,
  DEMAND_TYPES,
  type Card,
  type ColumnDoc,
  type DemandType,
  type KanbanColumn,
} from "@/lib/kanban";
import { subscribeRecorrencias } from "@/lib/recorrencias";
import { recLoadHours, type Recorrencia } from "@/lib/recorrencias-core";
import {
  addDays,
  daysBetween,
  fmtDayMonth,
  hh,
  startOfDay,
  startOfWeek,
  toISO,
} from "@/lib/datas";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import styles from "./dashboard.module.css";

/**
 * Dashboard — como o setor está entregando, não quem trabalha mais.
 *
 * Toda métrica aqui é do SISTEMA: fila que cresce, prazo que estoura, demanda
 * que fica parada. Nenhuma é ranking de pessoa — "consumo por responsável"
 * mostra carga para redistribuir, e é por isso que ele soma horas de
 * manutenção recorrente junto: quem tem quatro recorrências no nome tem menos
 * mão para demanda nova, mesmo com poucos cards.
 *
 * SOBRE A PRECISÃO DOS NÚMEROS DE FLUXO: o app não guarda o histórico de
 * movimentação dos cards. As séries são derivadas do que existe —
 *   entrada  = data de criação do card;
 *   entrega  = quando o card entrou na última coluna do quadro (`enteredAt`);
 *   cycle time = diferença entre as duas.
 * É aproximação, e está escrito na tela. Um card que voltou de coluna depois
 * de concluído conta a partir do último movimento; nada disso muda a leitura
 * que importa (a tendência), mas muda o número exato — e prometer prazo com
 * número exato que não existe seria pior do que não medir.
 */

type Periodo = 12 | 26 | 52;

const PERIODO_LABEL: Record<Periodo, string> = {
  12: "12 semanas",
  26: "6 meses",
  52: "12 meses",
};

/** Mínimo de conclusões para publicar percentil. Abaixo disso é chute. */
const MIN_AMOSTRA = 5;

export default function DashboardPage() {
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

  const [cards, setCards] = useState<Card[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [cols, setCols] = useState<ColumnDoc[]>([]);
  const [recs, setRecs] = useState<Recorrencia[]>([]);

  const [fSetor, setFSetor] = useState("");
  const [fPessoa, setFPessoa] = useState("");
  const [fResp, setFResp] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(12);

  useEffect(() => {
    const u = subscribeCardsForSectors(sectors, setCards, (e) =>
      console.error("Erro ao carregar cards:", e),
    );
    return () => u();
  }, [sectors]);

  useEffect(() => {
    const u = subscribeColumnsForSectors(sectors, setCols, () => {});
    return () => u();
  }, [sectors]);

  useEffect(() => {
    const u = subscribeRecorrencias(sectors, setRecs, () => {});
    return () => u();
  }, [sectors]);

  useEffect(() => {
    const u = subscribeUsers(setUsers, () => {});
    return () => u();
  }, []);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);

  const hoje = useMemo(() => startOfDay(), []);
  const colsPorSetor = useMemo(
    () => columnsBySector(cols, sectors),
    [cols, sectors],
  );

  /** Setores do recorte: um, ou todos os visíveis. */
  const noRecorte = useMemo(
    () => (fSetor ? [fSetor] : sectors),
    [fSetor, sectors],
  );

  /** Cor estável por setor, na ordem fixa da paleta categórica. */
  const corDoSetor = useMemo(() => {
    const m: Record<string, string> = {};
    sectors.forEach((s, i) => (m[s] = `var(--serie-${(i % 8) + 1})`));
    return m;
  }, [sectors]);

  const finalDe = useMemo(() => {
    const m: Record<string, string> = {};
    Object.entries(colsPorSetor).forEach(([s, lista]) => {
      m[s] = lista[lista.length - 1]?.id ?? "";
    });
    return m;
  }, [colsPorSetor]);

  const concluido = useMemo(
    () => (c: Card) => c.columnId === finalDe[c.sector],
    [finalDe],
  );

  const pessoas = useMemo(() => {
    const set = new Set<string>();
    cards
      .filter((c) => noRecorte.includes(c.sector))
      .forEach((c) => {
        if (c.assignee) set.add(c.assignee);
        if (c.createdBy?.includes("@")) set.add(c.createdBy);
      });
    users.forEach((u) => {
      if (u.active && (u.sectors ?? []).some((s) => noRecorte.includes(s)))
        set.add(u.email);
    });
    return [...set]
      .filter((e) => e.includes("@"))
      .sort((a, b) =>
        (usersMap[a]?.name ?? a).localeCompare(usersMap[b]?.name ?? b, "pt-BR"),
      );
  }, [cards, users, usersMap, noRecorte]);

  // Trocar de setor pode tirar a pessoa escolhida do recorte. O filtro é
  // DERIVADO em vez de zerado por efeito: zerar depois da renderização mostra,
  // por um quadro, um painel filtrado por alguém que nem está na lista.
  const fPessoaAtivo = fPessoa && pessoas.includes(fPessoa) ? fPessoa : "";
  const fRespAtivo = fResp && pessoas.includes(fResp) ? fResp : "";

  /** Cards do recorte (setor + pessoa + responsável), concluídos inclusive. */
  const doRecorte = useMemo(
    () =>
      cards
        .filter((c) => noRecorte.includes(c.sector))
        .filter(
          (c) =>
            !fPessoaAtivo ||
            c.assignee === fPessoaAtivo ||
            c.createdBy === fPessoaAtivo,
        )
        .filter((c) => !fRespAtivo || c.assignee === fRespAtivo),
    [cards, noRecorte, fPessoaAtivo, fRespAtivo],
  );

  const abertos = useMemo(
    () => doRecorte.filter((c) => !concluido(c)),
    [doRecorte, concluido],
  );

  // ---- séries semanais de fluxo -------------------------------------------
  const fluxo = useMemo(
    () => calcularFluxo(doRecorte, concluido, hoje, periodo),
    [doRecorte, concluido, hoje, periodo],
  );

  const recsNoRecorte = useMemo(
    () => recs.filter((r) => noRecorte.includes(r.sector)),
    [recs, noRecorte],
  );
  const cargaRec = useMemo(
    () => recsNoRecorte.reduce((s, r) => s + recLoadHours(r), 0),
    [recsNoRecorte],
  );

  const prazos = useMemo(() => {
    const vencidas = abertos.filter(
      (c) => c.due && daysBetween(c.due, hoje) > 0,
    ).length;
    const proximas = abertos.filter((c) => {
      if (!c.due) return false;
      const d = daysBetween(c.due, hoje);
      return d <= 0 && d >= -7;
    }).length;
    return { vencidas, proximas };
  }, [abertos, hoje]);

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Dashboard</h1>
            <p>Fluxo, carga e prazos do setor.</p>
          </div>
        </div>
        <div className={styles.vazioTela}>
          Você ainda não participa de nenhum setor. Peça ao administrador para
          incluí-lo em um.
        </div>
      </div>
    );
  }

  const nomeDe = (email: string) => usersMap[email]?.name ?? email;
  const opcoesPessoa = (vazio: string): SelectOption[] => [
    { value: "", label: vazio },
    ...pessoas.map((e) => ({ value: e, label: nomeDe(e) })),
  ];
  const sujo = !!(fSetor || fPessoaAtivo || fRespAtivo);
  const p85Txt =
    fluxo.amostra >= MIN_AMOSTRA ? String(fluxo.p85) : "—";

  return (
    <div className={`${styles.page} ${styles.viz}`}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Dashboard — {fSetor || "todos os setores"}</h1>
          <p>
            Fluxo, carga por responsável e prazos do recorte. Métricas de
            sistema, nunca ranking de pessoas.
          </p>
        </div>
        <div className={styles.periodo}>
          <Select
            value={String(periodo)}
            options={(Object.keys(PERIODO_LABEL) as unknown as string[]).map(
              (k) => ({ value: k, label: PERIODO_LABEL[Number(k) as Periodo] }),
            )}
            onChange={(v) => setPeriodo(Number(v) as Periodo)}
            ariaLabel="Período das séries"
          />
        </div>
      </div>

      <div className={styles.filtros}>
        <Icon name="filter" size={15} />
        <div className={styles.filtro}>
          <Select
            value={fSetor}
            options={[
              { value: "", label: "Todos os setores" },
              ...sectors.map((s) => ({ value: s, label: s })),
            ]}
            onChange={setFSetor}
            ariaLabel="Setor"
          />
        </div>
        <div className={styles.filtro}>
          <Select
            value={fPessoaAtivo}
            options={opcoesPessoa("Todas as pessoas")}
            onChange={setFPessoa}
            ariaLabel="Pessoa (autor ou responsável)"
          />
        </div>
        <div className={styles.filtro}>
          <Select
            value={fRespAtivo}
            options={opcoesPessoa("Todos os responsáveis")}
            onChange={setFResp}
            ariaLabel="Responsável"
          />
        </div>
        {sujo && (
          <button
            className={styles.limpar}
            onClick={() => {
              setFSetor("");
              setFPessoa("");
              setFResp("");
            }}
          >
            <Icon name="x" size={13} /> Limpar
          </button>
        )}
        <span className={styles.contagem}>
          {abertos.length}{" "}
          {abertos.length === 1 ? "demanda em aberto" : "demandas em aberto"}
          {fPessoaAtivo ? " · pessoa = autor ou responsável" : ""}
        </span>
      </div>

      <div className={styles.kstrip}>
        <Kpi
          icone="kanban"
          rotulo="Em aberto"
          valor={abertos.length}
          rodape={`${doRecorte.length - abertos.length} concluída(s) fora da conta`}
        />
        <Kpi
          icone="warn"
          rotulo="Vencidas"
          valor={prazos.vencidas}
          rodape="prazo já ultrapassado"
          tom={prazos.vencidas ? "danger" : undefined}
        />
        <Kpi
          icone="calendar"
          rotulo="Vencem em 7 dias"
          valor={prazos.proximas}
          rodape="entram na semana"
          tom={prazos.proximas ? "warn" : undefined}
        />
        <Kpi
          icone="clock"
          rotulo="Cycle time p85"
          valor={p85Txt}
          unidade={fluxo.amostra >= MIN_AMOSTRA ? "dias" : ""}
          rodape={
            fluxo.amostra >= MIN_AMOSTRA
              ? "85% saem nesse prazo ou menos"
              : `${fluxo.amostra} conclusão(ões) no período — amostra pequena demais`
          }
        />
        <Kpi
          icone="check"
          rotulo="Entregas"
          valor={fluxo.entregas4}
          unidade="/4 sem"
          rodape="concluídas nas últimas 4 semanas"
        />
        <Kpi
          icone="recorrencias"
          rotulo="Carga recorrente"
          valor={hh(cargaRec)}
          unidade="h/mês"
          rodape={`${recsNoRecorte.length} ${
            recsNoRecorte.length === 1
              ? "recorrência programada"
              : "recorrências programadas"
          }`}
        />
      </div>

      <div className={styles.paineis}>
        <section className={styles.painel}>
          <PainelHead
            titulo="Consumo por responsável"
            sub="Demandas em aberto de cada um, empilhadas pelo setor · h/mês = manutenção recorrente sob sua responsabilidade"
          />
          <BarrasResponsavel
            cards={abertos}
            recs={recsNoRecorte}
            nomeDe={nomeDe}
            corDoSetor={corDoSetor}
          />
        </section>

        <section className={styles.painel}>
          <PainelHead
            titulo="Demandas por tipo"
            sub="Distribuição do que está em aberto no recorte"
          />
          <Rosca cards={abertos} />
        </section>

        <section className={styles.painel}>
          <PainelHead
            titulo="Demanda que entra × demanda que sai"
            sub="Se a entrada supera a entrega por semanas seguidas, a fila cresce — e nenhum esforço individual resolve"
          />
          <FluxoSemanal fluxo={fluxo} />
          <div className={styles.nota}>
            <Icon name="info" size={13} />
            <span>
              Aproximação: <b>entrada</b> é a data de criação do card e{" "}
              <b>entrega</b> é a chegada à última coluna do quadro. O app ainda
              não guarda o histórico de movimentação, então a tendência é
              confiável, o número exato não.
            </span>
          </div>
        </section>

        <section className={styles.painel}>
          <PainelHead
            titulo="Cycle time e previsibilidade"
            sub="Cada ponto é uma demanda concluída · percentis 50/85/95 (base para prometer prazo)"
            chip={
              fluxo.amostra >= MIN_AMOSTRA
                ? `p50 ${fluxo.p50}d · p85 ${fluxo.p85}d`
                : undefined
            }
          />
          <CycleTime fluxo={fluxo} />
          {fluxo.amostra >= MIN_AMOSTRA && (
            <div className={styles.nota}>
              <Icon name="info" size={13} />
              <span>
                Prazo se promete por percentil, não por média: “85% das demandas
                saem em até <b>{fluxo.p85} dias</b>”.
              </span>
            </div>
          )}
        </section>

        <section className={`${styles.painel} ${styles.painelLargo}`}>
          <PainelHead
            titulo="Prazos — vencidas e a vencer"
            sub="Demandas em aberto com prazo vencido ou nos próximos 14 dias"
            chip={`${prazos.vencidas} ${prazos.vencidas === 1 ? "vencida" : "vencidas"}`}
            chipTom={prazos.vencidas ? "danger" : undefined}
          />
          <TabelaPrazos
            cards={abertos}
            hoje={hoje}
            nomeDe={nomeDe}
            colsPorSetor={colsPorSetor}
            corDoSetor={corDoSetor}
          />
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cálculo do fluxo
// ---------------------------------------------------------------------------

type Fluxo = {
  semanas: { inicio: Date; rotulo: string }[];
  entradas: number[];
  entregas: number[];
  fila: number[];
  pontos: { x: number; dias: number }[];
  p50: number;
  p85: number;
  p95: number;
  amostra: number;
  entregas4: number;
};

function criadoEm(c: Card): number | null {
  if (c.createdAt?.seconds) return c.createdAt.seconds * 1000;
  return c.enteredAt ?? null;
}

function percentil(ordenado: number[], p: number): number {
  if (!ordenado.length) return 0;
  const i = Math.min(ordenado.length - 1, Math.floor(p * ordenado.length));
  return ordenado[i];
}

function calcularFluxo(
  cards: Card[],
  concluido: (c: Card) => boolean,
  hoje: Date,
  semanasN: number,
): Fluxo {
  const primeira = addDays(startOfWeek(hoje), -(semanasN - 1) * 7);
  const semanas = Array.from({ length: semanasN }, (_, i) => {
    const inicio = addDays(primeira, i * 7);
    return { inicio, rotulo: `${inicio.getDate()}/${String(inicio.getMonth() + 1).padStart(2, "0")}` };
  });
  const indiceDa = (ms: number) => {
    const i = Math.floor((ms - primeira.getTime()) / (86400000 * 7));
    return i >= 0 && i < semanasN ? i : -1;
  };

  const entradas = new Array(semanasN).fill(0);
  const entregas = new Array(semanasN).fill(0);
  const pontos: { x: number; dias: number }[] = [];
  let filaInicial = 0;

  cards.forEach((c) => {
    const nasceu = criadoEm(c);
    const entregue = concluido(c) ? (c.enteredAt ?? null) : null;

    if (nasceu !== null) {
      const i = indiceDa(nasceu);
      if (i >= 0) entradas[i]++;
      // Fila que já existia quando a janela começou.
      else if (
        nasceu < primeira.getTime() &&
        (entregue === null || entregue >= primeira.getTime())
      )
        filaInicial++;
    }

    if (entregue !== null) {
      const i = indiceDa(entregue);
      if (i >= 0) {
        entregas[i]++;
        if (nasceu !== null && entregue >= nasceu) {
          pontos.push({
            x: entregue,
            dias: Math.max(0, Math.round((entregue - nasceu) / 86400000)),
          });
        }
      }
    }
  });

  const fila: number[] = [];
  let acc = filaInicial;
  for (let i = 0; i < semanasN; i++) {
    acc = Math.max(0, acc + entradas[i] - entregas[i]);
    fila.push(acc);
  }

  const ordenado = pontos.map((p) => p.dias).sort((a, b) => a - b);
  return {
    semanas,
    entradas,
    entregas,
    fila,
    pontos: pontos.sort((a, b) => a.x - b.x),
    p50: percentil(ordenado, 0.5),
    p85: percentil(ordenado, 0.85),
    p95: percentil(ordenado, 0.95),
    amostra: pontos.length,
    entregas4: entregas.slice(-4).reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function PainelHead({
  titulo,
  sub,
  chip,
  chipTom,
}: {
  titulo: string;
  sub: string;
  chip?: string;
  chipTom?: "danger";
}) {
  return (
    <div className={styles.painelHead}>
      <div>
        <h3>{titulo}</h3>
        <p>{sub}</p>
      </div>
      {chip && (
        <span
          className={`${styles.chip} ${chipTom === "danger" ? styles.chipDanger : ""}`}
        >
          {chip}
        </span>
      )}
    </div>
  );
}

function Kpi({
  icone,
  rotulo,
  valor,
  unidade,
  rodape,
  tom,
}: {
  icone: string;
  rotulo: string;
  valor: number | string;
  unidade?: string;
  rodape: string;
  tom?: "danger" | "warn";
}) {
  return (
    <div
      className={`${styles.kcell} ${
        tom === "danger" ? styles.kDanger : tom === "warn" ? styles.kWarn : ""
      }`}
    >
      <div className={styles.kl}>
        <Icon name={icone} size={12} />
        {rotulo}
      </div>
      <div className={styles.kv}>
        {valor}
        {unidade && <small>{unidade}</small>}
      </div>
      <div className={styles.kf}>{rodape}</div>
    </div>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <div className={styles.vazioPainel}>{children}</div>;
}

/**
 * Carga de cada responsável, segmentada pelo setor da demanda.
 *
 * Os segmentos levam 2px de respiro entre si e o total vai escrito no fim da
 * barra: no tema claro a paleta categórica fica abaixo de 3:1 contra o fundo,
 * e cor sozinha deixaria de responder "quantos são".
 */
function BarrasResponsavel({
  cards,
  recs,
  nomeDe,
  corDoSetor,
}: {
  cards: Card[];
  recs: Recorrencia[];
  nomeDe: (e: string) => string;
  corDoSetor: Record<string, string>;
}) {
  const linhas = useMemo(() => {
    const por: Record<string, { total: number; setores: Record<string, number> }> =
      {};
    cards.forEach((c) => {
      const quem = c.assignee || "__sem__";
      const r = (por[quem] = por[quem] ?? { total: 0, setores: {} });
      r.total++;
      r.setores[c.sector] = (r.setores[c.sector] ?? 0) + 1;
    });
    return Object.entries(por).sort(
      (a, b) =>
        b[1].total - a[1].total ||
        nomeDe(a[0]).localeCompare(nomeDe(b[0]), "pt-BR"),
    );
  }, [cards, nomeDe]);

  const horasDe = useMemo(() => {
    const m: Record<string, number> = {};
    recs.forEach((r) => {
      if (!r.owner) return;
      m[r.owner] = (m[r.owner] ?? 0) + recLoadHours(r);
    });
    return m;
  }, [recs]);

  const setoresUsados = useMemo(
    () => [...new Set(cards.map((c) => c.sector))].sort(),
    [cards],
  );

  if (!linhas.length)
    return <Vazio>Nenhuma demanda em aberto neste recorte.</Vazio>;

  const max = Math.max(...linhas.map((l) => l[1].total));

  return (
    <>
      <div className={styles.barras}>
        {linhas.map(([quem, d]) => {
          const horas = horasDe[quem] ?? 0;
          return (
            <div key={quem} className={styles.barraLinha}>
              <div className={styles.barraNome} title={quem === "__sem__" ? "Sem responsável" : nomeDe(quem)}>
                {quem === "__sem__" ? "Sem responsável" : nomeDe(quem)}
              </div>
              <div className={styles.barraTrilho}>
                {Object.entries(d.setores)
                  .sort((a, b) => b[1] - a[1])
                  .map(([setor, n]) => (
                    <div
                      key={setor}
                      className={styles.barraSeg}
                      style={{
                        width: `${(n / max) * 100}%`,
                        background: corDoSetor[setor] ?? "var(--serie-1)",
                      }}
                      title={`${setor} · ${n}`}
                    />
                  ))}
              </div>
              <div className={styles.barraNum}>{d.total}</div>
              <div
                className={`${styles.barraHoras} ${horas ? "" : styles.barraHorasZero}`}
              >
                {hh(horas)} h/mês
              </div>
            </div>
          );
        })}
      </div>
      {setoresUsados.length > 1 && (
        <div className={styles.legenda}>
          {setoresUsados.map((s) => (
            <span key={s}>
              <i style={{ background: corDoSetor[s] ?? "var(--serie-1)" }} />
              {s}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** Rosca por tipo. As cores são as MESMAS do Kanban — tipo tem uma cor só no app. */
function Rosca({ cards }: { cards: Card[] }) {
  const total = cards.length;
  const contagem = useMemo(() => {
    const m: Record<string, number> = {};
    cards.forEach((c) => {
      const t = c.type && DEMAND_TYPES.includes(c.type) ? c.type : "__sem__";
      m[t] = (m[t] ?? 0) + 1;
    });
    return m;
  }, [cards]);

  if (!total) return <Vazio>Nenhuma demanda em aberto neste recorte.</Vazio>;

  const fatias = [
    ...DEMAND_TYPES.map((t) => ({
      chave: t as string,
      label: DEMAND_TYPE_LABEL[t as DemandType],
      cor: DEMAND_TYPE_COLOR[t as DemandType],
      n: contagem[t] ?? 0,
    })),
    {
      chave: "__sem__",
      label: "Sem tipo",
      cor: "var(--tx-3)",
      n: contagem["__sem__"] ?? 0,
    },
  ].filter((f) => f.n > 0);

  const R = 50;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className={styles.rosca}>
      <svg viewBox="0 0 136 136" className={styles.roscaSvg} role="img" aria-label="Demandas por tipo">
        {fatias.map((f) => {
          const len = (C * f.n) / total;
          // 2px de folga entre fatias: sem o vão, duas cores próximas viram uma.
          const desenho = Math.max(0, len - 2);
          const el = (
            <circle
              key={f.chave}
              cx={68}
              cy={68}
              r={R}
              fill="none"
              stroke={f.cor}
              strokeWidth={20}
              strokeDasharray={`${desenho.toFixed(2)} ${(C - desenho).toFixed(2)}`}
              strokeDashoffset={(-acc).toFixed(2)}
              transform="rotate(-90 68 68)"
            >
              <title>{`${f.label} · ${f.n}`}</title>
            </circle>
          );
          acc += len;
          return el;
        })}
        <text x={68} y={65} textAnchor="middle" className={styles.roscaNum}>
          {total}
        </text>
        <text x={68} y={83} textAnchor="middle" className={styles.roscaCap}>
          {total === 1 ? "demanda" : "demandas"}
        </text>
      </svg>
      <div className={styles.roscaLista}>
        {fatias.map((f) => (
          <div key={f.chave} className={styles.roscaItem}>
            <span className={styles.roscaDot} style={{ background: f.cor }} />
            <span className={styles.roscaLabel}>{f.label}</span>
            <b>{f.n}</b>
            <span className={styles.roscaPct}>
              {Math.round((f.n / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Entradas × entregas por semana, e a fila logo abaixo.
 *
 * Dois gráficos empilhados compartilhando o eixo x, e não um só com dois eixos
 * y: escala dupla deixa o autor escolher onde as linhas se cruzam, e é a
 * maneira mais fácil de fazer um gráfico honesto contar a história errada.
 */
function FluxoSemanal({ fluxo }: { fluxo: Fluxo }) {
  const { semanas, entradas, entregas, fila } = fluxo;
  if (!entradas.some(Boolean) && !entregas.some(Boolean))
    return (
      <Vazio>
        Sem movimento no período. As séries aparecem quando houver demanda
        criada ou concluída.
      </Vazio>
    );

  const W = 560;
  const H = 168;
  const pl = 30;
  const pr = 10;
  const pt = 10;
  const pb = 22;
  const n = semanas.length;
  const max = Math.max(1, ...entradas, ...entregas);
  const passo = (W - pl - pr) / n;
  const bw = Math.max(3, Math.min(10, (passo - 6) / 2));
  const Y = (v: number) => pt + (1 - v / max) * (H - pt - pb);

  const HF = 62;
  const maxFila = Math.max(1, ...fila);
  const Yf = (v: number) => 8 + (1 - v / maxFila) * (HF - 8 - 14);
  const X = (i: number) => pl + i * passo + passo / 2;

  const grade = [0, 1, 2, 3].map((g) => (max * g) / 3);
  const areaFila =
    `M ${X(0).toFixed(1)} ${(HF - 14).toFixed(1)} ` +
    fila.map((v, i) => `L ${X(i).toFixed(1)} ${Yf(v).toFixed(1)}`).join(" ") +
    ` L ${X(n - 1).toFixed(1)} ${(HF - 14).toFixed(1)} Z`;

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label="Entradas e entregas por semana">
        {grade.map((v, i) => (
          <g key={i}>
            <line
              x1={pl}
              y1={Y(v)}
              x2={W - pr}
              y2={Y(v)}
              className={styles.grade}
            />
            <text x={pl - 6} y={Y(v) + 3.5} textAnchor="end" className={styles.eixo}>
              {Math.round(v)}
            </text>
          </g>
        ))}
        {semanas.map((s, i) => (
          <g key={s.rotulo}>
            <rect
              x={X(i) - bw - 1}
              y={Y(entradas[i])}
              width={bw}
              height={H - pb - Y(entradas[i])}
              rx={3}
              className={styles.barEntrada}
            >
              <title>{`${s.rotulo} · ${entradas[i]} entrada(s)`}</title>
            </rect>
            <rect
              x={X(i) + 1}
              y={Y(entregas[i])}
              width={bw}
              height={H - pb - Y(entregas[i])}
              rx={3}
              className={styles.barEntrega}
            >
              <title>{`${s.rotulo} · ${entregas[i]} entrega(s)`}</title>
            </rect>
            {i % Math.ceil(n / 6) === 0 && (
              <text x={X(i)} y={H - 7} textAnchor="middle" className={styles.eixo}>
                {s.rotulo}
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className={styles.legenda}>
        <span>
          <i className={styles.swEntrada} />
          Entradas (demanda nova)
        </span>
        <span>
          <i className={styles.swEntrega} />
          Entregas
        </span>
      </div>

      <div className={styles.filaTitulo}>
        Fila acumulada <b>{fila[fila.length - 1]}</b>
      </div>
      <svg viewBox={`0 0 ${W} ${HF}`} className={styles.chart} role="img" aria-label="Fila acumulada por semana">
        <path d={areaFila} className={styles.filaArea} />
        <path
          d={fila
            .map((v, i) => `${i ? "L" : "M"} ${X(i).toFixed(1)} ${Yf(v).toFixed(1)}`)
            .join(" ")}
          className={styles.filaLinha}
        />
        {fila.map((v, i) => (
          <circle key={i} cx={X(i)} cy={Yf(v)} r={7} className={styles.alvo}>
            <title>{`${semanas[i].rotulo} · fila de ${v}`}</title>
          </circle>
        ))}
        <text x={pl - 6} y={12} textAnchor="end" className={styles.eixo}>
          {maxFila}
        </text>
        <text x={pl - 6} y={HF - 14} textAnchor="end" className={styles.eixo}>
          0
        </text>
      </svg>
    </>
  );
}

function CycleTime({ fluxo }: { fluxo: Fluxo }) {
  const { pontos, p50, p85, p95, amostra, semanas } = fluxo;
  if (amostra === 0)
    return (
      <Vazio>
        Nenhuma demanda concluída no período — sem conclusão não há cycle time.
      </Vazio>
    );
  if (amostra < MIN_AMOSTRA)
    return (
      <Vazio>
        Só {amostra} conclusão(ões) no período. Percentil com amostra assim vira
        chute — o gráfico aparece a partir de {MIN_AMOSTRA}.
      </Vazio>
    );

  const W = 560;
  const H = 200;
  const pl = 30;
  const pr = 52;
  const pt = 10;
  const pb = 24;
  const ini = semanas[0].inicio.getTime();
  // Fim da janela = fim da última semana da série. `Date.now()` aqui seria
  // leitura de relógio durante a renderização, e o eixo mudaria sozinho.
  const fim = semanas[semanas.length - 1].inicio.getTime() + 6 * 86400000;
  const maxY = Math.max(p95 + 4, ...pontos.map((p) => p.dias)) || 1;
  const X = (ms: number) => pl + ((ms - ini) / Math.max(1, fim - ini)) * (W - pl - pr);
  const Y = (v: number) => pt + (1 - v / maxY) * (H - pt - pb);

  const linhas: [number, string, string][] = [
    [p50, "var(--ok)", "50%"],
    [p85, "var(--warn)", "85%"],
    [p95, "var(--danger)", "95%"],
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label="Cycle time das demandas concluídas">
      {[0, 1, 2, 3].map((g) => {
        const v = (maxY * g) / 3;
        return (
          <g key={g}>
            <line x1={pl} y1={Y(v)} x2={W - pr} y2={Y(v)} className={styles.grade} />
            <text x={pl - 6} y={Y(v) + 3.5} textAnchor="end" className={styles.eixo}>
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      {linhas.map(([v, cor, rot]) => (
        <g key={rot}>
          <line
            x1={pl}
            y1={Y(v)}
            x2={W - pr}
            y2={Y(v)}
            stroke={cor}
            strokeWidth={1.4}
            strokeDasharray="5 4"
          />
          <text x={W - pr + 5} y={Y(v) + 3.5} fill={cor} className={styles.percentil}>
            {rot} · {v}d
          </text>
        </g>
      ))}
      {pontos.map((p, i) => (
        <circle key={i} cx={X(p.x)} cy={Y(p.dias)} r={4} className={styles.ponto}>
          <title>{`${p.dias} dia(s) · concluída em ${fmtDayMonth(toISO(new Date(p.x)))}`}</title>
        </circle>
      ))}
      <text x={pl} y={H - 6} className={styles.eixo}>
        {semanas[0].rotulo}
      </text>
      <text x={W - pr} y={H - 6} textAnchor="end" className={styles.eixo}>
        hoje
      </text>
    </svg>
  );
}

function TabelaPrazos({
  cards,
  hoje,
  nomeDe,
  colsPorSetor,
  corDoSetor,
}: {
  cards: Card[];
  hoje: Date;
  nomeDe: (e: string) => string;
  colsPorSetor: Record<string, KanbanColumn[]>;
  corDoSetor: Record<string, string>;
}) {
  const linhas = useMemo(
    () =>
      cards
        .filter((c) => c.due)
        .map((c) => ({ c, d: daysBetween(c.due as string, hoje) }))
        .filter((x) => x.d >= -14)
        .sort((a, b) => b.d - a.d),
    [cards, hoje],
  );

  if (!linhas.length)
    return (
      <Vazio>
        Nenhuma demanda vencida ou vencendo nos próximos 14 dias.
      </Vazio>
    );

  return (
    <div className={styles.tabelaWrap}>
      <table className={styles.tabela}>
        <thead>
          <tr>
            <th>Demanda</th>
            <th>Setor</th>
            <th>Responsável</th>
            <th>Etapa</th>
            <th style={{ textAlign: "right" }}>Prazo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(({ c, d }) => {
            const col = (colsPorSetor[c.sector] ?? []).find(
              (x) => x.id === c.columnId,
            );
            return (
              <tr key={c.id}>
                <td>
                  <Link
                    href={`/kanban?setor=${encodeURIComponent(c.sector)}&card=${c.id}`}
                    className={styles.linkCard}
                  >
                    {c.title}
                  </Link>
                </td>
                <td>
                  <span className={styles.setorCel}>
                    <i style={{ background: corDoSetor[c.sector] ?? "var(--serie-1)" }} />
                    {c.sector}
                  </span>
                </td>
                <td>{c.assignee ? nomeDe(c.assignee) : "—"}</td>
                <td style={{ color: col?.color }}>{col?.title ?? "—"}</td>
                <td className={styles.prazoCel}>
                  {fmtDayMonth(c.due as string)}
                  <PrazoChip dias={d} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PrazoChip({ dias }: { dias: number }) {
  if (dias > 0)
    return (
      <span className={`${styles.chip} ${styles.chipDanger}`}>
        vencida há {dias}d
      </span>
    );
  if (dias === 0)
    return <span className={`${styles.chip} ${styles.chipWarn}`}>vence hoje</span>;
  const faltam = -dias;
  return (
    <span className={`${styles.chip} ${faltam <= 3 ? styles.chipWarn : ""}`}>
      em {faltam}d
    </span>
  );
}
