"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  columnsBySector,
  deliveredBySector,
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
 * mostra carga para redistribuir, segmentada pelo setor solicitante (de onde a
 * demanda veio, que é com quem se negocia) e somando as horas de manutenção
 * recorrente: quem tem quatro recorrências no nome tem menos mão para demanda
 * nova, mesmo com poucos cards.
 *
 * DEMANDA ENTREGUE SAI DE TUDO. Card na etapa de entrega não entra em "em
 * aberto", não conta como vencido e não pesa na carga de ninguém — o prazo dele
 * pode ter passado DEPOIS de o trabalho acabar. A regra de "o que é entrega"
 * mora em `lib/kanban-columns`, uma só para o app inteiro.
 *
 * SOBRE A PRECISÃO DOS NÚMEROS DE FLUXO: o app não guarda o histórico de
 * movimentação dos cards. As séries são derivadas do que existe —
 *   entrada  = data de criação do card;
 *   entrega  = quando o card entrou na etapa de entrega (`enteredAt`);
 *   cycle time = diferença entre as duas.
 * É aproximação. Um card que voltou de coluna depois de concluído conta a
 * partir do último movimento; nada disso muda a leitura que importa (a
 * tendência), mas muda o número exato — e prometer prazo com número exato que
 * não existe seria pior do que não medir.
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

  /**
   * Demanda entregue não conta como aberta — e, principalmente, não atrasa.
   *
   * Todo número desta tela (vencidas, prazos, fila) se apoia nisto: o card na
   * etapa de entrega sai da conta mesmo com a data de prazo no passado, porque
   * a data passou DEPOIS de o trabalho terminar.
   */
  const entreguesPorSetor = useMemo(
    () => deliveredBySector(colsPorSetor),
    [colsPorSetor],
  );

  const concluido = useMemo(
    () => (c: Card) => !!entreguesPorSetor[c.sector]?.has(c.columnId),
    [entreguesPorSetor],
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
      </div>

      {/**
       * A ordem dos painéis é de altura, não só de assunto.
       *
       * Consumo por responsável cresce com o número de pessoas do setor e não
       * tem teto — ao lado de qualquer painel de altura fixa, ele decide a
       * altura da linha inteira. Por isso vai sozinho, na largura toda: assim
       * as origens de cada demanda cabem numa linha só, em vez de quebrarem.
       *
       * Na dupla ficam os dois painéis de altura parecida (rosca e cycle time);
       * os dois gráficos largos ficam inteiros embaixo, onde 52 semanas cabem.
       */}
      <div className={styles.paineis}>
        <section className={`${styles.painel} ${styles.painelLargo}`}>
          <PainelHead titulo="Consumo por responsável" />
          <BarrasResponsavel
            cards={abertos}
            recs={recsNoRecorte}
            nomeDe={nomeDe}
          />
        </section>

        <section className={styles.painel}>
          <PainelHead titulo="Demandas por tipo" />
          <Rosca cards={abertos} />
        </section>

        <section className={styles.painel}>
          <PainelHead
            titulo="Cycle time e previsibilidade"
            chip={
              fluxo.amostra >= MIN_AMOSTRA
                ? `p50 ${fluxo.p50}d · p85 ${fluxo.p85}d`
                : undefined
            }
          />
          <CycleTime fluxo={fluxo} />
        </section>

        <section className={`${styles.painel} ${styles.painelLargo}`}>
          <PainelHead
            titulo="Demanda que entra × demanda que sai"
            chip={`fila ${fluxo.fila[fluxo.fila.length - 1] ?? 0}`}
          />
          <FluxoSemanal fluxo={fluxo} />
        </section>

        <section className={`${styles.painel} ${styles.painelLargo}`}>
          <PainelHead
            titulo="Prazos — vencidas e a vencer"
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
  chip,
  chipTom,
}: {
  titulo: string;
  chip?: string;
  chipTom?: "danger";
}) {
  return (
    <div className={styles.painelHead}>
      <div>
        <h3>{titulo}</h3>
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

/** Rótulo do card cujo setor solicitante ficou em branco. */
const SEM_ORIGEM = "Sem setor solicitante";

/** "Ana, João +2" — nomes bastantes para reconhecer, curto bastante para caber. */
function listaCurta(nomes: string[], teto = 2): string {
  const ordenados = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const resto = ordenados.length - teto;
  return resto > 0
    ? `${ordenados.slice(0, teto).join(", ")} +${resto}`
    : ordenados.join(", ");
}

/**
 * Carga de cada responsável, segmentada por DE ONDE a demanda veio.
 *
 * A pergunta que o gestor faz olhando para uma barra grande não é "quantas
 * são", é "quantas são de quem" — três demandas do mesmo setor solicitante se
 * negociam de uma vez com aquele setor, três de setores diferentes não. Por
 * isso o segmento é o setor solicitante e não o setor interno do quadro, que
 * na prática é sempre o mesmo em quem olha um recorte só.
 *
 * Os segmentos levam 2px de respiro entre si, e a linha abaixo repete origem,
 * contagem e nomes em texto: no tema claro a paleta categórica fica abaixo de
 * 3:1 contra o fundo, e cor sozinha não responde nada.
 */
function BarrasResponsavel({
  cards,
  recs,
  nomeDe,
}: {
  cards: Card[];
  recs: Recorrencia[];
  nomeDe: (e: string) => string;
}) {
  const linhas = useMemo(() => {
    const por: Record<
      string,
      {
        total: number;
        origens: Record<string, { n: number; quem: Set<string> }>;
      }
    > = {};
    cards.forEach((c) => {
      const quem = c.assignee || "__sem__";
      const r = (por[quem] = por[quem] ?? { total: 0, origens: {} });
      r.total++;
      const origem = c.requesterSector?.trim() || SEM_ORIGEM;
      const o = (r.origens[origem] = r.origens[origem] ?? {
        n: 0,
        quem: new Set<string>(),
      });
      o.n++;
      const solicitante = c.requester?.trim();
      if (solicitante) o.quem.add(solicitante);
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

  /**
   * Cor por setor solicitante, na ordem alfabética dos que aparecem — a mesma
   * ordem da legenda, para os dois lados baterem. "Sem setor solicitante" fica
   * fora da paleta: campo vazio não merece cor de série.
   */
  const origensUsadas = useMemo(
    () =>
      [...new Set(cards.map((c) => c.requesterSector?.trim() || SEM_ORIGEM))]
        .filter((o) => o !== SEM_ORIGEM)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [cards],
  );
  const corDaOrigem = useMemo(() => {
    const m: Record<string, string> = { [SEM_ORIGEM]: "var(--tx-3)" };
    origensUsadas.forEach((o, i) => (m[o] = `var(--serie-${(i % 8) + 1})`));
    return m;
  }, [origensUsadas]);

  if (!linhas.length)
    return <Vazio>Nenhuma demanda em aberto neste recorte.</Vazio>;

  const max = Math.max(...linhas.map((l) => l[1].total));
  // Setor sem nenhuma recorrência programada não ganha uma coluna de "0 h/mês"
  // repetida linha a linha: zero em todo mundo não distingue ninguém.
  const mostrarHoras = linhas.some(([quem]) => (horasDe[quem] ?? 0) > 0);

  return (
    <>
      <div className={styles.barras}>
        {linhas.map(([quem, d]) => {
          const horas = horasDe[quem] ?? 0;
          const nome = quem === "__sem__" ? "Sem responsável" : nomeDe(quem);
          const origens = Object.entries(d.origens).sort(
            (a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0], "pt-BR"),
          );
          return (
            <div key={quem} className={styles.barraBloco}>
              <div className={styles.barraLinha}>
                <div className={styles.barraNome} title={nome}>
                  {nome}
                </div>
                <div className={styles.barraTrilho}>
                  {origens.map(([origem, o]) => (
                    <div
                      key={origem}
                      className={styles.barraSeg}
                      style={{
                        width: `${(o.n / max) * 100}%`,
                        background: corDaOrigem[origem],
                      }}
                      title={`${origem} · ${o.n}${
                        o.quem.size ? ` · ${[...o.quem].join(", ")}` : ""
                      }`}
                    />
                  ))}
                </div>
                <div className={styles.barraNum}>{d.total}</div>
                {mostrarHoras && (
                  <div
                    className={`${styles.barraHoras} ${horas ? "" : styles.barraHorasZero}`}
                  >
                    {hh(horas)} h/mês
                  </div>
                )}
              </div>
              <div
                className={`${styles.barraOrigens} ${
                  mostrarHoras ? "" : styles.barraOrigensSemHoras
                }`}
              >
                {origens.map(([origem, o]) => (
                  <span
                    key={origem}
                    className={styles.origem}
                    title={
                      o.quem.size
                        ? `Solicitantes: ${[...o.quem].join(", ")}`
                        : "Nenhum solicitante informado"
                    }
                  >
                    <i style={{ background: corDaOrigem[origem] }} />
                    {origem}
                    <b>{o.n}</b>
                    {o.quem.size > 0 && <em>{listaCurta([...o.quem])}</em>}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {origensUsadas.length > 1 && (
        <div className={styles.legenda}>
          {origensUsadas.map((o) => (
            <span key={o}>
              <i style={{ background: corDaOrigem[o] }} />
              {o}
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
 * Entradas × entregas por semana, com a fila acumulada por cima.
 *
 * Um gráfico só: as colunas e a linha respondem à mesma pergunta ("a fila
 * cresce ou encolhe?") e liam-se pior separadas, obrigando a saltar de um eixo
 * x para outro para cruzar a semana da entrada com a fila daquela semana.
 *
 * A fila tem eixo PRÓPRIO, à direita e rotulado. Ela é acumulada e cresce numa
 * ordem de grandeza acima do movimento semanal — na escala das colunas, viraria
 * uma linha colada no topo, sem informação. Dois eixos exigem estar declarados,
 * e é por isso que o da direita carrega números e a legenda diz de quem ele é.
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

  // Painel de largura inteira: o viewBox acompanha, senão o SVG escala ~3× e o
  // rótulo de eixo de 9,5px chega na tela com 30. Larguras em unidades de
  // viewBox só significam alguma coisa em relação a W.
  const W = 1120;
  const H = 190;
  const pl = 34;
  const pr = 42;
  const pt = 12;
  const pb = 24;
  const n = semanas.length;
  const base = H - pb;
  const max = Math.max(1, ...entradas, ...entregas);
  const maxFila = Math.max(1, ...fila);
  const passo = (W - pl - pr) / n;
  // Espessura proporcional ao passo, e não um teto fixo: com 12 semanas num
  // gráfico largo, barra travada em 10 vira um risco perdido em 140px de vão.
  const bw = Math.max(3, Math.min(passo * 0.32, (passo - 6) / 2));
  const Y = (v: number) => pt + (1 - v / max) * (base - pt);
  const Yf = (v: number) => pt + (1 - v / maxFila) * (base - pt);
  const X = (i: number) => pl + i * passo + passo / 2;

  const linhaFila = fila
    .map((v, i) => `${i ? "L" : "M"} ${X(i).toFixed(1)} ${Yf(v).toFixed(1)}`)
    .join(" ");

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        role="img"
        aria-label="Entradas, entregas e fila acumulada por semana"
      >
        {[0, 1, 2, 3].map((g) => {
          const v = (max * g) / 3;
          return (
            <g key={g}>
              <line
                x1={pl}
                y1={Y(v)}
                x2={W - pr}
                y2={Y(v)}
                className={styles.grade}
              />
              <text
                x={pl - 6}
                y={Y(v) + 3.5}
                textAnchor="end"
                className={styles.eixo}
              >
                {Math.round(v)}
              </text>
              <text x={W - pr + 6} y={Y(v) + 3.5} className={styles.eixoFila}>
                {Math.round((maxFila * g) / 3)}
              </text>
            </g>
          );
        })}

        {semanas.map((s, i) => (
          <g key={s.rotulo}>
            <rect
              x={X(i) - bw - 1}
              y={Y(entradas[i])}
              width={bw}
              height={base - Y(entradas[i])}
              rx={3}
              className={styles.barEntrada}
            >
              <title>{`${s.rotulo} · ${entradas[i]} entrada(s)`}</title>
            </rect>
            <rect
              x={X(i) + 1}
              y={Y(entregas[i])}
              width={bw}
              height={base - Y(entregas[i])}
              rx={3}
              className={styles.barEntrega}
            >
              <title>{`${s.rotulo} · ${entregas[i]} entrega(s)`}</title>
            </rect>
            {/* Mais rótulos do que cabiam na metade da tela: a série é
                semanal, e ler a data de 1 em cada 6 obriga a contar barras. */}
            {i % Math.ceil(n / 12) === 0 && (
              <text
                x={X(i)}
                y={H - 7}
                textAnchor="middle"
                className={styles.eixo}
              >
                {s.rotulo}
              </text>
            )}
          </g>
        ))}

        {/* A linha vem depois das colunas: desenhada antes, sumiria atrás delas
            exatamente nas semanas de mais movimento — as que interessam. */}
        <path d={linhaFila} className={styles.filaHalo} />
        <path d={linhaFila} className={styles.filaLinha} />
        {fila.map((v, i) => (
          <g key={i}>
            <circle cx={X(i)} cy={Yf(v)} r={2.6} className={styles.filaPonto} />
            {/* Alvo de hover maior que o traço, e o resumo da semana INTEIRA
                nele: sobrepondo as colunas, ele roubaria o hover delas. */}
            <circle cx={X(i)} cy={Yf(v)} r={7} className={styles.alvo}>
              <title>
                {`${semanas[i].rotulo} · ${entradas[i]} entrada(s) · ${entregas[i]} entrega(s) · fila de ${v}`}
              </title>
            </circle>
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
        <span>
          <i className={styles.swFila} />
          Fila acumulada (eixo à direita)
        </span>
      </div>
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

  // Proporção achatada de propósito. O SVG escala pela largura, então o painel
  // decide a ALTURA: com o viewBox antigo (560×200) este gráfico ficava 180px
  // mais alto que a rosca ao lado, e a diferença virava buraco na linha.
  //
  // 660 é o meio-termo entre as duas pontas de tela: a fonte do eixo escala
  // junto, e um viewBox estreito engorda o texto no monitor grande enquanto um
  // largo o apaga no notebook.
  const W = 660;
  const H = 168;
  const pl = 34;
  const pr = 70;
  const pt = 10;
  const pb = 26;
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
