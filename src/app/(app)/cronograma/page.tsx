"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  DEFAULT_COLUMNS,
  type Card,
  type KanbanColumn,
} from "@/lib/kanban";
import styles from "./cronograma.module.css";

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const COL_MAP: Record<string, KanbanColumn> = {};
DEFAULT_COLUMNS.forEach((c) => {
  COL_MAP[c.id] = c;
});

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function parseDue(due: string): Date {
  const [y, m, dd] = due.split("-").map(Number);
  return new Date(y, m - 1, dd);
}

export default function CronogramaPage() {
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

  const [cards, setCards] = useState<Card[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const u = subscribeCardsForSectors(sectors, setCards, (e) =>
      console.error("Erro ao carregar cards:", e),
    );
    return () => u();
  }, [sectors]);

  useEffect(() => {
    const u = subscribeUsers(setUsers, () => {});
    return () => u();
  }, []);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);

  const groups = useMemo(() => {
    const today = startOfToday();
    const in7 = new Date(today);
    in7.setDate(in7.getDate() + 7);
    const atrasadas: Card[] = [];
    const semana: Card[] = [];
    const depois: Card[] = [];
    cards
      .filter((c) => c.due && c.columnId !== "concluido")
      .forEach((c) => {
        const d = parseDue(c.due as string);
        if (d < today) atrasadas.push(c);
        else if (d <= in7) semana.push(c);
        else depois.push(c);
      });
    const byDate = (a: Card, b: Card) =>
      (a.due as string) < (b.due as string)
        ? -1
        : (a.due as string) > (b.due as string)
          ? 1
          : 0;
    atrasadas.sort(byDate);
    semana.sort(byDate);
    depois.sort(byDate);
    return { atrasadas, semana, depois };
  }, [cards]);

  if (!profile) return null;

  const total =
    groups.atrasadas.length + groups.semana.length + groups.depois.length;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Cronograma</h1>
        <p>Demandas com prazo, por proximidade. Concluídas não aparecem aqui.</p>
      </div>

      {total === 0 ? (
        <div className={styles.empty}>
          Nenhuma demanda com prazo em aberto.
          <br />
          Defina o prazo (data) de um card no Kanban para vê-lo aqui.
        </div>
      ) : (
        <div className={styles.groups}>
          <Group
            title="Atrasadas"
            warn
            cards={groups.atrasadas}
            usersMap={usersMap}
          />
          <Group
            title="Próximos 7 dias"
            cards={groups.semana}
            usersMap={usersMap}
          />
          <Group title="Mais tarde" cards={groups.depois} usersMap={usersMap} />
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  warn,
  cards,
  usersMap,
}: {
  title: string;
  warn?: boolean;
  cards: Card[];
  usersMap: Record<string, UserProfile>;
}) {
  if (cards.length === 0) return null;
  return (
    <div>
      <div className={styles.groupHead}>
        <span
          className={`${styles.groupTitle} ${warn ? styles.groupTitleWarn : ""}`}
        >
          {title}
        </span>
        <span className={styles.groupCount}>{cards.length}</span>
      </div>
      <div className={styles.items}>
        {cards.map((c) => (
          <Item
            key={c.id}
            card={c}
            assignee={c.assignee ? usersMap[c.assignee] : undefined}
            warn={warn}
          />
        ))}
      </div>
    </div>
  );
}

function Item({
  card,
  assignee,
  warn,
}: {
  card: Card;
  assignee?: UserProfile;
  warn?: boolean;
}) {
  const d = parseDue(card.due as string);
  const col = COL_MAP[card.columnId];
  return (
    <div className={styles.item}>
      <div className={styles.date}>
        <div className={`${styles.dateDay} ${warn ? styles.overdueDay : ""}`}>
          {d.getDate()}
        </div>
        <div className={styles.dateMon}>{MESES[d.getMonth()]}</div>
      </div>
      <div className={styles.itemMain}>
        <div className={styles.itemTitle}>{card.title}</div>
        <div className={styles.itemMeta}>
          <span className={styles.sector}>{card.sector}</span>
          {col && (
            <>
              <span
                className={styles.colDot}
                style={{ background: col.color }}
              />
              <span className={styles.colName}>{col.title}</span>
            </>
          )}
          {assignee && (
            <span className={styles.assignee}>
              {assignee.name?.split(" ")[0]}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
