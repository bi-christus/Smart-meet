"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Waveform } from "@/components/waveform";
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

/** Tempo da animação de entrada antes de trocar de tela. */
const ENTER_MS = 880;

export default function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [promo, setPromo] = useState(0);
  const [fade, setFade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Distingue "acabou de entrar" de "já estava logado ao abrir a página". */
  const [signingIn, setSigningIn] = useState(false);

  /** Derivado, não estado: quem acabou de autenticar está saindo da tela. */
  const entering = signingIn && !loading && !!user;

  // Autenticado → vai para o app. Quem acabou de entrar vê a animação antes.
  useEffect(() => {
    if (loading || !user) return;
    const instant =
      !signingIn ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant) {
      router.replace("/");
      return;
    }
    const t = setTimeout(() => router.replace("/"), ENTER_MS);
    return () => clearTimeout(t);
  }, [loading, user, signingIn, router]);

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
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // Sucesso: segura o botão em "Entrando…" enquanto a animação roda.
      // O redirect é tratado pelo onAuthStateChanged + useEffect acima.
    } catch (e: unknown) {
      setSigningIn(false);
      setBusy(false);
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
    }
  }

  // Quem já chegou logado não vê a tela piscar; quem está entrando fica.
  if (loading || (user && !signingIn)) {
    return <div className={styles.loader}>Carregando…</div>;
  }

  const [ph, ps] = PROMOS[promo];

  return (
    <div className={styles.wrap}>
      <Waveform energized={entering} />
      <div className={`${styles.stage} ${entering ? styles.entering : ""}`}>
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
          <div className={styles.promoText} style={{ opacity: fade ? 0 : 1 }}>
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
