"use client";

/**
 * Relatório de demandas para o gestor.
 *
 * A prévia é o MESMO HTML que vai ser enviado: a tela roda `agregar` +
 * `montarRelatorio`, e o servidor roda as mesmas funções sobre os mesmos
 * dados. Nenhuma das duas monta HTML por conta própria. Prévia que diverge do
 * envio é pior que não ter prévia — dá confiança sem base.
 *
 * O HTML vai num `<iframe srcDoc sandbox>` e não injetado na página: é um
 * documento completo, com `<style>` e `<body>` próprios, que vazaria estilo
 * para o app se fosse embutido direto.
 *
 * FASE 1: sem controles de aparência. O padrão é fixo em `PREFS_PADRAO`. Os
 * controles vêm depois, calibrados pelo que faltar ao usar de verdade.
 */
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import {
  subscribeCards,
  subscribeColumns,
  type Card,
  type ColumnDoc,
} from "@/lib/kanban";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import { agregar } from "@/lib/relatorio/agregar";
import { montarRelatorio } from "@/lib/relatorio/montar";
import { PREFS_PADRAO, MAX_DESTINATARIOS } from "@/lib/relatorio/config";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/icons";
import styles from "./relatorio.module.css";

type Modo = "desktop" | "celular" | "outlook";

/**
 * Reset que simula as quebras reais do motor Word no Outlook desktop.
 * Não é emulador — é o que impede alguém de calibrar tudo no Chrome e
 * descobrir a diferença pelo gestor que recebeu.
 */
const RESET_OUTLOOK = `<style>
*{border-radius:0!important;letter-spacing:normal!important}
span{display:inline!important;padding:0!important}
table{border-spacing:0!important}
.env{max-width:none!important;width:820px!important}
</style>`;

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function RelatorioModal({
  sector,
  onClose,
}: {
  sector: string;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [colunas, setColunas] = useState<ColumnDoc[] | null>(null);
  const [usuarios, setUsuarios] = useState<UserProfile[]>([]);
  const [modo, setModo] = useState<Modo>("desktop");
  const [destinos, setDestinos] = useState<string[]>([]);
  const [digitando, setDigitando] = useState("");
  const [recado, setRecado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // O painel assina os PRÓPRIOS dados em vez de receber os da página: a página
  // filtra por busca, prioridade e responsável, e o relatório precisa do quadro
  // inteiro. Sem isto, a prévia mostraria o recorte da tela e o e-mail sairia
  // com tudo — divergência que ninguém descobriria.
  useEffect(() => {
    if (!sector) return;
    const a = subscribeCards(sector, setCards, () => setCards([]));
    const b = subscribeColumns(sector, setColunas, () => setColunas([]));
    const c = subscribeUsers(setUsuarios, () => {});
    return () => {
      a();
      b();
      c();
    };
  }, [sector]);

  const nomePorEmail = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of usuarios) if (u.name) m[u.email.toLowerCase()] = u.name;
    return m;
  }, [usuarios]);

  const eu = auth.currentUser?.email ?? "";
  const meuNome = nomePorEmail[eu.toLowerCase()] ?? eu;

  // Um instante só, congelado enquanto o modal está aberto: recalcular o
  // "agora" a cada render faria os "parada há N dias" mudarem sozinhos.
  const [agora] = useState(() => Date.now());

  const montado = useMemo(() => {
    if (!cards || !colunas) return null;
    const prefs = { ...PREFS_PADRAO, setores: [sector] };
    const dados = agregar(cards, colunas, nomePorEmail, prefs, agora);
    return {
      dados,
      rel: montarRelatorio(dados, prefs, {
        setores: [sector],
        enviadoPor: meuNome,
        recado: recado.trim() || undefined,
        agora,
      }),
    };
  }, [cards, colunas, nomePorEmail, sector, recado, meuNome, agora]);

  const carregando = !cards || !colunas;
  const semDemandas = !carregando && (cards?.length ?? 0) === 0;

  const srcDoc = useMemo(() => {
    if (!montado) return "";
    return modo === "outlook"
      ? montado.rel.html.replace("</head>", `${RESET_OUTLOOK}</head>`)
      : montado.rel.html;
  }, [montado, modo]);

  function addDestino(bruto: string) {
    const e = bruto.trim().toLowerCase();
    if (!e) return;
    if (!EMAIL_OK.test(e)) {
      setAviso(`"${e}" não parece um e-mail.`);
      return;
    }
    if (destinos.length >= MAX_DESTINATARIOS) {
      setAviso(`No máximo ${MAX_DESTINATARIOS} destinatários.`);
      return;
    }
    setAviso(null);
    setDestinos((x) => (x.includes(e) ? x : [...x, e]));
  }

  async function enviar(teste: boolean) {
    setOcupado(true);
    setAviso(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada.");
      const token = await user.getIdToken();
      const r = await fetch("/api/kanban/relatorio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          setor: sector,
          para: destinos,
          recado: recado.trim() || undefined,
          teste,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível enviar.");
      setAviso(
        teste
          ? `Teste enviado para você — ${body.demandas} demandas, ${body.linhasEnviadas} linhas.`
          : `Enviado para ${destinos.join(", ")}, com você em cópia.`,
      );
      if (!teste) setDestinos([]);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setOcupado(false);
    }
  }

  const larguraPreview =
    modo === "celular" ? 390 : modo === "outlook" ? 900 : 860;

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Relatório de demandas para o gestor"
      overlayClassName={styles.overlay}
      className={styles.modal}
    >
      <header className={styles.cabeca}>
        <div>
          <h2 className={styles.titulo}>Relatório para gestor</h2>
          <p className={styles.sub}>
            {carregando
              ? "Lendo o quadro…"
              : `${sector} · ${montado?.dados.total ?? 0} demandas abertas · ${montado?.dados.atrasadas ?? 0} atrasadas`}
          </p>
        </div>
        <button className={styles.fechar} onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </header>

      <p className={styles.avisoFiltro}>
        <Icon name="clock" size={13} /> O relatório traz o quadro inteiro de{" "}
        {sector}. Os filtros de busca, prioridade e responsável que estiverem
        ligados na tela <strong>não</strong> valem aqui.
      </p>

      <div className={styles.corpo}>
        <div className={styles.controles}>
          <label className={styles.rot}>Recado no topo do e-mail</label>
          <textarea
            className={styles.area}
            rows={3}
            value={recado}
            onChange={(e) => setRecado(e.target.value)}
            maxLength={800}
            placeholder="Opcional — aparece citado antes dos números."
          />

          <label className={styles.rot}>Destinatários</label>
          <input
            className={styles.input}
            value={digitando}
            onChange={(e) => setDigitando(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addDestino(digitando);
                setDigitando("");
              }
            }}
            placeholder="e-mail do gestor e tecle Enter"
          />
          {destinos.length > 0 && (
            <div className={styles.chips}>
              {destinos.map((d) => (
                <span key={d} className={styles.chip}>
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

          <p className={styles.nota}>
            Você entra em cópia, e as respostas voltam para o seu e-mail.
          </p>

          {montado && (
            <dl className={styles.resumo}>
              <div>
                <dt>Linhas no e-mail</dt>
                <dd>
                  {montado.rel.linhasEnviadas}
                  {montado.rel.linhasCortadas > 0
                    ? ` (+${montado.rel.linhasCortadas} cortadas)`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Tamanho</dt>
                <dd>{Math.round(montado.rel.bytes / 1024)} KB de 85 KB</dd>
              </div>
            </dl>
          )}

          {aviso && <p className={styles.aviso}>{aviso}</p>}
        </div>

        <div className={styles.preview}>
          <div className={styles.caixaEntrada}>
            <div className={styles.ceLinha}>
              <span className={styles.ceRot}>De</span>
              <span>Smart Meet</span>
            </div>
            <div className={styles.ceLinha}>
              <span className={styles.ceRot}>Assunto</span>
              <strong>{montado?.rel.assunto ?? "—"}</strong>
            </div>
            <div className={styles.ceLinha}>
              <span className={styles.ceRot}>Prévia</span>
              <span className={styles.cePre}>
                {montado?.rel.preheader ?? "—"}
              </span>
            </div>
          </div>

          <div className={styles.modos}>
            {(["desktop", "celular", "outlook"] as Modo[]).map((m) => (
              <button
                key={m}
                className={`${styles.modo} ${modo === m ? styles.modoOn : ""}`}
                onClick={() => setModo(m)}
              >
                {m === "desktop"
                  ? "Computador"
                  : m === "celular"
                    ? "Celular"
                    : "Outlook (simulado)"}
              </button>
            ))}
          </div>

          <div className={styles.moldura}>
            {carregando ? (
              <p className={styles.vazio}>Lendo o quadro…</p>
            ) : semDemandas ? (
              <p className={styles.vazio}>
                O quadro de {sector} não tem demandas para relatar.
              </p>
            ) : (
              <iframe
                title="Prévia do e-mail"
                className={styles.iframe}
                style={{ width: larguraPreview }}
                srcDoc={srcDoc}
                sandbox=""
              />
            )}
          </div>
        </div>
      </div>

      <footer className={styles.rodape}>
        <button
          className={styles.btnGhost}
          onClick={() => void enviar(true)}
          disabled={ocupado || carregando || semDemandas}
        >
          Enviar teste para mim
        </button>
        <div className={styles.espaco} />
        <button className={styles.btnGhost} onClick={onClose}>
          Fechar
        </button>
        <button
          className={styles.btnEnviar}
          onClick={() => void enviar(false)}
          disabled={
            ocupado || carregando || semDemandas || destinos.length === 0
          }
        >
          {ocupado
            ? "Enviando…"
            : `Enviar${destinos.length ? ` (${destinos.length})` : ""}`}
        </button>
      </footer>
    </Modal>
  );
}
