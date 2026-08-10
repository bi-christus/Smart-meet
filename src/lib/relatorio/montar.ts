/**
 * Monta o relatório: dados + preferências → assunto, preheader, HTML e texto.
 *
 * PURO e ISOMÓRFICO. **Não pode importar nada de `src/lib/server/`** — é este
 * contrato que mantém a prévia da tela e o e-mail enviado byte a byte iguais.
 * No instante em que a montagem precisar de algo do servidor, a prévia começa
 * a mentir, e uma prévia que mente é pior que nenhuma: dá confiança sem base.
 */
import {
  TEMAS,
  ACENTOS,
  ESTADO,
  dataExtenso,
  dataCurta,
  numBr,
  plural,
} from "@/lib/email/tema";
import {
  documento,
  cabecalho,
  citacao,
  kpis,
  h2Secao,
  subtitulo,
  tabelaDados,
  linhaCorte,
  rodape,
  respiro,
  type Celula,
  type Ctx,
} from "@/lib/email/blocos";
import {
  CATALOGO_COLUNAS,
  colunasEfetivas,
  ORCAMENTO_BYTES,
  ORDENACAO_LABEL,
  RECORTE_LABEL,
  type ColunaId,
  type PrefsRelatorio,
} from "./config";
import { DEMAND_TYPE_LABEL, PRIORITY_LABEL } from "@/lib/kanban";
import type { DadosRelatorio, LinhaDemanda } from "./agregar";

export type MetaRelatorio = {
  setores: string[];
  enviadoPor: string;
  recado?: string;
  agora: number;
  /** Só o próprio montador usa, ao reduzir por orçamento. */
  tetoPorGrupo?: number;
};

export type RelatorioMontado = {
  assunto: string;
  preheader: string;
  html: string;
  texto: string;
  linhasEnviadas: number;
  linhasCortadas: number;
  bytes: number;
};

const ROTULO = Object.fromEntries(
  CATALOGO_COLUNAS.map((c) => [c.id, c.rotulo]),
) as Record<ColunaId, string>;

/** Texto e cor do prazo. O estado precisa estar no TEXTO: cor sozinha não
 *  sobrevive ao modo escuro nem serve a quem não distingue as cores. */
function celulaPrazo(l: LinhaDemanda): Celula {
  if (l.diasPrazo === null) {
    // "sem prazo definido" e não "sem prazo": o gestor precisa ler que a data
    // ainda NÃO foi combinada, não que alguém esqueceu de preencher o campo.
    return { texto: "sem prazo definido", cor: ESTADO.neutro };
  }
  if (l.diasPrazo < 0) {
    const d = Math.abs(l.diasPrazo);
    return {
      texto: `${dataCurta(l.prazo)} · ${d} ${plural(d, "dia", "dias")} de atraso`,
      cor: ESTADO.atraso,
      forte: true,
    };
  }
  if (l.diasPrazo === 0) return { texto: "vence hoje", cor: ESTADO.atencao, forte: true };
  if (l.diasPrazo <= 3) {
    return {
      texto: `${dataCurta(l.prazo)} · em ${l.diasPrazo} ${plural(l.diasPrazo, "dia", "dias")}`,
      cor: ESTADO.atencao,
    };
  }
  return { texto: dataCurta(l.prazo) };
}

function celula(l: LinhaDemanda, col: ColunaId): Celula {
  switch (col) {
    case "titulo":
      return { texto: l.titulo, forte: true };
    case "responsavel":
      return {
        texto: l.responsavel,
        cor: l.responsavel === "Sem responsável" ? ESTADO.neutro : undefined,
      };
    case "etapa":
      return { texto: l.etapa };
    case "prazo":
      return celulaPrazo(l);
    case "prioridade":
      return {
        texto: PRIORITY_LABEL[l.prioridade] ?? l.prioridade,
        cor: l.prioridade === "alta" ? ESTADO.atraso : undefined,
      };
    case "tipo":
      return {
        texto:
          DEMAND_TYPE_LABEL[l.tipo as keyof typeof DEMAND_TYPE_LABEL] ?? l.tipo ?? "—",
      };
    case "solicitante":
      return { texto: l.solicitante || "—" };
    case "parada":
      return l.paradaDias < 0
        ? { texto: "—", cor: ESTADO.neutro }
        : {
            texto: `${l.paradaDias} ${plural(l.paradaDias, "dia", "dias")}`,
            cor: l.paradaDias >= 14 ? ESTADO.atencao : undefined,
          };
    case "setorSolicitante":
      return { texto: l.setorSolicitante || "—" };
    case "inicio":
      return { texto: l.inicio ? dataCurta(l.inicio) : "—" };
    case "progresso":
      return {
        texto: l.checklistTotal > 0 ? `${l.checklistFeitos}/${l.checklistTotal}` : "—",
        cor: l.checklistTotal === 0 ? ESTADO.neutro : undefined,
      };
    case "setor":
      return { texto: l.setor };
  }
}

/** Versão em texto puro. Não é enfeite: cliente sem HTML, leitor de tela e o
 *  recorte de busca do Gmail usam esta parte. */
function versaoTexto(d: DadosRelatorio, meta: MetaRelatorio): string {
  const l: string[] = [];
  l.push(`RELATÓRIO DE DEMANDAS — ${meta.setores.join(", ")}`);
  l.push(`Posição de ${dataExtenso(new Date(meta.agora))}`);
  l.push("");
  if (meta.recado) {
    l.push(meta.recado, "");
  }
  l.push(
    `${d.total} abertas · ${d.atrasadas} atrasadas · ${d.semPrazo} sem prazo definido · ${d.concluidas} concluídas`,
  );
  l.push("");
  for (const g of d.grupos) {
    if (g.titulo) l.push(`## ${g.titulo} (${g.linhas.length})`);
    for (const it of g.linhas) {
      const prazo = celulaPrazo(it).texto;
      l.push(`- ${it.titulo} — ${it.responsavel} — ${prazo}`);
    }
    l.push("");
  }
  l.push(`Enviado por ${meta.enviadoPor} pelo Smart Meet.`);
  return l.join("\n");
}

export function montarRelatorio(
  d: DadosRelatorio,
  prefs: PrefsRelatorio,
  meta: MetaRelatorio,
): RelatorioMontado {
  const ctx: Ctx = {
    tema: TEMAS[prefs.tema] ?? TEMAS.pergaminho,
    acento: ACENTOS[prefs.acento] ?? ACENTOS.cafe,
    densidade: prefs.densidade,
  };

  const escopo = meta.setores.join(", ");
  const assunto = `Relatório de demandas — ${escopo} — ${dataCurta(
    new Date(meta.agora).toISOString().slice(0, 10),
  )}`;

  const preheader =
    `${d.atrasadas} ${plural(d.atrasadas, "atrasada", "atrasadas")} · ` +
    `${d.semPrazo} sem prazo definido · ${d.total} ${plural(d.total, "aberta", "abertas")}`;

  const partes: string[] = [];
  // Teto de linhas por grupo. Não é preferência: o corte real é por orçamento
  // de bytes, e expor um limite convidaria a configurar "0" e estourar o Gmail.
  const tetoPorGrupo = meta.tetoPorGrupo ?? 12;

  partes.push(
    cabecalho(ctx, {
      eyebrow: "SMART MEET · RELATÓRIO DE DEMANDAS",
      titulo: `${escopo} — ${RECORTE_LABEL[prefs.recorte]}`,
      contexto:
        `Posição de ${dataExtenso(new Date(meta.agora))} · ` +
        `${numBr(d.total)} ${plural(d.total, "demanda aberta", "demandas abertas")} · ` +
        `enviado por ${meta.enviadoPor}`,
    }),
  );

  if (meta.recado?.trim()) partes.push(citacao(ctx, meta.recado.trim()));

  if (prefs.blocos.resumo) {
    partes.push(
      kpis(ctx, [
        { valor: numBr(d.total), rotulo: "ABERTAS" },
        {
          valor: numBr(d.atrasadas),
          rotulo: "ATRASADAS",
          cor: d.atrasadas > 0 ? ESTADO.atraso : undefined,
        },
        {
          valor: numBr(d.semPrazo),
          rotulo: "SEM PRAZO DEFINIDO",
          cor: d.semPrazo > 0 ? ESTADO.atencao : undefined,
        },
        { valor: numBr(d.concluidas), rotulo: "CONCLUÍDAS" },
      ]),
    );
  }

  if (prefs.blocos.carga && d.carga.length > 0) {
    partes.push(h2Secao(ctx, "Carga por responsável"));
    partes.push(
      subtitulo(
        ctx,
        `${d.carga.length} ${plural(d.carga.length, "pessoa", "pessoas")} com demanda aberta, da maior carga para a menor.`,
      ),
    );
    const linhasCarga = d.carga.map((c) => [
      { texto: c.nome, forte: true } as Celula,
      { texto: `${c.total}` } as Celula,
      {
        texto: c.atrasadas > 0 ? `${c.atrasadas}` : "—",
        cor: c.atrasadas > 0 ? ESTADO.atraso : ESTADO.neutro,
      } as Celula,
    ]);
    partes.push(
      tabelaDados(ctx, ["Responsável", "Abertas", "Atrasadas"], linhasCarga),
    );
  }

  if (prefs.blocos.paradas && d.paradas.length > 0) {
    partes.push(h2Secao(ctx, "Paradas há mais tempo"));
    partes.push(
      subtitulo(
        ctx,
        d.semDataEntrada > 0
          ? `As 5 mais antigas na etapa atual. ${d.semDataEntrada} sem data de entrada registrada ficaram de fora.`
          : "As 5 mais antigas na etapa atual.",
      ),
    );
    partes.push(
      tabelaDados(
        ctx,
        ["Demanda", "Etapa", "Parada há", "Responsável"],
        d.paradas.map((l) => [
          { texto: l.titulo, forte: true },
          { texto: l.etapa },
          {
            texto: `${l.paradaDias} ${plural(l.paradaDias, "dia", "dias")}`,
            cor: l.paradaDias >= 14 ? ESTADO.atencao : undefined,
          },
          { texto: l.responsavel },
        ]),
      ),
    );
  }

  if (prefs.blocos.qualidade && d.total > 0) {
    const semResp = d.carga.find((c) => c.nome === "Sem responsável")?.total ?? 0;
    partes.push(h2Secao(ctx, "Qualidade do cadastro"));
    partes.push(
      subtitulo(
        ctx,
        "O que falta preencher nas demandas abertas. Campo vazio não é erro, mas é o que impede o número acima de significar alguma coisa.",
      ),
    );
    const linha = (rot: string, n: number): Celula[] => [
      { texto: rot },
      { texto: `${n}` },
      {
        texto: `${Math.round((n / d.total) * 100)}%`,
        cor: n / d.total > 0.3 ? ESTADO.atencao : undefined,
      },
    ];
    partes.push(
      tabelaDados(
        ctx,
        ["Falta", "Demandas", "Do total"],
        [
          linha("Sem responsável", semResp),
          linha("Sem prazo definido", d.semPrazo),
          linha("Sem data de entrada na etapa", d.semDataEntrada),
        ],
      ),
    );
  }

  // --- demandas ---
  let enviadas = 0;
  let cortadas = 0;
  const colunas = colunasEfetivas(prefs, meta.setores.length);
  const cabecalhos = colunas.map((c) => ROTULO[c]);

  partes.push(h2Secao(ctx, "Demandas"));
  for (const g of d.grupos) {
    if (g.linhas.length === 0) continue;
    if (g.titulo) {
      partes.push(
        subtitulo(
          ctx,
          `${g.titulo} · ${g.linhas.length} ${plural(g.linhas.length, "demanda", "demandas")} · ${ORDENACAO_LABEL[prefs.ordenacao]}.`,
        ),
      );
    } else {
      partes.push(
        subtitulo(
          ctx,
          `${g.linhas.length} ${plural(g.linhas.length, "demanda", "demandas")} · ${ORDENACAO_LABEL[prefs.ordenacao]}.`,
        ),
      );
    }
    const mostrar = g.linhas.slice(0, tetoPorGrupo);
    const resto = g.linhas.length - mostrar.length;
    enviadas += mostrar.length;
    cortadas += resto;
    partes.push(
      tabelaDados(
        ctx,
        cabecalhos,
        mostrar.map((l) => colunas.map((c) => celula(l, c))),
      ),
    );
    if (resto > 0) {
      partes.push(
        linhaCorte(
          ctx,
          `+ ${resto} ${plural(resto, "demanda", "demandas")} neste grupo. Abra o Kanban para ver a lista completa.`,
        ),
      );
    }
    partes.push(respiro(10));
  }

  partes.push(
    rodape(ctx, [
      `Apurado em ${dataExtenso(new Date(meta.agora))} a partir do quadro de ${escopo}.`,
      "Concluídas são as demandas na última etapa do quadro ou em etapa cujo nome indica conclusão. Elas ficam fora de tudo o que se lê acima — entrega feita não atrasa, mesmo com o prazo no passado.",
      "Sem prazo definido não é atraso nem esquecimento: é demanda cuja data de entrega ainda não foi combinada.",
      "Parada há N dias conta desde a última mudança de etapa; demandas sem esse registro aparecem com traço.",
      "Este relatório ignora os filtros ativos do quadro: ele traz o setor inteiro.",
    ]),
  );

  const html = documento(ctx, preheader, partes.join("\n"));

  // Orçamento: se estourar, reduz o teto de linhas por grupo e remonta. O corte
  // acontece AQUI, na função pura, para a prévia mostrar exatamente o mesmo
  // que vai ser enviado — e não o e-mail chegar aparado sem ninguém saber.
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > ORCAMENTO_BYTES) {
    const menor = Math.max(3, Math.floor(tetoPorGrupo / 2));
    if (menor < tetoPorGrupo) {
      return montarRelatorio(d, prefs, { ...meta, tetoPorGrupo: menor });
    }
  }

  const texto = versaoTexto(d, meta);
  return {
    assunto,
    preheader,
    html,
    texto,
    linhasEnviadas: enviadas,
    linhasCortadas: cortadas,
    bytes,
  };
}
