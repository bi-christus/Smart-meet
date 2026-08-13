import styles from "./skeleton.module.css";

/**
 * Esqueleto de carregamento — o que a tela mostra enquanto o dado não chegou.
 *
 * Nasceu dentro de `relatorios/doc-viewer.tsx`, servindo a uma tela só, e foi
 * extraído para cá quando sete outras passaram a precisar. Duplicar isto à mão
 * em cada página é como um esqueleto bem-feito vira ruído: cada cópia erra a
 * acessibilidade de um jeito diferente, e nenhuma é consertada junto.
 *
 * A REGRA QUE ELE ENCARNA: feedback de sistema — "o app está vivo?" — é
 * obrigatório em toda espera acima de ~200ms, e conta como funcional, não como
 * enfeite. Não confundir com animação de entrada "porque o elemento entrou",
 * que é o oposto e não mora aqui.
 *
 * DUAS COISAS QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. Todo formato anuncia por conta própria: `aria-busy`, `aria-live="polite"`
 *    e um texto que só o leitor de tela lê. Sem isso, quem usa leitor de tela
 *    ouve silêncio — e silêncio é indistinguível de "acabou de carregar e não
 *    tem nada". É o mesmo engano visual, na forma sonora.
 * 2. Em movimento reduzido a CAIXA FICA e o brilho sai. Esconder o esqueleto
 *    seria devolver a tela em branco justamente a quem pediu menos movimento.
 */

/** Aplique no conteúdo real: ele entra com um crossfade de 150ms no lugar do esqueleto. */
export const classeAparece = styles.aparece;

function Aviso({ texto }: { texto: string }) {
  return <span className={styles.srOnly}>{texto}</span>;
}

/**
 * Linhas de texto genéricas.
 *
 * A largura varia em ciclo (cheia, cheia, 84%, 55%) porque bloco de larguras
 * iguais não parece texto — parece tabela, e o olho estranha antes de entender.
 */
export function Skeleton({
  lines = 3,
  texto = "Carregando…",
}: {
  lines?: number;
  texto?: string;
}) {
  const largura = ["", "", styles.media, styles.curta];
  return (
    <div className={styles.caixa} aria-live="polite" aria-busy="true">
      <Aviso texto={texto} />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`${styles.bloco} ${largura[i % 4]}`} />
      ))}
    </div>
  );
}

/**
 * Documento: título, parágrafos e respiro entre eles.
 *
 * Existe porque `<Skeleton lines={n}>` não reproduz o esqueleto do visualizador
 * de documentos sem perda visual — e a instrução era ajustar a API, não o
 * original. Um documento tem hierarquia; uma lista de linhas iguais não.
 */
export function SkeletonTexto({
  texto = "Carregando o documento…",
}: {
  texto?: string;
}) {
  return (
    <div className={styles.caixa} aria-live="polite" aria-busy="true">
      <Aviso texto={texto} />
      <div className={`${styles.bloco} ${styles.titulo}`} />
      <div className={`${styles.bloco} ${styles.curta}`} />
      <div className={styles.gap} />
      <div className={styles.bloco} />
      <div className={styles.bloco} />
      <div className={`${styles.bloco} ${styles.media}`} />
      <div className={styles.gap} />
      <div className={`${styles.bloco} ${styles.subtitulo}`} />
      <div className={styles.bloco} />
      <div className={styles.bloco} />
      <div className={`${styles.bloco} ${styles.media}`} />
      <div className={styles.gap} />
      <div className={styles.bloco} />
      <div className={`${styles.bloco} ${styles.curta}`} />
    </div>
  );
}

/**
 * Cards de demanda, no formato do Kanban.
 *
 * Repete o desenho do card real — faixa de tipo em cima, título, chips de meta
 * embaixo — para o quadro não pular quando o conteúdo chegar. Esqueleto que não
 * ocupa o mesmo espaço do conteúdo troca uma espera por um solavanco.
 */
export function SkeletonCard({
  cards = 3,
  texto = "Carregando as demandas…",
}: {
  cards?: number;
  texto?: string;
}) {
  return (
    <div className={styles.caixa} aria-live="polite" aria-busy="true">
      <Aviso texto={texto} />
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className={styles.card}>
          <div className={styles.cardTopo}>
            <div className={`${styles.bloco} ${styles.chip}`} />
            <div className={`${styles.bloco} ${styles.chipCurto}`} />
          </div>
          <div className={styles.bloco} />
          <div className={`${styles.bloco} ${styles.media}`} />
          <div className={styles.cardMeta}>
            <div className={`${styles.bloco} ${styles.chipCurto}`} />
            <div className={`${styles.bloco} ${styles.chipCurto}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Linhas de lista com avatar — reuniões, usuários, solicitantes, recorrências. */
export function SkeletonRow({
  rows = 4,
  texto = "Carregando a lista…",
}: {
  rows?: number;
  texto?: string;
}) {
  return (
    <div className={styles.caixa} aria-live="polite" aria-busy="true">
      <Aviso texto={texto} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.linha}>
          <div className={`${styles.bloco} ${styles.avatar}`} />
          <div className={styles.linhaTexto}>
            <div className={`${styles.bloco} ${styles.media}`} />
            <div className={`${styles.bloco} ${styles.curta}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Círculos do tamanho do avatar — a espera de quem acabou de escolher uma foto.
 *
 * Recebe uma LISTA de diâmetros porque a prévia da foto de perfil mostra o
 * avatar nos tamanhos reais em que ele vai aparecer, lado a lado. Se o
 * esqueleto fosse de um só, a linha encolheria durante o preparo e saltaria
 * quando a imagem ficasse pronta — esqueleto que não ocupa o espaço do
 * conteúdo troca uma espera por um solavanco.
 */
export function SkeletonAvatar({
  sizes = [34],
  texto = "Preparando a imagem…",
}: {
  sizes?: number[];
  texto?: string;
}) {
  return (
    <div className={styles.avatares} aria-live="polite" aria-busy="true">
      <Aviso texto={texto} />
      {sizes.map((s, i) => (
        <div
          key={i}
          className={`${styles.bloco} ${styles.avatar}`}
          style={{ width: s, height: s }}
        />
      ))}
    </div>
  );
}

/**
 * Painel de gráfico do Dashboard.
 *
 * Barras de alturas diferentes, ancoradas na base: um retângulo cinza chapado
 * não se parece com gráfico, e quem olha não entende o que está por vir.
 */
export function SkeletonChart({
  bars = 7,
  texto = "Carregando o gráfico…",
}: {
  bars?: number;
  texto?: string;
}) {
  // Alturas fixas, e não aleatórias: valor sorteado a cada render mudaria o
  // desenho no meio da espera, e ainda divergiria entre servidor e cliente.
  const alturas = [52, 78, 41, 96, 63, 85, 34, 71, 58, 90];
  return (
    <div className={styles.caixa} aria-live="polite" aria-busy="true">
      <Aviso texto={texto} />
      <div className={styles.grafico}>
        {Array.from({ length: bars }, (_, i) => (
          <div
            key={i}
            className={`${styles.bloco} ${styles.barra}`}
            style={{ height: `${alturas[i % alturas.length]}%` }}
          />
        ))}
      </div>
    </div>
  );
}
