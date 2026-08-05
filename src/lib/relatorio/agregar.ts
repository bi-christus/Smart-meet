/**
 * Transforma os cards do quadro nos números e listas do relatório.
 *
 * PURO e ISOMÓRFICO. Recebe `agora` por parâmetro em vez de chamar `Date.now()`
 * dentro: é o que torna a função testável e o que garante que a prévia na tela
 * e o e-mail montado no servidor usem o MESMO instante de apuração — senão os
 * "parada há N dias" divergiriam entre o que se viu e o que se enviou.
 */
import type { Card, ColumnDoc, Priority } from "@/lib/kanban";
import type { PrefsRelatorio } from "./config";

export type LinhaDemanda = {
  id: string;
  titulo: string;
  responsavel: string;
  etapa: string;
  setor: string;
  prazo: string | null;
  /** Dias até o prazo; negativo = atrasada. `null` quando não há prazo. */
  diasPrazo: number | null;
  prioridade: Priority;
  tipo: string;
  solicitante: string;
  /** Dias parados na etapa atual. */
  paradaDias: number;
};

export type Grupo = { titulo: string; linhas: LinhaDemanda[] };

export type CargaResponsavel = {
  nome: string;
  total: number;
  atrasadas: number;
};

export type DadosRelatorio = {
  total: number;
  atrasadas: number;
  semPrazo: number;
  vencemEm3Dias: number;
  concluidas: number;
  grupos: Grupo[];
  carga: CargaResponsavel[];
  paradas: LinhaDemanda[];
  /** Quantos cards não têm `enteredAt` — a parada deles é desconhecida. */
  semDataEntrada: number;
};

const DIA = 86400000;

/**
 * Uma etapa conta como entregue?
 *
 * Heurística por nome enquanto o quadro não tem o campo explícito. É frágil de
 * propósito assumido: o rodapé do relatório declara que a contagem de
 * concluídas usa o nome da coluna, para o gestor saber o que está lendo.
 */
export function colunaEhTerminal(titulo: string): boolean {
  return /conclu|entregue|finaliz|pronto|feito|encerrad/i.test(titulo);
}

function diasEntre(a: number, b: number): number {
  return Math.floor((a - b) / DIA);
}

function inicioDoDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parsePrazo(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function agregar(
  cards: Card[],
  colunas: ColumnDoc[],
  nomePorEmail: Record<string, string>,
  prefs: PrefsRelatorio,
  agora: number,
): DadosRelatorio {
  const hoje = inicioDoDia(agora);
  const tituloDaColuna = new Map(colunas.map((c) => [c.colId, c.title]));
  const terminais = new Set(
    colunas.filter((c) => colunaEhTerminal(c.title)).map((c) => c.colId),
  );

  const concluidas = cards.filter((c) => terminais.has(c.columnId)).length;
  const abertos = cards.filter((c) => !terminais.has(c.columnId));

  const linhas: LinhaDemanda[] = abertos.map((c) => {
    const diasPrazo = c.due ? diasEntre(parsePrazo(c.due), hoje) : null;
    return {
      id: c.id,
      titulo: c.title,
      responsavel: c.assignee
        ? (nomePorEmail[c.assignee] ?? c.assignee)
        : "Sem responsável",
      etapa: tituloDaColuna.get(c.columnId) ?? c.columnId,
      setor: c.sector,
      prazo: c.due ?? null,
      diasPrazo,
      prioridade: c.priority ?? "media",
      tipo: c.type ?? "",
      solicitante: c.requester ?? "",
      paradaDias: c.enteredAt ? diasEntre(agora, c.enteredAt) : -1,
    };
  });

  const atrasadas = linhas.filter((l) => l.diasPrazo !== null && l.diasPrazo < 0);
  const semPrazo = linhas.filter((l) => l.diasPrazo === null);
  const vencemEm3 = linhas.filter(
    (l) => l.diasPrazo !== null && l.diasPrazo >= 0 && l.diasPrazo <= 3,
  );

  // Recorte
  let selecionadas = linhas;
  if (prefs.recorte === "risco") {
    const emRisco = new Set([...atrasadas, ...semPrazo, ...vencemEm3].map((l) => l.id));
    selecionadas = linhas.filter((l) => emRisco.has(l.id));
  } else if (prefs.recorte === "todas") {
    selecionadas = linhas; // "todas" ainda exclui terminais: relatório é do que está aberto
  }

  // Ordenação. Sem prazo vai para o fim na ordenação por prazo — não é urgente
  // por não ter data, é indefinido, e misturá-lo com o atraso esconde os dois.
  const ordem: Record<Priority, number> = { alta: 0, media: 1, baixa: 2 };
  const ordenadas = [...selecionadas].sort((a, b) => {
    if (prefs.ordenacao === "prazo") {
      if (a.diasPrazo === null && b.diasPrazo === null) return 0;
      if (a.diasPrazo === null) return 1;
      if (b.diasPrazo === null) return -1;
      return a.diasPrazo - b.diasPrazo;
    }
    if (prefs.ordenacao === "prioridade") {
      const d = ordem[a.prioridade] - ordem[b.prioridade];
      return d !== 0 ? d : (a.diasPrazo ?? 9999) - (b.diasPrazo ?? 9999);
    }
    return b.paradaDias - a.paradaDias;
  });

  // Agrupamento
  let grupos: Grupo[];
  if (prefs.agrupamento === "nenhum") {
    grupos = [{ titulo: "", linhas: ordenadas }];
  } else {
    const chave = (l: LinhaDemanda) =>
      prefs.agrupamento === "etapa" ? l.etapa : l.responsavel;
    const mapa = new Map<string, LinhaDemanda[]>();
    for (const l of ordenadas) {
      const k = chave(l);
      const arr = mapa.get(k) ?? [];
      arr.push(l);
      mapa.set(k, arr);
    }
    // Etapa segue a ordem do quadro; responsável segue quem tem mais.
    if (prefs.agrupamento === "etapa") {
      const pos = new Map(colunas.map((c, i) => [c.title, i]));
      grupos = [...mapa.entries()]
        .sort((a, b) => (pos.get(a[0]) ?? 99) - (pos.get(b[0]) ?? 99))
        .map(([titulo, linhas]) => ({ titulo, linhas }));
    } else {
      grupos = [...mapa.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([titulo, linhas]) => ({ titulo, linhas }));
    }
  }

  // Carga por responsável — sobre as ABERTAS, não sobre o recorte: o gestor
  // precisa ver a carga real, não a carga do que ele pediu para filtrar.
  const porResp = new Map<string, CargaResponsavel>();
  for (const l of linhas) {
    const c = porResp.get(l.responsavel) ?? {
      nome: l.responsavel,
      total: 0,
      atrasadas: 0,
    };
    c.total++;
    if (l.diasPrazo !== null && l.diasPrazo < 0) c.atrasadas++;
    porResp.set(l.responsavel, c);
  }
  const carga = [...porResp.values()].sort((a, b) => b.total - a.total);

  const paradas = [...linhas]
    .filter((l) => l.paradaDias >= 0)
    .sort((a, b) => b.paradaDias - a.paradaDias)
    .slice(0, 5);

  return {
    total: linhas.length,
    atrasadas: atrasadas.length,
    semPrazo: semPrazo.length,
    vencemEm3Dias: vencemEm3.length,
    concluidas,
    grupos,
    carga,
    paradas,
    semDataEntrada: linhas.filter((l) => l.paradaDias < 0).length,
  };
}
