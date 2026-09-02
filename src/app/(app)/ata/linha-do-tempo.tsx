"use client";

import { useMemo, useState } from "react";
import {
  MEDIDAS,
  MEDIDA_AJUDA,
  MEDIDA_LABEL,
  maisPerto,
  montarLinhaDoTempo,
  resumoDaBusca,
  reuniaoCasa,
  tracar,
  valorDa,
  type Caixa,
  type Medida,
  type ReuniaoNaLinha,
} from "@/lib/ata-linha-do-tempo-core";
import {
  STATUS_TAREFA_LABEL,
  type Ata,
  type ItemDeAta,
} from "@/lib/ata";
import type { UserProfile } from "@/lib/users";
import { fmtDayMonth } from "@/lib/datas";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { Modal } from "@/components/modal";
import { EmptyState } from "@/components/empty-state";
import styles from "./linha-do-tempo.module.css";

/**
 * Linha do tempo das reuniões — o histórico do setor num eixo só.
 *
 * O QUE ELA RESPONDE, e que a aba não respondia: a tela da ata mostra UMA
 * reunião de cada vez, escolhida num seletor. Perguntas de série — "com que
 * frequência este setor se reúne?", "as reuniões estão gerando tarefa ou só
 * conversa?", "em que reunião foi que se falou de estoque?" — não tinham onde
 * ser feitas. Cada uma delas exigia abrir as atas uma a uma e lembrar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS DECISÕES DE DESENHO, e por que cada uma
 *
 * UMA SÉRIE, NA COR DA MARCA. O porquê inteiro está no cabeçalho de
 * `ata-linha-do-tempo-core.ts`: a paleta categórica deste projeto não fecha (a
 * marca troca de cor com o acento e os cinco status ocupam o resto do círculo),
 * e a saída boa é a forma de ÊNFASE — o que importa aceso, o resto em cinza.
 * É também o que a busca por palavra precisa, de graça.
 *
 * O ALVO DO MOUSE É A FAIXA INTEIRA. Exigir que o mouse acerte um círculo de
 * 9px é o anti-padrão clássico do gráfico interativo: o alvo é menor que a mão.
 * Um retângulo transparente cobre o plot e `maisPerto` responde qual ponto é.
 *
 * O BALÃO É BREVE E DIZ QUANTO FALTA. Uma reunião de dezoito itens não cabe num
 * balão, e um balão que rola é um balão que foge do mouse. Cinco itens e "e
 * mais treze" — e o clique abre tudo.
 *
 * TEM VISTA DE TABELA, e não é enfeite: balão é a única forma de leitura que
 * exclui quem não usa mouse e quem lê com leitor de tela. Todo valor que o
 * gráfico mostra está na tabela, que é navegável por teclado.
 *
 * SEM ANIMAÇÃO DE ENTRADA. A linha não se desenha da esquerda para a direita e
 * os pontos não pulsam: pela Frequency Gate do AGENTS.md §3, mover o mouse
 * sobre um gráfico é interação de alta frequência, e animar aí é lentidão
 * percebida. O que responde ao mouse — a mira, o raio do ponto, o balão — muda
 * no mesmo quadro.
 */

/**
 * A caixa do desenho, em unidades de `viewBox`.
 *
 * O SVG escala junto com o modal, então estas não são pixels na tela — são a
 * régua interna. A margem de baixo (34) é a FAIXA DO EIXO X: sem ela o
 * contêiner corta as datas, que é o defeito de gráfico mais comum em card de
 * altura fixa. A da esquerda (44) cabe "100" sem encostar na grade.
 */
const CAIXA: Caixa = {
  larg: 980,
  alt: 320,
  margem: { topo: 18, dir: 26, baixo: 34, esq: 44 },
};

/** Quantos itens cabem no balão antes do "e mais N". */
const NO_BALAO = 5;

export function LinhaDoTempo({
  setor,
  atas,
  tituloDoCard,
  classeDoItem,
  nomeDe,
  usersMap,
  onFechar,
  onAbrirAta,
}: {
  setor: string;
  /** Todas as atas do setor — a assinatura da tela já as tem inteiras. */
  atas: Ata[];
  tituloDoCard: (cardId: string) => string;
  /** "D1 · Cadeia de Suprimentos · Estoque", ou vazio. */
  classeDoItem: (item: ItemDeAta) => string;
  nomeDe: (email: string) => string;
  usersMap: Record<string, UserProfile>;
  onFechar: () => void;
  /** Levar a pessoa até esta ata na tela de trás, e fechar o modal. */
  onAbrirAta: (ataId: string) => void;
}) {
  const [termo, setTermo] = useState("");
  const [medida, setMedida] = useState<Medida>("pauta");
  const [tabela, setTabela] = useState(false);
  const [focado, setFocado] = useState<number | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  const { pontos, semData } = useMemo(
    () => montarLinhaDoTempo({ atas, tituloDoCard, termo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [atas, termo],
  );
  const t = useMemo(() => tracar(pontos, medida, CAIXA), [pontos, medida]);

  const buscando = !!termo.trim();
  const achado = resumoDaBusca(pontos);
  const alvo = focado !== null ? t.pts[focado] : null;

  /** O ponto sob o mouse, achado pela FAIXA e não pelo círculo. */
  function mirar(e: React.MouseEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    // O SVG escala com o modal: o X do mouse tem de voltar para a régua interna
    // antes de ser comparado com as coordenadas do traçado.
    const x = ((e.clientX - r.left) * CAIXA.larg) / (r.width || 1);
    const i = maisPerto(t.pts, x);
    setFocado(i < 0 ? null : i);
  }

  const ataAberta = aberta ? atas.find((a) => a.id === aberta) : undefined;

  return (
    <>
      <Modal
        onClose={onFechar}
        ariaLabel="Linha do tempo das reuniões"
        overlayClassName={styles.overlay}
        className={styles.modal}
      >
        <div className={styles.cabeca}>
          <div>
            <div className={styles.chips}>
              <span className={styles.chip}>
                <Icon name="trend" size={12} /> Linha do tempo
              </span>
              <span className={styles.chip}>{setor}</span>
            </div>
            <h2 className={styles.titulo}>
              {pontos.length} reuni{pontos.length === 1 ? "ão" : "ões"} no eixo
            </h2>
            <p className={styles.sub}>{MEDIDA_AJUDA[medida]}</p>
          </div>
          <button
            className={styles.fechar}
            onClick={onFechar}
            aria-label="Fechar a linha do tempo"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        {/* A FILEIRA DE FILTROS FICA ACIMA DE TUDO O QUE ELA GOVERNA, e nunca
            dentro do quadro do gráfico: o mesmo recorte vale para o gráfico e
            para a tabela, e um controle dentro do card sugeriria que ele só
            manda ali. */}
        <div className={styles.controles}>
          <div className={styles.busca}>
            <Icon name="search" size={14} />
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Em que reunião se falou de…"
              aria-label="Buscar uma palavra nas reuniões"
            />
            {termo && (
              <button onClick={() => setTermo("")} aria-label="Limpar a busca">
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <div className={styles.medidas} role="group" aria-label="O que o eixo mede">
            {MEDIDAS.map((m) => (
              <button
                key={m}
                className={`${styles.medidaBtn} ${m === medida ? styles.medidaOn : ""}`}
                onClick={() => setMedida(m)}
                aria-pressed={m === medida}
              >
                {MEDIDA_LABEL[m]}
              </button>
            ))}
          </div>
          <button
            className={styles.vistaBtn}
            onClick={() => setTabela((v) => !v)}
            aria-pressed={tabela}
            title={tabela ? "Ver o gráfico" : "Ver os mesmos números em tabela"}
          >
            <Icon name={tabela ? "trend" : "planilha"} size={13} />
            {tabela ? "Gráfico" : "Tabela"}
          </button>
        </div>

        {buscando && (
          <p className={styles.achado} role="status">
            {achado.reunioes === 0 ? (
              <>
                <Icon name="warn" size={13} /> Nenhuma reunião falou de “{termo}”.
              </>
            ) : (
              <>
                <Icon name="check" size={13} /> “{termo}” aparece em{" "}
                <b>
                  {achado.reunioes} de {pontos.length}
                </b>{" "}
                reuniões
                {achado.itens > 0 && (
                  <>
                    , em <b>{achado.itens}</b> ite{achado.itens === 1 ? "m" : "ns"} da
                    pauta
                  </>
                )}
                . As demais ficam apagadas no gráfico.
              </>
            )}
          </p>
        )}

        {pontos.length === 0 ? (
          <EmptyState
            icon="ata"
            title={
              atas.length === 0
                ? "Este setor ainda não tem ata"
                : "Nenhuma reunião tem data"
            }
            description={
              atas.length === 0
                ? "A linha do tempo se desenha a partir das atas do setor. Gere a primeira a partir de uma reunião gravada."
                : "Um eixo de tempo precisa de data, e nenhuma das atas deste setor tem uma. Abra a ata e preencha a data no cabeçalho."
            }
          />
        ) : tabela ? (
          <Tabela
            pontos={pontos}
            medida={medida}
            buscando={buscando}
            onAbrir={setAberta}
          />
        ) : (
          <div className={styles.quadro}>
            <div className={styles.rolagem}>
              <div className={styles.plano}>
                <svg
                  viewBox={`0 0 ${CAIXA.larg} ${CAIXA.alt}`}
                  className={styles.svg}
                  role="img"
                  aria-label={`${MEDIDA_LABEL[medida]} por reunião. Os mesmos números estão na vista de tabela.`}
                >
                  {/* A grade é HAIRLINE E SÓLIDA, um passo fora da superfície.
                      Tracejado lê como "projeção" ou "limite" quando é só
                      grade, e grade grossa disputa atenção com o dado. */}
                  {t.ticksY.map((tk) => (
                    <line
                      key={tk.v}
                      x1={t.plot.x0}
                      x2={t.plot.x1}
                      y1={tk.y}
                      y2={tk.y}
                      className={styles.grade}
                    />
                  ))}
                  {t.ticksY.map((tk) => (
                    <text
                      key={tk.v}
                      x={t.plot.x0 - 10}
                      y={tk.y + 4}
                      className={styles.tickY}
                    >
                      {tk.v}
                    </text>
                  ))}
                  {t.ticksX.map((tk, i) => (
                    <text
                      key={i}
                      x={tk.x}
                      y={CAIXA.alt - 11}
                      className={styles.tickX}
                      textAnchor={
                        i === 0 ? "start" : i === t.ticksX.length - 1 ? "end" : "middle"
                      }
                    >
                      {tk.rotulo}
                    </text>
                  ))}

                  {/* A área é uma LAVAGEM de 10%, nunca um bloco saturado. */}
                  <path
                    d={t.area}
                    className={`${styles.area} ${buscando ? styles.areaOff : ""}`}
                  />
                  <path
                    d={t.linha}
                    className={`${styles.linha} ${buscando ? styles.linhaOff : ""}`}
                  />

                  {alvo && (
                    <line
                      x1={alvo.x}
                      x2={alvo.x}
                      y1={t.plot.y0}
                      y2={t.plot.y1}
                      className={styles.mira}
                    />
                  )}

                  {t.pts.map((p, i) => {
                    const aceso = !buscando || reuniaoCasa(p.ponto);
                    return (
                      <circle
                        key={p.ponto.ataId}
                        cx={p.x}
                        cy={p.y}
                        r={i === focado ? 6.5 : aceso ? 4.5 : 3.5}
                        className={`${styles.ponto} ${aceso ? styles.aceso : styles.apagadoPonto}`}
                        /* O TECLADO CHEGA AOS MESMOS PONTOS QUE O MOUSE, e vê o
                           mesmo balão. Gráfico que só responde ao mouse exclui
                           quem não usa um — e o `onFocus` é o que faz a
                           promessa valer. */
                        tabIndex={0}
                        role="button"
                        aria-label={`${p.ponto.titulo}, ${p.ponto.data}: ${valorDa(p.ponto, medida)}. Abrir a reunião.`}
                        onFocus={() => setFocado(i)}
                        onBlur={() => setFocado(null)}
                        onClick={() => setAberta(p.ponto.ataId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setAberta(p.ponto.ataId);
                          }
                        }}
                      />
                    );
                  })}

                  {/* RÓTULO DIRETO, e um só: o do último ponto. Número em cima
                      de cada ponto é ruído que ninguém lê — o eixo e o balão
                      carregam o resto. */}
                  {t.pts.length > 0 && focado === null && (
                    <text
                      x={t.pts[t.pts.length - 1].x - 12}
                      y={t.pts[t.pts.length - 1].y - 15}
                      className={styles.rotuloFim}
                      textAnchor="end"
                    >
                      {valorDa(t.pts[t.pts.length - 1].ponto, medida)}
                    </text>
                  )}

                  <rect
                    x={t.plot.x0}
                    y={t.plot.y0}
                    width={t.plot.x1 - t.plot.x0}
                    height={t.plot.y1 - t.plot.y0}
                    className={styles.captador}
                    onMouseMove={mirar}
                    onMouseLeave={() => setFocado(null)}
                    onClick={() => alvo && setAberta(alvo.ponto.ataId)}
                  />
                </svg>

                {alvo && (
                  <Balao
                    ponto={alvo.ponto}
                    medida={medida}
                    buscando={buscando}
                    esquerda={(alvo.x / CAIXA.larg) * 100}
                  />
                )}
              </div>
            </div>
            <p className={styles.rodapeQuadro}>
              Passe o mouse para ver o que entrou na pauta; clique num ponto para
              abrir a reunião inteira.
              {semData > 0 && (
                <>
                  {" "}
                  <b>
                    {semData} ata{semData > 1 ? "s" : ""} sem data
                  </b>{" "}
                  ficou de fora do eixo.
                </>
              )}
            </p>
          </div>
        )}
      </Modal>

      {ataAberta && (
        <Detalhe
          ata={ataAberta}
          tituloDoCard={tituloDoCard}
          classeDoItem={classeDoItem}
          nomeDe={nomeDe}
          usersMap={usersMap}
          onFechar={() => setAberta(null)}
          onAbrirAta={onAbrirAta}
        />
      )}
    </>
  );
}

/**
 * O balão do mouse — breve de propósito.
 *
 * UMA REUNIÃO PODE TER MUITOS ITENS, e um balão que os liste todos vira uma
 * coluna de texto que cobre o gráfico e que rola (e balão que rola foge do
 * mouse). Cinco linhas e "e mais N" respondem a pergunta que se faz passando o
 * mouse — "do que foi esta?" —, e o clique responde o resto.
 *
 * COM BUSCA ATIVA, O QUE CASOU VEM PRIMEIRO. Sem isso, a pessoa que procurou
 * "estoque" veria cinco itens quaisquer de uma reunião que ela sabe que fala de
 * estoque, e teria de abrir para achar o que já tinha encontrado.
 */
function Balao({
  ponto,
  medida,
  buscando,
  esquerda,
}: {
  ponto: ReuniaoNaLinha;
  medida: Medida;
  buscando: boolean;
  /** Posição em % da largura do gráfico — o SVG escala, o balão acompanha. */
  esquerda: number;
}) {
  const ordenados = buscando
    ? [...ponto.itens].sort((a, b) => Number(b.casa) - Number(a.casa))
    : ponto.itens;
  const mostra = ordenados.slice(0, NO_BALAO);
  const resto = ordenados.length - mostra.length;

  // Sempre no lado OPOSTO ao do ponto — ver `.balao` na folha. Centrado, ele
  // tapava exatamente o pico que o mouse estava apontando.
  const lado = esquerda > 50 ? styles.balaoDir : styles.balaoEsq;

  return (
    <div
      className={`${styles.balao} ${lado}`}
      style={{ left: `${esquerda}%` }}
      role="status"
    >
      <div className={styles.balaoTopo}>
        <strong>{ponto.titulo}</strong>
        <span>{ponto.data ? fmtDayMonth(ponto.data) : "sem data"}</span>
      </div>
      <div className={styles.balaoNums}>
        <span className={medida === "pauta" ? styles.numOn : ""}>
          <b>{ponto.pauta}</b> na pauta
        </span>
        <span className={medida === "decisoes" ? styles.numOn : ""}>
          <b>{ponto.decisoes}</b> decidid{ponto.decisoes === 1 ? "o" : "os"}
        </span>
        <span className={medida === "tarefas" ? styles.numOn : ""}>
          <b>{ponto.tarefas}</b> tarefa{ponto.tarefas === 1 ? "" : "s"}
        </span>
      </div>
      {mostra.length === 0 ? (
        <p className={styles.balaoVazio}>
          Esta reunião não deixou nenhum item registrado na ata.
        </p>
      ) : (
        <ul className={styles.balaoLista}>
          {mostra.map((i) => (
            <li key={i.id} className={i.casa ? styles.itemCasa : ""}>
              <Icon name={i.ehDemanda ? "kanban" : "chat"} size={11} />
              <span>{i.titulo}</span>
            </li>
          ))}
        </ul>
      )}
      {resto > 0 && (
        <p className={styles.balaoMais}>
          e mais {resto} ite{resto === 1 ? "m" : "ns"} — clique para ver tudo
        </p>
      )}
    </div>
  );
}

/**
 * A vista de tabela — a gêmea do gráfico, e não um extra.
 *
 * Um balão é a única leitura possível para quem tem mouse e enxerga cor; a
 * regra de acessibilidade que este projeto segue é que todo valor do gráfico
 * esteja alcançável sem ele. Aqui está: mesma ordem, mesmos números, navegável
 * por teclado, e cada linha abre a mesma reunião que o ponto abre.
 */
function Tabela({
  pontos,
  medida,
  buscando,
  onAbrir,
}: {
  pontos: ReuniaoNaLinha[];
  medida: Medida;
  buscando: boolean;
  onAbrir: (ataId: string) => void;
}) {
  return (
    <div className={styles.tabelaCaixa}>
      <table className={styles.tabela}>
        <thead>
          <tr>
            <th>Reunião</th>
            <th>Data</th>
            <th className={medida === "pauta" ? styles.colOn : ""}>Pauta</th>
            <th className={medida === "decisoes" ? styles.colOn : ""}>Decisões</th>
            <th className={medida === "tarefas" ? styles.colOn : ""}>Tarefas</th>
            <th>Feitas</th>
            {buscando && <th>Casam</th>}
          </tr>
        </thead>
        <tbody>
          {pontos.map((p) => (
            <tr key={p.ataId} className={buscando && !reuniaoCasa(p) ? styles.linhaApagada : ""}>
              <td>
                <button className={styles.abrirLinha} onClick={() => onAbrir(p.ataId)}>
                  {p.titulo}
                </button>
              </td>
              <td>{p.data ? fmtDayMonth(p.data) : "—"}</td>
              <td className={styles.num}>{p.pauta}</td>
              <td className={styles.num}>{p.decisoes}</td>
              <td className={styles.num}>{p.tarefas}</td>
              <td className={styles.num}>{p.tarefasFeitas}</td>
              {buscando && (
                <td className={styles.num}>
                  {p.casam || (p.tituloCasa ? "título" : "—")}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A reunião inteira — o que o balão não cabia.
 *
 * É um segundo `<Modal>` por cima do primeiro, e não uma troca de painel: o
 * `Modal` deste projeto já foi escrito para empilhar (o `stopPropagation` no
 * Escape existe exatamente para o de baixo não fechar junto). Trocar o conteúdo
 * do modal grande faria o gráfico perder o estado — a busca digitada, a medida
 * escolhida, o ponto focado — a cada reunião aberta.
 *
 * MOSTRA O QUE A ATA GRAVOU, e diz quando não gravou nada. Um campo vazio
 * desenhado como "—" e um campo que ninguém preencheu são a mesma coisa aqui, e
 * é a verdade: a reunião não registrou.
 */
function Detalhe({
  ata,
  tituloDoCard,
  classeDoItem,
  nomeDe,
  usersMap,
  onFechar,
  onAbrirAta,
}: {
  ata: Ata;
  tituloDoCard: (cardId: string) => string;
  classeDoItem: (item: ItemDeAta) => string;
  nomeDe: (email: string) => string;
  usersMap: Record<string, UserProfile>;
  onFechar: () => void;
  onAbrirAta: (ataId: string) => void;
}) {
  const tarefas = ata.itens.reduce((s, i) => s + i.tarefas.length, 0);

  return (
    <Modal
      onClose={onFechar}
      ariaLabel={`Reunião ${ata.titulo}`}
      overlayClassName={styles.overlay}
      className={styles.modalDetalhe}
    >
      <div className={styles.cabeca}>
        <div>
          <div className={styles.chips}>
            <span className={styles.chip}>
              <Icon name="ata" size={12} /> Reunião
            </span>
            <span className={styles.chip}>{ata.setor}</span>
          </div>
          <h2 className={styles.titulo}>{ata.titulo}</h2>
          <p className={styles.sub}>
            {ata.data ? fmtDayMonth(ata.data) : "sem data"}
            {(ata.horaInicio || ata.horaFim) &&
              ` · ${ata.horaInicio || "—"} às ${ata.horaFim || "—"}`}
            {ata.local && ` · ${ata.local}`}
          </p>
        </div>
        <button className={styles.fechar} onClick={onFechar} aria-label="Fechar a reunião">
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className={styles.fichas}>
        <div className={styles.ficha}>
          <span>{ata.itens.length}</span> na pauta
        </div>
        <div className={styles.ficha}>
          <span>{ata.itens.filter((i) => i.decisao).length}</span> com decisão
        </div>
        <div className={styles.ficha}>
          <span>{tarefas}</span> tarefa{tarefas === 1 ? "" : "s"}
        </div>
        <button className={styles.irParaAta} onClick={() => onAbrirAta(ata.id)}>
          <Icon name="edit" size={13} /> Abrir esta ata
        </button>
      </div>

      <div className={styles.gente}>
        {ata.facilitador && (
          <div className={styles.genteBloco}>
            <span className={styles.genteRot}>Facilitador</span>
            <span className={styles.pessoa}>
              <Avatar
                pessoa={
                  usersMap[ata.facilitador] ?? {
                    name: nomeDe(ata.facilitador),
                    email: ata.facilitador,
                  }
                }
                size={20}
              />
              {nomeDe(ata.facilitador)}
            </span>
          </div>
        )}
        {ata.participantes.length > 0 && (
          <div className={styles.genteBloco}>
            <span className={styles.genteRot}>
              Participantes ({ata.participantes.length})
            </span>
            <div className={styles.pessoas}>
              {ata.participantes.map((e) => (
                <span key={e} className={styles.pessoa}>
                  <Avatar
                    pessoa={usersMap[e] ?? { name: nomeDe(e), email: e }}
                    size={20}
                  />
                  {nomeDe(e)}
                </span>
              ))}
            </div>
          </div>
        )}
        {/* CITADO NÃO É PARTICIPANTE, e a separação vem da ata: participante é
            gente do app, com e-mail; citado é um nome ouvido na gravação, que
            pode nem ter conta. */}
        {ata.citados.length > 0 && (
          <div className={styles.genteBloco}>
            <span className={styles.genteRot}>Citados na gravação</span>
            <div className={styles.pessoas}>
              {ata.citados.map((c) => (
                <span key={c} className={styles.citado}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {ata.itens.length === 0 ? (
        <EmptyState
          icon="ata"
          title="Esta reunião não deixou registro na ata"
          description="A pauta desta reunião não tem nenhum item gravado — nem decisão, nem tarefa, nem assunto acrescentado."
        />
      ) : (
        <ol className={styles.pauta}>
          {ata.itens.map((i, n) => {
            const doQuadro = i.cardId ? tituloDoCard(i.cardId) : "";
            const classe = classeDoItem(i);
            return (
              <li key={i.id} className={styles.itemPauta}>
                <div className={styles.itemTopo}>
                  <span className={styles.itemNum}>
                    {String(n + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <span className={styles.itemTipo}>
                      {i.cardId
                        ? doQuadro
                          ? "Demanda"
                          : "Demanda fora do quadro"
                        : "Assunto"}
                      {classe && ` · ${classe}`}
                    </span>
                    <h3>{doQuadro || i.assunto || "Sem título na ata"}</h3>
                    {i.contexto && <p className={styles.itemCtx}>{i.contexto}</p>}
                  </div>
                  {i.proximaReuniao && (
                    <span className={styles.selo}>
                      <Icon name="calendar" size={11} /> Próxima
                    </span>
                  )}
                </div>

                <div className={styles.itemCampos}>
                  <div>
                    <span className={styles.campoRot}>Decisão registrada</span>
                    <p className={i.decisao ? "" : styles.vazio}>
                      {i.decisao || "Nada foi decidido nesta reunião."}
                    </p>
                  </div>
                  <div>
                    <span className={styles.campoRot}>Objetivo na próxima</span>
                    <p className={i.objetivo ? "" : styles.vazio}>
                      {i.objetivo || "Nenhum objetivo escrito."}
                    </p>
                  </div>
                </div>

                {i.tarefas.length > 0 && (
                  <table className={styles.tarefas}>
                    <thead>
                      <tr>
                        <th>Tarefa</th>
                        <th>Responsável</th>
                        <th>Prazo</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {i.tarefas.map((t) => (
                        <tr key={t.id}>
                          <td>{t.texto || "—"}</td>
                          <td>{t.responsavel ? nomeDe(t.responsavel) : "—"}</td>
                          <td>{t.prazo ? fmtDayMonth(t.prazo) : "—"}</td>
                          <td>
                            <span className={`${styles.statusTarefa} ${styles[t.status]}`}>
                              {STATUS_TAREFA_LABEL[t.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
