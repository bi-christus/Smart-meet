"use client";

/**
 * Relatórios IA — a tela onde a reunião processada é conferida e vira trabalho.
 *
 * Tudo o que saiu de uma reunião mora aqui: os documentos gerados (transcrição
 * e atas) e as demandas que a IA propôs. Não existe tela separada de demandas
 * de propósito — validar a ata e validar as demandas dela são o mesmo ato, e
 * separá-los faria a pessoa conferir a conversa duas vezes.
 *
 * "Validada" só quando não sobrou nada a decidir: ata conferida E nenhuma
 * proposta pendente. Assim o filtro significa "não tenho mais nada aqui", que é
 * a pergunta que a pessoa realmente faz.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { DEFAULT_SECTORS } from "@/lib/users";
import {
  subscribeMeetings,
  updateMeeting,
  DRIVE_OUTPUT_LABEL,
  type Meeting,
  type DriveOutputKind,
} from "@/lib/meetings";
import { subscribePropostas, type Proposta } from "@/lib/demandas";
import { Icon } from "@/components/icons";
import { PropostaForm } from "./proposta-form";
import { DocViewer } from "./doc-viewer";
import styles from "./relatorios.module.css";

const OUTPUT_ICON: Record<DriveOutputKind, string> = {
  transcricao: "chat",
  resumo: "check",
  detalhada: "relatorios",
  didatica: "reunioes",
};

function fmtDate(d: string): string {
  const p = d.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

type Filtro = "todas" | "a_validar" | "validada";

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
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [filter, setFilter] = useState<Filtro>("todas");
  const [view, setView] = useState<string | null>(null);

  useEffect(() => {
    const a = subscribeMeetings(sectors, setMeetings, (e) =>
      console.error("Erro ao carregar relatórios:", e),
    );
    const b = subscribePropostas(sectors, setPropostas, (e) =>
      console.error("Erro ao carregar propostas:", e),
    );
    return () => {
      a();
      b();
    };
  }, [sectors]);

  /** Propostas de cada reunião, para o card e para o modal. */
  const porReuniao = useMemo(() => {
    const m = new Map<string, Proposta[]>();
    for (const p of propostas) {
      const arr = m.get(p.meetingId) ?? [];
      arr.push(p);
      m.set(p.meetingId, arr);
    }
    return m;
  }, [propostas]);

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
      ((m.driveOutputs?.length ?? 0) > 0 ||
        (m.ata ?? "").trim().length > 0 ||
        (porReuniao.get(m.id)?.length ?? 0) > 0),
  );

  const pendentesDe = (m: Meeting) =>
    (porReuniao.get(m.id) ?? []).filter((p) => p.status === "pendente").length;

  /** Resolvida = ata conferida e nada pendente para decidir. */
  const resolvida = (m: Meeting) =>
    (m.reportStatus ?? "rascunho") === "validada" && pendentesDe(m) === 0;

  const shown = reports.filter((m) =>
    filter === "todas"
      ? true
      : filter === "validada"
        ? resolvida(m)
        : !resolvida(m),
  );

  const aberta = view ? (reports.find((m) => m.id === view) ?? null) : null;

  if (!profile) return null;

  const FILTERS: { id: Filtro; label: string }[] = [
    { id: "todas", label: "Todas" },
    { id: "a_validar", label: "A validar" },
    { id: "validada", label: "Validada" },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Relatórios IA</h1>
        <p>
          O que saiu de cada reunião: transcrição, atas e as demandas propostas.
          Abra para conferir e transformar em trabalho.
        </p>
      </div>

      <div className={styles.filters}>
        {FILTERS.map((f) => {
          const n =
            f.id === "a_validar"
              ? reports.filter((m) => !resolvida(m)).length
              : 0;
          return (
            <button
              key={f.id}
              className={`${styles.filterBtn} ${filter === f.id ? styles.on : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {n > 0 ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>
          Nenhuma reunião aqui ainda.
          <br />
          Quando o processamento gerar as atas de uma reunião, ela aparece com
          os documentos e as demandas propostas.
        </div>
      ) : (
        <div className={styles.grid}>
          {shown.map((m) => {
            const props = porReuniao.get(m.id) ?? [];
            const pend = props.filter((p) => p.status === "pendente").length;
            const aceitas = props.filter((p) => p.status === "aceita").length;
            const ok = resolvida(m);
            return (
              <button
                key={m.id}
                className={`${styles.card} ${ok ? styles.cardOk : ""}`}
                onClick={() => setView(m.id)}
              >
                <div className={styles.cardTop}>
                  <span className={styles.cardSector}>{m.sector}</span>
                  <span
                    className={`${styles.pill} ${ok ? styles.pillOk : styles.pillPend}`}
                  >
                    {ok ? "Validada" : "A validar"}
                  </span>
                </div>

                <h2 className={styles.cardTitle}>{m.title}</h2>
                <div className={styles.cardDate}>{fmtDate(m.date)}</div>

                <div className={styles.cardFoot}>
                  <span className={styles.chip}>
                    <Icon name="relatorios" size={13} />
                    {m.driveOutputs?.length ?? 0} documento
                    {(m.driveOutputs?.length ?? 0) === 1 ? "" : "s"}
                  </span>
                  {pend > 0 && (
                    <span className={`${styles.chip} ${styles.chipAlerta}`}>
                      <Icon name="clock" size={13} />
                      {pend} demanda{pend === 1 ? "" : "s"} a validar
                    </span>
                  )}
                  {aceitas > 0 && (
                    <span className={`${styles.chip} ${styles.chipOk}`}>
                      <Icon name="check" size={13} />
                      {aceitas} virou{aceitas === 1 ? "" : "ram"} demanda
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {aberta && (
        <ReportModal
          meeting={aberta}
          propostas={porReuniao.get(aberta.id) ?? []}
          onClose={() => setView(null)}
        />
      )}
    </div>
  );
}

function ReportModal({
  meeting,
  propostas,
  onClose,
}: {
  meeting: Meeting;
  propostas: Proposta[];
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<DriveOutputKind | null>(null);
  const [validando, setValidando] = useState(false);
  const [ataOk, setAtaOk] = useState(
    (meeting.reportStatus ?? "rascunho") === "validada",
  );
  const [erro, setErro] = useState<string | null>(null);

  const pendentes = propostas.filter((p) => p.status === "pendente");
  const decididas = propostas.filter((p) => p.status !== "pendente");

  async function validarAta() {
    setValidando(true);
    setErro(null);
    try {
      await updateMeeting(meeting.id, { reportStatus: "validada" });
      setAtaOk(true);
    } catch (e) {
      console.error(e);
      setErro("Não foi possível validar a ata.");
    } finally {
      setValidando(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>{meeting.title}</div>
            <div className={styles.metaLine}>
              {fmtDate(meeting.date)} · {meeting.sector}
              {meeting.createdBy ? ` · enviado por ${meeting.createdBy}` : ""}
            </div>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className={styles.modalBody}>
          {erro && <p className={styles.erro}>{erro}</p>}

          <section className={styles.bloco}>
            <h3 className={styles.blocoTitulo}>Documentos gerados</h3>
            {meeting.driveOutputs && meeting.driveOutputs.length > 0 ? (
              <div className={styles.outLinks}>
                {meeting.driveOutputs
                  .filter((o) => o.link)
                  .map((o, i) => (
                    // Abre DENTRO do app: ler a ata não deveria exigir sair do
                    // sistema nem ter acesso ao Drive Compartilhado.
                    <button
                      key={i}
                      className={styles.outLink}
                      onClick={() => setDoc(o.kind)}
                    >
                      <Icon name={OUTPUT_ICON[o.kind]} size={14} />{" "}
                      {DRIVE_OUTPUT_LABEL[o.kind]}
                    </button>
                  ))}
              </div>
            ) : (
              <p className={styles.vazioBloco}>
                Nenhum documento vinculado ainda.
              </p>
            )}
            {(meeting.ata ?? "").trim().length > 0 && (
              <div className={styles.ata}>{meeting.ata}</div>
            )}
            <div className={styles.blocoAcao}>
              {ataOk ? (
                <span className={styles.validatedNote}>
                  <Icon name="check" size={15} /> Ata validada
                </span>
              ) : (
                <button
                  className={styles.btnSave}
                  onClick={validarAta}
                  disabled={validando}
                >
                  {validando ? "Validando…" : "Validar ata"}
                </button>
              )}
            </div>
          </section>

          <section className={styles.bloco}>
            <h3 className={styles.blocoTitulo}>
              Demandas propostas
              {pendentes.length > 0 && (
                <span className={styles.blocoContagem}>
                  {pendentes.length} a decidir
                </span>
              )}
            </h3>

            {propostas.length === 0 ? (
              <p className={styles.vazioBloco}>
                Esta reunião não gerou demandas. Reunião informativa não gera —
                é resultado normal, não falha.
              </p>
            ) : (
              <>
                {pendentes.map((p) => (
                  <PropostaForm
                    key={p.id}
                    proposta={p}
                    sector={meeting.sector}
                    onErro={setErro}
                  />
                ))}
                {decididas.length > 0 && (
                  <div className={styles.decididas}>
                    {decididas.map((p) => (
                      <div key={p.id} className={styles.decidida}>
                        <span
                          className={`${styles.selo} ${
                            p.status === "aceita"
                              ? styles.seloOk
                              : styles.seloNao
                          }`}
                        >
                          {p.status === "aceita" ? "Aceita" : "Recusada"}
                        </span>
                        <span>
                          {p.proposta.title}
                          {p.decisao?.motivo ? ` — ${p.decisao.motivo}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {doc && (
        <DocViewer
          meetingId={meeting.id}
          kind={doc}
          sector={meeting.sector}
          onClose={() => setDoc(null)}
        />
      )}
    </div>
  );
}
