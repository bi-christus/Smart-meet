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
  naoVistas,
  novidades,
  pendencias,
  quando,
  type Notificacao,
} from "@/lib/notificacoes-core";
import { Icon } from "./icons";
import { SkeletonRow } from "./skeleton";
import { ErrorState } from "./error-state";
import styles from "./notificacoes.module.css";

/** Eventos lidos por card. Três cobrem "o que aconteceu desde ontem". */
const EVENTOS_POR_CARD = 3;

/**
 * "Visto até" mora no navegador, e não no banco. É conveniência de quem olha
 * (o pontinho de não lida), não estado que precise atravessar aparelhos — e
 * guardá-lo no Firestore pediria regra nova em `users/{email}/prefs`, que hoje
 * só aceita o documento do relatório do gestor.
 */
const CHAVE_VISTO = "sm_notif_visto";

function lerVisto(): number {
  try {
    return Number(localStorage.getItem(CHAVE_VISTO)) || 0;
  } catch {
    return 0;
  }
}

const SEM_CARDS: Card[] = [];
const SEM_MEETINGS: Meeting[] = [];
const SEM_PROPOSTAS: Proposta[] = [];
const SEM_USERS: UserProfile[] = [];

export function Notificacoes({
  pessoa,
}: {
  pessoa: { email: string; role: string; sectors?: string[] };
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

  const [vistoAte, setVistoAte] = useState(lerVisto);
  const [aberto, setAberto] = useState(false);
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
  const novas = carregando
    ? []
    : novidades({
        email: pessoa.email,
        cards,
        eventos: eventos!.porCard,
        reunioes: meetings,
        propostas: propostasNot,
        nomeDe,
      });
  const contador = carregando ? 0 : pend.length + naoVistas(novas, vistoAte);

  const marcarVistas = () => {
    const t = Date.now();
    setVistoAte(t);
    try {
      localStorage.setItem(CHAVE_VISTO, String(t));
    } catch {
      // navegador sem armazenamento: o pontinho volta na próxima carga, só isso.
    }
  };

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
        {!pendente && n.em > vistoAte && (
          <span className={styles.nova} aria-label="não lida" />
        )}
        {!pendente && <span className={styles.quando}>{quando(n.em, agora)}</span>}
      </Link>
    </li>
  );

  return (
    <div className={styles.wrap}>
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
          <span className={styles.lbl}>Notificações</span>
          {contador > 0 && <span className={styles.badge}>{contador}</span>}
          {naoVistas(novas, vistoAte) > 0 && (
            <button
              type="button"
              className={styles.marcar}
              onClick={marcarVistas}
            >
              Marcar como lidas
            </button>
          )}
        </div>

        <div className={styles.corpo}>
          {tela.erro ? (
            <ErrorState error={tela.erro} onRetry={tentarDeNovo} size="compact" />
          ) : carregando ? (
            <SkeletonRow rows={3} texto="Carregando as notificações…" />
          ) : pend.length === 0 && novas.length === 0 ? (
            <p className={styles.vazio}>
              Nada novo nas suas demandas. Quando alguém mexer numa demanda sua,
              ou uma reunião sua ficar pronta para validar, aparece aqui.
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
                  {pend.length > 0 && <div className={styles.sub}>Atualizações</div>}
                  <ul className={styles.lista}>
                    {novas.map((n) => item(n, false))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
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
