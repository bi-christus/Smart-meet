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
          largo
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
         * O esqueleto deste painel é o de LINHAS, o mesmo de "consumo por
         * responsável", e não mais o de barras em pé: os dois painéis passaram
         * a ter a mesma forma, e esqueleto que promete outra troca a espera por
         * um solavanco quando o conteúdo chega.
         */}
        <Painel
          titulo="Cycle time e previsibilidade"
          chip={
            fluxo.amostra >= MIN_AMOSTRA
              ? `p50 ${fluxo.p50}d · p85 ${fluxo.p85}d`
              : undefined
          }
          fontes={[fCards, fCols]}
          esqueleto={
            <SkeletonRow rows={4} texto="Carregando o cycle time por tipo…" />
          }
        >
          <CycleTime fluxo={fluxo} />
        </Painel>

        <Painel
          largo
          titulo="Demanda que entra × demanda que sai"
          chip={`fila ${fluxo.fila[fluxo.fila.length - 1] ?? 0}`}
          fontes={[fCards, fCols]}
          esqueleto={<SkeletonChart bars={10} texto="Carregando as séries semanais…" />}
        >
          <FluxoSemanal fluxo={fluxo} />
        </Painel>

        <Painel
          largo
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
 * Uma conclusão do período: quantos dias levou, e de que tipo era.
 *
 * O timestamp da conclusão saiu daqui junto com a nuvem de pontos que o lia —
 * ver `CycleTime`. Guardar por card um campo que ninguém mais consulta é peso
 * num `useMemo` que percorre o quadro inteiro a cada troca de filtro.
 */
type Conclusao = { dias: number; tipo: DemandType | null };

type Fluxo = {
  semanas: { inicio: Date; rotulo: string }[];
  entradas: number[];
  entregas: number[];
  fila: number[];
  pontos: Conclusao[];
  p50: number;
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
  const pontos: Conclusao[] = [];
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
            dias: Math.max(0, Math.round((entregue - nasceu) / 86400000)),
            // Mesma desconfiança do gráfico de rosca: `type` vem do documento e
            // um valor que saiu da lista (renomeado, importado torto) viraria um
            // rótulo `undefined` na tela. Fora da lista é "sem tipo".
            tipo: c.type && DEMAND_TYPES.includes(c.type) ? c.type : null,
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
    pontos,
    p50: percentil(ordenado, 0.5),
    p85: percentil(ordenado, 0.85),
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

/** Uma assinatura vista pelo painel: o estado dela, e como reabri-la. */
type Assinatura = Fonte & { tentarDeNovo: () => void };

/**
 * Um painel do Dashboard, com o próprio estado de carregamento.
 *
 * A moldura e o título ficam SEMPRE na tela — é o que segura a forma da grade
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
  largo,
  fontes,
  esqueleto,
  children,
}: {
  titulo: string;
  chip?: string;
  chipTom?: "danger";
  largo?: boolean;
  fontes: Assinatura[];
  esqueleto: ReactNode;
  children: ReactNode;
}) {
  const { erro, carregando } = juntarFontes(fontes);
  return (
    <section
      className={`${styles.painel} ${largo ? styles.painelLargo : ""}`}
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

/**
 * Cycle time mediano por tipo de demanda — uma barra deitada por tipo.
 *
 * Era uma nuvem de pontos: um ponto por conclusão, x = quando saiu, y = quantos
 * dias levou, com três tracejados de percentil por cima. Mostrava a dispersão
 * inteira, e cobrava por isso o preço de ler densidade de pontos — enquanto a
 * pergunta que se faz neste painel é mais simples e a nuvem não respondia:
 * QUAL TIPO DE DEMANDA DEMORA MAIS. É a resposta que muda o que se promete ao
 * setor solicitante quando ele pede uma implementação em vez de uma correção.
 *
 * BARRA DEITADA, E NÃO EM PÉ: o rótulo de cada linha é texto de tamanho real
 * ("Nova implementação", "Manutenção"). Deitado ele cabe inteiro à esquerda; em
 * pé teria de girar 90° ou ser truncado, e rótulo girado é o jeito mais barato
 * de tornar um gráfico ilegível. A forma também é a mesma de "consumo por
 * responsável", que fica duas posições acima na mesma tela — dois gráficos de
 * comparação entre categorias não deveriam exigir dois modos de leitura.
 *
 * MEDIANA, E NÃO MÉDIA: um tipo com quatro conclusões de 3 dias e uma de 90 tem
 * média 20 — número que não descreve nenhuma das cinco entregas. A metade sai
 * em 3, e é isso que se pode prometer.
 *
 * O NÚMERO DE CONCLUSÕES VAI EM TEXTO, EM TODA LINHA. `MIN_AMOSTRA` segura o
 * painel inteiro, mas dentro dele um tipo pode ter uma conclusão só — e a barra
 * dele sai com a mesma autoridade visual das outras. "1 conclusão" ao lado é o
 * que impede a linha de parecer apurada.
 *
 * DESCARTADA a linha de referência do p85 do período cruzando as barras: o p85
 * do conjunto é, por construção, maior que quase toda mediana de subgrupo, e a
 * marca ficaria colada na borda direita em praticamente todo recorte — uma
 * régua que nunca se move não é régua. A previsibilidade continua no chip do
 * cabeçalho, onde é do período inteiro e sobre a amostra que `MIN_AMOSTRA`
 * aprovou.
 */
function CycleTime({ fluxo }: { fluxo: Fluxo }) {
  const { pontos, amostra } = fluxo;

  const linhas = useMemo(() => {
    const por: Record<string, number[]> = {};
    pontos.forEach((p) => {
      const t = p.tipo ?? "__sem__";
      (por[t] = por[t] ?? []).push(p.dias);
    });
    return Object.entries(por)
      .map(([chave, dias]) => ({
        chave,
        label:
          chave === "__sem__"
            ? "Sem tipo"
            : DEMAND_TYPE_LABEL[chave as DemandType],
        // Cor do tipo, a MESMA do Kanban e da rosca acima — tipo tem uma cor só
        // no app inteiro. "Sem tipo" fica fora da paleta, como na rosca.
        cor:
          chave === "__sem__"
            ? "var(--tx-3)"
            : DEMAND_TYPE_COLOR[chave as DemandType],
        mediana: percentil(
          [...dias].sort((a, b) => a - b),
          0.5,
        ),
        n: dias.length,
      }))
      .sort(
        (a, b) =>
          b.mediana - a.mediana || a.label.localeCompare(b.label, "pt-BR"),
      );
  }, [pontos]);

  if (amostra === 0)
    return (
      <EmptyState
        size="compact"
        icon="clock"
        title="Nenhuma demanda concluída no período"
        description="Sem conclusão não há cycle time. Amplie o período no topo da tela para alcançar semanas anteriores."
      />
    );
  if (amostra < MIN_AMOSTRA)
    return (
      <EmptyState
        size="compact"
        icon="clock"
        title="Amostra pequena demais"
        description={
          <>
            Só {amostra} conclusão(ões) no período. Mediana com amostra assim
            vira chute — as barras aparecem a partir de {MIN_AMOSTRA}.
          </>
        }
      />
    );

  // O 1 é guarda de divisão, não piso de escala: um recorte em que todo tipo
  // fecha no mesmo dia tem mediana 0 em todas as linhas.
  const max = Math.max(1, ...linhas.map((l) => l.mediana));

  return (
    <>
      <div className={styles.barras}>
        {linhas.map((l) => (
          <div key={l.chave} className={styles.barraLinha}>
            <div className={styles.barraNome} title={l.label}>
              {l.label}
            </div>
            <div className={styles.barraTrilho}>
              {/* A barra é o desenho do número que já está escrito na linha ao
                  lado — para quem usa leitor de tela ela é repetição, e para
                  quem não distingue as cores o rótulo e o valor em texto já
                  respondem tudo. */}
              <div
                aria-hidden="true"
                className={styles.cycleFill}
                style={{
                  width: `${(l.mediana / max) * 100}%`,
                  background: l.cor,
                }}
              />
            </div>
            <div className={styles.cycleDias}>{l.mediana}d</div>
            <div className={styles.cycleN}>
              {l.n} {l.n === 1 ? "conclusão" : "conclusões"}
            </div>
          </div>
        ))}
      </div>
      <p className={styles.cycleNota}>
        Mediana de dias entre a criação e a conclusão: metade das demandas de
        cada tipo sai nesse prazo ou menos. O p50 e o p85 do cabeçalho são do
        período inteiro, sem separar por tipo.
      </p>
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
