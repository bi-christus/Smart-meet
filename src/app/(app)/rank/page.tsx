"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  columnsBySector,
  deliveredBySector,
  type Card,
  type ColumnDoc,
} from "@/lib/kanban";
import {
  POSICOES_DO_PODIO,
  alturaDoDegrau,
  maiorEntrega,
  montarRank,
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

  const podio = colocacoes.filter((c) => c.posicao <= POSICOES_DO_PODIO);
  const honra = colocacoes.filter((c) => c.posicao > POSICOES_DO_PODIO);
  const maior = maiorEntrega(colocacoes);

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
        <ErrorState
          error={fontes.erro}
          onRetry={() => {
            fCards.tentarDeNovo();
            fCols.tentarDeNovo();
            fUsers.tentarDeNovo();
            fTemporadaFechada.tentarDeNovo();
          }}
        />
      ) : fontes.carregando ? (
        /* O esqueleto é UM só, e a moldura em volta reserva a altura do pódio.
           Três círculos nos tamanhos reais dos degraus dizem o que vem — e a
           altura reservada é o que impede a tela de saltar quando vier. Dois
           esqueletos empilhados seriam duas regiões `aria-live` anunciando a
           mesma espera em sequência. */
        <div className={styles.esqueleto}>
          <SkeletonAvatar
            sizes={[TAM_AVATAR[2], TAM_AVATAR[1], TAM_AVATAR[3]]}
            texto="Montando o pódio…"
          />
        </div>
      ) : semFechamento ? (
        <EmptyState
          icon="rank"
          title="Esta temporada ainda não fechou"
          description="O fechamento acontece automaticamente no início do mês seguinte. Volte depois que a temporada terminar."
        />
      ) : colocacoes.length === 0 ? (
        <EmptyState
          icon="rank"
          title="Ainda não há demanda entregue por aqui"
          description={
            totalEntregas > 0 ? (
              <>
                As {totalEntregas} demandas já entregues neste setor estão sem
                responsável. O pódio conta por pessoa — preencha o responsável na
                demanda para ela entrar na contagem de alguém.
              </>
            ) : (
              <>
                O pódio se monta sozinho conforme as demandas chegam à etapa de
                entrega do quadro. Nada a fazer aqui além de entregar.
              </>
            )
          }
        />
      ) : (
        /* Pódio e fila de honra na MESMA superfície, e não dois blocos
           empilhados: era a faixa da arena terminando no pé do pódio que
           desenhava uma aresta atravessando a tela (Issue #133).

           `key` na temporada: trocar de mês no seletor troca a cena inteira, e
           remontar é o que faz o pódio novo ENTRAR — sem isso, a mesma
           plataforma fica no lugar e só os nomes mudam, o que se lê como falha
           de tela e não como outra temporada. */
        <div className={styles.arena} key={mesEscolhido}>
          <Podio colocacoes={podio} maior={maior} usersMap={usersMap} campea={!vendoAtual} />
          {honra.length > 0 && (
            <FilaDeHonra colocacoes={honra} usersMap={usersMap} />
          )}
        </div>
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
 * Diâmetro do rosto em cada degrau — a hierarquia é o TAMANHO, não a cor.
 *
 * O pedido era foto grande o bastante para reconhecer o rosto, e é isso que
 * decide a escala inteira desta tela: 112px no primeiro lugar contra os 30px da
 * topbar e os 22px do card do Kanban. O primeiro lugar ganha a cor da marca; o
 * resto fica em superfície neutra, e a diferença entre eles é a altura.
 */
const TAM_AVATAR: Record<number, number> = { 1: 112, 2: 88, 3: 88 };

/**
 * O pódio de verdade — segundo, primeiro, terceiro, nessa ordem na tela.
 *
 * A ORDEM VISUAL NÃO É A ORDEM DA LISTA, e é o que faz isto ser um pódio em vez
 * de um gráfico de barras deitado: o primeiro lugar fica no MEIO, mais alto, e
 * os dois outros o cercam. `order` no CSS resolveria, mas quebraria a ordem de
 * leitura de quem usa teclado e leitor de tela — que continuaria em 1, 2, 3
 * enquanto os olhos leem 2, 1, 3. Por isso a reordenação acontece aqui, no
 * array, e o DOM sai na mesma ordem em que o pódio é lido.
 *
 * A altura do bloco vem de `alturaDoDegrau` (`rank-core.ts`, com teste): piso
 * por colocação mais um acréscimo proporcional à contagem. Só proporcional, o
 * pódio dependia de o mês ter sido desigual — com 29, 28 e 22 entregas os três
 * blocos saíam quase da mesma altura e a silhueta de escada desaparecia.
 *
 * O QUE ESTE COMPONENTE PINTA é o PALCO: a foto, o holofote e o chão. A fila de
 * honra fica de fora dele e dentro da mesma arena — ver o comentário da folha
 * sobre a faixa que cortava a tela.
 */
function Podio({
  colocacoes,
  maior,
  usersMap,
  campea,
}: {
  colocacoes: Colocacao[];
  maior: number;
  usersMap: Record<string, UserProfile>;
  /** Temporada FECHADA sendo exibida — é o que acende o acento de campeão. */
  campea: boolean;
}) {
  const naOrdemDoPodio = useMemo(() => {
    const por = (p: number) => colocacoes.filter((c) => c.posicao === p);
    // Empates duplicam degraus (dois segundos lugares, por exemplo), e os dois
    // ficam do mesmo lado — o meio continua sendo de quem está em primeiro.
    return [...por(2), ...por(1), ...por(3)];
  }, [colocacoes]);

  return (
    <div className={styles.palco}>
      <div className={styles.podio}>
        {naOrdemDoPodio.map((c) => (
          <Degrau
            key={c.chave}
            colocacao={c}
            perfil={usersMap[c.chave]}
            maior={maior}
            campea={campea}
            atraso={ATRASO_POR_POSICAO[c.posicao] ?? ATRASO_POR_POSICAO[3]}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Quando cada degrau assenta — 3º, 2º, 1º, nessa ordem.
 *
 * É a ordem em que um pódio se anuncia em qualquer cerimônia do mundo, e ela
 * não é decorativa: o olho segue quem se mexe, então quem se mexe por último
 * fica sendo o assunto. A versão anterior escalonava pela posição no ARRAY
 * (2º, 1º, 3º) e entregava o desfecho no meio da frase — o campeão assentava
 * antes do terceiro colocado.
 *
 * Os 120ms de piso são o tempo de o palco acender antes de alguém subir nele
 * (`cortina`, em `rank.module.css`). Empate reparte o mesmo instante: dois
 * segundos lugares sobem juntos, porque juntos foi como ficaram.
 */
const ATRASO_POR_POSICAO: Record<number, number> = { 1: 300, 2: 210, 3: 120 };

/** Quanto tempo a contagem leva para chegar ao número. */
const DUR_CONTAGEM = 620;

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

function Degrau({
  colocacao,
  perfil,
  maior,
  atraso,
  campea,
}: {
  colocacao: Colocacao;
  perfil?: UserProfile;
  maior: number;
  atraso: number;
  campea: boolean;
}) {
  const { posicao, entregues, rotulo } = colocacao;
  // A regra da altura mora em `rank-core.ts`, com teste: é ela que decide o que
  // a tela AFIRMA sobre quem ganhou, e a escada tem de se sustentar mesmo num
  // mês em que todo mundo entregou quase a mesma coisa.
  const altura = alturaDoDegrau(posicao, entregues, maior);
  const contagem = useContagem(entregues, atraso + 70);

  return (
    <div
      className={`${styles.degrau} ${posicao === 1 ? styles.primeiro : ""}`}
      style={{ ["--atraso" as string]: `${atraso}ms` }}
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
        <Avatar
          pessoa={perfil ?? { name: rotulo, email: colocacao.chave }}
          size={TAM_AVATAR[posicao] ?? 88}
          alt=""
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
    </div>
  );
}

/**
 * Do quarto ao oitavo lugar, na mesma peça e não numa tabela à parte.
 *
 * São oito posições em um pódio, e não "um pódio de três mais uma lista": a
 * fila corre sobre uma base contínua que encosta na dos degraus altos, e a
 * escala do rosto continua caindo (52px) em vez de mudar de forma. Uma tabela
 * embaixo diria que do quarto lugar em diante o assunto é outro.
 */
function FilaDeHonra({
  colocacoes,
  usersMap,
}: {
  colocacoes: Colocacao[];
  usersMap: Record<string, UserProfile>;
}) {
  return (
    <ol className={styles.honra}>
      {colocacoes.map((c, i) => (
        <li
          key={c.chave}
          className={styles.honraItem}
          /* Depois do pódio inteiro — inclusive do troféu. A fila é o
             desfecho da cena, e desfecho que começa junto do clímax não é
             desfecho. */
          style={{ ["--atraso" as string]: `${420 + i * 40}ms` }}
        >
          <span className={styles.honraPos}>{c.posicao}º</span>
          <Avatar
            pessoa={usersMap[c.chave] ?? { name: c.rotulo, email: c.chave }}
            size={52}
            alt=""
          />
          <span className={styles.honraNome} title={c.rotulo}>
            {c.rotulo}
          </span>
          <span className={styles.honraNum}>
            {c.entregues} {c.entregues === 1 ? "entrega" : "entregas"}
          </span>
        </li>
      ))}
    </ol>
  );
}
