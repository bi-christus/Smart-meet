"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { subscribeUsers, type UserProfile } from "@/lib/users";
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
import { daysBetween, fmtDayMonth, hh, startOfDay } from "@/lib/datas";
import {
  PASSO_LABEL,
  PASSO_PLURAL,
  PASSO_UM,
  PERIODOS,
  PERIODO_LABEL,
  ativaNaJanela,
  calcularFluxo,
  isoDe,
  janelaDePassos,
  janelaDeSemanas,
  limitesDaJanela,
  type Fluxo,
  type Granularidade,
  type Janela,
  type Periodo,
} from "@/lib/fluxo-core";
import { juntarFontes, type Fonte } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonChart, SkeletonRow } from "@/components/skeleton";
import styles from "./dashboard.module.css";

/**
 * Dashboard — como UM QUADRO está entregando, não quem trabalha mais.
 *
 * UM QUADRO POR VEZ, e não a soma de todos. A tela nasceu somando os setores
 * visíveis e oferecendo um filtro para separá-los, e o número de cima era
 * sempre a mistura: quem participa de três setores abria o Dashboard e lia uma
 * fila que não é de ninguém — nem de quem toca o B.I., nem de quem toca a
 * Infra. Cada quadro tem colunas próprias, ritmo próprio e prazo próprio; a
 * média deles não descreve nenhum. Agora o quadro é escolhido na primeira
 * linha da tela, como no Kanban, e todo painel abaixo fala dele.
 *
 * E UM RECORTE DE TEMPO SÓ, no topo, valendo para a tela inteira. O seletor
 * vivia dentro do painel de fluxo porque só ele lia período; os outros quatro
 * falavam do estado de hoje. Isso deixava a tela respondendo a dois recortes ao
 * mesmo tempo, sem dizer — e a pessoa que restringia o gráfico a julho lia, dez
 * centímetros abaixo, uma tabela de prazos do ano inteiro. Quem decide quais
 * demandas o recorte alcança é `ativaNaJanela`, e o critério está escrito lá:
 * demanda velha e ainda aberta CONTINUA no recorte, porque é justamente ela que
 * se procura numa tela de prazos.
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

/** Mínimo de conclusões para publicar percentil. Abaixo disso é chute. */
const MIN_AMOSTRA = 5;

/**
 * A janela com que a tela abre. Doze semanas — um trimestre.
 *
 * Ela deixou de ser exclusiva do painel de fluxo: agora é o recorte da tela
 * inteira, e por isso o rodapé de cada KPI escreve qual janela está valendo.
 * Indicador com janela implícita é o tipo de número que alguém leva para uma
 * reunião achando que fala de outro período.
 */
const PERIODO_PADRAO: Periodo = 12;

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

  const sectors = useSetoresDaPessoa(profile);

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

  /**
   * O quadro escolhido. Vazio = "ainda não escolhi", e vira o primeiro setor.
   *
   * Guardado como NOME e derivado na leitura, do mesmo jeito que `fPessoaAtivo`
   * logo abaixo: a lista de setores chega depois do primeiro render (o admin
   * assina o cadastro), e um `useEffect` que corrigisse o estado depois faria a
   * tela desenhar um quadro por um quadro antes de trocar.
   */
  const [quadroSel, setQuadroSel] = useState("");
  const [fPessoa, setFPessoa] = useState("");
  const [fResp, setFResp] = useState("");
  /** Cada coluna do gráfico de acúmulo é um dia ou uma semana. */
  const [gran, setGran] = useState<Granularidade>("semana");

  /**
   * A janela das séries: uma das opções ancoradas em hoje, ou datas escolhidas.
   *
   * São três estados e não um só porque o intervalo tem de SOBREVIVER à ida e
   * volta ao "Últimas 12 semanas". Guardar só a janela ativa apagaria as datas
   * digitadas a cada espiada no período padrão, e quem estava comparando dois
   * recortes teria de digitá-las de novo — o mesmo motivo pelo qual `periodo`
   * também fica guardado enquanto o modo é "intervalo".
   */
  const [modoJanela, setModoJanela] = useState<"recentes" | "intervalo">(
    "recentes",
  );
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_PADRAO);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

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

  /**
   * O quadro que está na tela — um só, sempre.
   *
   * Setor guardado que sumiu da lista (o admin tirou a pessoa dele, ou apagou o
   * cadastro) volta para o primeiro, em vez de deixar a tela em branco
   * afirmando que não há demanda nenhuma.
   */
  const quadro = sectors.includes(quadroSel) ? quadroSel : (sectors[0] ?? "");
  const noRecorte = useMemo(() => (quadro ? [quadro] : []), [quadro]);

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

  /**
   * Cards do quadro (mais pessoa e responsável), SEM recorte de tempo.
   *
   * É este conjunto — e não o recortado — que alimenta as séries. `calcularFluxo`
   * precisa enxergar o que nasceu ANTES da janela para saber o tamanho da fila
   * que já existia quando ela abriu (`filaInicial`); entregar-lhe a lista já
   * recortada faria toda janela começar com fila zero, e a linha de acúmulo
   * passaria a subir do chão em qualquer período escolhido.
   */
  const doQuadro = useMemo(
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

  // ---- séries de fluxo, e o recorte de tempo que sai delas ------------------
  /**
   * O intervalo só entra em vigor com as DUAS pontas preenchidas.
   *
   * Enquanto só uma existe, a janela continua sendo a de período — e não uma
   * janela vazia. Trocar para "Personalizado" apaga o gráfico até a segunda data
   * ser digitada, e painel que some no meio de um gesto lê como quebrado, não
   * como espera.
   */
  const intervaloPronto = modoJanela === "intervalo" && !!de && !!ate;
  const janela = useMemo<Janela>(
    () =>
      intervaloPronto
        ? { modo: "intervalo", de, ate }
        : { modo: "recentes", semanas: periodo },
    [intervaloPronto, de, ate, periodo],
  );
  const fluxo = useMemo(
    () => calcularFluxo(doQuadro, concluido, hoje, janela, gran),
    [doQuadro, concluido, hoje, janela, gran],
  );

  /**
   * O MESMO recorte de tempo, agora em forma de lista de demandas.
   *
   * Sai dos passos que o gráfico desenhou, e não de uma segunda conta de datas:
   * duas contas para a mesma janela divergem no primeiro ajuste que alguém
   * fizer em uma delas, e a divergência apareceria como painéis que discordam
   * entre si na mesma tela — o defeito exato que este recorte único existe para
   * fechar.
   *
   * A janela por dia é calculada à parte porque `fluxo.passos` já vem na
   * granularidade escolhida, e o recorte não pode encolher só porque a pessoa
   * trocou a espessura da coluna. Ele segue sempre a janela em SEMANAS, que é a
   * que o seletor de período nomeia.
   */
  const limites = useMemo(
    () => limitesDaJanela(janelaDePassos(hoje, janela, "semana")),
    [hoje, janela],
  );

  const noPeriodo = useMemo(() => {
    if (!limites) return doQuadro;
    return doQuadro.filter((c) =>
      ativaNaJanela(
        c,
        concluido(c) ? (c.enteredAt ?? null) : null,
        limites.ini,
        limites.fim,
      ),
    );
  }, [doQuadro, concluido, limites]);

  const abertos = useMemo(
    () => noPeriodo.filter((c) => !concluido(c)),
    [noPeriodo, concluido],
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

  const hojeISO = isoDe(hoje);

  /**
   * Trocar de janela — e, ao entrar no modo personalizado, JÁ CHEGAR PREENCHIDO.
   *
   * As duas datas nascem com a janela que estava na tela um instante antes. Sem
   * isso, escolher "Escolher datas…" apagaria o gráfico e devolveria dois campos
   * vazios: o painel some no exato gesto em que a pessoa foi mexer nele, e ela
   * ainda precisa adivinhar em que formato digitar para trazê-lo de volta.
   * Vindo preenchido, o gráfico não pisca e as datas viram ponto de partida —
   * mexer numa ponta é ajuste, não preenchimento de formulário.
   */
  function escolherJanela(v: string) {
    if (v !== "custom") {
      setModoJanela("recentes");
      setPeriodo(Number(v) as Periodo);
      return;
    }
    if (!de || !ate) {
      const s = janelaDeSemanas(hoje, { modo: "recentes", semanas: periodo });
      setDe(isoDe(s[0].inicio));
      setAte(hojeISO);
    }
    setModoJanela("intervalo");
  }

  const nomeDe = (email: string) => usersMap[email]?.name ?? email;
  const opcoesPessoa = (vazio: string): SelectOption[] => [
    { value: "", label: vazio },
    ...pessoas.map((e) => ({ value: e, label: nomeDe(e) })),
  ];
  const sujo = !!(fPessoaAtivo || fRespAtivo);

  /**
   * A janela por extenso, para ir no rodapé dos indicadores.
   *
   * Todo KPI desta faixa passou a obedecer ao recorte do topo, e indicador que
   * mudou de janela sem dizer é pior do que indicador sem janela: quem leu "12
   * vencidas" ontem e lê "3" hoje precisa saber que o que mudou foi o recorte.
   */
  const janelaTxt = intervaloPronto
    ? `${fmtDayMonth(de)} a ${fmtDayMonth(ate)}`
    : PERIODO_LABEL[periodo].toLowerCase();

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
          <h1>Dashboard — {quadro}</h1>
          <p>
            Os números abaixo são deste quadro, no período escolhido ao lado.
          </p>
        </div>
      </div>

      {/**
       * A ESCOLHA DO QUADRO NÃO É UM FILTRO, então não mora entre eles.
       *
       * Um filtro recorta o que está na tela; isto TROCA a tela. São as mesmas
       * abas do Kanban, no mesmo lugar e com o mesmo desenho, de propósito: quem
       * vem de lá já sabe o que este controle faz antes de clicar. Some quando
       * há um quadro só — um seletor de uma opção é decoração que pede decisão.
       */}
      {sectors.length > 1 && (
        <div className={styles.quadros}>
          {sectors.map((s) => (
            <button
              key={s}
              className={`${styles.quadroBtn} ${s === quadro ? styles.quadroOn : ""}`}
              onClick={() => setQuadroSel(s)}
              aria-pressed={s === quadro}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className={styles.filtros}>
        <span className={styles.acaoRot}>
          <Icon name="calendar" size={14} /> Período
        </span>
        <div className={styles.periodo}>
          <Select
            value={modoJanela === "intervalo" ? "custom" : String(periodo)}
            options={[
              ...PERIODOS.map((p) => ({
                value: String(p),
                label: PERIODO_LABEL[p],
              })),
              { value: "custom", label: "Escolher datas…" },
            ]}
            onChange={escolherJanela}
            ariaLabel="Período de toda a tela"
          />
        </div>
        {/* As datas aparecem SÓ no modo personalizado: dois campos apagados
            ocupando a linha seriam um recorte que não recorta no mesmo espaço
            do que recorta. */}
        {modoJanela === "intervalo" && (
          <>
            <label className={styles.campoData}>
              <span>De</span>
              <input
                type="date"
                className={styles.dataInput}
                value={de}
                max={hojeISO}
                onChange={(e) => setDe(e.target.value)}
              />
            </label>
            <label className={styles.campoData}>
              <span>Até</span>
              <input
                type="date"
                className={styles.dataInput}
                value={ate}
                max={hojeISO}
                onChange={(e) => setAte(e.target.value)}
              />
            </label>
            <button
              className={styles.limpar}
              onClick={() => {
                setModoJanela("recentes");
                setDe("");
                setAte("");
              }}
            >
              <Icon name="x" size={13} /> Período fixo
            </button>
          </>
        )}
        <span className={styles.separador} aria-hidden="true" />
        <Icon name="filter" size={15} />
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
              : `${noPeriodo.length - abertos.length} concluída(s) fora da conta · ${janelaTxt}`
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
                ? `85% saem nesse prazo ou menos · ${janelaTxt}`
                : `${fluxo.amostra} conclusão(ões) em ${janelaTxt} — amostra pequena demais`
          }
        />
        {/**
         * "Entregas nas últimas 4 semanas" virou "entregas no período".
         *
         * O número antigo era `entregas.slice(-4)` — os quatro últimos PASSOS da
         * janela. Com o recorte livre no topo, isso viraria "as quatro últimas
         * semanas de junho" embaixo do rótulo "últimas 4 semanas" sempre que
         * alguém escolhesse um intervalo terminado no passado, e "os últimos
         * quatro dias" ao trocar a granularidade. Total da janela é o número que
         * o rótulo consegue prometer.
         */}
        <Kpi
          icone="check"
          rotulo="Entregas"
          valor={kpi(fluxo.totalEntregas)}
          rodape={`concluídas · ${janelaTxt}`}
        />
      </div>

      {/**
       * A ORDEM É A DA LEITURA, do resumo para o detalhe.
       *
       * Primeiro os indicadores (acima). Depois DE QUE a fila é feita — a rosca
       * de tipos, que responde numa olhada e por isso não precisa da largura da
       * tela. Depois COMO ela anda, que é o painel de fluxo e é o mais denso
       * desta tela. Só então o detalhe: quem carrega, de onde vem, o que vence.
       *
       * A rosca é o único painel COMPACTO, e é o único que pode ser: são seis
       * fatias e seis linhas de legenda, que cabem em 420px e não melhoram com
       * mil. Os outros quatro medem por comprimento (barra deitada) ou por
       * quantidade de colunas (série, tabela) — cortá-los ao meio é a medida
       * ficando pela metade, e foi por isso que a grade de duas colunas caiu na
       * Issue #83. Compacto aqui é uma exceção com motivo, não o começo de uma
       * grade nova.
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
          titulo="Demandas por tipo"
          compacto
          fontes={[fCards, fCols]}
          esqueleto={<SkeletonChart bars={5} texto="Carregando a divisão por tipo…" />}
        >
          <Rosca cards={abertos} />
        </Painel>

        {/**
         * O subtítulo declara a janela DESENHADA, não a pedida.
         *
         * As duas divergem sempre que o intervalo é escolhido à mão: quem digita
         * 15/07 a 20/07 recebe 13/07 a 26/07, porque a coluna é a semana inteira
         * (ver `janelaDePassos`). Sem esta linha, o painel responderia por um
         * recorte diferente do que foi pedido sem nunca dizer isso — e o eixo x,
         * que só imprime uma data a cada tantas colunas, não denuncia. Por dia o
         * encaixe não acontece, e a linha continua valendo: ela passa a
         * confirmar que o recorte é exatamente o que foi digitado.
         */}
        <Painel
          titulo="Demanda que entra × demanda que sai"
          sub={
            fluxo.passos.length
              ? `${fluxo.passos.length} ${fluxo.passos.length === 1 ? PASSO_LABEL[gran] : PASSO_PLURAL[gran]} · ${fluxo.passos[0].rotuloLongo} a ${fluxo.passos[fluxo.passos.length - 1].rotuloLongo}`
              : undefined
          }
          chip={`fila ${fluxo.fila[fluxo.fila.length - 1] ?? 0}`}
          /**
           * O QUE SOBROU AQUI É A ESPESSURA DA COLUNA, não o recorte de tempo.
           *
           * O período subiu para a barra do topo, porque agora ele vale para a
           * tela inteira — e controle que vale para tudo não pode morar dentro
           * de um painel, onde ele aparenta valer só para aquele. A troca
           * dia/semana ficou, e ela é o oposto: só este painel desenha colunas,
           * então só ele tem o que responder.
           *
           * Dois botões, e não um `Select` de duas opções: são duas opções
           * mutuamente exclusivas que se alternam o tempo todo enquanto se lê o
           * gráfico ("na semana parece estável — e por dia?"), e abrir um menu
           * para cada troca é um clique a mais em cima de um gesto de leitura.
           */
          acoes={
            <>
              <span className={styles.acaoRot}>
                <Icon name="trend" size={14} /> Cada coluna é
              </span>
              <div
                className={styles.grupoBotoes}
                role="group"
                aria-label="Granularidade das colunas"
              >
                {(["dia", "semana"] as Granularidade[]).map((g) => (
                  <button
                    key={g}
                    className={`${styles.granBtn} ${g === gran ? styles.granOn : ""}`}
                    onClick={() => setGran(g)}
                    aria-pressed={g === gran}
                  >
                    {PASSO_UM[g]}
                  </button>
                ))}
              </div>
            </>
          }
          fontes={[fCards, fCols]}
          esqueleto={<SkeletonChart bars={10} texto="Carregando as séries…" />}
        >
          <FluxoNoTempo fluxo={fluxo} />
        </Painel>

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
          chip={`${noPeriodo.length} ${noPeriodo.length === 1 ? "demanda" : "demandas"}`}
          fontes={[fCards, fCols]}
          esqueleto={
            <SkeletonRow
              rows={5}
              texto="Carregando as demandas por setor solicitante…"
            />
          }
        >
          <OrigemPorEtapa cards={noPeriodo} colsPorSetor={colsPorSetor} />
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
// Peças
// ---------------------------------------------------------------------------

function PainelHead({
  titulo,
  sub,
  chip,
  chipTom,
}: {
  titulo: string;
  sub?: string;
  chip?: string;
  chipTom?: "danger";
}) {
  return (
    <div className={styles.painelHead}>
      <div>
        <h3>{titulo}</h3>
        {sub && <p className={styles.painelSub}>{sub}</p>}
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
  sub,
  chip,
  chipTom,
  acoes,
  compacto,
  fontes,
  esqueleto,
  children,
}: {
  titulo: string;
  sub?: string;
  chip?: string;
  chipTom?: "danger";
  /** Controles do próprio painel, entre o cabeçalho e o conteúdo. */
  acoes?: ReactNode;
  /**
   * O painel para de esticar até a borda e fica do tamanho do conteúdo.
   *
   * Só a rosca de tipos usa. Ver o comentário na ordem dos painéis: os outros
   * medem por comprimento ou por número de colunas, e encolher a caixa é
   * encolher a medida.
   */
  compacto?: boolean;
  fontes: Assinatura[];
  esqueleto: ReactNode;
  children: ReactNode;
}) {
  const { erro, carregando } = juntarFontes(fontes);
  return (
    <section
      className={`${styles.painel} ${compacto ? styles.painelCompacto : ""}`}
      aria-busy={carregando || undefined}
    >
      {/* O subtítulo cai junto com o chip enquanto não há resposta: ele fala do
          recorte DESENHADO, e não há desenho nenhum até os dados chegarem. */}
      <PainelHead
        titulo={titulo}
        sub={erro || carregando ? undefined : sub}
        chip={erro || carregando ? undefined : chip}
        chipTom={chipTom}
      />
      {/**
       * As ações ficam FORA do portão de carregamento, ao contrário do chip e do
       * subtítulo.
       *
       * Aqueles descrevem o desenho e caem junto com ele; o controle é o que
       * PRODUZ o desenho. Escondê-lo durante a espera faria o seletor de período
       * sumir e voltar a cada troca de recorte — e some justo no instante em que
       * a pessoa acabou de mexer nele, que é quando ela ainda está olhando para
       * lá. Ele fica de pé inclusive sobre o estado de erro: trocar a janela é
       * uma das saídas para uma consulta que falhou.
       */}
      {acoes && <div className={styles.painelAcoes}>{acoes}</div>}
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
 *
 * TRÊS COISAS QUE ESTE PAINEL PRECISOU APRENDER A DIZER (Issue #137):
 *
 * 1. QUE A COLUNA É UMA SEMANA. O eixo x imprime "13/07" e isso lê como um dia:
 *    quem batia o olho via "3 demandas no dia 13", não "3 na semana que começa
 *    em 13". A legenda do eixo agora afirma o passo, e todo texto que fala de
 *    uma coluna — tooltip, tabela, rótulo acessível — usa a semana inteira
 *    ("13 a 19 jul"), nunca a data de abertura sozinha.
 *
 * 2. QUE A ÚLTIMA COLUNA AINDA NÃO ACABOU. Ela é a semana em curso, sempre
 *    contada pela metade, e sempre parecia um tombo de entrada e de entrega —
 *    uma queda que o gráfico inventava toda segunda-feira e desmentia toda
 *    sexta. Agora ela sai hachurada e o tooltip diz "em curso".
 *
 * 3. UM TOOLTIP POR SEMANA, e não um por forma. Os `<title>` nativos abriam só
 *    com o ponteiro parado em cima da barra (uns 20px de alvo, meio segundo de
 *    espera) e mostravam uma série de cada vez. A faixa de captura cobre a
 *    altura toda da coluna: mirar a semana basta, e a resposta vem com as três
 *    séries e o saldo juntos, que é como a pergunta é feita.
 *
 * A tabela dentro do `<details>` não é enfeite de acessibilidade: é o caminho
 * de TECLADO deste gráfico. A alternativa seria pôr `tabIndex` nas faixas de
 * captura, e numa janela de 260 semanas isso são 260 paradas de Tab entre o
 * seletor de período e o próximo painel — acessibilidade que atrapalha quem ela
 * deveria servir. É também onde o número exato mora para quem precisa copiar.
 */
function FluxoNoTempo({ fluxo }: { fluxo: Fluxo }) {
  const { passos, entradas, entregas, fila, saldo, granularidade } = fluxo;
  /**
   * TODO texto deste painel sai daqui, e nenhum diz "semana" escrito à mão.
   *
   * Era assim que estava — "Semana de …", "Saldo da semana", "cada coluna é uma
   * semana inteira" — e essas frases eram a única coisa que dizia à pessoa o que
   * uma coluna representa. Com duas granularidades, uma frase esquecida não sai
   * errada de leve: ela afirma que a coluna é uma semana quando é um dia, e a
   * afirmação vale mais que o gráfico para quem está aprendendo a lê-lo.
   */
  const umPasso = PASSO_LABEL[granularidade];
  const varios = PASSO_PLURAL[granularidade];
  const porDia = granularidade === "dia";
  /**
   * A semana sob o ponteiro. `null` é "nenhuma", e não a semana 0 — daí o tipo
   * nulável em vez de um -1 que a aritmética de índice trataria como número.
   */
  const [ativo, setAtivo] = useState<number | null>(null);

  if (!passos.length || (!entradas.some(Boolean) && !entregas.some(Boolean)))
    return (
      <EmptyState
        size="compact"
        icon="trend"
        title="Sem movimento no período"
        description="As séries aparecem quando houver demanda criada ou concluída neste recorte. Troque o período no topo da tela, ou escolha outras datas, para alcançar um trecho com movimento."
      />
    );

  // Painel de largura inteira: o viewBox acompanha, senão o SVG escala ~3× e o
  // rótulo de eixo de 9,5px chega na tela com 30. Larguras em unidades de
  // viewBox só significam alguma coisa em relação a W.
  const W = 1120;
  const H = 268;
  const pl = 46;
  const pr = 56;
  const pt = 18;
  // Fundo alto porque embaixo do eixo moram duas linhas: as datas e a legenda
  // que declara o passo. Era ela que faltava para a coluna deixar de ler como
  // um dia — e legenda de eixo espremida contra a borda do painel não se lê.
  const pb = 52;
  const n = passos.length;
  const base = H - pb;
  const max = Math.max(1, ...entradas, ...entregas);
  const maxFila = Math.max(1, ...fila);
  const passo = (W - pl - pr) / n;
  /**
   * Espessura proporcional ao passo, e nunca menor que 1.
   *
   * A conta antiga (`(passo - 6) / 2`) reservava 6 unidades de respiro fixas e
   * virava NEGATIVA a partir de umas 120 colunas — o `Math.max(3, …)` salvava a
   * barra de sumir, mas as duas do par passavam a se sobrepor. Com a janela por
   * datas dá para pedir cinco anos, então o respiro também encolhe com o passo.
   */
  const vao = Math.min(2, passo * 0.06);
  const bw = Math.max(1, Math.min(passo * 0.34, (passo - vao) / 2));
  const Y = (v: number) => pt + (1 - v / max) * (base - pt);
  const Yf = (v: number) => pt + (1 - v / maxFila) * (base - pt);
  const X = (i: number) => pl + i * passo + passo / 2;

  const linhaFila = fila
    .map((v, i) => `${i ? "L" : "M"} ${X(i).toFixed(1)} ${Yf(v).toFixed(1)}`)
    .join(" ");
  // A área existe para a linha dizer "acumulado" antes de alguém ler o eixo da
  // direita: linha solta é taxa, linha com corpo embaixo é estoque.
  const areaFila = `${linhaFila} L ${X(n - 1).toFixed(1)} ${base} L ${X(0).toFixed(1)} ${base} Z`;

  /**
   * De quantas em quantas colunas o eixo escreve um rótulo.
   *
   * O rótulo virou o PERÍODO ("13–19/07", ou "28/09–04/10" quando a semana
   * atravessa o mês), que ocupa mais que o dobro do "13/07" de antes. Um passo
   * fixo não serve mais: o que cabe é decidido pela largura do rótulo contra a
   * largura da área de plotagem, e é isso que a conta abaixo faz. Antes de
   * imprimir de duas em duas, o eixo primeiro gasta todo o espaço que tem —
   * em 12 semanas ele nomeia as doze.
   */
  // "13–19/07" contra "13/07": o rótulo do dia ocupa pouco mais da metade, e
  // um valor fixo faria o eixo por dia pular datas que caberiam folgadas.
  const LARG_ROTULO = porDia ? 40 : 64;
  const maxRotulos = Math.max(2, Math.floor((W - pl - pr) / LARG_ROTULO));
  const passoRotulo = Math.max(1, Math.ceil(n / maxRotulos));
  const saldoPeriodo = fluxo.totalEntradas - fluxo.totalEntregas;
  const filaFinal = fila[n - 1] ?? 0;

  const resumoAcessivel =
    `Colunas de entrada e entrega por ${umPasso}, com a fila acumulada em linha. ` +
    `${n} ${n === 1 ? umPasso : varios}, de ${passos[0].rotuloLongo} a ${passos[n - 1].rotuloLongo}. ` +
    `${fluxo.totalEntradas} entrada(s), ${fluxo.totalEntregas} entrega(s), fila final de ${filaFinal}. ` +
    `Os números de cada ${umPasso} estão na tabela abaixo do gráfico.`;

  const s = ativo === null ? null : passos[ativo];

  return (
    <>
      <div
        className={styles.chartWrap}
        onPointerLeave={() => setAtivo(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.chart}
          role="img"
          aria-label={resumoAcessivel}
        >
          <defs>
            <linearGradient id="fluxoAreaFila" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={styles.filaTopo} />
              <stop offset="100%" className={styles.filaBase} />
            </linearGradient>
            {/* Hachura da semana em curso. O traço é da cor da SUPERFÍCIE do
                painel, não branco nem preto: assim ela abre sulcos na barra em
                qualquer tema, em vez de virar um segundo tom que compete com a
                cor da série. */}
            <pattern
              id="fluxoParcial"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" className={styles.hachuraFundo} />
              <line x1="0" y1="0" x2="0" y2="6" className={styles.hachuraRisco} />
            </pattern>
          </defs>

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
                  x={pl - 8}
                  y={Y(v) + 3.5}
                  textAnchor="end"
                  className={styles.eixo}
                >
                  {Math.round(v)}
                </text>
                <text x={W - pr + 8} y={Y(v) + 3.5} className={styles.eixoFila}>
                  {Math.round((maxFila * g) / 3)}
                </text>
              </g>
            );
          })}

          {/* O zero fica mais forte que as outras linhas de grade: é dele que a
              altura de toda barra é medida, e grade toda igual deixa o olho
              ancorar em qualquer uma. */}
          <line
            x1={pl}
            y1={base}
            x2={W - pr}
            y2={base}
            className={styles.eixoBase}
          />

          {/* A faixa da semana mirada, atrás de tudo: destaque desenhado por
              cima apagaria justamente a barra que a pessoa está tentando ler. */}
          {ativo !== null && (
            <rect
              x={pl + ativo * passo}
              y={pt}
              width={passo}
              height={base - pt}
              className={styles.faixaAtiva}
            />
          )}

          {passos.map((p, i) => (
            <g key={p.chave}>
              <rect
                x={X(i) - bw - vao / 2}
                y={Y(entradas[i])}
                width={bw}
                height={base - Y(entradas[i])}
                rx={Math.min(3, bw / 2)}
                className={`${styles.barEntrada} ${p.parcial ? styles.barParcial : ""}`}
              />
              <rect
                x={X(i) + vao / 2}
                y={Y(entregas[i])}
                width={bw}
                height={base - Y(entregas[i])}
                rx={Math.min(3, bw / 2)}
                className={`${styles.barEntrega} ${p.parcial ? styles.barParcial : ""}`}
              />
              {p.parcial && (
                <>
                  <rect
                    x={X(i) - bw - vao / 2}
                    y={Y(entradas[i])}
                    width={bw}
                    height={base - Y(entradas[i])}
                    rx={Math.min(3, bw / 2)}
                    className={styles.hachura}
                  />
                  <rect
                    x={X(i) + vao / 2}
                    y={Y(entregas[i])}
                    width={bw}
                    height={base - Y(entregas[i])}
                    rx={Math.min(3, bw / 2)}
                    className={styles.hachura}
                  />
                </>
              )}
              {i % passoRotulo === 0 && (
                <text
                  x={X(i)}
                  y={base + 16}
                  textAnchor="middle"
                  className={styles.eixo}
                >
                  {p.rotulo}
                </text>
              )}
            </g>
          ))}

          {/* A linha vem depois das colunas: desenhada antes, sumiria atrás delas
              exatamente nos passos de mais movimento — as que interessam. */}
          <path d={areaFila} className={styles.filaArea} />
          <path d={linhaFila} className={styles.filaHalo} />
          <path d={linhaFila} className={styles.filaLinha} />
          {/* Ponto por semana só enquanto eles não se encostam. Passada essa
              densidade, uma fileira de bolinhas coladas engrossa a linha e some
              com a forma dela, que é a única coisa que a linha tem para dizer. */}
          {passo >= 14 &&
            fila.map((v, i) => (
              <circle
                key={i}
                cx={X(i)}
                cy={Yf(v)}
                r={2.6}
                className={styles.filaPonto}
              />
            ))}

          {ativo !== null && (
            <g className={styles.guia}>
              <line
                x1={X(ativo)}
                y1={pt}
                x2={X(ativo)}
                y2={base}
                className={styles.guiaLinha}
              />
              <circle
                cx={X(ativo)}
                cy={Yf(fila[ativo])}
                r={4.2}
                className={styles.guiaPonto}
              />
            </g>
          )}

          {/* Título de cada eixo, junto do eixo. Dois eixos com escalas
              diferentes só se leem se cada um disser do que está falando — e a
              legenda embaixo, que já diz de quem é o da direita, fica longe
              demais do número para servir de resposta no meio da leitura. */}
          <text
            transform={`translate(11 ${(pt + base) / 2}) rotate(-90)`}
            textAnchor="middle"
            className={styles.eixoTitulo}
          >
            demandas por {umPasso}
          </text>
          <text
            transform={`translate(${W - 9} ${(pt + base) / 2}) rotate(-90)`}
            textAnchor="middle"
            className={styles.eixoTituloFila}
          >
            fila acumulada
          </text>
          <text
            x={pl + (W - pl - pr) / 2}
            y={H - 8}
            textAnchor="middle"
            className={styles.eixoLegenda}
          >
            {porDia
              ? "cada coluna é um dia · a data é o próprio dia"
              : "cada coluna é uma semana inteira, de segunda a domingo · a data é a segunda-feira em que ela começa"}
          </text>

          {/* Faixa de captura: a coluna inteira, da grade ao chão. É ela que faz
              o alvo do ponteiro ser A SEMANA, e não um retângulo de 20px por
              série — mirar a barra baixa de uma semana fraca era o pior caso, e
              é justo a semana sobre a qual mais se pergunta "o que houve aqui?". */}
          {passos.map((p, i) => (
            <rect
              key={`alvo-${p.chave}`}
              x={pl + i * passo}
              y={pt}
              width={passo}
              height={base - pt}
              className={styles.alvo}
              onPointerEnter={() => setAtivo(i)}
            />
          ))}
        </svg>

        {/**
         * O cartão FOGE da coluna: mirou na metade esquerda, ele encosta na
         * direita, e vice-versa.
         *
         * Ancorado na coluna, ele tapava as barras que estava explicando — foi
         * exatamente o defeito que este painel já teve uma vez, e que só
         * apareceu quando alguém renderizou a tela em vez de ler o código. Quem
         * amarra o cartão à semana é a guia tracejada, não a proximidade; e como
         * o canto só troca ao cruzar o meio do gráfico, ele fica parado enquanto
         * o ponteiro anda pelas colunas vizinhas, em vez de correr atrás dele.
         */}
        {s && (
          <div
            className={`${styles.tip} ${ativo! < n / 2 ? styles.tipDir : styles.tipEsq}`}
            aria-hidden="true"
          >
            <div className={styles.tipTitulo}>
              {porDia ? s.rotuloLongo : `Semana de ${s.rotuloLongo}`}
              {s.parcial && <span className={styles.tipTag}>em curso</span>}
            </div>
            <div className={styles.tipLinha}>
              <i className={styles.swEntrada} />
              <span>Entradas</span>
              <b>{entradas[ativo!]}</b>
            </div>
            <div className={styles.tipLinha}>
              <i className={styles.swEntrega} />
              <span>Entregas</span>
              <b>{entregas[ativo!]}</b>
            </div>
            <div className={styles.tipLinha}>
              <i className={styles.swFila} />
              <span>Fila ao fim</span>
              <b>{fila[ativo!]}</b>
            </div>
            {/* O saldo é a única linha derivada, e vai separada por isso: as três
                de cima são medidas, esta é a conta entre duas delas. */}
            <div className={`${styles.tipLinha} ${styles.tipSaldo}`}>
              <span>Saldo {porDia ? "do dia" : "da semana"}</span>
              <b className={saldo[ativo!] > 0 ? styles.pior : styles.melhor}>
                {saldo[ativo!] > 0 ? "+" : ""}
                {saldo[ativo!]}
              </b>
            </div>
          </div>
        )}
      </div>

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
        {passos.some((p) => p.parcial) && (
          <span>
            <i className={styles.swParcial} />
            {porDia ? "Dia" : "Semana"} em curso — ainda vai somar
          </span>
        )}
      </div>

      {/**
       * O que o gráfico deixa estimar no olho, escrito.
       *
       * Nenhum destes números custa consulta: os quatro saem das séries que já
       * estavam desenhadas. "Quantas entraram no trimestre?" era uma pergunta
       * que só se respondia somando barra por barra — e a vazão média é a que
       * transforma o painel em previsão: com a fila em N e a vazão em V, quem
       * lê sabe em quantos passos ela zera se nada mais entrar.
       */}
      <div className={styles.resumo}>
        <div className={styles.resumoItem}>
          <span>Entradas no período</span>
          <b>{fluxo.totalEntradas}</b>
        </div>
        <div className={styles.resumoItem}>
          <span>Entregas no período</span>
          <b>{fluxo.totalEntregas}</b>
        </div>
        <div className={styles.resumoItem}>
          <span>Saldo do período</span>
          <b className={saldoPeriodo > 0 ? styles.pior : styles.melhor}>
            {saldoPeriodo > 0 ? "+" : ""}
            {saldoPeriodo}
          </b>
        </div>
        <div className={styles.resumoItem}>
          <span>Vazão média</span>
          <b>
            {hh(fluxo.vazaoMedia)}
            <em>/{umPasso}</em>
          </b>
        </div>
        <div className={styles.resumoItem}>
          <span>Fila ao fim</span>
          <b>{filaFinal}</b>
        </div>
      </div>

      <details className={styles.tabelaFluxo}>
        <summary>Ver os números {porDia ? "dia a dia" : "semana a semana"}</summary>
        <div className={styles.tabelaFluxoWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{porDia ? "Dia" : "Semana"}</th>
                <th className={styles.num}>Entradas</th>
                <th className={styles.num}>Entregas</th>
                <th className={styles.num}>Saldo</th>
                <th className={styles.num}>Fila</th>
              </tr>
            </thead>
            <tbody>
              {passos.map((p, i) => (
                <tr key={p.chave}>
                  <td>
                    {p.rotuloLongo}
                    {p.parcial && (
                      <span className={styles.tipTag}>em curso</span>
                    )}
                  </td>
                  <td className={styles.num}>{entradas[i]}</td>
                  <td className={styles.num}>{entregas[i]}</td>
                  <td className={styles.num}>
                    {saldo[i] > 0 ? "+" : ""}
                    {saldo[i]}
                  </td>
                  <td className={styles.num}>{fila[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
