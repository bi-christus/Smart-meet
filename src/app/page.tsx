"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABEL } from "@/lib/users";
import styles from "./page.module.css";

export default function Home() {
  const { user, profile, loading, authorized, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className={styles.loader}>Carregando…</div>;
  }

  const nome = user.displayName || user.email || "usuário";
  const inicial = (nome.trim()[0] || "U").toUpperCase();

  function Avatar({ color }: { color?: string }) {
    if (user?.photoURL) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.avatar}
          src={user.photoURL}
          alt={nome}
          referrerPolicy="no-referrer"
        />
      );
    }
    return (
      <div className={styles.avatarFallback} style={color ? { background: color } : undefined}>
        {inicial}
      </div>
    );
  }

  // Autenticado, porém sem perfil ativo → acesso pendente.
  if (!authorized || !profile) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <div className={styles.avatarRow}>
            <Avatar />
          </div>
          <h1 className={styles.title}>Acesso pendente</h1>
          <p className={styles.tagline}>
            Sua conta <strong>{user.email}</strong> ainda não tem acesso
            liberado ao Smart Meeting. Peça ao administrador para incluir o seu
            e-mail.
          </p>
          <button className={styles.logout} onClick={() => logout()}>
            Sair
          </button>
          <span className={styles.chip}>
            <span className={styles.dot} /> Aguardando liberação
          </span>
        </div>
      </main>
    );
  }

  const primeiroNome = profile.name?.split(" ")[0] || nome;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.avatarRow}>
          <Avatar color={profile.color} />
        </div>
        <h1 className={styles.title}>Olá, {primeiroNome} 👋</h1>
        <span className={styles.roleBadge}>{ROLE_LABEL[profile.role]}</span>
        <p className={styles.tagline}>
          Você está autenticado no <strong>Smart Meeting</strong>. Os módulos
          (Reuniões, Kanban, Relatórios…) chegam na próxima fase.
        </p>
        <p className={styles.email}>{profile.email}</p>
        <button className={styles.logout} onClick={() => logout()}>
          Sair
        </button>
        <span className={styles.chip}>
          <span className={styles.dot} /> Fase 2 · Banco conectado
          {profile.role === "admin" ? " · Admin ativo" : ""}
        </span>
      </div>
    </main>
  );
}
