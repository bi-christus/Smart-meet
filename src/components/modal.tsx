"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { OverlayPortal } from "./overlay-portal";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo acessível: role=dialog + aria-modal, fecha no Escape e no clique fora,
 * prende o Tab (focus trap) e devolve o foco ao gatilho ao fechar.
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

  useEffect(() => {
    prevFocus.current = document.activeElement;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      el.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    return () => {
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
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
      <div className={overlayClassName} onClick={onClose}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className={className}
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
