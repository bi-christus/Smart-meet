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
      const code = (e as { code?: string })?.code ?? "";
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        // Usuário fechou o popup — ignorar silenciosamente.
      } else if (code === "auth/unauthorized-domain") {
        setError(
          "Este domínio ainda não foi autorizado no Firebase (configuração pendente).",
        );
      } else if (code === "auth/operation-not-allowed") {
        setError(
          "O login com Google ainda não foi ativado no Firebase (configuração pendente).",
        );
      } else {
        setError("Não foi possível entrar. Tente novamente.");
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
      <CanvasBackground />
      <div className={styles.stage}>
        <div className={styles.inner}>
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

          <div className={styles.promo}>
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

/** Fundo animado com símbolos reativos ao mouse — portado do mockup. */
function CanvasBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const SYMS = ["@", "#", "!", ">", "~", "*", "%", "?", "+", "&", "/", "<", "=", ";"];
    let W = 0;
    let H = 0;
    let DPR = 1;
    let raf = 0;
    const mouse = { x: -9999, y: -9999, on: false };

    const resize = () => {
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = W * DPR;
      cv.height = H * DPR;
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };

    const focus = () => ({ x: W * 0.34, y: H * 0.5 });

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      s: number;
      ch: string;
      t: number;
      life: number;
      col: string;
      peak: number;
      react: number;
    };

    const mk = (): Particle => {
      const f = focus();
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.pow(Math.random(), 0.7) * Math.min(W, H) * 0.55;
      return {
        x: f.x + Math.cos(ang) * rad * 1.15,
        y: f.y + Math.sin(ang) * rad,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        s: 12 + Math.random() * 17,
        ch: SYMS[(Math.random() * SYMS.length) | 0],
        t: 0,
        life: 340 + Math.random() * 520,
        col: Math.random() < 0.72 ? "255,106,43" : "243,242,239",
        peak: 0.16 + Math.random() * 0.34,
        react: 0,
      };
    };

    resize();
    const N = Math.max(46, Math.min(96, Math.round(window.innerWidth / 18)));
    const parts: Particle[] = [];
    for (let i = 0; i < N; i++) {
      const p = mk();
      p.t = Math.random() * p.life;
      parts.push(p);
    }

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.on = true;
    };
    const onOut = () => {
      mouse.on = false;
    };
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseout", onOut);

    const mono =
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono") ||
      "monospace";

    const step = () => {
      ctx.clearRect(0, 0, W, H);
      const f = focus();
      const diag = Math.max(W, H) * 0.62;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.t++;
        p.x += p.vx;
        p.y += p.vy;
        if (mouse.on) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const R = 150;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1;
            const fr = (R - d) / R;
            p.vx += (dx / d) * fr * 0.7;
            p.vy += (dy / d) * fr * 0.7;
            p.react = Math.min(1, p.react + fr * 0.16);
          }
        }
        p.react *= 0.94;
        p.vx *= 0.986;
        p.vy *= 0.986;
        const k = p.t / p.life;
        const env =
          k < 0.16 ? k / 0.16 : k > 0.66 ? Math.max(0, (1 - k) / 0.34) : 1;
        const dd = Math.hypot(p.x - f.x, p.y - f.y);
        const distFade = Math.max(0, 1 - dd / diag);
        const a = Math.min(0.85, p.peak * env * (0.32 + 0.68 * distFade) + p.react * 0.5);
        if (a > 0.008) {
          ctx.font = p.s + "px " + mono;
          ctx.fillStyle = "rgba(" + p.col + "," + a.toFixed(3) + ")";
          ctx.fillText(p.ch, p.x, p.y);
        }
        if (p.t >= p.life || p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) {
          parts[i] = mk();
        }
      }
      raf = requestAnimationFrame(step);
    };
    step();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onOut);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.fx} />;
}
