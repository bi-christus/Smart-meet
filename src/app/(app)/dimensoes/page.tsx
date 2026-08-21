"use client";

/**
 * A aba Dimensões — a operação vista pela ESTRUTURA, não pelo quadro.
 *
 * O PEDIDO. Reunião com a Direção em 19/08/2026: além do setor, duas categorias
 * novas — dimensões (os antigos "pilares") e subdimensões. A pergunta que o
 * gestor levou para a reunião foi literalmente "cadê o uso de EPI?", e o Kanban
 * não responde: ele é plano, por setor, e uma subdimensão em que ninguém abriu
 * nada simplesmente não existe lá.
 *
 * A DECISÃO DE LAYOUT, que é o coração desta tela. O mockup aprovado era um
 * organograma de cima para baixo. Nele, a árvore da Infra — 5 dimensões, 34
 * subdimensões, 59 demandas — passava de doze mil pixels de largura: ótima
 * projetada numa reunião, inútil para trabalhar. Aqui a árvore está deitada
 * 90°: a PROFUNDIDADE virou indentação (três níveis, recuo fixo) e a
 * RAMIFICAÇÃO virou altura. A página rola para baixo, que é o gesto que todo
 * mundo já faz, e a largura da tela deixa de ser o recurso escasso. As
 * demandas de um galho entram numa grade que embrulha, pelo mesmo motivo.
 *
 * O CARD É O DO KANBAN — o mesmo componente, não um parecido. Ele foi extraído
 * para `components/demanda-card.tsx` nesta frente, e o quadro passou a lê-lo de
 * lá. Card copiado seria duas telas divergindo no primeiro selo novo que
 * alguém acrescentasse ao quadro.
 *
 * A ABA É LEITURA, com dois atalhos de escrita: abrir a demanda (o mesmo modal
 * do Kanban) e criar uma já classificada. Editar continua morando num lugar só.
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { useAsyncData } from "@/lib/use-async-data";
import { juntarFontes } from "@/lib/async-data-core";
import {
  DEFAULT_COLUMNS,
  colunasEntregues,
  subscribeCards,
  subscribeColumns,
  type Card,
  type ColumnDoc,
} from "@/lib/kanban";
import {
  subscribeSolicitantes,
  subscribeSolicitanteSetores,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import {
  ESTADO_LABEL,
  NOME_SEM_DIMENSAO,
  PARADA_DIAS,
  TIPO_LABEL,
  achatar,
  acharNo,
  cardsDoNo,
  filtrarArvore,
  montarArvore,
  subscribeDimensoes,
  type Dimensao,
  type NoDaArvore,
} from "@/lib/dimensoes";
import { dueInfo, estaAtrasada } from "@/lib/prazo-core.ts";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import { DemandaCard } from "@/components/demanda-card";
import { CardModal, type EditState } from "../kanban/card-modal";
import { criarRotulos } from "../kanban/comum";
import styles from "./dimensoes.module.css";

/** Vazias constantes: `?? []` no corpo recria o array e invalida os `useMemo`. */
const SEM_CARDS: Card[] = [];
const SEM_COLUNAS: ColumnDoc[] = [];
const SEM_USERS: UserProfile[] = [];
const SEM_DIMS: Dimensao[] = [];
const SEM_SOLICITANTES: Solicitante[] = [];
const SEM_REQ_SETORES: SolicitanteSetor[] = [];
const NADA_A_FECHAR = () => undefined;

export default function DimensoesPage() {
  const { profile } = useAuth();
  const sectors = useSetoresDaPessoa(profile);
  /**
   * O setor da tela é DERIVADO, não sincronizado por efeito.
   *
   * As outras telas fazem `useEffect(… setSector(sectors[0]))`, e isso custa um
   * render a mais toda vez que o cadastro de setores responde — além de ser
   * exatamente o padrão que o `react-hooks/set-state-in-effect` acusa. Aqui a
   * escolha da pessoa é o ESTADO, e o setor em uso é uma função dela mais a
   * lista: enquanto a escolha não estiver na lista (primeira carga, ou um setor
   * que saiu do cadastro), vale o primeiro. Nada a sincronizar.
   */
  const [escolhido, setEscolhido] = useState("");
  const sector =
    escolhido && sectors.includes(escolhido) ? escolhido : (sectors[0] ?? "");

  /**
   * As assinaturas da aba. Mesma chave por setor do Kanban: trocou de setor,
   * reassina e volta a "ainda não sei" — sem `setState` dentro de efeito para
   * zerar nada, que é o que produz o falso vazio.
   */
  const fCards = useAsyncData<Card>(sector, (onData, onErro) => {
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
  const fDims = useAsyncData<Dimensao>(sector, (onData, onErro) => {
    if (!sector) {
      onData([]);
      return NADA_A_FECHAR;
    }
    return subscribeDimensoes(sector, onData, onErro);
  });
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );
  const fSolicitantes = useAsyncData<Solicitante>("todos", (onData, onErro) =>
    subscribeSolicitantes(onData, onErro),
  );
  const fReqSetores = useAsyncData<SolicitanteSetor>("todos", (onData, onErro) =>
    subscribeSolicitanteSetores(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const dims = fDims.data ?? SEM_DIMS;
  const fireColumns = fCols.data ?? SEM_COLUNAS;
  const users = fUsers.data ?? SEM_USERS;

  /**
   * A tela espera as TRÊS fontes que a desenham — demandas, colunas e a árvore.
   *
   * A árvore entra na conta junto, e não depois: sem ela, o primeiro quadro
   * mostraria todo o setor em "Sem classificação" e depois se reorganizaria
   * sozinho. Quem visse o primeiro quadro leria "ninguém classificou nada".
   */
  const tela = juntarFontes([fCards, fCols, fDims]);
  const reabrir = () => {
    fCards.tentarDeNovo();
    fCols.tentarDeNovo();
    fDims.tentarDeNovo();
  };

  const displayCols: ColumnDoc[] = useMemo(
    () =>
      fireColumns.length
        ? fireColumns
        : DEFAULT_COLUMNS.map((c, i) => ({
            id: `_fb_${c.id}`,
            sector,
            colId: c.id,
            title: c.title,
            color: c.color,
            order: i,
          })),
    [fireColumns, sector],
  );

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);

  const entregues = useMemo(
    () =>
      colunasEntregues(displayCols.map((c) => ({ id: c.colId, title: c.title }))),
    [displayCols],
  );
  /** colId → cor do cadastro, para a barra do galho pintar como o quadro pinta. */
  const coresDasColunas = useMemo(() => {
    const m: Record<string, string> = {};
    displayCols.forEach((c) => (m[c.colId] = c.color));
    return m;
  }, [displayCols]);

  /** O mapa por setor que `montarArvore` espera — aqui só há um setor na tela. */
  const entreguesPorSetorDaTela = useMemo(
    () => ({ [sector]: entregues }),
    [sector, entregues],
  );

  const arvore = useMemo(
    () =>
      montarArvore({
        dims,
        cards,
        entregues: entreguesPorSetorDaTela,
      }),
    [dims, cards, entreguesPorSetorDaTela],
  );

  const [busca, setBusca] = useState("");
  const visivel = useMemo(() => filtrarArvore(arvore, busca), [arvore, busca]);

  /**
   * Quais galhos estão abertos.
   *
   * `null` NÃO é "nenhum": é "ninguém mexeu ainda", e nesse estado vale a regra
   * padrão — dimensão aberta, subdimensão fechada, que é o nível em que a
   * árvore cabe na tela e ainda diz o que há dentro de cada galho.
   *
   * Guardar o padrão como ausência de escolha, em vez de semear um `Set` num
   * efeito quando o setor muda, evita duas coisas: o render a mais da semeadura
   * e o risco de ela rodar de novo num snapshot qualquer, fechando na cara de
   * quem acabou de abrir um galho porque alguém mexeu numa demanda em outro
   * computador.
   */
  const [abertos, setAbertos] = useState<Set<string> | null>(null);
  const estaAberto = (no: NoDaArvore) =>
    abertos ? abertos.has(no.id) : no.nivel === 1;

  const [selecionado, setSelecionado] = useState<string | null>(null);
  const noSelecionado = selecionado ? acharNo(arvore, selecionado) : undefined;

  const [edit, setEdit] = useState<EditState | null>(null);

  const tagsDoQuadro = useMemo(() => {
    const uso = new Map<string, number>();
    cards.forEach((c) =>
      (c.tags ?? []).forEach((t) => uso.set(t, (uso.get(t) ?? 0) + 1)),
    );
    return [...uso.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
      .map(([tag, n]) => ({ tag, n }));
  }, [cards]);
  const demandasDoQuadro = useMemo(
    () => cards.map((c) => ({ id: c.id, title: c.title, columnId: c.columnId })),
    [cards],
  );
  const rotulos = useMemo(
    () => criarRotulos(usersMap, displayCols),
    [usersMap, displayCols],
  );

  const canManage = profile?.role === "admin" || profile?.role === "gestor";
  const totalSubs = arvore.reduce((a, n) => a + n.filhos.length, 0);

  /** O primeiro clique materializa o padrão; daí em diante é o `Set` que manda. */
  function alternar(no: NoDaArvore) {
    setAbertos((atual) => {
      const base =
        atual ?? new Set(achatar(arvore).filter((n) => n.nivel === 1).map((n) => n.id));
      const novo = new Set(base);
      if (novo.has(no.id)) novo.delete(no.id);
      else novo.add(no.id);
      return novo;
    });
  }

  /**
   * id → demanda inteira.
   *
   * A árvore trafega um RECORTE do card (`CardDaArvore`), porque a agregação
   * não precisa de mais do que isso e um módulo puro não deve conhecer o
   * formato inteiro de `/cards`. Quem desenha o card e quem abre o modal
   * precisam do documento completo, e é aqui que ele volta — por id, sem
   * `as Card` em lugar nenhum.
   */
  const porId = useMemo(() => {
    const m = new Map<string, Card>();
    cards.forEach((c) => m.set(c.id, c));
    return m;
  }, [cards]);

  function abrirDemanda(id: string) {
    const c = porId.get(id);
    if (c) setEdit({ mode: "edit", card: c });
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Dimensões</h1>
          <p>
            As demandas do setor organizadas pela estrutura dele: dimensão,
            subdimensão e o que está andando dentro de cada uma — inclusive
            quando não há nada andando.
          </p>
        </div>
      </div>

      <div className={styles.filtros}>
        <div className={styles.sectors}>
          {sectors.map((s) => (
            <button
              key={s}
              className={`${styles.sectorBtn} ${s === sector ? styles.on : ""}`}
              onClick={() => setEscolhido(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className={styles.busca}>
          <Icon name="search" size={14} />
          <input
            className={styles.buscaInp}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar na árvore…"
            aria-label="Procurar dimensão, subdimensão ou demanda"
          />
          {busca && (
            <button
              className={styles.buscaX}
              onClick={() => setBusca("")}
              aria-label="Limpar a busca"
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
        <button
          className={styles.acao}
          onClick={() => setAbertos(new Set(achatar(arvore).map((n) => n.id)))}
        >
          Abrir tudo
        </button>
        <button className={styles.acao} onClick={() => setAbertos(new Set())}>
          Fechar tudo
        </button>
        {!tela.carregando && !tela.erro && (
          <span className={styles.contagem}>
            {arvore.length} {arvore.length === 1 ? "dimensão" : "dimensões"} ·{" "}
            {totalSubs} {totalSubs === 1 ? "subdimensão" : "subdimensões"} ·{" "}
            {cards.length} {cards.length === 1 ? "demanda" : "demandas"}
          </span>
        )}
      </div>

      {/* O setor não tem árvore, mas TEM demandas: a aba funciona mesmo assim —
          tudo aparece em "Sem classificação". O aviso diz o que fazer para ela
          começar a valer a pena, sem impedir o uso. */}
      {!tela.carregando && !tela.erro && dims.length === 0 && cards.length > 0 && (
        <div className={styles.aviso}>
          <Icon name="info" size={16} />
          <div>
            <strong>{sector}</strong> ainda não tem dimensões cadastradas, então
            todas as demandas aparecem juntas em “Sem classificação”.{" "}
            {canManage ? (
              <>
                Cadastre a árvore em <a href="/admin">Admin › Dimensões</a> e o
                formulário da demanda passa a perguntar onde ela entra.
              </>
            ) : (
              <>Peça a um gestor do setor para cadastrar a árvore no Admin.</>
            )}
          </div>
        </div>
      )}

      {tela.erro ? (
        <div className={styles.centro}>
          <ErrorState error={tela.erro} onRetry={reabrir} />
        </div>
      ) : tela.carregando ? (
        <div className={styles.centro}>
          <SkeletonRow rows={6} texto="Carregando a árvore do setor…" />
        </div>
      ) : arvore.length === 0 ? (
        <div className={styles.centro}>
          <EmptyState
            icon="pasta"
            title="Nada para mostrar neste setor"
            description="Não há demanda nem dimensão cadastrada aqui. Assim que a primeira demanda for aberta, ela aparece nesta árvore."
          />
        </div>
      ) : (
        <div className={styles.corpo}>
          <div className={styles.arvore}>
            {visivel.length === 0 ? (
              <EmptyState
                size="compact"
                icon="search"
                title="Nada casa com essa busca"
                description="Nenhuma dimensão, subdimensão ou demanda com esse texto. Limpe a busca para ver a árvore inteira."
              />
            ) : (
              visivel.map((no) => (
                <Ramo
                  key={no.id}
                  no={no}
                  busca={busca}
                  estaAberto={estaAberto}
                  selecionado={selecionado}
                  usersMap={usersMap}
                  entregues={entregues}
                  cores={coresDasColunas}
                  porId={porId}
                  onAlternar={alternar}
                  onSelecionar={setSelecionado}
                  onAbrirDemanda={abrirDemanda}
                  onCriarAqui={(dimensaoId, subdimensaoId) =>
                    setEdit({
                      mode: "new",
                      columnId: displayCols[0]?.colId ?? "backlog",
                      dimensaoId,
                      subdimensaoId,
                    })
                  }
                />
              ))
            )}
          </div>

          <aside className={styles.painel}>
            <Painel
              no={noSelecionado}
              arvore={arvore}
              setor={sector}
              colunas={displayCols}
              entregues={entregues}
              onAbrirDemanda={abrirDemanda}
            />
          </aside>
        </div>
      )}

      {edit && profile && (
        <CardModal
          state={edit}
          sector={sector}
          columns={displayCols}
          canManage={canManage}
          actorEmail={profile.email}
          activeUsers={activeUsers}
          usersMap={usersMap}
          solicitantes={fSolicitantes.data ?? SEM_SOLICITANTES}
          reqSetores={fReqSetores.data ?? SEM_REQ_SETORES}
          tagsDoQuadro={tagsDoQuadro}
          demandasDoQuadro={demandasDoQuadro}
          rotulos={rotulos}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  A árvore                                                                   */
/* -------------------------------------------------------------------------- */

function Ramo({
  no,
  busca,
  estaAberto,
  selecionado,
  usersMap,
  entregues,
  cores,
  porId,
  onAlternar,
  onSelecionar,
  onAbrirDemanda,
  onCriarAqui,
}: {
  no: NoDaArvore;
  busca: string;
  estaAberto: (no: NoDaArvore) => boolean;
  selecionado: string | null;
  usersMap: Record<string, UserProfile>;
  entregues: Set<string>;
  cores: Record<string, string>;
  porId: Map<string, Card>;
  onAlternar: (no: NoDaArvore) => void;
  onSelecionar: (id: string) => void;
  onAbrirDemanda: (id: string) => void;
  onCriarAqui: (dimensaoId: string | null, subdimensaoId: string | null) => void;
}) {
  const temConteudo = no.filhos.length > 0 || no.cards.length > 0;
  // Busca ativa abre o caminho sozinha: fazer a pessoa clicar cinco vezes para
  // ver o resultado do que ela acabou de digitar é fazer a busca pela metade.
  const aberto = busca ? true : estaAberto(no);
  const m = no.metricas;

  return (
    <div className={`${styles.ramo} ${no.nivel === 2 ? styles.n2 : ""}`}>
      <button
        className={`${styles.ramoTopo} ${selecionado === no.id ? styles.sel : ""}`}
        onClick={() => {
          onSelecionar(no.id);
          if (temConteudo) onAlternar(no);
        }}
        aria-expanded={temConteudo ? aberto : undefined}
      >
        {/* O <Icon> não recebe `className`, então quem gira é o wrapper. */}
        {temConteudo ? (
          <span className={`${styles.chev} ${aberto ? styles.chevAberto : ""}`}>
            <Icon name="chevronRight" size={13} />
          </span>
        ) : (
          <span className={styles.chevVazio} />
        )}
        <span className={styles.faixa} style={{ background: no.cor }} />
        <span className={styles.nome}>
          <span className={styles.nomeTx}>{destacar(no.nome, busca)}</span>
          {no.tipo && (
            <span
              className={`${styles.tipo} ${no.tipo === "projeto" ? styles.tipoProjeto : ""}`}
            >
              {TIPO_LABEL[no.tipo]}
            </span>
          )}
          {m.atrasadas > 0 && (
            <span className={`${styles.selo} ${styles.seloAtraso}`}>
              {m.atrasadas} {m.atrasadas === 1 ? "atrasada" : "atrasadas"}
            </span>
          )}
          {m.atrasadas === 0 && no.estado === "parado" && (
            <span className={`${styles.selo} ${styles.seloParado}`}>
              parada há {m.diasSemMovimento} dias
            </span>
          )}
          {no.estado === "vazio" && (
            <span className={`${styles.selo} ${styles.seloVazio}`}>
              nenhuma demanda
            </span>
          )}
          {no.estado === "concluido" && (
            <span className={`${styles.selo} ${styles.seloOk}`}>
              tudo concluído
            </span>
          )}
        </span>
        <span className={styles.metricas}>
          <span className={`${styles.qtd} ${styles.some}`}>
            {m.abertas} em aberto
          </span>
          <Barra no={no} cores={cores} />
          <span className={styles.qtd}>
            {no.tipo === "projeto" && m.pctConcluido !== null
              ? `${m.pctConcluido}%`
              : `${m.total}`}
          </span>
        </span>
      </button>

      {aberto && temConteudo && (
        <div className={styles.filhos}>
          {no.filhos.map((f) => (
            <Ramo
              key={f.id}
              no={f}
              busca={busca}
              estaAberto={estaAberto}
              selecionado={selecionado}
              usersMap={usersMap}
              entregues={entregues}
              cores={cores}
              porId={porId}
              onAlternar={onAlternar}
              onSelecionar={onSelecionar}
              onAbrirDemanda={onAbrirDemanda}
              onCriarAqui={onCriarAqui}
            />
          ))}
          {no.cards.length > 0 && (
            <div className={styles.cards}>
              {no.cards.map((c) => {
                const card = porId.get(c.id);
                if (!card) return null;
                return (
                  <DemandaCard
                    key={card.id}
                    card={card}
                    colId={card.columnId}
                    entregue={entregues.has(card.columnId)}
                    assignee={card.assignee ? usersMap[card.assignee] : undefined}
                    requester={card.requester ?? undefined}
                    requesterSector={card.requesterSector ?? undefined}
                    onClick={() => onAbrirDemanda(card.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* O galho seco, aberto: a subdimensão existe na estrutura e ninguém abriu
          nada nela. É o ponto cego que esta aba existe para mostrar — por isso
          ele ocupa espaço na tela em vez de ser uma linha a menos. */}
      {aberto && !temConteudo && no.nivel === 2 && (
        <div className={styles.filhos}>
          <div className={styles.vazioRamo}>
            <Icon name="prancheta" size={18} />
            <div>
              <strong>Nada foi aberto aqui ainda</strong>
              Esta subdimensão existe na estrutura, mas nenhuma demanda apontou
              para ela.
            </div>
            <button
              className={styles.criarAqui}
              onClick={(e) => {
                e.stopPropagation();
                const [dimId, subId] = no.id.split("/");
                onCriarAqui(dimId, subId === "direto" ? null : subId);
              }}
            >
              Criar demanda aqui
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A barra empilhada por etapa do quadro — a mesma leitura do Kanban, encolhida.
 *
 * A cor sai do CADASTRO da coluna, e não de uma paleta própria: a barra tem de
 * usar exatamente o verde que o setor escolheu para "Concluído", senão a árvore
 * e o quadro pintariam a mesma etapa de cores diferentes.
 */
function Barra({
  no,
  cores,
}: {
  no: NoDaArvore;
  cores: Record<string, string>;
}) {
  const todos = cardsDoNo(no);
  if (todos.length === 0) return <span className={styles.barra} />;
  const porEtapa = new Map<string, number>();
  todos.forEach((c) => porEtapa.set(c.columnId, (porEtapa.get(c.columnId) ?? 0) + 1));
  return (
    <span className={styles.barra}>
      {[...porEtapa.entries()].map(([colId, n]) => (
        <i
          key={colId}
          style={{
            width: `${(n / todos.length) * 100}%`,
            background: cores[colId] ?? "var(--tx-3)",
          }}
        />
      ))}
    </span>
  );
}

/** Marca o trecho que casa com a busca, sem `dangerouslySetInnerHTML`. */
function destacar(texto: string, termo: string) {
  const alvo = termo.trim().toLowerCase();
  if (!alvo) return texto;
  const i = texto.toLowerCase().indexOf(alvo);
  if (i < 0) return texto;
  return (
    <>
      {texto.slice(0, i)}
      <mark>{texto.slice(i, i + alvo.length)}</mark>
      {texto.slice(i + alvo.length)}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  O painel lateral                                                           */
/* -------------------------------------------------------------------------- */

/**
 * O que o gestor pergunta quando olha para um galho.
 *
 * Sem nó selecionado ele responde pelo SETOR INTEIRO, e não fica em branco
 * esperando um clique: a primeira coisa que se quer saber ao abrir a aba é como
 * está o setor, e um painel vazio ao lado de uma árvore cheia lê como quebrado.
 */
function Painel({
  no,
  arvore,
  setor,
  colunas,
  entregues,
  onAbrirDemanda,
}: {
  no: NoDaArvore | undefined;
  arvore: NoDaArvore[];
  setor: string;
  colunas: ColumnDoc[];
  entregues: Set<string>;
  onAbrirDemanda: (id: string) => void;
}) {
  const cards = useMemo(
    () => (no ? cardsDoNo(no) : arvore.flatMap(cardsDoNo)),
    [no, arvore],
  );

  const trilha = useMemo(() => {
    if (!no) return "Setor inteiro";
    if (no.nivel === 1) return setor;
    const mae = arvore.find((d) => no.id.startsWith(`${d.id}/`));
    return `${setor} › ${mae?.nome ?? "—"}`;
  }, [no, arvore, setor]);

  const m = no?.metricas ?? {
    total: cards.length,
    entregues: cards.filter((c) => entregues.has(c.columnId)).length,
    abertas: cards.filter((c) => !entregues.has(c.columnId)).length,
    atrasadas: cards.filter((c) => estaAtrasada(c.due, entregues.has(c.columnId)))
      .length,
    semPrazo: 0,
    proximoPrazo: null,
    diasSemMovimento: null,
    pctConcluido: null,
  };

  const abertas = cards.filter((c) => !entregues.has(c.columnId));

  /** As próximas entregas — a pergunta nº 1 de quem abre esta aba. */
  const proximas = useMemo(
    () =>
      abertas
        .filter((c) => !!c.due)
        .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))
        .slice(0, 6),
    [abertas],
  );
  const atrasadas = useMemo(
    () => proximas.filter((c) => estaAtrasada(c.due, false)),
    [proximas],
  );
  const semPrazo = abertas.filter((c) => !c.due).length;

  /** A distribuição pelo fluxo do quadro: a evolução das demandas do galho. */
  const porEtapa = useMemo(() => {
    const m2 = new Map<string, number>();
    cards.forEach((c) => m2.set(c.columnId, (m2.get(c.columnId) ?? 0) + 1));
    return colunas
      .map((col) => ({
        colId: col.colId,
        titulo: col.title,
        cor: col.color,
        n: m2.get(col.colId) ?? 0,
      }))
      .filter((e) => e.n > 0);
  }, [cards, colunas]);

  const pct = m.total ? Math.round((m.entregues / m.total) * 100) : null;

  return (
    <>
      <div className={styles.bloco}>
        <div className={styles.pTrilha}>{trilha}</div>
        <div className={styles.pNome}>
          <i style={{ background: no?.cor ?? "var(--brand)" }} />
          {no?.nome ?? setor}
        </div>
        <div className={styles.pEstado}>
          {no ? ESTADO_LABEL[no.estado] : "visão do setor inteiro"}
          {m.diasSemMovimento !== null && m.abertas > 0 && (
            <>
              {" · "}
              {m.diasSemMovimento === 0
                ? "mexeram hoje"
                : `último movimento há ${m.diasSemMovimento} ${m.diasSemMovimento === 1 ? "dia" : "dias"}`}
              {m.diasSemMovimento >= PARADA_DIAS ? " — parada" : ""}
            </>
          )}
        </div>

        <div className={styles.grade}>
          <div className={styles.cel}>
            <div className={styles.celV}>{m.abertas}</div>
            <div className={styles.celL}>em aberto</div>
          </div>
          <div className={`${styles.cel} ${m.atrasadas ? styles.celRuim : ""}`}>
            <div className={styles.celV}>{m.atrasadas}</div>
            <div className={styles.celL}>atrasadas</div>
          </div>
          <div className={`${styles.cel} ${m.entregues ? styles.celBom : ""}`}>
            <div className={styles.celV}>{m.entregues}</div>
            <div className={styles.celL}>
              concluídas{pct !== null ? ` · ${pct}%` : ""}
            </div>
          </div>
          <div className={styles.cel}>
            <div className={styles.celV}>{semPrazo}</div>
            <div className={styles.celL}>sem prazo definido</div>
          </div>
        </div>
      </div>

      <div className={styles.bloco}>
        <div className={styles.blocoTit}>
          <Icon name="trend" size={13} /> Evolução pelo quadro
        </div>
        {porEtapa.length === 0 ? (
          <div className={styles.pVazio}>
            Nenhuma demanda aqui dentro — não há fluxo para mostrar.
          </div>
        ) : (
          <>
            <div className={styles.fluxo}>
              {porEtapa.map((e) => (
                <i
                  key={e.colId}
                  style={{
                    width: `${(e.n / cards.length) * 100}%`,
                    background: e.cor,
                  }}
                  title={`${e.titulo}: ${e.n}`}
                />
              ))}
            </div>
            <div className={styles.legenda}>
              {porEtapa.map((e) => (
                <div key={e.colId} className={styles.legItem}>
                  <i style={{ background: e.cor }} />
                  <span>{e.titulo}</span>
                  <b>{e.n}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={styles.bloco}>
        <div className={styles.blocoTit}>
          <Icon name="calendar" size={13} /> Próximas entregas
        </div>
        {proximas.length === 0 ? (
          <div className={styles.pVazio}>
            {abertas.length === 0
              ? "Nada em aberto por aqui."
              : `As ${abertas.length} demandas em aberto estão sem prazo definido.`}
          </div>
        ) : (
          proximas.map((c) => {
            const di = dueInfo(c.due, false);
            return (
              <button
                key={c.id}
                className={styles.linhaDem}
                onClick={() => onAbrirDemanda(c.id)}
              >
                <span className={styles.linhaTit}>{c.title}</span>
                <span
                  className={`${styles.linhaData} ${
                    di?.tone === "late"
                      ? styles.linhaLate
                      : di?.tone === "soon"
                        ? styles.linhaSoon
                        : ""
                  }`}
                >
                  {di?.label}
                </span>
              </button>
            );
          })
        )}
        {atrasadas.length > 0 && (
          <div className={styles.pEstado}>
            {atrasadas.length} {atrasadas.length === 1 ? "delas já" : "delas já"}{" "}
            {atrasadas.length === 1 ? "passou" : "passaram"} do prazo.
          </div>
        )}
      </div>

      {!no && (
        <div className={styles.bloco}>
          <div className={styles.blocoTit}>
            <Icon name="info" size={13} /> Como usar
          </div>
          <div className={styles.pVazio}>
            Clique numa dimensão ou subdimensão da árvore e este painel passa a
            responder por ela. O nó “{NOME_SEM_DIMENSAO}”, no fim da lista,
            junta o que ainda não foi classificado.
          </div>
        </div>
      )}
    </>
  );
}
