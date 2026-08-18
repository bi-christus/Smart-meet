"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
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
  rotuloSemana,
  semanaPorExtenso,
  startOfDay,
  startOfWeek,
} from "@/lib/datas";
import { escalaDoEixo } from "@/lib/grafico-core";
import { juntarFontes, type Fonte } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonChart, SkeletonRow } from "@/components/skeleton";
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

/**
 * Listas vazias constantes, para os cálculos rodarem antes de os dados chegarem.
 *
 * Elas moram fora do componente porque `?? []` escrito no corpo cria um array
 * NOVO a cada render, e todo `useMemo` que dependesse dele recalcularia sempre
 * — o Dashboard tem doze. Nenhuma delas chega à tela: quem decide se o painel
 * desenha é `juntarFontes`, painel a painel.
 */
const SEM_CARDS: Card[] = [];
const SEM_COLS: ColumnDoc[] = [];
const SEM_RECS: Recorrencia[] = [];
const SEM_USERS: UserProfile[] = [];

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

  /**
   * As quatro assinaturas, cada uma sabendo dizer se já respondeu.
   *
   * Antes eram quatro `useState([])`: enquanto o Firestore não respondia, a
   * tela afirmava seis vezes que não havia nada. E os três callbacks de erro
   * vazios, mais o que só escrevia no console, faziam com que negação de
   * permissão ficasse para sempre parecendo "não há nada aqui" — que é a mesma
   * tela de quando dá certo e o setor está zerado.
   */
  const chaveSetores = sectors.join("|");
  const fCards = useAsyncData<Card>(chaveSetores, (onData, onErro) =>
    subscribeCardsForSectors(sectors, onData, onErro),
  );
  const fCols = useAsyncData<ColumnDoc>(chaveSetores, (onData, onErro) =>
    subscribeColumnsForSectors(sectors, onData, onErro),
  );
  const fRecs = useAsyncData<Recorrencia>(chaveSetores, (onData, onErro) =>
    subscribeRecorrencias(sectors, onData, onErro),
  );
  // A lista de pessoas não é recortada por setor, então a chave é fixa: só
  // remonta em "tentar de novo".
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const cols = fCols.data ?? SEM_COLS;
  const recs = fRecs.data ?? SEM_RECS;
  const users = fUsers.data ?? SEM_USERS;

  const [fSetor, setFSetor] = useState("");
  const [fPessoa, setFPessoa] = useState("");
  const [fResp, setFResp] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(12);

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

  /**
   * A faixa de indicadores não ganhou esqueleto: ganhou o travessão.
   *
   * Ela é a primeira coisa que o olho encontra, e "0 vencidas" virando "12
   * vencidas" meio segundo depois é a mesma mentira dos painéis, em número. O
   * travessão já é o jeito desta tela de dizer "não sei" — é o que o p85 usa
   * quando a amostra é pequena demais, três linhas abaixo. Cinco shimmers
   * lado a lado numa faixa de 60px de altura seriam mais ruído que informação,
   * e cinco `aria-live` anunciando "Carregando…" em sequência, pior ainda.
   */
  const kpis = juntarFontes([fCards, fCols]);
  const kpiSemResposta = kpis.carregando || !!kpis.erro;
  const p85Txt =
    kpiSemResposta || fluxo.amostra < MIN_AMOSTRA ? "—" : String(fluxo.p85);
  const kpi = (n: number) => (kpiSemResposta ? "—" : n);

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
        {!kpiSemResposta && (
          <span className={styles.contagem}>
            {abertos.length}{" "}
            {abertos.length === 1 ? "demanda em aberto" : "demandas em aberto"}
            {fPessoaAtivo ? " · pessoa = autor ou responsável" : ""}
          </span>
        )}
      </div>

      <div className={styles.kstrip}>
        <Kpi
          icone="kanban"
          rotulo="Em aberto"
          valor={kpi(abertos.length)}
          rodape={
            kpiSemResposta
              ? "aguardando o quadro"
              : `${doRecorte.length - abertos.length} concluída(s) fora da conta`
          }
        />
        <Kpi
          icone="warn"
          rotulo="Vencidas"
          valor={kpi(prazos.vencidas)}
          rodape="prazo já ultrapassado"
          tom={!kpiSemResposta && prazos.vencidas ? "danger" : undefined}
        />
        <Kpi
          icone="calendar"
          rotulo="Vencem em 7 dias"
          valor={kpi(prazos.proximas)}
          rodape="entram na semana"
          tom={!kpiSemResposta && prazos.proximas ? "warn" : undefined}
        />
        <Kpi
          icone="clock"
          rotulo="Cycle time p85"
          valor={p85Txt}
          unidade={p85Txt === "—" ? "" : "dias"}
          rodape={
            kpiSemResposta
              ? "aguardando o quadro"
              : fluxo.amostra >= MIN_AMOSTRA
                ? "85% saem nesse prazo ou menos"
                : `${fluxo.amostra} conclusão(ões) no período — amostra pequena demais`
          }
        />
        <Kpi
          icone="check"
          rotulo="Entregas"
          valor={kpi(fluxo.entregas4)}
          unidade="/4 sem"
          rodape="concluídas nas últimas 4 semanas"
        />
      </div>

      {/**
       * UMA COLUNA, e todo painel na largura inteira.
       *
       * A grade era de duas colunas com uma escotilha (`largo`) para os painéis
       * que não cabiam nela — e três dos cinco usavam a escotilha. O que a
       * derrubou de vez foi o painel de setor solicitante passar a ocupar a
       * largura toda (Issue #83): sobrava um único painel de meia largura, com
       * meia linha vazia ao lado, que é exatamente o "card 80% vazio lê como
       * bug" que o comentário de `align-items: start` existia para evitar.
       *
       * Nenhum destes painéis é de meia largura por natureza. Três são séries e
       * tabelas que ganham com cada pixel de largura; os dois de barra deitada
       * medem por COMPRIMENTO, e comprimento cortado ao meio é a medida ficando
       * pela metade. A ordem, agora, é só de assunto: quem carrega (pessoas),
       * de que é feita a fila (tipo, origem), como ela anda (fluxo) e o que
       * está vencendo (prazos).
       */}
      {/**
       * Cada painel espera pelas fontes QUE ELE LÊ, e por mais nenhuma.
       *
       * Um esqueleto de página inteira seria a rosca de tipos esperando a lista
       * de usuários, que ela nem consulta. As dependências abaixo não são as
       * das props: `abertos` passa por `concluido`, que sai de `cols` — desenhar
       * qualquer painel antes de as colunas chegarem mostraria demanda entregue
       * contada como aberta, que é número errado, e não só número faltando.
       */}
      <div className={styles.paineis}>
        <Painel
          titulo="Consumo por responsável"
          fontes={[fCards, fCols, fRecs, fUsers]}
          esqueleto={<SkeletonRow rows={4} texto="Carregando a carga por responsável…" />}
        >
          <BarrasResponsavel
            cards={abertos}
            recs={recsNoRecorte}
            nomeDe={nomeDe}
          />
        </Painel>

        <Painel
          titulo="Demandas por tipo"
          fontes={[fCards, fCols]}
          esqueleto={<SkeletonChart bars={5} texto="Carregando a divisão por tipo…" />}
        >
          <Rosca cards={abertos} />
        </Painel>

        {/**
         * O CHIP DEIXOU DE SER `p50 Xd · p85 Yd`.
         *
         * Aquele número é cycle time, e este painel parou de medir cycle time —
         * mantê-lo aqui seria um número certo sob um rótulo errado, que é a
         * única forma de erro que ninguém confere. A previsibilidade continua
         * inteira no KPI "Cycle time p85" da faixa do topo, com a mesma
         * `MIN_AMOSTRA` segurando a publicação.
         *
         * No lugar dele vai o TOTAL do painel, e ele existe por um motivo
         * concreto: as barras somam demanda entregue, então a soma delas é
         * maior que as "N demandas em aberto" escritas na barra de filtros.
         * Sem o chip, quem conferisse a conta acharia que o painel está errado.
         *
         * O esqueleto é o de LINHAS: a forma nova continua sendo uma lista de
         * barras deitadas, agora com a linha de etapas embaixo de cada uma —
         * daí uma linha a mais que antes, para o painel não encolher quando o
         * conteúdo chegar.
         */}
        <Painel
          titulo="Demandas por setor solicitante"
          chip={`${doRecorte.length} ${doRecorte.length === 1 ? "demanda" : "demandas"}`}
          fontes={[fCards, fCols]}
          esqueleto={
            <SkeletonRow
              rows={5}
              texto="Carregando as demandas por setor solicitante…"
            />
          }
        >
          <OrigemPorEtapa cards={doRecorte} colsPorSetor={colsPorSetor} />
        </Painel>

        <Painel
          titulo="Demanda que entra × demanda que sai"
          chip={`fila ${fluxo.fila[fluxo.fila.length - 1] ?? 0}`}
          fontes={[fCards, fCols]}
          esqueleto={<SkeletonChart bars={10} texto="Carregando as séries semanais…" />}
        >
          <FluxoSemanal fluxo={fluxo} />
        </Painel>

        <Painel
          titulo="Prazos — vencidas e a vencer"
          chip={`${prazos.vencidas} ${prazos.vencidas === 1 ? "vencida" : "vencidas"}`}
          chipTom={prazos.vencidas ? "danger" : undefined}
          fontes={[fCards, fCols, fUsers]}
          esqueleto={<SkeletonRow rows={5} texto="Carregando os prazos…" />}
        >
          <TabelaPrazos
            cards={abertos}
            hoje={hoje}
            nomeDe={nomeDe}
            colsPorSetor={colsPorSetor}
            corDoSetor={corDoSetor}
          />
        </Painel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cálculo do fluxo
// ---------------------------------------------------------------------------

/**
 * As séries do período, e o que dá para prometer de prazo a partir delas.
 *
 * `pontos` (uma entrada por conclusão, com dias e tipo) e `p50` moravam aqui e
 * saíram junto com o painel de cycle time por tipo, que era o único a lê-los —
 * ver `OrigemPorEtapa`, que tomou o lugar dele. O p85 fica, porque o KPI do topo
 * continua publicando; a lista de durações que o gera não precisa mais escapar
 * de `calcularFluxo`, e guardá-la era peso num `useMemo` que percorre o quadro
 * inteiro a cada troca de filtro.
 */
type Semana = {
  inicio: Date;
  /** "3–9 ago" — o intervalo, para o eixo x. */
  rotulo: string;
  /** "3 a 9 de agosto de 2026" — a mesma semana para o balão e o leitor de tela. */
  porExtenso: string;
};

type Fluxo = {
  semanas: Semana[];
  entradas: number[];
  entregas: number[];
  fila: number[];
  p85: number;
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
  /**
   * O rótulo nomeia o INTERVALO, não o primeiro dia.
   *
   * Era `${dia}/${mês}` do começo da semana: uma coluna de sete dias escrita
   * "3/08", que se lê "3 de agosto". Os usuários leram assim e concluíram que o
   * gráfico era diário — a leitura estava certa, o rótulo é que prometia o que
   * o desenho não tem. As duas formas moram em `datas.ts`, com teste.
   */
  const semanas: Semana[] = Array.from({ length: semanasN }, (_, i) => {
    const inicio = addDays(primeira, i * 7);
    return {
      inicio,
      rotulo: rotuloSemana(inicio),
      porExtenso: semanaPorExtenso(inicio),
    };
  });
  const indiceDa = (ms: number) => {
    const i = Math.floor((ms - primeira.getTime()) / (86400000 * 7));
    return i >= 0 && i < semanasN ? i : -1;
  };

  const entradas = new Array(semanasN).fill(0);
  const entregas = new Array(semanasN).fill(0);
  /** Dias entre criação e conclusão, uma entrada por card entregue no período. */
  const duracoes: number[] = [];
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
        if (nasceu !== null && entregue >= nasceu)
          duracoes.push(Math.max(0, Math.round((entregue - nasceu) / 86400000)));
      }
    }
  });

  const fila: number[] = [];
  let acc = filaInicial;
  for (let i = 0; i < semanasN; i++) {
    acc = Math.max(0, acc + entradas[i] - entregas[i]);
    fila.push(acc);
  }

  return {
    semanas,
    entradas,
    entregas,
    fila,
    p85: percentil(
      [...duracoes].sort((a, b) => a - b),
      0.85,
    ),
    amostra: duracoes.length,
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

/** Uma assinatura vista pelo painel: o estado dela, e como reabri-la. */
type Assinatura = Fonte & { tentarDeNovo: () => void };

/**
 * Um painel do Dashboard, com o próprio estado de carregamento.
 *
 * A moldura e o título ficam SEMPRE na tela — é o que segura a forma da pilha
 * enquanto os cinco painéis resolvem em tempos diferentes. Só o miolo troca
 * entre esqueleto, erro e conteúdo.
 *
 * O CHIP SOME ENQUANTO NÃO SE SABE. Ele é calculado a partir dos mesmos dados
 * do miolo, então antes da resposta diria "fila 0" ou "0 vencidas" com a
 * autoridade de um número pronto — a mentira que esta Issue existe para tirar,
 * só que no cabeçalho.
 *
 * "Tentar de novo" reabre as assinaturas DESTE painel, e não as quatro: se só
 * a lista de pessoas falhou, não há motivo para o quadro inteiro voltar ao
 * esqueleto junto.
 */
function Painel({
  titulo,
  chip,
  chipTom,
  fontes,
  esqueleto,
  children,
}: {
  titulo: string;
  chip?: string;
  chipTom?: "danger";
  fontes: Assinatura[];
  esqueleto: ReactNode;
  children: ReactNode;
}) {
  const { erro, carregando } = juntarFontes(fontes);
  return (
    <section
      className={styles.painel}
      aria-busy={carregando || undefined}
    >
      <PainelHead
        titulo={titulo}
        chip={erro || carregando ? undefined : chip}
        chipTom={chipTom}
      />
      {erro ? (
        <ErrorState
          error={erro}
          size="compact"
          onRetry={() => fontes.forEach((f) => f.tentarDeNovo())}
        />
      ) : carregando ? (
        esqueleto
      ) : (
        children
      )}
    </section>
  );
}

/** Rótulo do card cujo setor solicitante ficou em branco. */
const SEM_ORIGEM = "Sem setor solicitante";

/**
 * Carga de cada responsável, segmentada por QUAL SETOR pediu.
 *
 * A pergunta que o gestor faz olhando para uma barra grande não é "quantas
 * são", é "quais setores puxam mais desta pessoa" — três demandas do mesmo
 * setor solicitante se negociam de uma vez com aquele setor, três de setores
 * diferentes não. Por isso o segmento é o setor solicitante e não o setor
 * interno do quadro, que na prática é sempre o mesmo em quem olha um recorte
 * só.
 *
 * O nome de quem pediu fica FORA, de propósito: aqui a unidade de negociação é
 * o setor, e listar pessoas transformava a leitura em "quem me pediu o quê",
 * que é assunto do card. Decisão do Ítalo em 10/08/2026.
 *
 * Os segmentos levam 2px de respiro entre si, e a linha abaixo repete setor e
 * contagem em texto: no tema claro a paleta categórica fica abaixo de 3:1
 * contra o fundo, e cor sozinha não responde nada.
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
      { total: number; origens: Record<string, number> }
    > = {};
    cards.forEach((c) => {
      const quem = c.assignee || "__sem__";
      const r = (por[quem] = por[quem] ?? { total: 0, origens: {} });
      r.total++;
      const origem = c.requesterSector?.trim() || SEM_ORIGEM;
      r.origens[origem] = (r.origens[origem] ?? 0) + 1;
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
    return (
      <EmptyState
        size="compact"
        icon="users"
        title="Ninguém com demanda em aberto"
        description="Quando houver demanda aberta no recorte, a carga de cada responsável aparece aqui — segmentada pelo setor que pediu."
      />
    );

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
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
          );
          return (
            <div key={quem} className={styles.barraBloco}>
              <div className={styles.barraLinha}>
                <div className={styles.barraNome} title={nome}>
                  {nome}
                </div>
                <div className={styles.barraTrilho}>
                  {origens.map(([origem, n]) => (
                    <div
                      key={origem}
                      className={styles.barraSeg}
                      style={{
                        width: `${(n / max) * 100}%`,
                        background: corDaOrigem[origem],
                      }}
                      title={`${origem} · ${n}`}
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
                {origens.map(([origem, n]) => (
                  <span key={origem} className={styles.origem}>
                    <i style={{ background: corDaOrigem[origem] }} />
                    {origem}
                    <b>{n}</b>
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

  if (!total)
    return (
      <EmptyState
        size="compact"
        icon="kanban"
        title="Nenhuma demanda em aberto"
        description="A divisão por tipo aparece assim que houver demanda aberta neste recorte."
      />
    );

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
 * A geometria do desenho, em unidades de viewBox.
 *
 * Fora do componente porque são constantes, e dentro dele seriam recalculadas a
 * cada movimento do ponteiro — esta peça re-renderiza a cada semana que o
 * cursor atravessa.
 *
 * `W` continua 1120 pelo motivo de antes: o painel ocupa a largura inteira, e
 * um viewBox estreito faria o SVG escalar ~3×, entregando o rótulo de 9,5px com
 * 30px na tela. As duas faixas empilhadas — barras em cima, fila embaixo —
 * dividem o mesmo eixo x, e é só por isso que dá para ler na vertical "nesta
 * semana entrou tanto, e a fila ficou assim".
 */
const W = 1120;
const PL = 40;
const PR = 14;
const TOPO = 26;
const BASE = 156;
const FILA_TOPO = 192;
const FILA_BASE = 232;
const H = 258;

/**
 * Barra com o topo arredondado e a base reta.
 *
 * `rx` num `<rect>` arredonda os quatro cantos, e o canto de baixo é o ZERO do
 * eixo: arredondado, ele descola da linha de base e a barra passa a flutuar
 * alguns pixels acima do valor que representa. Numa barra de 3px de altura —
 * uma semana de uma demanda só — isso é a diferença inteira.
 */
function barra(
  x: number,
  topo: number,
  largura: number,
  altura: number,
): string {
  const r = Math.min(3, largura / 2, altura);
  const base = topo + altura;
  return `M${x} ${base}V${topo + r}A${r} ${r} 0 0 1 ${x + r} ${topo}H${x + largura - r}A${r} ${r} 0 0 1 ${x + largura} ${topo + r}V${base}Z`;
}

/**
 * A frase que o balão escreve embaixo dos números.
 *
 * É o miolo desta Issue. "5 entradas, 3 entregas, fila 12" são três números
 * certos que não respondem à pergunta do título do painel — entrou mais ou saiu
 * mais? Quem lê tem de subtrair de cabeça, e a fila acumulada não ajuda, porque
 * ela mistura o saldo desta semana com o de todas as anteriores. A conta é de
 * uma linha e o app já tem os dois números na mão: escrevê-la é mais barato do
 * que esperar que cada pessoa a refaça toda vez.
 */
function leituraDaSemana(entrou: number, saiu: number): string {
  const saldo = entrou - saiu;
  if (!entrou && !saiu) return "Semana sem demanda nova e sem entrega.";
  if (saldo === 1) return "Entrou 1 a mais do que saiu — a fila subiu.";
  if (saldo > 1)
    return `Entraram ${saldo} a mais do que saíram — a fila subiu.`;
  if (saldo === -1) return "Saiu 1 a mais do que entrou — a fila desceu.";
  if (saldo < -1)
    return `Saíram ${-saldo} a mais do que entraram — a fila desceu.`;
  return "Entrou o mesmo tanto que saiu — a fila ficou onde estava.";
}

/**
 * Entradas × entregas por semana, e a fila acumulada logo abaixo.
 *
 * ERAM DOIS EIXOS Y NO MESMO DESENHO. As barras mediam pela escala da esquerda
 * e a linha da fila pela da direita, e onde as duas se cruzavam não havia
 * informação nenhuma: o alinhamento entre duas escalas independentes é
 * arbitrário — escolher outro teto para a direita move a linha inteira sem que
 * um único dado tenha mudado. O olho, porém, lê cruzamento como fato, e o
 * gráfico inventava correlação que ninguém pôs nele.
 *
 * Agora são dois desenhos empilhados, cada um com UM eixo, dividindo o eixo x.
 * Ficam no mesmo `<svg>` e não em dois elementos: o alinhamento das colunas
 * entre as faixas é o que faz a leitura vertical funcionar, e dois SVGs
 * separados ficariam alinhados só até alguém mexer no padding de um deles.
 *
 * A FILA CONTINUA SENDO LINHA, e não uma terceira barra. Ela é um estoque
 * medido no fim da semana, não uma quantidade que aconteceu naquela semana;
 * barra ao lado de barra convidaria a somá-la com as outras duas, que é o erro
 * de leitura mais caro que este painel pode induzir.
 *
 * AS CORES SAEM DE `--serie-*`, não mais de `--brand`/`--ok`. `--brand` é
 * trocado pelo acento escolhido: no tema azul, as barras de entrada ficavam
 * azuis contra a linha índigo da fila, a ΔE 11,5 em OKLab — abaixo do piso de
 * 15, ou seja, um par difícil de separar mesmo para quem enxerga cor
 * normalmente. A paleta categórica no topo desta folha existe por ter sido
 * validada exatamente para isso, e este painel era o único da tela que não a
 * usava.
 *
 * MOTION: nenhum, e isso é decisão, não esquecimento. Varrer o ponteiro pelo
 * gráfico troca a semana em foco dezenas de vezes por segundo — é o caso de
 * alta frequência do AGENTS.md §3, onde animar vira lentidão percebida. O balão
 * aparece e some na hora, e a faixa de destaque é UM retângulo que muda de `x`,
 * não um por semana acendendo e apagando (que deixaria rastro aceso atrás do
 * cursor). O único movimento da peça é a transição de cor dos botões do
 * alternador, nos mesmos 180ms do resto da tela.
 */
function FluxoSemanal({ fluxo }: { fluxo: Fluxo }) {
  const { semanas, entradas, entregas, fila } = fluxo;
  const [foco, setFoco] = useState<number | null>(null);
  const [modo, setModo] = useState<"grafico" | "numeros">("grafico");
  const n = semanas.length;
  const filaFinal = fila[n - 1] ?? 0;

  if (!entradas.some(Boolean) && !entregas.some(Boolean))
    return (
      <EmptyState
        size="compact"
        icon="trend"
        title="Sem movimento no período"
        description={
          filaFinal
            ? `Nenhuma demanda foi criada nem concluída nestas ${n} semanas — as ${filaFinal} que estão em aberto vêm de antes. Amplie o período no topo da tela para alcançar quando elas entraram.`
            : "As séries aparecem quando houver demanda criada ou concluída. Amplie o período no topo da tela para alcançar semanas anteriores."
        }
      />
    );

  const eixoBarras = escalaDoEixo(Math.max(...entradas, ...entregas));
  // Uma faixa só na fila: a tira tem 40px de altura, e três rótulos de 9,5px
  // empilhados nela encostam uns nos outros. Duas linhas — o zero e o teto —
  // são o que cabe, e são o que uma tira de tendência precisa declarar.
  const eixoFila = escalaDoEixo(Math.max(...fila), 1);

  const passo = (W - PL - PR) / n;
  const X = (i: number) => PL + i * passo + passo / 2;
  const Y = (v: number) => BASE - (v / eixoBarras.teto) * (BASE - TOPO);
  const Yf = (v: number) =>
    FILA_BASE - (v / eixoFila.teto) * (FILA_BASE - FILA_TOPO);
  // Espessura proporcional ao passo, com 2px de respiro entre as duas barras da
  // mesma semana: é esse vão que separa as séries sem precisar de contorno.
  const bw = Math.max(3, Math.min(passo * 0.3, (passo - 8) / 2));
  // Piso de 2,5px: sem ele, uma semana de uma demanda contra um teto de 40
  // desenha meio pixel e some — e some parecendo semana zerada, que é outra
  // coisa.
  const altura = (v: number) => (v > 0 ? Math.max(2.5, BASE - Y(v)) : 0);

  /**
   * De quantas em quantas semanas o eixo escreve um rótulo — contado a partir
   * do FIM.
   *
   * Do fim porque a última semana é a que interessa (é "esta semana"), e
   * contando do começo era justamente ela que ficava sem nome quando o período
   * não dividia redondo. 64 é a largura que o rótulo mais longo ("27 jul–2
   * ago") ocupa com folga.
   */
  const passoRotulo = Math.max(1, Math.ceil(64 / passo));

  const pontos = fila.map((v, i) => `${X(i).toFixed(1)} ${Yf(v).toFixed(1)}`);
  const linhaFila = `M${pontos.join("L")}`;
  const areaFila = `${linhaFila}L${X(n - 1).toFixed(1)} ${FILA_BASE}L${X(0).toFixed(1)} ${FILA_BASE}Z`;
  // Ponto em toda semana só enquanto der para mirar em cada um. Com 52 semanas
  // num gráfico de 1120, eles ficam a 20px de distância e viram um tracejado
  // grosso que esconde a própria linha.
  const pontoEmTudo = n <= 16;
  const yNum = Yf(filaFinal);

  const emFoco =
    foco === null
      ? null
      : {
          semana: semanas[foco],
          entradas: entradas[foco],
          entregas: entregas[foco],
          fila: fila[foco],
        };
  /**
   * O balão fica ao LADO da coluna, nunca em cima dela.
   *
   * Centrado no ponteiro, ele tapa exatamente as duas barras que a pessoa está
   * tentando ler. Abrindo para a direita na metade esquerda do gráfico e para a
   * esquerda na metade direita, ele tapa vizinhas — o que é inevitável — e
   * nunca a semana em foco.
   *
   * A âncora é a BORDA da coluna, e não o centro dela. Ancorado no centro com
   * `-100%`, a borda direita do balão cai no meio da própria coluna em foco e
   * tapa metade das duas barras — o defeito exato que este balão existe para
   * não ter. `passo / 2` é o que separa o centro da borda.
   */
  const abreADireita = foco === null || X(foco) <= W / 2;
  const ancora =
    foco === null ? W / 2 : X(foco) + (abreADireita ? passo / 2 : -passo / 2);
  const pct = (ancora / W) * 100;
  const desloc = abreADireita
    ? "translateX(10px)"
    : "translateX(calc(-100% - 10px))";

  const andar = (d: number) =>
    setFoco((f) => Math.max(0, Math.min(n - 1, f === null ? n - 1 : f + d)));

  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") andar(1);
    else if (e.key === "ArrowLeft") andar(-1);
    else if (e.key === "Home") setFoco(0);
    else if (e.key === "End") setFoco(n - 1);
    else if (e.key === "Escape") setFoco(null);
    else return;
    e.preventDefault();
  };

  return (
    <>
      <div className={styles.fluxoTopo}>
        {/* A frase existe porque a reclamação era exatamente esta. O eixo já
            nomeia o intervalo, mas dizer de segunda a domingo tira a última
            dúvida sobre onde uma semana começa. */}
        <p className={styles.fluxoDica}>
          Cada coluna é uma semana inteira, de segunda a domingo.
        </p>
        {/**
         * "Números" não é um extra: no tema claro, duas das três séries ficam
         * abaixo de 3:1 contra o fundo do painel (2,93 e 2,58 medidos). Cor com
         * esse contraste exige um caminho que não dependa de enxergá-la, e a
         * tabela é esse caminho — a mesma razão pela qual cada série carrega
         * nome escrito na legenda, e não só uma cor.
         */}
        <div className={styles.modos} role="group" aria-label="Como ver o fluxo">
          <button
            type="button"
            className={`${styles.modo} ${modo === "grafico" ? styles.modoAtivo : ""}`}
            aria-pressed={modo === "grafico"}
            onClick={() => setModo("grafico")}
          >
            Gráfico
          </button>
          <button
            type="button"
            className={`${styles.modo} ${modo === "numeros" ? styles.modoAtivo : ""}`}
            aria-pressed={modo === "numeros"}
            onClick={() => setModo("numeros")}
          >
            Números
          </button>
        </div>
      </div>

      {modo === "numeros" ? (
        <TabelaFluxo fluxo={fluxo} />
      ) : (
        <>
          {/**
           * O quadro inteiro é UM ponto de tabulação, não um por semana.
           *
           * 52 paradas de Tab para atravessar um gráfico é pior do que não ser
           * navegável: quem usa teclado ficaria preso aqui só para chegar ao
           * painel seguinte. As setas andam de semana em semana, e a região
           * `aria-live` logo abaixo lê o mesmo que o balão mostra — o requisito
           * é que foco e ponteiro entreguem a MESMA informação.
           */}
          <div
            className={styles.fluxoWrap}
            tabIndex={0}
            role="group"
            aria-label={`Fluxo das últimas ${n} semanas. Use as setas para percorrer as semanas.`}
            onKeyDown={teclado}
            onFocus={() => setFoco((f) => (f === null ? n - 1 : f))}
            onBlur={() => setFoco(null)}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className={styles.chart}
              role="img"
              aria-label="Entradas e entregas por semana, com a fila acumulada numa faixa abaixo"
              onPointerLeave={() => setFoco(null)}
            >
              {/* A faixa de destaque é um retângulo só, que muda de x. Uma por
                  semana deixaria rastro: cada uma levaria o próprio tempo para
                  apagar enquanto a seguinte já acendeu. */}
              {foco !== null && (
                <rect
                  className={styles.faixaFoco}
                  x={PL + foco * passo}
                  y={20}
                  width={passo}
                  height={FILA_BASE - 16}
                  rx={4}
                />
              )}

              <text x={PL} y={15} className={styles.eixoCap}>
                demandas na semana
              </text>
              {eixoBarras.ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={PL}
                    y1={Y(v)}
                    x2={W - PR}
                    y2={Y(v)}
                    className={v === 0 ? styles.gradeZero : styles.grade}
                  />
                  <text
                    x={PL - 8}
                    y={Y(v) + 3.4}
                    textAnchor="end"
                    className={styles.eixo}
                  >
                    {v}
                  </text>
                </g>
              ))}

              {semanas.map((s, i) => {
                const hEntrada = altura(entradas[i]);
                const hEntrega = altura(entregas[i]);
                return (
                  <g key={s.inicio.getTime()}>
                    {hEntrada > 0 && (
                      <path
                        className={styles.barEntrada}
                        d={barra(X(i) - bw - 1, BASE - hEntrada, bw, hEntrada)}
                      />
                    )}
                    {hEntrega > 0 && (
                      <path
                        className={styles.barEntrega}
                        d={barra(X(i) + 1, BASE - hEntrega, bw, hEntrega)}
                      />
                    )}
                  </g>
                );
              })}

              <text x={PL} y={181} className={styles.eixoCap}>
                fila acumulada — o que ficou em aberto ao fim de cada semana
              </text>
              {eixoFila.ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={PL}
                    y1={Yf(v)}
                    x2={W - PR}
                    y2={Yf(v)}
                    className={v === 0 ? styles.gradeZero : styles.grade}
                  />
                  <text
                    x={PL - 8}
                    y={Yf(v) + 3.4}
                    textAnchor="end"
                    className={styles.eixo}
                  >
                    {v}
                  </text>
                </g>
              ))}
              {/* A área embaixo da linha não é enfeite: numa tira de 40px, um
                  traço de 2px sozinho quase some, e é o preenchimento que faz a
                  subida e a descida ficarem legíveis de relance. */}
              <path d={areaFila} className={styles.filaArea} />
              <path d={linhaFila} className={styles.filaLinha} />
              {fila.map((v, i) =>
                pontoEmTudo || i === foco || i === n - 1 ? (
                  <circle
                    key={i}
                    cx={X(i)}
                    cy={Yf(v)}
                    r={i === foco ? 4 : 2.8}
                    className={styles.filaPonto}
                  />
                ) : null,
              )}
              {/* Rótulo direto só na ponta: é o número que o painel promete no
                  chip do cabeçalho, e o único que precisa estar legível sem que
                  ninguém passe o mouse. */}
              <text
                x={X(n - 1)}
                y={yNum < FILA_TOPO + 14 ? yNum + 15 : yNum - 9}
                textAnchor="end"
                className={styles.filaNum}
              >
                {filaFinal}
              </text>

              {semanas.map((s, i) =>
                (n - 1 - i) % passoRotulo === 0 ? (
                  <text
                    key={s.inicio.getTime()}
                    x={X(i)}
                    y={250}
                    textAnchor="middle"
                    className={i === foco ? styles.eixoAtivo : styles.eixo}
                  >
                    {s.rotulo}
                  </text>
                ) : null,
              )}

              {/* Os alvos por último, para ficarem POR CIMA de tudo: a coluna
                  inteira é o alvo, e não a barra de 6px — mirar em barra de
                  semana magra é o que fazia o balão do sistema mal aparecer. */}
              {semanas.map((s, i) => (
                <rect
                  key={s.inicio.getTime()}
                  className={styles.alvoSemana}
                  x={PL + i * passo}
                  y={18}
                  width={passo}
                  height={FILA_BASE + 4}
                  onPointerEnter={() => setFoco(i)}
                  onPointerDown={() => setFoco(i)}
                />
              ))}
            </svg>

            {emFoco && (
              <div
                className={styles.balao}
                style={{ left: `${pct}%`, transform: desloc }}
                aria-hidden="true"
              >
                <p className={styles.balaoTitulo}>
                  Semana de {emFoco.semana.porExtenso}
                </p>
                {/* Número primeiro, nome depois: aqui quem lê já sabe de qual
                    série se trata e quer o valor — é a hierarquia da legenda ao
                    contrário, de propósito. */}
                <ul className={styles.balaoLista}>
                  <li>
                    <i className={styles.kEntrada} />
                    <b>{emFoco.entradas}</b>
                    <span>entraram</span>
                  </li>
                  <li>
                    <i className={styles.kEntrega} />
                    <b>{emFoco.entregas}</b>
                    <span>saíram entregues</span>
                  </li>
                  <li>
                    <i className={styles.kFila} />
                    <b>{emFoco.fila}</b>
                    <span>ficaram na fila</span>
                  </li>
                </ul>
                <p className={styles.balaoLeitura}>
                  {leituraDaSemana(emFoco.entradas, emFoco.entregas)}
                </p>
              </div>
            )}
          </div>

          <p className={styles.srOnly} aria-live="polite">
            {emFoco
              ? `Semana de ${emFoco.semana.porExtenso}: ${emFoco.entradas} entraram, ${emFoco.entregas} saíram entregues, ${emFoco.fila} ficaram na fila. ${leituraDaSemana(emFoco.entradas, emFoco.entregas)}`
              : ""}
          </p>

          <div className={styles.legenda}>
            <span>
              <i className={styles.swEntrada} />
              Entradas — demanda criada na semana
            </span>
            <span>
              <i className={styles.swEntrega} />
              Entregas — demanda que chegou na etapa de entrega
            </span>
            <span>
              <i className={styles.swFila} />
              Fila acumulada — o que sobrou em aberto
            </span>
          </div>
        </>
      )}
    </>
  );
}

/**
 * As mesmas séries em tabela, para quem quer o número e não a forma.
 *
 * Nasce no mesmo PR do gráfico porque é dele que ela é o par obrigatório, e não
 * um componente à espera de consumidor: no tema claro, duas séries ficam abaixo
 * de 3:1 contra o fundo, e cor nesse contraste exige um caminho que não dependa
 * de enxergá-la. Serve também a quem só quer conferir uma conta — o balão
 * mostra uma semana por vez, e comparar duas pelo ponteiro é impossível.
 *
 * A ORDEM É A DO GRÁFICO, da semana mais velha para a mais nova. Inverter para
 * "a mais recente primeiro" seria mais cômodo de ler sozinho e péssimo ao lado
 * do desenho: o alternador troca um pelo outro no mesmo lugar da tela, e a
 * primeira linha da tabela tem de ser a primeira coluna do gráfico.
 */
function TabelaFluxo({ fluxo }: { fluxo: Fluxo }) {
  const { semanas, entradas, entregas, fila } = fluxo;
  const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const totEntradas = soma(entradas);
  const totEntregas = soma(entregas);

  const saldoTxt = (v: number) => (v > 0 ? `+${v}` : String(v));
  const saldoCls = (v: number) =>
    v > 0 ? styles.saldoSobe : v < 0 ? styles.saldoDesce : styles.saldoZero;

  return (
    <div className={styles.tabelaFluxoWrap}>
      <table className={styles.tabela}>
        <caption className={styles.srOnly}>
          Entradas, entregas, saldo e fila acumulada, semana a semana
        </caption>
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col" className={styles.num}>
              Entraram
            </th>
            <th scope="col" className={styles.num}>
              Saíram
            </th>
            <th scope="col" className={styles.num}>
              Saldo
            </th>
            <th scope="col" className={styles.num}>
              Fila no fim
            </th>
          </tr>
        </thead>
        <tbody>
          {semanas.map((s, i) => {
            const saldo = entradas[i] - entregas[i];
            return (
              <tr key={s.inicio.getTime()}>
                <th scope="row" className={styles.tabelaSemana}>
                  {s.porExtenso}
                </th>
                <td className={styles.num}>{entradas[i]}</td>
                <td className={styles.num}>{entregas[i]}</td>
                <td className={`${styles.num} ${saldoCls(saldo)}`}>
                  {saldoTxt(saldo)}
                </td>
                <td className={styles.num}>{fila[i]}</td>
              </tr>
            );
          })}
        </tbody>
        {/**
         * O rodapé soma entradas e entregas, e NÃO soma a fila.
         *
         * Somar a coluna da fila daria um número grande e sem sentido nenhum:
         * ela é um estoque medido toda semana, então a soma contaria a mesma
         * demanda tantas vezes quantas semanas ela passou em aberto. O que a
         * última célula mostra é o valor final, que é o que a palavra "fila"
         * quer dizer — e é o mesmo número do chip no cabeçalho do painel.
         */}
        <tfoot>
          <tr>
            <th scope="row">No período todo</th>
            <td className={styles.num}>{totEntradas}</td>
            <td className={styles.num}>{totEntregas}</td>
            <td
              className={`${styles.num} ${saldoCls(totEntradas - totEntregas)}`}
            >
              {saldoTxt(totEntradas - totEntregas)}
            </td>
            <td className={styles.num}>{fila[fila.length - 1] ?? 0}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Rótulo do card cuja coluna não existe mais no quadro do setor dele. */
const SEM_ETAPA = "Fora do quadro";

/**
 * O cinza da etapa órfã é FIXO, e não `var(--tx-3)` como nos "sem X" vizinhos.
 *
 * A quantidade passou a ser escrita dentro da faixa, e a cor desse número sai
 * da luminância da cor da faixa (`corDoNumero`). Uma `var()` não tem luminância
 * até o navegador resolvê-la, e resolvê-la aqui custaria um `getComputedStyle`
 * por faixa desenhada. Este é o valor que `--tx-3` já tem no tema escuro, e é
 * um cinza médio que se lê nos quatro temas — é a única cor desta tela que não
 * acompanha o tema, e é por isso que não acompanha.
 */
const COR_SEM_ETAPA = "#78776f";

/**
 * Tinta clara ou escura sobre a faixa, decidida pela luminância dela.
 *
 * A cor da etapa é a da coluna do Kanban, e quem escolhe é o setor: pode ser
 * qualquer uma. Uma cor de texto fixa apagaria o número em metade das faixas —
 * as cinco colunas padrão são todas claras e pedem tinta escura, mas nada
 * impede um setor de pintar a dele de azul-marinho.
 *
 * Contorno de texto (`text-shadow` escuro sob tinta branca) foi o descartado:
 * resolve sem calcular nada, mas em 10px negrito o halo engorda o glifo e o
 * número sai sujo justamente onde ele é pequeno.
 *
 * A luminância é a Rec. 601, não a relativa da WCAG. Para escolher entre os
 * dois extremos o degrau cai no mesmo lugar, e esta custa três multiplicações
 * em vez de três potências por faixa.
 */
function corDoNumero(cor: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(cor.trim());
  if (!m) return "#fff";
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const v = parseInt(hex, 16);
  const lum =
    (0.299 * ((v >> 16) & 255) +
      0.587 * ((v >> 8) & 255) +
      0.114 * (v & 255)) /
    255;
  return lum > 0.6 ? "#151517" : "#fff";
}

/**
 * Fração do trilho abaixo da qual o número não cabe DENTRO da faixa.
 *
 * A faixa ocupa exatamente `s.n / max` do trilho — a pilha vale `total / max`
 * dele, e a faixa vale `s.n / total` da pilha. O trilho mais estreito que esta
 * tela produz no desktop tem uns 300px (janela de 1024px, descontados o nome, o
 * total e os respiros), e 10% disso são 30px: cabem três dígitos em 10px
 * negrito com folga. O painel passou à largura inteira (Issue #83) e o trilho
 * só ficou mais folgado — o limiar continua valendo pelo pior caso, que é a
 * janela estreita, e não pela grade que deixou de existir.
 *
 * Abaixo do limiar o número não aparece — nunca aparece cortado pela metade. E
 * esconder aqui não tira informação da tela: a linha de etapas embaixo da barra
 * repete TODOS os números, um a um, com o nome da etapa junto.
 */
const LIMIAR_NUMERO = 0.1;

type Segmento = { etapa: string; cor: string; n: number };
type LinhaOrigem = {
  chave: string;
  label: string;
  total: number;
  segs: Segmento[];
};

/**
 * De onde vem a demanda, e em que etapa do quadro ela está.
 *
 * Uma barra por setor solicitante, do que mais pede para o que menos pede; o
 * comprimento é a contagem, e cada faixa é uma etapa, com a cor que a própria
 * coluna do Kanban já tem. Substituiu o cycle time mediano por tipo: aquele
 * painel respondia "qual tipo demora mais", que é a mesma família de pergunta
 * do p85 no KPI logo acima, enquanto ninguém sabia responder de cabeça QUEM
 * ESTÁ PEDINDO — que é a conversa que se tem com o setor vizinho.
 *
 * DEMANDA ENTREGUE CONTA AQUI, e é a única exceção da tela.
 *
 * O painel irmão ("Consumo por responsável") recebe `abertos` porque mede carga
 * de trabalho, e trabalho terminado não pesa em ninguém. Este mede VOLUME DE
 * PEDIDO, que é outra coisa: quem pediu, pediu — a entrega não apaga o pedido.
 * E a forma obriga: empilhar por etapa sem as entregues faria a última faixa
 * sumir de todas as barras, e o total de cada setor passaria a ser um número
 * menor do que ele de fato pediu, sem nada na tela dizendo isso. Um painel de
 * origem que esconde o fim do funil não é conservador, é errado.
 *
 * A CONSEQUÊNCIA DISSO É UM NÚMERO QUE NÃO FECHA COM O TOPO DA TELA, de
 * propósito: a soma das barras daqui é maior que as "N demandas em aberto" da
 * barra de filtros, porque lá as entregues saem e aqui ficam. O chip do painel
 * publica esse total justamente para quem for conferir a conta encontrar a
 * diferença explicada em vez de achar o painel quebrado. Isto era uma frase de
 * quatro linhas no rodapé do painel e saiu da tela (Issue #78): é uma decisão
 * de projeto, que se lê uma vez, e não um aviso, que se lê sempre.
 *
 * DEMANDA NA LIXEIRA NÃO CONTA, e não há nada a fazer por isso aqui:
 * `subscribeCardsForSectors` (lib/kanban) filtra os excluídos NA ORIGEM, antes
 * de qualquer tela ver o snapshot. Refiltrar seria criar uma segunda verdade
 * sobre o mesmo assunto — conferido, não reimplementado.
 *
 * O PERÍODO DO TOPO NÃO RECORTA ESTE PAINEL, como não recorta a rosca nem o
 * consumo por responsável: ele é a janela das SÉRIES semanais, e aqui a
 * pergunta é sobre o quadro como ele está agora. Quem trocar o período e vir
 * este painel parado não encontrou um bug — encontrou o recorte funcionando
 * onde ele se aplica. Também isso vinha escrito no rodapé e saiu com ele: três
 * painéis desta tela ignoram o período, e explicar num só sugeria que os outros
 * dois obedeciam.
 */
function OrigemPorEtapa({
  cards,
  colsPorSetor,
}: {
  cards: Card[];
  colsPorSetor: Record<string, KanbanColumn[]>;
}) {
  /**
   * Catálogo de etapas por TÍTULO — a cor e a posição no quadro.
   *
   * Por título, e não por `colId`: o recorte "todos os setores" cruza vários
   * quadros, e as colunas que um setor criou à mão têm id `col_<timestamp>`,
   * único por setor. Agrupar por id partiria "Em andamento" em tantas faixas
   * quantos são os quadros — e para quem lê, duas etapas com o mesmo nome são a
   * mesma etapa.
   *
   * Quando dois quadros pintam a mesma etapa de cores diferentes, decide o
   * setor que vem primeiro no alfabeto. Precisa ser uma regra qualquer, mas
   * FIXA: sem ordenar, a cor viria de qual snapshot chegou primeiro e a legenda
   * se repintaria sozinha entre um render e outro.
   */
  const etapas = useMemo(() => {
    const m = new Map<string, { cor: string; ordem: number }>();
    Object.keys(colsPorSetor)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .forEach((s) =>
        colsPorSetor[s].forEach((c, i) => {
          const ja = m.get(c.title);
          if (!ja) m.set(c.title, { cor: c.color, ordem: i });
          else if (i < ja.ordem) ja.ordem = i;
        }),
      );
    // Coluna apagada depois de o card entrar nela: fica fora da paleta e no fim
    // da fila, como "Sem tipo" na rosca.
    m.set(SEM_ETAPA, { cor: COR_SEM_ETAPA, ordem: 99 });
    return m;
  }, [colsPorSetor]);

  const { linhas, etapasUsadas, comOrigem } = useMemo(() => {
    const por = new Map<string, Map<string, number>>();
    const usadas = new Set<string>();
    cards.forEach((c) => {
      const origem = c.requesterSector?.trim() || SEM_ORIGEM;
      const col = (colsPorSetor[c.sector] ?? []).find(
        (x) => x.id === c.columnId,
      );
      const etapa = col?.title ?? SEM_ETAPA;
      usadas.add(etapa);
      const m = por.get(origem) ?? new Map<string, number>();
      m.set(etapa, (m.get(etapa) ?? 0) + 1);
      por.set(origem, m);
    });

    const ordemDa = (t: string) => etapas.get(t)?.ordem ?? 99;
    const monta = (
      chave: string,
      label: string,
      m: Map<string, number>,
    ): LinhaOrigem => ({
      chave,
      label,
      total: [...m.values()].reduce((a, b) => a + b, 0),
      // Etapa com zero simplesmente não está no mapa, então não vira faixa
      // nenhuma. Se virasse, o `min-width` de 3px do segmento a desenharia —
      // uma cor na barra afirmando que há demanda ali onde não há.
      segs: [...m.entries()]
        .sort(
          (a, b) =>
            ordemDa(a[0]) - ordemDa(b[0]) || a[0].localeCompare(b[0], "pt-BR"),
        )
        .map(([etapa, n]) => ({
          etapa,
          cor: etapas.get(etapa)?.cor ?? COR_SEM_ETAPA,
          n,
        })),
    });

    /**
     * TODO SETOR QUE PEDIU VIRA UMA BARRA, com o próprio nome.
     *
     * Havia um teto de oito barras aqui, e a cauda virava uma barra "Outros (N
     * setores)" com os nomes escondidos num `title`. O argumento era de
     * comparação — da nona linha em diante os comprimentos já não se distinguem
     * — e ele custava caro demais: o painel existe para responder QUEM ESTÁ
     * PEDINDO, e a resposta para cinco dos treze setores cadastrados era um
     * rótulo anônimo que só se abria pousando o ponteiro em cima. Quem pede
     * pouco é exatamente o setor sobre o qual ninguém sabe de cabeça.
     *
     * O que pagava o teto era altura de painel, e o painel passou a ocupar a
     * largura inteira (Issue #83): a linha de etapas de cada barra, que em meia
     * largura quebrava em duas ou três, agora cabe numa só. Treze barras aqui
     * custam menos altura do que nove custavam antes.
     */
    const linhas = [...por.entries()]
      .filter(([o]) => o !== SEM_ORIGEM)
      .map(([o, m]) => monta(o, o, m))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "pt-BR"));

    const comOrigem = linhas.length;

    // "Sem setor solicitante" fecha a lista, como "Sem tipo" fecha a rosca:
    // campo em branco não é um setor pequeno, é uma resposta de outra natureza,
    // e ordená-lo pelo total o esconderia no meio dos setores de verdade.
    const sem = por.get(SEM_ORIGEM);
    if (sem) linhas.push(monta(SEM_ORIGEM, SEM_ORIGEM, sem));

    return {
      linhas,
      etapasUsadas: [...usadas].sort(
        (a, b) => ordemDa(a) - ordemDa(b) || a.localeCompare(b, "pt-BR"),
      ),
      comOrigem,
    };
  }, [cards, colsPorSetor, etapas]);

  if (!cards.length)
    return (
      <EmptyState
        size="compact"
        icon="kanban"
        title="Nenhuma demanda neste recorte"
        description="Cada setor que pedir vira uma barra aqui, dividida pelas etapas do quadro."
      />
    );
  // Não é o mesmo vazio de cima, e dizer "nenhuma demanda" aqui seria falso:
  // há demanda, o que não há é de onde ela veio. E a saída é diferente —
  // preencher o campo no card, não esperar chegar demanda.
  if (!comOrigem)
    return (
      <EmptyState
        size="compact"
        icon="info"
        title="Nenhuma demanda tem setor solicitante"
        description={
          <>
            {cards.length === 1
              ? "A única demanda do recorte está"
              : `As ${cards.length} demandas do recorte estão`}{" "}
            com esse campo em branco. Preencha o setor solicitante no card para
            este painel comparar as origens.
          </>
        }
      />
    );

  const max = Math.max(1, ...linhas.map((l) => l.total));

  return (
    <>
      <div className={styles.barras}>
        {linhas.map((l) => (
          <div key={l.chave} className={styles.barraBloco}>
            <div className={styles.barraLinha}>
              <div className={styles.barraNome} title={l.label}>
                {l.label}
              </div>
              <div className={styles.barraTrilho}>
                {/* A pilha inteira é UM elemento, e é ela que mede: são as
                    faixas juntas que formam o comprimento que se lê. */}
                <div
                  className={styles.pilha}
                  style={{ width: `${(l.total / max) * 100}%` }}
                >
                  {l.segs.map((s) => (
                    <div
                      key={s.etapa}
                      role="img"
                      aria-label={`${s.etapa}: ${s.n}`}
                      className={styles.pilhaSeg}
                      style={{
                        width: `${(s.n / l.total) * 100}%`,
                        background: s.cor,
                      }}
                      title={`${s.etapa} · ${s.n}`}
                    >
                      {/* O número não precisa de `aria-hidden`: `role="img"` já
                          troca o conteúdo do elemento pelo `aria-label` acima,
                          e é ele que o leitor de tela anuncia. */}
                      {s.n / max >= LIMIAR_NUMERO && (
                        <span
                          className={styles.pilhaNum}
                          style={{ color: corDoNumero(s.cor) }}
                        >
                          {s.n}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.origemNum}>{l.total}</div>
            </div>
            {/* As mesmas etapas em texto, para quem não distingue as cores ler a
                divisão sem passar o mouse em faixa nenhuma — e para trazer o
                número das faixas estreitas demais para o comportarem dentro.
                `aria-hidden` porque cada faixa acima já se anuncia com o mesmo
                par nome + número: visível é complemento, falado seria eco. */}
            <div className={styles.origemEtapas} aria-hidden="true">
              {l.segs.map((s) => (
                <span key={s.etapa} className={styles.origem}>
                  <i style={{ background: s.cor }} />
                  {s.etapa}
                  <b>{s.n}</b>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {etapasUsadas.length > 1 && (
        <div className={styles.legenda}>
          {etapasUsadas.map((e) => (
            <span key={e}>
              <i style={{ background: etapas.get(e)?.cor ?? "var(--tx-3)" }} />
              {e}
            </span>
          ))}
        </div>
      )}
    </>
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
      <EmptyState
        size="compact"
        icon="calendar"
        title="Nenhum prazo à vista"
        description="Nada vencido, e nada vencendo nos próximos 14 dias, neste recorte."
      />
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
