/**
 * Formato do arquivo de demandas que o Cowork deposita no Drive, e o validador
 * que decide o que entra no banco.
 *
 * A ideia central: o Cowork NÃO escreve no Firestore. Ele deposita um `.json`
 * numa pasta do Drive onde a conta dele é Colaborador (não consegue apagar), e
 * o app puxa esse arquivo. Não existe rota de escrita para o Cowork — a
 * impossibilidade de ele corromper o banco é estrutural, não configurada.
 *
 * A GRAMÁTICA É A PRIMEIRA TRAVA. Na v1 só existe `acao: "nova"`. Não há
 * "remover", "substituir", "esvaziar" nem qualquer forma de tocar em card
 * existente: o Cowork é incapaz de EXPRESSAR destruição, então nenhuma
 * validação precisa adivinhar intenção maliciosa ou alucinada.
 *
 * Prazo, prioridade e responsável ficam de fora de propósito. São os campos
 * que a transcrição automática mais erra — "dia doze" virando "dia dois"
 * produz uma citação literalmente verificável sustentando um valor errado, e
 * conferir a citação AUMENTA a confiança num erro que ela não sabe detectar.
 * O que a reunião disse sobre isso vira texto no campo `conferir`.
 */

export const SCHEMA_ID = "smart-meet/demandas@1";

/** Teto de propostas por reunião na Fase 1. Ver `RESUMO_LIMITES`. */
export const MAX_PROPOSTAS = 5;
export const MAX_EVIDENCIAS = 3;
export const MAX_TAGS = 8;
export const MAX_CHECKLIST = 10;
export const MAX_CONFERIR = 5;
/** Sidecar maior que isto não é resultado de reunião — é payload inflado. */
export const MAX_SIDECAR_BYTES = 200 * 1024;

export const TIPOS_DEMANDA = [
  "implementacao",
  "correcao",
  "melhoria",
  "relatorio",
] as const;
export type TipoDemanda = (typeof TIPOS_DEMANDA)[number];

export const CERTEZAS = ["alta", "media", "baixa"] as const;
export type Certeza = (typeof CERTEZAS)[number];

export type Evidencia = {
  /** Trecho LITERAL da transcrição que sustenta a proposta. */
  citacao: string;
  /** Marca de tempo aproximada, quando a transcrição trouxer. */
  marca?: string;
};

export type PropostaNova = {
  acao: "nova";
  certezaLLM: Certeza;
  /** Título do bloco correspondente na ata, para o humano se situar. */
  assunto: string;
  resumo: string;
  evidencia: Evidencia[];
  conferir: string[];
  proposta: {
    title: string;
    description: string;
    type: TipoDemanda;
    tags: string[];
    checklist: { text: string; desc?: string }[];
  };
  /** Cards do catálogo que podem já cobrir isto. Sinaliza, não descarta. */
  possivelDuplicataDe: string[];
};

export type Sidecar = {
  schema: string;
  driveFileId: string;
  base: string;
  geradoEm: string;
  gerador: {
    skill?: string;
    versaoSkill?: string;
    motor?: string;
    modeloIA?: string;
  };
  transcricao: { arquivo?: string; truncada: boolean; palavras?: number };
  catalogo: { geradoEm?: string; hash?: string; totalCards?: number };
  propostas: PropostaNova[];
};

export type Rejeitada = { motivo: string; resumo: string };

export type ResultadoValidacao =
  | { ok: true; sidecar: Sidecar; aceitas: PropostaNova[]; rejeitadas: Rejeitada[] }
  | { ok: false; erro: string };

// ---------------------------------------------------------------------------

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

function listaDeTexto(v: unknown, maxItens: number, maxCada: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = texto(x, maxCada);
    if (t) out.push(t);
    if (out.length >= maxItens) break;
  }
  return out;
}

/**
 * Valida uma proposta. Devolve a proposta saneada ou o motivo da recusa.
 *
 * O motivo é DEVOLVIDO, nunca engolido: uma proposta que some em silêncio faz
 * o documento anexado no e-mail prometer três demandas e a fila mostrar duas,
 * sem ninguém entender por quê.
 */
function validarProposta(
  bruta: unknown,
  indice: number,
): { ok: true; proposta: PropostaNova } | { ok: false; motivo: string; resumo: string } {
  const rotulo = `proposta #${indice + 1}`;
  if (!bruta || typeof bruta !== "object") {
    return { ok: false, motivo: "não é um objeto", resumo: rotulo };
  }
  const p = bruta as Record<string, unknown>;
  const resumoCurto =
    texto(p.assunto, 200) ?? texto(p.resumo, 200) ?? rotulo;

  // A trava da gramática: qualquer ação diferente de "nova" é recusada aqui,
  // antes de qualquer leitura dos outros campos.
  if (p.acao !== "nova") {
    return {
      ok: false,
      motivo: `ação "${String(p.acao)}" não existe nesta versão (só "nova")`,
      resumo: resumoCurto,
    };
  }
  if (!CERTEZAS.includes(p.certezaLLM as Certeza)) {
    return { ok: false, motivo: "certezaLLM inválida", resumo: resumoCurto };
  }

  const assunto = texto(p.assunto, 200);
  const resumo = texto(p.resumo, 200);
  if (!assunto) return { ok: false, motivo: "assunto vazio", resumo: resumoCurto };
  if (!resumo) return { ok: false, motivo: "resumo vazio", resumo: resumoCurto };

  const alvo = p.proposta;
  if (!alvo || typeof alvo !== "object") {
    return { ok: false, motivo: "bloco 'proposta' ausente", resumo: resumoCurto };
  }
  const a = alvo as Record<string, unknown>;
  const title = texto(a.title, 120);
  if (!title) {
    return { ok: false, motivo: "título ausente ou longo demais", resumo: resumoCurto };
  }
  const description = typeof a.description === "string" ? a.description.trim().slice(0, 4000) : "";
  if (!TIPOS_DEMANDA.includes(a.type as TipoDemanda)) {
    return { ok: false, motivo: `tipo "${String(a.type)}" inválido`, resumo: resumoCurto };
  }

  // Evidência é obrigatória: proposta sem citação não é revisável, e uma fila
  // que não dá para conferir vira uma fila que se aceita no atacado.
  const evidencia: Evidencia[] = [];
  if (Array.isArray(p.evidencia)) {
    for (const e of p.evidencia) {
      if (!e || typeof e !== "object") continue;
      const c = texto((e as Record<string, unknown>).citacao, 400);
      if (!c) continue;
      const marca = texto((e as Record<string, unknown>).marca, 20);
      evidencia.push(marca ? { citacao: c, marca } : { citacao: c });
      if (evidencia.length >= MAX_EVIDENCIAS) break;
    }
  }
  if (evidencia.length === 0) {
    return { ok: false, motivo: "sem citação da transcrição", resumo: resumoCurto };
  }

  const checklist: { text: string; desc?: string }[] = [];
  if (Array.isArray(a.checklist)) {
    for (const it of a.checklist) {
      if (!it || typeof it !== "object") continue;
      const t = texto((it as Record<string, unknown>).text, 200);
      if (!t) continue;
      const d = texto((it as Record<string, unknown>).desc, 500);
      checklist.push(d ? { text: t, desc: d } : { text: t });
      if (checklist.length >= MAX_CHECKLIST) break;
    }
  }

  return {
    ok: true,
    proposta: {
      acao: "nova",
      certezaLLM: p.certezaLLM as Certeza,
      assunto,
      resumo,
      evidencia,
      conferir: listaDeTexto(p.conferir, MAX_CONFERIR, 300),
      proposta: {
        title,
        description,
        type: a.type as TipoDemanda,
        tags: listaDeTexto(a.tags, MAX_TAGS, 40),
        checklist,
      },
      possivelDuplicataDe: listaDeTexto(p.possivelDuplicataDe, 3, 60),
    },
  };
}

/**
 * Valida o sidecar inteiro.
 *
 * Zero propostas é resultado VÁLIDO e de sucesso: reunião informativa não
 * gera demanda, e forçar produção encheria a fila de ruído — a reação humana a
 * ruído não é revisar com mais cuidado, é aceitar em bloco.
 */
export function validarSidecar(
  bruto: unknown,
  esperado: { driveFileId: string },
): ResultadoValidacao {
  if (!bruto || typeof bruto !== "object") {
    return { ok: false, erro: "arquivo não é um objeto JSON" };
  }
  const s = bruto as Record<string, unknown>;

  if (s.schema !== SCHEMA_ID) {
    return { ok: false, erro: `schema "${String(s.schema)}" desconhecido` };
  }
  // Chave dura contra ata da conversa errada: o `transcrever.py` sanitiza nomes
  // e acrescenta " (2)" em colisão, então o nome não serve de identidade.
  if (s.driveFileId !== esperado.driveFileId) {
    return {
      ok: false,
      erro: `o arquivo aponta para outro áudio (${String(s.driveFileId)})`,
    };
  }

  const t = s.transcricao as Record<string, unknown> | undefined;
  if (t?.truncada === true) {
    return {
      ok: false,
      erro: "gerado a partir de transcrição truncada — as demandas da segunda metade da reunião não existiriam",
    };
  }

  if (!Array.isArray(s.propostas)) {
    return { ok: false, erro: "campo 'propostas' ausente ou não é lista" };
  }

  const aceitas: PropostaNova[] = [];
  const rejeitadas: Rejeitada[] = [];
  for (let i = 0; i < s.propostas.length; i++) {
    if (aceitas.length >= MAX_PROPOSTAS) {
      rejeitadas.push({
        motivo: `excede o teto de ${MAX_PROPOSTAS} propostas por reunião`,
        resumo: `proposta #${i + 1}`,
      });
      continue;
    }
    const r = validarProposta(s.propostas[i], i);
    if (r.ok) aceitas.push(r.proposta);
    else rejeitadas.push({ motivo: r.motivo, resumo: r.resumo });
  }

  return {
    ok: true,
    sidecar: {
      schema: SCHEMA_ID,
      driveFileId: String(s.driveFileId),
      base: typeof s.base === "string" ? s.base : "",
      geradoEm: typeof s.geradoEm === "string" ? s.geradoEm : "",
      gerador: (s.gerador as Sidecar["gerador"]) ?? {},
      transcricao: {
        arquivo: typeof t?.arquivo === "string" ? t.arquivo : undefined,
        truncada: false,
        palavras: typeof t?.palavras === "number" ? t.palavras : undefined,
      },
      catalogo: (s.catalogo as Sidecar["catalogo"]) ?? {},
      propostas: aceitas,
    },
    aceitas,
    rejeitadas,
  };
}

/** Nome do arquivo que o app procura na pasta do áudio. */
export function nomeDoSidecar(base: string): string {
  return `${base} - Demandas.json`;
}
