import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/**
 * A fonte de display — títulos, rótulos e a lateral (16/10/2026, #237).
 *
 * A referência pedida foi a Inky Mono, da Mabütype. Ela é comercial e não está
 * no Google Fonts; a Space Mono é a livre mais próxima dela (o "I" de serifa
 * reta, a geometria larga, a cara de display), e é servida pelo `next/font`
 * daqui mesmo, sem arquivo de fonte no repositório.
 *
 * O TEXTO CORRIDO NÃO É MONO. Card, descrição, ata e formulário continuam em
 * IBM Plex Sans: mono em parágrafo é lento de ler, e este app é lido o dia
 * inteiro. A mono entra onde se lê de relance — e substitui também a Plex Mono
 * dos rótulos pequenos, para não haver duas monos disputando a mesma tela.
 *
 * Pré-carregada, ao contrário da Plex Mono que ela substitui: agora ela está
 * na lateral de TODA página, e sem pré-carga a marca pisca na troca de fonte a
 * cada entrada no app.
 */
const spaceMono = Space_Mono({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Smart Meeting",
  description:
    "Gestão de demandas com inteligência de reuniões — da reunião à ata, e da ata à ação.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${plexSans.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            /* A lista de acentos — e, desde o alto contraste (#214), a de
               temas — aparece aqui E em `theme.tsx`, e é de
               propósito: este script roda ANTES de qualquer JavaScript do app
               ser baixado — é isso que evita o piscar. Importar o módulo aqui
               desfaria a razão de ele existir. A conferência precisa estar nos
               dois lados porque um `sm_accent` desconhecido (versão antiga,
               dedo no console) vira um `data-accent` que folha nenhuma casa, e
               o app abre sem cor de marca sem nada dizer por quê. */
            __html:
              "(function(){try{var r=document.documentElement;var a=localStorage.getItem('sm_accent');var t=localStorage.getItem('sm_theme');r.dataset.theme=['dark','light','contraste'].indexOf(t)<0?'dark':t;r.dataset.accent=['preto','azul','cafe','entreaulas'].indexOf(a)<0?'preto':a;}catch(e){}})();",
          }}
        />
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
