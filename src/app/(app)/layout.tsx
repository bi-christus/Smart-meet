"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABEL, pickColor, type MeuCadastro } from "@/lib/users";
import { useTheme } from "@/lib/theme";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { PerfilModal } from "@/components/perfil-modal";
import { RecoveryBanner } from "@/components/recovery-banner";
import { RecordingProvider } from "@/lib/audio/recording-context";
import { MiniPlayer } from "@/components/mini-player";
import { Waveform } from "@/components/waveform";
import styles from "./app-shell.module.css";

const NAV = [
  { id: "inicio", label: "Início", href: "/" },
  { id: "reunioes", label: "Reuniões", href: "/reunioes" },
  { id: "relatorios", label: "Relatórios IA", href: "/relatorios" },
  { id: "kanban", label: "Kanban", href: "/kanban" },
  { id: "recorrencias", label: "Recorrências", href: "/recorrencias" },
  { id: "dashboard", label: "Dashboard", href: "/dashboard" },
  { id: "cronograma", label: "Cronograma", href: "/cronograma" },
  { id: "links", label: "Links", href: "/links" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, authorized, logout } = useAuth();
  const { theme, accent, setTheme, setAccent } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [perfilAberto, setPerfilAberto] = useState(false);
  /**
   * O que a pessoa acabou de mudar no próprio perfil, campo a campo.
   *
   * O perfil é lido UMA vez, no login (`auth-context`), e não tem assinatura em
   * tempo real. Sem este estado, quem trocasse a própria foto ou o próprio nome
   * continuaria vendo os antigos na topbar até sair e entrar de novo — o app
   * pareceria ter ignorado o clique em Salvar.
   *
   * É `Partial<MeuCadastro>`, e não um estado por campo: só entra aqui a chave
   * que de fato foi gravada — o modal manda de volta exatamente o objeto que
   * foi ao banco. Assim o merge abaixo nunca sobrescreve com `undefined` o que
   * ninguém tocou, que é o modo de esta otimização virar apagamento.
   */
  const [meuLocal, setMeuLocal] = useState<Partial<MeuCadastro>>({});

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className={styles.loader}>Carregando…</div>;
  }

  if (!authorized || !profile) {
    return (
      <AccessPending
        email={user.email}
        name={user.displayName}
        photo={user.photoURL}
        onLogout={logout}
      />
    );
  }

  const nav = [...NAV];
  if (profile.role === "admin") {
    nav.push({ id: "admin", label: "Admin", href: "/admin" });
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const eu = { ...profile, ...meuLocal };

  return (
    <RecordingProvider ownerEmail={profile.email}>
      <div className={styles.shell}>
      {/* uma instância só para o app inteiro — é fixa e atravessa as abas */}
      <Waveform variant="ambient" />
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-uh-white.png" alt="Smart Meeting" />
          <span className={styles.wm}>
            <b>Smart Meeting</b>
            <span>Rede Christus</span>
          </span>
        </Link>

        <nav className={styles.nav}>
          {nav.map((n) => (
            <Link
              key={n.id}
              href={n.href}
              className={`${styles.navBtn} ${isActive(n.href) ? styles.on : ""}`}
            >
              <Icon name={n.id} size={16} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.user}>
          <button
            className={styles.userBtn}
            onClick={() => setMenuOpen((o) => !o)}
            // Abaixo de 680px o `.uMeta` some e o avatar fica sozinho: sem este
            // rótulo, o botão que abre o menu da conta não tem nome nenhum para
            // quem usa leitor de tela justo no celular.
            aria-label={`Conta de ${eu.name} — abrir menu`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {/* alt vazio: o nome já está escrito ao lado, e no celular quem
                identifica o botão é o aria-label acima. */}
            <Avatar pessoa={eu} size={30} fotoDoGoogle={user.photoURL} alt="" />
            <span className={styles.uMeta}>
              <span className={styles.uName}>{eu.name?.split(" ")[0]}</span>
              <span className={styles.uRole}>{ROLE_LABEL[profile.role]}</span>
            </span>
          </button>

          {menuOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 50 }}
                onClick={() => setMenuOpen(false)}
              />
              <div className={styles.pop}>
                <div className={styles.popHead}>
                  <div className={styles.popName}>{eu.name}</div>
                  <div className={styles.popEmail}>{profile.email}</div>
                  <span className={styles.popRole}>
                    {ROLE_LABEL[profile.role]}
                  </span>
                </div>

                {/* Fica junto do nome e do e-mail, e não lá embaixo com Tema e
                    Cor: quem procura o próprio perfil procura na sua
                    identidade, não nas preferências de aparência do app. */}
                <button
                  className={styles.popItem}
                  onClick={() => {
                    setMenuOpen(false);
                    setPerfilAberto(true);
                  }}
                >
                  <Icon name="users" size={15} /> Meu perfil
                </button>
                <div className={styles.popSep} />

                <div className={styles.popLbl}>Tema</div>
                <div className={styles.themeRow}>
                  <button
                    className={`${styles.themeBtn} ${theme === "dark" ? styles.themeOn : ""}`}
                    onClick={() => setTheme("dark")}
                  >
                    Escuro
                  </button>
                  <button
                    className={`${styles.themeBtn} ${theme === "light" ? styles.themeOn : ""}`}
                    onClick={() => setTheme("light")}
                  >
                    Claro
                  </button>
                </div>

                <div className={styles.popLbl}>Cor de destaque</div>
                <div className={styles.swatchRow}>
                  <button
                    className={`${styles.swatch} ${styles.swPreto} ${accent === "preto" ? styles.swOn : ""}`}
                    onClick={() => setAccent("preto")}
                    title="Laranja"
                    aria-label="Laranja"
                  />
                  <button
                    className={`${styles.swatch} ${styles.swAzul} ${accent === "azul" ? styles.swOn : ""}`}
                    onClick={() => setAccent("azul")}
                    title="Azul"
                    aria-label="Azul"
                  />
                  <button
                    className={`${styles.swatch} ${styles.swCafe} ${accent === "cafe" ? styles.swOn : ""}`}
                    onClick={() => setAccent("cafe")}
                    title="Café"
                    aria-label="Café"
                  />
                </div>

                <div className={styles.popSep} />
                <button className={styles.popItem} onClick={() => logout()}>
                  <Icon name="logout" size={15} /> Sair
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <main className={styles.content}>
        {/* Fica no shell — assim a bomba de envio segue viva mesmo quando o
            usuário sai da tela de reuniões, e uma gravação interrompida
            aparece em qualquer página. */}
        <RecoveryBanner />
        {/* key no pathname: remonta a cada troca de aba e reexecuta a animação */}
        <div key={pathname} className={styles.tabEnter}>
          {children}
        </div>
      </main>
      </div>
      <MiniPlayer />
      {perfilAberto && (
        <PerfilModal
          modo="eu"
          pessoa={eu}
          fotoDoGoogle={user.photoURL}
          onMudou={(m) => setMeuLocal((atual) => ({ ...atual, ...m }))}
          onClose={() => setPerfilAberto(false)}
        />
      )}
    </RecordingProvider>
  );
}

function AccessPending({
  email,
  name,
  photo,
  onLogout,
}: {
  email: string | null;
  name: string | null;
  photo: string | null;
  onLogout: () => void;
}) {
  // Esta pessoa não tem documento em `/users` — é justamente o que a tela diz.
  // A cor sai do mesmo `pickColor` que o perfil usaria, para o círculo não
  // mudar de cor no dia em que o acesso for liberado.
  const pendente = {
    name: name ?? "",
    email: email ?? "",
    color: pickColor(email ?? name ?? ""),
    photo: null,
  };
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          textAlign: "center",
          background: "var(--card)",
          border: "1px solid rgba(255,255,255,.07)",
          borderRadius: 20,
          padding: "40px 34px",
          backdropFilter: "blur(14px)",
        }}
      >
        {/* Aqui o avatar está SOZINHO: o nome só aparece depois, dentro de um
            parágrafo. Por isso ele leva o nome no `alt`, e não vazio. */}
        <Avatar
          pessoa={pendente}
          size={60}
          fotoDoGoogle={photo}
          alt={name || email || "Sua conta"}
          className={styles.pendingAvatar}
        />
        <h1
          style={{
            fontFamily: "var(--font-serif), serif",
            fontWeight: 600,
            fontSize: 26,
            margin: "16px 0 10px",
          }}
        >
          Acesso pendente
        </h1>
        <p
          style={{
            color: "var(--tx-2)",
            fontSize: 14.5,
            lineHeight: 1.6,
            marginBottom: 20,
          }}
        >
          A conta <strong style={{ color: "var(--tx)" }}>{email}</strong> ainda
          não tem acesso liberado ao Smart Meeting. Peça ao administrador para
          incluir o seu e-mail.
        </p>
        <button
          onClick={onLogout}
          style={{
            height: 42,
            padding: "0 22px",
            border: "1px solid var(--line)",
            borderRadius: 11,
            background: "transparent",
            color: "var(--tx)",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sair
        </button>
      </div>
    </div>
  );
}
