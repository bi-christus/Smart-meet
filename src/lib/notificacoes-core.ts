/**
 * As notificações da lateral — o que mudou nas demandas DESTA pessoa.
 *
 * Módulo puro (AGENTS.md §4), testado em `scripts/test-notificacoes.mjs`. Quem
 * lê o banco é o componente `notificacoes.tsx`; aqui só se decide o que entra.
 *
 * SÓ O QUE É DA PESSOA (16/10/2026, #237). "Da pessoa" é:
 *  - a demanda em que ela é a responsável (`assignee`) ou que ela criou
 *    (`createdBy`) — os dois campos de card que guardam e-mail de usuário;
 *    `requester` é um nome cadastrado, não uma conta, e não serve de chave;
 *  - a reunião que ela registrou (`createdBy` do `/meetings`), e as propostas
 *    de demanda que a IA tirou dela.
 * O resto do setor não entra. A lateral de quem tem dez colegas viraria o
 * mural do setor inteiro, e o que é dela se perderia no meio.
 *
 * O QUE A PRÓPRIA PESSOA FEZ NÃO É NOTÍCIA. Mover o próprio card e ver
 * "você moveu o card" na lateral é ruído: ela estava lá.
 *
 * A VALIDAÇÃO É PENDÊNCIA, NÃO NOTÍCIA. Reunião processada à espera de
 * validação aparece como uma tarefa da pessoa — mas só aqui, e não como card
 * no quadro. O quadro é o trabalho combinado do setor; conferir o relatório
 * que a IA escreveu sobre a própria reunião é tarefa dela, de cinco minutos,
 * e um card para isso entupiria a coluna de entrada de todo mundo.
 */

export type CardNot = {
  id: string;
  sector: string;
  title: string;
  assignee?: string | null;
  createdBy?: string;
};

export type EventoNot = {
  id: string;
  autor: string;
  em: number;
  acao: string;
  mudancas: { campo: string; de: string | null; para: string | null }[];
};

export type ReuniaoNot = {
  id: string;
  title: string;
  date: string;
  status: string;
  reportStatus?: string;
  createdBy?: string;
};

export type PropostaNot = {
  id: string;
  meetingId: string;
  status: string;
  proposta: { title: string };
  decisao?: { por: string; em?: number; cardId?: string };
  sectorAlvo: string;
};

export type Notificacao = {
  id: string;
  /** Nome do ícone em `icons.tsx`. */
  icone: string;
  titulo: string;
  detalhe: string;
  /** Milissegundos; 0 = sem data conhecida. */
  em: number;
  href: string;
};

/** Teto da lista de novidades. A lateral não é o histórico. */
export const LIMITE_NOVIDADES = 20;

/**
 * Quantos cards da pessoa têm o histórico consultado.
 *
 * Cada card é uma leitura própria (o histórico é subcoleção, e não há índice
 * que junte os eventos por responsável). Os 15 mais recentes cobrem o que
 * cabe numa lateral; a pessoa com 80 demandas abertas não precisa de 80
 * leituras a cada vez que abre o app.
 */
export const LIMITE_CARDS_CONSULTADOS = 15;

const mesmoEmail = (a: string | null | undefined, b: string) =>
  !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

export function ehMinha(card: CardNot, email: string): boolean {
  return mesmoEmail(card.assignee, email) || mesmoEmail(card.createdBy, email);
}

const ACAO_TEXTO: Record<string, string> = {
  criada: "criou a demanda",
  editada: "editou a demanda",
  movida: "moveu a demanda",
  excluida: "mandou a demanda para a lixeira",
  restaurada: "restaurou a demanda",
  "conclusao-pedida": "pediu a conclusão",
  "conclusao-aprovada": "aprovou a conclusão",
  "conclusao-recusada": "recusou a conclusão",
  transferida: "transferiu a demanda de setor",
  fundida: "juntou outra demanda a esta",
  absorvida: "juntou esta demanda a outra",
};

const ACAO_ICONE: Record<string, string> = {
  movida: "kanban",
  "conclusao-aprovada": "check",
  "conclusao-recusada": "x",
  excluida: "trash",
  transferida: "users",
};

/** "Ana moveu a demanda para Em andamento" — o nome entra por quem chama. */
export function textoDoEvento(e: EventoNot): string {
  const base = ACAO_TEXTO[e.acao] ?? "atualizou a demanda";
  const destino = e.mudancas.find((m) =>
    e.acao === "movida" ? m.campo === "coluna" : m.campo === "setor",
  )?.para;
  if ((e.acao === "movida" || e.acao === "transferida") && destino) {
    return `${base} para ${destino}`;
  }
  return base;
}

export function hrefDoCard(c: { id: string; sector: string }): string {
  return `/kanban?setor=${encodeURIComponent(c.sector)}&card=${encodeURIComponent(c.id)}`;
}

/** Os cards cujo histórico vale consultar, mais novos primeiro. */
export function cardsParaConsultar<C extends CardNot & { enteredAt?: number; createdAt?: { seconds: number } | null }>(
  cards: C[],
  email: string,
): C[] {
  const recencia = (c: C) =>
    Math.max(c.enteredAt ?? 0, (c.createdAt?.seconds ?? 0) * 1000);
  return cards
    .filter((c) => ehMinha(c, email))
    .sort((a, b) => recencia(b) - recencia(a))
    .slice(0, LIMITE_CARDS_CONSULTADOS);
}

/**
 * As reuniões da pessoa que esperam por ela.
 *
 * "Esperando" é a mesma conta da tela de Relatórios IA (`resolvida`, em
 * `relatorios/page.tsx`): processada, e com a ata ainda não validada OU com
 * proposta de demanda ainda sem decisão. Contar diferente daqui faria a
 * lateral dizer "pendente" de algo que a tela de Relatórios já dá por
 * resolvido — e a pessoa clicaria para não achar nada.
 */
export function pendencias(
  email: string,
  reunioes: ReuniaoNot[],
  propostas: PropostaNot[],
): Notificacao[] {
  const out: Notificacao[] = [];
  for (const r of reunioes) {
    if (!mesmoEmail(r.createdBy, email) || r.status !== "processado") continue;
    const abertas = propostas.filter(
      (p) => p.meetingId === r.id && p.status === "pendente",
    ).length;
    const ataAberta = (r.reportStatus ?? "rascunho") !== "validada";
    if (!ataAberta && abertas === 0) continue;
    const partes: string[] = [];
    if (ataAberta) partes.push("ata para validar");
    if (abertas) partes.push(`${abertas} demanda${abertas > 1 ? "s" : ""} para decidir`);
    out.push({
      id: `validar:${r.id}`,
      icone: "relatorios",
      titulo: r.title || "Reunião sem título",
      detalhe: partes.join(" · "),
      em: Date.parse(`${r.date}T12:00:00`) || 0,
      href: `/relatorios?reuniao=${encodeURIComponent(r.id)}`,
    });
  }
  return out.sort((a, b) => b.em - a.em);
}

/**
 * O que os OUTROS fizeram nas coisas da pessoa, mais recente primeiro.
 *
 * `nomeDe` traduz o e-mail do autor para o nome — fica do lado de quem chama
 * porque o cadastro de pessoas vem do banco.
 */
export function novidades(args: {
  email: string;
  cards: CardNot[];
  eventos: Map<string, EventoNot[]>;
  reunioes: ReuniaoNot[];
  propostas: PropostaNot[];
  nomeDe: (email: string) => string;
}): Notificacao[] {
  const { email, cards, eventos, reunioes, propostas, nomeDe } = args;
  const out: Notificacao[] = [];

  for (const c of cards) {
    if (!ehMinha(c, email)) continue;
    for (const e of eventos.get(c.id) ?? []) {
      if (mesmoEmail(e.autor, email)) continue;
      out.push({
        id: `evento:${c.id}:${e.id}`,
        icone: ACAO_ICONE[e.acao] ?? "edit",
        titulo: c.title || "Demanda sem título",
        detalhe: `${nomeDe(e.autor)} ${textoDoEvento(e)}`,
        em: e.em,
        href: hrefDoCard(c),
      });
    }
  }

  // A proposta tirada da reunião da pessoa foi decidida por OUTRA pessoa: é
  // assim que quem registrou a reunião fica sabendo que o assunto virou
  // demanda — o card nasce com `createdBy` de quem aceitou, e não dela.
  const minhas = new Set(
    reunioes.filter((r) => mesmoEmail(r.createdBy, email)).map((r) => r.id),
  );
  for (const p of propostas) {
    if (!minhas.has(p.meetingId) || !p.decisao) continue;
    if (p.status !== "aceita" && p.status !== "recusada") continue;
    if (mesmoEmail(p.decisao.por, email)) continue;
    const aceita = p.status === "aceita";
    out.push({
      id: `proposta:${p.id}`,
      icone: aceita ? "check" : "x",
      titulo: p.proposta.title || "Demanda proposta",
      detalhe: `${nomeDe(p.decisao.por)} ${aceita ? "aceitou a demanda da sua reunião" : "recusou a demanda da sua reunião"}`,
      em: p.decisao.em ?? 0,
      href:
        aceita && p.decisao.cardId
          ? hrefDoCard({ id: p.decisao.cardId, sector: p.sectorAlvo })
          : `/relatorios?reuniao=${encodeURIComponent(p.meetingId)}`,
    });
  }

  return out.sort((a, b) => b.em - a.em).slice(0, LIMITE_NOVIDADES);
}

/** Quantas novidades chegaram depois da última vez que a pessoa olhou. */
export function naoVistas(lista: Notificacao[], vistoAte: number): number {
  return lista.filter((n) => n.em > vistoAte).length;
}

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", "12/09". */
export function quando(em: number, agora: number): string {
  if (!em) return "";
  const min = Math.floor((agora - em) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  const dt = new Date(em);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
