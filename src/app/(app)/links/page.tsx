"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  definirIconeDoLink,
  subscribeCardsForSectors,
  type Card,
} from "@/lib/kanban";
import { iconeDoLink } from "@/lib/icones-core";
import {
  seloDoLink,
  dominioDe,
  monogramaDe,
  normalizarUrl,
  rotuloDoLink,
  servicoDe,
  SERVICO_ROTULO,
  type CardLink,
} from "@/lib/links-core";
import { fmtDayMonth, toISO } from "@/lib/datas";
import { fraseDeFalha } from "@/lib/erro-ui-core";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { IconePicker } from "@/components/icone-picker";
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
 * nada de novo — ela lê os mesmos cards e vira o avesso: um card por LINK.
 *
 * QUEM MANDA NO CARD É A DEMANDA, e não o link. A primeira versão pôs o rótulo
 * do link em destaque e a demanda miúda no rodapé; usada de verdade, ela
 * mostrou que ninguém chega aqui perguntando "onde está a planilha?" — chega
 * perguntando "onde está a planilha DAQUELA demanda?". O título grande é o
 * `card.title`; o rótulo do link é a linha de baixo, e é ela que abre a URL.
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

/**
 * Sentinela do filtro de responsável, o mesmo do Kanban (`page.tsx:241`).
 *
 * "Sem responsável" precisa de um valor, e `""` já é "todos". Este serve porque
 * não pode colidir com nenhuma opção real: as outras são e-mails, e e-mail tem
 * sempre um "@".
 */
const SEM_RESPONSAVEL = "__sem__";

/**
 * Sentinela do filtro de setor solicitante — o mesmo problema, outra coluna.
 *
 * Aqui o cuidado com colisão é maior que no de responsável: as outras opções
 * não são e-mails, são nomes de setor digitados por gente no cadastro
 * `/solicitanteSetores`. Underscore duplo nas duas pontas não é nome que
 * alguém escreva num campo de cadastro.
 */
const SEM_SETOR_SOLICITANTE = "__sem_setor__";

/**
 * O setor de QUEM PEDIU a demanda — `null` quando ninguém preencheu o campo.
 *
 * Nem `card.sector`, que é o setor de quem EXECUTA e vale "B.I." em todo card
 * do banco. Filtrar por ele era um seletor que não peneirava nada.
 *
 * O `trim()` não é paranoia: o campo é texto livre no modal da demanda, e um
 * espaço sobrando faria "RH " virar uma opção separada de "RH" no seletor.
 */
function setorSolicitanteDe(card: Card): string | null {
  return card.requesterSector?.trim() || null;
}

/** Um link e a demanda de onde ele veio — o card desta tela é este par. */
type LinkNaTela = { link: CardLink; card: Card };

/**
 * O ÍCONE MUDOU DE CASA — e o mapa que ficava aqui não existe mais.
 *
 * Ele decidia serviço → desenho dentro desta página, sem teste, e invisível
 * para o modal da demanda, que mostra os mesmos links. Agora a decisão é
 * `iconeDoLink` (`lib/icones-core`), que ainda deduz do endereço exatamente
 * como esta constante fazia — e passa na frente qualquer ícone que alguém tenha
 * escolhido no seletor abaixo.
 *
 * O que NÃO mudou é o motivo de o desenho ser nosso e não do site: o caminho
 * óbvio (`google.com/s2/favicons?domain=…`) custaria uma requisição externa POR
 * CARD, entregaria ao Google a lista de domínios internos da rede a cada visita
 * e devolveria um quadrado quebrado toda vez que a rede da escola bloqueasse a
 * chamada.
 */

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
  const [filtroResp, setFiltroResp] = useState("");
  const [busca, setBusca] = useState("");

  /**
   * A gravação do ícone, CHAVEADA POR LINK — nunca um estado único.
   *
   * A grade mostra dezenas de links ao mesmo tempo. Um `erro: string | null`
   * global pintaria a falha de um link na borda de todos, e um `salvando:
   * boolean` desabilitaria os selos de toda a tela por causa de um clique. A
   * chave é `${card.id}:${link.id}` — a mesma que a `key` da grade já usa, e
   * pelo mesmo motivo: link só é único dentro do card em que mora.
   */
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erroIcone, setErroIcone] = useState<{ chave: string; texto: string } | null>(
    null,
  );

  /**
   * Grava o ícone escolhido.
   *
   * `sem-mudanca` é silêncio de propósito: escolher o que já estava lá não é
   * erro, e uma faixa dizendo "nada mudou" seria o app repreendendo quem clicou.
   * `sumiu` é a única saída que fala, porque é a única em que insistir no clique
   * não adianta — o card ou o link deixou de existir enquanto esta aba estava
   * aberta, e o snapshot vai atualizar a tela sozinho em seguida.
   */
  const escolherIcone = useCallback(
    async (card: Card, linkId: string, nome: string | null) => {
      const chave = `${card.id}:${linkId}`;
      setSalvando(chave);
      setErroIcone(null);
      try {
        const desfecho = await definirIconeDoLink(card.id, linkId, nome);
        if (desfecho === "sumiu") {
          setErroIcone({
            chave,
            texto:
              "Este link não está mais na demanda — alguém o removeu enquanto esta tela estava aberta.",
          });
        }
      } catch (e) {
        console.error("Erro ao trocar o ícone do link:", e);
        setErroIcone({
          chave,
          texto: fraseDeFalha(
            "Não foi possível trocar o ícone.",
            e,
            navigator.onLine,
          ),
        });
      } finally {
        setSalvando(null);
      }
    },
    [],
  );

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  // `useCallback` porque os rótulos do filtro de responsável saem daqui dentro
  // de um `useMemo`: função recriada a cada render invalidaria o memo sempre, e
  // aí ele deixaria de memorizar coisa alguma.
  const nomeDe = useCallback(
    (email: string | null) => (email ? (usersMap[email]?.name ?? email) : "—"),
    [usersMap],
  );

  /**
   * Uma fonte só decide o estado da tela.
   *
   * `fUsers` fica de fora de propósito: ela só troca e-mail por nome — no
   * rodapé do card e nos rótulos do filtro de responsável. Enquanto ela não
   * chega, os dois mostram o e-mail e continuam funcionando; fazer a grade
   * inteira esperar seria esperar por um dado que o card sabe dispensar.
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
      if (filtroSetor) {
        const setor = setorSolicitanteDe(card);
        const casa =
          filtroSetor === SEM_SETOR_SOLICITANTE
            ? setor === null
            : setor === filtroSetor;
        if (!casa) return false;
      }
      if (filtroResp) {
        const casa =
          filtroResp === SEM_RESPONSAVEL
            ? !card.assignee
            : card.assignee === filtroResp;
        if (!casa) return false;
      }
      if (!q) return true;
      // O setor solicitante NÃO entra na busca, e a omissão é escolhida.
      //
      // Ele agora tem um seletor próprio, que é exato e exaustivo — as opções
      // saem dos links que existem, então nenhum setor real fica de fora dele.
      // Repetir a mesma coluna aqui como `includes` daria dois controles para o
      // mesmo recorte com semânticas diferentes, e eles se combinam por E: quem
      // escolhesse "Infra" no seletor e digitasse "Infraestrutura" na busca
      // veria zero, com os dois controles dizendo a mesma coisa. Fora que o
      // placeholder promete três coisas — link, domínio e demanda — e uma
      // quarta invisível transforma a promessa em mentira.
      return (
        rotuloDoLink(link).toLowerCase().includes(q) ||
        dominioDe(link.url).toLowerCase().includes(q) ||
        card.title.toLowerCase().includes(q)
      );
    });
  }, [todos, filtroSetor, filtroResp, busca]);

  const anoAtual = useMemo(() => new Date().getFullYear(), []);

  /**
   * Setores SOLICITANTES que aparecem nos links — não os setores do usuário.
   *
   * A lista de `sectors` (o que a pessoa executa) construía um seletor que não
   * peneirava nada: todo card do banco tem `sector: "B.I."`, então escolher
   * qualquer opção devolvia exatamente o mesmo conjunto. Quem varia é quem
   * PEDE, e é por aí que se procura: "os links das demandas do RH".
   *
   * As opções saem dos links existentes, e não do cadastro inteiro de
   * `/solicitanteSetores` — são treze setores lá, e oferecer os que nunca
   * pediram nada é ruído com cara de escolha. É o mesmo raciocínio do filtro de
   * responsável, logo abaixo, inclusive na base: `todos`, e não `visiveis`,
   * senão o responsável e a busca esvaziariam este select e trocar um filtro
   * apagaria a opção escolhida no outro.
   */
  const setorOptions = useMemo<SelectOption[]>(() => {
    const comLink = new Set<string>();
    let temSemSetor = false;
    todos.forEach(({ card }) => {
      const s = setorSolicitanteDe(card);
      if (s) comLink.add(s);
      else temSemSetor = true;
    });
    const opts: SelectOption[] = [
      { value: "", label: "Todos os setores solicitantes" },
    ];
    [...comLink]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .forEach((s) => opts.push({ value: s, label: s }));
    if (temSemSetor)
      opts.push({
        value: SEM_SETOR_SOLICITANTE,
        label: "Sem setor solicitante",
      });
    return opts;
  }, [todos]);

  /**
   * Só entram no filtro os responsáveis de demandas QUE TÊM LINK.
   *
   * A lista completa de `/users` seria mais fácil e ofereceria dezenas de nomes
   * que não peneiram nada — inclusive quem nunca abriu o quadro. Opção que
   * devolve zero em qualquer combinação é ruído com cara de escolha.
   *
   * A base é `todos`, e não `visiveis`: o setor e a busca não podem esvaziar
   * este select, senão trocar um filtro apagaria a opção escolhida no outro.
   */
  const respOptions = useMemo<SelectOption[]>(() => {
    const comLink = new Set<string>();
    let temSemResponsavel = false;
    todos.forEach(({ card }) => {
      if (card.assignee) comLink.add(card.assignee);
      else temSemResponsavel = true;
    });
    const opts: SelectOption[] = [
      { value: "", label: "Todos os responsáveis" },
    ];
    [...comLink]
      .sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR"))
      .forEach((email) =>
        opts.push({
          value: email,
          label: nomeDe(email),
          color: usersMap[email]?.color,
        }),
      );
    if (temSemResponsavel)
      opts.push({ value: SEM_RESPONSAVEL, label: "Sem responsável" });
    return opts;
  }, [todos, nomeDe, usersMap]);

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
          {/* Setor SOLICITANTE, não o setor da demanda. O rótulo e o
              `ariaLabel` dizem "solicitante" porque o antigo "Todos os
              setores" passaria a mentir sobre o recorte: quem lê a palavra
              "setor" neste app pensa primeiro no quadro em que a demanda
              mora, e não é ele que este seletor peneira. */}
          <div className={styles.filtroSetor}>
            <Select
              value={filtroSetor}
              options={setorOptions}
              onChange={setFiltroSetor}
              placeholder="Todos os setores solicitantes"
              ariaLabel="Filtrar por setor solicitante"
            />
          </div>
          {/* Responsável DA DEMANDA, não de quem colou o link — é o sentido que
              a palavra tem no resto do app, e é por ele que se procura: "os
              links das minhas demandas". Quem colou continua no rodapé. */}
          <div className={styles.filtroResp}>
            <Select
              value={filtroResp}
              options={respOptions}
              onChange={setFiltroResp}
              placeholder="Todos os responsáveis"
              ariaLabel="Filtrar por responsável da demanda"
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
                    Nenhum dos {todos.length} links guardados casa com o setor
                    solicitante, o responsável e a busca escolhidos — eles
                    continuam lá, é a peneira que está apertada.
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
                  salvando={salvando === `${card.id}:${link.id}`}
                  erro={
                    erroIcone?.chave === `${card.id}:${link.id}`
                      ? erroIcone.texto
                      : null
                  }
                  onEscolherIcone={(nome) =>
                    void escolherIcone(card, link.id, nome)
                  }
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
  salvando,
  erro,
  onEscolherIcone,
}: {
  link: CardLink;
  card: Card;
  nomeDe: (e: string | null) => string;
  anoAtual: number;
  salvando: boolean;
  erro: string | null;
  onEscolherIcone: (nome: string | null) => void;
}) {
  const servico = servicoDe(link.url);
  const rotulo = rotuloDoLink(link);
  const selo = seloDoLink(link.url);
  // O desenho que o selo mostra AGORA: a escolha de alguém, ou a dedução.
  const icone = iconeDoLink(link);
  // E o que o "Automático" entregaria — a mesma dedução, sem a escolha por
  // cima. É o que deixa a pessoa comparar antes de voltar ao padrão, em vez de
  // ter de escolher às cegas e conferir depois.
  const padrao = iconeDoLink({ ...link, icone: undefined });
  // O portão roda de novo sobre o que veio do banco. Quem grava passa por
  // `normalizarUrl`, mas o campo aceita escrita de qualquer pessoa do setor e do
  // console do Firestore — e o React não recusa um `javascript:` em `href`, só
  // avisa. Sem `href` o elemento deixa de ser link: não abre nada, que é a
  // falha certa para um endereço em que não se pode confiar.
  const destino = normalizarUrl(link.url) || undefined;
  const setorSolicitante = setorSolicitanteDe(card);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        {/* Cor de dado entra inline, como o projeto já faz com `tagColor` e
            `DEMAND_TYPE_COLOR`. Fundo e tinta saem JUNTOS de `seloDoLink`
            porque um depende do outro: branco chapado some no amarelo do
            Drive, e a marca sozinha não garante que a letra em cima se leia. */}
        <IconePicker
          valor={link.icone ?? null}
          deduzido={padrao}
          rotulo={rotulo}
          onEscolher={onEscolherIcone}
          disabled={salvando}
          className={styles.icone}
          style={{ background: selo.fundo, color: selo.tinta }}
        >
          {icone ? (
            <Icon name={icone} size={19} />
          ) : (
            // Sem serviço reconhecido e sem escolha, a pista é o monograma do
            // domínio — o mesmo que esta tela sempre mostrou.
            monogramaDe(link.url)
          )}
        </IconePicker>

        <div className={styles.cardTitulo}>
          {/* Texto, e não link. O destaque mudou de dono, mas quem chega nesta
              tela quer ABRIR O ENDEREÇO — transformar a área grande do card em
              navegação para o Kanban faria o clique óbvio levar ao lugar
              errado. O caminho para a demanda existe, à direita, e é menor de
              propósito. */}
          <div className={styles.demandaTitulo} title={card.title}>
            {card.title}
          </div>
          <div className={styles.cardMeta}>
            <span className={styles.estado}>{SERVICO_ROTULO[servico]}</span>
            {/* `noopener` não é enfeite: sem ele a página aberta recebe
                `window.opener` e pode redirecionar a aba do Smart Meeting por
                baixo, com o usuário achando que voltou para o app. */}
            <a
              className={styles.linkDoCard}
              href={destino}
              target="_blank"
              rel="noopener noreferrer"
              title={link.url}
            >
              {rotulo}
            </a>
          </div>
        </div>

        {/* Alvo separado e pequeno, ao lado do título a que ele se refere. O
            Kanban abre o card pelo par `?setor=&card=` na URL, como o
            Cronograma e as Recorrências já fazem.

            Sem número de linha de propósito: a referência anterior apontava
            para uma linha que já tinha se mexido, e comentário que aponta para
            o lugar errado é pior do que comentário nenhum — manda o próximo
            leitor procurar onde não está. O nome do parâmetro não migra. */}
        <Link
          className={styles.irDemanda}
          href={`/kanban?setor=${encodeURIComponent(card.sector)}&card=${card.id}`}
          title="Abrir a demanda no Kanban"
          aria-label={`Abrir a demanda ${card.title} no Kanban`}
        >
          <Icon name="kanban" size={14} />
        </Link>
      </div>

      {/* O erro mora NO CARD em que o clique aconteceu, e não no topo da tela:
          numa grade de dezenas, uma faixa lá em cima obrigaria a pessoa a
          descobrir sozinha a qual link ela se refere. */}
      {erro && (
        <div className={styles.erroIcone} role="alert">
          {erro}
        </div>
      )}

      <div className={styles.cardPe}>
        {/* Quem aparece no rodapé é o setor SOLICITANTE, para casar com o que
            o seletor do topo recorta. `card.sector` saiu daqui porque vale
            "B.I." em todo card do banco: um selo que repete a mesma palavra em
            cada card da grade gasta espaço sem informar nada e, agora,
            contradiria o filtro — a pessoa peneiraria por "RH" e leria "B.I."
            em tudo o que sobrasse. O `?setor=` do link ao lado continua sendo
            `card.sector`: lá é o quadro que precisa abrir, e é outro dado.

            Demanda sem setor solicitante fica sem o selo, em vez de ganhar um
            texto de ausência: a autoria já é empurrada para a direita pelo
            `margin-left: auto`, então o rodapé não desmonta sem ele. */}
        {setorSolicitante && (
          <span className={styles.setor}>{setorSolicitante}</span>
        )}
        <span className={styles.autoria}>
          {nomeDe(link.addedBy)} · {dataDe(link.addedAt, anoAtual)}
        </span>
      </div>
    </div>
  );
}

/** "12 ago" — com o ano só quando não é o corrente, que é quando ele informa. */
function dataDe(ms: number, anoAtual: number): string {
  const d = new Date(ms);
  const dia = fmtDayMonth(toISO(d));
  return d.getFullYear() === anoAtual ? dia : `${dia} de ${d.getFullYear()}`;
}
