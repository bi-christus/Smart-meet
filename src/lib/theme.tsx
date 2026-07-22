"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";
export type Accent = "preto" | "azul" | "cafe";

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
      const a = (localStorage.getItem("sm_accent") as Accent) || "preto";
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
