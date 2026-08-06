"use client";

import { useEffect, useRef } from "react";
import styles from "./waveform.module.css";

/** Converte #rgb / #rrggbb em rgba(); devolve a cor original se não for hex. */
function withAlpha(color: string, a: number) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Camadas empilhadas. A de trás tem barras mais largas, é maior, mais lenta e
 * bem apagada — vira um eco atrás da principal e dá profundidade ao borrão.
 */
const LAYERS = [
  { step: 1.8, scale: 1.3, alpha: 0.3, speed: 0.62, phase: 2.4 },
  { step: 1.0, scale: 1.0, alpha: 1.0, speed: 1.0, phase: 0 },
];

type Props = {
  /** "hero" na tela de login; "ambient" é bem mais apagada, pra usar dentro do app */
  variant?: "hero" | "ambient";
  /** liga o swell de amplitude — usado na animação de entrada */
  energized?: boolean;
};

/**
 * Waveform de gravação em tela cheia, desfocada, para usar como fundo.
 * Barras em cápsula espelhadas na linha de base, com amplitude orgânica.
 * As cores saem dos tokens do tema (--brand / --accent-2).
 */
export function Waveform({ variant = "hero", energized = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energizedRef = useRef(false);

  useEffect(() => {
    energizedRef.current = energized;
  }, [energized]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let raf = 0;
    let start = 0;
    let boost = 0;
    let grad: CanvasGradient | null = null;

    const buildGradient = () => {
      const cs = getComputedStyle(document.documentElement);
      const brand = cs.getPropertyValue("--brand").trim() || "#ff6a2b";
      const soft = cs.getPropertyValue("--accent-2").trim() || "#ffb089";
      // núcleo claro no meio e laranja saturado nos flancos, como brasa
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, withAlpha(soft, 0.42));
      g.addColorStop(0.16, withAlpha(brand, 0.82));
      g.addColorStop(0.34, brand);
      g.addColorStop(0.5, soft);
      g.addColorStop(0.66, brand);
      g.addColorStop(0.84, withAlpha(brand, 0.82));
      g.addColorStop(1, withAlpha(soft, 0.42));
      grad = g;
    };

    const resize = () => {
      const r = cv.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      // sem DPR: a camada é desfocada, resolução extra só custaria pixel à toa
      cv.width = W;
      cv.height = H;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      buildGradient();
    };

    const draw = (ts: number) => {
      if (!start) start = ts;
      const p = ((ts - start) / 1000) * 1.15;

      // swell da animação de entrada, suavizado
      boost += ((energizedRef.current ? 1 : 0) - boost) * 0.06;

      ctx.clearRect(0, 0, W, H);
      const cy = H / 2;
      const rounded = typeof ctx.roundRect === "function";

      // tela estreita é tela curta: onda menor pra não engolir o conteúdo
      const ampScale = W < 560 ? 0.26 : W < 900 ? 0.38 : 0.5;
      const baseMaxH = H * ampScale * (1 + boost * 0.7);

      for (const L of LAYERS) {
        const step = Math.max(11, (W / 55) * L.step);
        const barW = step * 0.5;
        const n = Math.max(10, Math.floor((W - barW) / step) + 1);
        const x0 = (W - ((n - 1) * step + barW)) / 2;
        const maxH = baseMaxH * L.scale;
        const q = p * L.speed + L.phase;

        ctx.globalAlpha = L.alpha;
        ctx.fillStyle = grad ?? "#ff6a2b";
        for (let i = 0; i < n; i++) {
          const u = n === 1 ? 0.5 : i / (n - 1);
          // graves lentos + um médio: nada de frequência alta, que vira serrilha
          const slow =
            Math.sin(u * 4.3 + q * 1.05) * 0.55 +
            Math.sin(u * 7.9 - q * 0.72) * 0.45;
          const mid =
            Math.sin(u * 17.3 + q * 1.9) * 0.5 +
            Math.sin(u * 26.9 - q * 2.4) * 0.5;
          // respiração geral, como alguém falando
          const pulse = 0.7 + 0.3 * Math.sin(q * 1.5 - u * 3.1);
          // sino: cheio no meio, some suavemente nas pontas
          const bell = Math.pow(Math.sin(Math.PI * u), 0.4);
          const amp =
            Math.max(0.12, 0.42 + 0.3 * slow + 0.16 * mid) * pulse * bell;
          const h = Math.max(1.5, amp * maxH);

          ctx.beginPath();
          if (rounded) {
            ctx.roundRect(x0 + i * step, cy - h, barW, h * 2, barW / 2);
          } else {
            ctx.rect(x0 + i * step, cy - h, barW, h * 2);
          }
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // apaga as pontas: a onda passa a parecer luz saindo da linha de base
      const fade = ctx.createLinearGradient(0, 0, 0, H);
      fade.addColorStop(0, "rgba(0, 0, 0, 0.92)");
      fade.addColorStop(0.28, "rgba(0, 0, 0, 0.36)");
      fade.addColorStop(0.5, "rgba(0, 0, 0, 0)");
      fade.addColorStop(0.72, "rgba(0, 0, 0, 0.36)");
      fade.addColorStop(1, "rgba(0, 0, 0, 0.92)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, W, H);

      // varredura de luz — só onde já existem barras
      const sweep = (((p * 0.22) % 1.5) - 0.25) * W;
      const sg = ctx.createLinearGradient(sweep - 220, 0, sweep + 220, 0);
      sg.addColorStop(0, "rgba(255, 255, 255, 0)");
      sg.addColorStop(0.5, "rgba(255, 255, 255, 0.2)");
      sg.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";

      // com movimento reduzido desenha um quadro e para
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    });
    ro.observe(cv);

    // troca de tema/acento → recalcula o gradiente
    const mo = new MutationObserver(() => {
      buildGradient();
      if (reduce) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`${styles.wave} ${variant === "ambient" ? styles.ambient : ""}`}
      />
      {variant === "hero" && <div className={styles.scrim} aria-hidden="true" />}
    </>
  );
}
