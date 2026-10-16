/**
 * As divisões da barra lateral — quais abas andam juntas.
 *
 * Módulo puro (AGENTS.md §4), testado em `scripts/test-navegacao.mjs`.
 *
 * QUEM ENXERGA O QUÊ CONTINUA SENDO DE `permissoes-core.ts`. Este módulo não
 * decide acesso: recebe a lista que `abasVisiveis` já filtrou e só a agrupa.
 * Se a divisão perguntasse de novo quem pode ver, seriam duas regras de acesso
 * para manter iguais — e a primeira vez que divergissem, uma pílula apareceria
 * para quem o guarda de rota barra.
 *
 * Por que divisões, e não as dez abas lado a lado (16/10/2026, #237): com todas
 * no topo, todas tinham o mesmo peso, e em tela média as últimas sumiam na
 * rolagem. Agrupadas por necessidade de uso, a lateral fica com cinco portas e
 * o topo mostra só os módulos da porta aberta.
 */

/** Uma porta da barra lateral. */
export type Divisao = {
  id: string;
  label: string;
  /** Nome do ícone em `icons.tsx`. */
  icone: string;
  /** Ids de `ABAS`, na ordem em que as pílulas aparecem no topo. */
  abas: string[];
  /**
   * `true` = vai para o pé da lateral, separado das outras. Só Configurações:
   * é a porta que quase ninguém abre, e no meio das de uso diário ela pesaria
   * igual a elas.
   */
  rodape?: boolean;
};

export const DIVISOES: Divisao[] = [
  { id: "inicio", label: "Início", icone: "inicio", abas: ["inicio"] },
  // Sozinho, e logo depois do Início: é a vitrine dos sistemas, e não tem
  // parentesco de uso com nenhum outro módulo.
  { id: "portfolio", label: "Portfólio", icone: "links", abas: ["links"] },
  // O caminho da reunião: grava, vira ata, e a IA escreve o relatório.
  {
    id: "reunioes",
    label: "Reuniões",
    icone: "reunioes",
    abas: ["reunioes", "ata", "relatorios"],
  },
  // As demandas do setor e tudo que se mede a partir delas.
  {
    id: "gestao",
    label: "Gestão",
    icone: "kanban",
    abas: ["kanban", "dashboard", "cronograma", "rank"],
  },
  {
    id: "configuracoes",
    label: "Configurações",
    icone: "config",
    abas: ["admin"],
    rodape: true,
  },
];

/** O pedaço de `Aba` que a navegação usa — evita importar o tipo inteiro. */
type AbaNav = { id: string; label: string; href: string };

export type DivisaoVisivel<A extends AbaNav = AbaNav> = Divisao & {
  /** Só as abas que a pessoa enxerga, na ordem da divisão. */
  visiveis: A[];
  /** Para onde o link da lateral leva: a primeira aba visível. */
  href: string;
};

/**
 * As divisões que esta pessoa enxerga.
 *
 * Divisão sem nenhuma aba visível SOME, em vez de aparecer levando a uma tela
 * de "sem acesso": uma porta que só se abre para dizer "não" é ruído na
 * lateral de quem nunca vai poder entrar.
 */
export function divisoesVisiveis<A extends AbaNav>(
  abas: A[],
): DivisaoVisivel<A>[] {
  const porId = new Map(abas.map((a) => [a.id, a]));
  const out: DivisaoVisivel<A>[] = [];
  for (const d of DIVISOES) {
    const visiveis = d.abas
      .map((id) => porId.get(id))
      .filter((a): a is A => !!a);
    if (visiveis.length) out.push({ ...d, visiveis, href: visiveis[0].href });
  }
  return out;
}

/** A divisão a que uma aba pertence. */
export function divisaoDaAba(abaId: string): Divisao | undefined {
  return DIVISOES.find((d) => d.abas.includes(abaId));
}
