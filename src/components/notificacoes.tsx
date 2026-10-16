"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { subscribeCardsForSectors, type Card } from "@/lib/kanban";
import { subscribeMeetings, type Meeting } from "@/lib/meetings";
import { subscribePropostas, type Proposta } from "@/lib/demandas";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import { ultimosEventos, type Evento } from "@/lib/historico";
import { useSetoresDaPessoa } from "@/lib/setores";
import { useAsyncData } from "@/lib/use-async-data";
import { juntarFontes } from "@/lib/async-data-core";
import {
  cardsParaConsultar,
  novidades,
  pendencias,
  podarVistas,
  quando,
  separarVistas,
  type Notificacao,
  type Vistas,
} from "@/lib/notificacoes-core";
import { Icon } from "./icons";
import { SkeletonRow } from "./skeleton";
import { ErrorState } from "./error-state";
import styles from "./notificacoes.module.css";

/**
 * Eventos lidos por card. Só as movimentações entram na lista, e as edições
 * vêm no meio delas; cinco cobrem a semana de um card que anda.
 */
const EVENTOS_POR_CARD = 5;

/**
 * O que a pessoa já viu mora no navegador, e não no banco. É conveniência de
 * quem olha, não estado que precise atravessar aparelhos — e não há arquivo a
 * guardar: a novidade some sozinha depois de sete dias (`JANELA_MS`), vista ou
 * não. Gravar isso no Firestore pediria regra nova em `users/{email}/prefs`
 * para guardar algo que expira em uma semana.
 */
const CHAVE_VISTAS = "sm_notif_vistas";

function lerVistas(): Vistas {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_VISTAS) ?? "null");
    if (v && typeof v.ate === "number" && Array.isArray(v.ids)) {
      return { ate: v.ate, ids: v.ids.filter((i: unknown) => typeof i === "string") };
    }
  } catch {
    // valor torto ou navegador sem armazenamento: começa do zero.
  }
  return { ate: 0, ids: [] };
}

function gravarVistas(v: Vistas) {
  try {
    localStorage.setItem(CHAVE_VISTAS, JSON.stringify(v));
  } catch {
    // sem armazenamento: as vistas voltam a ser novas na próxima carga, só isso.
  }
}

const SEM_CARDS: Card[] = [];
const SEM_MEETINGS: Meeting[] = [];
const SEM_PROPOSTAS: Proposta[] = [];
const SEM_USERS: UserProfile[] = [];

export function Notificacoes({
  pessoa,
  compacto,
}: {
  pessoa: { email: string; role: string; sectors?: string[] };
  /** Lateral oculta: vira o sino, como no trilho de tela estreita. */
  compacto?: boolean;
}) {
  const sectors = useSetoresDaPessoa(pessoa);
  const chave = sectors.join("|");

  /**
   * As MESMAS assinaturas por setor que Kanban e Relatórios já fazem, e o
   * filtro pelo e-mail da pessoa vem depois, em memória. Uma consulta com
   * `where("assignee", "==", email)` seria mais enxuta e seria RECUSADA: a regra
   * de `/cards` é escopada por setor, e o Firestore só aceita consulta que
   * carregue a restrição de setor que a regra pede.
   */
  const fCards = useAsyncData<Card>(chave, (onData, onErro) =>
    subscribeCardsForSectors(sectors, onData, onErro),
  );
  const fMeetings = useAsyncData<Meeting>(chave, (onData, onErro) =>
    subscribeMeetings(sectors, onData, onErro),
  );
  const fPropostas = useAsyncData<Proposta>(chave, (onData, onErro) =>
    subscribePropostas(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("users", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const meetings = fMeetings.data ?? SEM_MEETINGS;
  const propostas = fPropostas.data ?? SEM_PROPOSTAS;
  const users = fUsers.data ?? SEM_USERS;

  const alvos = useMemo(
    () => cardsParaConsultar(cards, pessoa.email),
    [cards, pessoa.email],
  );
  // `histCount` entra na chave: é o contador que sobe a cada evento gravado,
  // então o histórico só é relido quando há de fato evento novo — e não a cada
  // snapshot do setor, que chega toda vez que QUALQUER card dele muda.
  const chaveEventos = alvos
    .map((c) => `${c.id}:${c.sector}:${c.histCount ?? 0}`)
    .join("|");

  const [eventos, setEventos] = useState<{
    chave: string;
    porCard: Map<string, Evento[]>;
  } | null>(null);

  useEffect(() => {
    if (fCards.data === undefined) return;
    let vivo = true;
    // `allSettled`: um card cuja leitura falhe (setor que a pessoa perdeu no
    // meio da sessão) não derruba as notificações dos outros.
    Promise.allSettled(
      alvos.map((c) => ultimosEventos(c.id, c.sector, EVENTOS_POR_CARD)),
    ).then((res) => {
      if (!vivo) return;
      const porCard = new Map<string, Evento[]>();
      res.forEach((r, i) => {
        if (r.status === "fulfilled") porCard.set(alvos[i].id, r.value);
      });
      setEventos({ chave: chaveEventos, porCard });
    });
    return () => {
      vivo = false;
    };
    // `alvos` muda de identidade a cada snapshot; a chave é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveEventos, fCards.data === undefined]);

  const [vistasGuardadas, setVistas] = useState(lerVistas);
  const [aberto, setAberto] = useState(false);
  /** A sub-visão das já vistas. Fica fora da lista principal até ser pedida. */
  const [verVistas, setVerVistas] = useState(false);
  // O relógio do "há 5 min" é lido uma vez por render. Não há timer: a lateral
  // se redesenha a cada snapshot, e um "há 4 min" que fica parado alguns
  // minutos não engana ninguém.
  const [agora] = useState(() => Date.now());

  const nomes = useMemo(
    () => new Map(users.map((u) => [u.email.toLowerCase(), u.name])),
    [users],
  );
  const nomeDe = (e: string) =>
    nomes.get(e.toLowerCase())?.split(" ")[0] || e.split("@")[0];

  const tela = juntarFontes([fCards, fMeetings, fPropostas]);
  // Usuários não seguram a tela: sem eles os nomes saem do e-mail, o que é
  // pior, mas não é mentira. Os eventos seguram — sem eles a lista diria
  // "nada novo" antes de ter perguntado.
  const carregando =
    tela.carregando || !eventos || eventos.chave !== chaveEventos;

  // A data da decisão chega como Timestamp do Firestore; o núcleo puro só
  // conhece milissegundos.
  const propostasNot = useMemo(
    () =>
      propostas.map((p) => ({
        ...p,
        decisao: p.decisao && {
          ...p.decisao,
          em: p.decisao.em?.toMillis?.() ?? 0,
        },
      })),
    [propostas],
  );

  const pend = pendencias(pessoa.email, meetings, propostasNot);
  const todas = carregando
    ? []
    : novidades({
        email: pessoa.email,
        cards,
        eventos: eventos!.porCard,
        nomeDe,
        agora,
      });
  const { novas, vistas } = separarVistas(todas, vistasGuardadas);
  const contador = carregando ? 0 : pend.length + novas.length;

  const guardar = (v: Vistas) => {
    // Poda na escrita: os ids de notificação que já saíram da janela de sete
    // dias não têm por que continuar no armazenamento.
    const podada = carregando ? v : podarVistas(v, todas);
    setVistas(podada);
    gravarVistas(podada);
  };
  // O marco vai até a mais nova DA LISTA, e não até o relógio: o que chegar
  // depois do clique continua novo, mesmo que o servidor tenha carimbado o
  // evento um instante antes do relógio desta máquina.
  const marcarTodas = () =>
    guardar({
      ate: Math.max(vistasGuardadas.ate, ...novas.map((n) => n.em)),
      ids: vistasGuardadas.ids,
    });
  const marcarUma = (id: string) =>
    !vistasGuardadas.ids.includes(id) &&
    guardar({ ate: vistasGuardadas.ate, ids: [...vistasGuardadas.ids, id] });

  const tentarDeNovo = () => {
    fCards.tentarDeNovo();
    fMeetings.tentarDeNovo();
    fPropostas.tentarDeNovo();
  };

  const item = (n: Notificacao, pendente: boolean) => (
    <li key={n.id}>
      <Link
        href={n.href}
        className={styles.item}
        onClick={(e) => {
          setAberto(false);
          if (!pendente) marcarUma(n.id);
          // Já na mesma tela (outro card do Kanban, outra reunião em
          // Relatórios), a navegação do Next só troca a query: a página não
          // remonta e não relê a URL, que ela só lê no estado inicial. A carga
          // inteira é o preço de abrir a coisa certa nesse caso, e só nele.
          const destino = new URL(n.href, window.location.origin);
          if (destino.pathname === window.location.pathname) {
            e.preventDefault();
            window.location.assign(n.href);
          }
        }}
      >
        <span className={`${styles.ic} ${pendente ? styles.icPend : ""}`}>
          <Icon name={n.icone} size={14} />
        </span>
        <span className={styles.txt}>
          <span className={styles.tit}>{n.titulo}</span>
          <span className={styles.det}>{n.detalhe}</span>
        </span>
        {!pendente && <span className={styles.quando}>{quando(n.em, agora)}</span>}
      </Link>
    </li>
  );

  return (
    <div className={`${styles.wrap} ${compacto ? styles.compacto : ""}`}>
      {/* No trilho estreito a lista não cabe: vira um sino que abre o painel. */}
      <button
        type="button"
        className={styles.sino}
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-label={`Notificações${contador ? ` — ${contador} novas` : ""}`}
        title="Notificações"
      >
        <Icon name="sino" size={18} />
        {contador > 0 && <span className={styles.badge}>{contador}</span>}
      </button>

      <section
        className={`${styles.painel} ${aberto ? styles.painelAberto : ""}`}
        aria-label="Notificações"
      >
        <div className={styles.head}>
          {verVistas ? (
            <button
              type="button"
              className={styles.voltar}
              onClick={() => setVerVistas(false)}
            >
              ← Notificações
            </button>
          ) : (
            <span className={styles.lbl}>Notificações</span>
          )}
          {!verVistas && contador > 0 && (
            <span className={styles.badge}>{contador}</span>
          )}
          {!verVistas && novas.length > 0 && (
            <button
              type="button"
              className={styles.marcar}
              onClick={marcarTodas}
            >
              Marcar como vistas
            </button>
          )}
        </div>

        <div className={styles.corpo}>
          {tela.erro ? (
            <ErrorState error={tela.erro} onRetry={tentarDeNovo} size="compact" />
          ) : carregando ? (
            <SkeletonRow rows={3} texto="Carregando as notificações…" />
          ) : verVistas ? (
            vistas.length === 0 ? (
              <p className={styles.vazio}>Nenhuma notificação vista nos últimos 7 dias.</p>
            ) : (
              <ul className={styles.lista}>{vistas.map((n) => item(n, false))}</ul>
            )
          ) : pend.length === 0 && novas.length === 0 ? (
            <p className={styles.vazio}>
              Tudo em dia. Quando alguém mover uma demanda sua, ou uma reunião
              sua ficar pronta para validar, aparece aqui.
            </p>
          ) : (
            <>
              {pend.length > 0 && (
                <>
                  <div className={styles.sub}>Para você validar</div>
                  <ul className={styles.lista}>
                    {pend.map((n) => item(n, true))}
                  </ul>
                </>
              )}
              {novas.length > 0 && (
                <>
                  {pend.length > 0 && <div className={styles.sub}>Movimentações</div>}
                  <ul className={styles.lista}>
                    {novas.map((n) => item(n, false))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        {/* A porta da sub-visão fica no pé, discreta, e só existe quando há o
            que mostrar atrás dela: as vistas não disputam espaço com as novas. */}
        {!verVistas && !carregando && !tela.erro && vistas.length > 0 && (
          <button
            type="button"
            className={styles.verVistas}
            onClick={() => setVerVistas(true)}
          >
            Vistas nos últimos 7 dias ({vistas.length})
          </button>
        )}
      </section>
      {aberto && (
        <div
          className={styles.veu}
          onClick={() => setAberto(false)}
          aria-hidden
        />
      )}
    </div>
  );
}
