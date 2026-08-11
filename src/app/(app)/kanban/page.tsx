"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeSolicitantes,
  subscribeSolicitanteSetores,
  garantirSetorSolicitante,
  garantirSolicitante,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import {
  subscribeCards,
  createCard,
  updateCard,
  deleteCardById,
  moveCard,
  addComment,
  editComment,
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
  type TagRef,
  type CardInput,
  type Priority,
  type ChecklistItem,
  type ColumnDoc,
  type DemandType,
  type Comment,
} from "@/lib/kanban";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { Modal } from "@/components/modal";
import { RelatorioModal } from "./relatorio-modal";
import styles from "./kanban.module.css";

const PRIORITY_COLOR: Record<Priority, string> = {
  alta: "#fb7185",
  media: "#f5b13d",
  baixa: "#78776f",
};
const KNOWN_PRIORITIES: Priority[] = ["alta", "media", "baixa"];

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
}

/**
 * De onde veio cada sugestão do "#".
 *
 * O grupo não muda o que é gravado — tudo vira tag de texto. Ele existe para
 * quem está escolhendo saber o que está escolhendo: "Infra" pode ser a tag que
 * o quadro já usa, o setor solicitante do cadastro, ou nenhum dos dois.
 */
type GrupoSugestao = "tag" | "setor" | "demanda";
type Sugestao = {
  valor: string;
  grupo: GrupoSugestao;
  detalhe?: string;
  /** Presente em setor e demanda: é o que sobrevive ao rename do alvo. */
  ref?: TagRef;
};
const GRUPO_ROTULO: Record<GrupoSugestao, string> = {
  tag: "Tags do quadro",
  setor: "Setores solicitantes",
  demanda: "Demandas do quadro",
};

/** Texto comparável: sem acento e em minúsculas — "Manutenção" acha por "manut". */
function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function parseDue(due: string): Date {
  const [y, m, dd] = due.split("-").map(Number);
  return new Date(y, m - 1, dd);
}
function toStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayStr(): string {
  return toStr(new Date());
}
function plusDays(dateStr: string, n: number): string {
  const d = parseDue(dateStr);
  d.setDate(d.getDate() + n);
  return toStr(d);
}
function fmtShort(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
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
function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return fmtShort(new Date(ts));
}

/**
 * Identidade de um comentário na tela.
 *
 * O `id` só existe nos comentários publicados pelo modal; os que vieram da
 * ingestão de reunião e os mais antigos nasceram sem ele — daí o autor mais a
 * data como reserva, que é única na prática (dois comentários da mesma pessoa
 * no mesmo milissegundo não acontecem).
 */
function chaveComentario(c: Comment): string {
  return c.id ?? `${c.author}|${c.at}`;
}

/** Valor sentinela do filtro de responsável (e-mails sempre têm "@"). */
const NO_ASSIGNEE = "__sem__";

/** Campo de texto que substitui o select enquanto se cadastra um nome novo. */
function NovoCadastro({
  valor,
  onChange,
  onSalvar,
  salvando,
  placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  onSalvar: () => void | Promise<void>;
  salvando: boolean;
  placeholder: string;
}) {
  return (
    <div className={styles.novoCadastroLinha}>
      <input
        className={styles.input}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void onSalvar();
          }
        }}
        placeholder={placeholder}
        maxLength={80}
        autoFocus
      />
      <button
        type="button"
        className={styles.novoCadastroOk}
        onClick={() => void onSalvar()}
        disabled={salvando || !valor.trim()}
        aria-label="Cadastrar"
      >
        <Icon name="check" size={13} />
      </button>
    </div>
  );
}

/**
 * Igualdade tolerante para decidir se um campo do formulário mudou.
 *
 * `undefined`, `null` e `""` contam como o mesmo nada: um card antigo sem
 * `description` não deve gerar escrita só porque o formulário devolve string
 * vazia. Arrays e objetos (tags, checklist) comparam por conteúdo, e a ordem
 * conta — reordenar a checklist É uma mudança.
 */
function mesmoValor(a: unknown, b: unknown): boolean {
  const vazio = (v: unknown) => v === undefined || v === null || v === "";
  if (vazio(a) && vazio(b)) return true;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return a === b;
}

type EditState =
  | { mode: "new"; columnId: string }
  | { mode: "edit"; card: Card }
  | null;
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
  const [cards, setCards] = useState<Card[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [solicitantes, setSolicitantes] = useState<Solicitante[]>([]);
  const [reqSetores, setReqSetores] = useState<SolicitanteSetor[]>([]);
  const [fireColumns, setFireColumns] = useState<ColumnDoc[]>([]);
  const [colsLoaded, setColsLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [prio, setPrio] = useState<"" | Priority>("");
  // O filtro de responsável é preso ao setor: trocar de quadro o descarta.
  const [assigneeSel, setAssigneeSel] = useState({ sector: "", value: "" });
  const [edit, setEdit] = useState<EditState>(null);
  /** Card que outra tela pediu para abrir, enquanto o setor não carregou. */
  const [alvoDireto, setAlvoDireto] = useState<string | null>(null);
  const [colEdit, setColEdit] = useState<ColEditState>(null);
  const [relatorio, setRelatorio] = useState(false);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const seededRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (sectors.length && !sectors.includes(sector)) setSector(sectors[0]);
  }, [sectors, sector]);

  useEffect(() => {
    if (!sector) {
      setCards([]);
      return;
    }
    const u = subscribeCards(sector, setCards, (e) =>
      console.error("Erro ao carregar cards:", e),
    );
    return () => u();
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
    setColsLoaded(false);
    if (!sector) {
      setFireColumns([]);
      return;
    }
    const u = subscribeColumns(
      sector,
      (cols) => {
        setFireColumns(cols);
        setColsLoaded(true);
      },
      (e) => console.error("Erro ao carregar colunas:", e),
    );
    return () => u();
  }, [sector]);

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

  useEffect(() => {
    const u = subscribeUsers(setUsers, () => {});
    return () => u();
  }, []);

  useEffect(() => {
    const a = subscribeSolicitantes(setSolicitantes, () => {});
    const b = subscribeSolicitanteSetores(setReqSetores, () => {});
    return () => {
      a();
      b();
    };
  }, []);

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

  if (!profile) return null;

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
        moveCard(dragCardId, col.colId).catch(console.error);
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

        {/* Empurrado para a direita: o relatório não é um filtro do quadro, é
            a ação que se toma depois de olhar para ele. */}
        <div className={styles.grow} />
        <button
          className={`${styles.filterBtn} ${styles.reportBtn}`}
          onClick={() => setRelatorio(true)}
          title="Montar e enviar o relatório de demandas para o gestor"
        >
          <Icon name="relatorios" size={14} />
          Relatório para gestor
        </button>
      </div>

      <div className={styles.board} key={sector}>
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
                <span className={styles.colTitle}>{col.title}</span>
                <span className={styles.colCount}>{colCards.length}</span>
                <div style={{ flex: 1 }} />
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
                {colCards.length === 0 ? (
                  <div className={styles.colempty}>Nenhuma demanda</div>
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
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}

        {canEditCols && (
          <button
            className={styles.addColBtn}
            onClick={() => setColEdit({ mode: "new" })}
          >
            <Icon name="plus" size={15} /> Nova coluna
          </button>
        )}
        <div style={{ flex: "none", width: 6 }} />
      </div>

      {edit && (
        <CardModal
          state={edit}
          sector={sector}
          columns={displayCols}
          actorEmail={profile.email}
          activeUsers={activeUsers}
          usersMap={usersMap}
          solicitantes={solicitantes}
          reqSetores={reqSetores}
          tagsDoQuadro={tagsDoQuadro}
          demandasDoQuadro={demandasDoQuadro}
          onClose={() => setEdit(null)}
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
}) {
  const di = dueInfo(card.due, entregue);
  const startShort = card.startDate ? fmtShort(parseDue(card.startDate)) : "";
  const aging = col.colId === "aguardando" ? agingDays(card.enteredAt) : 0;
  const items = card.checklist ?? [];
  const done = items.filter((i) => i.done).length;
  const tags = card.tags ?? [];
  const comments = card.comments?.length ?? 0;

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
        <span className={styles.grip}>
          <GripDots />
        </span>
      </div>
      <div className={styles.ktitle}>{card.title}</div>
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
        <div style={{ flex: 1 }} />
        {requester && (
          <span
            className={styles.mini}
            title={`Solicitante: ${requester}${requesterSector ? ` · ${requesterSector}` : ""}`}
          >
            por {requester.split(" ")[0]}
          </span>
        )}
        {assignee && (
          <span
            className={styles.miniAvatar}
            style={{ background: assignee.color || "#555" }}
            title={`Responsável: ${assignee.name}`}
          >
            {(assignee.name?.[0] || "?").toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

function CardModal({
  state,
  sector,
  columns,
  actorEmail,
  activeUsers,
  usersMap,
  solicitantes,
  reqSetores,
  tagsDoQuadro,
  demandasDoQuadro,
  onClose,
}: {
  state: NonNullable<EditState>;
  sector: string;
  columns: ColumnDoc[];
  actorEmail: string;
  activeUsers: UserProfile[];
  usersMap: Record<string, UserProfile>;
  solicitantes: Solicitante[];
  reqSetores: SolicitanteSetor[];
  /** tags já usadas no quadro, da mais usada para a menos, com a contagem */
  tagsDoQuadro: { tag: string; n: number }[];
  /** demandas do quadro, para citar uma existente pelo título */
  demandasDoQuadro: { id: string; title: string; columnId: string }[];
  onClose: () => void;
}) {
  const isNew = state.mode === "new";
  const card = state.mode === "edit" ? state.card : null;

  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [columnId, setColumnId] = useState(
    state.mode === "new" ? state.columnId : state.card.columnId,
  );
  const [type, setType] = useState<DemandType>(card?.type ?? "implementacao");
  const [priority, setPriority] = useState<Priority>(card?.priority ?? "media");
  const [assignee, setAssignee] = useState(card?.assignee ?? "");
  const [requester, setRequester] = useState(card?.requester ?? "");
  const [criando, setCriando] = useState<null | "setor" | "pessoa">(null);
  const [novoNome, setNovoNome] = useState("");
  const [salvandoCadastro, setSalvandoCadastro] = useState(false);
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);
  const [requesterSector, setRequesterSector] = useState(
    card?.requesterSector ?? "",
  );
  const [startDate, setStartDate] = useState(
    card?.startDate ?? (isNew ? todayStr() : ""),
  );
  const [due, setDue] = useState(
    card?.due ?? (isNew ? plusDays(todayStr(), 7) : ""),
  );
  /**
   * Demanda pode nascer sem prazo — e isso é um estado, não um esquecimento.
   *
   * Quando o pedido chega antes de a data existir, exigir um prazo faz alguém
   * inventar um, e prazo inventado vira atraso falso no relatório do gestor.
   * Marcado aqui, o card sai como "sem prazo definido" em toda a leitura.
   */
  const [semPrazo, setSemPrazo] = useState(isNew ? false : !card?.due);
  const [tags, setTags] = useState<string[]>(card?.tags ?? []);
  /** Quais tags são referência. Anda junto de `tags`, ligada pelo texto. */
  const [tagRefs, setTagRefs] = useState<TagRef[]>(card?.tagRefs ?? []);
  const [newTag, setNewTag] = useState("");
  /** Escape fecha a lista de tags sem apagar o que já foi digitado. */
  const [menuTagFechado, setMenuTagFechado] = useState(false);
  const [tagAtiva, setTagAtiva] = useState(0);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() =>
    (card?.checklist ?? []).map((it) => ({ ...it, id: it.id ?? uid() })),
  );
  const [newItem, setNewItem] = useState("");
  const [comments, setComments] = useState<Comment[]>(card?.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  /** Qual comentário está sendo reescrito (chave), e o texto em edição. */
  const [comentarioEmEdicao, setComentarioEmEdicao] = useState<string | null>(
    null,
  );
  const [textoEditado, setTextoEditado] = useState("");
  /**
   * Trava de gravação de comentário.
   *
   * `useRef` e não estado: entre o Ctrl+Enter e o clique em fechar não há
   * re-render que atualize `posting` a tempo, e sem esta trava o mesmo texto
   * era publicado duas vezes.
   */
  const gravandoComentario = useRef(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /**
   * Qual campo travou o salvamento.
   *
   * Sem isto o aviso era só uma linha de 12px no rodapé: numa demanda com
   * checklist o modal passa da altura da tela, o título fica dez rolagens
   * acima — e ele nem parece um campo, é um texto grande sem moldura. O
   * usuário lia "informe um título", não achava título nenhum, e a demanda
   * não saía. Agora o campo é levado até os olhos, marcado, e o aviso some
   * sozinho assim que ele é corrigido.
   */
  const [campoErro, setCampoErro] = useState<null | "titulo" | "prazo">(null);
  const tituloRef = useRef<HTMLInputElement>(null);
  const prazoRef = useRef<HTMLInputElement>(null);

  const col = columns.find((c) => c.colId === columnId);
  const doneCount = checklist.filter((i) => i.done).length;
  const pct = checklist.length
    ? Math.round((doneCount / checklist.length) * 100)
    : 0;

  const columnOptions: SelectOption[] = columns.map((c) => ({
    value: c.colId,
    label: c.title,
    color: c.color,
  }));
  const typeOptions: SelectOption[] = DEMAND_TYPES.map((t) => ({
    value: t,
    label: DEMAND_TYPE_LABEL[t],
    color: DEMAND_TYPE_COLOR[t],
  }));
  const priorityOptions: SelectOption[] = KNOWN_PRIORITIES.map((p) => ({
    value: p,
    label: PRIORITY_LABEL[p],
    color: PRIORITY_COLOR[p],
  }));
  function userOptions(noneLabel: string, current: string): SelectOption[] {
    const opts: SelectOption[] = [{ value: "", label: noneLabel }];
    activeUsers.forEach((u) =>
      opts.push({ value: u.email, label: u.name || u.email, color: u.color }),
    );
    if (current && !activeUsers.some((u) => u.email === current)) {
      const u = usersMap[current];
      opts.push({
        value: current,
        label: (u?.name || current) + " (inativo)",
        color: u?.color,
      });
    }
    return opts;
  }

  // Solicitante e Setor solicitante vêm do CADASTRO (aba Admin), não dos
  // usuários — e são campos independentes: a pessoa não pertence a um setor,
  // então um não filtra nem limpa o outro.
  const reqSetorOptions: SelectOption[] = [
    { value: "", label: "— Não definido —" },
    ...reqSetores.map((s) => ({ value: s.name, label: s.name })),
  ];
  const solicOptions: SelectOption[] = (() => {
    const opts: SelectOption[] = [{ value: "", label: "— Não definido —" }];
    solicitantes.forEach((s) => opts.push({ value: s.name, label: s.name }));
    // valor legado (nome já apagado do cadastro) continua visível para não sumir
    if (requester && !solicitantes.some((s) => s.name === requester)) {
      opts.push({ value: requester, label: requester });
    }
    return opts;
  })();

  /**
   * Cadastra o setor ou o solicitante sem sair do formulário.
   *
   * Quem percebe que o nome não está na lista é quem está preenchendo a
   * demanda. Mandá-lo abrir o Admin e voltar significa, na prática, salvar a
   * demanda sem solicitante. Apagar continua só no Admin — remover um nome em
   * uso deixa cards apontando para algo que não existe mais.
   */
  async function salvarCadastro() {
    const n = novoNome.trim();
    if (!n) return;
    setErroCadastro(null);
    setSalvandoCadastro(true);
    try {
      if (criando === "setor") {
        const nome = await garantirSetorSolicitante(n, reqSetores);
        setRequesterSector(nome);
      } else {
        const nome = await garantirSolicitante(n, solicitantes);
        setRequester(nome);
      }
      setNovoNome("");
      setCriando(null);
    } catch (e) {
      setErroCadastro(
        e instanceof Error ? e.message : "Não foi possível cadastrar.",
      );
    } finally {
      setSalvandoCadastro(false);
    }
  }

  // --- tags: menção com "#" ---------------------------------------------
  //
  // O "#" abre o catálogo do quadro; o que vem depois filtra. Sem isso a mesma
  // tag nascia três vezes ("Smart", "smart", "Smart Meet") e o filtro por tag
  // deixava de encontrar metade das demandas.

  /** O que foi digitado depois do "#" — null quando não há menção aberta. */
  const buscaTag = newTag.trimStart().startsWith("#")
    ? newTag.trimStart().slice(1).trim()
    : null;

  const sugestoesTag = useMemo(() => {
    if (buscaTag === null) return [];
    const q = semAcento(buscaTag);
    // A comparação é toda sem acento e sem maiúscula: é o que impede "Infra",
    // "infra" e "INFRA" de virarem três tags diferentes no mesmo quadro.
    const usadas = new Set(tags.map(semAcento));
    const vistos = new Set<string>();

    /**
     * Filtra um grupo, tira o que já apareceu antes e corta no limite.
     *
     * `vistos` é marcado antes do corte de propósito: se uma tag ficou de fora
     * por limite, o setor de mesmo nome não pode entrar no lugar dela como se
     * fosse outra coisa — na hora de escolher, as duas dariam a mesma tag.
     */
    const pegar = (
      grupo: GrupoSugestao,
      brutos: { valor: string; detalhe?: string; ref?: TagRef }[],
      limite: number,
    ): Sugestao[] => {
      const out: Sugestao[] = [];
      for (const b of brutos) {
        const valor = b.valor.trim();
        const chave = semAcento(valor);
        if (!chave || usadas.has(chave) || vistos.has(chave)) continue;
        vistos.add(chave);
        if (q && !chave.includes(q)) continue;
        out.push({ ...b, valor, grupo });
      }
      // Quem começa com o que foi digitado vem antes de quem só contém: digitar
      // "s" tem de oferecer "Smart" antes de "Requisição do RH". `sort` é
      // estável, então dentro de cada grupo a ordem de origem continua valendo.
      if (q) {
        out.sort(
          (a, b) =>
            Number(semAcento(b.valor).startsWith(q)) -
            Number(semAcento(a.valor).startsWith(q)),
        );
      }
      return out.slice(0, limite);
    };

    const doQuadro = pegar(
      "tag",
      tagsDoQuadro.map((t) => ({
        valor: t.tag,
        detalhe: `${t.n} demanda${t.n === 1 ? "" : "s"}`,
      })),
      6,
    );
    const setores = pegar(
      "setor",
      reqSetores.map((s) => ({
        valor: s.name,
        ref: { tipo: "setor" as const, id: s.id, texto: s.name },
      })),
      6,
    );
    const demandas = pegar(
      "demanda",
      demandasDoQuadro
        // A demanda não se cita: sobraria uma tag com o próprio título.
        .filter((d) => d.id !== card?.id)
        .map((d) => ({
          valor: d.title,
          detalhe: columns.find((c) => c.colId === d.columnId)?.title,
          ref: { tipo: "demanda" as const, id: d.id, texto: d.title },
        })),
      6,
    );
    return [...doQuadro, ...setores, ...demandas];
  }, [
    buscaTag,
    tagsDoQuadro,
    reqSetores,
    demandasDoQuadro,
    columns,
    card?.id,
    tags,
  ]);

  /** A lista está na tela — mesmo vazia, ela explica que o Enter cria a tag. */
  const menuTagVisivel = buscaTag !== null && !menuTagFechado;
  /** Só quando há o que escolher é que as setas e o Enter mudam de comportamento. */
  const menuTagAberto = menuTagVisivel && sugestoesTag.length > 0;
  // O índice é preso à lista a cada render: apagar uma letra encurta as
  // sugestões, e um índice antigo escolheria a tag errada no Enter.
  const idxTag = Math.min(tagAtiva, sugestoesTag.length - 1);

  /**
   * Põe a tag no card — com a referência, quando ela veio da lista.
   *
   * A tag escrita à mão NÃO ganha referência, mesmo que o texto bata com uma
   * demanda existente: quem digitou "Portal" digitou uma palavra, e transformar
   * isso em vínculo faria a palavra mudar sozinha quando a demanda de nome
   * parecido fosse renomeada.
   */
  function incluirTag(t: string, ref?: TagRef) {
    const limpa = t.trim();
    if (!limpa || tags.includes(limpa)) {
      setNewTag("");
      return;
    }
    setTags((cur) => [...cur, limpa]);
    if (ref) setTagRefs((cur) => [...cur, { ...ref, texto: limpa }]);
    setNewTag("");
    setMenuTagFechado(false);
    setTagAtiva(0);
  }
  /** Enter fora do menu: cria a tag digitada, com ou sem o "#" na frente. */
  function addTag() {
    incluirTag(newTag.replace(/^\s*#+/, "").trim());
  }
  function removeTag(t: string) {
    setTags((cur) => cur.filter((x) => x !== t));
    // A referência sai junto: uma `tagRef` sem a tag correspondente é lixo que
    // nada mais resolve, e voltaria a valer se alguém redigitasse o mesmo texto.
    setTagRefs((cur) => cur.filter((r) => r.texto !== t));
  }

  function teclaNaTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && menuTagAberto) {
      // O Escape do modal fecha o diálogo inteiro. Aqui ele só fecha a lista —
      // e o `stopPropagation` é o que impede a demanda de ser perdida.
      e.preventDefault();
      e.stopPropagation();
      setMenuTagFechado(true);
      return;
    }
    if (menuTagAberto && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const passo = e.key === "ArrowDown" ? 1 : -1;
      const n = sugestoesTag.length;
      setTagAtiva((cur) => (Math.min(cur, n - 1) + passo + n) % n);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (menuTagAberto)
        incluirTag(sugestoesTag[idxTag].valor, sugestoesTag[idxTag].ref);
      else addTag();
    }
  }
  function addItem() {
    const t = newItem.trim();
    if (!t) return;
    setChecklist((c) => [...c, { id: uid(), text: t, done: false }]);
    setNewItem("");
  }
  function toggleItem(i: number) {
    setChecklist((c) =>
      c.map((x, idx) => (idx === i ? { ...x, done: !x.done } : x)),
    );
  }
  function editItem(i: number, text: string) {
    setChecklist((c) => c.map((x, idx) => (idx === i ? { ...x, text } : x)));
  }
  function editItemDesc(i: number, desc: string) {
    setChecklist((c) => c.map((x, idx) => (idx === i ? { ...x, desc } : x)));
  }
  function removeItem(i: number) {
    setChecklist((c) => c.filter((_, idx) => idx !== i));
  }

  // --- comentários: escrever basta, o botão não ------------------------
  //
  // Comentário não tem rascunho: ou está gravado, ou não existe. Antes era
  // preciso clicar em "Comentar" — e quem escrevia e fechava o card perdia o
  // texto sem nenhum aviso. Agora fechar o card grava o que estiver escrito,
  // e o Ctrl+Enter continua valendo para quem quer publicar sem sair daqui.

  /** Publica o comentário novo. `false` = não gravou, então não pode fechar. */
  async function publicarComentario(): Promise<boolean> {
    const text = newComment.trim();
    if (!text || !card) return true;
    const comment: Comment = {
      id: uid(),
      author: actorEmail,
      text,
      at: Date.now(),
    };
    try {
      await addComment(card.id, comment);
      setComments((c) => [...c, comment]);
      setNewComment("");
      return true;
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar o comentário.");
      return false;
    }
  }

  /** Grava a reescrita em andamento, se houver alguma. */
  async function salvarEdicaoComentario(): Promise<boolean> {
    if (!card || comentarioEmEdicao === null) return true;
    const alvo = comments.find((c) => chaveComentario(c) === comentarioEmEdicao);
    const text = textoEditado.trim();
    // Apagar tudo não é editar: sem texto, o comentário fica como estava — para
    // remover a fala de alguém não basta esvaziar um campo por acidente.
    if (!alvo || !text || text === alvo.text) {
      setComentarioEmEdicao(null);
      return true;
    }
    try {
      const editedAt = await editComment(
        card.id,
        { id: alvo.id, author: alvo.author, at: alvo.at },
        text,
      );
      setComments((cur) =>
        cur.map((c) =>
          chaveComentario(c) === comentarioEmEdicao
            ? { ...c, text, editedAt }
            : c,
        ),
      );
      setComentarioEmEdicao(null);
      return true;
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar a edição do comentário.");
      return false;
    }
  }

  /** Tudo o que está escrito na área de comentários vai para o banco. */
  async function gravarComentarios(): Promise<boolean> {
    if (gravandoComentario.current) {
      setErr(
        "O comentário ainda está sendo salvo — tente de novo em instantes.",
      );
      return false;
    }
    gravandoComentario.current = true;
    setPosting(true);
    try {
      const editou = await salvarEdicaoComentario();
      const publicou = await publicarComentario();
      return editou && publicou;
    } finally {
      gravandoComentario.current = false;
      setPosting(false);
    }
  }

  /** Abre a reescrita de um comentário sem perder a que já estava aberta. */
  async function abrirEdicaoComentario(chave: string, texto: string) {
    if (comentarioEmEdicao !== null && comentarioEmEdicao !== chave) {
      if (!(await salvarEdicaoComentario())) return;
    }
    setComentarioEmEdicao(chave);
    setTextoEditado(texto);
  }

  /**
   * Fecha o card gravando o comentário escrito.
   *
   * Vale também no "Cancelar" e no Escape: comentário nunca fez parte do
   * formulário — ele já era gravado na hora, direto no card. Cancelar desfaz a
   * edição da demanda, não apaga o que alguém acabou de escrever. Se a gravação
   * falha, o modal FICA ABERTO: fechar aqui seria jogar o texto fora.
   */
  async function fechar() {
    if (!(await gravarComentarios())) return;
    onClose();
  }

  /** Leva o campo que travou o salvamento até os olhos de quem clicou. */
  function cobrar(
    campo: "titulo" | "prazo",
    mensagem: string,
    ref: { current: HTMLInputElement | null },
  ) {
    setErr(mensagem);
    setCampoErro(campo);
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    // `preventScroll` porque a rolagem suave acima já está a caminho: sem ele o
    // foco dá um pulo seco e desfaz o movimento no meio.
    el.focus({ preventScroll: true });
  }

  /** Some com a cobrança assim que o campo cobrado é preenchido. */
  function corrigiu(campo: "titulo" | "prazo") {
    if (campoErro !== campo) return;
    setCampoErro(null);
    setErr(null);
  }

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      cobrar("titulo", "Informe um título.", tituloRef);
      return;
    }
    if (!semPrazo && !due) {
      cobrar(
        "prazo",
        "Informe o prazo de entrega ou marque “sem prazo definido”.",
        prazoRef,
      );
      return;
    }
    setCampoErro(null);
    setSaving(true);
    try {
      const base = {
        title: title.trim(),
        description: description.trim(),
        columnId,
        type,
        assignee: assignee || null,
        requester: requester || null,
        requesterSector: requesterSector || null,
        startDate: startDate || null,
        due: semPrazo ? null : due || null,
        priority,
        tags,
        // Só as referências das tags que sobraram: remover a tag e deixar a
        // referência gravada devolveria o vínculo na próxima edição.
        tagRefs: tagRefs.filter((r) => tags.includes(r.texto)),
        checklist,
      };
      if (isNew) {
        const input: CardInput = base;
        await createCard(sector, input, actorEmail);
      } else if (card) {
        // Só os campos que REALMENTE mudaram. Enviar o formulário inteiro fazia
        // o último a salvar apagar, em silêncio, a edição de quem salvou antes
        // — inclusive em campos que ele nem abriu.
        const atual = card as unknown as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        for (const [campo, valor] of Object.entries(base)) {
          if (!mesmoValor(atual[campo], valor)) patch[campo] = valor;
        }
        if (card.columnId !== columnId) {
          // Trocar de coluna reinicia o aging e joga para o topo.
          patch.order = -Date.now();
          patch.enteredAt = Date.now();
        }
        if (Object.keys(patch).length > 0) {
          // Contador de versão: quem for aplicar mudança automática no futuro
          // precisa saber se o card mudou desde que o leu.
          patch.rev = (card.rev ?? 0) + 1;
          await updateCard(card.id, patch as Partial<Omit<Card, "id">>);
        }
      }
      // O comentário vai junto — e se ele não gravar, o modal fica aberto com o
      // texto na tela. A demanda já está salva; clicar em Salvar de novo só
      // repete a tentativa do comentário.
      if (!(await gravarComentarios())) {
        setSaving(false);
        return;
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar a demanda.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!card) return;
    if (!confirm("Remover esta demanda? Esta ação não pode ser desfeita."))
      return;
    try {
      await deleteCardById(card.id);
      onClose();
    } catch (e) {
      console.error(e);
      setErr("Não foi possível remover.");
    }
  }

  return (
    <Modal
      onClose={() => void fechar()}
      ariaLabel={isNew ? "Nova demanda" : "Editar demanda"}
      overlayClassName={styles.overlay}
      className={styles.modal}
    >
      <div className={styles.mhead}>
        {col && (
          <span className={styles.mchip}>
            <span className={styles.mdot} style={{ background: col.color }} />
            {col.title}
          </span>
        )}
        <span className={styles.mchip}>{sector}</span>
      </div>

      <input
        ref={tituloRef}
        className={`${styles.mtitle} ${campoErro === "titulo" ? styles.mtitleErro : ""}`}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (e.target.value.trim()) corrigiu("titulo");
        }}
        placeholder="Título da demanda"
        aria-label="Título da demanda"
        aria-invalid={campoErro === "titulo"}
        autoFocus
      />
      {campoErro === "titulo" && (
        <div className={styles.campoAviso}>
          Toda demanda começa pelo título — é ele que aparece no card.
        </div>
      )}

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Tipo</label>
          <Select
            value={type}
            options={typeOptions}
            onChange={(v) => setType(v as DemandType)}
            ariaLabel="Tipo da demanda"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Prioridade</label>
          <Select
            value={priority}
            options={priorityOptions}
            onChange={(v) => setPriority(v as Priority)}
            ariaLabel="Prioridade"
          />
        </div>
      </div>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.labelLinha}>
            Setor solicitante
            <button
              type="button"
              className={styles.novoCadastro}
              onClick={() => {
                setCriando(criando === "setor" ? null : "setor");
                setNovoNome("");
                setErroCadastro(null);
              }}
            >
              {criando === "setor" ? "cancelar" : "+ novo"}
            </button>
          </label>
          {criando === "setor" ? (
            <NovoCadastro
              valor={novoNome}
              onChange={setNovoNome}
              onSalvar={salvarCadastro}
              salvando={salvandoCadastro}
              placeholder="Nome do setor…"
            />
          ) : (
            <Select
              value={requesterSector}
              options={reqSetorOptions}
              onChange={setRequesterSector}
              placeholder="— Não definido —"
              ariaLabel="Setor solicitante"
            />
          )}
        </div>
        <div className={styles.field}>
          <label className={styles.labelLinha}>
            Solicitante
            <button
              type="button"
              className={styles.novoCadastro}
              onClick={() => {
                setCriando(criando === "pessoa" ? null : "pessoa");
                setNovoNome("");
                setErroCadastro(null);
              }}
            >
              {criando === "pessoa" ? "cancelar" : "+ novo"}
            </button>
          </label>
          {criando === "pessoa" ? (
            <NovoCadastro
              valor={novoNome}
              onChange={setNovoNome}
              onSalvar={salvarCadastro}
              salvando={salvandoCadastro}
              placeholder="Nome do solicitante…"
            />
          ) : (
            <Select
              value={requester}
              options={solicOptions}
              onChange={setRequester}
              placeholder="— Não definido —"
              ariaLabel="Solicitante"
            />
          )}
        </div>
        {erroCadastro && (
          <div className={styles.err} style={{ gridColumn: "1 / -1" }}>
            {erroCadastro}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Responsável</label>
        <Select
          value={assignee ?? ""}
          options={userOptions("— Ninguém —", assignee ?? "")}
          onChange={setAssignee}
          placeholder="— Ninguém —"
          ariaLabel="Responsável"
        />
      </div>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Início</label>
          <input
            className={styles.inp}
            type="date"
            value={startDate ?? ""}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          {/* `div` e não `label`: o `label` da opção mora aqui dentro, e um
              dentro do outro é ambíguo para o clique e inválido no HTML. */}
          <div className={styles.labelLinha}>
            Prazo de entrega
            <label className={styles.semPrazoOpc}>
              <input
                type="checkbox"
                checked={semPrazo}
                onChange={(e) => {
                  const marcou = e.target.checked;
                  setSemPrazo(marcou);
                  if (marcou) corrigiu("prazo");
                  // Desmarcar devolve uma data usável em vez de campo vazio:
                  // quem desmarca quer prazo, não quer procurar o calendário.
                  setDue(marcou ? "" : plusDays(startDate || todayStr(), 7));
                }}
              />
              sem prazo definido
            </label>
          </div>
          {semPrazo ? (
            <div className={styles.semPrazoAviso}>
              A definir — sai como “sem prazo definido” no relatório
            </div>
          ) : (
            <input
              ref={prazoRef}
              className={`${styles.inp} ${campoErro === "prazo" ? styles.inpErro : ""}`}
              type="date"
              value={due ?? ""}
              onChange={(e) => {
                setDue(e.target.value);
                if (e.target.value) corrigiu("prazo");
              }}
              aria-invalid={campoErro === "prazo"}
              aria-label="Prazo de entrega"
            />
          )}
        </div>
      </div>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Coluna</label>
          <Select
            value={columnId}
            options={columnOptions}
            onChange={setColumnId}
            ariaLabel="Coluna"
          />
        </div>
        <div className={styles.field} />
      </div>

      <div className={styles.sectionLabel}>Tags</div>
      <div className={styles.tagsEdit}>
        {tags.map((t) => (
          <span key={t} className={styles.tagChip}>
            <span className={styles.tagDot} style={{ background: tagColor(t) }} />
            {t}
            <button
              className={styles.tagDel}
              onClick={() => removeTag(t)}
              title="Remover tag"
              aria-label={`Remover tag ${t}`}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <div className={styles.tagBox}>
          <input
            className={styles.tagInput}
            value={newTag}
            onChange={(e) => {
              setNewTag(e.target.value);
              setMenuTagFechado(false);
              setTagAtiva(0);
            }}
            onKeyDown={teclaNaTag}
            onBlur={() => setMenuTagFechado(true)}
            placeholder="# busca tags, setores e demandas"
            aria-label="Adicionar tag"
            role="combobox"
            aria-expanded={menuTagVisivel}
            aria-controls="menu-tags"
            aria-autocomplete="list"
            aria-activedescendant={
              menuTagAberto ? `tag-op-${idxTag}` : undefined
            }
          />
          {menuTagVisivel && (
            <div className={styles.tagMenu} id="menu-tags" role="listbox">
              {sugestoesTag.length === 0 ? (
                <div className={styles.tagMenuVazio}>
                  {buscaTag
                    ? `Nada com “${buscaTag}” em tags, setores ou demandas. Enter cria a tag assim mesmo.`
                    : "Nenhuma tag, setor ou demanda para sugerir. Enter cria a primeira."}
                </div>
              ) : (
                sugestoesTag.map((s, i) => (
                  <Fragment key={`${s.grupo}-${s.valor}`}>
                    {(i === 0 || sugestoesTag[i - 1].grupo !== s.grupo) && (
                      <div className={styles.tagGrupo}>
                        {GRUPO_ROTULO[s.grupo]}
                      </div>
                    )}
                    <button
                      id={`tag-op-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === idxTag}
                      className={`${styles.tagOpcao} ${i === idxTag ? styles.tagOpcaoAtiva : ""}`}
                      // `onMouseDown` prevenido: sem isso o blur do campo fecha
                      // a lista antes de o clique chegar, e escolher com o mouse
                      // simplesmente não funcionava.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setTagAtiva(i)}
                      onClick={() => incluirTag(s.valor, s.ref)}
                    >
                      <span
                        className={styles.tagDot}
                        style={{ background: tagColor(s.valor) }}
                      />
                      <span className={styles.tagOpcaoNome}>{s.valor}</span>
                      {s.detalhe && (
                        <span className={styles.tagOpcaoUso}>{s.detalhe}</span>
                      )}
                    </button>
                  </Fragment>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.sectionLabel}>Descrição</div>
      <textarea
        className={styles.textarea}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Contexto, requisitos, links…"
      />

      <div className={styles.sectionLabel}>
        Checklist
        {checklist.length > 0 ? ` · ${doneCount}/${checklist.length}` : ""}
      </div>
      {checklist.length > 0 && (
        <div className={styles.checkBar} style={{ marginBottom: 10 }}>
          <div className={styles.checkFill} style={{ width: `${pct}%` }} />
        </div>
      )}
      {checklist.map((it, i) => (
        <div key={it.id ?? i} className={styles.checkRow}>
          <div className={styles.checkMain}>
            <input
              type="checkbox"
              className={styles.checkBox}
              checked={it.done}
              onChange={() => toggleItem(i)}
              aria-label={`Concluir item: ${it.text}`}
            />
            <input
              className={`${styles.checkText} ${it.done ? styles.checkDone : ""}`}
              value={it.text}
              onChange={(e) => editItem(i, e.target.value)}
              aria-label="Item do checklist"
            />
            <button
              className={styles.checkDel}
              onClick={() => removeItem(i)}
              title="Remover item"
              aria-label="Remover item"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <input
            className={styles.checkDesc}
            value={it.desc ?? ""}
            onChange={(e) => editItemDesc(i, e.target.value)}
            placeholder="mini descrição (opcional)"
            aria-label="Descrição do item"
          />
        </div>
      ))}
      <div className={styles.checkAdd}>
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Adicionar item…"
          aria-label="Adicionar item ao checklist"
        />
        <button className={styles.checkAddBtn} onClick={addItem}>
          Adicionar
        </button>
      </div>

      {!isNew && (
        <>
          <div className={styles.sectionLabel}>
            Comentários{comments.length ? ` · ${comments.length}` : ""}
          </div>
          <div className={styles.comments}>
            {comments.length === 0 ? (
              <div className={styles.noComments}>Nenhum comentário ainda.</div>
            ) : (
              [...comments]
                .sort((a, b) => a.at - b.at)
                .map((c, i) => {
                  const u = usersMap[c.author];
                  const name = u?.name || c.author;
                  const chave = chaveComentario(c);
                  // Só o autor reescreve o próprio comentário: editar a fala de
                  // outra pessoa mudaria o registro do que ela disse.
                  const meu = c.author === actorEmail;
                  const editando = comentarioEmEdicao === chave;
                  return (
                    <div key={c.id ?? i} className={styles.comment}>
                      <span
                        className={styles.cAvatar}
                        style={{ background: u?.color || "#555" }}
                      >
                        {(name[0] || "?").toUpperCase()}
                      </span>
                      <div className={styles.cBody}>
                        <div className={styles.cHead}>
                          <span className={styles.cName}>
                            {name.split(" ")[0]}
                          </span>
                          <span className={styles.cTime}>
                            {relTime(c.at)}
                            {c.editedAt ? " · editado" : ""}
                          </span>
                          {meu && !editando && (
                            <button
                              type="button"
                              className={styles.cEdit}
                              onClick={() =>
                                void abrirEdicaoComentario(chave, c.text)
                              }
                            >
                              editar
                            </button>
                          )}
                        </div>
                        {editando ? (
                          <>
                            <textarea
                              className={styles.cEditInput}
                              value={textoEditado}
                              onChange={(e) => setTextoEditado(e.target.value)}
                              aria-label="Editar comentário"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  // Só sai da edição; o Escape do modal
                                  // fecharia a demanda inteira.
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setComentarioEmEdicao(null);
                                  return;
                                }
                                if (
                                  e.key === "Enter" &&
                                  (e.metaKey || e.ctrlKey)
                                ) {
                                  e.preventDefault();
                                  void gravarComentarios();
                                }
                              }}
                            />
                            <div className={styles.cEditAcoes}>
                              <button
                                type="button"
                                className={styles.cEdit}
                                onClick={() => void gravarComentarios()}
                                disabled={posting}
                              >
                                {posting ? "salvando…" : "salvar"}
                              </button>
                              <button
                                type="button"
                                className={styles.cEditCancelar}
                                onClick={() => setComentarioEmEdicao(null)}
                                disabled={posting}
                              >
                                descartar edição
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className={styles.cText}>{c.text}</div>
                        )}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
          <div className={styles.commentAdd}>
            <textarea
              className={styles.commentInput}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Escreva um comentário…"
              aria-label="Novo comentário"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void gravarComentarios();
                }
              }}
            />
          </div>
          <div className={styles.commentHint} aria-live="polite">
            {posting
              ? "Salvando comentário…"
              : "Salvo sozinho ao fechar o card — Ctrl+Enter salva agora."}
          </div>
        </>
      )}

      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.mactions}>
        {!isNew && (
          <button className={styles.btnDanger} onClick={remove}>
            <Icon name="trash" size={15} /> Excluir
          </button>
        )}
        <div className={styles.spacer} />
        <button
          className={styles.btnGhost}
          onClick={() => void fechar()}
          disabled={saving || posting}
        >
          Cancelar
        </button>
        <button
          className={styles.btnSave}
          onClick={submit}
          disabled={saving || posting}
        >
          {saving ? "Salvando…" : isNew ? "Criar demanda" : "Salvar"}
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
