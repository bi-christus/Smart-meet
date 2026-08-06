"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/icons";
import styles from "./inicio.module.css";

const CARDS = [
  { id: "reunioes", label: "Reuniões", desc: "Áudio → transcrição → ata", href: "/reunioes" },
  { id: "relatorios", label: "Relatórios IA", desc: "Valide atas e gere documentos", href: "/relatorios" },
  { id: "kanban", label: "Kanban", desc: "Demandas por setor", href: "/kanban" },
  { id: "dashboard", label: "Dashboard", desc: "Indicadores e visões", href: "/dashboard" },
  { id: "cronograma", label: "Cronograma", desc: "Prazos e marcos", href: "/cronograma" },
];

export default function Inicio() {
  const { profile } = useAuth();
  const primeiro = profile?.name?.split(" ")[0] ?? "";

  return (
    <>
      <div className={styles.page}>
        <div className={styles.head}>
          <h1>Olá, {primeiro} 👋</h1>
          <p>Bem-vindo ao Smart Meeting. Escolha por onde começar.</p>
        </div>

        <div className={styles.grid}>
          {CARDS.map((c, i) => (
            <Link
              key={c.id}
              href={c.href}
              className={styles.card}
              style={{ animationDelay: `${60 + i * 55}ms` }}
            >
              <div className={styles.cardIcon}>
                <Icon name={c.id} size={20} />
              </div>
              <div className={styles.cardName}>{c.label}</div>
              <div className={styles.cardDesc}>{c.desc}</div>
            </Link>
          ))}

          {profile?.role === "admin" && (
            <Link
              href="/admin"
              className={`${styles.card} ${styles.adminCard}`}
              style={{ animationDelay: `${60 + CARDS.length * 55}ms` }}
            >
              <div className={styles.cardIcon}>
                <Icon name="admin" size={20} />
              </div>
              <div className={styles.cardName}>Admin</div>
              <div className={styles.cardDesc}>
                Usuários, setores e permissões
              </div>
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
