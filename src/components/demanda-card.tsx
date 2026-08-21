"use client";

import { GripDots, Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { agingDays, dueInfo, fmtShort, parseDue } from "@/lib/prazo-core.ts";
import {
  DEMAND_TYPES,
  DEMAND_TYPE_COLOR,
  DEMAND_TYPE_LABEL,
  KNOWN_PRIORITIES,
  PRIORITY_LABEL,
  tagColor,
  type Card,
  type DemandType,
  type Priority,
} from "@/lib/kanban";
import type { UserProfile } from "@/lib/users";
import styles from "./demanda-card.module.css";

/**
 * O card de demanda — um só, para o quadro e para a árvore de dimensões.
 *
 * ELE SAIU DE `kanban/page.tsx` NESTA FRENTE, e a extração é o motivo de ele
 * existir. A aba Dimensões precisa mostrar demanda, e a instrução foi clara:
 * "cada card precisa ter a estrutura de um card do Kanban". Escrever um card
 * PARECIDO na tela nova é o modo garantido de as duas telas divergirem — a
 * primeira vez que alguém acrescentar um selo no quadro, a árvore fica para
 * trás, e ninguém percebe porque as duas continuam funcionando.
 *
 * O QUE MUDA ENTRE OS DOIS CONSUMIDORES é só o gesto: no quadro o card se
 * arrasta entre colunas, na árvore ele só abre. Por isso `onDragStart` e
 * `onDragEnd` são OPCIONAIS e o `draggable` do DOM segue a presença deles, em
 * vez de existir uma prop `modo` que quem chama teria de acertar. Sem
 * arrastador, o grip some — um punho de arrastar que não arrasta é uma promessa
 * que a tela não cumpre.
 *
 * `onHistorico` também é opcional, pelo mesmo princípio: quem não tem para onde
 * abrir a timeline não desenha a porta dela.
 */
export function DemandaCard({
  card,
  colId,
  entregue,
  assignee,
  requester,
  requesterSector,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
  onHistorico,
  onPerfil,
}: {
  card: Card;
  /**
   * A coluna em que o card está, só para o selo de "parado".
   *
   * O aging só é mostrado em `aguardando` — é a etapa em que ficar parado é o
   * problema, e não o estado normal. Fora dela, o número existe e não interessa.
   */
  colId?: string;
  entregue: boolean;
  assignee?: UserProfile;
  requester?: string;
  requesterSector?: string;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onClick: () => void;
  onHistorico?: () => void;
  /** Recebe a pessoa, e não o e-mail: quem já tem o perfil na mão é o card. */
  onPerfil?: (pessoa: UserProfile) => void;
}) {
  const di = dueInfo(card.due, entregue);
  const startShort = card.startDate ? fmtShort(parseDue(card.startDate)) : "";
  const aging = colId === "aguardando" ? agingDays(card.enteredAt) : 0;
  const items = card.checklist ?? [];
  const done = items.filter((i) => i.done).length;
  const tags = card.tags ?? [];
  const comments = card.comments?.length ?? 0;
  const links = card.links?.length ?? 0;
  /**
   * Quantas vezes esta demanda mudou.
   *
   * Menos 1 porque o primeiro evento é o nascimento dela — toda demanda tem um,
   * e um selo "1" em todo card do quadro não informa nada. O selo só aparece
   * quando há mudança de verdade para ver.
   *
   * Nas demandas anteriores ao histórico isto conta um a menos: elas não têm
   * evento de nascimento, e a primeira edição delas cai no lugar dele. É o erro
   * certo a cometer — some sozinho na segunda edição, e o contrário
   * (contar um a mais em TODO card, para sempre) não some nunca.
   */
  const mudou = Math.max(0, (card.histCount ?? 0) - 1);

  const knownType =
    !!card.type && DEMAND_TYPES.includes(card.type as DemandType);
  const typeColor = knownType ? DEMAND_TYPE_COLOR[card.type as DemandType] : "";
  const knownPrio =
    !!card.priority && KNOWN_PRIORITIES.includes(card.priority as Priority);

  const arrastavel = !!onDragStart;

  return (
    <div
      className={`${styles.kcard} ${dragging ? styles.drag : ""} ${arrastavel ? "" : styles.semArraste}`}
      draggable={arrastavel}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className={styles.ktop}>
        {knownType && (
          <span
            className={styles.kType}
            style={{
              background: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
              color: `color-mix(in srgb, ${typeColor} 60%, var(--tx))`,
            }}
          >
            <span className={styles.kTypeDot} style={{ background: typeColor }} />
            {DEMAND_TYPE_LABEL[card.type as DemandType]}
          </span>
        )}
        {knownPrio && (
          <span className={`${styles.prio} ${styles["prio_" + card.priority]}`}>
            {PRIORITY_LABEL[card.priority as Priority]}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Canto superior direito: a porta do histórico. Fica no card, e não
            só dentro do modal, porque a pergunta que ela responde ("quando isto
            mudou de dono?") nasce olhando para o quadro, não editando a
            demanda. `stopPropagation` para o clique não abrir a edição junto. */}
        {onHistorico && (
          <button
            type="button"
            className={styles.kHist}
            onClick={(e) => {
              e.stopPropagation();
              onHistorico();
            }}
            title={
              mudou
                ? `${mudou} ${mudou === 1 ? "mudança registrada" : "mudanças registradas"} — ver histórico`
                : "Ver o histórico desta demanda"
            }
            aria-label={`Ver histórico de ${card.title}`}
          >
            <Icon name="history" size={13} />
            {mudou > 0 && <span className={styles.kHistN}>{mudou}</span>}
          </button>
        )}
        {arrastavel && (
          <span className={styles.grip}>
            <GripDots />
          </span>
        )}
      </div>
      <div className={styles.ktitle}>{card.title}</div>
      {/**
       * QUEM PEDIU fica colado no título, e não mais no rodapé.
       *
       * No rodapé ele ficava a um espaço do rosto do RESPONSÁVEL — duas pessoas
       * diferentes lado a lado, e a leitura natural era que aquele nome era o
       * dono daquela foto. Aqui embaixo do título ele lê como o que é: a
       * assinatura do pedido. O título diz o que foi pedido; a linha seguinte,
       * por quem. O rodapé fica só com o andamento (prazo, checklist, quem
       * responde), que é outra pergunta.
       *
       * O nome vem INTEIRO agora — a linha é dele sozinha, então não há mais o
       * motivo que obrigava a cortar no primeiro nome. O setor continua no
       * `title`: ele é a segunda informação da mesma pergunta, e escrevê-lo
       * dobraria a linha em todo card.
       */}
      {requester && (
        <div
          className={styles.kPor}
          title={`Solicitante: ${requester}${requesterSector ? ` · ${requesterSector}` : ""}`}
        >
          por {requester}
        </div>
      )}
      {tags.length > 0 && (
        <div className={styles.kTags}>
          {tags.slice(0, 4).map((t) => (
            <span key={t} className={styles.kTag}>
              <span className={styles.kTagDot} style={{ background: tagColor(t) }} />
              {t}
            </span>
          ))}
          {tags.length > 4 && (
            <span className={styles.kTag}>+{tags.length - 4}</span>
          )}
        </div>
      )}
      <div className={styles.kmeta}>
        {di ? (
          <span className={`${styles.chip} ${styles["due_" + di.tone]}`}>
            <Icon name="calendar" size={12} />
            {startShort ? `${startShort} → ` : ""}
            {di.label}
          </span>
        ) : startShort ? (
          <span className={`${styles.chip} ${styles.due_ok}`}>
            <Icon name="calendar" size={12} />
            Início {startShort}
          </span>
        ) : null}
        {aging >= 1 && (
          <span className={`${styles.aging} ${aging >= 7 ? styles.hot : ""}`}>
            <Icon name="clock" size={12} />
            {aging}d parado
          </span>
        )}
        {items.length > 0 && (
          <span className={styles.mini}>
            <Icon name="check" size={12} />
            {done}/{items.length}
          </span>
        )}
        {comments > 0 && (
          <span className={styles.mini}>
            <Icon name="chat" size={12} />
            {comments}
          </span>
        )}
        {links > 0 && (
          <span className={styles.mini}>
            <Icon name="link" size={12} />
            {links}
          </span>
        )}
        {assignee && (
          /**
           * O nome ao lado do rosto é o de quem o rosto é — o RESPONSÁVEL.
           *
           * Antes deste par existir, o que ficava colado no avatar era o nome do
           * solicitante, e ninguém tem como adivinhar que aquele nome e aquela
           * foto são de duas pessoas diferentes. Agora eles são a mesma pessoa
           * dita duas vezes, e a dúvida some.
           *
           * PRIMEIRO NOME, como no comentário e no histórico (`cName`): o rodapé
           * é uma linha só, dividida com prazo, aging, checklist, comentários e
           * links. "Maria Fernanda de Albuquerque" ali dentro empurraria todo o
           * resto para a linha de baixo em metade dos cards. A elipse do CSS
           * cuida do primeiro nome que ainda assim for comprido, e o nome
           * completo continua a um clique de distância, no perfil.
           *
           * O `alt` leva o nome INTEIRO e o que o clique faz: em modo alvo ele
           * vira o `aria-label` do botão, e é ele — não mais o `title`, que
           * tapava a prévia — quem responde a quem não enxerga a foto.
           */
          <span className={styles.kResp}>
            <span className={styles.kRespNome}>
              {(assignee.name || assignee.email).split(" ")[0]}
            </span>
            <Avatar
              pessoa={assignee}
              size={22}
              alt={`Responsável: ${assignee.name || assignee.email} — ver perfil`}
              aoAbrirPerfil={onPerfil ? () => onPerfil(assignee) : undefined}
            />
          </span>
        )}
      </div>
    </div>
  );
}
