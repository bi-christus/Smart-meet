"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import { subscribeCardsForSectors, type Card } from "@/lib/kanban";
import {
  seloDoLink,
  dominioDe,
  monogramaDe,
  normalizarUrl,
  rotuloDoLink,
  servicoDe,
  SERVICO_ROTULO,
  type CardLink,
  type ServicoLink,
} from "@/lib/links-core";
import { fmtDayMonth, toISO } from "@/lib/datas";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonCard, classeAparece } from "@/components/skeleton";
import styles from "./links.module.css";

/**
 * Links — o que estava espalhado dentro das demandas, num lugar só.
 *
 * A planilha do orçamento, o dashboard do Power BI, a pasta no Drive: tudo isso
 * já era colado no campo Links de alguma demanda do Kanban, e depois só era
 * reencontrado por quem lembrava em qual card tinha posto. Esta tela não guarda
 * nada de novo — ela lê os mesmos cards e vira o avesso: um card por LINK, com
 * a demanda de origem no rodapé em vez do contrário.
 *
 * Por isso a única fonte que segura a tela é `cards`. A lista de pessoas entra
 * depois, sem travar nada: um link continua legível com o e-mail de quem o
 * colou no lugar do nome.
 */

/**
 * Listas vazias constantes, para os cálculos rodarem antes de os dados
 * chegarem. Fora do componente porque `?? []` no corpo cria um array novo a
 * cada render, e os `useMemo` que dependem dele recalculariam sempre.
 */
const SEM_CARDS: Card[] = [];
const SEM_USERS: UserProfile[] = [];

/** Um link e a demanda de onde ele veio — o card desta tela é este par. */
type LinkNaTela = { link: CardLink; card: Card };

/**
 * O ícone do serviço é DESENHADO, nunca buscado.
 *
 * O caminho óbvio seria `google.com/s2/favicons?domain=…`, e ele custa caro:
 * uma requisição externa POR CARD, que entrega ao Google a lista de domínios
 * internos da rede a cada visita, e um quadrado quebrado toda vez que a rede da
 * escola bloquear a chamada. `servicoDe` já identifica o serviço a partir da
 * própria URL, então a cor e o desenho saem de dado que já está na mão.
 *
 * O que o ícone diz é o TIPO da coisa do outro lado — documento, planilha,
 * vídeo, conversa — e não a marca. Quem nomeia a marca é o selo embaixo do
 * título; quem a colore é `seloDoLink`. Manter dezoito logotipos aqui dentro
 * seria carregar dezoito marcas registradas para dizer o que uma palavra diz.
 */
const ICONE_DO_SERVICO: Partial<Record<ServicoLink, string>> = {
  docs: "relatorios",
  notion: "relatorios",
  pdf: "relatorios",
  sheets: "kanban",
  planilha: "kanban",
  trello: "kanban",
  looker: "trend",
  powerbi: "trend",
  slides: "online",
  meet: "online",
  youtube: "play",
  calendar: "calendar",
  whatsapp: "chat",
  forms: "check",
  drive: "upload",
  figma: "edit",
};

export default function LinksPage() {
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

  const chaveSetores = sectors.join("|");
  const fCards = useAsyncData<Card>(chaveSetores, (onData, onErro) =>
    subscribeCardsForSectors(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const users = fUsers.data ?? SEM_USERS;

  const [filtroSetor, setFiltroSetor] = useState("");
  const [busca, setBusca] = useState("");

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const nomeDe = (email: string | null) =>
    email ? (usersMap[email]?.name ?? email) : "—";

  /**
   * Uma fonte só decide o estado da tela.
   *
   * `fUsers` fica de fora de propósito: ela traduz e-mail em nome no rodapé do
   * card e mais nada. Fazer a grade inteira esperar por ela seria esperar por
   * um dado que o card sabe dispensar.
   */
  const tela = juntarFontes([fCards]);

  const todos = useMemo<LinkNaTela[]>(() => {
    const out: LinkNaTela[] = [];
    cards.forEach((card) =>
      (card.links ?? []).forEach((link) => out.push({ link, card })),
    );
    // Mais recente primeiro: link colado hoje é o que alguém veio procurar.
    return out.sort((a, b) => b.link.addedAt - a.link.addedAt);
  }, [cards]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todos.filter(({ link, card }) => {
      if (filtroSetor && card.sector !== filtroSetor) return false;
      if (!q) return true;
      return (
        rotuloDoLink(link).toLowerCase().includes(q) ||
        dominioDe(link.url).toLowerCase().includes(q) ||
        card.title.toLowerCase().includes(q)
      );
    });
  }, [todos, filtroSetor, busca]);

  const anoAtual = useMemo(() => new Date().getFullYear(), []);

  const setorOptions: SelectOption[] = [
    { value: "", label: "Todos os setores" },
    ...sectors.map((s) => ({ value: s, label: s })),
  ];

  const contagem =
    visiveis.length === todos.length
      ? `${todos.length} ${todos.length === 1 ? "link" : "links"}`
      : `${visiveis.length} de ${todos.length} links`;

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Links</h1>
            <p>Tudo o que foi colado nas demandas, num lugar só.</p>
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
          <h1>Links</h1>
          {/* A contagem só entra depois da resposta: "0 links" antes de saber é
              a mesma afirmação falsa da mensagem de vazio, dita com a
              autoridade de um número. */}
          <p>
            Tudo o que foi colado no campo Links das demandas dos seus setores
            {tela.carregando || tela.erro ? "." : ` — ${contagem}.`}
          </p>
        </div>

        <div className={styles.headTools}>
          <div className={styles.filtroSetor}>
            <Select
              value={filtroSetor}
              options={setorOptions}
              onChange={setFiltroSetor}
              placeholder="Todos os setores"
              ariaLabel="Filtrar por setor"
            />
          </div>
          <div className={styles.searchwrap}>
            <Icon name="search" size={15} />
            <input
              className={styles.search}
              placeholder="Buscar por link, domínio ou demanda…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar links"
            />
          </div>
        </div>
      </div>

      <div className={styles.corpo} aria-busy={tela.carregando || undefined}>
        {tela.erro ? (
          <ErrorState error={tela.erro} onRetry={() => fCards.tentarDeNovo()} />
        ) : tela.carregando ? (
          <SkeletonCard cards={6} texto="Carregando os links das demandas…" />
        ) : todos.length === 0 ? (
          <EmptyState
            icon="links"
            title="Nenhum link ainda"
            description={
              <>
                Um link chega aqui quando alguém o cola no campo <b>Links</b> de
                uma demanda do Kanban — a planilha do orçamento, o painel do
                Power BI, a pasta no Drive. Esta tela junta os de todos os seus
                setores e mostra um card para cada um.
              </>
            }
            action={
              <Link href="/kanban">
                <Icon name="kanban" size={14} /> Abrir o Kanban
              </Link>
            }
          />
        ) : (
          <>
            {visiveis.length === 0 && (
              <EmptyState
                size="compact"
                icon="search"
                title="Nenhum link com esse filtro"
                description={
                  <>
                    Nenhum dos {todos.length} links guardados casa com o setor e
                    a busca escolhidos.
                  </>
                }
              />
            )}
            {/* A grade fica montada assim que os dados chegam, mesmo com zero
                resultados na peneira. Trocá-la pelo painel de vazio a cada
                filtro reexecutaria o crossfade de entrada a cada tecla
                digitada — e animar interação de alta frequência é lentidão
                percebida, que é o oposto do que a animação serve aqui. */}
            <div className={`${styles.grid} ${classeAparece}`}>
              {visiveis.map(({ link, card }) => (
                <LinkCard
                  key={`${card.id}:${link.id}`}
                  link={link}
                  card={card}
                  nomeDe={nomeDe}
                  anoAtual={anoAtual}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O card do link
// ---------------------------------------------------------------------------

function LinkCard({
  link,
  card,
  nomeDe,
  anoAtual,
}: {
  link: CardLink;
  card: Card;
  nomeDe: (e: string | null) => string;
  anoAtual: number;
}) {
  const servico = servicoDe(link.url);
  const rotulo = rotuloDoLink(link);
  const selo = seloDoLink(link.url);
  // O portão roda de novo sobre o que veio do banco. Quem grava passa por
  // `normalizarUrl`, mas o campo aceita escrita de qualquer pessoa do setor e do
  // console do Firestore — e o React não recusa um `javascript:` em `href`, só
  // avisa. Sem `href` o elemento deixa de ser link: não abre nada, que é a
  // falha certa para um endereço em que não se pode confiar.
  const destino = normalizarUrl(link.url) || undefined;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        {/* Cor de dado entra inline, como o projeto já faz com `tagColor` e
            `DEMAND_TYPE_COLOR`. Fundo e tinta saem JUNTOS de `seloDoLink`
            porque um depende do outro: branco chapado some no amarelo do
            Drive, e a marca sozinha não garante que a letra em cima se leia. */}
        <span
          className={styles.icone}
          style={{ background: selo.fundo, color: selo.tinta }}
          aria-hidden="true"
        >
          {servico === "generico" ? (
            monogramaDe(link.url)
          ) : (
            <Icon name={ICONE_DO_SERVICO[servico] ?? "link"} size={19} />
          )}
        </span>

        <div className={styles.cardTitulo}>
          {/* `noopener` não é enfeite: sem ele a página aberta recebe
              `window.opener` e pode redirecionar a aba do Smart Meeting por
              baixo, com o usuário achando que voltou para o app. */}
          <a href={destino} target="_blank" rel="noopener noreferrer">
            {rotulo}
          </a>
          <div className={styles.cardMeta}>
            <span className={styles.estado}>{SERVICO_ROTULO[servico]}</span>
            <span className={styles.dominio} title={link.url}>
              {subtituloDe(link, rotulo)}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.cardPe}>
        <div className={styles.peLinha}>
          {/* O Kanban não tem rota por card, então o destino honesto é o
              quadro — melhor do que uma URL que abre o card errado. */}
          <Link className={styles.demanda} href="/kanban">
            <Icon name="kanban" size={13} />
            <span>{card.title}</span>
          </Link>
          <span className={styles.setor}>{card.sector}</span>
        </div>
        <span className={styles.autoria}>
          {nomeDe(link.addedBy)} · {dataDe(link.addedAt, anoAtual)}
        </span>
      </div>
    </div>
  );
}

/**
 * A linha pequena embaixo do título — o domínio, quase sempre.
 *
 * Quase: link colado sem título faz `rotuloDoLink` cair no próprio domínio, e
 * aí escrevê-lo de novo logo abaixo gastaria uma linha inteira para dizer duas
 * vezes a mesma coisa. Nesse caso ela mostra o caminho, que é o pedaço da URL
 * que ainda não foi dito — e a URL completa continua no `title`.
 */
function subtituloDe(link: CardLink, rotulo: string): string {
  const dom = dominioDe(link.url);
  if (!dom || rotulo !== dom) return dom;
  try {
    const u = new URL(normalizarUrl(link.url));
    const resto = `${u.pathname}${u.search}`;
    return resto && resto !== "/" ? resto : dom;
  } catch {
    return dom;
  }
}

/** "12 ago" — com o ano só quando não é o corrente, que é quando ele informa. */
function dataDe(ms: number, anoAtual: number): string {
  const d = new Date(ms);
  const dia = fmtDayMonth(toISO(d));
  return d.getFullYear() === anoAtual ? dia : `${dia} de ${d.getFullYear()}`;
}
