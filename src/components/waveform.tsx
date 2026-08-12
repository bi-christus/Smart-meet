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

/**
 * Quanto do tamanho de tela a gente de fato desenha.
 *
 * A camada é borrada e mora atrás de tudo: resolução ali é pixel jogado fora.
 * Desenhar 1/4 de cada lado é 1/16 do preenchimento — e, como o elemento também
 * MEDE 1/4 na tela (o CSS o amplia com `scale(4)`), o `filter: blur()` passa a
 * rodar sobre 1/16 da área, com raio 4x menor.
 *
 * Só o BITMAP encolhe. As coordenadas do desenho continuam sendo as da tela, e
 * nenhuma conta de barra, amplitude ou fase precisou mudar — quem faz a ponte é
 * o `setTransform` no `resize`.
 */
const ESCALA = 0.25;

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
    // dentro do app ela divide a CPU com o resto da tela; a 30fps ninguém nota,
    // porque é uma camada desfocada e lenta
    const minFrameMs = variant === "ambient" ? 33 : 0;
    let W = 0;
    let H = 0;
    let raf = 0;
    let start = 0;
    let boost = 0;
    let lastDraw = 0;
    let grad: CanvasGradient | null = null;
    let fade: CanvasGradient | null = null;

    /**
     * O apagador das pontas só depende da ALTURA — era criado de novo a cada
     * quadro sem nunca mudar. Agora nasce no resize e sobrevive aos quadros.
     */
    const buildFade = () => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(0, 0, 0, 0.92)");
      g.addColorStop(0.28, "rgba(0, 0, 0, 0.36)");
      g.addColorStop(0.5, "rgba(0, 0, 0, 0)");
      g.addColorStop(0.72, "rgba(0, 0, 0, 0.36)");
      g.addColorStop(1, "rgba(0, 0, 0, 0.92)");
      fade = g;
    };

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
      // `getBoundingClientRect` devolve o tamanho DEPOIS do `scale` do CSS —
      // ou seja, o tamanho que aparece na tela. É nele que o desenho pensa.
      const r = cv.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      // sem DPR, e ainda por cima em 1/4: a camada é desfocada, e resolução
      // aqui só custaria pixel à toa. Ver `ESCALA`.
      cv.width = Math.max(1, Math.round(W * ESCALA));
      cv.height = Math.max(1, Math.round(H * ESCALA));
      // Mexer em `cv.width` zera a matriz do contexto, então a escala é
      // reaplicada aqui — e é ela que deixa o resto do arquivo escrever em
      // coordenadas de tela como se o bitmap fosse do tamanho todo.
      ctx.setTransform(ESCALA, 0, 0, ESCALA, 0, 0);
      buildGradient();
      buildFade();
    };

    const draw = (ts: number) => {
      // agenda antes de sair pelo limitador, senão o loop morre
      if (!reduce) raf = requestAnimationFrame(draw);
      if (minFrameMs > 0 && lastDraw && ts - lastDraw < minFrameMs) return;
      lastDraw = ts;

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
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = fade ?? "rgba(0, 0, 0, 0)";
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
  }, [variant]);

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
