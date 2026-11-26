"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Icon } from "@/components/icons";
import { OverlayPortal } from "@/components/overlay-portal";
import { SeloSetor } from "@/components/selo-setor";
import { useEnvios, type LinhaDoEnvio } from "@/lib/audio/envio-context";
import {
  avisoDoPainel,
  percentual,
  textoDaPilula,
  tituloDoPainel,
} from "@/lib/audio/envio-core";
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
 *  - linear, lento (1,6 s), 6 px de curso, um elemento só na tela;
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
      {/* O parado também muda a FORMA, e não só a cor do arco: em tela
          estreita a pílula é só este anel, e a troca de laranja para cinza
          era o único sinal de que o envio esperava (WCAG 1.4.1). */}
      {parado && (
        <g className={styles.anelPausa}>
          <rect x={6.5} y={6.25} width={1.75} height={5.5} rx={0.5} />
          <rect x={9.75} y={6.25} width={1.75} height={5.5} rx={0.5} />
        </g>
      )}
    </svg>
  );
}

function Linha({ linha }: { linha: LinhaDoEnvio }) {
  const { tentarDeNovo, baixarCopia, descartar, dispensar } = useEnvios();
  const { estado, titulo, setor, recordingId } = linha;
  const [ocupado, setOcupado] = useState<"tentar" | "baixar" | "descartar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const pct = percentual(estado.fracao);
  // Os botões repetem em cada linha ("Tentar de novo, Baixar cópia,
  // Descartar"), e na lista de botões do leitor de tela viravam três nomes
  // iguais por reunião. O nome da reunião vai como descrição, e não no rótulo,
  // para o rótulo continuar sendo o que está escrito no botão.
  const idDoNome = useId();

  // `aria-disabled`, e não `disabled`, nos botões em ação: o `disabled` tira
  // o foco do botão que a pessoa acabou de apertar e o joga no `<body>` — e o
  // "Baixar cópia" pelo teclado perdia o lugar enquanto a cópia era montada.
  // Por isso a guarda mora aqui.
  async function agir(qual: "tentar" | "baixar" | "descartar") {
    if (ocupado !== null) return;
    // Na falha, descartar apaga a ÚNICA cópia (a gravação do microfone só
    // existe aqui): a mesma pergunta da faixa de recuperação. No recusado não
    // há o que perder — o original nunca saiu do computador da pessoa.
    if (
      qual === "descartar" &&
      estado.fase === "falha" &&
      !window.confirm(
        `Descartar "${titulo}"? O áudio guardado neste computador será apagado e não poderá ser recuperado.`,
      )
    ) {
      return;
    }
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
        <span id={idDoNome} className={styles.nome} title={titulo}>
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
          {/* Descartar mora aqui também, e não só na faixa: quando o "Tentar
              de novo" não resolve (arquivo que sumiu do disco, cópia local
              inconsistente), sem ele a linha ficava na tela e prendendo o
              site até alguém recarregar a página. */}
          {estado.temCopiaLocal ? (
            <div className={styles.botoesLinha}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void agir("tentar")}
                aria-disabled={ocupado !== null}
                aria-describedby={idDoNome}
              >
                {ocupado === "tentar" ? "Retomando…" : "Tentar de novo"}
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void agir("baixar")}
                aria-disabled={ocupado !== null}
                aria-describedby={idDoNome}
              >
                {ocupado === "baixar" ? "Preparando a cópia…" : "Baixar cópia"}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPerigo}`}
                onClick={(e) => {
                  engolirCliqueDuplo(e);
                  void agir("descartar");
                }}
                aria-disabled={ocupado !== null}
                aria-describedby={idDoNome}
              >
                {ocupado === "descartar" ? "Descartando…" : "Descartar"}
              </button>
            </div>
          ) : (
            // Sem registro não há o que descartar nem retomar: o botão só
            // tira a linha da tela, por isso não pergunta nada.
            <div className={styles.botoesLinha}>
              <button
                type="button"
                className={styles.btn}
                onClick={(e) => {
                  engolirCliqueDuplo(e);
                  dispensar(recordingId);
                }}
                aria-describedby={idDoNome}
              >
                Dispensar
              </button>
            </div>
          )}
        </>
      )}

      {estado.fase === "recusado" && (
        <>
          <p className={styles.erro}>
            {estado.erro ?? "Este arquivo não foi aceito."}
          </p>
          <div className={styles.botoesLinha}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPerigo}`}
              onClick={(e) => {
                engolirCliqueDuplo(e);
                void agir("descartar");
              }}
              aria-disabled={ocupado !== null}
              aria-describedby={idDoNome}
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
 * O ponteiro está no fundo da camada `.lugar`, e não num filho dela nem na
 * barra de rolagem dela (`clientWidth`/`clientHeight` não contam a barra)?
 */
function noFundoDaCamada(e: React.MouseEvent<HTMLDivElement>): boolean {
  if (e.target !== e.currentTarget) return false;
  const camada = e.currentTarget;
  const caixa = camada.getBoundingClientRect();
  return (
    e.clientX < caixa.left + camada.clientLeft + camada.clientWidth &&
    e.clientY < caixa.top + camada.clientTop + camada.clientHeight
  );
}

/**
 * Engole, por meio segundo, o 2º clique de um clique duplo que começou num
 * botão que tira o painel da página. Na saída animada quem segura esse clique
 * é o véu (ver a folha), mas com movimento reduzido o "Fechar", o "Descartar" e
 * o "Dispensar" do último envio tiram o painel e o véu no mesmo quadro — e o
 * 2º clique apertava o que estivesse atrás, na página. Só o clique com
 * `detail > 1`: um clique novo, de verdade, passa. Pelo teclado (`detail` 0)
 * não há 2º clique a engolir.
 */
function engolirCliqueDuplo(e: React.MouseEvent) {
  if (e.detail < 1) return;
  const tipos = ["mousedown", "mouseup", "click", "dblclick"] as const;
  const engolir = (ev: MouseEvent) => {
    if (ev.detail > 1) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };
  for (const tipo of tipos) window.addEventListener(tipo, engolir, true);
  window.setTimeout(() => {
    for (const tipo of tipos) window.removeEventListener(tipo, engolir, true);
  }, 500);
}

/** Teclas que só modificam outra: sozinhas, não são navegação. */
const MODIFICADORAS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock"]);

/**
 * Põe o foco no `<main>` do shell sem deixá-lo focável para sempre: com
 * `tabindex` fixo, cada clique no fundo da página passaria a mover o foco para
 * ele. O atributo só existe enquanto o foco está lá.
 */
function focarConteudo() {
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), {
      once: true,
    });
  }
  main.focus({ preventScroll: true });
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
  const {
    linhas,
    resumo,
    minimizado,
    estourando,
    fechando,
    todosConcluidos,
    minimizar,
    fecharAgora,
    segurar,
  } = useEnvios();
  const ref = useRef<HTMLDivElement>(null);
  const abertoEm = useRef(0);
  const entrada = useRef<"teclado" | "ponteiro" | null>(null);
  const apertouNoFundo = useRef(false);
  const soltouNoFundo = useRef(false);
  const aberto = !!resumo && !minimizado && !estourando && !fechando;

  // A última entrada da pessoa, para `aoFocar` saber se o foco é de teclado.
  // O `:focus-visible` sozinho erra no foco posto por CÓDIGO depois de
  // entradas misturadas: Escape no teclado e depois o clique de mouse na
  // pílula davam `:focus-visible` no "Minimizar", e o painel deixava de
  // fechar sozinho para quem tinha acabado de usar o mouse.
  useEffect(() => {
    // Modificadora sozinha e atalho não são navegação pelo painel: o Ctrl do
    // Ctrl+Tab que troca de aba marcava "teclado", e a volta da janela — que
    // devolve o foco ao botão — passava a segurar a confirmação de quem usa
    // o mouse. O Shift+Tab continua contando, pelo Tab.
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || MODIFICADORAS.has(e.key)) return;
      entrada.current = "teclado";
    };
    const ponteiro = () => {
      entrada.current = "ponteiro";
    };
    window.addEventListener("keydown", tecla, true);
    window.addEventListener("pointerdown", ponteiro, true);
    return () => {
      window.removeEventListener("keydown", tecla, true);
      window.removeEventListener("pointerdown", ponteiro, true);
    };
  }, []);

  // Foco: entra no painel ao abrir e, ao sair, vai para onde faz sentido —
  // nunca para o `<body>`, que é onde o leitor de tela e o Tab recomeçam do
  // topo da página. Nesta ordem:
  //  1. de onde ele veio, se ainda aceita o foco (a pílula, quando foi ela que
  //     restaurou e o painel minimizou de novo);
  //  2. a pílula, quando o painel minimizou: de onde ele veio quase sempre
  //     sumiu (o "Registrar" do modal que fechou), e minimizar é um gesto da
  //     pessoa DENTRO do painel — mandá-la para a pílula não interrompe nada;
  //  3. o `<main>`, quando o painel fechou de vez.
  // O 1 CONFERE se o foco pegou: a pílula de onde o painel veio fica `inert`
  // quando ele fecha de vez (estouro, descarte), o `focus()` falha calado, e
  // voltar logo depois deixava o foco no `<body>`.
  // Se a pessoa já levou o foco para outro lugar, ele fica lá.
  useEffect(() => {
    if (!aberto) return;
    abertoEm.current = Date.now();
    const antes = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      const alvo = el.querySelector<HTMLElement>("[data-foco-inicial]");
      alvo?.focus();
      // Rede para o `focus()` que falha calado (um botão ainda `hidden` no
      // quadro em que o diálogo aparece — ver o movimento reduzido na folha):
      // o próprio diálogo segura o foco, e é nele que moram o Escape e a
      // trava do Tab. Sem isso o foco ficava no `<body>` com o painel aberto.
      if (alvo && document.activeElement !== alvo) el.focus();
    }
    return () => {
      const agora = document.activeElement;
      const perdido =
        !agora || agora === document.body || !!el?.contains(agora);
      if (!perdido) return;
      if (antes && antes !== document.body && antes.isConnected) {
        antes.focus();
        if (document.activeElement === antes) return;
      }
      const pilula = document.querySelector<HTMLElement>(
        "[data-pilula-do-envio]:not([inert])",
      );
      if (pilula) pilula.focus();
      else focarConteudo();
    };
  }, [aberto]);

  // O botão que some com o próprio clique ("Tentar de novo" vira barra de
  // novo; "Descartar" e "Dispensar" levam a linha inteira) deixava o foco no
  // `<body>` com o painel aberto — e o Escape e a trava do Tab moram no
  // `onKeyDown` daqui, então paravam de funcionar. Elemento REMOVIDO não
  // dispara `blur`, por isso a conferência é depois de cada render, e não no
  // `onBlur`: com o painel aberto, foco no `<body>` é sempre foco perdido
  // (o véu cobre o resto da tela), e ele volta para o próprio diálogo.
  useEffect(() => {
    if (aberto && document.activeElement === document.body) ref.current?.focus();
  });

  if (!resumo) return null;

  const saindo = estourando || fechando;
  const estado = saindo
    ? minimizado
      ? "fora"
      : "saindo"
    : minimizado
      ? "minimizado"
      : "aberto";
  // Concluído não tem o que esperar: sair por qualquer caminho é fechar.
  const sair = todosConcluidos ? fecharAgora : minimizar;
  const alerta = resumo.fase === "falha" || resumo.fase === "recusado";

  // O clique fora é o clique no fundo da camada `.lugar` (que cobre a tela e
  // rola com o painel aberto), e não num filho dela. A barra de rolagem é da
  // camada: arrastá-la é rolar, e não "clicar fora" — sem a conta da caixa
  // (`noFundoDaCamada`), quem rolava pela barra minimizava o painel.
  //
  // A camada cobre a tela a partir do quadro em que o painel abre: o 2º
  // clique de um clique duplo na pílula caía nela e minimizava de novo o
  // painel que o 1º tinha acabado de abrir — quem clica duas vezes por hábito
  // não conseguia abri-lo. Pelo mesmo motivo, o véu segura o clique nos
  // 120 ms em que some depois do "Minimizar" (ver a folha), e esse clique
  // não faz nada.
  //
  // O botão tem de DESCER e SUBIR no fundo. Quando ele desce num elemento e
  // sobe em outro, o navegador manda o `click` ao ancestral comum — e esse
  // ancestral é a camada: selecionar o texto do aviso e soltar fora, ou
  // apertar "Descartar" e desistir arrastando para fora, minimizavam o painel.
  function aoClicarFora(e: React.MouseEvent<HTMLDivElement>) {
    const veio = apertouNoFundo.current && soltouNoFundo.current;
    apertouNoFundo.current = false;
    soltouNoFundo.current = false;
    if (!veio || !noFundoDaCamada(e)) return;
    if (!aberto || e.detail > 1 || Date.now() - abertoEm.current < 350) return;
    sair();
  }

  // O fundo da camada não é focável, e o clique nele levava o foco para o
  // `<body>` — o clique IGNORADO (o 2º do clique duplo, o de logo depois de
  // abrir) deixava o painel aberto sem Escape e sem trava do Tab até o
  // próximo render. Segurar o padrão do `mousedown` mantém o foco onde estava.
  function aoApertarFora(e: React.MouseEvent<HTMLDivElement>) {
    apertouNoFundo.current = noFundoDaCamada(e);
    if (apertouNoFundo.current) e.preventDefault();
  }

  function aoSoltarFora(e: React.MouseEvent<HTMLDivElement>) {
    soltouNoFundo.current = noFundoDaCamada(e);
  }

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
    // Com o foco no próprio diálogo (ver o efeito acima), o Shift+Tab saía
    // dele para a página de trás: o diálogo não está na lista de focáveis.
    if (document.activeElement === ref.current) {
      e.preventDefault();
      (e.shiftKey ? ultimo : primeiro).focus();
    } else if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  // Só o foco que chega pelo TECLADO segura a confirmação (ver o relógio no
  // provedor). Antes da primeira entrada, quem decide é o `:focus-visible`.
  function aoFocar(e: React.FocusEvent) {
    const teclado =
      entrada.current === null
        ? (e.target as HTMLElement).matches(":focus-visible")
        : entrada.current === "teclado";
    if (teclado) segurar("foco", true);
  }

  function aoDesfocar(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      segurar("foco", false);
    }
  }

  return (
    <OverlayPortal>
      {/* O véu só pega clique quando o painel já está saindo (o 2º clique de
          um clique duplo em "Minimizar" ou "Fechar"), e esse clique não faz
          nada — nem tirar o foco da pílula, para onde o painel o mandou. */}
      <div
        className={styles.veu}
        data-estado={estado}
        onMouseDown={(e) => e.preventDefault()}
      />
      <div
        className={styles.lugar}
        data-estado={estado}
        onMouseDown={aoApertarFora}
        onMouseUp={aoSoltarFora}
        onClick={aoClicarFora}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal={aberto}
          aria-labelledby="painel-do-envio-titulo"
          aria-describedby="painel-do-envio-aviso"
          className={styles.dialogo}
          data-estado={estado}
          inert={!aberto}
          // Focável por código e pelo clique no texto, fora do Tab: é o que
          // mantém o foco DENTRO do diálogo quando a pessoa clica num pedaço
          // sem botão — sem isso, o clique levava o foco para o `<body>`.
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onFocus={aoFocar}
          onBlur={aoDesfocar}
          onPointerEnter={() => segurar("ponteiro", true)}
          onPointerLeave={() => segurar("ponteiro", false)}
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
            {/* `role="status"` fala quando a frase MUDA; o `aria-describedby`
                do diálogo é o que a lê ao abrir — região viva que nasce já
                com texto não é anunciada com confiança, e esta é a frase que
                é a razão de o painel existir. */}
            <p id="painel-do-envio-aviso" className={styles.aviso} role="status">
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
                onClick={(e) => {
                  engolirCliqueDuplo(e);
                  sair();
                }}
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
 * É REGIÃO DE STATUS, e não diálogo: não prende o foco nem o puxa sozinha
 * (quem o entrega a ela é o painel, ao minimizar — ver o efeito de foco). Fica
 * montada enquanto houver envio, oculta com o painel aberto, para que
 * minimizar e restaurar sejam transições que se revertem — e não uma pílula
 * nascendo e morrendo a cada clique.
 */
export function PilulaDoEnvio() {
  const { resumo, minimizado, estourando, fechando, todosConcluidos, restaurar } =
    useEnvios();
  const botao = useRef<HTMLButtonElement | null>(null);
  // A pílula que SAI DA PÁGINA com o foco dentro levava o foco ao `<body>`:
  // com movimento reduzido não existe "saindo" (o relógio finaliza direto, e
  // ela desmonta sem passar pelo efeito abaixo). A limpeza do ref roda ANTES
  // de o React tirar o botão da página, com o foco ainda nele; um efeito já
  // rodaria depois, com o foco perdido e sem como saber de onde ele caiu.
  const prenderBotao = useCallback((no: HTMLButtonElement | null) => {
    botao.current = no;
    if (!no) return;
    return () => {
      if (no.contains(document.activeElement)) focarConteudo();
      botao.current = null;
    };
  }, []);
  const estado = !resumo || !minimizado
    ? "oculta"
    : estourando || fechando
      ? "saindo"
      : "visivel";

  // A pílula com o foco que começa a sair (estouro, descarte) vira `inert`, e
  // o navegador joga o foco no `<body>` — onde o leitor de tela e o Tab
  // recomeçam do topo. Antes disso, ele vai para o conteúdo. É efeito de
  // LAYOUT de propósito: roda antes de o navegador aplicar o `inert` ao foco.
  useLayoutEffect(() => {
    if (estado !== "saindo") return;
    if (botao.current?.contains(document.activeElement)) focarConteudo();
  }, [estado]);

  if (!resumo) return null;

  const { curto, nome, anuncio } = textoDaPilula(resumo);
  const alerta = resumo.fase === "falha" || resumo.fase === "recusado";

  return (
    <div className={styles.pilulaLugar} data-estado={estado}>
      <button
        ref={prenderBotao}
        type="button"
        className={styles.pilula}
        data-fase={resumo.fase}
        data-pilula-do-envio
        onClick={restaurar}
        inert={estado !== "visivel"}
        aria-label={`${nome}. Abrir o painel do envio`}
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
      <span className={styles.srOnly} role="status">
        {estado === "visivel" ? anuncio : ""}
      </span>
    </div>
  );
}
