"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { OverlayPortal } from "./overlay-portal";
import styles from "./modal.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Precisa bater com os 120ms de `modal.module.css`. */
const SAIDA_MS = 120;

/**
 * Quanto tempo a classe do tremor fica de pé.
 *
 * Mais longo que os 220ms do `@keyframes modalTreme`, e de propósito: sob
 * `prefers-reduced-motion` a recusa não é o balanço, é um anel estático que dura
 * exatamente o tempo desta classe (ver `modal.module.css`). 220ms de anel seriam
 * um pisca-pisca que metade das pessoas não pegaria; 700ms é tempo de o olho
 * chegar. No caso animado, a sobra não custa nada — a animação já acabou e a
 * classe apenas espera para sair.
 */
const TREMOR_MS = 700;

/**
 * Diálogo acessível: role=dialog + aria-modal, fecha no Escape e no clique fora,
 * prende o Tab (focus trap) e devolve o foco ao gatilho ao fechar.
 *
 * A SAÍDA É SEGURADA AQUI DENTRO. Quem chama renderiza `{aberto && <Modal/>}`,
 * então sem isto o diálogo é desmontado no mesmo quadro e some sem transição
 * nenhuma. O `saindo` aplica a classe de saída e o `onClose` de verdade só é
 * chamado quando ela termina.
 *
 * POR QUE `setTimeout` E NÃO `onAnimationEnd`: com `prefers-reduced-motion`, o
 * bloco global do `globals.css` corta a animação — e `kanban.module.css` chega a
 * zerá-la com `animation: none !important`. Sem animação não há `animationend`,
 * e o diálogo não fecharia NUNCA para quem pediu menos movimento. O projeto
 * também não tem nenhum outro listener desses (é o que permite o bloco global
 * ser agressivo); não é aqui que ele vai ganhar o primeiro.
 *
 * O VETO (`podeFechar`) vive aqui, e não em quem chama, porque o fechamento
 * também vive aqui: o Escape e o clique no overlay são tratados por este
 * componente, e quem chama só recebe o `onClose` depois de a decisão estar
 * tomada. Um diálogo que precisasse segurar a própria saída teria de
 * reimplementar as duas escutas — e reimplementar o Escape é como se perde o
 * `stopPropagation` que impede o diálogo de baixo de fechar junto.
 */
export function Modal({
  onClose,
  podeFechar,
  ariaLabel,
  overlayClassName,
  className,
  width,
  children,
}: {
  onClose: () => void;
  /**
   * Chamado ANTES de fechar. Devolver `false` cancela a saída e faz o diálogo
   * tremer — o retorno de "isto não fez o que você esperava".
   *
   * Quem veta é responsável por dizer POR QUE na tela: o tremor sozinho informa
   * que o clique foi recusado, nunca o motivo. Ele é o sinal periférico que faz
   * o olho voltar para o diálogo; a frase é o que responde depois que ele voltou.
   */
  podeFechar?: () => boolean;
  ariaLabel: string;
  overlayClassName: string;
  className: string;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const [saindo, setSaindo] = useState(false);
  const [tremendo, setTremendo] = useState(false);
  const tremor = useRef<ReturnType<typeof setTimeout> | null>(null);
  // O guarda é `ref` e não o estado: dois Escapes no mesmo quadro leriam o
  // mesmo `saindo` antigo e agendariam dois `onClose`.
  const jaFechando = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    prevFocus.current = document.activeElement;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      el.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (tremor.current) clearTimeout(tremor.current);
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  function fechar() {
    if (jaFechando.current) return;
    if (podeFechar && !podeFechar()) {
      /**
       * Reinicia o tremor a cada recusa, e é o `false` intermediário que faz
       * isso: sem ele, o segundo Escape não repetiria a animação (a classe já
       * estava lá, e CSS não reinicia keyframe de classe que não saiu). O
       * segundo clique recusado ficaria sem resposta nenhuma — que é como a
       * pessoa conclui que o diálogo travou.
       */
      if (tremor.current) clearTimeout(tremor.current);
      setTremendo(false);
      requestAnimationFrame(() => setTremendo(true));
      tremor.current = setTimeout(() => setTremendo(false), TREMOR_MS);
      return;
    }
    jaFechando.current = true;
    setSaindo(true);
    timer.current = setTimeout(onClose, SAIDA_MS);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      fechar();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const nodes = Array.from(
      ref.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <OverlayPortal>
      <div
        className={`${overlayClassName} ${saindo ? styles.overlaySaindo : ""}`}
        onClick={fechar}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className={`${className} ${saindo ? styles.saindo : ""} ${tremendo ? styles.tremendo : ""}`}
          style={width ? { width } : undefined}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}
