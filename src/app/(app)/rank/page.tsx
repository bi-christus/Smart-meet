"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
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
  maiorEntrega,
  montarRank,
  type Colocacao,
} from "@/lib/rank-core";
// A regra "este card conta como entrega, e de quem" saiu deste arquivo e virou
// módulo puro, porque os emblemas do perfil precisam EXATAMENTE dela. Duas
// cópias divergiriam no primeiro ajuste — e o sintoma seria o pódio e o emblema
// discordando sobre a mesma demanda, cada um com o próprio jeito de comparar
// e-mail.
import { entregasPorPessoa } from "@/lib/entregas-core";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonAvatar } from "@/components/skeleton";
import styles from "./rank.module.css";

/**
 * Rank — quem entregou, e quanto.
 *
 * É a única tela do app que fala de PESSOA e não de sistema, e ela existe
 * justamente porque o Dashboard não faz isso: "Consumo por responsável" mede
 * carga em aberto, que é o oposto — mede o que ainda não saiu. Nenhum painel de
 * lá responde "quem entregou mais", e essa é a pergunta que o pódio responde.
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

export default function RankPage() {
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
  const fCols = useAsyncData<ColumnDoc>(chaveSetores, (onData, onErro) =>
    subscribeColumnsForSectors(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const cols = fCols.data ?? SEM_COLS;
  const users = fUsers.data ?? SEM_USERS;

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);

  const entreguesPorSetor = useMemo(
    () => deliveredBySector(columnsBySector(cols, sectors)),
    [cols, sectors],
  );

  /** Entregas por pessoa, e o total do recorte — inclusive o que não tem dono. */
  const { colocacoes, totalEntregas } = useMemo(() => {
    const { por, total } = entregasPorPessoa(cards, entreguesPorSetor);
    return {
      colocacoes: montarRank(
        [...por.entries()].map(([email, entregues]) => ({
          chave: email,
          // O rótulo desempata a ORDEM de quem já empatou em número, então ele
          // tem de ser o que se lê na tela. Ordenar por e-mail deixaria dois
          // empatados em ordem que a tela não explica.
          rotulo: usersMap[email]?.name || email,
          entregues,
        })),
      ),
      totalEntregas: total,
    };
  }, [cards, entreguesPorSetor, usersMap]);

  const fontes = juntarFontes([fCards, fCols, fUsers]);

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

  const podio = colocacoes.filter((c) => c.posicao <= POSICOES_DO_PODIO);
  const honra = colocacoes.filter((c) => c.posicao > POSICOES_DO_PODIO);
  const maior = maiorEntrega(colocacoes);

  return (
    <div className={styles.page}>
      <Cabecalho
        sub={
          fontes.carregando || fontes.erro
            ? ""
            : `${totalEntregas} ${totalEntregas === 1 ? "demanda entregue" : "demandas entregues"} em ${sectors.join(", ")}`
        }
      />

      {fontes.erro ? (
        <ErrorState
          error={fontes.erro}
          onRetry={() => {
            fCards.tentarDeNovo();
            fCols.tentarDeNovo();
            fUsers.tentarDeNovo();
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
        <>
          <Podio colocacoes={podio} maior={maior} usersMap={usersMap} />
          {honra.length > 0 && (
            <FilaDeHonra colocacoes={honra} usersMap={usersMap} />
          )}
        </>
      )}
    </div>
  );
}

function Cabecalho({ sub }: { sub: string }) {
  return (
    <div className={styles.head}>
      <h1>Rank</h1>
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
 * topbar e os 22px do card do Kanban. Ouro, prata e bronze ficaram de fora de
 * propósito — são três plásticos que brigam com o laranja da marca e não dizem
 * nada que a altura do degrau já não diga. O primeiro lugar ganha a cor da
 * marca; o resto fica em superfície neutra, e a diferença entre eles é a altura.
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
 * A altura do bloco é proporcional à contagem, com um piso: um degrau de altura
 * zero — quem tem 1 entrega ao lado de quem tem 40 — deixaria a pessoa de pé no
 * chão, o que se lê como "não subiu ao pódio".
 */
function Podio({
  colocacoes,
  maior,
  usersMap,
}: {
  colocacoes: Colocacao[];
  maior: number;
  usersMap: Record<string, UserProfile>;
}) {
  const naOrdemDoPodio = useMemo(() => {
    const por = (p: number) => colocacoes.filter((c) => c.posicao === p);
    // Empates duplicam degraus (dois segundos lugares, por exemplo), e os dois
    // ficam do mesmo lado — o meio continua sendo de quem está em primeiro.
    return [...por(2), ...por(1), ...por(3)];
  }, [colocacoes]);

  return (
    <div className={styles.podio}>
      {naOrdemDoPodio.map((c, i) => (
        <Degrau
          key={c.chave}
          colocacao={c}
          perfil={usersMap[c.chave]}
          maior={maior}
          /* A entrada é escalonada pela posição na TELA, da borda para o meio:
             o primeiro lugar assenta por último, que é onde o olho para. */
          atraso={i * 70}
        />
      ))}
    </div>
  );
}

function Degrau({
  colocacao,
  perfil,
  maior,
  atraso,
}: {
  colocacao: Colocacao;
  perfil?: UserProfile;
  maior: number;
  atraso: number;
}) {
  const { posicao, entregues, rotulo } = colocacao;
  // 96px no topo, 46 de piso. A proporção é sobre o maior do pódio, não sobre o
  // total: é a diferença ENTRE eles que o degrau precisa mostrar.
  const altura = 46 + Math.round((entregues / Math.max(1, maior)) * 96);

  return (
    <div
      className={`${styles.degrau} ${posicao === 1 ? styles.primeiro : ""}`}
      style={{ ["--atraso" as string]: `${atraso}ms` }}
    >
      <div className={styles.rosto}>
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
        <span className={styles.entregas}>
          {entregues} {entregues === 1 ? "entrega" : "entregas"}
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
          style={{ ["--atraso" as string]: `${240 + i * 40}ms` }}
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
