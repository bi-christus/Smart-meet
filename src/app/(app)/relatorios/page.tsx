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
 * proposta pendente — a pergunta que a pessoa realmente faz é "não tenho mais
 * nada aqui?", e é essa que a palavra precisa responder.
 *
 * E É ESSA MESMA REGRA QUE DIVIDE A TELA EM DUAS. Era uma grade só, em ordem de
 * chegada da consulta: uma reunião de fevereiro já conferida ocupava o mesmo
 * tamanho e o mesmo peso de uma de ontem com três demandas esperando decisão — e
 * o problema crescia sozinho, porque cada reunião processada acrescenta um card
 * e nenhum sai. Agora o que pede decisão fica solto e em cima; o que já foi
 * resolvido desce para pastas por setor, fechadas.
 *
 * OS TRÊS FILTROS SAÍRAM. Eles escondiam, não organizavam — e as duas seções são
 * exatamente o que eles filtravam. Mantidos junto, seriam dois jeitos de fazer a
 * mesma coisa na mesma tela. No lugar entrou a BUSCA, que responde à pergunta
 * que as pastas criam: achar uma reunião específica sem abrir pasta por pasta.
 */
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import {
  subscribeMeetings,
  updateMeeting,
  DRIVE_OUTPUT_LABEL,
  type Meeting,
  type DriveOutputKind,
} from "@/lib/meetings";
import { subscribePropostas, type Proposta } from "@/lib/demandas";
import { Icon } from "@/components/icons";
import { OverlayPortal } from "@/components/overlay-portal";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { organizar } from "@/lib/relatorios-core";
import { PropostaForm } from "./proposta-form";
import { DocViewer } from "./doc-viewer";
import styles from "./relatorios.module.css";

/**
 * Listas vazias constantes: `?? []` no corpo do componente cria um array novo
 * a cada render, e os `useMemo` que dependem dele recalculariam sempre.
 */
const SEM_MEETINGS: Meeting[] = [];
const SEM_PROPOSTAS: Proposta[] = [];

const OUTPUT_ICON: Record<DriveOutputKind, string> = {
  transcricao: "chat",
  resumo: "check",
  // Mesmo ícone da tela de Reuniões, e pelo mesmo motivo: a pauta é documento de
  // trabalho, não uma quarta ata para ler.
  pauta: "prancheta",
  detalhada: "relatorios",
  didatica: "reunioes",
};

function fmtDate(d: string): string {
  const p = d.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}



export default function RelatoriosPage() {
  const { profile } = useAuth();

  const sectors = useSetoresDaPessoa(profile);

  /**
   * As duas assinaturas da tela. Antes, as duas jogavam o erro no console — e
   * console não é tratamento: ninguém abre o DevTools para descobrir por que a
   * lista está vazia.
   */
  const chaveSetores = sectors.join("|");
  const fMeetings = useAsyncData<Meeting>(chaveSetores, (onData, onErro) =>
    subscribeMeetings(sectors, onData, onErro),
  );
  const fPropostas = useAsyncData<Proposta>(chaveSetores, (onData, onErro) =>
    subscribePropostas(sectors, onData, onErro),
  );

  const meetings = fMeetings.data ?? SEM_MEETINGS;
  const propostas = fPropostas.data ?? SEM_PROPOSTAS;

  // As propostas entram junto: os contadores de cada filtro e o selo de
  // pendência de cada card saem delas, e mostrá-los zerados antes da resposta
  // diria que não há nada a decidir quando pode haver.
  const tela = juntarFontes([fMeetings, fPropostas]);
  const reabrirTela = () => {
    fMeetings.tentarDeNovo();
    fPropostas.tentarDeNovo();
  };

  const [busca, setBusca] = useState("");
  const [view, setView] = useState<string | null>(null);

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

  /**
   * A tela inteira sai daqui: o que pede decisão, e o arquivo por setor.
   *
   * `resolvida` entra por parâmetro porque metade da regra é desta tela — ela
   * depende das propostas, que `relatorios-core` não conhece. Levá-la para lá
   * arrastaria a coleção junto e tiraria do módulo puro justamente a
   * propriedade que faz o teste existir.
   */
  const organizado = useMemo(
    () => organizar(reports, resolvida, busca),
    // `reports` e `resolvida` são recalculados a cada render (saem de filtros
    // sobre `meetings`), então a lista de dependências real é a de baixo — as
    // duas mudam exatamente quando uma delas muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meetings, porReuniao, profile, busca],
  );

  const aberta = view ? (reports.find((m) => m.id === view) ?? null) : null;

  if (!profile) return null;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Relatórios IA</h1>
        <p>
          O que saiu de cada reunião: transcrição, atas e as demandas propostas.
          Abra para conferir e transformar em trabalho.
        </p>
      </div>

      {/* A busca substitui os três filtros. Com o arquivo dentro de pastas,
          "achar aquela reunião do RH" deixou de ser uma questão de rolar e
          passou a ser de procurar — e abrir pasta por pasta é pior do que a
          grade solta que estava aí antes. */}
      <div className={styles.buscaLinha}>
        <span className={styles.buscaCampo}>
          <Icon name="search" size={15} />
          <input
            className={styles.buscaInput}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título ou setor…"
            aria-label="Buscar reunião por título ou setor"
          />
        </span>
        {/* A contagem espera a resposta chegar, como o resto do app: um "0
            reuniões" antes dela é a mesma afirmação falsa de "nenhuma", em
            número. */}
        {!tela.carregando && !tela.erro && busca.trim() !== "" && (
          <span className={styles.buscaConta}>
            {organizado.total}{" "}
            {organizado.total === 1 ? "reunião encontrada" : "reuniões encontradas"}
          </span>
        )}
      </div>

      {tela.erro ? (
        <ErrorState error={tela.erro} onRetry={reabrirTela} />
      ) : tela.carregando ? (
        <SkeletonRow rows={4} texto="Carregando os relatórios…" />
      ) : organizado.total === 0 ? (
        <EmptyState
          icon="relatorios"
          title={
            busca.trim()
              ? "Nenhuma reunião com esse termo"
              : "Nenhuma reunião aqui ainda"
          }
          description={
            busca.trim()
              ? "A busca olha o título e o setor. Tente uma palavra do assunto, ou limpe o campo para ver tudo."
              : "Quando o processamento gerar as atas de uma reunião, ela aparece aqui com os documentos e as demandas propostas."
          }
        />
      ) : (
        <>
          {/**
           * O QUE PEDE DECISÃO, solto e em cima.
           *
           * Sem cabeçalho de seção quando não há arquivo nenhum: numa conta
           * nova, "A VALIDAR" sobre a única fileira da tela nomeia uma divisão
           * que não existe. O título aparece quando há um segundo grupo do qual
           * se distinguir.
           */}
          {organizado.pendentes.length > 0 && (
            <section className={styles.secao}>
              {organizado.pastas.length > 0 && (
                <h2 className={styles.secaoTitulo}>
                  A validar
                  <span className={styles.secaoConta}>
                    {organizado.pendentes.length}
                  </span>
                </h2>
              )}
              <div className={styles.grid}>
                {organizado.pendentes.map((m) => (
                  <CardReuniao
                    key={m.id}
                    meeting={m}
                    propostas={porReuniao.get(m.id) ?? []}
                    resolvida={false}
                    onAbrir={() => setView(m.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/**
           * NADA A VALIDAR é uma resposta, e precisa ser dita.
           *
           * Sem esta linha, quem chegasse com a fila limpa veria a tela abrir
           * direto nas pastas fechadas — quase vazia — e leria isso como "não
           * carregou". É o mesmo falso vazio que o resto do app persegue, só
           * que causado pela boa notícia.
           */}
          {organizado.pendentes.length === 0 && organizado.pastas.length > 0 && (
            <div className={styles.tudoEmDia}>
              <Icon name="check" size={16} />
              Nada a validar{busca.trim() ? " neste recorte" : ""}. Tudo o que já
              foi conferido está guardado abaixo, por setor.
            </div>
          )}

          {/**
           * O ARQUIVO, uma pasta por setor e todas FECHADAS.
           *
           * `<details>` nativo, e não um estado de React com altura animada: ele
           * já traz o teclado, o leitor de tela e o Ctrl+F do navegador (que
           * encontra dentro de pasta fechada em navegadores modernos). Animar a
           * altura da lista seria custo sem informação — a skill de motion do
           * projeto chama isso pelo nome, e aqui a lista pode ter cinquenta
           * cards.
           *
           * Fechadas por padrão porque o pedido era este: o que já foi validado
           * sai da frente. Quem quer um arquivo específico abre um; quem chegou
           * para trabalhar não passa por ele.
           */}
          {organizado.pastas.length > 0 && (
            <section className={styles.secao}>
              <h2 className={styles.secaoTitulo}>
                Validadas
                <span className={styles.secaoConta}>
                  {organizado.pastas.reduce((n, p) => n + p.itens.length, 0)}
                </span>
              </h2>
              <div className={styles.pastas}>
                {organizado.pastas.map((pasta) => (
                  <details
                    key={pasta.setor}
                    className={styles.pasta}
                    /* Buscando, as pastas abrem: procurar e ter de abrir uma a
                       uma para ver se achou é a busca não respondendo. */
                    open={busca.trim() !== ""}
                  >
                    <summary className={styles.pastaHead}>
                      {/* `chevronRight`, girado por CSS quando a pasta abre —
                          não existe um chevron neutro no conjunto, e inventar
                          um só para cá daria dois desenhos de seta no app. */}
                      <Icon name="chevronRight" size={14} />
                      <Icon name="pasta" size={15} />
                      <span className={styles.pastaNome}>{pasta.setor}</span>
                      <span className={styles.pastaConta}>
                        {pasta.itens.length}
                      </span>
                    </summary>
                    <div className={styles.grid}>
                      {pasta.itens.map((m) => (
                        <CardReuniao
                          key={m.id}
                          meeting={m}
                          propostas={porReuniao.get(m.id) ?? []}
                          resolvida
                          onAbrir={() => setView(m.id)}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}
        </>
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

/**
 * Um card de reunião — o mesmo desenho nas duas seções.
 *
 * Ele já era o mesmo antes, escrito inline dentro do `.map`. Extraí-lo virou
 * obrigação quando surgiu o segundo lugar que o desenha: duas cópias do card se
 * separam na primeira mudança, e a divergência sairia justamente entre "o que
 * pede decisão" e "o que já foi resolvido" — os dois grupos que a tela existe
 * para você comparar.
 */
function CardReuniao({
  meeting,
  propostas,
  resolvida,
  onAbrir,
}: {
  meeting: Meeting;
  propostas: Proposta[];
  resolvida: boolean;
  onAbrir: () => void;
}) {
  const pend = propostas.filter((p) => p.status === "pendente").length;
  const aceitas = propostas.filter((p) => p.status === "aceita").length;
  const docs = meeting.driveOutputs?.length ?? 0;
  return (
    <button
      className={`${styles.card} ${resolvida ? styles.cardOk : ""}`}
      onClick={onAbrir}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardSector}>{meeting.sector}</span>
        <span
          className={`${styles.pill} ${resolvida ? styles.pillOk : styles.pillPend}`}
        >
          {resolvida ? "Validada" : "A validar"}
        </span>
      </div>

      <h3 className={styles.cardTitle}>{meeting.title}</h3>
      <div className={styles.cardDate}>{fmtDate(meeting.date)}</div>

      <div className={styles.cardFoot}>
        <span className={styles.chip}>
          <Icon name="relatorios" size={13} />
          {docs} documento{docs === 1 ? "" : "s"}
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
    <OverlayPortal>
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
    </OverlayPortal>
  );
}
