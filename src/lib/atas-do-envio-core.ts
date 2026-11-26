/**
 * Quais documentos saem de cada áudio — a escolha que viaja até o Drive como
 * a etiqueta `smGerar` e que o motor da nuvem (vigia-smart-meet,
 * `resolverGerar`) lê para decidir o que gerar.
 *
 * Módulo puro (AGENTS.md §4): sem SDK e sem alias "@/", porque o teste
 * (scripts/test-atas-do-envio.mjs) o importa pelo strip de tipos do Node. E
 * porque três pontas precisam concordar com ele: o modal "Registrar reunião",
 * a rota que abre a sessão de envio (`api/drive/upload-url`) e a rota que
 * renomeia (`api/drive/rename`). Com uma lista em cada ponta, a primeira que
 * divergisse gravaria no Drive um valor que o motor não conhece — e ele não
 * reclama: só deixa de gerar a ata, calado.
 */

/**
 * O que a pessoa pode pedir. A transcrição NÃO está aqui de propósito: ela é
 * infraestrutura (sai sempre, é dela que todo o resto nasce) e o motor nem a
 * procura no `smGerar`. A pauta também não: a nuvem nunca a gerou (Issue #251),
 * e pô-la aqui prometeria um documento que não chega.
 */
export const ATAS_CONHECIDAS = ["resumo", "detalhada", "didatica"] as const;
export type AtaDoEnvio = (typeof ATAS_CONHECIDAS)[number];

/**
 * O padrão nasce com a Ata detalhada MARCADA.
 *
 * Com só "resumo", o motor gera transcrição e Pontos importantes e mais nada —
 * e as pessoas esqueciam de marcar a detalhada: no banco, ela foi pedida em 45
 * de 93 reuniões (Issue #248). A escolha do Ítalo foi inverter o ônus: quem não
 * quer a detalhada desmarca. Deixar como estava e "lembrar melhor" foi
 * descartado porque é exatamente o que já não funcionava.
 *
 * Congelado porque é compartilhado: quem precisar de uma lista para mexer
 * (estado de tela) passa por `normalizarEscolha`, que devolve uma cópia.
 */
export const ATAS_PADRAO: readonly AtaDoEnvio[] = Object.freeze([
  "resumo",
  "detalhada",
]);

export function ehAtaConhecida(v: unknown): v is AtaDoEnvio {
  return (
    typeof v === "string" && (ATAS_CONHECIDAS as readonly string[]).includes(v)
  );
}

/**
 * A forma única da escolha: só valores da lista fechada, sem repetir,
 * "resumo" sempre presente e primeiro, o resto na ordem da lista.
 *
 * Ordem da LISTA, e não a ordem em que a pessoa clicou: a mesma escolha tem de
 * virar sempre o mesmo `smGerar`, senão "resumo,didatica,detalhada" e
 * "resumo,detalhada,didatica" parecem pedidos diferentes para quem compara.
 *
 * Valor desconhecido é DESCARTADO, não recusado: a escolha anda junto do
 * áudio, e derrubar o envio (ou o título) por causa de um rótulo estranho
 * perderia o que importa por causa do que não importa. Pelo mesmo motivo,
 * entrada que não é lista vira só "resumo" — o mínimo que sempre sai. O
 * padrão com a detalhada é decisão da TELA (`ATAS_PADRAO`), não desta
 * normalização: aqui não se inventa pedido que ninguém fez.
 */
export function normalizarEscolha(entrada: unknown): AtaDoEnvio[] {
  const pedidas = new Set<AtaDoEnvio>(["resumo"]);
  if (Array.isArray(entrada)) {
    for (const v of entrada) if (ehAtaConhecida(v)) pedidas.add(v);
  }
  return ATAS_CONHECIDAS.filter((a) => pedidas.has(a));
}

/** Marca ou desmarca uma ata. "resumo" tem cadeado: alternar não o tira. */
export function alternarAta(
  escolha: readonly AtaDoEnvio[],
  ata: AtaDoEnvio,
): AtaDoEnvio[] {
  if (ata === "resumo") return normalizarEscolha(escolha);
  return normalizarEscolha(
    escolha.includes(ata)
      ? escolha.filter((a) => a !== ata)
      : [...escolha, ata],
  );
}

/** O valor exato que vai para `properties.smGerar` no arquivo do Drive. */
export function paraSmGerar(entrada: unknown): string {
  return normalizarEscolha(entrada).join(",");
}
