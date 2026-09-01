import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif, IBM_Plex_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexSerif = IBM_Plex_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
      className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            /* A lista de acentos aparece aqui E em `theme.tsx`, e é de
               propósito: este script roda ANTES de qualquer JavaScript do app
               ser baixado — é isso que evita o piscar. Importar o módulo aqui
               desfaria a razão de ele existir. A conferência precisa estar nos
               dois lados porque um `sm_accent` desconhecido (versão antiga,
               dedo no console) vira um `data-accent` que folha nenhuma casa, e
               o app abre sem cor de marca sem nada dizer por quê. */
            __html:
              "(function(){try{var r=document.documentElement;var a=localStorage.getItem('sm_accent');r.dataset.theme=localStorage.getItem('sm_theme')||'dark';r.dataset.accent=['preto','azul','cafe','entreaulas'].indexOf(a)<0?'preto':a;}catch(e){}})();",
          }}
        />
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
