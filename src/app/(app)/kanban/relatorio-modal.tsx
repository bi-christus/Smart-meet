"use client";

/**
 * Relatório de demandas para o gestor.
 *
 * A prévia é o MESMO HTML que vai ser enviado: a tela roda `agregar` +
 * `montarRelatorio`, e o servidor roda as mesmas funções sobre os mesmos dados.
 * Nenhuma das duas monta HTML por conta própria, e o cliente NÃO manda estilo
 * na requisição — o servidor lê as preferências do Firestore. Prévia que
 * diverge do envio é pior que não ter prévia: dá confiança sem base.
 *
 * O HTML vai num `<iframe srcDoc sandbox>`: é um documento completo, com
 * `<style>` e `<body>` próprios, que vazaria estilo para o app se embutido.
 *
 * As preferências salvam sozinhas, com atraso de 800 ms. O `Modal` fecha no
 * clique do overlay sem confirmar — com botão "Salvar", um clique de 2px fora
 * apagaria a configuração inteira.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  ACENTO_LABEL,
  AGRUPAMENTO_LABEL,
  BLOCO_LABEL,
  CATALOGO_COLUNAS,
  MAX_DESTINATARIOS,
  ORDENACAO_LABEL,
  PESO_MAXIMO,
  PREFS_PADRAO,
  RECORTE_LABEL,
  TEMA_LABEL,
  colunasEfetivas,
  hashPrefs,
  pesoTotal,
  type AcentoId,
  type Agrupamento,
  type Blocos,
  type ColunaId,
  type Ordenacao,
  type PrefsRelatorio,
  type Recorte,
  type TemaId,
} from "@/lib/relatorio/config";
import {
  salvarPrefsRelatorio,
  subscribePrefsRelatorio,
} from "@/lib/relatorio/prefs";
import { ACENTOS } from "@/lib/email/tema";
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
  const [prefs, setPrefs] = useState<PrefsRelatorio | null>(null);
  const [modo, setModo] = useState<Modo>("desktop");
  const [destinos, setDestinos] = useState<string[]>([]);
  const [digitando, setDigitando] = useState("");
  const [recado, setRecado] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<"salvo" | "salvando" | null>(null);
  const [aba, setAba] = useState<"conteudo" | "colunas" | "aparencia">(
    "conteudo",
  );

  const eu = (auth.currentUser?.email ?? "").toLowerCase();

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

  useEffect(() => {
    if (!eu) return;
    const u = subscribePrefsRelatorio(eu, (p) => {
      setPrefs((atual) => atual ?? { ...p, setores: [sector] });
    });
    return () => u();
  }, [eu, sector]);

  // Autosave. O primeiro render não salva — senão abrir a tela já gravaria.
  const primeiro = useRef(true);
  useEffect(() => {
    if (!prefs || !eu) return;
    if (primeiro.current) {
      primeiro.current = false;
      setDestinos(prefs.destinatariosPadrao ?? []);
      return;
    }
    setSalvo("salvando");
    const t = setTimeout(() => {
      salvarPrefsRelatorio(eu, prefs)
        .then(() => setSalvo("salvo"))
        .catch(() => setAviso("Não foi possível salvar suas preferências."));
    }, 800);
    return () => clearTimeout(t);
  }, [prefs, eu]);

  const nomePorEmail = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of usuarios) if (u.name) m[u.email.toLowerCase()] = u.name;
    return m;
  }, [usuarios]);

  const meuNome = nomePorEmail[eu] ?? eu;

  /** Quem já está cadastrado no sistema, para não precisar digitar e-mail. */
  const contatos = useMemo(
    () =>
      usuarios
        .filter((u) => u.active && u.email.toLowerCase() !== eu)
        .sort((a, b) => {
          // Gestores e admins primeiro: o relatório é para eles.
          const peso = (r: string) => (r === "admin" ? 0 : r === "gestor" ? 1 : 2);
          const d = peso(a.role) - peso(b.role);
          return d !== 0 ? d : (a.name || a.email).localeCompare(b.name || b.email);
        }),
    [usuarios, eu],
  );

  // Instante congelado enquanto o modal está aberto: recalcular a cada render
  // faria os "parada há N dias" mudarem sozinhos sob os olhos de quem lê.
  const [agora] = useState(() => Date.now());

  const montado = useMemo(() => {
    if (!cards || !colunas || !prefs) return null;
    const dados = agregar(cards, colunas, nomePorEmail, prefs, agora);
    return {
      dados,
      rel: montarRelatorio(dados, prefs, {
        setores: prefs.setores.length ? prefs.setores : [sector],
        enviadoPor: meuNome,
        recado: recado.trim() || undefined,
        agora,
      }),
    };
  }, [cards, colunas, prefs, nomePorEmail, sector, recado, meuNome, agora]);

  const carregando = !cards || !colunas || !prefs;
  const semDemandas = !carregando && (cards?.length ?? 0) === 0;

  const srcDoc = useMemo(() => {
    if (!montado) return "";
    return modo === "outlook"
      ? montado.rel.html.replace("</head>", `${RESET_OUTLOOK}</head>`)
      : montado.rel.html;
  }, [montado, modo]);

  const efetivas = prefs ? colunasEfetivas(prefs, 1) : [];
  const peso = pesoTotal(efetivas);

  function mudar(patch: Partial<PrefsRelatorio>) {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
  }
  function alternarColuna(id: ColunaId) {
    setPrefs((p) => {
      if (!p) return p;
      const tem = p.colunas.includes(id);
      const colunas = tem
        ? p.colunas.filter((c) => c !== id)
        : [...p.colunas, id];
      return { ...p, colunas };
    });
  }
  function alternarBloco(id: keyof Blocos) {
    setPrefs((p) =>
      p ? { ...p, blocos: { ...p.blocos, [id]: !p.blocos[id] } } : p,
    );
  }

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
    if (!prefs) return;
    setOcupado(true);
    setAviso(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada.");
      // As preferências precisam estar no Firestore ANTES do POST: a rota lê
      // de lá, não do corpo da requisição.
      await salvarPrefsRelatorio(eu, prefs);
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
          prefsRev: hashPrefs(prefs),
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível enviar.");
      setAviso(
        teste
          ? `Teste enviado para você — ${body.demandas} demandas, ${body.linhasEnviadas} linhas.`
          : `Enviado para ${destinos.join(", ")}, com você em cópia.`,
      );
      if (!teste) {
        // Guarda como sugestão para a próxima vez, mas nunca envia sozinho.
        mudar({ destinatariosPadrao: destinos });
      }
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
        <div className={styles.cabecaDir}>
          {salvo && (
            <span className={styles.salvo}>
              {salvo === "salvando" ? "Salvando…" : "Configuração salva"}
            </span>
          )}
          <button className={styles.fechar} onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
      </header>

      <p className={styles.avisoFiltro}>
        <Icon name="clock" size={13} /> O relatório traz o quadro inteiro de{" "}
        {sector}. Os filtros de busca, prioridade e responsável que estiverem
        ligados na tela <strong>não</strong> valem aqui.
      </p>

      <div className={styles.corpo}>
        <div className={styles.controles}>
          <div className={styles.abas}>
            {(["conteudo", "colunas", "aparencia"] as const).map((a) => (
              <button
                key={a}
                className={`${styles.aba} ${aba === a ? styles.abaOn : ""}`}
                onClick={() => setAba(a)}
              >
                {a === "conteudo"
                  ? "Conteúdo"
                  : a === "colunas"
                    ? "Colunas"
                    : "Aparência"}
              </button>
            ))}
          </div>

          {prefs && aba === "conteudo" && (
            <>
              <label className={styles.rot}>O que entra</label>
              <select
                className={styles.select}
                value={prefs.recorte}
                onChange={(e) => mudar({ recorte: e.target.value as Recorte })}
              >
                {(Object.keys(RECORTE_LABEL) as Recorte[]).map((r) => (
                  <option key={r} value={r}>
                    {RECORTE_LABEL[r]}
                  </option>
                ))}
              </select>

              <label className={styles.rot}>Agrupar</label>
              <select
                className={styles.select}
                value={prefs.agrupamento}
                onChange={(e) =>
                  mudar({ agrupamento: e.target.value as Agrupamento })
                }
              >
                {(Object.keys(AGRUPAMENTO_LABEL) as Agrupamento[]).map((a) => (
                  <option key={a} value={a}>
                    {AGRUPAMENTO_LABEL[a]}
                  </option>
                ))}
              </select>

              <label className={styles.rot}>Ordenar</label>
              <select
                className={styles.select}
                value={prefs.ordenacao}
                onChange={(e) =>
                  mudar({ ordenacao: e.target.value as Ordenacao })
                }
              >
                {(Object.keys(ORDENACAO_LABEL) as Ordenacao[]).map((o) => (
                  <option key={o} value={o}>
                    {ORDENACAO_LABEL[o]}
                  </option>
                ))}
              </select>

              <label className={styles.rot}>Blocos</label>
              {(Object.keys(BLOCO_LABEL) as (keyof Blocos)[]).map((b) => (
                <label key={b} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={prefs.blocos[b]}
                    onChange={() => alternarBloco(b)}
                  />
                  {BLOCO_LABEL[b]}
                </label>
              ))}
              <p className={styles.notaPequena}>
                A tabela de demandas não tem interruptor — sem ela não é
                relatório.
              </p>
            </>
          )}

          {prefs && aba === "colunas" && (
            <>
              <label className={styles.rot}>Colunas da tabela</label>
              {CATALOGO_COLUNAS.filter((c) => !c.automatica).map((c) => {
                const forcadaFora =
                  (prefs.agrupamento === "etapa" && c.id === "etapa") ||
                  (prefs.agrupamento === "responsavel" &&
                    c.id === "responsavel") ||
                  (prefs.agrupamento === "prioridade" && c.id === "prioridade");
                return (
                  <label
                    key={c.id}
                    className={`${styles.check} ${forcadaFora ? styles.checkFora : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={c.fixa || prefs.colunas.includes(c.id)}
                      disabled={c.fixa || forcadaFora}
                      onChange={() => alternarColuna(c.id)}
                    />
                    {c.rotulo}
                    {c.fixa && <span className={styles.tagFixa}>sempre</span>}
                    {forcadaFora && (
                      <span className={styles.tagFixa}>já é o agrupamento</span>
                    )}
                  </label>
                );
              })}

              <div
                className={`${styles.medidor} ${peso > PESO_MAXIMO ? styles.medidorCheio : ""}`}
              >
                <div className={styles.medidorBarra}>
                  <div
                    className={styles.medidorFill}
                    style={{ width: `${Math.min(100, (peso / PESO_MAXIMO) * 100)}%` }}
                  />
                </div>
                <span>
                  {peso > PESO_MAXIMO
                    ? "Largura acima do que cabe — o Outlook começa a quebrar palavras no meio. Desmarque uma coluna."
                    : `Largura usada: ${Math.round((peso / PESO_MAXIMO) * 100)}%`}
                </span>
              </div>
              <p className={styles.notaPequena}>
                A trava é de largura, não de quantidade: quatro colunas largas
                estouram, seis estreitas cabem.
              </p>
            </>
          )}

          {prefs && aba === "aparencia" && (
            <>
              <label className={styles.rot}>Tema</label>
              <select
                className={styles.select}
                value={prefs.tema}
                onChange={(e) => mudar({ tema: e.target.value as TemaId })}
              >
                {(Object.keys(TEMA_LABEL) as TemaId[]).map((t) => (
                  <option key={t} value={t}>
                    {TEMA_LABEL[t]}
                  </option>
                ))}
              </select>

              <label className={styles.rot}>Cor de destaque</label>
              <div className={styles.acentos}>
                {(Object.keys(ACENTO_LABEL) as AcentoId[]).map((a) => (
                  <button
                    key={a}
                    className={`${styles.acento} ${prefs.acento === a ? styles.acentoOn : ""}`}
                    style={{ background: ACENTOS[a].cor }}
                    onClick={() => mudar({ acento: a })}
                    title={ACENTO_LABEL[a]}
                    aria-label={ACENTO_LABEL[a]}
                  />
                ))}
              </div>

              <label className={styles.rot}>Densidade</label>
              <select
                className={styles.select}
                value={prefs.densidade}
                onChange={(e) =>
                  mudar({
                    densidade: e.target.value as "confortavel" | "compacto",
                  })
                }
              >
                <option value="confortavel">Confortável</option>
                <option value="compacto">Compacto</option>
              </select>

              <p className={styles.notaPequena}>
                As quatro cores foram medidas contra branco e todas passam no
                contraste mínimo. Por isso não há cor livre: um hex qualquer
                pode sair ilegível no e-mail de quem recebe.
              </p>

              <button
                className={styles.restaurar}
                onClick={() =>
                  setPrefs({ ...PREFS_PADRAO, setores: [sector] })
                }
              >
                Restaurar o padrão
              </button>
            </>
          )}
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
            <div className={styles.espaco} />
            {montado && (
              <span className={styles.contador}>
                {montado.rel.linhasEnviadas} linhas ·{" "}
                {Math.round(montado.rel.bytes / 1024)} KB de 85
                {montado.rel.linhasCortadas > 0
                  ? ` · ${montado.rel.linhasCortadas} cortadas`
                  : ""}
              </span>
            )}
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

      <div className={styles.envio}>
        <div className={styles.envioCol}>
          <label className={styles.rot}>Enviar para</label>
          <div className={styles.linhaDestino}>
            <select
              className={styles.select}
              value=""
              onChange={(e) => {
                addDestino(e.target.value);
                e.currentTarget.value = "";
              }}
            >
              <option value="">Escolher da equipe…</option>
              {contatos
                .filter((u) => !destinos.includes(u.email.toLowerCase()))
                .map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name || u.email}
                    {u.role !== "operador" ? ` — ${u.role}` : ""}
                  </option>
                ))}
            </select>
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
              placeholder="ou digite um e-mail e tecle Enter"
            />
          </div>
          {destinos.length > 0 && (
            <div className={styles.chips}>
              {destinos.map((d) => (
                <span key={d} className={styles.chip}>
                  {nomePorEmail[d] ?? d}
                  <button
                    onClick={() => setDestinos((x) => x.filter((y) => y !== d))}
                    aria-label={`Remover ${d}`}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={styles.envioCol}>
          <label className={styles.rot}>Recado no topo (opcional)</label>
          <textarea
            className={styles.area}
            rows={2}
            value={recado}
            onChange={(e) => setRecado(e.target.value)}
            maxLength={800}
            placeholder="Aparece citado antes dos números."
          />
        </div>
      </div>

      {aviso && <p className={styles.aviso}>{aviso}</p>}

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
