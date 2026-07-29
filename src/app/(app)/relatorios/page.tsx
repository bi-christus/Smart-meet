"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { DEFAULT_SECTORS } from "@/lib/users";
import {
  subscribeMeetings,
  updateMeeting,
  REPORT_STATUS_LABEL,
  DRIVE_OUTPUT_LABEL,
  type Meeting,
  type ReportStatus,
  type DriveOutputKind,
} from "@/lib/meetings";
import { Icon } from "@/components/icons";
import styles from "./relatorios.module.css";

/** Ícone de cada arquivo gerado pelo Cowork. */
const OUTPUT_ICON: Record<DriveOutputKind, string> = {
  transcricao: "chat",
  resumo: "check",
  detalhada: "relatorios",
  didatica: "reunioes",
};

function fmtDate(d: string): string {
  const parts = d.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
}

export default function RelatoriosPage() {
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

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [filter, setFilter] = useState<"todas" | "a_validar" | "validada">(
    "todas",
  );
  const [view, setView] = useState<Meeting | null>(null);

  useEffect(() => {
    const u = subscribeMeetings(sectors, setMeetings, (e) =>
      console.error("Erro ao carregar relatórios:", e),
    );
    return () => u();
  }, [sectors]);

  // Mesma regra de visibilidade do áudio: dono, gestor do setor e admin.
  const canSee = (m: Meeting): boolean => {
    if (!profile) return false;
    if (profile.role === "admin") return true;
    if (m.createdBy === profile.email) return true;
    return (
      profile.role === "gestor" && (profile.sectors ?? []).includes(m.sector)
    );
  };

  const reports = meetings.filter(
    (m) =>
      canSee(m) &&
      ((m.driveOutputs?.length ?? 0) > 0 || (m.ata ?? "").trim().length > 0),
  );
  const shown =
    filter === "todas"
      ? reports
      : reports.filter((m) => (m.reportStatus ?? "rascunho") === filter);

  if (!profile) return null;

  const FILTERS: ("todas" | "a_validar" | "validada")[] = [
    "todas",
    "a_validar",
    "validada",
  ];

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Relatórios IA</h1>
        <p>
          Atas geradas a partir das reuniões. Valide e (em breve) transforme
          sugestões em demandas.
        </p>
      </div>

      <div className={styles.filters}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`${styles.filterBtn} ${filter === f ? styles.on : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "todas" ? "Todas" : REPORT_STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>
          Nenhuma ata ainda.
          <br />
          Quando o processamento gerar as atas de uma reunião, elas aparecem
          aqui — com os links para abrir cada arquivo.
        </div>
      ) : (
        <div className={styles.list}>
          {shown.map((m) => {
            const rs = (m.reportStatus ?? "rascunho") as ReportStatus;
            return (
              <div
                key={m.id}
                className={styles.item}
                onClick={() => setView(m)}
              >
                <div className={styles.itemIcon}>
                  <Icon name="relatorios" size={19} />
                </div>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{m.title}</div>
                  <div className={styles.itemMeta}>
                    <span>{fmtDate(m.date)}</span>
                    <span>· {m.sector}</span>
                    {(m.driveOutputs?.length ?? 0) > 0 && (
                      <span className={styles.count}>
                        · {m.driveOutputs!.length} arquivo(s) da IA
                      </span>
                    )}
                  </div>
                </div>
                <span className={`${styles.badge} ${styles["rs_" + rs]}`}>
                  {REPORT_STATUS_LABEL[rs]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {view && <ReportModal meeting={view} onClose={() => setView(null)} />}
    </div>
  );
}

function ReportModal({
  meeting,
  onClose,
}: {
  meeting: Meeting;
  onClose: () => void;
}) {
  const rs = (meeting.reportStatus ?? "rascunho") as ReportStatus;
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(rs === "validada");

  async function validar() {
    setValidating(true);
    try {
      await updateMeeting(meeting.id, { reportStatus: "validada" });
      setValidated(true);
    } catch (e) {
      console.error(e);
      alert("Não foi possível validar.");
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>{meeting.title}</div>
        <div className={styles.metaLine}>
          {fmtDate(meeting.date)} · {meeting.sector}
        </div>
        {meeting.driveOutputs && meeting.driveOutputs.length > 0 && (
          <div className={styles.outLinks}>
            {meeting.driveOutputs
              .filter((o) => o.link)
              .map((o, i) => (
                <a
                  key={i}
                  href={o.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.outLink}
                >
                  <Icon name={OUTPUT_ICON[o.kind]} size={14} />{" "}
                  {DRIVE_OUTPUT_LABEL[o.kind]}
                </a>
              ))}
          </div>
        )}
        {(meeting.ata ?? "").trim().length > 0 && (
          <div className={styles.ata}>{meeting.ata}</div>
        )}
        <div className={styles.hint}>
          💡 Na <b>Fase 4</b>, a IA vai extrair sugestões da ata (novos projetos
          e atividades) para você aprovar — virando cards no Kanban
          automaticamente.
        </div>
        <div className={styles.modalActions}>
          <div className={styles.spacer} />
          <button className={styles.btnGhost} onClick={onClose}>
            Fechar
          </button>
          {validated ? (
            <span className={styles.validatedNote}>
              <Icon name="check" size={15} /> Validada
            </span>
          ) : (
            <button
              className={styles.btnSave}
              onClick={validar}
              disabled={validating}
            >
              {validating ? "Validando…" : "Validar ata"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
