"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribeUsers, DEFAULT_SECTORS, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  DEFAULT_COLUMNS,
  type Card,
} from "@/lib/kanban";
import styles from "./dashboard.module.css";

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function DashboardPage() {
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
    const unsub = subscribeCardsForSectors(sectors, setCards, (e) =>
      console.error("Erro ao carregar cards:", e),
    );
    return () => unsub();
  }, [sectors]);

  useEffect(() => {
    const unsub = subscribeUsers(setUsers, () => {});
    return () => unsub();
  }, []);

  const today = todayStr();

  const metrics = useMemo(() => {
    const byColumn: Record<string, number> = {};
    DEFAULT_COLUMNS.forEach((c) => (byColumn[c.id] = 0));
    const bySector: Record<string, number> = {};
    sectors.forEach((s) => (bySector[s] = 0));
    let atrasadas = 0;
    cards.forEach((c) => {
      byColumn[c.columnId] = (byColumn[c.columnId] ?? 0) + 1;
      bySector[c.sector] = (bySector[c.sector] ?? 0) + 1;
      if (c.due && c.due < today && c.columnId !== "concluido") atrasadas++;
    });
    return { byColumn, bySector, atrasadas, total: cards.length };
  }, [cards, sectors, today]);

  const activeUsers = users.filter((u) => u.active).length;

  const maxCol = Math.max(
    1,
    ...DEFAULT_COLUMNS.map((c) => metrics.byColumn[c.id] ?? 0),
  );
  const sectorEntries = sectors
    .map((s) => ({ s, n: metrics.bySector[s] ?? 0 }))
    .sort((a, b) => b.n - a.n);
  const maxSec = Math.max(1, ...sectorEntries.map((e) => e.n));

  if (!profile) return null;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Dashboard</h1>
        <p>
          Visão geral das demandas
          {sectors.length ? ` em ${sectors.length} setor(es)` : ""}.
        </p>
      </div>

      <div className={styles.tiles}>
        <Tile num={metrics.total} label="Demandas" />
        <Tile num={metrics.byColumn["andamento"] ?? 0} label="Em andamento" />
        <Tile
          num={metrics.byColumn["concluido"] ?? 0}
          label="Concluídas"
          cls="good"
        />
        <Tile
          num={metrics.atrasadas}
          label="Atrasadas"
          cls={metrics.atrasadas > 0 ? "warn" : undefined}
        />
        <Tile num={activeUsers} label="Usuários ativos" />
      </div>

      <div className={styles.panels}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}>Demandas por coluna</div>
          {metrics.total === 0 ? (
            <div className={styles.empty}>Sem demandas ainda.</div>
          ) : (
            <div className={styles.bars}>
              {DEFAULT_COLUMNS.map((c) => (
                <Bar
                  key={c.id}
                  label={c.title}
                  value={metrics.byColumn[c.id] ?? 0}
                  max={maxCol}
                  color={c.color}
                />
              ))}
            </div>
          )}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelTitle}>Demandas por setor</div>
          {sectorEntries.length === 0 ? (
            <div className={styles.empty}>Nenhum setor atribuído.</div>
          ) : (
            <div className={styles.bars}>
              {sectorEntries.map((e) => (
                <Bar
                  key={e.s}
                  label={e.s}
                  value={e.n}
                  max={maxSec}
                  color="var(--brand)"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  num,
  label,
  cls,
}: {
  num: number;
  label: string;
  cls?: "good" | "warn";
}) {
  return (
    <div className={styles.tile}>
      <div className={`${styles.tileNum} ${cls ? styles[cls] : ""}`}>{num}</div>
      <div className={styles.tileLabel}>{label}</div>
    </div>
  );
}

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.max(3, Math.round((value / max) * 100));
  return (
    <div className={styles.barRow}>
      <div className={styles.barLabel}>{label}</div>
      <div className={styles.barTrack}>
        <div
          className={styles.barFill}
          style={{ width: `${value === 0 ? 0 : pct}%`, background: color }}
          title={`${label}: ${value}`}
        />
      </div>
      <div className={styles.barVal}>{value}</div>
    </div>
  );
}
