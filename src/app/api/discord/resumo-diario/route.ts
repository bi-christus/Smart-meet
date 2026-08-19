/**
 * O resumo do dia no Discord — uma mensagem por setor, uma vez por dia.
 *
 * POR QUE ELE EXISTE, se todo evento já vira aviso. Porque o que dói não é o
 * evento: é a AUSÊNCIA dele. Demanda que venceu na sexta e ninguém tocou não
 * gera evento nenhum — ela some do canal justamente por estar parada. O aviso
 * por evento conta o que aconteceu; este é o único que conta o que não
 * aconteceu.
 *
 * DOIS DISPAROS, UM CAMINHO SÓ, como em `api/recorrencias/gerar`:
 *  - o cron da Vercel, de manhã (cabeçalho com CRON_SECRET);
 *  - um gestor ou admin chamando à mão, para conferir sem esperar amanhã.
 *
 * O "hoje" sai de `hojeNoFuso` (`lib/datas.ts`), no fuso da Rede e não no do
 * servidor. A função roda em UTC, e às 22h de Fortaleza já é o dia seguinte lá:
 * um hoje cru marcaria como atrasada a demanda que vence hoje, no dia em que
 * ela ainda pode ser entregue.
 *
 * LÊ TODOS OS CARDS DE UMA VEZ, e a escolha é consciente. Uma consulta por
 * setor exigiria saber a lista de setores antes de perguntar — e setor que
 * ainda não personalizou colunas não aparece em `/columns`, então a lista sairia
 * incompleta e o setor ficaria sem resumo sem ninguém perceber. Com o quadro do
 * tamanho de hoje isto é uma leitura por dia. Se um dia crescer, o lugar de
 * paginar é aqui, e o sintoma será tempo de função, não resumo faltando.
 */
import { NextResponse } from "next/server";

import { HttpError, adminDb, requireUser } from "@/lib/server/drive-server";
import { DEFAULT_COLUMNS, colunasEntregues } from "@/lib/kanban-columns";
import { hojeNoFuso } from "@/lib/datas";
import { naLixeira } from "@/lib/lixeira-core";
import { publicarResumoDiario } from "@/lib/server/discord-aviso";
import type { CardDoResumo } from "@/lib/discord-core";

export const runtime = "nodejs";

type CardDoc = {
  sector?: string;
  title?: string;
  columnId?: string;
  assignee?: string | null;
  due?: string | null;
  deletedAt?: number | null;
};

async function executar(req: Request) {
  const authz = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;

  // `null` = todos os setores.
  let setores: string[] | null;
  if (cronSecret && authz === `Bearer ${cronSecret}`) {
    setores = null;
  } else {
    const caller = await requireUser(req);
    if (caller.role !== "admin" && caller.role !== "gestor") {
      throw new HttpError(403, "Só gestor ou admin pode disparar o resumo.");
    }
    setores = caller.role === "admin" ? null : caller.sectors;
  }

  const db = adminDb();
  const [cardsSnap, colsSnap, usersSnap] = await Promise.all([
    db.collection("cards").get(),
    db.collection("columns").get(),
    db.collection("users").get(),
  ]);

  // Nome de gente, para o resumo não listar e-mail. Uma leitura, não uma por
  // card: o mesmo punhado de responsáveis se repete no quadro inteiro.
  const nomes = new Map<string, string>();
  usersSnap.forEach((d) => {
    const nome = (d.data() as { name?: string }).name?.trim();
    nomes.set(d.id.toLowerCase(), nome || d.id);
  });

  // Colunas por setor, NA ORDEM DO QUADRO — `colunasEntregues` depende dela
  // para saber qual é a última, e a última é uma das duas fontes do que conta
  // como entregue.
  type Coluna = { colId: string; title: string; order: number };
  const colunasPorSetor = new Map<string, Coluna[]>();
  colsSnap.forEach((d) => {
    const c = d.data() as {
      sector?: string;
      colId?: string;
      title?: string;
      order?: number;
    };
    const setor = (c.sector ?? "").trim();
    if (!setor || !c.colId) return;
    const lista = colunasPorSetor.get(setor) ?? [];
    lista.push({
      colId: String(c.colId),
      title: String(c.title ?? c.colId),
      order: c.order ?? 0,
    });
    colunasPorSetor.set(setor, lista);
  });
  for (const lista of colunasPorSetor.values()) {
    lista.sort((a, b) => a.order - b.order);
  }

  const porSetor = new Map<string, CardDoResumo[]>();
  cardsSnap.forEach((d) => {
    const c = d.data() as CardDoc;
    const setor = (c.sector ?? "").trim();
    if (!setor) return;
    if (setores && !setores.includes(setor)) return;
    // Demanda na lixeira não é demanda aberta. A regra é a do app inteiro
    // (`lixeira-core`), e não um `!!deletedAt` escrito de novo aqui.
    if (naLixeira(c)) return;

    const colunas =
      colunasPorSetor.get(setor) ??
      DEFAULT_COLUMNS.map((k, i) => ({
        colId: k.id,
        title: k.title,
        order: i,
      }));
    const entregues = colunasEntregues(
      colunas.map((k) => ({ id: k.colId, title: k.title })),
    );
    const etapa =
      colunas.find((k) => k.colId === c.columnId)?.title ?? null;
    const email = (c.assignee ?? "").trim().toLowerCase();

    const lista = porSetor.get(setor) ?? [];
    lista.push({
      id: d.id,
      title: c.title ?? "",
      responsavel: email ? (nomes.get(email) ?? email) : null,
      prazo: c.due ?? null,
      etapa,
      entregue: entregues.has(String(c.columnId ?? "")),
    });
    porSetor.set(setor, lista);
  });

  const hoje = hojeNoFuso();
  const saida: Record<string, string> = {};
  for (const [setor, cards] of porSetor) {
    // Um setor com webhook errado não pode calar os outros: o resumo de cada um
    // é independente, e derrubar a rodada inteira por causa de uma URL colada
    // torta seria trocar quatro resumos por nenhum.
    try {
      const r = await publicarResumoDiario({ sector: setor, cards, hoje });
      saida[setor] = r.enviado ? "enviado" : (r.motivo ?? "nao-enviado");
    } catch (e) {
      console.warn("discord: resumo do dia não saiu para", setor, e);
      saida[setor] = "falhou";
    }
  }

  return NextResponse.json({ hoje, setores: saida });
}

/** Disparo do cron da Vercel (GET com o CRON_SECRET no cabeçalho). */
export async function GET(req: Request) {
  return responder(req);
}

/** Disparo à mão, por gestor ou admin. */
export async function POST(req: Request) {
  return responder(req);
}

async function responder(req: Request) {
  try {
    return await executar(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    if (status >= 500) console.error("discord/resumo-diario:", e);
    return NextResponse.json({ error: message }, { status });
  }
}
