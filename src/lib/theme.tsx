"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";
/**
 * Os acentos que o app sabe desenhar.
 *
 * `entreaulas` é o único que não é só uma família de marca: ele redefine também
 * `--ok`, `--warn`, `--danger`, `--info` e `--susp` a partir da paleta da
 * cantina (ver o bloco dele em `globals.css`). O tipo não distingue os dois
 * casos de propósito — para quem lê o valor, acento é acento; a diferença é de
 * quanto cada um redefine, e isso é assunto da folha.
 */
export type Accent = "preto" | "azul" | "cafe" | "entreaulas";

/** Os valores válidos, para conferir o que voltou do `localStorage`. */
const ACENTOS: readonly Accent[] = ["preto", "azul", "cafe", "entreaulas"];

/**
 * O acento guardado, ou o padrão.
 *
 * A conferência existe porque o `localStorage` é um campo aberto: um valor
 * antigo de uma versão que oferecia outra lista, ou um dedo no console, entrava
 * como `Accent` por causa do `as` e virava um `data-accent` que folha nenhuma
 * casa — o app abria sem cor de marca, e nada na tela dizia por quê.
 */
function acentoValido(bruto: string | null): Accent {
  return ACENTOS.includes(bruto as Accent) ? (bruto as Accent) : "preto";
}

type ThemeContextValue = {
  theme: Theme;
  accent: Accent;
  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function apply(theme: Theme, accent: Accent) {
  const r = document.documentElement;
  r.dataset.theme = theme;
  r.dataset.accent = accent;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [accent, setAccentState] = useState<Accent>("preto");

  // Sincroniza com o que o script anti-flash já aplicou / localStorage.
  useEffect(() => {
    try {
      const t = (localStorage.getItem("sm_theme") as Theme) || "dark";
      const a = acentoValido(localStorage.getItem("sm_accent"));
      setThemeState(t);
      setAccentState(a);
      apply(t, a);
    } catch {
      /* ignore */
    }
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    try {
      localStorage.setItem("sm_theme", t);
    } catch {
      /* ignore */
    }
    apply(t, accent);
  }

  function setAccent(a: Accent) {
    setAccentState(a);
    try {
      localStorage.setItem("sm_accent", a);
    } catch {
      /* ignore */
    }
    apply(theme, a);
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider
      value={{ theme, accent, setTheme, setAccent, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const c = useContext(ThemeContext);
  if (!c) throw new Error("useTheme deve ser usado dentro de um <ThemeProvider>");
  return c;
}
