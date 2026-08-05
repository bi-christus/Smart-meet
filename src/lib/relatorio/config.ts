/**
 * Configuração do relatório para gestor.
 *
 * A paleta é FECHADA e verificada: os quatro acentos e as cores de estado
 * foram medidos contra branco (WCAG, texto normal) e todos passam de 4,5:1.
 * Como não há cor livre, não existe guarda de contraste em tempo de execução —
 * e não existe o bug de o seletor mostrar uma cor e o e-mail sair com outra.
 *
 * Nenhum `colId` é guardado aqui. A etapa vive em `/columns`, então apagar ou
 * recriar uma coluna não deixa a configuração de ninguém apontando para um id
 * fantasma.
 */

export const PREFS_VERSAO = 1;

export type TemaId = "pergaminho" | "clinico" | "institucional";
export type AcentoId = "cafe" | "grafite" | "verde" | "bordo";
export type Densidade = "confortavel" | "compacto";
export type Recorte = "abertas" | "risco" | "todas";
export type Agrupamento = "etapa" | "responsavel" | "prioridade" | "nenhum";
export type Ordenacao = "prazo" | "prioridade" | "parada" | "titulo";

export type ColunaId =
  | "titulo"
  | "responsavel"
  | "etapa"
  | "prazo"
  | "prioridade"
  | "tipo"
  | "solicitante"
  | "setorSolicitante"
  | "parada"
  | "inicio"
  | "progresso"
  | "setor";

export type Blocos = {
  resumo: boolean;
  carga: boolean;
  paradas: boolean;
  qualidade: boolean;
};

export type PrefsRelatorio = {
  v: number;
  tema: TemaId;
  acento: AcentoId;
  densidade: Densidade;
  setores: string[];
  recorte: Recorte;
  agrupamento: Agrupamento;
  ordenacao: Ordenacao;
  colunas: ColunaId[];
  blocos: Blocos;
  destinatariosPadrao: string[];
};

/**
 * O catálogo NÃO inclui `descrição` nem `último comentário`.
 *
 * São texto livre de operador para operador. Um checkbox chamado "Descrição"
 * parece inofensivo, mas põe esse texto em TODAS as linhas — e quem configura
 * confere as cinco primeiras na prévia, não a linha 34. Depois de enviado ao
 * gestor não há desfazer. Decisão do Ítalo em 05/08/2026: cortadas de vez.
 *
 * `peso` é largura relativa. A trava é de orçamento de largura, não de
 * contagem de colunas: `titulo + tags + solicitante + setorSolicitante` são
 * quatro e já estouram, enquanto seis estreitas cabem bem.
 */
export const CATALOGO_COLUNAS: {
  id: ColunaId;
  rotulo: string;
  peso: number;
  fixa?: boolean;
  automatica?: boolean;
}[] = [
  { id: "titulo", rotulo: "Demanda", peso: 40, fixa: true },
  { id: "responsavel", rotulo: "Responsável", peso: 18 },
  { id: "prioridade", rotulo: "Prioridade", peso: 12 },
  { id: "prazo", rotulo: "Prazo", peso: 16 },
  { id: "etapa", rotulo: "Etapa", peso: 14 },
  { id: "parada", rotulo: "Parada há", peso: 11 },
  { id: "inicio", rotulo: "Início", peso: 11 },
  { id: "tipo", rotulo: "Tipo", peso: 14 },
  { id: "solicitante", rotulo: "Solicitante", peso: 16 },
  { id: "setorSolicitante", rotulo: "Setor solicitante", peso: 16 },
  { id: "progresso", rotulo: "Progresso", peso: 11 },
  { id: "setor", rotulo: "Setor", peso: 12, automatica: true },
];

export const PESO_MAXIMO = 100;

export const PREFS_PADRAO: PrefsRelatorio = {
  v: PREFS_VERSAO,
  tema: "pergaminho",
  acento: "cafe",
  densidade: "confortavel",
  setores: [],
  recorte: "abertas",
  agrupamento: "etapa",
  ordenacao: "prazo",
  colunas: ["titulo", "responsavel", "prioridade", "prazo", "etapa"],
  blocos: { resumo: true, carga: true, paradas: true, qualidade: false },
  destinatariosPadrao: [],
};

/** Teto do corpo. O Gmail apara acima de ~102 KB e mostra "[Mensagem aparada]". */
export const ORCAMENTO_BYTES = 85_000;
export const MAX_DESTINATARIOS = 10;
export const MAX_SETORES = 4;

export const TEMA_LABEL: Record<TemaId, string> = {
  pergaminho: "Pergaminho",
  clinico: "Clínico",
  institucional: "Institucional",
};
export const ACENTO_LABEL: Record<AcentoId, string> = {
  cafe: "Café",
  grafite: "Grafite",
  verde: "Verde",
  bordo: "Bordô",
};
export const RECORTE_LABEL: Record<Recorte, string> = {
  abertas: "demandas abertas",
  risco: "demandas em risco",
  todas: "todas as demandas",
};
export const AGRUPAMENTO_LABEL: Record<Agrupamento, string> = {
  etapa: "Por etapa",
  responsavel: "Por responsável",
  prioridade: "Por prioridade",
  nenhum: "Lista única",
};
export const ORDENACAO_LABEL: Record<Ordenacao, string> = {
  prazo: "por prazo, as mais urgentes primeiro",
  prioridade: "por prioridade",
  parada: "pelas paradas há mais tempo",
  titulo: "por ordem alfabética",
};
export const BLOCO_LABEL: Record<keyof Blocos, string> = {
  resumo: "Resumo em números",
  carga: "Carga por responsável",
  paradas: "Paradas há mais tempo",
  qualidade: "Qualidade do cadastro",
};

// ---------------------------------------------------------------------------

function umDe<T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T {
  return opcoes.includes(v as T) ? (v as T) : padrao;
}

/**
 * Normaliza o que veio do banco contra o padrão, campo a campo.
 *
 * Nada aqui lança: preferência corrompida não é caminho crítico e não deve
 * impedir alguém de enviar um relatório. Enum desconhecido volta ao padrão
 * daquele campo, em silêncio.
 */
export function normalizarPrefs(bruto: unknown): PrefsRelatorio {
  const p = (bruto ?? {}) as Partial<PrefsRelatorio>;

  // Versão maior que a atual = o usuário voltou de uma versão futura do app.
  // Melhor recomeçar do padrão do que interpretar campos que não existem aqui.
  if (typeof p.v === "number" && p.v > PREFS_VERSAO) return { ...PREFS_PADRAO };

  const catalogo = new Set(CATALOGO_COLUNAS.map((c) => c.id));
  const colunas = Array.isArray(p.colunas)
    ? [...new Set(p.colunas.filter((c): c is ColunaId => catalogo.has(c as ColunaId)))]
    : PREFS_PADRAO.colunas;
  // `titulo` é fixa e sempre primeira: uma tabela cuja primeira coluna não é o
  // nome da demanda não se lê.
  const semTitulo = colunas.filter((c) => c !== "titulo");
  const finais: ColunaId[] = ["titulo", ...semTitulo];

  return {
    v: PREFS_VERSAO,
    tema: umDe(p.tema, ["pergaminho", "clinico", "institucional"] as const, "pergaminho"),
    acento: umDe(p.acento, ["cafe", "grafite", "verde", "bordo"] as const, "cafe"),
    densidade: umDe(p.densidade, ["confortavel", "compacto"] as const, "confortavel"),
    setores: Array.isArray(p.setores)
      ? p.setores.filter((s) => typeof s === "string").slice(0, MAX_SETORES)
      : [],
    recorte: umDe(p.recorte, ["abertas", "risco", "todas"] as const, "abertas"),
    agrupamento: umDe(
      p.agrupamento,
      ["etapa", "responsavel", "prioridade", "nenhum"] as const,
      "etapa",
    ),
    ordenacao: umDe(
      p.ordenacao,
      ["prazo", "prioridade", "parada", "titulo"] as const,
      "prazo",
    ),
    colunas: finais.length > 1 ? finais : PREFS_PADRAO.colunas,
    blocos: {
      resumo: p.blocos?.resumo ?? true,
      carga: p.blocos?.carga ?? true,
      paradas: p.blocos?.paradas ?? true,
      qualidade: p.blocos?.qualidade ?? false,
    },
    destinatariosPadrao: Array.isArray(p.destinatariosPadrao)
      ? p.destinatariosPadrao
          .filter((e) => typeof e === "string" && e.includes("@"))
          .slice(0, MAX_DESTINATARIOS)
      : [],
  };
}

/**
 * Colunas que realmente entram, depois das regras automáticas.
 *
 * 1. A coluna que repete o critério de agrupamento sai — repetir em toda linha
 *    o que já está no título do grupo é ruído.
 * 2. `setor` entra sozinha quando há mais de um setor no escopo, e sai quando
 *    volta a um.
 */
export function colunasEfetivas(
  prefs: PrefsRelatorio,
  qtdSetores: number,
): ColunaId[] {
  const fora = new Set<ColunaId>();
  if (prefs.agrupamento === "etapa") fora.add("etapa");
  if (prefs.agrupamento === "responsavel") fora.add("responsavel");
  if (prefs.agrupamento === "prioridade") fora.add("prioridade");

  const base = prefs.colunas.filter((c) => !fora.has(c) && c !== "setor");
  return qtdSetores > 1 ? [...base, "setor"] : base;
}

export function pesoTotal(colunas: ColunaId[]): number {
  const peso = new Map(CATALOGO_COLUNAS.map((c) => [c.id, c.peso]));
  return colunas.reduce((s, c) => s + (peso.get(c) ?? 0), 0);
}

/**
 * Impressão digital das preferências.
 *
 * O cliente manda junto com o envio; o servidor recalcula sobre o que leu do
 * Firestore. Divergiu significa que a configuração mudou entre a prévia e o
 * clique — outra aba, migração de versão — e a rota rejeita em vez de enviar
 * algo diferente do que a pessoa viu.
 */
export function hashPrefs(p: PrefsRelatorio): string {
  const estavel = JSON.stringify([
    p.v, p.tema, p.acento, p.densidade,
    [...p.setores].sort(), p.recorte, p.agrupamento, p.ordenacao,
    p.colunas, p.blocos,
  ]);
  let h = 0;
  for (let i = 0; i < estavel.length; i++) {
    h = (Math.imul(31, h) + estavel.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
