/**
 * "Esta demanda está atrasada?" — uma vez só, no app inteiro.
 *
 * Módulo puro (AGENTS.md §4). O único import é `datas`, que também é puro.
 *
 * POR QUE ELE EXISTE. A decisão estava escrita à mão dentro de `dueInfo`, em
 * `kanban/page.tsx` — a função que pinta o selo de prazo do card. A árvore de
 * dimensões precisa exatamente da mesma decisão para dizer que um galho está
 * vermelho, e reimplementá-la produziria o pior defeito deste tipo: o card
 * dizendo "entregue" em verde e o galho acima dele dizendo "tem atrasada" em
 * vermelho, sobre a MESMA demanda, cada um com o seu jeito de comparar data.
 * É o mesmo motivo, e o mesmo remédio, de `entregas-core`.
 *
 * A REGRA, em uma linha: demanda entregue não atrasa. O prazo pode ter passado
 * DEPOIS de o trabalho terminar, e pintar isso de vermelho cobra uma entrega já
 * feita. Quem responde "está entregue?" continua sendo `colunasEntregues`, do
 * lado de lá; aqui só entra o veredito já pronto.
 */
import { parseISO } from "./datas.ts";

/** aaaa-mm-dd → `Date` no fuso local, no início daquele dia. */
export const parseDue = parseISO;

/** `Date` → "13/07". */
export function fmtShort(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/**
 * Meia-noite do dia de `ms`.
 *
 * Existe para as contas de prazo não dependerem da HORA. Sem isto, a mesma
 * demanda com prazo para hoje seria "em dia" às 9h e "atrasada" às 15h, porque
 * a subtração de dois instantes arredonda para baixo.
 */
export function inicioDoDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** aaaa-mm-dd → ms do início daquele dia, no fuso local. */
export function msDaData(iso: string): number {
  return parseISO(iso).getTime();
}

/**
 * O veredito, sozinho — sem rótulo, sem cor, sem tela.
 *
 * `agora` é parâmetro com padrão, e não `Date.now()` chumbado, para o teste
 * poder fixar o dia. Regra de prazo testada com o relógio de quem roda o teste
 * passa em agosto e reprova em setembro.
 */
export function estaAtrasada(
  due: string | null | undefined,
  entregue: boolean,
  agora: number = Date.now(),
): boolean {
  if (entregue || !due) return false;
  return msDaData(due) < inicioDoDia(agora);
}

export type TomDoPrazo = "late" | "soon" | "ok" | "none" | "done";

/**
 * O selo de prazo do card: o que escrever e de que cor.
 *
 * Demanda aceita a partir de uma reunião entra SEM PRAZO de propósito — a fila
 * de validação não exige datas para não virar uma fila que ninguém abre. Sem o
 * tom `none`, ela ficaria visualmente igual a uma demanda com tudo em dia.
 */
export function dueInfo(
  due: string | null | undefined,
  entregue: boolean | undefined,
  agora: number = Date.now(),
): { label: string; tone: TomDoPrazo } | null {
  if (!due) return { label: "sem prazo definido", tone: "none" };
  const d = parseDue(due);
  if (entregue) return { label: `entregue · ${fmtShort(d)}`, tone: "done" };
  const diff = Math.round((d.getTime() - inicioDoDia(agora)) / 86400000);
  const tone: "late" | "soon" | "ok" =
    diff < 0 ? "late" : diff <= 3 ? "soon" : "ok";
  let label: string;
  if (diff === 0) label = "Hoje";
  else if (diff === 1) label = "Amanhã";
  else if (diff === -1) label = "Ontem";
  else if (diff < 0) label = `${Math.abs(diff)}d atrás`;
  else label = fmtShort(d);
  return { label, tone };
}

/**
 * Há quantos dias a demanda não sai do lugar.
 *
 * CONTA PERÍODOS DE 24 HORAS CORRIDAS, e não viradas de meia-noite. Isto está
 * escrito aqui porque é a única coisa neste arquivo que NÃO segue o critério de
 * `inicioDoDia` logo acima — e é de propósito: é o comportamento que o selo
 * "parado" do card já tem em produção, e trocá-lo de carona numa extração faria
 * milhares de cards ganharem um dia da noite para o dia, sem ninguém ter pedido.
 * A árvore conta pelo calendário, que é o certo para "sem movimento há N dias"
 * numa leitura de gestão; as duas contas convivem porque respondem a perguntas
 * diferentes, e esta é a que já foi ao ar.
 *
 * Zero — e não `null` — sem `enteredAt`: o card só mostra o selo a partir de um
 * dia, então zero apaga o selo. Quem precisa distinguir "mexeram hoje" de "não
 * se sabe" é a árvore, e ela olha `enteredAt` direto.
 */
export function agingDays(
  enteredAt: number | undefined,
  agora: number = Date.now(),
): number {
  if (!enteredAt) return 0;
  return Math.max(0, Math.floor((agora - enteredAt) / 86400000));
}
