"use client";

import { useAuth } from "@/lib/auth-context";
import { type UserProfile } from "@/lib/users";
import { useSetoresDaPessoa } from "@/lib/setores";
import { useEmblemasDaPessoa } from "@/lib/emblemas";
import {
  TETO_EMBLEMAS,
  conquistados,
  maisPertoDoProximo,
  type Emblema,
} from "@/lib/emblemas-core";
import { classeAparece, SkeletonRow } from "./skeleton";
import { ErrorState } from "./error-state";
import { Icon } from "./icons";
import styles from "./emblemas-perfil.module.css";

/**
 * Os emblemas de uma pessoa, no card do perfil.
 *
 * COMPONENTE À PARTE, e não um pedaço de `perfil-modal.tsx`, por dois motivos
 * que se somam: ele é o ÚNICO consumidor do hook que assina cards e colunas — e
 * é por isso que ele pode ser carregado sob demanda, mantendo `lib/kanban` fora
 * do pacote do shell — e ele tem os próprios estados de carregando, vazio e
 * erro, que não têm o que fazer no meio de um formulário de perfil.
 *
 * O PROP É A `pessoa`, e não o e-mail. `PerfilModalProps.pessoa` já é um
 * `UserProfile` NOS DOIS MODOS, então `pessoa.sectors` vem de graça — e sem ele
 * `escopoDaContagem` não teria chamador, viraria código morto, e o detector de
 * código morto reprovaria com razão.
 *
 * O RECORTE ESTÁ ESCRITO NA TELA, e isso não é excesso de zelo. A assinatura de
 * `/cards` é escopada pelos setores de QUEM OLHA, nunca pelos da pessoa mostrada
 * — a regra de `/cards` depende do documento, e regra assim NEGA A CONSULTA
 * INTEIRA em vez de filtrar. Ou seja: a contagem é do que quem olha enxerga. Com
 * um setor de execução só (o caso de 100% do banco hoje) isso não muda nada; no
 * dia em que mudar, o número seria menor sem nada explicando por quê.
 *
 * NÍVEL SE LÊ POR PESO E POR ALGARISMO, NÃO POR COR. É a decisão que o Rank já
 * tomou e explicou: ouro, prata e bronze são três plásticos que brigam com o
 * laranja da marca — e cor sozinha não sobrevive a daltonismo nem a uma captura
 * de tela em escala de cinza, que é como este app aparece em documento.
 */
export function EmblemasDoPerfil({ pessoa }: { pessoa: UserProfile }) {
  const { profile } = useAuth();

  // Os setores de quem OLHA — e não os de quem é olhado; ver `escopoDaContagem`
  // em `emblemas-core`. A regra em si mora em `setoresVisiveis`, uma vez só.
  const setoresDoVisualizador = useSetoresDaPessoa(profile);

  const {
    emblemas,
    contagem,
    configFalhou,
    escopo,
    carregando,
    semSetor,
    erro,
    tentarDeNovo,
  } = useEmblemasDaPessoa(pessoa.email, pessoa.sectors, setoresDoVisualizador);

  /**
   * `!profile` é ESQUELETO, e não vazio. Nos primeiros quadros do shell o perfil
   * ainda não chegou, e `setoresDoVisualizador` vale `[]` — que é exatamente o
   * estado que produziria "nenhuma entrega" antes de qualquer leitura.
   */
  if (!profile || carregando) {
    return (
      <section className={styles.bloco} aria-label="Emblemas">
        <SkeletonRow rows={1} texto="Contando as entregas…" />
      </section>
    );
  }

  if (erro) {
    return (
      <section className={styles.bloco} aria-label="Emblemas">
        <ErrorState error={erro} onRetry={tentarDeNovo} size="compact" />
      </section>
    );
  }

  // Estado próprio, e não um dos três vazios: aqui não há o que contar porque
  // quem olha não participa de nenhum quadro, e a frase precisa dizer isso em
  // vez de afirmar que a pessoa não entregou nada.
  if (semSetor) {
    return (
      <section className={styles.bloco} aria-label="Emblemas">
        <Cabeca />
        <p className={styles.vazio}>
          Você ainda não participa de nenhum setor de execução, então não há
          entregas para contar aqui.
        </p>
      </section>
    );
  }

  const lista = emblemas ?? [];
  const ganhos = conquistados(lista);
  const proximo = maisPertoDoProximo(lista);
  const mostrados = ganhos.slice(0, TETO_EMBLEMAS);
  const excedentes = ganhos.slice(TETO_EMBLEMAS);

  return (
    <section className={`${styles.bloco} ${classeAparece}`} aria-label="Emblemas">
      <Cabeca />

      {ganhos.length > 0 ? (
        <>
          <div className={styles.faixa}>
            {mostrados.map((e) => (
              <Chip key={e.chave} emblema={e} />
            ))}
            {excedentes.length > 0 && (
              /* O "+N" nomeia o que esconde. Quem tem seis setores solicitantes
                 vendo "+2" sem como descobrir quais é um bloco de reconhecimento
                 que esconde justamente o que reconheceu. */
              <span
                className={styles.mais}
                title={excedentes.map((e) => `${e.nome} · ${e.setor}`).join("\n")}
                aria-label={`Mais ${excedentes.length}: ${excedentes
                  .map((e) => e.nome)
                  .join(", ")}`}
              >
                +{excedentes.length}
              </span>
            )}
          </div>
          {proximo && <Progresso emblema={proximo} />}
        </>
      ) : contagem && contagem.total === 0 ? (
        <p className={styles.vazio}>
          Nenhuma demanda entregue ainda no que este quadro alcança. O primeiro
          emblema nasce quando uma demanda de algum setor solicitante for
          concluída.
        </p>
      ) : contagem && contagem.porSetor.size === 0 ? (
        /* Vazio ACIONÁVEL, e por isso separado do de cima: há entregas, elas
           só não têm setor solicitante preenchido. Quem lê isto sabe o que
           fazer — preencher o campo nas demandas. */
        <p className={styles.vazio}>
          {contagem.semSetor === 1
            ? "Há 1 demanda entregue sem setor solicitante preenchido, e por isso ela não gera emblema."
            : `Há ${contagem.semSetor} demandas entregues sem setor solicitante preenchido, e por isso elas não geram emblema.`}
        </p>
      ) : (
        /* Há entregas com setor, mas nenhuma cruzou o primeiro degrau. É a tela
           principal desta frente nas primeiras semanas — e é por isso que
           `montarEmblemas` devolve os de nível 0 em vez de filtrá-los. */
        <>
          <p className={styles.vazio}>
            Nenhum emblema ainda — falta pouco para o primeiro.
          </p>
          {proximo && <Progresso emblema={proximo} />}
        </>
      )}

      {configFalhou && (
        /* Este aviso existe para DUAS situações pararem de se confundir: "o
           admin nunca nomeou este setor" e "a configuração não carregou" têm
           exatamente o mesmo sintoma — o emblema aparece com o nome do setor. */
        <p className={styles.aviso} role="status">
          A configuração dos emblemas não carregou. Os nomes e os degraus abaixo
          são os padrões, não os que o administrador definiu.
        </p>
      )}

      {!escopo.completo && (
        <p className={styles.aviso} role="status">
          Esta contagem cobre só os setores que você enxerga. {pessoa.name || "Esta pessoa"} também
          responde por {escopo.ausentes.join(", ")}, e as entregas de lá não
          entram na conta.
        </p>
      )}
    </section>
  );
}

function Cabeca() {
  return (
    <div className={styles.cabeca}>
      <Icon name="emblema" size={14} />
      <span>Emblemas</span>
    </div>
  );
}

/** Os algarismos do nível. Romanos porque ninguém os confunde com a contagem. */
const ROMANO = ["", "I", "II", "III"];

function Chip({ emblema }: { emblema: Emblema }) {
  return (
    <span
      className={`${styles.chip} ${styles[`n${emblema.nivel}`]}`}
      title={`${emblema.nome} ${ROMANO[emblema.nivel]} — ${emblema.entregues} ${
        emblema.entregues === 1 ? "entrega" : "entregas"
      } para ${emblema.setor}`}
    >
      <span className={styles.chipNome}>{emblema.nome}</span>
      <span className={styles.chipNivel} aria-hidden="true">
        {ROMANO[emblema.nivel]}
      </span>
      <span className={styles.srOnly}>
        nível {emblema.nivel}, {emblema.entregues} entregas para {emblema.setor}
      </span>
    </span>
  );
}

/**
 * A barra do que está mais perto do próximo degrau.
 *
 * UMA SÓ, e não uma por setor: dez barras seriam dez metas concorrentes, e
 * nenhuma delas leria como um objetivo. `maisPertoDoProximo` escolhe pela
 * FRAÇÃO do caminho, não pelo que falta em números absolutos — 19 de 20 está
 * mais perto de virar do que 95 de 100, mesmo os dois faltando 5.
 */
function Progresso({ emblema }: { emblema: Emblema }) {
  if (emblema.proximoDegrau === null || emblema.faltam === null) return null;
  const alvo = emblema.nivel === 0 ? emblema.nome : `${emblema.nome} ${ROMANO[emblema.nivel + 1]}`;
  return (
    <div className={styles.progresso}>
      <div
        className={styles.trilho}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={emblema.proximoDegrau}
        aria-valuenow={emblema.entregues}
        aria-label={`Progresso para ${alvo}`}
      >
        {/* Largura é dado, e dado entra inline — como `tagColor` e
            `DEMAND_TYPE_COLOR` já fazem. Nada aqui tem `transition`: a barra
            aparece com o bloco e não se move depois. */}
        <div
          className={styles.preenchido}
          style={{ width: `${Math.round(emblema.progresso * 100)}%` }}
        />
      </div>
      <span className={styles.progressoTx}>
        {emblema.faltam === 1
          ? `Falta 1 entrega para ${alvo}`
          : `Faltam ${emblema.faltam} entregas para ${alvo}`}
        {" · "}
        {emblema.setor}
      </span>
    </div>
  );
}
