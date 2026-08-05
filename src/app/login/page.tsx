"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import styles from "./login.module.css";

const PROMOS: [string, string][] = [
  [
    "Da reunião à ata em minutos.",
    "Grave, transcreva e gere atas automáticas com inteligência artificial.",
  ],
  [
    "Toda pauta vira ação.",
    "Pautas viram atividades, prazos e responsáveis num quadro Kanban.",
  ],
  [
    "Sua operação numa só rede.",
    "Reuniões, projetos e relatórios conectados de ponta a ponta.",
  ],
];

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [promo, setPromo] = useState(0);
  const [fade, setFade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Já autenticado → vai para o app.
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  // Carrossel de mensagens.
  useEffect(() => {
    const id = setInterval(() => {
      setFade(true);
      setTimeout(() => {
        setPromo((p) => (p + 1) % PROMOS.length);
        setFade(false);
      }, 480);
    }, 4800);
    return () => clearInterval(id);
  }, []);

  async function handleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      // O redirect é tratado pelo onAuthStateChanged + useEffect acima.
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err?.code ?? "";
      console.error("Falha no login com Google:", code, err?.message, e);
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        // Usuário fechou o popup — ignorar silenciosamente.
      } else if (code === "auth/unauthorized-domain") {
        setError(
          "Domínio não autorizado no Firebase. Adicione este endereço em Authentication → Settings → Authorized domains.",
        );
      } else if (
        code === "auth/operation-not-allowed" ||
        code === "auth/configuration-not-found"
      ) {
        setError(
          "Login com Google ainda não ativado no Firebase. Ative em Authentication → Sign-in method → Google e salve.",
        );
      } else if (code === "auth/popup-blocked") {
        setError(
          "O navegador bloqueou a janela de login. Permita popups para este site e tente novamente.",
        );
      } else {
        setError(
          "Não foi possível entrar. [" + (code || err?.message || "erro") + "]",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading || user) {
    return <div className={styles.loader}>Carregando…</div>;
  }

  const [ph, ps] = PROMOS[promo];

  return (
    <div className={styles.wrap}>
      <div className={styles.stage}>
        <div className={styles.inner}>
          <div className={styles.hero}>
            <div className={styles.waveBox}>
              <Waveform />
            </div>

            <div
              className={styles.promoText}
              style={{ opacity: fade ? 0 : 1 }}
            >
              <h2>{ph}</h2>
              <p>{ps}</p>
            </div>
            <div className={styles.dots}>
              {PROMOS.map((_, i) => (
                <i key={i} className={i === promo ? styles.on : undefined} />
              ))}
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.brand}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-uh-white.png" alt="Smart Meeting" />
            </div>
            <h1 className={styles.title}>Smart Meeting</h1>
            <p className={styles.sub}>Entre com sua conta para continuar</p>

            <button
              className={styles.gbtn}
              onClick={handleSignIn}
              disabled={busy}
            >
              <GoogleIcon />
              {busy ? "Entrando…" : "Entrar com Google"}
            </button>

            {error && <div className={styles.error}>{error}</div>}

            <p className={styles.note}>
              O acesso é liberado pelo administrador. Se não conseguir entrar,
              fale com o setor de B.I.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className={styles.gicon} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

/** Converte #rgb / #rrggbb em rgba(); devolve a cor original se não for hex. */
function withAlpha(color: string, a: number) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Waveform de gravação: barras em cápsula espelhadas na linha de base,
 * com amplitude orgânica e um brilho que varre da esquerda para a direita.
 * As cores saem dos tokens do tema (--brand / --accent-2).
 */
function Waveform() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    let grad: CanvasGradient | null = null;

    const buildGradient = () => {
      const cs = getComputedStyle(document.documentElement);
      const brand = cs.getPropertyValue("--brand").trim() || "#ff6a2b";
      const soft = cs.getPropertyValue("--accent-2").trim() || "#ffb089";
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, withAlpha(soft, 0.55));
      g.addColorStop(0.24, soft);
      g.addColorStop(0.5, brand);
      g.addColorStop(0.76, soft);
      g.addColorStop(1, withAlpha(soft, 0.55));
      grad = g;
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildGradient();
    };

    const draw = (ts: number) => {
      if (!start) start = ts;
      const p = ((ts - start) / 1000) * 1.15;

      ctx.clearRect(0, 0, W, H);

      const cy = H / 2;
      const step = W < 460 ? 7 : 9;
      const barW = step * 0.44;
      const n = Math.max(12, Math.floor((W - barW) / step) + 1);
      const x0 = (W - ((n - 1) * step + barW)) / 2;
      const maxH = Math.max(4, H / 2 - 6);
      const rounded = typeof ctx.roundRect === "function";

      ctx.fillStyle = grad ?? "#ff6a2b";
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0.5 : i / (n - 1);
        // graves lentos + detalhe agudo = textura de voz
        const slow =
          Math.sin(u * 5.1 + p * 1.15) * 0.55 + Math.sin(u * 9.7 - p * 0.74) * 0.45;
        const fast =
          Math.sin(u * 39.7 + p * 2.9) * 0.5 + Math.sin(u * 71.3 - p * 3.6) * 0.5;
        // respiração geral, como alguém falando
        const pulse = 0.62 + 0.38 * Math.sin(p * 1.5 - u * 3.1);
        // sino: cheio no meio, some suavemente nas pontas
        const bell = Math.pow(Math.sin(Math.PI * u), 0.4);
        const amp =
          Math.max(0.05, 0.3 + 0.27 * slow + 0.18 * fast) * pulse * bell;
        const h = Math.max(1.5, amp * maxH);

        ctx.beginPath();
        if (rounded) {
          ctx.roundRect(x0 + i * step, cy - h, barW, h * 2, barW / 2);
        } else {
          ctx.rect(x0 + i * step, cy - h, barW, h * 2);
        }
        ctx.fill();
      }

      // varredura de luz — só onde já existem barras
      const sweep = (((p * 0.22) % 1.5) - 0.25) * W;
      const sg = ctx.createLinearGradient(sweep - 130, 0, sweep + 130, 0);
      sg.addColorStop(0, "rgba(255, 255, 255, 0)");
      sg.addColorStop(0.5, "rgba(255, 255, 255, 0.24)");
      sg.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) raf = requestAnimationFrame(draw);
    });
    ro.observe(cv);

    // troca de tema/acento → recalcula o gradiente
    const mo = new MutationObserver(() => {
      buildGradient();
      if (reduce) raf = requestAnimationFrame(draw);
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

  return <canvas ref={canvasRef} className={styles.wave} aria-hidden="true" />;
}
