/**
 * O que os comandos de consulta leem do banco.
 *
 * A outra metade — a que decide o que se escreve — é `discord-consulta-core.ts`:
 * módulo puro, com teste no `prebuild`. Aqui há Firestore, lá não há.
 *
 * TRÊS SEGUNDOS. É o prazo do Discord para a resposta da interação, e é ele que
 * manda em tudo neste arquivo. Por isso:
 *
 *  - a consulta de cards é por campo ÚNICO (`assignee` ou `sector`), que o
 *    Firestore indexa sozinho — consulta composta aqui custaria índice novo e,
 *    pior, um erro em produção no dia em que alguém esquecesse de criá-lo;
 *  - o teto de documentos é baixo e explícito. A lista mostra dez linhas; ler
 *    quinhentos documentos para escolher dez é gastar o orçamento de tempo com
 *    o que nunca vai aparecer;
 *  - nada aqui chama a rede além do Firestore.
 *
 * O RISCO QUE FICA, dito na cara: cold start de função serverless com o
 * `firebase-admin` pode passar de um segundo, e nos três segundos isso é muito.
 * É o mesmo risco que `/vincular` já corre desde o começo. Se aparecer
 * "interação falhou" com frequência, a saída é a resposta adiada do Discord
 * (`type: 5`) — e ela exige uma segunda chamada depois de responder, que numa
 * função que morre ao responder pede `waitUntil`. É trabalho, e não estava
 * pago; a nota fica aqui para quem for pagar.
 */
import type { Firestore } from "firebase-admin/firestore";

import { DEFAULT_COLUMNS, colunasEntregues } from "@/lib/kanban-columns";
import { naLixeira } from "@/lib/lixeira-core";
import type { DemandaNaConsulta } from "@/lib/discord-consulta-core";

/** Teto de documentos por consulta. Ver a nota dos três segundos, acima. */
const TETO_DOCS = 120;

type CardDoc = {
  sector?: string;
  title?: string;
  columnId?: string;
  assignee?: string | null;
  due?: string | null;
  deletedAt?: number | null;
};

/** Quem é esta conta do Discord no Smart Meet. `null` = ninguém (não vinculou). */
export async function cadastroDe(
  db: Firestore,
  discordId: string,
): Promise<{ email: string; sectors: string[] } | null> {
  const achados = await db
    .collection("users")
    .where("discordId", "==", discordId)
    .limit(1)
    .get();
  if (achados.empty) return null;

  const d = achados.docs[0];
  const dados = d.data() as { sectors?: string[]; active?: boolean };
  if (dados.active !== true) return null;
  return { email: d.id, sectors: dados.sectors ?? [] };
}

/** Colunas do setor, na ordem do quadro. Setor sem colunas cai no padrão. */
async function colunasDo(
  db: Firestore,
  sector: string,
): Promise<{ id: string; title: string }[]> {
  const snap = await db
    .collection("columns")
    .where("sector", "==", sector)
    .get();
  if (snap.empty)
    return DEFAULT_COLUMNS.map((c) => ({ id: c.id, title: c.title }));
  return snap.docs
    .map((d) => d.data() as { colId?: string; title?: string; order?: number })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => ({ id: String(c.colId ?? ""), title: String(c.title ?? c.colId ?? "") }))
    .filter((c) => c.id);
}

function paraConsulta(
  id: string,
  c: CardDoc,
  colunas: { id: string; title: string }[],
  entregues: Set<string>,
  nomes: Map<string, string>,
): DemandaNaConsulta {
  const email = (c.assignee ?? "").trim().toLowerCase();
  return {
    id,
    sector: (c.sector ?? "").trim(),
    title: c.title ?? "",
    etapa: colunas.find((k) => k.id === c.columnId)?.title ?? null,
    prazo: c.due ?? null,
    responsavel: email ? (nomes.get(email) ?? email) : null,
    entregue: entregues.has(String(c.columnId ?? "")),
  };
}

/** As demandas de uma pessoa, por e-mail. Já sem as que estão na lixeira. */
export async function demandasDe(
  db: Firestore,
  email: string,
): Promise<DemandaNaConsulta[]> {
  const snap = await db
    .collection("cards")
    .where("assignee", "==", email)
    .limit(TETO_DOCS)
    .get();
  if (snap.empty) return [];

  // As colunas são lidas uma vez por setor, e não uma por card: a pessoa quase
  // sempre tem demanda de um setor só, e mesmo com dois são duas consultas.
  const setores = [
    ...new Set(
      snap.docs.map((d) => ((d.data() as CardDoc).sector ?? "").trim()),
    ),
  ].filter(Boolean);
  const colunasPorSetor = new Map(
    await Promise.all(
      setores.map(
        async (s) => [s, await colunasDo(db, s)] as [string, { id: string; title: string }[]],
      ),
    ),
  );

  return snap.docs
    .map((d) => {
      const c = d.data() as CardDoc;
      const colunas = colunasPorSetor.get((c.sector ?? "").trim()) ?? [];
      return { d, c, colunas };
    })
    .filter(({ c }) => !naLixeira(c))
    .map(({ d, c, colunas }) =>
      paraConsulta(d.id, c, colunas, colunasEntregues(colunas), new Map()),
    );
}

/**
 * As demandas de um setor, para a busca por título.
 *
 * A busca por texto acontece EM MEMÓRIA, e é escolha: o Firestore não faz
 * "contém" — só prefixo. Buscar por prefixo devolveria nada para quem digita a
 * segunda palavra do título, que é o caso comum ("refeitório" em "Painel de
 * consumo do refeitório"). Com o quadro do tamanho de hoje, filtrar aqui é mais
 * barato do que manter um índice de texto que ninguém pediu.
 */
export async function demandasDoSetor(
  db: Firestore,
  sector: string,
): Promise<DemandaNaConsulta[]> {
  const [snap, colunas] = await Promise.all([
    db.collection("cards").where("sector", "==", sector).limit(TETO_DOCS).get(),
    colunasDo(db, sector),
  ]);
  if (snap.empty) return [];

  // Nomes de quem responde, numa leitura só — a busca mostra o responsável, e
  // e-mail no lugar do nome faz a lista parecer um dump de banco.
  const emails = [
    ...new Set(
      snap.docs
        .map((d) => ((d.data() as CardDoc).assignee ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const nomes = new Map<string, string>();
  if (emails.length) {
    const users = await db.getAll(
      ...emails.map((e) => db.collection("users").doc(e)),
    );
    users.forEach((u, i) => {
      const nome = (u.data() as { name?: string } | undefined)?.name?.trim();
      nomes.set(emails[i], nome || emails[i]);
    });
  }

  const entregues = colunasEntregues(colunas);
  return snap.docs
    .filter((d) => !naLixeira(d.data() as CardDoc))
    .map((d) =>
      paraConsulta(d.id, d.data() as CardDoc, colunas, entregues, nomes),
    );
}
