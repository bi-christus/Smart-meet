"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { useSetoresDaPessoa } from "@/lib/setores";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import {
  subscribeCards,
  subscribeColumns,
  columnsBySector,
  deliveredBySector,
  viva,
  type Card,
  type ColumnDoc,
} from "@/lib/kanban";
import { subscribeDimensoes, type Dimensao } from "@/lib/dimensoes";
import {
  ESTADOS_NA_ATA,
  ESTADO_LABEL,
  STATUS_TAREFA,
  STATUS_TAREFA_LABEL,
  abrirProxima,
  deleteAta,
  montarPauta,
  proximoIdDeItem,
  resumoDaAta,
  salvarItens,
  subscribeAtas,
  tarefaNova,
  type Ata,
  type EstadoNaAta,
  type ItemDaPauta,
  type ItemDeAta,
  type StatusTarefa,
  type TarefaDeAta,
} from "@/lib/ata";
import { subscribeMeetings, type Meeting } from "@/lib/meetings";
import { fmtDayMonth, startOfDay, toISO } from "@/lib/datas";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { Select, type SelectOption } from "@/components/select";
import { Modal } from "@/components/modal";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import styles from "./ata.module.css";

/**
 * Ata — a reunião organizada por DEMANDA, com a dimensão ao lado.
 *
 * POR QUE ESTA TELA EXISTE. A ata da reunião das cantinas registrou a queixa
 * que a originou: o grupo saía das reuniões "sem nada para fazer amanhã", as
 * pautas se misturavam e nada ficava medido. Registrou também a divergência
 * sobre o formato — organizar pelas dimensões, ou pelas demandas com a dimensão
 * ao lado — e prevaleceu a segunda, para que cada participante saísse com
 * tarefa no nome. Esta tela é essa decisão desenhada.
 *
 * ELA NÃO CRIA DEMANDA. A pauta sai do quadro do setor, ao vivo; o que a ata
 * guarda é o que a REUNIÃO produziu — decisão, objetivo para a próxima, e as
 * tarefas derivadas. A separação está escrita em `ata-core.ts` e vale como
 * regra: o que é decisão fica na ata, o que é estado vem do card. Demanda nova
 * continua nascendo no Kanban, que é onde ela é acompanhada.
 *
 * O QUE O ISOLAMENTO POR SETOR GARANTE: a ata das Cantinas não aparece para o
 * B.I. e vice-versa. Quem garante não é esta tela — é `firestore.rules`,
 * escopado por `setor` como todo o resto. Aqui a barra de quadros só oferece os
 * setores que a pessoa já enxerga.
 */

const SEM_CARDS: Card[] = [];
const SEM_COLS: ColumnDoc[] = [];
const SEM_ATAS: Ata[] = [];
const SEM_USERS: UserProfile[] = [];
const SEM_DIMS: Dimensao[] = [];
const SEM_REUNIOES: Meeting[] = [];

/** A cor de cada estado, na mesma ordem de gravidade da pauta. */
const COR_ESTADO: Record<EstadoNaAta, string> = {
  atrasada: "var(--danger, #fb7185)",
  andamento: "#f5b13d",
  pendente: "#c084fc",
  concluida: "#34d399",
  // Cinza, e o único da paleta que não é uma cor de alerta: registro não pede
  // ação de ninguém. Ele acender igual aos outros ensinaria a ignorar todos.
  registro: "#8b93a7",
};

export default function AtaPage() {
  const { profile } = useAuth();
  const sectors = useSetoresDaPessoa(profile);

  const [quadroSel, setQuadroSel] = useState("");
  /** Setor guardado que saiu da lista volta para o primeiro — ver o Dashboard. */
  const setor = sectors.includes(quadroSel) ? quadroSel : (sectors[0] ?? "");

  const fCards = useAsyncData<Card>(setor, (onData, onErro) =>
    subscribeCards(setor, onData, onErro),
  );
  const fCols = useAsyncData<ColumnDoc>(setor, (onData, onErro) =>
    subscribeColumns(setor, onData, onErro),
  );
  const fAtas = useAsyncData<Ata>(setor, (onData, onErro) =>
    subscribeAtas(setor, onData, onErro),
  );
  const fDims = useAsyncData<Dimensao>(setor, (onData, onErro) =>
    subscribeDimensoes(setor, onData, onErro),
  );
  /**
   * As reuniões de TODOS os setores da pessoa, e não só o do quadro na tela.
   *
   * É o que permite gerar em Cantinas a ata de uma reunião que correu no B.I. —
   * o caso literal da primeira: o áudio subiu pelo setor de quem gravou, e o
   * assunto pertence a outro. Filtrar pelo setor da aba esconderia justamente a
   * reunião que se quer.
   */
  const fReunioes = useAsyncData<Meeting>(sectors.join("|"), (onData, onErro) =>
    subscribeMeetings(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const cols = fCols.data ?? SEM_COLS;
  const atas = fAtas.data ?? SEM_ATAS;
  const dims = fDims.data ?? SEM_DIMS;
  const users = fUsers.data ?? SEM_USERS;
  const reunioes = fReunioes.data ?? SEM_REUNIOES;

  const [ataSel, setAtaSel] = useState("");
  const [gerarAberta, setGerarAberta] = useState(false);
  const [proximaAberta, setProximaAberta] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroEscrita, setErroEscrita] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [fEstado, setFEstado] = useState<"" | EstadoNaAta>("");
  const [fResp, setFResp] = useState("");
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const nomeDe = (email: string) => usersMap[email]?.name ?? email;

  /** A ata na tela: a escolhida, ou a mais recente. */
  const ata = atas.find((a) => a.id === ataSel) ?? atas[0];

  const entregues = useMemo(
    () => deliveredBySector(columnsBySector(cols, setor ? [setor] : [])),
    [cols, setor],
  );

  const hoje = useMemo(() => startOfDay().getTime(), []);

  /**
   * As demandas vivas do quadro — a lixeira fica de fora.
   *
   * `viva` é o mesmo filtro do Kanban. Sem ele, uma demanda excluída
   * continuaria na pauta da reunião seguinte, e ninguém entenderia por que ela
   * some do quadro e não da ata.
   */
  const cardsVivos = useMemo(() => cards.filter(viva), [cards]);

  const pauta = useMemo(
    () =>
      ata
        ? montarPauta({
            cards: cardsVivos,
            ata,
            dimensoes: dims,
            entregues,
            hoje,
          })
        : [],
    [ata, cardsVivos, dims, entregues, hoje],
  );

  const resumo = useMemo(() => resumoDaAta(pauta), [pauta]);

  const pautaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pauta.filter(
      (l) =>
        (!q ||
          l.titulo.toLowerCase().includes(q) ||
          l.item.tarefas.some((t) => t.texto.toLowerCase().includes(q))) &&
        (!fEstado || l.estado === fEstado) &&
        (!fResp ||
          l.card?.assignee === fResp ||
          l.item.tarefas.some((t) => t.responsavel === fResp)),
    );
  }, [pauta, busca, fEstado, fResp]);

  /** Só quem tem demanda ou tarefa nesta ata entra no filtro. */
  const responsaveis = useMemo(() => {
    const set = new Set<string>();
    pauta.forEach((l) => {
      if (l.card?.assignee) set.add(l.card.assignee);
      l.item.tarefas.forEach((t) => t.responsavel && set.add(t.responsavel));
    });
    return [...set].sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauta, usersMap]);

  /**
   * Grava um item da pauta — e é o ÚNICO caminho de escrita da tabela.
   *
   * Todas as edições da tela passam por aqui: decisão, objetivo, marca de
   * próxima reunião, tarefa criada, mudada ou removida. Um caminho só é o que
   * garante que o array gravado seja sempre o array inteiro e coerente — ver o
   * cabeçalho de `ata.ts` sobre por que os itens moram dentro do documento.
   *
   * A CHAVE É O `id` DO ITEM, e não mais o `cardId`. A troca veio junto com o
   * item sem card: com `cardId` vazio em mais de uma linha, a busca por ele
   * acharia sempre a primeira e a edição de um assunto cairia em outro. A linha
   * que ainda não foi tocada chega aqui com o item fantasma que `montarPauta`
   * criou — dele só se aproveita o `cardId`, porque o `id` verdadeiro ainda não
   * existe e é agora que ele nasce.
   */
  async function gravarItem(base: ItemDeAta, muda: (i: ItemDeAta) => ItemDeAta) {
    if (!ata) return;
    const existe = ata.itens.some((i) => i.id === base.id);
    const novo = muda(
      existe ? ata.itens.find((i) => i.id === base.id)! : { ...base, id: proximoIdDeItem(ata.itens) },
    );
    const itens = existe
      ? ata.itens.map((i) => (i.id === base.id ? novo : i))
      : [...ata.itens, novo];
    try {
      setErroEscrita(null);
      await salvarItens(ata.id, itens);
    } catch (e) {
      setErroEscrita(
        e instanceof Error ? e.message : "Não foi possível salvar a ata.",
      );
    }
  }

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Ata</h1>
          </div>
        </div>
        <div className={styles.vazioTela}>
          Você ainda não participa de nenhum setor. Peça ao administrador para
          incluí-lo em um.
        </div>
      </div>
    );
  }

  const fontes = juntarFontes([fCards, fCols, fAtas]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Ata — {setor}</h1>
          <p>
            A reunião organizada por demanda: o que foi decidido, o que fica de
            tarefa e o que vai para a próxima. A pauta sai da reunião gravada.
          </p>
        </div>
        <button className={styles.novaBtn} onClick={() => setGerarAberta(true)}>
          <Icon name="reunioes" size={15} /> Gerar da reunião
        </button>
      </div>

      {sectors.length > 1 && (
        <div className={styles.quadros}>
          {sectors.map((s) => (
            <button
              key={s}
              className={`${styles.quadroBtn} ${s === setor ? styles.quadroOn : ""}`}
              onClick={() => {
                setQuadroSel(s);
                // A ata é de um setor; carregar a escolha para o próximo faria a
                // tela pedir um documento que a regra do Firestore vai negar.
                setAtaSel("");
              }}
              aria-pressed={s === setor}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {erroEscrita && (
        <div className={styles.avisoErro} role="alert">
          <Icon name="warn" size={14} />
          <span>{erroEscrita}</span>
          <button onClick={() => setErroEscrita(null)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {fontes.erro ? (
        <ErrorState
          error={fontes.erro}
          onRetry={() => {
            fCards.tentarDeNovo();
            fCols.tentarDeNovo();
            fAtas.tentarDeNovo();
          }}
        />
      ) : fontes.carregando ? (
        <div className={styles.corpo}>
          <SkeletonRow rows={8} texto="Carregando a ata…" />
        </div>
      ) : !ata ? (
        /* "Ainda não respondeu" e "respondeu e está vazio" são telas diferentes
           (AGENTS.md §3), e este é o segundo caso: o setor não tem ata nenhuma. */
        <div className={styles.corpo}>
          <EmptyState
            icon="reunioes"
            title="Nenhuma ata neste setor"
            description="Escolha uma reunião já processada: o sistema monta a pauta a partir dos pontos importantes que ela gerou, e junta as demandas do quadro."
            action={
              <button className={styles.novaBtn} onClick={() => setGerarAberta(true)}>
                <Icon name="reunioes" size={15} /> Gerar da reunião
              </button>
            }
          />
        </div>
      ) : (
        <div className={styles.corpo}>
          <aside className={styles.lateral}>
            <section className={styles.painel}>
              <div className={styles.painelHead}>
                <h2>
                  <Icon name="calendar" size={14} /> Resumo da reunião
                </h2>
              </div>
              {/* A escolha da reunião mora AQUI, e não no cabeçalho da página:
                  ela é a primeira linha do resumo, que é o bloco que descreve
                  qual reunião está na tela. */}
              <div className={styles.campo}>
                <span>Reunião</span>
                <Select
                  value={ata.id}
                  options={atas.map(
                    (a): SelectOption => ({
                      value: a.id,
                      label: a.data ? `${a.titulo} · ${fmtDayMonth(a.data)}` : a.titulo,
                    }),
                  )}
                  onChange={setAtaSel}
                  ariaLabel="Reunião"
                />
              </div>
              <Linha rotulo="Data" valor={ata.data ? fmtDayMonth(ata.data) : "—"} />
              <Linha
                rotulo="Horário"
                valor={
                  ata.horaInicio || ata.horaFim
                    ? `${ata.horaInicio || "—"} – ${ata.horaFim || "—"}`
                    : "—"
                }
              />
              <Linha rotulo="Local" valor={ata.local || "—"} />
              <Linha
                rotulo="Facilitador"
                valor={ata.facilitador ? nomeDe(ata.facilitador) : "—"}
              />
              {/* Citados NÃO é participantes, e por isso é outra linha: são os
                  nomes que a gravação ouviu, gente que pode nem ter conta no
                  app. Ver o comentário do campo em `ata-core`. */}
              {ata.citados.length > 0 && (
                <Linha rotulo="Citados na conversa" valor={ata.citados.join(", ")} />
              )}
              <div className={styles.campo}>
                <span>Participantes</span>
                {ata.participantes.length === 0 ? (
                  <div className={styles.valor}>—</div>
                ) : (
                  <div className={styles.rostos}>
                    {ata.participantes.slice(0, 5).map((e) => (
                      <Avatar
                        key={e}
                        pessoa={usersMap[e] ?? { name: nomeDe(e), email: e }}
                        size={28}
                      />
                    ))}
                    {ata.participantes.length > 5 && (
                      <span className={styles.maisRostos}>
                        +{ata.participantes.length - 5}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className={styles.painel}>
              <div className={styles.painelHead}>
                <h2>
                  <Icon name="kanban" size={14} /> Demandas em aberto
                </h2>
              </div>
              {/* A ordem vem de `ESTADOS_NA_ATA`, no core, e não de um array
                  literal aqui: o filtro logo abaixo usa a mesma lista, e quando
                  "registro" nasceu os dois teriam de ser lembrados. */}
              {ESTADOS_NA_ATA.map((e) => (
                  <button
                    key={e}
                    className={`${styles.contagem} ${fEstado === e ? styles.contagemOn : ""}`}
                    onClick={() => setFEstado(fEstado === e ? "" : e)}
                    aria-pressed={fEstado === e}
                    title={`Ver só as demandas com estado "${ESTADO_LABEL[e]}"`}
                  >
                    <span className={styles.dot} style={{ background: COR_ESTADO[e] }} />
                    <span className={styles.contagemNome}>{ESTADO_LABEL[e]}</span>
                  <b>{resumo.porEstado[e]}</b>
                </button>
              ))}
              <div className={styles.total}>
                <span>Total de demandas em aberto</span>
                <b>{resumo.emAberto}</b>
              </div>
              {resumo.tarefas > 0 && (
                <div className={styles.total}>
                  <span>Tarefas concluídas</span>
                  <b>
                    {resumo.tarefasFeitas}
                    <em>/{resumo.tarefas}</em>
                  </b>
                </div>
              )}
            </section>

            <div className={styles.lateralAcoes}>
              <button
                className={styles.acaoSec}
                onClick={() => setProximaAberta(true)}
                title="Abrir a próxima ata já com os itens marcados"
              >
                <Icon name="calendar" size={14} /> Abrir próxima reunião
              </button>
              <button
                className={styles.acaoPerigo}
                onClick={() => setApagando(true)}
              >
                <Icon name="trash" size={14} /> Excluir esta ata
              </button>
            </div>
          </aside>

          <main className={styles.principal}>
            <div className={styles.filtros}>
              <div className={styles.buscawrap}>
                <Icon name="search" size={15} />
                <input
                  className={styles.busca}
                  placeholder="Buscar demanda ou tarefa…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <div className={styles.filtro}>
                <Select
                  value={fEstado}
                  options={[
                    { value: "", label: "Todas as demandas" },
                    ...ESTADOS_NA_ATA.map((e) => ({
                      value: e,
                      label: `${ESTADO_LABEL[e]} (${resumo.porEstado[e]})`,
                      color: COR_ESTADO[e],
                    })),
                  ]}
                  onChange={(v) => setFEstado(v as "" | EstadoNaAta)}
                  ariaLabel="Estado da demanda"
                />
              </div>
              <div className={styles.filtro}>
                <Select
                  value={fResp}
                  options={[
                    { value: "", label: "Todos os responsáveis" },
                    ...responsaveis.map((e) => ({
                      value: e,
                      label: nomeDe(e),
                      color: usersMap[e]?.color,
                    })),
                  ]}
                  onChange={setFResp}
                  ariaLabel="Responsável"
                />
              </div>
            </div>

            {pautaFiltrada.length === 0 ? (
              <EmptyState
                icon="kanban"
                title={
                  pauta.length === 0
                    ? "O quadro deste setor não tem demanda em aberto"
                    : "Nenhuma demanda com esses filtros"
                }
                description={
                  pauta.length === 0
                    ? "A pauta sai das demandas do Kanban. Crie uma demanda lá e ela aparece aqui."
                    : "Tire um dos filtros para ver o resto da pauta."
                }
              />
            ) : (
              pautaFiltrada.map((linha) => (
                <BlocoDaDemanda
                  key={linha.item.id}
                  linha={linha}
                  nomeDe={nomeDe}
                  usersMap={usersMap}
                  recolhido={recolhidos.has(linha.item.id)}
                  onRecolher={() =>
                    setRecolhidos((cur) => {
                      const n = new Set(cur);
                      if (n.has(linha.item.id)) n.delete(linha.item.id);
                      else n.add(linha.item.id);
                      return n;
                    })
                  }
                  onGravar={(muda) => gravarItem(linha.item, muda)}
                />
              ))
            )}
          </main>
        </div>
      )}

      {gerarAberta && (
        <ModalDeGerar
          setor={setor}
          setores={sectors}
          reunioes={reunioes}
          carregando={juntarFontes([fReunioes]).carregando}
          onFechar={() => setGerarAberta(false)}
          onGerado={(id, setorDestino) => {
            // A ata pode ter nascido em OUTRO setor — é o caso normal, não a
            // exceção. Trocar o quadro junto é o que faz o botão terminar
            // mostrando a ata que ele acabou de criar, em vez de deixar a
            // pessoa procurando por ela numa aba que não a contém.
            if (setorDestino !== setor) setQuadroSel(setorDestino);
            setAtaSel(id);
            setGerarAberta(false);
          }}
        />
      )}

      {proximaAberta && ata && (
        <ModalDeAta
          titulo="Abrir a próxima reunião"
          setor={setor}
          users={users}
          /* Os itens marcados como "levar para a próxima" já vêm junto — o
             cabeçalho é o que falta preencher. */
          aviso={`${ata.itens.filter((i) => i.proximaReuniao).length} item(ns) marcado(s) serão levados, com as tarefas ainda abertas.`}
          inicial={{
            titulo: ata.titulo,
            local: ata.local,
            facilitador: ata.facilitador,
            participantes: ata.participantes,
          }}
          onFechar={() => setProximaAberta(false)}
          onCriar={async (dados) => {
            const id = await abrirProxima(ata, dados, profile.email);
            setAtaSel(id);
            setProximaAberta(false);
          }}
        />
      )}

      {apagando && ata && (
        <Modal
          onClose={() => setApagando(false)}
          ariaLabel="Excluir esta ata"
          overlayClassName={styles.overlay}
          className={styles.modal}
          width={430}
        >
          <div className={styles.mhead}>
            <span className={styles.mchip}>
              <Icon name="trash" size={12} /> Ata
            </span>
            <span className={styles.mchip}>{setor}</span>
          </div>
          <h2 className={styles.mtitulo}>{ata.titulo}</h2>
          <p className={styles.confirma}>
            <strong>Excluir esta ata?</strong> Ela some para todo o setor, com as
            decisões e as tarefas registradas nela.
          </p>
          <p className={styles.confirma}>
            As demandas do quadro NÃO são tocadas — a ata é o registro da
            reunião, não a dona delas.
          </p>
          <div className={styles.macoes}>
            <button className={styles.btnGhost} onClick={() => setApagando(false)} autoFocus>
              Manter a ata
            </button>
            <button
              className={styles.btnPerigo}
              onClick={async () => {
                await deleteAta(ata.id);
                setAtaSel("");
                setApagando(false);
              }}
            >
              Excluir
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className={styles.campo}>
      <span>{rotulo}</span>
      <div className={styles.valor}>{valor}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O bloco de uma demanda
// ---------------------------------------------------------------------------

/**
 * Uma demanda na pauta: o que se decidiu, o que se espera, e o que ficou.
 *
 * DECISÃO E OBJETIVO SÃO EDITADOS NO LUGAR, não num modal. A tela é preenchida
 * DURANTE a reunião, e um modal por campo custa dois cliques e tapa o resto da
 * pauta justo quando alguém está lendo em voz alta a demanda seguinte. Salvam
 * no `blur`: quem sai do campo já disse que terminou de escrever.
 */
function BlocoDaDemanda({
  linha,
  nomeDe,
  usersMap,
  recolhido,
  onRecolher,
  onGravar,
}: {
  linha: ItemDaPauta;
  nomeDe: (email: string) => string;
  usersMap: Record<string, UserProfile>;
  recolhido: boolean;
  onRecolher: () => void;
  onGravar: (muda: (i: ItemDeAta) => ItemDeAta) => void;
}) {
  const { card, item, titulo, descricao, estado, numero, dimensao, subdimensao } =
    linha;
  const [decisao, setDecisao] = useState(item.decisao);
  const [objetivo, setObjetivo] = useState(item.objetivo);

  /**
   * O texto do banco só sobrescreve o rascunho quando eles DIVERGEM de verdade.
   *
   * O campo é não-controlado enquanto se digita (estado local) e volta a seguir
   * a ata quando o snapshot traz outro valor. Sem esta comparação, cada
   * snapshot do Firestore — inclusive o eco da própria escrita — devolveria o
   * cursor para o fim do campo no meio da digitação de outra pessoa.
   */
  const [ecoDecisao, setEcoDecisao] = useState(item.decisao);
  if (item.decisao !== ecoDecisao) {
    setEcoDecisao(item.decisao);
    setDecisao(item.decisao);
  }
  const [ecoObjetivo, setEcoObjetivo] = useState(item.objetivo);
  if (item.objetivo !== ecoObjetivo) {
    setEcoObjetivo(item.objetivo);
    setObjetivo(item.objetivo);
  }

  /**
   * A altura do campo acompanha o texto — a ata é lida muito mais vezes do que
   * escrita.
   *
   * As duas linhas fixas bastavam enquanto a decisão era digitada durante a
   * reunião, com o cronômetro correndo: ninguém escreve um parágrafo assim. A
   * decisão que vem do documento da reunião é bem mais longa, e duas linhas a
   * cortavam no meio de uma palavra — escondendo o campo mais importante da
   * tela atrás de uma barra de rolagem que ninguém vê.
   *
   * Conta de linha em vez de auto-resize: medir o textarea de verdade pede um
   * efeito lendo `scrollHeight` a cada render, e isso é trabalho de layout em
   * cima de uma lista inteira que já redesenha junto. O teto de 8 segura o
   * bloco; passou disso, a rolagem volta e a alça do canto continua lá.
   */
  const alturaDe = (texto: string) =>
    Math.min(8, Math.max(2, Math.ceil(texto.length / 38)));

  return (
    <section className={styles.bloco}>
      <div className={styles.blocoTopo}>
        <div className={styles.demanda}>
          {/* "Demanda" só quando é demanda. O assunto que a reunião discutiu e
              que ainda não virou card é ASSUNTO — chamá-lo de demanda faria a
              ata prometer um card que não existe no quadro. */}
          <div className={styles.demandaRot}>
            {card ? "Demanda" : "Assunto"} · {numero}
          </div>
          <h3>{titulo}</h3>
          {descricao && <p>{descricao}</p>}
          {(dimensao || subdimensao) && (
            <span className={styles.area}>
              {/* A dimensão é CLASSIFICADOR, e vai ao lado — nunca por cima. É a
                  decisão registrada na ata que originou esta tela. */}
              {dimensao}
              {subdimensao ? ` · ${subdimensao}` : ""}
            </span>
          )}
        </div>

        <div className={styles.coluna}>
          <div className={styles.colunaRot}>Status da demanda</div>
          <span
            className={styles.selo}
            style={{
              background: `color-mix(in srgb, ${COR_ESTADO[estado]} 16%, transparent)`,
              color: `color-mix(in srgb, ${COR_ESTADO[estado]} 62%, var(--tx))`,
            }}
          >
            {ESTADO_LABEL[estado]}
          </span>
          {card?.assignee && (
            <div className={styles.resp}>
              <Avatar
                pessoa={
                  usersMap[card.assignee] ?? {
                    name: nomeDe(card.assignee),
                    email: card.assignee,
                  }
                }
                size={20}
              />
              {nomeDe(card.assignee)}
            </div>
          )}
        </div>

        <div className={styles.coluna}>
          <div className={styles.colunaRot}>Decisão registrada</div>
          <textarea
            className={styles.campoTexto}
            value={decisao}
            placeholder="—"
            rows={alturaDe(decisao)}
            onChange={(e) => setDecisao(e.target.value)}
            onBlur={() => {
              if (decisao !== item.decisao)
                onGravar((i) => ({ ...i, decisao: decisao.trim() }));
            }}
            aria-label={`Decisão registrada sobre ${titulo}`}
          />
        </div>

        <div className={styles.coluna}>
          <div className={styles.colunaRot}>Objetivo na próxima reunião</div>
          <textarea
            className={styles.campoTexto}
            value={objetivo}
            placeholder="—"
            rows={alturaDe(objetivo)}
            onChange={(e) => setObjetivo(e.target.value)}
            onBlur={() => {
              if (objetivo !== item.objetivo)
                onGravar((i) => ({ ...i, objetivo: objetivo.trim() }));
            }}
            aria-label={`Objetivo na próxima reunião para ${titulo}`}
          />
          <button
            className={`${styles.levar} ${item.proximaReuniao ? styles.levarOn : ""}`}
            onClick={() =>
              onGravar((i) => ({ ...i, proximaReuniao: !i.proximaReuniao }))
            }
            aria-pressed={item.proximaReuniao}
          >
            <Icon name={item.proximaReuniao ? "check" : "calendar"} size={13} />
            {item.proximaReuniao ? "Vai para a próxima" : "Levar para próxima reunião"}
          </button>
        </div>

        <button
          className={styles.recolher}
          onClick={onRecolher}
          aria-expanded={!recolhido}
          title={recolhido ? "Mostrar as tarefas" : "Recolher as tarefas"}
        >
          <Icon name={recolhido ? "chevronBaixo" : "chevronCima"} size={14} />
        </button>
      </div>

      {!recolhido && (
        <TabelaDeTarefas
          tarefas={item.tarefas}
          nomeDe={nomeDe}
          usersMap={usersMap}
          onGravar={onGravar}
        />
      )}
    </section>
  );
}

function TabelaDeTarefas({
  tarefas,
  nomeDe,
  usersMap,
  onGravar,
}: {
  tarefas: TarefaDeAta[];
  nomeDe: (email: string) => string;
  usersMap: Record<string, UserProfile>;
  onGravar: (muda: (i: ItemDeAta) => ItemDeAta) => void;
}) {
  const pessoas: SelectOption[] = [
    { value: "", label: "Sem responsável" },
    ...Object.values(usersMap)
      .filter((u) => u.active)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((u) => ({ value: u.email, label: u.name, color: u.color })),
  ];

  const mudar = (id: string, patch: Partial<TarefaDeAta>) =>
    onGravar((i) => ({
      ...i,
      tarefas: i.tarefas.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  return (
    <div className={styles.tarefas}>
      <div className={styles.tarefasRot}>Tarefas derivadas</div>
      {tarefas.length > 0 && (
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Tarefa</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Status</th>
                <th>Observação</th>
                <th aria-label="Remover" />
              </tr>
            </thead>
            <tbody>
              {tarefas.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      className={styles.celula}
                      value={t.texto}
                      placeholder="O que fazer"
                      onChange={(e) => mudar(t.id, { texto: e.target.value })}
                      aria-label="Tarefa"
                    />
                  </td>
                  <td>
                    <Select
                      value={t.responsavel}
                      options={pessoas}
                      onChange={(v) => mudar(t.id, { responsavel: v })}
                      ariaLabel={`Responsável por ${t.texto || "a tarefa"}`}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className={styles.celula}
                      value={t.prazo}
                      onChange={(e) => mudar(t.id, { prazo: e.target.value })}
                      aria-label="Prazo"
                    />
                  </td>
                  <td>
                    <Select
                      value={t.status}
                      options={STATUS_TAREFA.map((s) => ({
                        value: s,
                        label: STATUS_TAREFA_LABEL[s],
                        color:
                          s === "concluida"
                            ? "#34d399"
                            : s === "andamento"
                              ? "#f5b13d"
                              : "#c084fc",
                      }))}
                      onChange={(v) => mudar(t.id, { status: v as StatusTarefa })}
                      ariaLabel="Status da tarefa"
                    />
                  </td>
                  <td>
                    <input
                      className={styles.celula}
                      value={t.observacao}
                      placeholder="—"
                      onChange={(e) => mudar(t.id, { observacao: e.target.value })}
                      aria-label="Observação"
                    />
                  </td>
                  <td>
                    <button
                      className={styles.remover}
                      onClick={() =>
                        onGravar((i) => ({
                          ...i,
                          tarefas: i.tarefas.filter((x) => x.id !== t.id),
                        }))
                      }
                      title={`Remover a tarefa "${t.texto || "sem texto"}"`}
                      aria-label="Remover tarefa"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Sem texto de "nenhuma tarefa": o botão já diz que não há e o que fazer
          a respeito, e um estado vazio de três linhas dentro de cada uma das
          quinze demandas da pauta seria mais tela do que conteúdo. */}
      <button
        className={styles.addTarefa}
        onClick={() =>
          onGravar((i) => ({ ...i, tarefas: [...i.tarefas, tarefaNova(i.tarefas)] }))
        }
      >
        <Icon name="plus" size={14} /> Adicionar tarefa
      </button>
      {tarefas.some((t) => t.responsavel) && (
        <span className={styles.tarefasResumo}>
          {[...new Set(tarefas.map((t) => t.responsavel).filter(Boolean))]
            .map(nomeDe)
            .join(", ")}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// O formulário de ata — serve para criar e para abrir a próxima
// ---------------------------------------------------------------------------

/**
 * "Gerar da reunião" — o único caminho para uma ata nascer.
 *
 * SUBSTITUIU O FORMULÁRIO EM BRANCO, e a troca é a razão de ser deste PR. O que
 * havia antes pedia à pessoa que redigitasse título, data, horário, local,
 * facilitador e participantes de uma reunião que o sistema já tinha processado
 * inteira — e a pauta nascia vazia, sem nenhuma das decisões que a reunião
 * tomou. Aqui ela escolhe a reunião, e o servidor monta a ata.
 *
 * SÓ APARECE REUNIÃO QUE TEM DO QUE SAIR: processada e com o documento "Pontos
 * importantes". Uma reunião ainda na esteira ofereceria um botão que só sabe
 * devolver erro, e um botão que falha por desenho é pior do que um botão
 * ausente — ele ensina a duvidar dos outros.
 */
function ModalDeGerar({
  setor,
  setores,
  reunioes,
  carregando,
  onFechar,
  onGerado,
}: {
  setor: string;
  setores: string[];
  reunioes: Meeting[];
  carregando: boolean;
  onFechar: () => void;
  onGerado: (id: string, setorDestino: string) => void;
}) {
  const [reuniaoSel, setReuniaoSel] = useState("");
  const [destino, setDestino] = useState(setor);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const elegiveis = useMemo(
    () =>
      reunioes.filter(
        (r) =>
          r.status === "processado" &&
          (r.driveOutputs ?? []).some((o) => o.kind === "resumo"),
      ),
    [reunioes],
  );

  const escolhida = elegiveis.find((r) => r.id === reuniaoSel);

  async function gerar() {
    if (!escolhida) return;
    setGerando(true);
    setErro(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const token = await user.getIdToken();
      const r = await fetch("/api/ata/gerar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ meetingId: escolhida.id, setor: destino }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível gerar a ata.");
      onGerado(body.id as string, destino);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar a ata.");
      setGerando(false);
    }
  }

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !gerando}
      ariaLabel="Gerar ata da reunião"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={520}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="reunioes" size={12} /> Gerar ata da reunião
        </span>
        <span className={styles.mchip}>{destino}</span>
      </div>

      {carregando ? (
        <SkeletonRow rows={3} texto="Procurando reuniões processadas…" />
      ) : elegiveis.length === 0 ? (
        /* "Ainda não respondeu" e "respondeu e está vazio" são telas diferentes
           (AGENTS.md §3) — este é o segundo caso. */
        <EmptyState
          icon="reunioes"
          title="Nenhuma reunião processada"
          description="A ata sai dos pontos importantes que o processamento gera. Envie o áudio em Reuniões e volte quando ele estiver processado."
        />
      ) : (
        <>
          <label className={styles.rotulo}>Reunião</label>
          <Select
            value={reuniaoSel}
            options={[
              { value: "", label: "Escolha uma reunião…" },
              ...elegiveis.map(
                (r): SelectOption => ({
                  value: r.id,
                  label: `${r.title} · ${r.date ? fmtDayMonth(r.date) : "sem data"} · ${r.sector}`,
                }),
              ),
            ]}
            onChange={(v) => {
              setReuniaoSel(v);
              setErro(null);
            }}
            ariaLabel="Reunião"
          />

          {/* O setor de destino é escolha, e não o setor da reunião: o áudio
              sobe pelo setor de quem gravou, e o assunto costuma pertencer a
              outro. A primeira ata desta tela é exatamente isso — reunião do
              B.I., ata das Cantinas. */}
          <label className={styles.rotulo}>Setor da ata</label>
          <Select
            value={destino}
            options={setores.map((x): SelectOption => ({ value: x, label: x }))}
            onChange={setDestino}
            ariaLabel="Setor da ata"
          />

          {escolhida && escolhida.sector !== destino && (
            <p className={styles.avisoModal}>
              A reunião correu no setor {escolhida.sector} e a ata vai para{" "}
              {destino}. A pauta dela junta as demandas do quadro de {destino}.
            </p>
          )}

          {erro && <p className={styles.erroModal}>{erro}</p>}
        </>
      )}

      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={gerando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          onClick={gerar}
          disabled={gerando || !escolhida || !destino}
        >
          {gerando ? "Gerando…" : "Gerar ata"}
        </button>
      </div>
    </Modal>
  );
}

function ModalDeAta({
  titulo,
  setor,
  users,
  aviso,
  inicial,
  onFechar,
  onCriar,
}: {
  titulo: string;
  setor: string;
  users: UserProfile[];
  aviso?: string;
  inicial?: {
    titulo?: string;
    local?: string;
    facilitador?: string;
    participantes?: string[];
  };
  onFechar: () => void;
  onCriar: (dados: {
    titulo: string;
    data: string;
    horaInicio: string;
    horaFim: string;
    local: string;
    facilitador: string;
    participantes: string[];
  }) => Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.titulo ?? "");
  const [data, setData] = useState(toISO(startOfDay()));
  const [hi, setHi] = useState("");
  const [hf, setHf] = useState("");
  const [local, setLocal] = useState(inicial?.local ?? "");
  const [facil, setFacil] = useState(inicial?.facilitador ?? "");
  const [participantes, setParticipantes] = useState<string[]>(
    inicial?.participantes ?? [],
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const doSetor = users
    .filter((u) => u.active && (u.sectors ?? []).includes(setor))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <Modal
      onClose={onFechar}
      /* Fechar no meio da escrita deixaria a tela sem dizer como terminou. */
      podeFechar={() => !salvando}
      ariaLabel={titulo}
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={520}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="reunioes" size={12} /> {titulo}
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      {aviso && <p className={styles.avisoModal}>{aviso}</p>}
      <label className={styles.rotulo}>Título da reunião</label>
      <input
        className={styles.input}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Reunião Semanal de Operações"
        autoFocus
      />
      <div className={styles.linhaCampos}>
        <div>
          <label className={styles.rotulo}>Data</label>
          <input
            type="date"
            className={styles.input}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        <div>
          <label className={styles.rotulo}>Início</label>
          <input
            type="time"
            className={styles.input}
            value={hi}
            onChange={(e) => setHi(e.target.value)}
          />
        </div>
        <div>
          <label className={styles.rotulo}>Fim</label>
          <input
            type="time"
            className={styles.input}
            value={hf}
            onChange={(e) => setHf(e.target.value)}
          />
        </div>
      </div>
      <label className={styles.rotulo}>Local</label>
      <input
        className={styles.input}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Sala 2 / Híbrido"
      />
      <label className={styles.rotulo}>Facilitador</label>
      <Select
        value={facil}
        options={[
          { value: "", label: "Sem facilitador" },
          ...doSetor.map((u) => ({ value: u.email, label: u.name, color: u.color })),
        ]}
        onChange={setFacil}
        ariaLabel="Facilitador"
      />
      <label className={styles.rotulo}>Participantes</label>
      {/* Só quem é do setor: convidar para a ata alguém que a regra do Firestore
          não deixa ler a ata seria um convite que o app não cumpre. */}
      <div className={styles.pessoas}>
        {doSetor.length === 0 && (
          <span className={styles.vazioInline}>
            Ninguém cadastrado neste setor ainda.
          </span>
        )}
        {doSetor.map((u) => {
          const on = participantes.includes(u.email);
          return (
            <button
              key={u.email}
              className={`${styles.pessoa} ${on ? styles.pessoaOn : ""}`}
              onClick={() =>
                setParticipantes((cur) =>
                  on ? cur.filter((x) => x !== u.email) : [...cur, u.email],
                )
              }
              aria-pressed={on}
            >
              <Avatar pessoa={u} size={20} />
              {u.name}
            </button>
          );
        })}
      </div>
      {erro && <p className={styles.erroModal}>{erro}</p>}
      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          disabled={salvando || !nome.trim()}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onCriar({
                titulo: nome,
                data,
                horaInicio: hi,
                horaFim: hf,
                local,
                facilitador: facil,
                participantes,
              });
            } catch (e) {
              setErro(
                e instanceof Error ? e.message : "Não foi possível criar a ata.",
              );
            } finally {
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Salvando…" : "Criar"}
        </button>
      </div>
    </Modal>
  );
}
