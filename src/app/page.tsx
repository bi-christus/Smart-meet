"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import styles from "./page.module.css";

export default function Home() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className={styles.loader}>Carregando…</div>;
  }

  const nome = user.displayName || user.email || "usuário";
  const primeiroNome = user.displayName?.split(" ")[0] || nome;
  const inicial = (nome.trim()[0] || "U").toUpperCase();

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.avatarRow}>
          {user.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.avatar}
              src={user.photoURL}
              alt={nome}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className={styles.avatarFallback}>{inicial}</div>
          )}
        </div>

        <h1 className={styles.title}>Olá, {primeiroNome} 👋</h1>
        <p className={styles.tagline}>
          Você está autenticado no <strong>Smart Meeting</strong>. Os módulos
          (Reuniões, Kanban, Relatórios…) chegam nas próximas fases.
        </p>
        <p className={styles.email}>{user.email}</p>

        <button className={styles.logout} onClick={() => logout()}>
          Sair
        </button>

        <span className={styles.chip}>
          <span className={styles.dot} /> Fase 1 · Autenticação ativa
        </span>
      </div>
    </main>
  );
}
