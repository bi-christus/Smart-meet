"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Os temas. `contraste` é o alto contraste (#214): preto de verdade, texto
 * branco e borda que se vê — ver o bloco dele em `globals.css`.
 */
export type Theme = "dark" | "light" | "contraste";

const TEMAS: readonly Theme[] = ["dark", "light", "contraste"];

/** O tema guardado, ou o padrão — pelo mesmo motivo de `acentoValido`. */
function temaValido(bruto: string | null): Theme {
  return TEMAS.includes(bruto as Theme) ? (bruto as Theme) : "dark";
}
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
  /**
   * A onda animada atrás do app está ligada? (#214)
   *
   * Preferência de cada pessoa, guardada no navegador. Desligada, a onda nem
   * monta — não é só esconder: o canvas é redesenhado 30 vezes por segundo, e
   * quem desliga muitas vezes desliga justamente para a máquina respirar.
   * `prefers-reduced-motion` continua mandando independentemente disto: com
   * ele, a onda já não se mexe (ver `waveform.tsx`).
   */
  fundoAnimado: boolean;
  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  setFundoAnimado: (ligado: boolean) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function apply(theme: Theme, accent: Accent) {
  const r = document.documentElement;
  r.dataset.theme = theme;
  r.dataset.accent = accent;
}

/**
 * As preferências moram no `localStorage`, e é DE LÁ que a tela lê — como
 * fonte externa (`useSyncExternalStore`), e não copiadas para um estado.
 *
 * Até 15/10/2026 elas eram `useState` com o padrão e um efeito que, na
 * montagem, lia o `localStorage` e chamava três `setState`. Funcionava, mas
 * é o desenho que o lint do projeto reprova (setState síncrono em efeito, um
 * render a mais em cascata) — e era um dos erros que deixavam `npm run lint`
 * vermelho. Lido como fonte externa, o servidor responde o padrão, o navegador
 * responde o guardado, e o React concilia os dois sem efeito nenhum.
 *
 * `memoria` é a reserva para quando o `localStorage` recusa (janela anônima
 * em alguns navegadores, cota cheia): a escolha vale até recarregar, que era
 * exatamente o comportamento do estado de antes.
 */
const memoria = new Map<string, string>();
const ouvintes = new Set<() => void>();

function ler(chave: string): string | null {
  try {
    const v = localStorage.getItem(chave);
    if (v !== null) return v;
  } catch {
    /* sem localStorage: vale a memória */
  }
  return memoria.get(chave) ?? null;
}

function gravar(chave: string, valor: string) {
  memoria.set(chave, valor);
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* ignore */
  }
  ouvintes.forEach((f) => f());
}

/** Avisa também quando OUTRA aba troca o tema — o evento `storage` é dela. */
function assinar(aviso: () => void) {
  ouvintes.add(aviso);
  window.addEventListener("storage", aviso);
  return () => {
    ouvintes.delete(aviso);
    window.removeEventListener("storage", aviso);
  };
}

const semValorNoServidor = () => null;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = temaValido(
    useSyncExternalStore(assinar, () => ler("sm_theme"), semValorNoServidor),
  );
  const accent = acentoValido(
    useSyncExternalStore(assinar, () => ler("sm_accent"), semValorNoServidor),
  );
  // Só "off" desliga: ausente é o padrão de sempre, com a onda ligada.
  const fundoAnimado =
    useSyncExternalStore(assinar, () => ler("sm_fundo"), semValorNoServidor) !== "off";

  /**
   * Na montagem, confirma no `<html>` o que o script anti-flash já aplicou.
   * Lê do `localStorage` DIRETO, e não de `theme`: no primeiro desenho
   * (hidratação) `theme` ainda é o padrão do servidor, e aplicá-lo pintaria o
   * tema escuro por um quadro em quem escolheu o claro.
   */
  useEffect(() => {
    apply(temaValido(ler("sm_theme")), acentoValido(ler("sm_accent")));
  }, []);

  function setFundoAnimado(ligado: boolean) {
    gravar("sm_fundo", ligado ? "on" : "off");
  }

  function setTheme(t: Theme) {
    gravar("sm_theme", t);
    apply(t, accent);
  }

  function setAccent(a: Accent) {
    gravar("sm_accent", a);
    apply(theme, a);
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        accent,
        fundoAnimado,
        setTheme,
        setAccent,
        setFundoAnimado,
        toggleTheme,
      }}
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
