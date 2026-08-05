/**
 * Paleta e tipografia dos e-mails do Smart Meet.
 *
 * ISOMÓRFICO — roda no navegador e no servidor. Não importe nada de Node aqui:
 * é isso que permite a prévia na tela e o e-mail enviado saírem do mesmo
 * código, e portanto serem idênticos. Uma prévia que mente é pior que não ter
 * prévia, porque dá confiança sem base.
 *
 * A fonte é propriedade do TEMA, não escolha solta. Tipografia é proporção:
 * corpo, título e entrelinha andam juntos. E há um modo de falha específico do
 * Outlook — pilha de fontes sem uma genérica no fim faz o motor do Word cair em
 * Times New Roman, e o relatório inteiro chega serifado.
 */

export const SERIF = "Georgia,'Times New Roman',Times,serif";
export const SANS = "Arial,Helvetica,sans-serif";
export const MONO = "Consolas,'Courier New',Courier,monospace";

export type Tema = {
  id: string;
  nome: string;
  /** Fundo da área externa ao envelope. */
  fundo: string;
  /** Fundo do envelope. */
  papel: string;
  linha: string;
  linhaClara: string;
  faixa: string;
  zebra: string;
  texto: string;
  forte: string;
  suave: string;
  fonte: string;
  fonteTitulo: string;
};

export type Acento = { id: string; nome: string; cor: string };

export const TEMAS: Record<string, Tema> = {
  pergaminho: {
    id: 'pergaminho', nome: 'Pergaminho',
    fundo: '#f4efe6', papel: '#fffdf8', linha: '#d9ccb6', linhaClara: '#ece4d7',
    faixa: '#fbf7f0', zebra: '#faf7f1',
    texto: '#4a4237', forte: '#2c251d', suave: '#7a6f61',
    fonte: SANS, fonteTitulo: SERIF,
  },
  clinico: {
    id: 'clinico', nome: 'Clínico',
    fundo: '#eef0f2', papel: '#ffffff', linha: '#cfd6dc', linhaClara: '#e3e8ec',
    faixa: '#f7f9fa', zebra: '#f7f9fa',
    texto: '#3d4650', forte: '#1f272e', suave: '#68737d',
    fonte: SANS, fonteTitulo: SANS,
  },
  institucional: {
    id: 'institucional', nome: 'Institucional',
    fundo: '#ecebe7', papel: '#ffffff', linha: '#d5d5cf', linhaClara: '#e6e6e1',
    faixa: '#f6f6f3', zebra: '#f8f8f5',
    texto: '#40403a', forte: '#22221e', suave: '#6e6e66',
    fonte: SANS, fonteTitulo: SANS,
  },
};

export const TEMA_PERGAMINHO = TEMAS.pergaminho;

/** Acentos medidos contra branco (WCAG, texto normal). Todos passam de 4,5:1. */
export const ACENTOS: Record<string, Acento> = {
  cafe: { id: 'cafe', nome: 'Café', cor: '#8c5a2b' },      // 5,8:1
  grafite: { id: 'grafite', nome: 'Grafite', cor: '#3f4a55' }, // 8,7:1
  verde: { id: 'verde', nome: 'Verde', cor: '#2f7d5d' },     // 5,0:1
  bordo: { id: 'bordo', nome: 'Bordô', cor: '#8a3b3b' },     // 7,3:1
};

export const ACENTO_CAFE = ACENTOS.cafe;

/** Cores de estado. Vivem fora do tema: significado não é preferência. */
export const ESTADO = {
  atraso: "#b3261e",
  atrasoFundo: "#fbeae8",
  atencao: "#8a5b1e",
  atencaoFundo: "#fdf3e0",
  ok: "#2f7d5d",
  okFundo: "#e9f4ef",
  neutro: "#7a6f61",
};

/**
 * Escapa para HTML. Inclui a aspa simples: valores entram dentro de
 * `style="…"` e de atributos, e um apóstrofo em nome próprio ("D'Ávila")
 * quebraria o atributo se ele estivesse entre aspas simples em algum ponto.
 */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "5 de agosto de 2026, 09h12" — data por extenso, sem depender de locale. */
export function dataExtenso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}, ` +
    `${p(d.getHours())}h${p(d.getMinutes())}`
  );
}

/** "05/08" — para célula de tabela, onde espaço é caro. */
export function dataCurta(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}` : "—";
}

/** Número no padrão brasileiro, sem depender de Intl no servidor. */
export function numBr(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function pct(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

export function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? um : muitos;
}
