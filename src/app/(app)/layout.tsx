"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABEL, pickColor, type MeuCadastro } from "@/lib/users";
import { usePermissoes } from "@/lib/permissoes";
import { abaDaRota, abasVisiveis, podeVerAba } from "@/lib/permissoes-core";
import { divisaoDaAba, divisoesVisiveis } from "@/lib/navegacao-core";
import { useTheme } from "@/lib/theme";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { PerfilModal } from "@/components/perfil-modal";
import { Notificacoes } from "@/components/notificacoes";
import { RecoveryBanner } from "@/components/recovery-banner";
import { RecordingProvider } from "@/lib/audio/recording-context";
import { MiniPlayer } from "@/components/mini-player";
import { Waveform } from "@/components/waveform";
import styles from "./app-shell.module.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, authorized, logout } = useAuth();
  /**
   * As permissões entram no MESMO portão de espera do login, e não num
   * segundo portão depois dele.
   *
   * As duas leituras começam juntas, na montagem, e a do login é sempre a mais
   * demorada (é um `onAuthStateChanged` mais um `getDoc` de perfil, contra a
   * leitura de um documento só). Esperar as duas juntas custa, na prática, os
   * milissegundos em que a segunda ainda não voltou — e compra o que importa:
   * a barra lateral nunca desenha cinco divisões para recolher três meio segundo
   * depois. Isso seria a mesma mentira que os esqueletos deste projeto existem
   * para tirar da tela, agora na navegação.
   *
   * Falha de leitura NÃO segura o portão: `usePermissoes` responde "tudo
   * liberado" e sai de `carregando`. O porquê está escrito lá.
   */
  const { permissoes, carregando: permsCarregando } = usePermissoes();
  const { theme, accent, fundoAnimado, setTheme, setAccent, setFundoAnimado } =
    useTheme();
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

  if (loading || permsCarregando || !user) {
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

  const divisoes = divisoesVisiveis(abasVisiveis(profile, permissoes));

  /**
   * O GUARDA DE ROTA — a metade que a barra lateral não faz.
   *
   * Tirar o botão esconde o caminho, não fecha a porta: a URL continua sendo
   * digitável, o histórico do navegador continua guardando a visita de ontem, e
   * um link no meio de outra tela continua clicável. Sem esta pergunta, uma aba
   * "restrita" seria uma aba difícil de achar — que é outra coisa.
   *
   * Rota que o catálogo não conhece não é negada, é ignorada (`abaDaRota`
   * devolve `undefined`). Negar por desconhecimento faria toda página nova
   * nascer inacessível até alguém lembrar de cadastrá-la aqui.
   */
  const abaAtual = abaDaRota(pathname);
  const rotaNegada =
    !!abaAtual && !podeVerAba(abaAtual.id, profile, permissoes);

  const eu = { ...profile, ...meuLocal };

  /**
   * A divisão aberta é a da aba da rota, e não a última clicada na lateral:
   * quem chega por um link colado em `/ata` precisa ver a divisão Reuniões
   * acesa e as pílulas dela no topo, sem ter passado pela lateral.
   */
  const idDivisao = abaAtual ? divisaoDaAba(abaAtual.id)?.id : undefined;
  const divisaoAtual = divisoes.find((d) => d.id === idDivisao);
  const pilulas =
    divisaoAtual && divisaoAtual.visiveis.length > 1
      ? divisaoAtual.visiveis
      : [];

  return (
    <RecordingProvider ownerEmail={profile.email}>
      <div className={styles.shell}>
      {/* uma instância só para o app inteiro — é fixa e atravessa as abas.
          Desligada no menu do perfil (#214), ela nem monta: o canvas deixa de
          ser redesenhado, e não só de aparecer. */}
      {fundoAnimado && <Waveform variant="ambient" />}
      <aside className={styles.side}>
        <Link href="/" className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-uh-white.png" alt="Smart Meeting" />
          <span className={styles.wm}>
            <b>Smart Meeting</b>
            <span>Rede Christus</span>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Divisões">
          <div className={styles.navLbl}>Menu</div>
          {divisoes.filter((d) => !d.rodape).map((d) => (
            <Link
              key={d.id}
              href={d.href}
              title={d.label}
              aria-current={d.id === idDivisao ? "page" : undefined}
              className={`${styles.navBtn} ${d.id === idDivisao ? styles.on : ""}`}
            >
              <Icon name={d.icone} size={18} />
              <span>{d.label}</span>
            </Link>
          ))}
        </nav>

        {/* No lugar dos "membros" da referência: o que mudou nas demandas desta
            pessoa e o que espera a validação dela (#237). */}
        <div className={styles.sideFill}>
          <Notificacoes pessoa={eu} />
        </div>

        {divisoes.filter((d) => d.rodape).map((d) => (
          <Link
            key={d.id}
            href={d.href}
            title={d.label}
            aria-current={d.id === idDivisao ? "page" : undefined}
            className={`${styles.navBtn} ${d.id === idDivisao ? styles.on : ""}`}
          >
            <Icon name={d.icone} size={18} />
            <span>{d.label}</span>
          </Link>
        ))}

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
            <Avatar pessoa={eu} size={32} fotoDoGoogle={user.photoURL} alt="" />
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
                  <button
                    className={`${styles.themeBtn} ${theme === "contraste" ? styles.themeOn : ""}`}
                    onClick={() => setTheme("contraste")}
                    title="Fundo preto, texto branco e bordas bem marcadas"
                  >
                    Alto contraste
                  </button>
                </div>

                {/* UM INTERRUPTOR, e não dois botões como o tema: são dois estados
                    de uma coisa só, ligada ou desligada, e `role="switch"` diz
                    isso a quem usa leitor de tela. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={fundoAnimado}
                  className={styles.popItem}
                  onClick={() => setFundoAnimado(!fundoAnimado)}
                >
                  <span
                    className={`${styles.chave} ${fundoAnimado ? styles.chaveOn : ""}`}
                    aria-hidden
                  />
                  Animação de fundo
                </button>

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
                  {/* Em degrade, e não numa cor só: este é o único acento que
                      redefine a paleta semântica inteira, e um quadrado
                      terracota mentiria sobre isso — pareceria mais um laranja
                      ao lado do laranja que já está na primeira posição. */}
                  <button
                    className={`${styles.swatch} ${styles.swEntre} ${accent === "entreaulas" ? styles.swOn : ""}`}
                    onClick={() => setAccent("entreaulas")}
                    title="Entre Aulas"
                    aria-label="Entre Aulas"
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
      </aside>

      <div className={styles.col}>
      {/* Só aparece quando a divisão tem mais de um módulo: o título de cada
          tela já está no `<h1>` dela, e repeti-lo aqui seria a mesma palavra
          duas vezes, uma em cima da outra. */}
      {pilulas.length > 0 && (
        <header className={styles.topbar}>
          <span className={styles.divNome}>{divisaoAtual?.label}</span>
          <nav className={styles.pills} aria-label={`Módulos de ${divisaoAtual?.label}`}>
            {pilulas.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                aria-current={a.id === abaAtual?.id ? "page" : undefined}
                className={`${styles.pill} ${a.id === abaAtual?.id ? styles.pillOn : ""}`}
              >
                <Icon name={a.id} size={15} />
                <span>{a.label}</span>
              </Link>
            ))}
          </nav>
        </header>
      )}

      <main className={styles.content}>
        {/* Fica no shell — assim a bomba de envio segue viva mesmo quando o
            usuário sai da tela de reuniões, e uma gravação interrompida
            aparece em qualquer página. */}
        <RecoveryBanner />
        {/* key no pathname: remonta a cada troca de aba e reexecuta a animação */}
        <div key={pathname} className={styles.tabEnter}>
          {abaAtual && rotaNegada ? (
            <SemAcesso aba={abaAtual.label} />
          ) : (
            children
          )}
        </div>
      </main>
      </div>
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

/**
 * A aba existe, a pessoa tem conta, e mesmo assim aquela porta não é dela.
 *
 * É um caso DIFERENTE de `AccessPending`, e por isso é outra tela: lá a conta
 * ainda não entrou no app e não há nada a fazer além de esperar o
 * administrador; aqui a pessoa está dentro, com a barra lateral e todas as outras
 * abas funcionando, e o que falta é o acesso a uma delas. Dizer "acesso
 * pendente" nos dois casos mandaria metade das pessoas pedir a coisa errada.
 *
 * O nome da aba entra na frase de propósito. Quem chega aqui quase sempre veio
 * de um link colado por outra pessoa, e "esta página" não dá o que pedir ao
 * administrador — "a aba Dashboard" dá.
 */
function SemAcesso({ aba }: { aba: string }) {
  return (
    <div className={styles.semAcesso}>
      <EmptyState
        icon="lock"
        title={`A aba ${aba} não está liberada para você`}
        description={
          <>
            O acesso a esta aba é definido por setor e por pessoa, na tela de
            Admin. Peça ao administrador para incluir você — ou o seu setor — na
            aba <strong>{aba}</strong>. As outras abas da barra lateral
            continuam disponíveis.
          </>
        }
      />
    </div>
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
