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
import { memo, useEffect, useMemo, useState } from "react";
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

/**
 * O documento renderizado, isolado num componente memoizado.
 *
 * Sem isto o Markdown era reprocessado a CADA mudança de estado do leitor — a
 * lista de usuários chegando, o "Copiado" aparecendo e sumindo, o painel de
 * compartilhar abrindo. Uma transcrição tem ~50 mil caracteres e milhares de
 * nós; reparsear tudo isso a cada tecla é o que travava a rolagem.
 */
const Documento = memo(function Documento({ md }: { md: string }) {
  return (
    <article className={styles.doc}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </article>
  );
});

/** Esqueleto do texto enquanto o Drive responde. */
function Esqueleto() {
  return (
    <div className={styles.skeleton} aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Carregando o documento…</span>
      <div className={`${styles.skLine} ${styles.skTitulo}`} />
      <div className={`${styles.skLine} ${styles.skCurta}`} />
      <div className={styles.skGap} />
      <div className={styles.skLine} />
      <div className={styles.skLine} />
      <div className={`${styles.skLine} ${styles.skMedia}`} />
      <div className={styles.skGap} />
      <div className={`${styles.skLine} ${styles.skSubtitulo}`} />
      <div className={styles.skLine} />
      <div className={styles.skLine} />
      <div className={`${styles.skLine} ${styles.skMedia}`} />
      <div className={styles.skGap} />
      <div className={styles.skLine} />
      <div className={`${styles.skLine} ${styles.skCurta}`} />
    </div>
  );
}

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
  const [destinos, setDestinos] = useState<string[]>([]);
  const [digitando, setDigitando] = useState("");
  const [recado, setRecado] = useState("");
  const [enviando, setEnviando] = useState(false);
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

  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function addDestino(bruto: string) {
    const e = bruto.trim().toLowerCase();
    if (!e) return;
    if (!EMAIL_OK.test(e)) {
      setAvisoShare(`"${e}" não parece um e-mail.`);
      return;
    }
    setAvisoShare(null);
    setDestinos((x) => (x.includes(e) ? x : [...x, e]));
  }

  async function enviar() {
    if (destinos.length === 0) return;
    setEnviando(true);
    setAvisoShare(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada.");
      const token = await user.getIdToken();
      const r = await fetch("/api/drive/enviar-doc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          meetingId,
          kind,
          para: destinos,
          mensagem: recado.trim() || undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível enviar.");
      setAvisoShare(
        `Enviado para ${destinos.join(", ")} — com você em cópia.`,
      );
      setDestinos([]);
      setRecado("");
    } catch (e) {
      setAvisoShare(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setEnviando(false);
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
            <Icon name="chat" size={14} /> Enviar por e-mail
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
            <div className={styles.shareLinha}>
              <select
                className={styles.select}
                value=""
                onChange={(e) => {
                  addDestino(e.target.value);
                  e.currentTarget.value = "";
                }}
              >
                <option value="">Escolher da equipe…</option>
                {candidatos
                  .filter((u) => !destinos.includes(u.email))
                  .map((u) => (
                    <option key={u.email} value={u.email}>
                      {u.name || u.email}
                    </option>
                  ))}
              </select>
              <input
                className={styles.input}
                placeholder="ou digite um e-mail e tecle Enter"
                value={digitando}
                onChange={(e) => setDigitando(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addDestino(digitando);
                    setDigitando("");
                  }
                }}
              />
            </div>

            {destinos.length > 0 && (
              <div className={styles.tags}>
                {destinos.map((d) => (
                  <span key={d} className={styles.tag}>
                    {d}
                    <button
                      onClick={() =>
                        setDestinos((x) => x.filter((y) => y !== d))
                      }
                      aria-label={`Remover ${d}`}
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <textarea
              className={styles.area}
              rows={2}
              placeholder="Recado no topo do e-mail (opcional)"
              value={recado}
              onChange={(e) => setRecado(e.target.value)}
              maxLength={800}
            />

            <div className={styles.shareRodape}>
              <span className={styles.shareNota}>
                O documento vai no corpo do e-mail, e você entra em cópia.
              </span>
              <button
                className={styles.btnSave}
                onClick={enviar}
                disabled={destinos.length === 0 || enviando}
              >
                {enviando
                  ? "Enviando…"
                  : `Enviar${destinos.length ? ` (${destinos.length})` : ""}`}
              </button>
            </div>
          </div>
        )}
        {avisoShare && <p className={styles.shareAviso}>{avisoShare}</p>}

        <div className={styles.leitorCorpo}>
          {estado.fase === "carregando" && <Esqueleto />}
          {estado.fase === "erro" && <p className={styles.erro}>{estado.msg}</p>}
          {estado.fase === "ok" && <Documento md={estado.markdown} />}
        </div>
      </div>
    </div>
  );
}
