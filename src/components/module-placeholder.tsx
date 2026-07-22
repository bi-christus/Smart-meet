import { Icon } from "./icons";
import styles from "./module-placeholder.module.css";

export function ModulePlaceholder({
  icon,
  title,
  subtitle,
  phase,
}: {
  icon: string;
  title: string;
  subtitle: string;
  phase: string;
}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.icon}>
          <Icon name={icon} size={26} />
        </div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.sub}>{subtitle}</p>
        <span className={styles.chip}>{phase}</span>
      </div>
    </div>
  );
}
