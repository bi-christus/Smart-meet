"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { OverlayPortal } from "./overlay-portal";
import styles from "./modal.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Precisa bater com os 120ms de `modal.module.css`. */
const SAIDA_MS = 120;

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
 */
export function Modal({
  onClose,
  ariaLabel,
  overlayClassName,
  className,
  width,
  children,
}: {
  onClose: () => void;
  ariaLabel: string;
  overlayClassName: string;
  className: string;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const [saindo, setSaindo] = useState(false);
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
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  function fechar() {
    if (jaFechando.current) return;
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
          className={`${className} ${saindo ? styles.saindo : ""}`}
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
