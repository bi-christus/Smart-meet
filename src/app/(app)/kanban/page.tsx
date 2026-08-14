"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeUsers,
  DEFAULT_SECTORS,
  type UserProfile,
} from "@/lib/users";
import {
  subscribeSolicitantes,
  subscribeSolicitanteSetores,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import {
  subscribeCards,
  subscribeLixeira,
  restaurarDaLixeira,
  moveCard,
  subscribeColumns,
  seedDefaultColumns,
  addColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  colunasEntregues,
  DEFAULT_COLUMNS,
  COLUMN_COLORS,
  PRIORITY_LABEL,
  DEMAND_TYPES,
  DEMAND_TYPE_LABEL,
  DEMAND_TYPE_COLOR,
  tagColor,
  resolverTags,
  corrigirTagsDeCards,
  type Card,
  type Priority,
  type ColumnDoc,
  type DemandType,
} from "@/lib/kanban";
import { carregarHistorico } from "@/lib/historico";
import { codigoDe, fraseDeFalha } from "@/lib/erro-ui-core";
import { auth } from "@/lib/firebase";
import {
  ACAO_ROTULO,
  diffCard,
  linhaDaMudanca,
  type Evento,
} from "@/lib/historico-core";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { PerfilModal } from "@/components/perfil-modal";
import { Select, type SelectOption } from "@/components/select";
import { Modal } from "@/components/modal";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonCard, SkeletonRow } from "@/components/skeleton";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { CardModal, type EditState } from "./card-modal";
import {
  KNOWN_PRIORITIES,
  PRIORITY_COLOR,
  autorDoRegistro,
  criarRotulos,
  fmtShort,
  parseDue,
  relTime,
} from "./comum";
import { RelatorioModal } from "./relatorio-modal";
import styles from "./kanban.module.css";

/**
 * Listas vazias constantes, para os cálculos rodarem antes de os dados
 * chegarem. Fora do componente porque `?? []` no corpo cria um array novo a
 * cada render, e os `useMemo` que dependem dele recalculariam sempre.
 */
const SEM_CARDS: Card[] = [];
const SEM_USERS: UserProfile[] = [];
const SEM_SOLICITANTES: Solicitante[] = [];
const SEM_SETORES: SolicitanteSetor[] = [];
const SEM_COLUNAS: ColumnDoc[] = [];

/** Assinatura que nem chegou a abrir: não há nada para fechar depois. */
const NADA_A_FECHAR = () => undefined;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function dueInfo(
  due?: string | null,
  entregue?: boolean,
): { label: string; tone: "late" | "soon" | "ok" | "none" | "done" } | null {
  // Demanda aceita a partir de uma reunião entra sem prazo de propósito — a
  // fila de validação não exige datas para não virar uma fila que ninguém abre.
  // Sem este selo, ela ficaria visualmente igual a uma demanda com tudo em dia.
  if (!due) return { label: "sem prazo definido", tone: "none" };
  const d = parseDue(due);
  // Card na etapa de entrega não atrasa: o prazo pode ter passado DEPOIS de o
  // trabalho terminar, e pintar isso de vermelho cobra uma entrega já feita.
  if (entregue) return { label: `entregue · ${fmtShort(d)}`, tone: "done" };
  const today = startOfToday();
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const tone: "late" | "soon" | "ok" =
    diff < 0 ? "late" : diff <= 3 ? "soon" : "ok";
  let label: string;
  if (diff === 0) label = "Hoje";
  else if (diff === 1) label = "Amanhã";
  else if (diff === -1) label = "Ontem";
  else if (diff < 0) label = `${Math.abs(diff)}d atrás`;
  else label = fmtShort(d);
  return { label, tone };
}
function agingDays(enteredAt?: number): number {
  if (!enteredAt) return 0;
  return Math.floor((Date.now() - enteredAt) / 86400000);
}
function dataHora(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Valor sentinela do filtro de responsável (e-mails sempre têm "@"). */
const NO_ASSIGNEE = "__sem__";

type ColEditState = { mode: "new" } | { mode: "edit"; col: ColumnDoc } | null;

export default function KanbanPage() {
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

  const [sector, setSector] = useState("");

  /**
   * As cinco assinaturas do quadro.
   *
   * O falso vazio aqui era o mais visto do app: sete colunas piscando "Nenhuma
   * demanda" a cada troca de setor, num quadro que muitas vezes tem trezentas.
   * E quatro dos cinco erros iam para lugar nenhum — uma conta sem acesso ao
   * setor via exatamente a mesma tela de um setor recém-criado.
   *
   * A chave é o setor: trocou, reassina e volta a "ainda não sei", sem nenhum
   * `setState` dentro de efeito para zerar nada.
   */
  const fCards = useAsyncData<Card>(sector, (onData, onErro) => {
    // Sem setor escolhido não há o que assinar, e a resposta certa é uma lista
    // vazia — não uma espera eterna.
    if (!sector) {
      onData([]);
      return NADA_A_FECHAR;
    }
    return subscribeCards(sector, onData, onErro);
  });
  const fCols = useAsyncData<ColumnDoc>(sector, (onData, onErro) => {
    if (!sector) {
      onData([]);
      return NADA_A_FECHAR;
    }
    return subscribeColumns(sector, onData, onErro);
  });
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );
  const fSolicitantes = useAsyncData<Solicitante>("todos", (onData, onErro) =>
    subscribeSolicitantes(onData, onErro),
  );
  const fReqSetores = useAsyncData<SolicitanteSetor>(
    "todos",
    (onData, onErro) => subscribeSolicitanteSetores(onData, onErro),
  );

  /**
   * A sexta assinatura: o que foi excluído e ainda dá para trazer de volta.
   *
   * Mora aqui, e não dentro do painel, porque a contagem do botão precisa dela
   * ANTES de o painel existir — e assinar o mesmo caminho duas vezes custaria o
   * dobro de leituras para dizer o mesmo número.
   *
   * Quem não administra o setor não assina nada: a regra nega a leitura da
   * lixeira, e mandar o pedido seria gastar uma requisição para receber um erro
   * que a tela já sabe que viria. `canManage` entra na chave para o dia em que o
   * papel do usuário mudar sem o setor mudar junto.
   */
  const fLixeira = useAsyncData<Card>(
    canManage ? sector : "",
    (onData, onErro) => {
      if (!canManage || !sector) {
        onData([]);
        return NADA_A_FECHAR;
      }
      return subscribeLixeira(sector, onData, onErro);
    },
  );

  const cards = fCards.data ?? SEM_CARDS;
  const users = fUsers.data ?? SEM_USERS;
  const solicitantes = fSolicitantes.data ?? SEM_SOLICITANTES;
  const reqSetores = fReqSetores.data ?? SEM_SETORES;
  const fireColumns = fCols.data ?? SEM_COLUNAS;
  /** Agora vem do tipo, e não de um booleano à parte que podia discordar. */
  const colsLoaded = fCols.data !== undefined;
  /** `undefined` de propósito: é o que impede a contagem de existir cedo demais. */
  const naLixeira = fLixeira.data;

  const [search, setSearch] = useState("");
  const [prio, setPrio] = useState<"" | Priority>("");
  // O filtro de responsável é preso ao setor: trocar de quadro o descarta.
  const [assigneeSel, setAssigneeSel] = useState({ sector: "", value: "" });
  const [edit, setEdit] = useState<EditState>(null);
  /** Demanda com o histórico aberto — independente do modal de edição. */
  const [histCard, setHistCard] = useState<Card | null>(null);
  /**
   * Perfil aberto pelo rosto do responsável no card.
   *
   * Guarda o `UserProfile` inteiro, e não o e-mail: o modal precisa da pessoa
   * como ela está em `/users`, e reler `usersMap` a cada render abriria a porta
   * para o perfil sumir sozinho no meio da leitura se a assinatura de `/users`
   * devolvesse o mapa sem essa pessoa (desativada pelo Admin, por exemplo).
   */
  const [perfilDe, setPerfilDe] = useState<UserProfile | null>(null);
  /** Card que outra tela pediu para abrir, enquanto o setor não carregou. */
  const [alvoDireto, setAlvoDireto] = useState<string | null>(null);
  const [colEdit, setColEdit] = useState<ColEditState>(null);
  const [relatorio, setRelatorio] = useState(false);
  const [lixeiraAberta, setLixeiraAberta] = useState(false);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const seededRef = useRef<Set<string>>(new Set());
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sectors.length && !sectors.includes(sector)) setSector(sectors[0]);
  }, [sectors, sector]);

  /**
   * O que sobrou da chave por setor que o quadro tinha.
   *
   * Ela remontava a árvore inteira a cada troca de setor só para
   * reposicionar a rolagem — e, de brinde, replayava a entrada escalonada das
   * sete colunas, 660ms toda vez. É o mesmo quadro no mesmo lugar com outro
   * conteúdo; remontar era resposta grande demais para a pergunta.
   *
   * A rolagem continua voltando ao começo, agora dita em uma linha: o setor
   * novo pode ter menos colunas, e herdar 800px de deslocamento deixaria a
   * pessoa olhando para o vão à direita do quadro.
   */
  useEffect(() => {
    if (boardRef.current) boardRef.current.scrollLeft = 0;
  }, [sector]);

  /**
   * Os cards com as tags de referência já no nome atual do alvo.
   *
   * Daqui para baixo a tela usa `cardsVivos` no lugar de `cards`: se a demanda
   * "Portal do aluno" virou "Portal do aluno 2.0", quem a cita mostra o nome
   * novo no mesmo instante, e a busca por ele encontra as duas pontas — sem
   * esperar a correção chegar ao banco.
   *
   * Fica aqui, colado na assinatura, e não lá embaixo com os outros memos:
   * quem depende dele são efeitos que vêm logo abaixo, e uma lista de
   * dependências é avaliada na ordem do arquivo.
   */
  const cardsVivos = useMemo(() => {
    const titulos = new Map(cards.map((c) => [c.id, c.title]));
    const setores = new Map(reqSetores.map((s) => [s.id, s.name]));
    return cards.map((c) => resolverTags(c, titulos, setores));
  }, [cards, reqSetores]);

  useEffect(() => {
    if (
      colsLoaded &&
      sector &&
      fireColumns.length === 0 &&
      canManage &&
      !seededRef.current.has(sector)
    ) {
      seededRef.current.add(sector);
      seedDefaultColumns(sector).catch(console.error);
    }
  }, [colsLoaded, fireColumns.length, sector, canManage]);

  /**
   * Abertura direta vinda de outra tela (`/kanban?setor=B.I.&card=<id>`) — é
   * assim que o Cronograma e as Recorrências levam para o card.
   *
   * Lido de `window.location` e não de `useSearchParams` porque o hook obriga a
   * página a virar dinâmica e a ter Suspense no prerender; aqui o valor só
   * interessa uma vez, na montagem.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const setorQ = q.get("setor");
    const cardQ = q.get("card");
    if (setorQ) setSector(setorQ);
    if (cardQ) setAlvoDireto(cardQ);
  }, []);

  useEffect(() => {
    if (!alvoDireto) return;
    const c = cardsVivos.find((x) => x.id === alvoDireto);
    if (!c) return; // ainda carregando o setor certo
    setEdit({ mode: "edit", card: c });
    setAlvoDireto(null);
  }, [alvoDireto, cardsVivos]);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);

  /**
   * Escreve no banco o que a tela já mostra.
   *
   * `resolverTags` conserta a leitura, mas quem lê `tags` de fora do quadro —
   * a busca do gestor no relatório, o catálogo do cowork — lê o campo cru. Este
   * efeito é o que faz o conserto sobreviver a quem não está com o quadro
   * aberto. Roda quando há divergência e para sozinho: o próprio snapshot da
   * correção volta sem divergência nenhuma.
   *
   * `resolverTags` devolve o mesmo objeto quando não mudou nada, então a
   * comparação por identidade já separa o que precisa de escrita.
   */
  useEffect(() => {
    const correcoes = cardsVivos
      .filter((c, i) => c !== cards[i])
      .map((c) => ({ id: c.id, tags: c.tags ?? [], tagRefs: c.tagRefs ?? [] }));
    if (correcoes.length === 0) return;
    corrigirTagsDeCards(correcoes).catch((e) =>
      // Sem alarde na tela: a tela já está certa. Isto é manutenção do dado, e
      // quem só tem leitura no setor não pode ser interrompido por causa dela.
      console.error("Não foi possível atualizar as tags renomeadas:", e),
    );
  }, [cardsVivos, cards]);

  const assigneeF = assigneeSel.sector === sector ? assigneeSel.value : "";
  const setAssigneeF = (value: string) => setAssigneeSel({ sector, value });

  // Busca + prioridade (sem o filtro de responsável — é a base das contagens).
  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cardsVivos.filter(
      (c) =>
        (!q ||
          c.title.toLowerCase().includes(q) ||
          (c.tags ?? []).some((t) => t.toLowerCase().includes(q))) &&
        (!prio || c.priority === prio),
    );
  }, [cardsVivos, search, prio]);

  const filtered = useMemo(
    () =>
      !assigneeF
        ? baseFiltered
        : baseFiltered.filter((c) =>
            assigneeF === NO_ASSIGNEE ? !c.assignee : c.assignee === assigneeF,
          ),
    [baseFiltered, assigneeF],
  );

  /**
   * Catálogo de tags do quadro — é o que o "#" oferece no formulário.
   *
   * Sai do quadro inteiro e não de `baseFiltered`: o catálogo não pode encolher porque
   * alguém digitou algo na busca. Ordena por uso e depois em ordem alfabética —
   * a tag que o setor repete toda semana aparece primeiro, e o resto tem ordem
   * estável em vez da ordem de chegada do Firestore.
   */
  const tagsDoQuadro = useMemo(() => {
    const uso = new Map<string, number>();
    cardsVivos.forEach((c) =>
      (c.tags ?? []).forEach((t) => uso.set(t, (uso.get(t) ?? 0) + 1)),
    );
    return [...uso.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
      .map(([tag, n]) => ({ tag, n }));
  }, [cardsVivos]);

  /** As demandas do quadro, para o "#" citar uma existente pelo título. */
  const demandasDoQuadro = useMemo(
    () =>
      cardsVivos.map((c) => ({
        id: c.id,
        title: c.title,
        columnId: c.columnId,
      })),
    [cardsVivos],
  );

  // Só entram no filtro os responsáveis que têm demandas neste quadro.
  const assigneeFilterOptions: SelectOption[] = useMemo(() => {
    const counts = new Map<string, number>();
    let none = 0;
    baseFiltered.forEach((c) => {
      if (c.assignee) counts.set(c.assignee, (counts.get(c.assignee) ?? 0) + 1);
      else none++;
    });
    const opts: SelectOption[] = [
      { value: "", label: "Qualquer responsável" },
    ];
    [...counts.entries()]
      .map(([email, n]) => ({
        email,
        n,
        name: usersMap[email]?.name || email,
        color: usersMap[email]?.color,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .forEach((u) =>
        opts.push({
          value: u.email,
          label: `${u.name} (${u.n})`,
          color: u.color,
        }),
      );
    if (none)
      opts.push({ value: NO_ASSIGNEE, label: `Sem responsável (${none})` });
    // Mantém a seleção visível mesmo que a busca/prioridade zere o resultado.
    if (assigneeF && !opts.some((o) => o.value === assigneeF))
      opts.push({
        value: assigneeF,
        label:
          assigneeF === NO_ASSIGNEE
            ? "Sem responsável (0)"
            : `${usersMap[assigneeF]?.name || assigneeF} (0)`,
        color: usersMap[assigneeF]?.color,
      });
    return opts;
  }, [baseFiltered, usersMap, assigneeF]);

  /**
   * O estado do quadro — cards e colunas, as duas fontes que ele desenha.
   *
   * As listas auxiliares (pessoas, solicitantes, setores solicitantes) ficam de
   * fora de propósito: elas só enfeitam o card com nome e cor, e segurar o
   * quadro inteiro por causa delas seria esperar por um dado que ninguém veio
   * ver. Quando falham, o aviso logo abaixo é que aparece.
   */
  const quadro = juntarFontes([fCards, fCols]);
  const reabrirQuadro = () => {
    fCards.tentarDeNovo();
    fCols.tentarDeNovo();
  };

  /**
   * As três listas que não seguram o quadro, mas cujo erro também não pode
   * sumir. Sem elas o card mostra e-mail no lugar do nome e o formulário abre
   * sem as opções — coisas que a pessoa percebe e não tem como explicar.
   */
  const auxiliares = juntarFontes([fUsers, fSolicitantes, fReqSetores]);
  const reabrirAuxiliares = () => {
    fUsers.tentarDeNovo();
    fSolicitantes.tentarDeNovo();
    fReqSetores.tentarDeNovo();
  };

  const displayCols: ColumnDoc[] = fireColumns.length
    ? fireColumns
    : DEFAULT_COLUMNS.map((c, i) => ({
        id: `_fb_${c.id}`,
        sector,
        colId: c.id,
        title: c.title,
        color: c.color,
        order: i,
      }));
  const colsReal = fireColumns.length > 0;
  const canEditCols = canManage && colsReal;
  /** Etapas em que a demanda já foi entregue — nelas o prazo não cobra nada. */
  const entregues = colunasEntregues(
    displayCols.map((c) => ({ id: c.colId, title: c.title })),
  );
  const rotulos = criarRotulos(usersMap, displayCols);

  if (!profile) return null;

  // Preso a uma const aqui embaixo do guarda: `onColDrop` é declaração de
  // função, e o estreitamento de `profile` não atravessa até lá dentro.
  const autorAtual = profile.email;

  if (sectors.length === 0) {
    return (
      <div className={styles.noSector}>
        Você ainda não participa de nenhum setor. Peça a um administrador para
        incluir você em um setor (Admin › Usuários).
      </div>
    );
  }

  function onColDrop(col: ColumnDoc) {
    if (dragCardId) {
      const c = cards.find((x) => x.id === dragCardId);
      if (c && c.columnId !== col.colId)
        moveCard(dragCardId, col.colId, {
          ctx: { autor: autorAtual, sector },
          // Pelo mesmo `diffCard` da edição: arrastar e trocar a etapa no modal
          // são a mesma mudança, e precisam sair iguais na timeline.
          mudancas: diffCard(
            { columnId: c.columnId },
            { columnId: col.colId },
            rotulos,
          ),
        }).catch(console.error);
    } else if (dragColId && colsReal && dragColId !== col.id) {
      const ids = fireColumns.map((c) => c.id);
      const from = ids.indexOf(dragColId);
      const to = ids.indexOf(col.id);
      if (from >= 0 && to >= 0) {
        const [m] = ids.splice(from, 1);
        ids.splice(to, 0, m);
        reorderColumns(ids).catch(console.error);
      }
    }
    setDragCardId(null);
    setDragColId(null);
    setOverCol(null);
  }

  const prioFilterOptions: SelectOption[] = [
    { value: "", label: "Qualquer prioridade" },
    { value: "alta", label: "Alta", color: PRIORITY_COLOR.alta },
    { value: "media", label: "Média", color: PRIORITY_COLOR.media },
    { value: "baixa", label: "Baixa", color: PRIORITY_COLOR.baixa },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Quadro — {sector}</h1>
          <p>Demandas do setor: crie, priorize e acompanhe até a entrega.</p>
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.sectors}>
          {sectors.map((s) => (
            <button
              key={s}
              className={`${styles.sectorBtn} ${s === sector ? styles.on : ""}`}
              onClick={() => setSector(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className={styles.searchwrap}>
          <Icon name="search" size={15} />
          <input
            className={styles.search}
            placeholder="Buscar por título ou tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ width: 200 }}>
          <Select
            value={prio}
            options={prioFilterOptions}
            onChange={(v) => setPrio(v as "" | Priority)}
            placeholder="Qualquer prioridade"
            ariaLabel="Filtrar por prioridade"
          />
        </div>
        <div style={{ width: 210 }}>
          <Select
            value={assigneeF}
            options={assigneeFilterOptions}
            onChange={setAssigneeF}
            placeholder="Qualquer responsável"
            ariaLabel="Filtrar por responsável"
          />
        </div>
        {profile.email &&
          cards.some((c) => c.assignee === profile.email) &&
          assigneeF !== profile.email && (
            <button
              className={styles.filterBtn}
              onClick={() => setAssigneeF(profile.email)}
              title="Ver apenas as minhas demandas"
            >
              Minhas demandas
            </button>
          )}
        {assigneeF && (
          <button
            className={styles.filterBtn}
            onClick={() => setAssigneeF("")}
            title="Remover o filtro de responsável"
          >
            Limpar filtro
          </button>
        )}

        {/* Empurrados para a direita: nem a lixeira nem o relatório são
            filtros do quadro — são ações que se toma depois de olhar para ele. */}
        <div className={styles.grow} />
        {/* Só para quem administra o setor: a regra do Firestore nega a leitura
            da lixeira aos demais, e um botão que só produz erro é pior do que
            botão nenhum. */}
        {canManage && (
          <button
            className={`${styles.filterBtn} ${styles.lixeiraBtn}`}
            onClick={() => setLixeiraAberta(true)}
            title="Ver e restaurar as demandas excluídas deste setor"
          >
            <Icon name="trash" size={14} />
            Lixeira
            {/* A contagem espera a resposta chegar. Um "0" antes dela é a mesma
                afirmação falsa de "Nenhuma demanda", em forma de número — e é
                o que os últimos commits do projeto existem para impedir. */}
            {naLixeira && naLixeira.length > 0 && (
              <span className={styles.lixeiraN}>{naLixeira.length}</span>
            )}
          </button>
        )}
        <button
          className={`${styles.filterBtn} ${styles.reportBtn}`}
          onClick={() => setRelatorio(true)}
          title="Montar e enviar o relatório de demandas para o gestor"
        >
          <Icon name="relatorios" size={14} />
          Relatório para gestor
        </button>
      </div>

      {auxiliares.erro && (
        <div className={styles.avisoAux} role="status">
          <Icon name="warn" size={14} />
          <span>
            Não foi possível carregar a lista de pessoas e solicitantes. Os
            cards podem mostrar e-mail no lugar do nome.
          </span>
          <button type="button" onClick={reabrirAuxiliares}>
            Tentar de novo
          </button>
        </div>
      )}

      {quadro.erro ? (
        <ErrorState error={quadro.erro} onRetry={reabrirQuadro} />
      ) : (
      <div className={styles.board} ref={boardRef}>
        {displayCols.map((col) => {
          const colCards = filtered.filter((c) => c.columnId === col.colId);
          return (
            <div
              key={col.id}
              className={`${styles.col} ${overCol === col.id ? styles.colDrop : ""} ${dragColId === col.id ? styles.colDragging : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.id) setOverCol(col.id);
              }}
              onDrop={() => onColDrop(col)}
            >
              <div
                className={styles.colstripe}
                style={{ background: col.color }}
              />
              <div className={styles.colhead}>
                {canEditCols && (
                  <span
                    className={styles.colGrip}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", col.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragColId(col.id);
                    }}
                    onDragEnd={() => {
                      setDragColId(null);
                      setOverCol(null);
                    }}
                    title="Arraste para reordenar a coluna"
                  >
                    <GripDots />
                  </span>
                )}
                {/* O `title` devolve o nome inteiro da etapa a quem pousar o
                    ponteiro: a partir de umas três palavras ele passa a sair
                    com reticências, e o nome da etapa é o que diz em que ponto
                    do fluxo aquela pilha de cards está. */}
                <span className={styles.colTitle} title={col.title}>
                  {col.title}
                </span>
                {/* A contagem espera junto com a lista: "0" antes da resposta
                    é a mesma afirmação falsa de "Nenhuma demanda", em número. */}
                {!quadro.carregando && (
                  <span className={styles.colCount}>{colCards.length}</span>
                )}
                <button
                  className={styles.iconbtn}
                  title="Adicionar demanda"
                  onClick={() => setEdit({ mode: "new", columnId: col.colId })}
                >
                  <Icon name="plus" size={15} />
                </button>
                {canEditCols && (
                  <button
                    className={styles.iconbtn}
                    title="Editar coluna"
                    onClick={() => setColEdit({ mode: "edit", col })}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                )}
              </div>
              <div className={styles.collist}>
                {/* Esqueleto DENTRO da coluna, e não no lugar do quadro: as
                    sete colunas precisam manter a forma e a largura enquanto
                    esperam, senão a espera vira um solavanco quando o dado
                    chega. Dois cards bastam para dar a medida sem encher a
                    tela de cinza. */}
                {quadro.carregando ? (
                  <SkeletonCard cards={2} texto="Carregando as demandas…" />
                ) : colCards.length === 0 ? (
                  /* Centrado na altura, agora que a coluna vazia vai até o pé
                     do quadro: encostado no topo de uma coluna de 700px, o
                     aviso ficava pendurado sobre um vão enorme e a coluna lia
                     como quebrada em vez de vazia. */
                  <div className={styles.colVazio}>
                    <EmptyState
                      size="compact"
                      icon="kanban"
                      title="Nenhuma demanda"
                      description="Arraste um card para cá ou use o + no topo da coluna."
                    />
                  </div>
                ) : (
                  colCards.map((c) => (
                    <CardItem
                      key={c.id}
                      card={c}
                      col={col}
                      entregue={entregues.has(col.colId)}
                      assignee={c.assignee ? usersMap[c.assignee] : undefined}
                      requester={c.requester ?? undefined}
                      requesterSector={c.requesterSector ?? undefined}
                      dragging={dragCardId === c.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", c.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragCardId(c.id);
                      }}
                      onDragEnd={() => {
                        setDragCardId(null);
                        setOverCol(null);
                      }}
                      onClick={() => setEdit({ mode: "edit", card: c })}
                      onHistorico={() => setHistCard(c)}
                      onPerfil={setPerfilDe}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}

        {/* Só depois de as colunas responderem: antes disso as que estão na
            tela são o palpite padrão, e oferecer "Nova coluna" ao lado delas
            convidaria a criar a oitava de um quadro que já tem sete. */}
        {canEditCols && colsLoaded && (
          <button
            className={styles.addColBtn}
            onClick={() => setColEdit({ mode: "new" })}
          >
            <Icon name="plus" size={15} /> Nova coluna
          </button>
        )}
        <div style={{ flex: "none", width: 6 }} />
      </div>
      )}

      {edit && (
        <CardModal
          state={edit}
          sector={sector}
          columns={displayCols}
          canManage={canManage}
          actorEmail={profile.email}
          activeUsers={activeUsers}
          usersMap={usersMap}
          solicitantes={solicitantes}
          reqSetores={reqSetores}
          tagsDoQuadro={tagsDoQuadro}
          demandasDoQuadro={demandasDoQuadro}
          rotulos={rotulos}
          onClose={() => setEdit(null)}
        />
      )}

      {histCard && (
        <HistoricoModal
          card={histCard}
          sector={sector}
          usersMap={usersMap}
          onClose={() => setHistCard(null)}
        />
      )}

      {/**
       * SEMPRE `"outra-pessoa"`, mesmo quando o responsável sou eu.
       *
       * Parece rigor demais, e não é. O modo `"eu"` exige `onMudou`, que existe
       * para uma razão concreta: a topbar lê o perfil UMA vez, na entrada do
       * app (`auth-context`), e é o shell quem guarda a versão editada. Desta
       * página não há como alcançar aquele estado — trocar o nome aqui mudaria o
       * card na hora (a assinatura de `/users` é ao vivo) e deixaria a topbar
       * mostrando o nome velho até o próximo login. Um bug visível no mesmo
       * print.
       *
       * A porta de editar o próprio perfil existe e é uma só: o menu do usuário
       * na topbar. Daqui, o rosto no card é o que o card promete — ver de quem é
       * a demanda.
       */}
      {perfilDe && (
        <PerfilModal
          modo="outra-pessoa"
          pessoa={perfilDe}
          onClose={() => setPerfilDe(null)}
        />
      )}

      {colEdit && (
        <ColumnModal
          state={colEdit}
          sector={sector}
          columns={fireColumns}
          cardCount={
            colEdit.mode === "edit"
              ? cards.filter((c) => c.columnId === colEdit.col.colId).length
              : 0
          }
          onClose={() => setColEdit(null)}
        />
      )}

      {relatorio && (
        <RelatorioModal sector={sector} onClose={() => setRelatorio(false)} />
      )}

      {lixeiraAberta && (
        <LixeiraModal
          sector={sector}
          itens={naLixeira}
          erro={fLixeira.erro}
          onRetry={fLixeira.tentarDeNovo}
          columns={displayCols}
          usersMap={usersMap}
          actorEmail={autorAtual}
          onClose={() => setLixeiraAberta(false)}
        />
      )}
    </div>
  );
}

function GripDots() {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="2" cy="2" r="1.3" />
      <circle cx="8" cy="2" r="1.3" />
      <circle cx="2" cy="7" r="1.3" />
      <circle cx="8" cy="7" r="1.3" />
      <circle cx="2" cy="12" r="1.3" />
      <circle cx="8" cy="12" r="1.3" />
    </svg>
  );
}

function CardItem({
  card,
  col,
  entregue,
  assignee,
  requester,
  requesterSector,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
  onHistorico,
  onPerfil,
}: {
  card: Card;
  col: ColumnDoc;
  entregue: boolean;
  assignee?: UserProfile;
  requester?: string;
  requesterSector?: string;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onHistorico: () => void;
  /** Recebe a pessoa, e não o e-mail: quem já tem o perfil na mão é o card. */
  onPerfil: (pessoa: UserProfile) => void;
}) {
  const di = dueInfo(card.due, entregue);
  const startShort = card.startDate ? fmtShort(parseDue(card.startDate)) : "";
  const aging = col.colId === "aguardando" ? agingDays(card.enteredAt) : 0;
  const items = card.checklist ?? [];
  const done = items.filter((i) => i.done).length;
  const tags = card.tags ?? [];
  const comments = card.comments?.length ?? 0;
  const links = card.links?.length ?? 0;
  /**
   * Quantas vezes esta demanda mudou.
   *
   * Menos 1 porque o primeiro evento é o nascimento dela — toda demanda tem um,
   * e um selo "1" em todo card do quadro não informa nada. O selo só aparece
   * quando há mudança de verdade para ver.
   *
   * Nas demandas anteriores ao histórico isto conta um a menos: elas não têm
   * evento de nascimento, e a primeira edição delas cai no lugar dele. É o erro
   * certo a cometer — some sozinho na segunda edição, e o contrário
   * (contar um a mais em TODO card, para sempre) não some nunca.
   */
  const mudou = Math.max(0, (card.histCount ?? 0) - 1);

  const knownType =
    !!card.type && DEMAND_TYPES.includes(card.type as DemandType);
  const typeColor = knownType ? DEMAND_TYPE_COLOR[card.type as DemandType] : "";
  const knownPrio =
    !!card.priority && KNOWN_PRIORITIES.includes(card.priority as Priority);

  return (
    <div
      className={`${styles.kcard} ${dragging ? styles.drag : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className={styles.ktop}>
        {knownType && (
          <span
            className={styles.kType}
            style={{
              background: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
              color: `color-mix(in srgb, ${typeColor} 60%, var(--tx))`,
            }}
          >
            <span className={styles.kTypeDot} style={{ background: typeColor }} />
            {DEMAND_TYPE_LABEL[card.type as DemandType]}
          </span>
        )}
        {knownPrio && (
          <span className={`${styles.prio} ${styles["prio_" + card.priority]}`}>
            {PRIORITY_LABEL[card.priority as Priority]}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Canto superior direito: a porta do histórico. Fica no card, e não
            só dentro do modal, porque a pergunta que ela responde ("quando isto
            mudou de dono?") nasce olhando para o quadro, não editando a
            demanda. `stopPropagation` para o clique não abrir a edição junto. */}
        <button
          type="button"
          className={styles.kHist}
          onClick={(e) => {
            e.stopPropagation();
            onHistorico();
          }}
          title={
            mudou
              ? `${mudou} ${mudou === 1 ? "mudança registrada" : "mudanças registradas"} — ver histórico`
              : "Ver o histórico desta demanda"
          }
          aria-label={`Ver histórico de ${card.title}`}
        >
          <Icon name="history" size={13} />
          {mudou > 0 && <span className={styles.kHistN}>{mudou}</span>}
        </button>
        <span className={styles.grip}>
          <GripDots />
        </span>
      </div>
      <div className={styles.ktitle}>{card.title}</div>
      {/**
       * QUEM PEDIU fica colado no título, e não mais no rodapé.
       *
       * No rodapé ele ficava a um espaço do rosto do RESPONSÁVEL — duas pessoas
       * diferentes lado a lado, e a leitura natural era que aquele nome era o
       * dono daquela foto. Aqui embaixo do título ele lê como o que é: a
       * assinatura do pedido. O título diz o que foi pedido; a linha seguinte,
       * por quem. O rodapé fica só com o andamento (prazo, checklist, quem
       * responde), que é outra pergunta.
       *
       * O nome vem INTEIRO agora — a linha é dele sozinha, então não há mais o
       * motivo que obrigava a cortar no primeiro nome. O setor continua no
       * `title`: ele é a segunda informação da mesma pergunta, e escrevê-lo
       * dobraria a linha em todo card.
       */}
      {requester && (
        <div
          className={styles.kPor}
          title={`Solicitante: ${requester}${requesterSector ? ` · ${requesterSector}` : ""}`}
        >
          por {requester}
        </div>
      )}
      {tags.length > 0 && (
        <div className={styles.kTags}>
          {tags.slice(0, 4).map((t) => (
            <span key={t} className={styles.kTag}>
              <span className={styles.kTagDot} style={{ background: tagColor(t) }} />
              {t}
            </span>
          ))}
          {tags.length > 4 && (
            <span className={styles.kTag}>+{tags.length - 4}</span>
          )}
        </div>
      )}
      <div className={styles.kmeta}>
        {di ? (
          <span className={`${styles.chip} ${styles["due_" + di.tone]}`}>
            <Icon name="calendar" size={12} />
            {startShort ? `${startShort} → ` : ""}
            {di.label}
          </span>
        ) : startShort ? (
          <span className={`${styles.chip} ${styles.due_ok}`}>
            <Icon name="calendar" size={12} />
            Início {startShort}
          </span>
        ) : null}
        {aging >= 1 && (
          <span className={`${styles.aging} ${aging >= 7 ? styles.hot : ""}`}>
            <Icon name="clock" size={12} />
            {aging}d parado
          </span>
        )}
        {items.length > 0 && (
          <span className={styles.mini}>
            <Icon name="check" size={12} />
            {done}/{items.length}
          </span>
        )}
        {comments > 0 && (
          <span className={styles.mini}>
            <Icon name="chat" size={12} />
            {comments}
          </span>
        )}
        {links > 0 && (
          <span className={styles.mini}>
            <Icon name="link" size={12} />
            {links}
          </span>
        )}
        {assignee && (
          /**
           * O nome ao lado do rosto é o de quem o rosto é — o RESPONSÁVEL.
           *
           * Antes deste par existir, o que ficava colado no avatar era o nome do
           * solicitante, e ninguém tem como adivinhar que aquele nome e aquela
           * foto são de duas pessoas diferentes. Agora eles são a mesma pessoa
           * dita duas vezes, e a dúvida some.
           *
           * PRIMEIRO NOME, como no comentário e no histórico (`cName`): o rodapé
           * é uma linha só, dividida com prazo, aging, checklist, comentários e
           * links. "Maria Fernanda de Albuquerque" ali dentro empurraria todo o
           * resto para a linha de baixo em metade dos cards. A elipse do CSS
           * cuida do primeiro nome que ainda assim for comprido, e o nome
           * completo continua a um clique de distância, no perfil.
           *
           * O `alt` leva o nome INTEIRO e o que o clique faz: em modo alvo ele
           * vira o `aria-label` do botão, e é ele — não mais o `title`, que
           * tapava a prévia — quem responde a quem não enxerga a foto.
           */
          <span className={styles.kResp}>
            <span className={styles.kRespNome}>
              {(assignee.name || assignee.email).split(" ")[0]}
            </span>
            <Avatar
              pessoa={assignee}
              size={22}
              alt={`Responsável: ${assignee.name || assignee.email} — ver perfil`}
              aoAbrirPerfil={() => onPerfil(assignee)}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A timeline da demanda.
 *
 * Leitura única na abertura, sem assinatura em tempo real: evento gravado não
 * muda mais, então não há nada para escutar. Quem quiser ver o que acabou de
 * acontecer fecha e abre — e é o que se faz naturalmente.
 */
function HistoricoModal({
  card,
  sector,
  usersMap,
  onClose,
}: {
  card: Card;
  sector: string;
  usersMap: Record<string, UserProfile>;
  onClose: () => void;
}) {
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // A trava existe porque a resposta pode chegar depois de o modal fechar —
    // e `setState` num componente desmontado é um vazamento silencioso.
    let vivo = true;
    carregarHistorico(card.id, sector)
      .then((e) => {
        if (vivo) setEventos(e);
      })
      .catch((e) => {
        console.error("Erro ao carregar o histórico:", e);
        if (vivo) setErro("Não foi possível carregar o histórico.");
      });
    return () => {
      vivo = false;
    };
  }, [card.id, sector]);

  return (
    <Modal
      onClose={onClose}
      ariaLabel={`Histórico da demanda ${card.title}`}
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={480}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="history" size={12} /> Histórico
        </span>
        <span className={styles.mchip}>{sector}</span>
      </div>
      <div className={styles.histTitulo}>{card.title}</div>

      {erro ? (
        <div className={styles.err}>{erro}</div>
      ) : eventos === null ? (
        <div className={styles.histVazio}>Carregando…</div>
      ) : eventos.length === 0 ? (
        <div className={styles.histVazio}>
          Nenhuma mudança registrada ainda. Demandas abertas antes desta versão
          começam a registrar a partir da próxima alteração.
        </div>
      ) : (
        <div className={styles.histLista}>
          {eventos.map((ev) => {
            const u = usersMap[ev.autor];
            const nome = u?.name || ev.autor || "alguém";
            return (
              <div key={ev.id} className={styles.histItem}>
                {/* alt vazio: o primeiro nome está escrito ao lado, no `cName`. */}
                <Avatar
                  pessoa={autorDoRegistro(ev.autor, nome, u)}
                  size={26}
                  alt=""
                  title={nome}
                />
                <div className={styles.cBody}>
                  <div className={styles.cHead}>
                    <span className={styles.cName}>{nome.split(" ")[0]}</span>
                    <span className={styles.histAcao}>
                      {ACAO_ROTULO[ev.acao]}
                    </span>
                  </div>
                  <div className={styles.cTime} title={dataHora(ev.em)}>
                    {relTime(ev.em)} · {dataHora(ev.em)}
                  </div>
                  {ev.mudancas.length > 0 && (
                    <div className={styles.histMudancas}>
                      {ev.mudancas.map((m, i) => {
                        const l = linhaDaMudanca(m);
                        return (
                          <div key={`${m.campo}-${i}`} className={styles.histLinha}>
                            <span className={styles.histCampo}>{l.rotulo}</span>
                            {l.nota ? (
                              <span className={styles.histNota}>{l.nota}</span>
                            ) : (
                              <>
                                <span className={styles.histDe}>
                                  {l.de ?? "—"}
                                </span>
                                <Icon name="chevronRight" size={11} />
                                <span className={styles.histPara}>
                                  {l.para ?? "—"}
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.mactions}>
        <div className={styles.spacer} />
        <button className={styles.btnGhost} onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

/** Sentinela do "esvaziar" — nenhum id de card do Firestore se parece com isto. */
const TUDO = "__tudo__";

type Expurgo =
  | { ok: true; apagados: number; restantes: number }
  | { ok: false; aviso: string };

/**
 * O apagamento definitivo é do servidor, e não do navegador.
 *
 * Apagar a demanda de vez significa apagar junto o histórico dela, que é uma
 * subcoleção — e varrer subcoleção pelo cliente estoura o teto de acessos que
 * as regras impõem antes de a varredura terminar. A rota faz isso com
 * credencial de administrador e responde quanto sobrou.
 *
 * Só o transporte lança. A RECUSA da rota volta como frase, e não como exceção,
 * porque ela já vem escrita em português para esta tela: passá-la de novo pelo
 * tradutor genérico trocaria "este setor não é seu" por "algo deu errado".
 */
async function expurgar(sector: string, id?: string): Promise<Expurgo> {
  const user = auth.currentUser;
  if (!user)
    return {
      ok: false,
      aviso: "Sua sessão expirou. Saia e entre de novo para continuar.",
    };
  const token = await user.getIdToken();
  const r = await fetch("/api/demandas/expurgar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(id ? { sector, id } : { sector }),
  });
  const body = (await r.json()) as {
    error?: string;
    apagados?: number;
    restantes?: number;
  };
  if (!r.ok)
    return {
      ok: false,
      aviso: body.error || "Não foi possível apagar de vez. Tente de novo.",
    };
  return {
    ok: true,
    apagados: body.apagados ?? 0,
    restantes: body.restantes ?? 0,
  };
}

/**
 * A lixeira do setor.
 *
 * NÃO ASSINA NADA: quem assina é a página, porque a contagem do botão precisa
 * do mesmo dado e uma segunda assinatura do mesmo caminho seria o dobro de
 * leituras para dizer o mesmo número. Aqui chegam os três estados prontos.
 *
 * A ORDEM EM QUE ELES SÃO PERGUNTADOS — erro, depois carregando, depois vazio —
 * não é estilo. Uma fonte que falhou também tem `data === undefined` (é o que
 * `aplicarErro` faz questão de garantir), então perguntar "carregando?"
 * primeiro deixaria o painel num esqueleto que nunca termina.
 *
 * Nada aqui anima. Restaurar e apagar são mutação de lista, e o AGENTS.md §3
 * nomeia esse caso: animar chegada e saída de linha vira lentidão percebida em
 * quem está limpando dez demandas seguidas. A entrada e a saída do diálogo —
 * essas sim ganham movimento — já são do `<Modal>`, que também já responde a
 * `prefers-reduced-motion`.
 */
function LixeiraModal({
  sector,
  itens,
  erro,
  onRetry,
  columns,
  usersMap,
  actorEmail,
  onClose,
}: {
  sector: string;
  /** `undefined` = a assinatura ainda não respondeu. `[]` = respondeu vazia. */
  itens: Card[] | undefined;
  erro: Error | null;
  onRetry: () => void;
  columns: ColumnDoc[];
  usersMap: Record<string, UserProfile>;
  actorEmail: string;
  onClose: () => void;
}) {
  /** Qual linha está em operação — `TUDO` quando é a lixeira inteira. */
  const [ocupado, setOcupado] = useState<string | null>(null);
  /** Qual apagamento definitivo espera confirmação. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Da mais recente para a mais antiga — quem abre a lixeira quase sempre veio
  // desfazer o que acabou de fazer. A ordem já vem pronta de `subscribeLixeira`
  // (via `ordenarLixeira`), e reordenar aqui seria uma segunda regra de ordem,
  // livre para discordar dela um dia.
  const ordenados = itens ?? SEM_CARDS;

  async function restaurar(c: Card) {
    setAviso(null);
    setOcupado(c.id);
    try {
      await restaurarDaLixeira(c.id, { ctx: { autor: actorEmail, sector } });
      // A linha some sozinha: a assinatura da página deixa de entregar o card
      // assim que ele volta a ser uma demanda viva.
    } catch (e) {
      console.error("[restaurar demanda]", codigoDe(e), e);
      setAviso(fraseDeFalha("Não foi possível restaurar a demanda.", e, navigator.onLine));
    } finally {
      setOcupado(null);
    }
  }

  async function apagar(id?: string) {
    setAviso(null);
    setOcupado(id ?? TUDO);
    try {
      const r = await expurgar(sector, id);
      if (!r.ok) {
        setAviso(r.aviso);
        return;
      }
      setConfirmando(null);
      // Dizer "pronto" quando o servidor avisou que sobrou coisa seria a mesma
      // mentira que este PR existe para tirar da tela, só que ao contrário.
      setAviso(
        id
          ? r.restantes > 0
            ? `A demanda saiu, mas o apagamento não terminou: ainda restam ${r.restantes}. Clique em “Apagar de vez” outra vez para concluir.`
            : "Demanda apagada de vez, com o histórico dela."
          : r.restantes > 0
            ? `Ainda restam ${r.restantes} na lixeira — o apagamento sai em lotes. Clique em “Esvaziar a lixeira” outra vez para concluir.`
            : "Lixeira esvaziada. As demandas e o histórico de cada uma foram apagados de vez.",
      );
    } catch (e) {
      console.error("[apagar demanda de vez]", codigoDe(e), e);
      setAviso(
        fraseDeFalha(
          id
            ? "Não foi possível apagar a demanda de vez."
            : "Não foi possível esvaziar a lixeira.",
          e,
          navigator.onLine,
        ),
      );
    } finally {
      setOcupado(null);
    }
  }

  const quantas =
    ordenados.length === 1 ? "1 demanda" : `${ordenados.length} demandas`;

  return (
    <Modal
      onClose={onClose}
      ariaLabel={`Lixeira do setor ${sector}`}
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={560}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="trash" size={12} /> Lixeira
        </span>
        <span className={styles.mchip}>{sector}</span>
      </div>
      <div className={styles.histTitulo}>
        Demandas excluídas do quadro. Elas saem da vista de todo mundo, mas
        continuam aqui até alguém apagá-las de vez.
      </div>

      {erro ? (
        <ErrorState error={erro} onRetry={onRetry} size="compact" />
      ) : itens === undefined ? (
        <SkeletonRow rows={3} texto="Carregando a lixeira…" />
      ) : ordenados.length === 0 ? (
        <EmptyState
          size="compact"
          icon="trash"
          title="A lixeira está vazia"
          description={
            <>
              É assim que ela costuma ficar: ninguém excluiu nenhuma demanda de{" "}
              <b>{sector}</b>. Quando alguém excluir, ela espera aqui — e volta
              para o quadro em um clique.
            </>
          }
        />
      ) : (
        <div className={styles.lixeiraLista}>
          {ordenados.map((c) => {
            const coluna =
              columns.find((x) => x.colId === c.columnId)?.title ?? c.columnId;
            const quem = c.deletedBy
              ? usersMap[c.deletedBy]?.name || c.deletedBy
              : "alguém";
            const trabalhando = ocupado === c.id;
            return (
              <div key={c.id} className={styles.lixeiraItem}>
                <div className={styles.lixeiraInfo}>
                  <div className={styles.lixeiraTitulo}>{c.title}</div>
                  <div className={styles.lixeiraMeta}>
                    <span>saiu de {coluna}</span>
                    <span aria-hidden="true">·</span>
                    <span>por {quem}</span>
                    {c.deletedAt ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span title={dataHora(c.deletedAt)}>
                          {relTime(c.deletedAt)}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                {confirmando === c.id ? (
                  <div className={styles.confirmaLinha}>
                    <span className={styles.confirmaTexto}>
                      Apagar de vez? O histórico da demanda vai junto, e não há
                      como trazer de volta.
                    </span>
                    <button
                      type="button"
                      className={styles.lixeiraAcao}
                      onClick={() => setConfirmando(null)}
                      disabled={trabalhando}
                    >
                      Não apagar
                    </button>
                    <button
                      type="button"
                      className={styles.btnConfirmaPerigo}
                      onClick={() => void apagar(c.id)}
                      disabled={trabalhando}
                    >
                      {trabalhando ? "Apagando…" : "Apagar de vez"}
                    </button>
                  </div>
                ) : (
                  <div className={styles.lixeiraAcoes}>
                    <button
                      type="button"
                      className={styles.lixeiraAcao}
                      onClick={() => void restaurar(c)}
                      disabled={trabalhando || ocupado === TUDO}
                    >
                      {trabalhando ? "Restaurando…" : "Restaurar"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.lixeiraAcao} ${styles.lixeiraApagar}`}
                      onClick={() => {
                        setAviso(null);
                        setConfirmando(c.id);
                      }}
                      disabled={trabalhando || ocupado === TUDO}
                    >
                      Apagar de vez
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmando === TUDO && (
        <div className={styles.confirmaBloco}>
          <div className={styles.confirmaTexto}>
            <strong>Esvaziar a lixeira de {sector}?</strong> As {quantas} que
            estão aqui dentro serão apagadas de vez, com o histórico de cada
            uma. Isto não tem como desfazer.
          </div>
          <div className={styles.confirmaAcoes}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setConfirmando(null)}
              disabled={ocupado === TUDO}
            >
              Não esvaziar
            </button>
            <button
              type="button"
              className={styles.btnConfirmaPerigo}
              onClick={() => void apagar()}
              disabled={ocupado === TUDO}
            >
              {ocupado === TUDO ? "Apagando…" : `Apagar as ${quantas} de vez`}
            </button>
          </div>
        </div>
      )}

      {aviso && (
        <div className={styles.lixeiraAviso} role="status">
          {aviso}
        </div>
      )}

      <div className={styles.mactions}>
        {ordenados.length > 0 && confirmando !== TUDO && (
          <button
            type="button"
            className={styles.btnDanger}
            onClick={() => {
              setAviso(null);
              setConfirmando(TUDO);
            }}
            disabled={ocupado !== null}
          >
            <Icon name="trash" size={15} /> Esvaziar a lixeira
          </button>
        )}
        <div className={styles.spacer} />
        <button className={styles.btnGhost} onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

function ColumnModal({
  state,
  sector,
  columns,
  cardCount,
  onClose,
}: {
  state: NonNullable<ColEditState>;
  sector: string;
  columns: ColumnDoc[];
  cardCount: number;
  onClose: () => void;
}) {
  const isNew = state.mode === "new";
  const col = state.mode === "edit" ? state.col : null;
  const [title, setTitle] = useState(col?.title ?? "");
  const [color, setColor] = useState(col?.color ?? COLUMN_COLORS[1]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const colIndex = col ? columns.findIndex((c) => c.id === col.id) : -1;

  function moveCol(dir: -1 | 1) {
    if (!col) return;
    const ids = columns.map((c) => c.id);
    const i = ids.indexOf(col.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorderColumns(ids).catch(console.error);
  }

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      setErr("Informe o nome da coluna.");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const order = columns.length
          ? Math.max(...columns.map((c) => c.order)) + 1
          : 0;
        await addColumn(sector, title, color, order);
      } else if (col) {
        await updateColumn(col.id, { title: title.trim(), color });
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar a coluna.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!col) return;
    if (cardCount > 0) {
      setErr(
        `Mova as ${cardCount} demanda(s) desta coluna para outra antes de removê-la.`,
      );
      return;
    }
    if (!confirm("Remover esta coluna?")) return;
    try {
      await deleteColumn(col.id);
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível remover.");
    }
  }

  return (
    <Modal
      onClose={onClose}
      ariaLabel={isNew ? "Nova coluna" : "Editar coluna"}
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={420}
    >
      <div className={styles.mtitle} style={{ fontSize: 19 }}>
        {isNew ? "Nova coluna" : "Editar coluna"}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Nome</label>
        <input
          className={styles.inp}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex.: Em revisão"
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Cor</label>
        <div className={styles.colorRow}>
          {COLUMN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.colorSwatch} ${color === c ? styles.colorOn : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>
      </div>

      {!isNew && columns.length > 1 && (
        <div className={styles.field}>
          <label className={styles.label}>Posição da coluna</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={styles.btnGhost}
              style={{ flex: 1, height: 38 }}
              onClick={() => moveCol(-1)}
              disabled={colIndex <= 0}
            >
              ← Mover
            </button>
            <button
              className={styles.btnGhost}
              style={{ flex: 1, height: 38 }}
              onClick={() => moveCol(1)}
              disabled={colIndex < 0 || colIndex >= columns.length - 1}
            >
              Mover →
            </button>
          </div>
        </div>
      )}

      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.mactions}>
        {!isNew && (
          <button className={styles.btnDanger} onClick={remove}>
            <Icon name="trash" size={15} /> Excluir
          </button>
        )}
        <div className={styles.spacer} />
        <button className={styles.btnGhost} onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button className={styles.btnSave} onClick={submit} disabled={saving}>
          {saving ? "Salvando…" : isNew ? "Criar" : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
