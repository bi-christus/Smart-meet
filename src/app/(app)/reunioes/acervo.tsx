"use client";

/**
 * O acervo de reuniões — por setor e mês, ou só por data (#249).
 *
 * Saiu de `page.tsx` porque a tela de Reuniões já tinha 1.400 linhas e três
 * assuntos (captura, esteira e acervo), e o acervo era o único que crescia sem
 * parar. Ele recebe as reuniões prontas: a assinatura continua lá em cima,
 * UMA só para a esteira e o acervo, e por isso os dois saem do esqueleto no
 * mesmo instante.
 *
 * NADA AQUI ANIMA ao buscar, filtrar, trocar de visão ou abrir uma seção. São
 * gestos de alta frequência (AGENTS.md §3), e o acervo antigo reanimava a lista
 * inteira — 68 cards de B.I. com fade de 0,3 s — a cada clique de filtro. O
 * único movimento é o giro de 180 ms do chevron, que diz que a seção abriu.
 */

import { useMemo, useState, useSyncExternalStore } from "react";

import {
  MEETING_STATUS_LABEL,
  SEND_LABEL,
  type Meeting,
  type MeetingStatus,
} from "@/lib/meetings";
import { diaDaReuniao, montarAcervo, type MesDoAcervo } from "@/lib/acervo-core";
import { Icon } from "@/components/icons";
import { SeloSetor } from "@/components/selo-setor";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import base from "./reunioes.module.css";
import styles from "./acervo.module.css";

type Visao = "setor" | "data";

/**
 * A visão escolhida, lembrada no navegador — é preferência de quem olha, como
 * o tema.
 *
 * Lida como fonte externa (`useSyncExternalStore`), o mesmo desenho de
 * `theme.tsx`, e não `useState` com um efeito que lê o `localStorage` na
 * montagem: esse é o `set-state-in-effect` que o lint reprova, e o
 * inicializador preguiçoso do `useState` divergiria na hidratação no dia em que
 * esta tela for desenhada no servidor. Aqui o servidor responde o padrão, o
 * navegador o guardado, e o React concilia sem efeito nenhum.
 *
 * `memoria` segura a escolha quando o `localStorage` recusa (janela anônima,
 * cota cheia): vale até recarregar.
 */
const CHAVE_VISAO = "sm_acervo_visao";
let memoria: Visao | null = null;
const ouvintes = new Set<() => void>();

function lerVisao(): Visao {
  try {
    const v = localStorage.getItem(CHAVE_VISAO);
    if (v === "data" || v === "setor") return v;
  } catch {
    /* sem localStorage: vale a memória */
  }
  return memoria ?? "setor";
}

function gravarVisao(v: Visao) {
  memoria = v;
  try {
    localStorage.setItem(CHAVE_VISAO, v);
  } catch {
    /* sem armazenamento: vale até recarregar, só isso */
  }
  ouvintes.forEach((f) => f());
}

function assinarVisao(aviso: () => void) {
  ouvintes.add(aviso);
  window.addEventListener("storage", aviso);
  return () => {
    ouvintes.delete(aviso);
    window.removeEventListener("storage", aviso);
  };
}

const visaoNoServidor = (): Visao => "setor";

const STATUS_CLASS: Record<MeetingStatus, string> = {
  aguardando: base.st_aguardando,
  processando: base.st_processando,
  processado: base.st_processado,
};

type Acoes = {
  onOpen: (m: Meeting) => void;
  onDelete: (m: Meeting) => void;
  canSeeAudio: (m: Meeting) => boolean;
};

export function Acervo({
  meetings,
  carregando,
  erro,
  onTentarDeNovo,
  ...acoes
}: {
  meetings: Meeting[];
  carregando: boolean;
  erro: Error | null;
  onTentarDeNovo: () => void;
} & Acoes) {
  const visaoEscolhida = useSyncExternalStore(
    assinarVisao,
    lerVisao,
    visaoNoServidor,
  );
  const [busca, setBusca] = useState("");
  /** Chave (`chaveDoSetor`) do filtro da visão por data; `null` é todas. */
  const [filtro, setFiltro] = useState<string | null>(null);
  /**
   * Seção aberta ou fechada, por chave — só o que a PESSOA mexeu.
   *
   * Ausente quer dizer "o padrão": a primeira seção aberta, as outras
   * fechadas. Guardar só o que foi mexido, e não o estado de todas, é o que
   * deixa uma seção nova (o primeiro áudio de um setor) nascer no padrão sem
   * efeito nenhum para inicializá-la.
   */
  const [mexidas, setMexidas] = useState<Record<string, boolean>>({});

  const acervo = useMemo(
    () => montarAcervo(meetings, { busca, setor: filtro }),
    [meetings, busca, filtro],
  );
  const buscando = busca.trim() !== "";
  // Com um setor só não há o que trocar: a visão é a de meses, qualquer que
  // seja a escolha guardada — e a escolha fica guardada para quando houver.
  const visao: Visao = acervo.porSetor ? visaoEscolhida : "data";
  const pronto = !carregando && !erro;
  const mostrar = visao === "setor" ? acervo.encontradas : acervo.naVisaoPorData;

  return (
    <section className={styles.acervo}>
      <div className={styles.head}>
        <h2>Acervo de reuniões</h2>
        {/* Os controles esperam a resposta: buscar ou trocar de visão num
            acervo que ainda não chegou é oferecer um gesto que não responde. */}
        {pronto && acervo.totalGeral > 0 && (
          <>
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
            {acervo.porSetor && (
              <div
                className={styles.visoes}
                role="group"
                aria-label="Organizar o acervo"
              >
                {(
                  [
                    ["setor", "Por setor"],
                    ["data", "Por data"],
                  ] as [Visao, string][]
                ).map(([id, rotulo]) => (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.visaoBtn} ${visao === id ? styles.visaoOn : ""}`}
                    aria-pressed={visao === id}
                    onClick={() => gravarVisao(id)}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Filtro de setor só na visão por data: na outra, cada setor JÁ é uma
          seção, e um filtro ali seria um segundo jeito de fazer a mesma coisa.
          Os botões saem dos setores COM reunião — o admin não vê três botões
          que levam a um vazio. */}
      {pronto && visao === "data" && acervo.porSetor && (
        <div
          className={styles.filtros}
          role="group"
          aria-label="Filtrar por setor"
        >
          <button
            type="button"
            className={`${styles.filtroBtn} ${acervo.filtro === null ? styles.filtroOn : ""}`}
            aria-pressed={acervo.filtro === null}
            onClick={() => setFiltro(null)}
          >
            Todas
            <span className={styles.filtroConta}>{acervo.totalGeral}</span>
          </button>
          {acervo.setores.map((s) => (
            <button
              key={s.chave}
              type="button"
              className={`${styles.filtroBtn} ${acervo.filtro === s.chave ? styles.filtroOn : ""}`}
              aria-pressed={acervo.filtro === s.chave}
              onClick={() => setFiltro(s.chave)}
            >
              <SeloSetor setor={s.setor} />
              <span className={styles.filtroConta}>{s.total}</span>
            </button>
          ))}
        </div>
      )}

      {/* A contagem espera a resposta, como o resto do app: "0 reuniões"
          antes dela é a mesma afirmação falsa de "nenhuma", em número. */}
      {pronto && buscando && acervo.totalGeral > 0 && (
        <p className={styles.buscaConta} aria-live="polite">
          {mostrar} {mostrar === 1 ? "reunião encontrada" : "reuniões encontradas"}
        </p>
      )}

      {erro ? (
        <ErrorState error={erro} onRetry={onTentarDeNovo} />
      ) : carregando ? (
        <SkeletonRow rows={4} texto="Carregando o acervo de reuniões…" />
      ) : acervo.totalGeral === 0 ? (
        <EmptyState
          icon="reunioes"
          title="Nenhuma reunião ainda"
          description="Envie um áudio acima para registrar a primeira. O Cowork transcreve e a ata volta para cá."
        />
      ) : mostrar === 0 ? (
        // Só chega aqui buscando: sem busca, o filtro sempre aponta para um
        // setor que tem reunião (ver `montarAcervo`).
        <EmptyState
          icon="search"
          title="Nenhuma reunião com esse termo"
          description={
            acervo.filtro !== null
              ? "A busca olha o título e o setor, só no setor escolhido. Tente outra palavra, ou volte para Todas."
              : "A busca olha o título e o setor. Tente uma palavra do assunto, ou limpe o campo para ver tudo."
          }
        />
      ) : visao === "setor" ? (
        <div className={styles.secoes}>
          {acervo.secoes.map((s, i) => {
            // Buscando, toda seção que sobrou abre: procurar e ter de abrir uma
            // a uma para ver se achou é a busca não respondendo.
            const aberta = buscando || (mexidas[s.chave] ?? i === 0);
            return (
              <details
                key={s.chave}
                className={styles.secao}
                open={aberta}
                onToggle={(e) => {
                  // O `toggle` também dispara quando o React muda o `open`
                  // (a busca abriu, a busca limpou). Só vira escolha da pessoa
                  // o que diverge do que a tela pediu — e nada durante a busca,
                  // que abre tudo por conta própria.
                  const agora = e.currentTarget.open;
                  if (buscando || agora === aberta) return;
                  setMexidas((m) => ({ ...m, [s.chave]: agora }));
                }}
              >
                <summary className={styles.secaoHead}>
                  {/* `chevronRight` girado por CSS, o mesmo de Relatórios IA:
                      não há chevron neutro no conjunto de ícones. */}
                  <Icon name="chevronRight" size={14} />
                  <SeloSetor setor={s.setor} tamanho={16} className={styles.secaoNome} />
                  <span className={styles.secaoConta}>
                    {buscando ? `${s.encontradas} de ${s.total}` : s.total}
                  </span>
                </summary>
                <div className={styles.gaveta}>
                  <Meses meses={s.meses} comSelo={false} {...acoes} />
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        // Por data, e também a única visão de quem tem um setor só. Aí o selo
        // repetido em cada reunião não distingue nada, e sai.
        <div className={styles.porData}>
          <Meses meses={acervo.meses} comSelo={acervo.porSetor} {...acoes} />
        </div>
      )}
    </section>
  );
}

/** Os meses, cada um com o seu cabeçalho fixo e as reuniões dele. */
function Meses({
  meses,
  comSelo,
  ...acoes
}: { meses: MesDoAcervo<Meeting>[]; comSelo: boolean } & Acoes) {
  return (
    <>
      {meses.map((mes) => (
        <section key={mes.chave} className={styles.mes}>
          <h3 className={styles.mesTitulo}>
            {mes.rotulo}
            <span className={styles.mesConta}>· {mes.itens.length}</span>
          </h3>
          <div className={styles.lista}>
            {mes.itens.map((m) => (
              <Reuniao key={m.id} m={m} comSelo={comSelo} {...acoes} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function Reuniao({
  m,
  comSelo,
  onOpen,
  onDelete,
  canSeeAudio,
}: { m: Meeting; comSelo: boolean } & Acoes) {
  const dia = diaDaReuniao(m.date);
  return (
    // O card inteiro abre a reunião com o mouse; o título é o BOTÃO, para o
    // teclado e o leitor de tela. O card não pode ser ele mesmo um <button>:
    // tem dentro o link do Drive e o botão de apagar, e interativo dentro de
    // interativo é HTML inválido.
    <div className={styles.item} onClick={() => onOpen(m)}>
      <div className={styles.itemMain}>
        <button
          type="button"
          className={styles.itemTitulo}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(m);
          }}
        >
          {m.title}
        </button>
        <div className={styles.itemMeta}>
          {comSelo && <SeloSetor setor={m.sector} />}
          <span>{dia ?? "sem data"}</span>
          <span>via {SEND_LABEL[m.send ?? "file"]}</span>
          {/* só quando alguém marcou presença no modal da reunião — o
              registro inicial não pede participantes */}
          {(m.participants?.length ?? 0) > 0 && (
            <span>{m.participants!.length} participante(s)</span>
          )}
          {m.driveLink && canSeeAudio(m) && (
            <a
              href={m.driveLink}
              target="_blank"
              rel="noopener noreferrer"
              className={base.driveLink}
              onClick={(e) => e.stopPropagation()}
            >
              Áudio no Drive
            </a>
          )}
        </div>
      </div>
      <span className={`${styles.badge} ${STATUS_CLASS[m.status]}`}>
        {MEETING_STATUS_LABEL[m.status]}
      </span>
      <button
        type="button"
        className={base.delBtn}
        title="Apagar gravação"
        aria-label={`Apagar a gravação “${m.title}”`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(m);
        }}
      >
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}
