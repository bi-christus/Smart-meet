"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { OverlayPortal } from "@/components/overlay-portal";
import { SeloSetor } from "@/components/selo-setor";
import { useEnvios, type LinhaDoEnvio } from "@/lib/audio/envio-context";
import { percentual, type ResumoDosEnvios } from "@/lib/audio/envio-core";
import styles from "./painel-do-envio.module.css";

const FOCAVEL =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ângulo e distância de cada gota do estouro. IRREGULARES de propósito: com
 * cinco gotas a 72° certinhos, o primeiro protótipo lembrava um mostrador de
 * relógio, e não uma bolha.
 */
const GOTAS: [number, number][] = [
  [12, 19],
  [84, 14],
  [150, 18],
  [218, 12],
  [290, 16],
];

/**
 * A bolha do ✓ — e o estouro dela. Serve ao painel e à pílula; o tamanho muda
 * só por variáveis do CSS (`data-tamanho`), para os dois estourarem igual.
 */
function Bolha({
  tamanho,
  estourando,
}: {
  tamanho: "grande" | "pequena";
  estourando: boolean;
}) {
  return (
    <span
      className={styles.bolhaLugar}
      data-tamanho={tamanho}
      data-estourando={estourando}
      aria-hidden="true"
    >
      <span className={styles.bolha}>
        <Icon name="check" size={tamanho === "grande" ? 24 : 12} />
      </span>
      {GOTAS.map(([a, d]) => (
        <i
          key={a}
          className={styles.gota}
          style={{ "--a": `${a}deg`, "--d": `${d}px` } as CSSProperties}
        />
      ))}
    </span>
  );
}

/**
 * O único motivo animado do envio: três barrinhas de áudio subindo DENTRO da
 * nuvem, em laço.
 *
 * Dentro, e não embaixo: com as barrinhas sob a nuvem, o primeiro render era
 * o ícone de CHUVA — e parado (movimento reduzido, envio parado) ficava só a
 * chuva. Dentro do contorno, de alturas diferentes, é uma forma de onda na
 * nuvem: "o áudio está indo para lá", mesmo sem se mexer.
 *
 * É laço, e a casa evita laço (AGENTS.md §3) — este foi pedido pelo Ítalo
 * ("mostra em forma de animação o áudio sendo feito upload de forma leve").
 * O que o segura do lado certo da linha:
 *  - ele diz uma coisa verdadeira que a barra não consegue dizer: o envio anda
 *    em blocos de 8 MB, e dentro de um bloco a barra fica parada dezenas de
 *    segundos numa rede lenta. O laço é o "está trabalhando" desse intervalo;
 *  - por isso ele PARA quando o envio para (`data-parado`: sem rede, ou
 *    esperando nova tentativa) — um laço que continua com o envio parado
 *    mentiria, e é exatamente o indicador pulsando que a skill chama de slop;
 *  - linear, lento (1,6 s), 12 px de curso, um elemento só na tela;
 *  - some com movimento reduzido e quando o painel está minimizado.
 */
function Subindo({ parado }: { parado: boolean }) {
  return (
    <span className={styles.subindo} data-parado={parado} aria-hidden="true">
      <svg
        className={styles.nuvem}
        viewBox="0 0 40 30"
        width={40}
        height={30}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinejoin="round"
      >
        <path d="M11 27h19a8 8 0 0 0 .6-16A10.5 10.5 0 0 0 10.4 13.2 7 7 0 0 0 11 27z" />
      </svg>
      <span className={styles.ondas}>
        <i className={styles.onda} />
        <i className={styles.onda} />
        <i className={styles.onda} />
      </span>
    </span>
  );
}

function Anel({ fracao, parado }: { fracao: number | null; parado: boolean }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className={styles.anel}
      data-parado={parado}
      viewBox="0 0 18 18"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <circle className={styles.anelTrilho} cx={9} cy={9} r={r} />
      <circle
        className={styles.anelValor}
        cx={9}
        cy={9}
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - (fracao ?? 0))}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

function tituloDoPainel(resumo: ResumoDosEnvios): string {
  const varios = resumo.quantos > 1;
  switch (resumo.fase) {
    case "concluido":
      return varios ? "Áudios enviados!" : "Áudio enviado!";
    case "falha":
      return "O envio parou";
    case "recusado":
      return varios ? "Um arquivo não foi aceito" : "Este arquivo não foi aceito";
    case "preparando":
      return "Preparando o envio…";
    default:
      return resumo.subindo > 1
        ? `Enviando ${resumo.subindo} áudios`
        : "Enviando o áudio";
  }
}

/**
 * O que a pessoa pode fazer com o site — a frase que importa no painel.
 *
 * "Pode continuar usando o sistema" vem junto do "não feche" de propósito: o
 * painel minimiza, e quem lê só "não feche" fica olhando a barra parada.
 * Na conclusão, o ✓ fala do ÁUDIO, e a frase diz que as atas vêm depois: na
 * mesma tela, o verde é o chip "Processado" da esteira, e um ✓ sozinho seria
 * lido como "ata pronta".
 */
function avisoDoPainel(resumo: ResumoDosEnvios): string {
  switch (resumo.fase) {
    case "concluido":
      return "Pode fechar o site. A transcrição com quem falou e as atas chegam por e‑mail em até cerca de 1h30.";
    case "falha":
      return "O áudio continua salvo neste computador. Tente de novo ou baixe uma cópia — e não feche o site enquanto isso.";
    case "recusado":
      return "O servidor recusou o arquivo. Descarte-o e envie o áudio certo — o original continua no seu computador.";
    default:
      if (resumo.parado === "sem-rede") {
        return "Sem conexão. O envio continua sozinho quando a rede voltar — não feche o site.";
      }
      if (resumo.parado === "tentando") {
        return "A conexão oscilou e o envio está tentando de novo sozinho. Não feche o site.";
      }
      return "Não feche o site até terminar — pode continuar usando o sistema.";
  }
}

/** O texto curto da pílula, e a frase que ela anuncia ao leitor de tela. */
function textoDaPilula(resumo: ResumoDosEnvios): { curto: string; anuncio: string } {
  const pct = `${percentual(resumo.fracao)}%`;
  switch (resumo.fase) {
    case "concluido":
      return {
        curto: resumo.quantos > 1 ? "Áudios enviados" : "Áudio enviado",
        anuncio: "Áudio enviado. Pode fechar o site; as atas chegam por e-mail.",
      };
    case "falha":
      return { curto: "O envio parou", anuncio: "O envio parou. Abra o painel para tentar de novo." };
    case "recusado":
      return { curto: "Arquivo recusado", anuncio: "Um arquivo não foi aceito. Abra o painel para descartá-lo." };
    case "preparando":
      return { curto: "Preparando…", anuncio: "Preparando o envio do áudio." };
    default: {
      const antes =
        resumo.parado === "sem-rede"
          ? "Sem rede"
          : resumo.parado === "tentando"
            ? "Reconectando"
            : resumo.subindo > 1
              ? `${resumo.subindo} envios`
              : "Enviando";
      return {
        curto: `${antes} · ${pct}`,
        // O anúncio NÃO leva o percentual: ele muda a cada bloco de 8 MB, e uma
        // região viva que fala a cada bloco vira ruído para quem usa leitor.
        anuncio: resumo.parado ? "O envio está esperando a conexão." : "Enviando o áudio.",
      };
    }
  }
}

function Linha({ linha }: { linha: LinhaDoEnvio }) {
  const { tentarDeNovo, baixarCopia, descartar } = useEnvios();
  const { estado, titulo, setor, recordingId } = linha;
  const [ocupado, setOcupado] = useState<"tentar" | "baixar" | "descartar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pct = percentual(estado.fracao);

  async function agir(qual: "tentar" | "baixar" | "descartar") {
    setOcupado(qual);
    setErro(null);
    try {
      if (qual === "tentar") await tentarDeNovo(recordingId);
      else if (qual === "baixar") await baixarCopia(recordingId);
      else await descartar(recordingId);
    } catch (e) {
      console.error(e);
      setErro(
        qual === "baixar"
          ? "Não foi possível montar o arquivo local."
          : "Não deu certo agora. Tente de novo em instantes.",
      );
    } finally {
      setOcupado(null);
    }
  }

  return (
    <li className={styles.linha} data-fase={estado.fase}>
      <div className={styles.linhaTopo}>
        <span className={styles.nome} title={titulo}>
          {titulo}
        </span>
        <span className={styles.setor}>
          <SeloSetor setor={setor} tamanho={14} />
        </span>
      </div>

      {estado.fase !== "recusado" && (
        <div
          className={styles.trilho}
          role="progressbar"
          aria-label={`Envio de ${titulo}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={estado.fracao === null ? undefined : pct}
          aria-valuetext={
            estado.fase === "concluido"
              ? "Enviado"
              : estado.bytes
                ? `${pct}% — ${estado.bytes}`
                : "Preparando"
          }
        >
          {/* scaleX, e nunca width: a barra anda a cada bloco a vida inteira
              do envio, e animar largura recalcula o layout do painel a cada
              passo. */}
          <div
            className={styles.preenchimento}
            style={{ transform: `scaleX(${estado.fracao ?? 0})` }}
          />
        </div>
      )}

      <div className={styles.linhaBaixo}>
        {estado.fase === "concluido" ? (
          <span className={styles.enviado}>
            <Icon name="check" size={13} /> Enviado
          </span>
        ) : estado.fase === "recusado" ? null : (
          <span className={styles.pct}>
            {estado.fracao === null ? "—" : `${pct}%`}
          </span>
        )}
        {estado.fase !== "recusado" && (
          <span className={styles.bytes}>{estado.bytes}</span>
        )}
      </div>

      {estado.fase === "falha" && (
        <>
          {estado.erro && <p className={styles.erro}>{estado.erro}</p>}
          {estado.temCopiaLocal && (
            <div className={styles.botoesLinha}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void agir("tentar")}
                disabled={ocupado !== null}
              >
                {ocupado === "tentar" ? "Retomando…" : "Tentar de novo"}
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void agir("baixar")}
                disabled={ocupado !== null}
              >
                {ocupado === "baixar" ? "Montando…" : "Baixar cópia"}
              </button>
            </div>
          )}
        </>
      )}

      {estado.fase === "recusado" && (
        <>
          <p className={styles.erro}>
            {estado.erro ? `${estado.erro} ` : ""}Descarte e envie o áudio certo.
          </p>
          <div className={styles.botoesLinha}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPerigo}`}
              onClick={() => void agir("descartar")}
              disabled={ocupado !== null}
            >
              {ocupado === "descartar" ? "Descartando…" : "Descartar"}
            </button>
          </div>
        </>
      )}

      {erro && <p className={styles.erro}>{erro}</p>}
    </li>
  );
}

/**
 * O painel do envio (#250): abre depois de "Registrar", mostra o áudio subindo
 * e se fecha sozinho com a bolha quando o Drive confirma.
 *
 * Não usa o `<Modal>` da casa, e por três motivos: lá o Escape e o clique fora
 * FECHAM, e aqui MINIMIZAM (fechar não cancela nada, mas sumir sem deixar a
 * pílula esconderia o envio); a saída de lá é fixa em 120 ms, e o estouro
 * precisa de 300; e lá o diálogo desmonta ao sair, enquanto minimizar e
 * restaurar vão e voltam várias vezes — por isso o painel fica montado e anda
 * por TRANSIÇÃO de `data-estado`, que se reverte no meio sem pulo, e não por
 * keyframe.
 */
export function PainelDoEnvio() {
  const { linhas, resumo, minimizado, estourando, todosConcluidos, minimizar, fecharAgora } =
    useEnvios();
  const ref = useRef<HTMLDivElement>(null);
  const aberto = !!resumo && !minimizado && !estourando;

  // Foco: entra no painel ao abrir e volta para onde estava ao minimizar. Se
  // de onde ele veio sumiu (o botão "Registrar" do modal que fechou), fica no
  // documento — a pílula não puxa o foco, para não interromper quem digita.
  useEffect(() => {
    if (!aberto) return;
    const antes = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      el.querySelector<HTMLElement>("[data-foco-inicial]")?.focus();
    }
    return () => {
      if (antes && antes !== document.body && antes.isConnected) antes.focus();
    };
  }, [aberto]);

  if (!resumo) return null;

  const estado = estourando ? (minimizado ? "fora" : "saindo") : minimizado ? "minimizado" : "aberto";
  // Concluído não tem o que esperar: sair por qualquer caminho é fechar.
  const sair = todosConcluidos ? fecharAgora : minimizar;
  const alerta = resumo.fase === "falha" || resumo.fase === "recusado";

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      sair();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const nos = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCAVEL)).filter(
      (n) => n.offsetParent !== null,
    );
    if (nos.length === 0) return;
    const primeiro = nos[0];
    const ultimo = nos[nos.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  return (
    <OverlayPortal>
      <div className={styles.veu} data-estado={estado} onClick={sair} />
      <div className={styles.lugar} data-estado={estado}>
        <div
          ref={ref}
          role="dialog"
          aria-modal={aberto}
          aria-labelledby="painel-do-envio-titulo"
          className={styles.dialogo}
          data-estado={estado}
          inert={!aberto}
          onKeyDown={onKeyDown}
        >
          {/* O fundo é uma camada à parte, e não o próprio diálogo: no estouro
              ele e o texto saem em 120 ms enquanto a bolha, por cima, ainda
              estoura — se a bolha estivesse dentro do que esmaece, sumiria
              junto. */}
          <div className={styles.fundo} aria-hidden="true" />
          <div className={styles.palco}>
            {todosConcluidos ? (
              <Bolha tamanho="grande" estourando={estourando} />
            ) : alerta ? (
              <span className={styles.alerta} aria-hidden="true">
                <Icon name="warn" size={24} />
              </span>
            ) : (
              <Subindo parado={!!resumo.parado || !aberto} />
            )}
          </div>
          <div className={styles.conteudo}>
            <h2 id="painel-do-envio-titulo" className={styles.titulo}>
              {tituloDoPainel(resumo)}
            </h2>
            <p className={styles.aviso} role="status">
              {avisoDoPainel(resumo)}
            </p>
            <ul className={styles.linhas}>
              {linhas.map((l) => (
                <Linha key={l.recordingId} linha={l} />
              ))}
            </ul>
            <div className={styles.acoes}>
              <button
                type="button"
                className={styles.btnPrincipal}
                onClick={sair}
                data-foco-inicial
              >
                {todosConcluidos ? "Fechar" : "Minimizar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

/**
 * O painel minimizado: uma pílula no canto, dentro da doca do shell (junto do
 * mini player, que nunca a cobre).
 *
 * É REGIÃO DE STATUS, e não diálogo: não prende o foco nem o pede. Fica
 * montada enquanto houver envio, oculta com o painel aberto, para que
 * minimizar e restaurar sejam transições que se revertem — e não uma pílula
 * nascendo e morrendo a cada clique.
 */
export function PilulaDoEnvio() {
  const { resumo, minimizado, estourando, todosConcluidos, restaurar } = useEnvios();
  if (!resumo) return null;

  const estado = !minimizado ? "oculta" : estourando ? "saindo" : "visivel";
  const { curto, anuncio } = textoDaPilula(resumo);
  const alerta = resumo.fase === "falha" || resumo.fase === "recusado";

  return (
    <div className={styles.pilulaLugar} data-estado={estado}>
      <button
        type="button"
        className={styles.pilula}
        data-fase={resumo.fase}
        onClick={restaurar}
        inert={estado !== "visivel"}
        aria-label={`${curto}. Abrir o painel do envio`}
      >
        <span className={styles.pilulaFundo} aria-hidden="true" />
        <span className={styles.pilulaIcone}>
          {todosConcluidos ? (
            <Bolha tamanho="pequena" estourando={estourando} />
          ) : alerta ? (
            <Icon name="warn" size={16} />
          ) : (
            <Anel fracao={resumo.fracao} parado={!!resumo.parado} />
          )}
        </span>
        <span className={styles.pilulaTexto}>{curto}</span>
      </button>
      {/* Fora do botão: o nome do botão é lido quando ele recebe foco, e a
          região viva é lida quando MUDA — juntas, cada mudança seria lida duas
          vezes. Só fala com a pílula à vista. */}
      <span className={styles.somenteLeitor} role="status">
        {estado === "visivel" ? anuncio : ""}
      </span>
    </div>
  );
}
