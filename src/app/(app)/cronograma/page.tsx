"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  columnsBySector,
  deliveredBySector,
  type Card,
  type ColumnDoc,
  type KanbanColumn,
} from "@/lib/kanban";
import {
  subscribeMeetings,
  MEETING_STATUS_LABEL,
  type Meeting,
} from "@/lib/meetings";
import {
  addDays,
  daysBetween,
  DOW_MINI,
  MES_LONGO,
  parseISO,
  startOfDay,
  startOfWeek,
  toISO,
} from "@/lib/datas";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/modal";
import { Select, type SelectOption } from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import styles from "./cronograma.module.css";

/**
 * Cronograma — o mês do setor numa página.
 *
 * Duas coisas ocupam a agenda de quem trabalha aqui: reunião (que já aconteceu
 * ou vai acontecer) e prazo de demanda. Elas viviam em telas separadas, e o
 * conflito entre as duas — a entrega marcada para o dia da reunião de status —
 * só aparecia quando já era tarde. Aqui elas dividem a mesma célula do dia.
 *
 * Demanda concluída sai do calendário: prazo cumprido não é compromisso, e
 * deixá-lo no quadro esconde o que ainda precisa de atenção.
 */

type Item =
  | { tipo: "reuniao"; date: string; title: string; sector: string; ref: Meeting }
  | {
      tipo: "prazo";
      date: string;
      title: string;
      sector: string;
      ref: Card;
      col?: KanbanColumn;
    };

type Vista = "mes" | "semana";

/**
 * Listas vazias constantes, para os cálculos rodarem antes de os dados
 * chegarem. Fora do componente porque `?? []` no corpo cria um array novo a
 * cada render, e os `useMemo` que dependem dele recalculariam sempre.
 */
const SEM_CARDS: Card[] = [];
const SEM_MEETINGS: Meeting[] = [];
const SEM_COLS: ColumnDoc[] = [];
const SEM_USERS: UserProfile[] = [];

export default function CronogramaPage() {
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
   * Antes eram quatro `useState([])`, e o calendário afirmava "Nenhuma reunião
   * ou prazo neste período" enquanto ainda buscava — com dois dos quatro erros
   * indo só para o console e os outros dois para lugar nenhum.
   */
  const chaveSetores = sectors.join("|");
  const fCards = useAsyncData<Card>(chaveSetores, (onData, onErro) =>
    subscribeCardsForSectors(sectors, onData, onErro),
  );
  const fMeetings = useAsyncData<Meeting>(chaveSetores, (onData, onErro) =>
    subscribeMeetings(sectors, onData, onErro),
  );
  const fCols = useAsyncData<ColumnDoc>(chaveSetores, (onData, onErro) =>
    subscribeColumnsForSectors(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const meetings = fMeetings.data ?? SEM_MEETINGS;
  const cols = fCols.data ?? SEM_COLS;
  // A lista de pessoas não entra no estado da grade: ela só traduz e-mail em
  // nome dentro do modal de espiada, e um card sem o nome resolvido ainda diz
  // tudo o que importa. Fazer o calendário inteiro esperar por ela seria
  // esperar por um dado que a tela nem mostra.
  const users = fUsers.data ?? SEM_USERS;

  const [vista, setVista] = useState<Vista>("mes");
  const [filtroSetor, setFiltroSetor] = useState("");
  /** Deslocamento em meses (ou semanas, na vista de semana) a partir de hoje. */
  const [offset, setOffset] = useState(0);
  const [peek, setPeek] = useState<Item | null>(null);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);

  const colsPorSetor = useMemo(
    () => columnsBySector(cols, sectors),
    [cols, sectors],
  );
  const entreguesPorSetor = useMemo(
    () => deliveredBySector(colsPorSetor),
    [colsPorSetor],
  );

  const hoje = useMemo(() => startOfDay(), []);

  // Janela visível: um mês inteiro, ou a semana (segunda a domingo).
  const janela = useMemo(() => {
    if (vista === "semana") {
      const ini = addDays(startOfWeek(hoje), offset * 7);
      return { ini, fim: addDays(ini, 6) };
    }
    const base = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
    return {
      ini: base,
      fim: new Date(base.getFullYear(), base.getMonth() + 1, 0),
    };
  }, [vista, offset, hoje]);

  const itens = useMemo(() => {
    const out: Item[] = [];
    const noFiltro = (s: string) => !filtroSetor || s === filtroSetor;

    meetings.forEach((m) => {
      if (!m.date || !noFiltro(m.sector)) return;
      out.push({
        tipo: "reuniao",
        date: m.date,
        title: m.title,
        sector: m.sector,
        ref: m,
      });
    });

    cards.forEach((c) => {
      if (!c.due || !noFiltro(c.sector)) return;
      const doQuadro = colsPorSetor[c.sector] ?? [];
      // Prazo cumprido não é compromisso: demanda entregue sai da agenda — e
      // com ela o selo "vencida há N dias" que aparecia sobre trabalho pronto.
      if (entreguesPorSetor[c.sector]?.has(c.columnId)) return;
      out.push({
        tipo: "prazo",
        date: c.due,
        title: c.title,
        sector: c.sector,
        ref: c,
        col: doQuadro.find((x) => x.id === c.columnId),
      });
    });
    return out;
  }, [meetings, cards, filtroSetor, colsPorSetor, entreguesPorSetor]);

  const porDia = useMemo(() => {
    const m: Record<string, Item[]> = {};
    itens.forEach((it) => (m[it.date] = [...(m[it.date] ?? []), it]));
    // Reunião primeiro: ela tem hora marcada, o prazo é do dia inteiro.
    Object.values(m).forEach((lista) =>
      lista.sort((a, b) =>
        a.tipo === b.tipo ? a.title.localeCompare(b.title, "pt-BR") : a.tipo === "reuniao" ? -1 : 1,
      ),
    );
    return m;
  }, [itens]);

  /** Células da grade: sempre semanas completas de segunda a domingo. */
  const celulas = useMemo(() => {
    const ini = startOfWeek(janela.ini);
    const fimSemana = addDays(startOfWeek(janela.fim), 6);
    const total = Math.round((fimSemana.getTime() - ini.getTime()) / 86400000) + 1;
    return Array.from({ length: total }, (_, i) => addDays(ini, i));
  }, [janela]);

  const noPeriodo = useMemo(
    () =>
      itens.filter((it) => {
        const d = parseISO(it.date);
        return d >= janela.ini && d <= janela.fim;
      }).length,
    [itens, janela],
  );

  /**
   * A grade lê de três assinaturas, e não de quatro.
   *
   * `cols` entra porque demanda entregue sai da agenda — sem as colunas, o
   * calendário mostraria prazo cumprido com selo de "vencida há N dias" sobre
   * trabalho pronto. Isso é número errado, não número faltando, e por isso
   * segura a grade junto com os cards e as reuniões.
   */
  const grade = juntarFontes([fCards, fMeetings, fCols]);
  const reabrirGrade = () => {
    fCards.tentarDeNovo();
    fMeetings.tentarDeNovo();
    fCols.tentarDeNovo();
  };

  const setorOptions: SelectOption[] = [
    { value: "", label: "Todos os setores" },
    ...sectors.map((s) => ({ value: s, label: s })),
  ];

  const titulo =
    vista === "semana"
      ? `${janela.ini.getDate()} a ${janela.fim.getDate()} de ${MES_LONGO[janela.fim.getMonth()]}`
      : `${MES_LONGO[janela.ini.getMonth()]} de ${janela.ini.getFullYear()}`;

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Cronograma</h1>
            <p>Reuniões e prazos das demandas.</p>
          </div>
        </div>
        <div className={styles.vazioTela}>
          Você ainda não participa de nenhum setor. Peça ao administrador para
          incluí-lo em um.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Cronograma</h1>
          {/* A contagem só entra depois da resposta: "0 compromissos no
              período" antes de saber é a mesma afirmação falsa da mensagem de
              vazio, dita com a autoridade de um número. */}
          <p>
            Reuniões e prazos de demandas
            {grade.carregando || grade.erro
              ? "."
              : ` — ${noPeriodo} ${noPeriodo === 1 ? "compromisso" : "compromissos"} no período.`}
          </p>
        </div>

        <div className={styles.headTools}>
          <div className={styles.legenda}>
            <span>
              <i className={styles.dotReuniao} />
              Reunião
            </span>
            <span>
              <i className={styles.dotPrazo} />
              Prazo
            </span>
          </div>

          <div className={styles.filtroSetor}>
            <Select
              value={filtroSetor}
              options={setorOptions}
              onChange={setFiltroSetor}
              placeholder="Todos os setores"
              ariaLabel="Filtrar por setor"
            />
          </div>

          <div className={styles.seg}>
            <button
              className={vista === "mes" ? styles.segOn : ""}
              onClick={() => {
                setVista("mes");
                setOffset(0);
              }}
            >
              Mês
            </button>
            <button
              className={vista === "semana" ? styles.segOn : ""}
              onClick={() => {
                setVista("semana");
                setOffset(0);
              }}
            >
              Semana
            </button>
          </div>
        </div>
      </div>

      <div className={styles.navBar}>
        <button
          className={styles.navBtn}
          onClick={() => setOffset((o) => o - 1)}
          aria-label={vista === "semana" ? "Semana anterior" : "Mês anterior"}
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className={styles.navTitulo}>{titulo}</div>
        <button
          className={styles.navBtn}
          onClick={() => setOffset((o) => o + 1)}
          aria-label={vista === "semana" ? "Próxima semana" : "Próximo mês"}
        >
          <Icon name="chevronRight" size={16} />
        </button>
        {offset !== 0 && (
          <button className={styles.hojeBtn} onClick={() => setOffset(0)}>
            Hoje
          </button>
        )}
      </div>

      <div className={styles.scroll}>
        {/**
         * A grade fica na tela mesmo carregando, e o esqueleto vai abaixo dela.
         *
         * O mês é estrutura, não dado: os dias 1 a 31 existem antes de qualquer
         * `onSnapshot` e não afirmam nada sobre a agenda. Trocar a grade inteira
         * por barras cinzas tiraria a forma da página para devolvê-la meio
         * segundo depois — e o `aria-busy` abaixo é o que conta a mesma coisa a
         * quem não vê o esqueleto.
         */}
        <div
          className={`${styles.grade} ${vista === "semana" ? styles.gradeSemana : ""}`}
          aria-busy={grade.carregando || undefined}
        >
          {DOW_MINI.map((d) => (
            <div key={d} className={styles.gradeHead}>
              {d}
            </div>
          ))}

          {celulas.map((d) => {
            const iso = toISO(d);
            const doMes = vista === "semana" || d.getMonth() === janela.ini.getMonth();
            const isHoje = iso === toISO(hoje);
            const eventos = porDia[iso] ?? [];
            return (
              <div
                key={iso}
                className={`${styles.dia} ${doMes ? "" : styles.diaFora} ${
                  isHoje ? styles.diaHoje : ""
                }`}
              >
                <div className={styles.diaNum}>
                  {d.getDate()}
                  {isHoje && <span className={styles.hojeTag}>hoje</span>}
                </div>
                {eventos.map((it, i) => (
                  <button
                    key={`${it.tipo}-${i}`}
                    className={`${styles.chip} ${
                      it.tipo === "reuniao" ? styles.chipReuniao : styles.chipPrazo
                    }`}
                    title={`${it.title} · ${it.sector}`}
                    onClick={() => setPeek(it)}
                  >
                    {it.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {grade.erro ? (
          <ErrorState error={grade.erro} onRetry={reabrirGrade} />
        ) : grade.carregando ? (
          <SkeletonRow rows={3} texto="Carregando reuniões e prazos…" />
        ) : noPeriodo === 0 ? (
          <EmptyState
            icon="calendar"
            title="Nada marcado neste período"
            description={
              <>
                Nenhuma reunião e nenhum prazo entre estas datas. Prazos
                aparecem aqui quando uma demanda do Kanban ganha data de
                entrega.
              </>
            }
          />
        ) : null}
      </div>

      {peek && (
        <PeekModal
          item={peek}
          hoje={hoje}
          usersMap={usersMap}
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  );
}

/**
 * Espiada rápida no compromisso.
 *
 * Não repete a tela de origem — mostra o suficiente para decidir se vale abrir
 * e leva para lá com um clique. Reabrir o Kanban inteiro só para lembrar de
 * quem era o card era o atrito que fazia ninguém consultar o calendário.
 */
function PeekModal({
  item,
  hoje,
  usersMap,
  onClose,
}: {
  item: Item;
  hoje: Date;
  usersMap: Record<string, UserProfile>;
  onClose: () => void;
}) {
  const d = parseISO(item.date);
  const dataLonga = `${d.getDate()} de ${MES_LONGO[d.getMonth()]} de ${d.getFullYear()}`;

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Detalhe do compromisso"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={460}
    >
      <div className={styles.modalHead}>
        <span
          className={`${styles.tag} ${
            item.tipo === "reuniao" ? styles.tagReuniao : styles.tagPrazo
          }`}
        >
          {item.tipo === "reuniao" ? "Reunião" : "Prazo de demanda"}
        </span>
        {item.tipo === "reuniao" ? (
          <span className={styles.tagNeutra}>
            {MEETING_STATUS_LABEL[item.ref.status] ?? item.ref.status}
          </span>
        ) : (
          <PrazoTag due={item.date} hoje={hoje} />
        )}
        <div style={{ flex: 1 }} />
        <button className={styles.fechar} onClick={onClose} aria-label="Fechar">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className={styles.modalBody}>
        <h3>{item.title}</h3>
        <dl className={styles.detalhes}>
          <div>
            <dt>Setor</dt>
            <dd>{item.sector}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{dataLonga}</dd>
          </div>
          {item.tipo === "reuniao" ? (
            <>
              {item.ref.durationMin ? (
                <div>
                  <dt>Duração</dt>
                  <dd>{item.ref.durationMin} min</dd>
                </div>
              ) : null}
              <div>
                <dt>Enviada por</dt>
                <dd>
                  {usersMap[item.ref.createdBy ?? ""]?.name ??
                    item.ref.createdBy ??
                    "—"}
                </dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Responsável</dt>
                <dd>
                  {item.ref.assignee
                    ? (usersMap[item.ref.assignee]?.name ?? item.ref.assignee)
                    : "Ninguém"}
                </dd>
              </div>
              <div>
                <dt>Etapa</dt>
                <dd style={{ color: item.col?.color }}>
                  {item.col?.title ?? "—"}
                </dd>
              </div>
            </>
          )}
        </dl>

        <Link
          className={styles.irPara}
          href={
            item.tipo === "reuniao"
              ? "/relatorios"
              : `/kanban?setor=${encodeURIComponent(item.sector)}&card=${item.ref.id}`
          }
        >
          <Icon name="link" size={15} />
          {item.tipo === "reuniao"
            ? "Abrir em Relatórios IA"
            : "Abrir card no Kanban"}
        </Link>
      </div>
    </Modal>
  );
}

function PrazoTag({ due, hoje }: { due: string; hoje: Date }) {
  const n = daysBetween(due, hoje);
  if (n > 0)
    return (
      <span className={styles.tagVencida}>
        vencida há {n} {n === 1 ? "dia" : "dias"}
      </span>
    );
  if (n === 0) return <span className={styles.tagHoje}>vence hoje</span>;
  const faltam = -n;
  return (
    <span className={faltam <= 3 ? styles.tagHoje : styles.tagNeutra}>
      em {faltam} {faltam === 1 ? "dia" : "dias"}
    </span>
  );
}
