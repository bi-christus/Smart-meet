"use client";

import { useMemo, useState, type ReactNode } from "react";
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
} from "@/lib/datas";
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
type Fluxo = {
  semanas: { inicio: Date; rotulo: string }[];
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
      <EmptyState
        size="compact"
        icon="trend"
        title="Sem movimento no período"
        description="As séries aparecem quando houver demanda criada ou concluída. Amplie o período no topo da tela para alcançar semanas anteriores."
      />
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
