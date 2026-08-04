"use client";

/**
 * Leitor dos documentos gerados, dentro do app e com o tema do sistema.
 *
 * O conteúdo vem do Drive em Markdown e é renderizado aqui — em vez de abrir o
 * Google Docs numa aba, com a folha branca e a interface dele. Duas
 * consequências que valem além da estética: a leitura não exige que a pessoa
 * tenha acesso ao Drive Compartilhado, e o tema escuro é respeitado.
 *
 * `react-markdown` não interpreta HTML embutido por padrão, e é isso que
 * queremos: o conteúdo nasce de uma transcrição automática, então tratá-lo como
 * texto e nunca como marcação é a postura certa.
 */
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { auth } from "@/lib/firebase";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import { DRIVE_OUTPUT_LABEL, type DriveOutputKind } from "@/lib/meetings";
import { Icon } from "@/components/icons";
import styles from "./relatorios.module.css";

type Estado =
  | { fase: "carregando" }
  | { fase: "erro"; msg: string }
  | { fase: "ok"; nome: string; link: string; markdown: string };

export function DocViewer({
  meetingId,
  kind,
  sector,
  onClose,
}: {
  meetingId: string;
  kind: DriveOutputKind;
  sector: string;
  onClose: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [copiado, setCopiado] = useState(false);
  const [abrindoShare, setAbrindoShare] = useState(false);
  const [destino, setDestino] = useState("");
  const [compartilhando, setCompartilhando] = useState(false);
  const [avisoShare, setAvisoShare] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);

  useEffect(() => subscribeUsers(setUsuarios), []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Sessão expirada. Entre novamente.");
        const token = await user.getIdToken();
        const r = await fetch(
          `/api/drive/doc?meetingId=${encodeURIComponent(meetingId)}&kind=${kind}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = await r.json();
        if (!vivo) return;
        if (!r.ok) throw new Error(body.error || "Falha ao abrir o documento.");
        setEstado({ fase: "ok", ...body });
      } catch (e) {
        if (vivo) {
          setEstado({
            fase: "erro",
            msg: e instanceof Error ? e.message : "Falha ao abrir.",
          });
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [meetingId, kind]);

  const candidatos = useMemo(
    () =>
      usuarios.filter(
        (u) =>
          u.active &&
          (u.role === "admin" || (u.sectors ?? []).includes(sector)) &&
          u.email !== auth.currentUser?.email,
      ),
    [usuarios, sector],
  );

  async function copiar() {
    if (estado.fase !== "ok") return;
    try {
      await navigator.clipboard.writeText(estado.markdown);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2200);
    } catch {
      setAvisoShare("O navegador bloqueou a cópia.");
    }
  }

  async function compartilhar() {
    if (!destino) return;
    setCompartilhando(true);
    setAvisoShare(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada.");
      const token = await user.getIdToken();
      const r = await fetch("/api/drive/compartilhar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ meetingId, email: destino }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível compartilhar.");
      setAvisoShare(
        `Acesso concedido a ${destino} — ${body.documentos} documento(s) desta reunião.`,
      );
      setDestino("");
    } catch (e) {
      setAvisoShare(e instanceof Error ? e.message : "Falha ao compartilhar.");
    } finally {
      setCompartilhando(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.leitor}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>
              {DRIVE_OUTPUT_LABEL[kind]}
            </div>
            {estado.fase === "ok" && (
              <div className={styles.metaLine}>{estado.nome}</div>
            )}
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <div className={styles.leitorBarra}>
          <button
            className={styles.btnGhost}
            onClick={copiar}
            disabled={estado.fase !== "ok"}
          >
            <Icon name="chat" size={14} /> {copiado ? "Copiado" : "Copiar texto"}
          </button>
          <button
            className={styles.btnGhost}
            onClick={() => setAbrindoShare((v) => !v)}
            disabled={estado.fase !== "ok"}
          >
            <Icon name="check" size={14} /> Compartilhar
          </button>
          <div className={styles.spacer} />
          {estado.fase === "ok" && (
            <a
              className={styles.linkDrive}
              href={estado.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              abrir no Drive
            </a>
          )}
        </div>

        {abrindoShare && (
          <div className={styles.sharePanel}>
            <select
              className={styles.select}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
            >
              <option value="">Escolha quem recebe…</option>
              {candidatos.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
            <button
              className={styles.btnSave}
              onClick={compartilhar}
              disabled={!destino || compartilhando}
            >
              {compartilhando ? "Concedendo…" : "Dar acesso"}
            </button>
          </div>
        )}
        {avisoShare && <p className={styles.shareAviso}>{avisoShare}</p>}

        <div className={styles.leitorCorpo}>
          {estado.fase === "carregando" && (
            <p className={styles.vazioBloco}>Abrindo o documento…</p>
          )}
          {estado.fase === "erro" && <p className={styles.erro}>{estado.msg}</p>}
          {estado.fase === "ok" && (
            <article className={styles.doc}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {estado.markdown}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
