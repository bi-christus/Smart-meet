"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { subscribeUsers, type UserProfile } from "@/lib/users";
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
  TAM_PLATEIA,
  alturaDoDegrau,
  escalaDaFileira,
  maiorEntrega,
  montarRank,
  ordemNaFileira,
  partirCena,
  type Colocacao,
} from "@/lib/rank-core";
// A regra "este card conta como entrega, e de quem" saiu deste arquivo e virou
// módulo puro, porque os emblemas do perfil precisam EXATAMENTE dela. Duas
// cópias divergiriam no primeiro ajuste — e o sintoma seria o pódio e o emblema
// discordando sobre a mesma demanda, cada um com o próprio jeito de comparar
// e-mail.
import { entregasDoMes, mesAtual, rotuloMes } from "@/lib/temporadas-core";
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
import styles from "./rank.module.css";

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

  /** A temporada em exibição: ao vivo (mês corrente) ou congelada (mês passado). */
  const { colocacoes, totalEntregas, vencedores, semFechamento } = useMemo(() => {
    if (vendoAtual) {
      const { por, total } = entregasDoMes(cards, entreguesPorSetor, mesEscolhido);
      const ranking = montarRank(
        [...por.entries()].map(([email, entregues]) => ({
          chave: email,
          rotulo: usersMap[email]?.name || email,
          entregues,
        })),
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
    return {
      colocacoes: fechada.ranking,
      totalEntregas: fechada.entregas,
      vencedores: fechada.vencedores,
      semFechamento: false,
    };
  }, [vendoAtual, cards, entreguesPorSetor, mesEscolhido, usersMap, fTemporadaFechada.data]);

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
              ? `${totalEntregas} ${totalEntregas === 1 ? "demanda entregue" : "demandas entregues"} em ${sectors.join(", ")} · ${rotuloMes(mesEscolhido)}`
              : rotuloMes(mesEscolhido)
        }
        seletor={
          <Select
            value={mesEscolhido}
            options={seletorOpcoes}
            onChange={setMesEscolhido}
            ariaLabel="Temporada"
          />
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
            sizes={[TAM_PLATEIA, TAM_AVATAR[2], TAM_AVATAR[1], TAM_AVATAR[3], TAM_PLATEIA]}
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
        <Cena
          key={mesEscolhido}
          colocacoes={colocacoes}
          usersMap={usersMap}
          campea={!vendoAtual}
          onPerfil={setPerfilDe}
        />
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

function Cabecalho({ sub, seletor }: { sub: string; seletor?: React.ReactNode }) {
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
    </div>
  );
}

/**
 * Diâmetro do rosto de quem sobe em plinto — a hierarquia é o TAMANHO, não a cor.
 *
 * O pedido era foto grande o bastante para reconhecer o rosto, e é isso que
 * decide a escala inteira desta tela: 112px no primeiro lugar contra os 30px da
 * topbar e os 22px do card do Kanban. Quem está de pé no chão usa `TAM_PLATEIA`
 * (52px), que é o menor diâmetro em que um rosto ainda se reconhece.
 */
const TAM_AVATAR: Record<number, number> = { 1: 112, 2: 88, 3: 88 };

/**
 * A cena inteira: uma fileira só, ninguém abaixo de ninguém.
 *
 * O QUE MUDOU E POR QUÊ. Até aqui a tela era um pódio de três e, ABAIXO dele,
 * uma fila de cartões do 4º ao 8º — duas peças empilhadas, com a segunda lida
 * como "e também tem estes aqui". O Ítalo olhou o print e recusou: todo mundo
 * na mesma fileira. É o que esta cena faz, sem desmontar o pódio: os três
 * primeiros continuam sobre PLINTOS, e do quarto em diante as pessoas ficam DE
 * PÉ no mesmo chão, ao lado. Uma linha de contato só, dois tratamentos —
 * "estes três subiram, o resto está no palco" se lê sem legenda.
 *
 * A ORDEM. O 1º no meio, os demais descendo para as duas bordas
 * (… 6º 4º 2º **1º** 3º 5º 7º …). Quem calcula isso é `ordemNaFileira`, que
 * devolve `order` de CSS — e o comentário dela explica por que o DOM agora sai
 * em ordem de COLOCAÇÃO, revertendo a regra que este arquivo seguia quando o
 * pódio tinha três peças.
 *
 * QUANDO NÃO HÁ PÓDIO. `partirCena` decide, e não este componente: há meses em
 * que ninguém subiu — no dia 2 de qualquer temporada todo mundo tem uma entrega
 * e todo mundo está em primeiro. Ali a cena inteira vira fileira, com o rosto
 * maior, e o 1º lugar mantém o anel da marca sem plinto nenhum.
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
  const { degraus, plateia } = useMemo(() => partirCena(colocacoes), [colocacoes]);
  const maior = maiorEntrega(colocacoes);
  // Com pódio, quem está no chão é coadjuvante e usa o diâmetro mínimo. Sem
  // pódio, a fileira é tudo o que a tela tem, e o rosto cresce até onde a
  // quantidade de gente permitir.
  const rosto = degraus.length > 0 ? TAM_PLATEIA : escalaDaFileira(plateia.length);

  /**
   * Enquadra o campeão quando a fileira não cabe.
   *
   * `ref` de função, e não `useEffect`: o callback roda no commit, ANTES da
   * pintura. Num efeito, o primeiro quadro sairia com a rolagem em zero — quem
   * abre o Rank no telefone veria o último colocado, e o pódio entraria pela
   * direita depois. Sem `scroll-behavior: smooth` em lugar nenhum: enquadrar
   * antes de alguém olhar não é animação, e animar ali seria movimento sem
   * informação.
   */
  const enquadra = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);

  return (
    <div
      className={styles.trilho}
      ref={enquadra}
      /* Região rolável precisa ser alcançável por teclado (WCAG 2.1.1). Os
         rostos AGORA são focáveis — cada um virou botão que abre o perfil —, e
         normalmente isso já bastaria: tabular por eles rola o trilho sozinho.

         O `tabIndex` fica assim mesmo, e por um caso que existe: só vira botão
         quem está em `/users`. Um ranking cujas pessoas saíram do cadastro (ou
         uma temporada antiga de quem já não está na Rede) desenha uma fileira
         inteira de rostos não focáveis — e aí o trilho volta a ser uma região
         rolável sem nada dentro para alcançar. Uma parada a mais de Tab custa
         pouco; a região inalcançável custa a quem depende do teclado. */
      tabIndex={0}
      role="group"
      aria-label="Colocações da temporada"
    >
      {/* Um `<ol>` para o rank INTEIRO, com `value` em cada item — a semântica
          que a tela sempre afirmou e nunca teve (o pódio era `<div>` e só a
          fila era lista). */}
      <ol className={styles.fileira}>
        {/* `indice` é a posição na lista INTEIRA, e é o que decide de que lado
            da fileira a pessoa fica (`ordemNaFileira`). Como os degraus são
            sempre o começo do ranking, somar `degraus.length` no chão dá o
            índice global sem precisar concatenar as duas listas. */}
        {degraus.map((c, i) => (
          <Degrau
            key={c.chave}
            colocacao={c}
            perfil={usersMap[c.chave]}
            onPerfil={onPerfil}
            maior={maior}
            campea={campea}
            indice={i}
            atraso={ATRASO_POR_POSICAO[c.posicao] ?? ATRASO_POR_POSICAO[3]}
          />
        ))}
        {plateia.map((c, i) => (
          <NoChao
            key={c.chave}
            colocacao={c}
            perfil={usersMap[c.chave]}
            onPerfil={onPerfil}
            rosto={rosto}
            campea={campea}
            indice={degraus.length + i}
            /* Quem está no chão entra ANTES: é a sala tomando lugar, e a
               cerimônia começa depois que ela está cheia. */
            atraso={i * 24}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * Quando cada degrau assenta — 3º, 2º, 1º, nessa ordem.
 *
 * É a ordem em que um pódio se anuncia em qualquer cerimônia do mundo, e ela
 * não é decorativa: o olho segue quem se mexe, então quem se mexe por último
 * fica sendo o assunto.
 *
 * Os 120ms de piso são o tempo de a fileira do chão se formar antes de alguém
 * subir. Empate reparte o mesmo instante: dois segundos lugares sobem juntos,
 * porque juntos foi como ficaram.
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
 * Um plinto — o tratamento de quem chegou ao pódio.
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
}: {
  colocacao: Colocacao;
  perfil?: UserProfile;
  onPerfil: (p: UserProfile) => void;
  maior: number;
  atraso: number;
  campea: boolean;
  /** Posição na lista inteira — decide de que lado da fileira ele fica. */
  indice: number;
}) {
  const { posicao, entregues, rotulo } = colocacao;
  // A regra da altura mora em `rank-core.ts`, com teste: é ela que decide o que
  // a tela AFIRMA sobre quem ganhou, e a escada tem de se sustentar mesmo num
  // mês em que todo mundo entregou quase a mesma coisa.
  const altura = alturaDoDegrau(posicao, entregues, maior);
  const contagem = useContagem(entregues, atraso + 60);

  return (
    <li
      className={`${styles.degrau} ${posicao === 1 ? styles.primeiro : ""}`}
      value={posicao}
      style={{
        order: ordemNaFileira(indice),
        ["--atraso" as string]: `${atraso}ms`,
      }}
    >
      <div className={styles.rosto}>
        {/* O troféu só aparece no 1º lugar de uma temporada JÁ FECHADA — é o
            único momento em que "campeão" é um fato registrado, e não só a
            liderança do momento (que pode trocar até o mês acabar). */}
        {campea && posicao === 1 && (
          <span className={styles.trofeu} aria-hidden="true">
            <Icon name="trofeu" size={20} />
          </span>
        )}
        {/* alt vazio: o nome está escrito logo abaixo, dentro do mesmo bloco.

            `semMoldura` porque o degrau JÁ é uma moldura: `.rosto` desenha um
            anel em volta de cada rosto, e o do primeiro lugar é pintado na cor
            da marca com halo. Uma moldura pessoal por dentro daria três anéis
            concêntricos — e quem escolhesse a moldura "Cor da casa" apareceria
            no pódio exibindo o vocabulário visual reservado a quem está em
            primeiro. Tirar o anel do degrau não resolveria: "Cor da casa"
            continuaria imitando o campeão. */}
        {/**
         * `aoAbrirPerfil` SÓ quando a pessoa existe em `/users`.
         *
         * Sem cadastro não há perfil para abrir (ver `perfil-modal.tsx`), e um
         * rosto que vira botão para depois não abrir nada é a promessa que o
         * projeto inteiro evita. O fallback `{ name, email }` continua servindo
         * para DESENHAR o rosto — só não o torna clicável.
         *
         * E o `alt` deixa de ser vazio quando ele vira botão: em modo alvo o
         * `alt` é o rótulo do botão (`avatar.tsx`), e "Ana Souza" leria como se
         * o clique fizesse alguma coisa com a Ana. O nome continua escrito
         * embaixo, então repeti-lo aqui só ocuparia o rótulo que precisa dizer
         * o que acontece.
         */}
        <Avatar
          pessoa={perfil ?? { name: rotulo, email: colocacao.chave }}
          size={TAM_AVATAR[posicao] ?? 88}
          alt={perfil ? `Ver o perfil de ${rotulo}` : ""}
          aoAbrirPerfil={perfil ? () => onPerfil(perfil) : undefined}
          semMoldura
        />
      </div>
      <div className={styles.nome} title={rotulo}>
        {rotulo}
      </div>
      <div className={styles.bloco} style={{ height: altura }}>
        <span className={styles.posicao}>{posicao}º</span>
        {/* O número fica gravado no bloco, e não ao lado do nome: ele é a
            inscrição do degrau, não um segundo campo do cadastro da pessoa. Um
            pódio sem contagem não dá para conferir — e conferir é a primeira
            coisa que se faz olhando para um rank. */}
        {/* Duas cópias do mesmo número, e é de propósito: o leitor de tela não
            assiste à contagem subir. Ele lê o que estiver ali no instante em que
            o cursor virtual chega — que pode ser "7 entregas" no meio do
            caminho — e segue em frente sem nunca voltar. Quem vê recebe a
            contagem; quem ouve recebe o resultado. */}
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
 * De pé no chão, ao lado do pódio — do 4º em diante.
 *
 * NÃO É UM PLINTO MAIS BAIXO, e essa é a decisão inteira: estender a tabela de
 * alturas de `rank-core.ts` até a oitava posição parece a saída óbvia e derruba
 * a escada (os degraus entre pisos ficam menores que o acréscimo por contagem,
 * e o 8º passa o 7º com contagens perfeitamente comuns). Mais do que isso, oito
 * plintos encostados não são um pódio — são um gráfico de barras deitado, que é
 * exatamente o que o pódio existe para não ser.
 *
 * O que estas pessoas ganham no lugar do plinto é o CHÃO: elas assentam na
 * mesma linha de contato dos degraus, com um friso do mesmo material da laje.
 * Mesma cena, dois papéis — e ninguém abaixo de ninguém, que era o pedido.
 *
 * A contagem aqui NÃO sobe: cinco números correndo lado a lado viram ruído, e o
 * que eles anunciariam não é o assunto da cerimônia.
 */
function NoChao({
  colocacao,
  perfil,
  onPerfil,
  rosto,
  atraso,
  campea,
  indice,
}: {
  colocacao: Colocacao;
  perfil?: UserProfile;
  onPerfil: (p: UserProfile) => void;
  /** Diâmetro do rosto — cresce quando não há pódio (ver `escalaDaFileira`). */
  rosto: number;
  atraso: number;
  campea: boolean;
  /** Posição na lista inteira — decide de que lado da fileira ele fica. */
  indice: number;
}) {
  const { posicao, entregues, rotulo } = colocacao;

  return (
    <li
      className={`${styles.noChao} ${posicao === 1 ? styles.primeiro : ""}`}
      value={posicao}
      style={{
        order: ordemNaFileira(indice),
        ["--atraso" as string]: `${atraso}ms`,
        ["--rosto" as string]: `${rosto}px`,
      }}
    >
      <span className={styles.chaoPos}>{posicao}º</span>
      <div className={styles.rosto}>
        {campea && posicao === 1 && (
          <span className={styles.trofeu} aria-hidden="true">
            <Icon name="trofeu" size={16} />
          </span>
        )}
        <Avatar
          pessoa={perfil ?? { name: rotulo, email: colocacao.chave }}
          size={rosto}
          alt={perfil ? `Ver o perfil de ${rotulo}` : ""}
          aoAbrirPerfil={perfil ? () => onPerfil(perfil) : undefined}
          semMoldura
        />
      </div>
      <span className={styles.chaoNome} title={rotulo}>
        {rotulo}
      </span>
      <span className={styles.chaoNum}>
        {entregues} {entregues === 1 ? "entrega" : "entregas"}
      </span>
    </li>
  );
}
