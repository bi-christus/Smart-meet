/**
 * O andamento de cada produto do Portfólio — sem o banco (#209).
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * assina cards, colunas e produtos é a tela; o que mora aqui é a CONTA, e é ela
 * que `scripts/test-produtos.mjs` confere em Node puro.
 *
 * O QUE ISTO RESPONDE, e para quem. O Portfólio é acesso rápido ao que o setor
 * desenvolveu, e muito do que está lá é anterior ao Smart Meeting — nunca teve
 * demanda nenhuma. Para esses, a resposta certa é NADA: nenhum selo, nenhuma
 * barra vazia. Só o produto com demanda ABERTA ganha um selo, e é por isso que
 * `andamentoPorProduto` simplesmente não devolve entrada para o produto parado.
 *
 * NENHUMA REGRA É COPIADA. "Está atrasada?" e "está quase vencendo?" são o
 * mesmo selo de prazo do card (`dueInfo`, em `prazo-core`); "foi entregue?" é a
 * mesma régua do app inteiro (`ehEntrega`, em `entregas-core`). Uma cópia aqui
 * produziria o defeito que esses dois módulos existem para impedir: o card
 * verde no quadro e o produto vermelho no Portfólio, sobre a mesma demanda.
 *
 * NÃO HÁ CONTADOR GRAVADO. O andamento é calculado na tela a partir das demandas
 * do setor, que o app já assina. Um número gravado no produto teria de ser
 * mantido em dia a cada escrita de card, e sincronia que apodrece calada é o
 * pior tipo de número numa tela de gestão.
 */
import { ehEntrega, type CardContavel, type EntreguePorSetor } from "./entregas-core.ts";
import { dueInfo } from "./prazo-core.ts";

/** O recorte de card que o andamento lê. */
export type CardDoProduto = CardContavel & {
  id: string;
  title: string;
  produtoId?: string | null;
  due?: string | null;
  /** Quando entrou na etapa atual (ms) — numa coluna de entrega, É a entrega. */
  enteredAt?: number | null;
};

/**
 * A saúde do produto, na ordem da gravidade.
 *
 * - `atrasada`: alguma demanda aberta passou do prazo.
 * - `atencao`: nenhuma atrasada, mas alguma vence em até 3 dias — o mesmo
 *   "soon" do selo do card.
 * - `em-dia`: o resto, inclusive demanda aberta sem prazo. Sem prazo não é
 *   atraso: o selo do card já diz "sem prazo definido", e repetir isso no
 *   Portfólio em vermelho cobraria uma data que ninguém prometeu.
 */
export type SaudeDoProduto = "atrasada" | "atencao" | "em-dia";

export const SAUDE_ROTULO: Record<SaudeDoProduto, string> = {
  atrasada: "atrasada",
  atencao: "prazo próximo",
  "em-dia": "em dia",
};

export type EtapaDoProduto = { colId: string; title: string; n: number };

export type AndamentoDoProduto = {
  produtoId: string;
  /** Demandas abertas (não entregues) do produto. Nunca zero — ver o cabeçalho. */
  abertas: number;
  atrasadas: number;
  saude: SaudeDoProduto;
  /** Onde as abertas estão, na ordem do quadro; etapa sem demanda não entra. */
  porEtapa: EtapaDoProduto[];
  /** As abertas com prazo, do mais próximo para o mais distante. */
  proximosPrazos: CardDoProduto[];
  /** As entregues, da mais recente para a mais antiga. */
  entregues: CardDoProduto[];
};

/**
 * O andamento de cada produto com demanda aberta.
 *
 * `colunas` vem NA ORDEM DO QUADRO, com o `colId` de cada etapa — é ela que
 * ordena `porEtapa`, para a gaveta contar da entrada para a entrega. Etapa
 * desconhecida (card numa coluna que foi apagada) vai para o fim, com o próprio
 * id como nome, em vez de sumir: demanda que some da contagem é demanda que
 * some da gestão.
 */
export function andamentoPorProduto(args: {
  cards: readonly CardDoProduto[];
  colunas: readonly { colId: string; title: string }[];
  entregues: EntreguePorSetor;
  /** Milissegundos — entra por parâmetro para o teste fixar o dia. */
  agora: number;
}): Map<string, AndamentoDoProduto> {
  const { cards, colunas, entregues, agora } = args;
  const ordem = new Map(colunas.map((c, i) => [c.colId, i]));
  const titulo = new Map(colunas.map((c) => [c.colId, c.title]));

  const porProduto = new Map<string, CardDoProduto[]>();
  cards.forEach((c) => {
    const p = (c.produtoId ?? "").trim();
    if (!p) return;
    const lista = porProduto.get(p);
    if (lista) lista.push(c);
    else porProduto.set(p, [c]);
  });

  const out = new Map<string, AndamentoDoProduto>();
  porProduto.forEach((lista, produtoId) => {
    const abertas = lista.filter((c) => !ehEntrega(c, entregues));
    if (abertas.length === 0) return;

    let atrasadas = 0;
    let proximas = 0;
    abertas.forEach((c) => {
      const tom = dueInfo(c.due, false, agora)?.tone;
      if (tom === "late") atrasadas++;
      else if (tom === "soon") proximas++;
    });

    const contagem = new Map<string, number>();
    abertas.forEach((c) => contagem.set(c.columnId, (contagem.get(c.columnId) ?? 0) + 1));
    const porEtapa = [...contagem.entries()]
      .map(([colId, n]) => ({ colId, title: titulo.get(colId) ?? colId, n }))
      .sort(
        (a, b) =>
          (ordem.get(a.colId) ?? Number.MAX_SAFE_INTEGER) -
          (ordem.get(b.colId) ?? Number.MAX_SAFE_INTEGER),
      );

    out.set(produtoId, {
      produtoId,
      abertas: abertas.length,
      atrasadas,
      saude: atrasadas > 0 ? "atrasada" : proximas > 0 ? "atencao" : "em-dia",
      porEtapa,
      proximosPrazos: abertas
        .filter((c) => !!c.due)
        .sort((a, b) => (a.due as string).localeCompare(b.due as string)),
      entregues: lista
        .filter((c) => ehEntrega(c, entregues))
        .sort((a, b) => (b.enteredAt ?? 0) - (a.enteredAt ?? 0)),
    });
  });
  return out;
}

/**
 * "3 em andamento" / "1 em andamento" — o texto do selo.
 *
 * "Em andamento" e não "abertas": quem abre o Portfólio pergunta se tem gente
 * trabalhando naquilo, e "aberta" é vocabulário do quadro.
 */
export function rotuloDoSelo(a: Pick<AndamentoDoProduto, "abertas">): string {
  return `${a.abertas} em andamento`;
}
