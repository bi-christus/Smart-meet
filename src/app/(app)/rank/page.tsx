"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { avatarDe, subscribeUsers, type UserProfile } from "@/lib/users";
import { PerfilModal } from "@/components/perfil-modal";
import {
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  columnsBySector,
  deliveredBySector,
  type Card,
  type ColumnDoc,
} from "@/lib/kanban";
import {
  alturaDaBarra,
  maiorEntrega,
  montarRank,
  ordemNaFileira,
  type Colocacao,
} from "@/lib/rank-core";
import { ehEntrega } from "@/lib/entregas-core";
import { FUSO_DO_SETOR } from "@/lib/datas";
// A regra "este card conta como entrega, e de quem" saiu deste arquivo e virou
// módulo puro, porque os emblemas do perfil precisam EXATAMENTE dela. Duas
// cópias divergiriam no primeiro ajuste — e o sintoma seria o pódio e o emblema
// discordando sobre a mesma demanda, cada um com o próprio jeito de comparar
// e-mail.
import {
  entregasDoMes,
  mesAtual,
  mesDe,
  rotuloMes,
} from "@/lib/temporadas-core";
import {
  listarTemporadasFechadas,
  subscribeTemporadaFechada,
  type TemporadaFechada,
} from "@/lib/temporadas";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonAvatar } from "@/components/skeleton";
import { Select, type SelectOption } from "@/components/select";
import { Icon } from "@/components/icons";
import { Space_Mono } from "next/font/google";
import styles from "./rank.module.css";

/**
 * A fonte do título lateral (13/10/2026): monoespaçada de exibição, no estilo
 * terminal que o setor escolheu como referência. Carregada SÓ nesta tela —
 * fora do layout raiz de propósito, para nenhuma outra tela pagar o download.
 */
const monoTitulo = Space_Mono({
  subsets: ["latin"],
  weight: "700",
  variable: "--fonte-titulo",
});

/**
 * Rank — quem entregou, e quanto, TEMPORADA a temporada.
 *
 * É a única tela do app que fala de PESSOA e não de sistema, e ela existe
 * justamente porque o Dashboard não faz isso: "Consumo por responsável" mede
 * carga em aberto, que é o oposto — mede o que ainda não saiu. Nenhum painel de
 * lá responde "quem entregou mais", e essa é a pergunta que o pódio responde.
 *
 * CADA MÊS É UMA TEMPORADA (ver `temporadas-core.ts`). O padrão da tela é o mês
 * corrente, calculado ao vivo a partir das mesmas assinaturas de sempre —
 * `cards`/`columns` do setor — e recortado por `Card.enteredAt`. Uma temporada
 * PASSADA lê um documento CONGELADO em `temporadas/{mes}` (gravado pelo cron de
 * fechamento, `api/temporadas/fechar`): o pódio de um mês que já terminou não
 * recalcula depois, porque o vencedor daquele mês já foi anunciado — é fato
 * registrado, não um número que pode mudar se alguém editar uma demanda velha.
 *
 * O QUE CONTA COMO ENTREGA não é decidido aqui. É `colunasEntregues`
 * (`lib/kanban-columns`), a mesma regra do Dashboard, do Cronograma e do
 * relatório do gestor: a última coluna do quadro, mais qualquer coluna cujo nome
 * declare conclusão. Um "columnId === 'concluido'" escrito nesta tela erraria em
 * todo setor que renomeou a coluna, e erraria só aqui.
 *
 * DEMANDA NA LIXEIRA NÃO CONTA, e não há nada a fazer por isso nesta tela:
 * `subscribeCardsForSectors` filtra os excluídos na origem. Refiltrar seria
 * criar uma segunda verdade sobre o mesmo assunto.
 *
 * CARD SEM RESPONSÁVEL NÃO VIRA DEGRAU. O quadro tem demanda entregue sem
 * ninguém no campo de responsável, e "Sem responsável" no pódio seria um degrau
 * para uma pessoa que não existe — em cima de gente que existe. O total do
 * cabeçalho conta todas as entregas do recorte, inclusive essas: é a diferença
 * entre "o setor entregou" e "fulano entregou", e as duas são verdade.
 */

/** Vazias constantes: `?? []` no corpo recria o array e invalida os `useMemo`. */
const SEM_CARDS: Card[] = [];
const SEM_COLS: ColumnDoc[] = [];
const SEM_USERS: UserProfile[] = [];
const SEM_TEMPORADAS: TemporadaFechada[] = [];

export default function RankPage() {
  const { profile } = useAuth();

  const sectors = useSetoresDaPessoa(profile);

  const chaveSetores = sectors.join("|");
  const fCards = useAsyncData<Card>(chaveSetores, (onData, onErro) =>
    subscribeCardsForSectors(sectors, onData, onErro),
  );
  const fCols = useAsyncData<ColumnDoc>(chaveSetores, (onData, onErro) =>
    subscribeColumnsForSectors(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  // O mês corrente é o padrão da tela — sempre que a página monta de novo.
  const [mesCorrente] = useState(() => mesAtual());
  const [mesEscolhido, setMesEscolhido] = useState(mesCorrente);
  /** A pessoa cujo rosto foi clicado — `null` enquanto ninguém clicou. */
  const [perfilDe, setPerfilDe] = useState<UserProfile | null>(null);
  const vendoAtual = mesEscolhido === mesCorrente;
  /**
   * O setor do pódio (#215). O Rank é INDIVIDUAL POR SETOR — não existe a vista
   * "todos juntos": quem entrega no B.I. não disputa com quem entrega nas
   * Cantinas. Derivado na leitura: sem escolha (ou com um setor que saiu da
   * lista da pessoa), vale o primeiro setor DELA — e não o primeiro do
   * cadastro, que para o admin pode ser um setor em que ele nem trabalha.
   */
  const [setorEscolhido, setSetorEscolhido] = useState("");
  const setorDoPodio = sectors.includes(setorEscolhido)
    ? setorEscolhido
    : (profile?.sectors ?? []).find((s) => sectors.includes(s)) || sectors[0] || "";

  const fTemporadasFechadas = useAsyncData<TemporadaFechada>(
    "temporadas-fechadas",
    listarTemporadasFechadas,
  );
  // Doc único, embrulhado em array de 0 ou 1: é o que permite `useAsyncData`
  // distinguir "ainda carregando" (`undefined`) de "este mês nunca fechou"
  // (`[]`) sem inventar um terceiro tipo de estado.
  const fTemporadaFechada = useAsyncData<TemporadaFechada>(
    vendoAtual ? "__atual__" : mesEscolhido,
    (onData, onErro) => {
      if (vendoAtual) return () => {};
      return subscribeTemporadaFechada(
        mesEscolhido,
        (t) => onData(t ? [t] : []),
        onErro,
      );
    },
  );

  const cards = fCards.data ?? SEM_CARDS;
  const cols = fCols.data ?? SEM_COLS;
  const users = fUsers.data ?? SEM_USERS;
  const temporadasFechadas = fTemporadasFechadas.data ?? SEM_TEMPORADAS;

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);

  const entreguesPorSetor = useMemo(
    () => deliveredBySector(columnsBySector(cols, sectors)),
    [cols, sectors],
  );

  /** As demandas do pódio da temporada atual: só as do setor escolhido. */
  const cardsDoPodio = useMemo(
    () => cards.filter((c) => c.sector === setorDoPodio),
    [cards, setorDoPodio],
  );


  /** A temporada em exibição: ao vivo (mês corrente) ou congelada (mês passado). */
  const { colocacoes, totalEntregas, vencedores, semFechamento } = useMemo(() => {
    if (vendoAtual) {
      const { por, total } = entregasDoMes(cardsDoPodio, entreguesPorSetor, mesEscolhido);
      const ranking = montarRank(
        [...por.entries()].map(([email, entregues]) => ({
          chave: email,
          rotulo: usersMap[email]?.name || email,
          entregues,
        })),
        // Sem teto: o gráfico mostra TODO MUNDO que entregou (13/10/2026). A
        // temporada fechada continua como foi gravada, com o teto de então.
        Number.POSITIVE_INFINITY,
      );
      // Mês em andamento não tem campeão OFICIAL ainda — só o cron do dia 1
      // registra um vencedor, e é isso que separa "quem está na frente agora"
      // de "quem venceu a temporada".
      return { colocacoes: ranking, totalEntregas: total, vencedores: [] as string[], semFechamento: false };
    }
    const fechada = fTemporadaFechada.data?.[0];
    if (!fechada) {
      return { colocacoes: [] as Colocacao[], totalEntregas: 0, vencedores: [] as string[], semFechamento: true };
    }
    /**
     * TEMPORADA FECHADA DEPOIS DE #215: tem o pódio de cada setor, e a tela
     * mostra o do setor escolhido. Setor ausente da lista não teve card no
     * mês — o pódio dele é vazio, e a tela diz isso.
     *
     * FECHADA ANTES: só existe o pódio geral, e ele aparece como foi gravado,
     * com o aviso na linha do título (ver `foiGeral`). Recontar por setor
     * agora mudaria quem a tela diz que venceu um mês já anunciado.
     */
    if (fechada.porSetor) {
      const doSetor = fechada.porSetor.find((p) => p.setor === setorDoPodio);
      return {
        colocacoes: doSetor?.ranking ?? [],
        totalEntregas: doSetor?.entregas ?? 0,
        vencedores: doSetor?.vencedores ?? [],
        semFechamento: false,
      };
    }
    return {
      colocacoes: fechada.ranking,
      totalEntregas: fechada.entregas,
      vencedores: fechada.vencedores,
      semFechamento: false,
    };
  }, [vendoAtual, cardsDoPodio, entreguesPorSetor, mesEscolhido, usersMap, fTemporadaFechada.data, setorDoPodio]);

  /**
   * As demandas entregues na temporada, da mais recente para a mais antiga — a
   * lista ao lado do gráfico. Mesmo recorte do pódio ao vivo (`enteredAt` no
   * mês, numa coluna de entrega do setor), lido dos cards, então vale também
   * para a temporada fechada, cujo documento não guardou demanda nenhuma.
   */
  const entregasDaTemporada = useMemo(
    () =>
      cardsDoPodio
        .filter(
          (c) =>
            typeof c.enteredAt === "number" &&
            mesDe(c.enteredAt) === mesEscolhido &&
            ehEntrega(c, entreguesPorSetor),
        )
        .sort((a, b) => (b.enteredAt ?? 0) - (a.enteredAt ?? 0)),
    [cardsDoPodio, mesEscolhido, entreguesPorSetor],
  );

  /** A temporada fechada exibida é das antigas, sem pódio por setor. */
  const foiGeral = !vendoAtual && !!fTemporadaFechada.data?.[0] && !fTemporadaFechada.data[0].porSetor;

  const fontes = vendoAtual
    ? juntarFontes([fCards, fCols, fUsers])
    : juntarFontes([fTemporadaFechada, fUsers]);

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <Cabecalho sub="" />
        <div className={styles.vazioTela}>
          Você ainda não participa de nenhum setor. Peça ao administrador para
          incluí-lo em um.
        </div>
      </div>
    );
  }

  const seletorOpcoes: SelectOption[] = [
    { value: mesCorrente, label: "Temporada atual" },
    ...temporadasFechadas.map((t) => ({ value: t.mes, label: rotuloMes(t.mes) })),
  ];


  return (
    <div className={styles.page}>
      <Cabecalho
        sub={
          fontes.carregando || fontes.erro
            ? ""
            : vendoAtual
              ? /* A linha era a lista inteira dos setores da pessoa — para o
                   admin, quinze nomes numa linha só. O setor agora está nas
                   abas logo abaixo, e esta linha diz só o que mede. */
                [
                  `${totalEntregas} ${totalEntregas === 1 ? "demanda entregue" : "demandas entregues"}`,
                  rotuloMes(mesEscolhido),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : foiGeral
                ? `${rotuloMes(mesEscolhido)} · fechada antes da divisão por setor: este é o pódio de todos os setores, como foi registrado`
                : `${totalEntregas} ${totalEntregas === 1 ? "demanda entregue" : "demandas entregues"} · ${rotuloMes(mesEscolhido)}`
        }
        seletor={
          /* Num invólucro de largura própria: o `<Select>` ocupa 100% do pai,
             e solto no cabeçalho ele atravessava a tela inteira. */
          <div className={styles.seletor}>
            <Select
              value={mesEscolhido}
              options={seletorOpcoes}
              onChange={setMesEscolhido}
              ariaLabel="Temporada"
            />
          </div>
        }
        setores={
          /* Um pódio por setor, sempre — sem "todos juntos". As abas somem só
             para quem tem um setor (repetiriam o título) e nas temporadas
             antigas, que não guardaram pódio por setor. */
          sectors.length > 1 && !foiGeral ? (
            <div className={styles.setores} role="tablist" aria-label="Setor do pódio">
              {sectors.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={setorDoPodio === s}
                  className={`${styles.setor} ${setorDoPodio === s ? styles.setorOn : ""}`}
                  onClick={() => setSetorEscolhido(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null
        }
      />

      {!vendoAtual && vencedores.length > 0 && (
        <p className={styles.campea}>
          <Icon name="trofeu" size={14} />
          {vencedores.length === 1 ? " Campeã(o) da temporada: " : " Campeãs(ões) da temporada: "}
          {vencedores
            .map((chave) => colocacoes.find((c) => c.chave === chave)?.rotulo ?? chave)
            .join(", ")}
        </p>
      )}

      {fontes.erro ? (
        /* `painelSobreFoto` embrulha o que NÃO é o pódio, e não é enfeite: com
           a foto atrás da aba inteira, `EmptyState` e `ErrorState` perderam a
           premissa com que foram desenhados — eles não pintam fundo nenhum
           (`empty-state.module.css`) porque sempre caíram sobre `var(--bg)`.
           Sobre a foto, o título deles (`--tx`) fica preto sobre cena escura
           nos três temas claros. A superfície opaca DEVOLVE a premissa, em vez
           de sobrescrever os tokens de um componente que oito telas usam. */
        <div className={styles.painelSobreFoto}>
          <ErrorState
            error={fontes.erro}
            onRetry={() => {
              fCards.tentarDeNovo();
              fCols.tentarDeNovo();
              fUsers.tentarDeNovo();
              fTemporadaFechada.tentarDeNovo();
            }}
          />
        </div>
      ) : fontes.carregando ? (
        /* O esqueleto é UM só, e a moldura em volta reserva a altura do pódio.
           Três círculos nos tamanhos reais dos degraus dizem o que vem — e a
           altura reservada é o que impede a tela de saltar quando vier. Dois
           esqueletos empilhados seriam duas regiões `aria-live` anunciando a
           mesma espera em sequência. */
        <div className={styles.esqueleto}>
          <SkeletonAvatar
            sizes={[64, 88, 112, 88, 64]}
            texto="Montando o pódio…"
          />
        </div>
      ) : semFechamento ? (
        <div className={styles.painelSobreFoto}>
          <EmptyState
            icon="rank"
            title="Esta temporada ainda não fechou"
            description="O fechamento acontece automaticamente no início do mês seguinte. Volte depois que a temporada terminar."
          />
        </div>
      ) : colocacoes.length === 0 ? (
        <div className={styles.painelSobreFoto}>
          <EmptyState
            icon="rank"
            title="Ainda não há demanda entregue por aqui"
            description={
              totalEntregas > 0 ? (
                <>
                  As {totalEntregas} demandas já entregues neste setor estão sem
                  responsável. O pódio conta por pessoa — preencha o responsável
                  na demanda para ela entrar na contagem de alguém.
                </>
              ) : (
                <>
                  O pódio se monta sozinho conforme as demandas chegam à etapa de
                  entrega do quadro. Nada a fazer aqui além de entregar.
                </>
              )
            }
          />
        </div>
      ) : (
        /* `key` na temporada: trocar de mês no seletor troca o ELENCO, e
           remontar é o que faz o pódio novo entrar em cena — sem isso, a mesma
           plataforma fica no lugar e só os nomes mudam, o que se lê como falha
           de tela e não como outra temporada. A `key` fica AQUI, e não na
           `.page`: a sala não se reconstrói quando muda o mês, só quem sobe
           nela. */
        /* O cartaz (13/10/2026): o título na lateral, como o "RACE RESULT"
           da referência; à direita o gráfico com todo mundo e, embaixo, as
           entregas da temporada da mais recente para a mais antiga. */
        <div className={styles.palco}>
          <TituloLateral />
          <div className={styles.palcoCorpo}>
            <Cena
              /* O setor entra na chave junto do mês: trocar de setor também
                 troca o elenco, e o gráfico novo precisa entrar em cena. */
              key={`${mesEscolhido}|${setorDoPodio}`}
              colocacoes={colocacoes}
              usersMap={usersMap}
              campea={!vendoAtual}
              onPerfil={setPerfilDe}
            />
            <ListaDeEntregas entregas={entregasDaTemporada} usersMap={usersMap} />
          </div>
        </div>
      )}

      {/**
       * O mesmo perfil que o Kanban abre, e de propósito o MESMO componente.
       *
       * Lá o rosto no card responde "de quem é esta demanda"; aqui ele responde
       * "quem é esse que entregou 14" — a pergunta que o Rank provoca e que, até
       * agora, morria no clique. Duas telas com o mesmo elemento e
       * comportamentos diferentes ensinam que o rosto às vezes é botão, e aí
       * ninguém tenta em lugar nenhum.
       */}
      {perfilDe && (
        <PerfilModal
          modo="outra-pessoa"
          pessoa={perfilDe}
          onClose={() => setPerfilDe(null)}
        />
      )}
    </div>
  );
}

function Cabecalho({
  sub,
  seletor,
  setores,
}: {
  sub: string;
  seletor?: React.ReactNode;
  /** As abas de setor do pódio — só na temporada atual (#215). */
  setores?: React.ReactNode;
}) {
  return (
    <div className={styles.head}>
      <div className={styles.headTopo}>
        <h1>Rank</h1>
        {seletor}
      </div>
      {/* A linha some enquanto não se sabe, em vez de dizer "0 demandas
          entregues" com a autoridade de um número pronto — mesma regra dos
          chips do Dashboard. */}
      {sub && <p>{sub}</p>}
      {setores}
    </div>
  );
}

/**
 * O tamanho do retrato — a hierarquia é o TAMANHO, não a cor, como sempre foi.
 *
 * Retrato e não círculo (13/10/2026): o desenho segue o cartaz de resultado de
 * corrida que o setor escolheu — foto em cartão de canto arredondado em cima,
 * com a colocação escrita na vertical ao lado ("P1"). A foto é a do perfil de
 * cada pessoa (`avatarDe`), a mesma do resto do app.
 *
 * Com muita gente a fileira inteira encolhe um degrau, para caber sem rolar
 * nas temporadas comuns.
 */
function tamanhoDoRetrato(posicao: number, quantos: number): { w: number; h: number } {
  const base = posicao === 1 ? 124 : posicao <= 3 ? 100 : 76;
  const fator = quantos <= 6 ? 1 : quantos <= 10 ? 0.84 : 0.7;
  const w = Math.round(base * fator);
  return { w, h: Math.round(w * 1.22) };
}

/**
 * A cena: TODO MUNDO em barra (13/10/2026).
 *
 * Até aqui só os três primeiros subiam em plinto e o resto ficava de pé no
 * chão. O pedido mudou para todos no gráfico de barras: cada pessoa ganha a
 * sua, do mesmo material de pedra de antes, com a altura de `alturaDaBarra` —
 * os três primeiros mantêm a escada do pódio, e do 4º em diante a barra é
 * proporcional à contagem, sempre abaixo do 3º.
 *
 * A ORDEM continua a de `ordemNaFileira`: o 1º no meio, os demais descendo para
 * as bordas, e o DOM em ordem de colocação dentro de um `<ol>`.
 */
function Cena({
  colocacoes,
  usersMap,
  campea,
  onPerfil,
}: {
  colocacoes: Colocacao[];
  usersMap: Record<string, UserProfile>;
  /** Temporada FECHADA sendo exibida — é o que acende o acento de campeão. */
  campea: boolean;
  onPerfil: (p: UserProfile) => void;
}) {
  const maior = maiorEntrega(colocacoes);

  /**
   * Enquadra o campeão quando a fileira não cabe. `ref` de função, e não
   * `useEffect`: roda antes da pintura, e o primeiro quadro já sai centrado.
   */
  const enquadra = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);

  return (
    <div
      className={styles.trilho}
      ref={enquadra}
      /* Região rolável alcançável por teclado (WCAG 2.1.1): quem saiu do
         cadastro não vira botão, e a fileira pode não ter nada focável. */
      tabIndex={0}
      role="group"
      aria-label="Colocações da temporada"
    >
      <ol className={styles.fileira}>
        {colocacoes.map((c, i) => (
          <Degrau
            key={c.chave}
            colocacao={c}
            perfil={usersMap[c.chave]}
            onPerfil={onPerfil}
            maior={maior}
            campea={campea}
            indice={i}
            retrato={tamanhoDoRetrato(c.posicao, colocacoes.length)}
            atraso={ATRASO_POR_POSICAO[c.posicao] ?? i * 24}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * Quando cada barra assenta — 3º, 2º, 1º, nessa ordem, como num pódio. Do 4º
 * em diante elas entram antes, em sequência curta: é a sala tomando lugar, e a
 * cerimônia começa depois.
 */
const ATRASO_POR_POSICAO: Record<number, number> = { 1: 240, 2: 180, 3: 120 };

/**
 * Quanto tempo a contagem leva para chegar ao número.
 *
 * 420ms, e não 620: assim ela roda DENTRO da janela em que o plinto cresce do
 * chão. Bloco subindo com número subindo é um gesto só; desencontrados, são
 * dois — e o segundo continua se mexendo depois que a cena já assentou.
 */
const DUR_CONTAGEM = 420;

/**
 * A contagem sobe até o número, uma vez, na chegada.
 *
 * POR QUE ISTO GANHA O LUGAR, num app que proíbe motion decorativo (AGENTS.md
 * §3): o número É o conteúdo desta tela. Um rank existe para dizer QUANTO, e
 * ver o quanto se acumular é a única animação aqui que carrega informação em
 * vez de enfeitar quem já a tem. Passa na Frequency Gate com folga — acontece
 * uma vez por carga de uma tela que se abre de vez em quando, não a cada clique.
 *
 * Só no PÓDIO, e não na fila de honra: cinco contagens correndo lado a lado
 * viram ruído numérico, e o que elas anunciariam (a 6ª colocação) não é o
 * assunto da cerimônia.
 *
 * O DESLIGAMENTO PARA MOVIMENTO REDUZIDO É EM JAVASCRIPT, e tem de ser: o
 * bloco `prefers-reduced-motion` da folha desliga `animation`, e isto aqui não
 * é animação — é texto trocando. CSS nenhum congela um `setState`.
 *
 * O ESTADO É O PROGRESSO (0 a 1), E NÃO O NÚMERO, por duas razões que só
 * aparecem quando o dado muda embaixo da tela — e ele muda: o Firestore é ao
 * vivo, e uma demanda entregue enquanto alguém olha o pódio altera a contagem.
 * Guardando o número, o efeito precisaria de `alvo` nas dependências e
 * recomeçaria a contagem do zero a cada entrega, com um quadro piscando em "0".
 * Guardando o progresso, o número novo simplesmente aparece — e quem pediu
 * movimento reduzido nasce com progresso 1, sem `setState` nenhum dentro do
 * efeito (que é, além de tudo, o que o lint do projeto proíbe).
 *
 * O valor inicial consulta a preferência, o que no servidor responderia
 * diferente do navegador. Não há hidratação a divergir: sem `profile` a página
 * inteira devolve `null`, então este componente só existe no cliente.
 */
function useContagem(alvo: number, atraso: number): number {
  const [progresso, setProgresso] = useState(() => (semMovimento() ? 1 : 0));

  useEffect(() => {
    if (semMovimento()) return;
    let raf = 0;
    let inicio = 0;
    const passo = (t: number) => {
      inicio ||= t;
      const p = Math.min(1, (t - inicio) / DUR_CONTAGEM);
      // Cúbica de saída: rápido no começo e devagar no fim é o que faz a
      // contagem PARAR num número em vez de ser interrompida nele.
      setProgresso(1 - (1 - p) ** 3);
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    const id = setTimeout(() => (raf = requestAnimationFrame(passo)), atraso);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [atraso]);

  return Math.round(alvo * progresso);
}

/** No servidor não há preferência a consultar — e não há movimento a fazer. */
function semMovimento(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A barra de uma pessoa: retrato em cima, nome, e a pedra com a colocação.
 *
 * `<li>` com `value`, e não `<div>`: dentro do `<ol>` da cena, é o `value` que
 * carrega a colocação para quem usa leitor de tela mesmo com o `order` do CSS
 * embaralhando o desenho.
 */
function Degrau({
  colocacao,
  perfil,
  onPerfil,
  maior,
  atraso,
  campea,
  indice,
  retrato,
}: {
  colocacao: Colocacao;
  perfil?: UserProfile;
  onPerfil: (p: UserProfile) => void;
  maior: number;
  atraso: number;
  campea: boolean;
  /** Posição na lista inteira — decide de que lado da fileira ele fica. */
  indice: number;
  retrato: { w: number; h: number };
}) {
  const { posicao, entregues, rotulo } = colocacao;
  // A regra da altura mora em `rank-core.ts`, com teste: é ela que decide o que
  // a tela AFIRMA sobre quem ganhou.
  const altura = alturaDaBarra(posicao, entregues, maior);
  const contagem = useContagem(entregues, atraso + 60);
  const podio = posicao <= 3;

  return (
    <li
      className={`${styles.degrau} ${posicao === 1 ? styles.primeiro : ""} ${podio ? "" : styles.resto}`}
      value={posicao}
      style={{
        order: ordemNaFileira(indice),
        ["--atraso" as string]: `${atraso}ms`,
        ["--retrato-w" as string]: `${retrato.w}px`,
        ["--retrato-h" as string]: `${retrato.h}px`,
      }}
    >
      <Retrato
        pessoa={perfil ?? { name: rotulo, email: colocacao.chave }}
        rotulo={rotulo}
        posicao={posicao}
        campea={campea}
        aoAbrir={perfil ? () => onPerfil(perfil) : undefined}
      />
      <div className={styles.nome} title={rotulo}>
        {rotulo}
      </div>
      <div className={styles.bloco} style={{ height: altura }}>
        <span className={styles.posicao}>{posicao}º</span>
        {/* Duas cópias do mesmo número, e é de propósito: o leitor de tela não
            assiste à contagem subir. Quem vê recebe a contagem; quem ouve
            recebe o resultado. */}
        <span className={styles.entregas}>
          <span aria-hidden="true">
            {contagem} {contagem === 1 ? "entrega" : "entregas"}
          </span>
          <span className={styles.soLeitor}>
            {entregues} {entregues === 1 ? "entrega" : "entregas"}
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * O retrato no estilo do cartaz de corrida: cartão com a foto do perfil
 * cobrindo tudo e a colocação escrita na vertical ao lado ("P1").
 *
 * A foto é a mesma do resto do app (`avatarDe`: a escolhida no perfil, depois a
 * do Google, depois a inicial na cor da pessoa). Sem foto, a inicial ocupa o
 * cartão inteiro, para o cartão nunca ficar vazio.
 *
 * Vira BOTÃO só quando a pessoa existe em `/users` — sem cadastro não há perfil
 * para abrir, e um retrato clicável que não abre nada é a promessa que o
 * projeto inteiro evita.
 */
function Retrato({
  pessoa,
  rotulo,
  posicao,
  campea,
  aoAbrir,
}: {
  pessoa: Parameters<typeof avatarDe>[0];
  rotulo: string;
  posicao: number;
  campea: boolean;
  aoAbrir?: () => void;
}) {
  const [srcQueFalhou, setSrcQueFalhou] = useState<string | null>(null);
  const escolha = avatarDe(pessoa);
  const foto = escolha.tipo === "foto" && escolha.src !== srcQueFalhou ? escolha.src : null;

  const miolo = (
    <>
      {foto ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URI do perfil, sem otimização a fazer
        <img
          src={foto}
          alt=""
          className={styles.retratoFoto}
          onError={() => setSrcQueFalhou(foto)}
        />
      ) : (
        <span
          className={styles.retratoInicial}
          style={{ background: escolha.tipo === "inicial" ? escolha.cor : undefined }}
          aria-hidden="true"
        >
          {escolha.tipo === "inicial" ? escolha.letra : rotulo.charAt(0)}
        </span>
      )}
      <span className={styles.retratoPos} aria-hidden="true">
        P{posicao}
      </span>
      {/* O troféu só no 1º lugar de uma temporada JÁ FECHADA — o único momento
          em que "campeão" é fato registrado, e não liderança do momento. */}
      {campea && posicao === 1 && (
        <span className={styles.trofeu} aria-hidden="true">
          <Icon name="trofeu" size={18} />
        </span>
      )}
    </>
  );

  return aoAbrir ? (
    <button
      type="button"
      className={styles.retrato}
      onClick={aoAbrir}
      aria-label={`Ver o perfil de ${rotulo}`}
    >
      {miolo}
    </button>
  ) : (
    <div className={styles.retrato}>{miolo}</div>
  );
}

/**
 * O título na lateral, no lugar do "RACE RESULT" do cartaz: "Smart Meeting"
 * de baixo para cima, em monoespaçada de terminal, e o "S2" na cor da marca
 * com o asterisco do prompt. Decorativo para o leitor de tela — o `<h1>` do
 * cabeçalho já nomeia a tela.
 */
function TituloLateral() {
  return (
    <div className={`${styles.tituloLateral} ${monoTitulo.variable}`} aria-hidden="true">
      <span className={styles.tituloGrande}>Smart Meeting</span>
      <span className={styles.tituloAcento}>*S2</span>
    </div>
  );
}

/** "13/10" do instante, no fuso de quem trabalha. */
const DIA_MES = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DO_SETOR,
  day: "2-digit",
  month: "2-digit",
});

/**
 * As demandas entregues na temporada, da mais recente para a mais antiga — no
 * lugar da lista de pilotos do cartaz.
 *
 * Cada linha: a ordem, o rosto de quem entregou, o nome em cima e a demanda em
 * destaque embaixo (como nome e sobrenome no cartaz), e o dia da entrega à
 * direita, onde o cartaz põe os pontos.
 */
function ListaDeEntregas({
  entregas,
  usersMap,
}: {
  entregas: Card[];
  usersMap: Record<string, UserProfile>;
}) {
  if (!entregas.length) return null;
  return (
    <section className={styles.lista} aria-label="Demandas entregues na temporada">
      <h2 className={styles.listaTitulo}>
        Entregas da temporada <span>{entregas.length}</span>
      </h2>
      <ol className={styles.listaItens}>
        {entregas.map((c, i) => {
          const quem = c.assignee ? usersMap[c.assignee] : undefined;
          const nome = quem?.name || c.assignee || "Sem responsável";
          return (
            <li key={c.id} className={styles.listaLinha}>
              <span className={styles.listaNum}>{i + 1}</span>
              <Avatar
                pessoa={quem ?? { name: nome, email: c.assignee ?? "" }}
                size={34}
                semMoldura
              />
              <span className={styles.listaTexto}>
                <span className={styles.listaQuem}>{nome}</span>
                <span className={styles.listaDemanda} title={c.title}>
                  {c.title}
                </span>
              </span>
              <span className={styles.listaData}>
                {typeof c.enteredAt === "number" ? DIA_MES.format(new Date(c.enteredAt)) : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
