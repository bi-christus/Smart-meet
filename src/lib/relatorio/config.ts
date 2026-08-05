/**
 * Configuração do relatório para gestor.
 *
 * FASE 1: as preferências são FIXAS aqui. A tela ainda não tem controles —
 * primeiro o relatório precisa existir e ficar bom com um padrão bem escolhido.
 * Os controles vêm depois, calibrados pelo que se sentir falta ao usar, não
 * pelo que imaginamos antes de ver.
 *
 * Por isso `PrefsRelatorio` já nasce com a forma final: quando a Fase 2 chegar,
 * é só passar a ler do Firestore em vez desta constante.
 */

export type Recorte = "abertas" | "risco" | "todas";
export type Agrupamento = "etapa" | "responsavel" | "nenhum";
export type Ordenacao = "prazo" | "prioridade" | "parada";

export type ColunaId =
  | "titulo"
  | "responsavel"
  | "etapa"
  | "prazo"
  | "prioridade"
  | "tipo"
  | "solicitante"
  | "parada"
  | "setor";

export type PrefsRelatorio = {
  versao: 1;
  setores: string[];
  recorte: Recorte;
  agrupamento: Agrupamento;
  ordenacao: Ordenacao;
  colunas: ColunaId[];
  /** Teto de linhas por grupo. Acima disso entra a linha de corte. */
  maxLinhasPorGrupo: number;
  blocos: { numeros: boolean; carga: boolean; paradas: boolean };
  densidade: "confortavel" | "compacto";
};

/**
 * O catálogo NÃO inclui `descrição` nem `último comentário`.
 *
 * São texto livre de operador para operador. Um checkbox chamado "Descrição"
 * parece inofensivo, mas põe esse texto em todas as linhas — e quem configura
 * confere as cinco primeiras na prévia, não a linha 34. Depois de enviado ao
 * gestor não há desfazer. Decisão do Ítalo em 05/08/2026: cortadas de vez.
 */
export const CATALOGO_COLUNAS: { id: ColunaId; rotulo: string }[] = [
  { id: "titulo", rotulo: "Demanda" },
  { id: "responsavel", rotulo: "Responsável" },
  { id: "etapa", rotulo: "Etapa" },
  { id: "prazo", rotulo: "Prazo" },
  { id: "prioridade", rotulo: "Prioridade" },
  { id: "tipo", rotulo: "Tipo" },
  { id: "solicitante", rotulo: "Solicitante" },
  { id: "parada", rotulo: "Parada há" },
  { id: "setor", rotulo: "Setor" },
];

export const PREFS_PADRAO: PrefsRelatorio = {
  versao: 1,
  setores: [],
  recorte: "abertas",
  agrupamento: "etapa",
  ordenacao: "prazo",
  colunas: ["titulo", "responsavel", "prazo", "prioridade", "parada"],
  maxLinhasPorGrupo: 12,
  blocos: { numeros: true, carga: true, paradas: true },
  densidade: "confortavel",
};

/** Teto do corpo do e-mail. O Gmail corta a mensagem acima de ~102 KB e mostra
 *  "[Mensagem aparada]"; 85 KB deixa margem para o envelope e os cabeçalhos. */
export const ORCAMENTO_BYTES = 85_000;
export const MAX_DESTINATARIOS = 10;

export const RECORTE_LABEL: Record<Recorte, string> = {
  abertas: "demandas abertas",
  risco: "demandas em risco",
  todas: "todas as demandas",
};

export const ORDENACAO_LABEL: Record<Ordenacao, string> = {
  prazo: "por prazo, as mais urgentes primeiro",
  prioridade: "por prioridade",
  parada: "pelas paradas há mais tempo",
};
