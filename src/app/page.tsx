import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.logo} src="/logo-uh-white.png" alt="Smart Meeting" />
        <h1 className={styles.title}>Smart Meeting</h1>
        <p className={styles.tagline}>
          Da reunião à ata em minutos — e da ata à ação. Gestão de demandas com
          inteligência de reuniões.
        </p>
        <span className={styles.chip}>
          <span className={styles.dot} /> Migração em andamento · Fase 0
        </span>
      </div>
    </main>
  );
}
