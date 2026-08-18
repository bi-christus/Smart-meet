/**
 * A moldura do avatar — o anel que cada pessoa escolhe para o próprio rosto.
 *
 * Módulo puro (AGENTS.md §4), e o mais puro de todos: SEM UM ÚNICO IMPORT. Nem
 * `firebase/firestore`, nem DOM, nem React, nem outro core. Quem grava é
 * `users.ts`; quem pinta é `avatar.module.css`. Aqui mora só a decisão.
 *
 * O TAMANHO É O DESENHO INTEIRO, e o argumento é o mesmo que `avatar-core.ts`
 * já escreveu sobre a foto: `subscribeUsers` assina a coleção `/users` INTEIRA
 * em sete telas, então todo byte gravado no documento é baixado por todo cliente
 * em toda tela. Por isso o que vai ao banco é um ID CURTO — o mais longo tem 7
 * caracteres ASCII, uns 20 bytes por pessoa — e nunca a pintura.
 *
 * Gravar o CSS ("linear-gradient(...)") seria dez vezes mais pesado, congelaria
 * a cor fora dos dois temas e dos três acentos, e — o que fecha a porta — poria
 * texto controlado pelo usuário dentro do `style` que TODO outro cliente
 * renderiza. O id vira o valor de um `data-moldura`, e a folha só tem regra para
 * os ids que ela conhece: uma moldura desconhecida não pinta nada, e é só isso
 * que ela consegue fazer.
 *
 * NENHUMA MOLDURA ANIMA, e a consequência é mais forte do que honrar
 * `prefers-reduced-motion`: não há o que reduzir. Uma moldura que gira não é
 * disparada por gesto nenhum — ela roda para sempre, quarenta pessoas podem
 * ligar a sua, e o resultado são quarenta anéis girando sozinhos na tela em que
 * se trabalha o dia inteiro. É literalmente o *AI-slop motion* de que a skill de
 * motion fala, e o AGENTS.md §3 o proíbe pelo nome.
 *
 * O QUE ACONTECE NOS TAMANHOS PEQUENOS é metade do projeto, porque o avatar
 * aparece em doze tamanhos diferentes neste app — de 16 px (chip do Cronograma)
 * a 112 px (pódio do Rank). Duas respostas, e as duas são função do tamanho:
 *
 *  - Abaixo de `MOLDURA_MIN_PX` NÃO HÁ MOLDURA NENHUMA. Em 16 px, um anel de
 *    1,5 px é 9% do diâmetro: ele tapa o rosto que o avatar existe para mostrar.
 *  - Abaixo de `LIMIAR_DETALHE_PX` a moldura SIMPLIFICA para uma cor sólida. Um
 *    degradê cônico de três paradas dentro de um anel de 2 px vira uma faixa
 *    cinza-suja, igual em todas as molduras — e um catálogo em que cinco opções
 *    são indistinguíveis no tamanho de maior frequência do app não é um
 *    catálogo, é uma configuração que não faz nada.
 *
 * E É POR ISSO QUE AS CINCO `tintaSimples` SÃO DISTINTAS ENTRE SI, o que o teste
 * exige. Fazer todas convergirem para `--brand` seria mais bonito e destruiria
 * a escolha exatamente nas telas em que ela mais aparece.
 */

/**
 * Os ids do catálogo. `"nenhuma"` é um valor de verdade, não a ausência de um:
 * é o que uma pessoa escolhe para TIRAR a moldura, e ele precisa poder ser
 * gravado — campo apagado é campo que a regra do Firestore não vê, e é a mesma
 * lição que `photo: null` já ensinou em `users.ts`.
 */
export type IdMoldura = "nenhuma" | "marca" | "mar" | "aurora" | "mata" | "traco";

export type Moldura = {
  id: IdMoldura;
  /** O rótulo do seletor. Até 16 caracteres — mais que isso quebra a grade. */
  nome: string;
  /** Uma frase, para a dica do seletor. */
  resumo: string;
  /**
   * O token do tema em que esta moldura vira quando SIMPLIFICA.
   *
   * Um por moldura, e todos DIFERENTES — é esta a garantia que impede a próxima
   * entrada do catálogo de nascer clone das outras nos tamanhos pequenos, que
   * são a maioria das aparições do avatar.
   */
  tintaSimples: "--brand" | "--info" | "--susp" | "--ok" | "--tx-3";
};

export const MOLDURA_PADRAO: IdMoldura = "nenhuma";

/**
 * O teto de caracteres do campo. É o MESMO número de `molduraOk()` em
 * `firestore.rules`, e o teste confere que os dois não se afastaram.
 *
 * Ele existe na regra não para validar o catálogo — a regra não conhece o
 * catálogo, de propósito —, mas para conter DANO DE LARGURA DE BANDA: sem teto,
 * `moldura` vira um campo de texto livre de 1 MB num documento que sete telas
 * baixam inteiro.
 */
export const LIMITE_MOLDURA_CHARS = 24;

/**
 * O alfabeto aceito, também repetido na regra.
 *
 * ASCII minúsculo pelo mesmo motivo que `fotoOk()` já documenta: 24 caracteres
 * fora do ASCII pesam até quatro vezes mais em bytes, e `size()` no CEL conta
 * caracteres, não bytes — o teto sozinho não seguraria o peso.
 */
export const ALFABETO_MOLDURA = /^[a-z][a-z0-9-]*$/;

/** Daqui para baixo a moldura vira cor sólida. Ver o cabeçalho. */
export const LIMIAR_DETALHE_PX = 34;

/** Daqui para baixo não há moldura nenhuma. Ver o cabeçalho. */
export const MOLDURA_MIN_PX = 20;

/**
 * O catálogo. `"nenhuma"` vem primeiro porque é o estado de quem nunca
 * escolheu, e a primeira célula de um seletor deve ser a saída, não uma opção.
 *
 * Cinco molduras, e nenhuma delas é dourada, prateada ou de louros: elas são
 * PERSONALIZAÇÃO, não prêmio. O que se conquista neste app são os emblemas, que
 * têm bloco próprio no perfil — e um anel dourado ao lado deles diria que a
 * pessoa ganhou algo que ela só escolheu numa lista.
 */
export const MOLDURAS: readonly Moldura[] = [
  {
    id: "nenhuma",
    nome: "Sem moldura",
    resumo: "O avatar como sempre foi, sem anel em volta.",
    // Nunca usada — `molduraDe` devolve `null` antes de chegar aqui. Existe
    // para o tipo ser total e para o catálogo ter uma forma só.
    tintaSimples: "--tx-3",
  },
  {
    id: "marca",
    nome: "Cor da casa",
    resumo: "Um anel sólido no laranja do Smart Meeting.",
    tintaSimples: "--brand",
  },
  {
    id: "mar",
    nome: "Mar",
    resumo: "Azul virando verde-água, em volta do rosto.",
    tintaSimples: "--info",
  },
  {
    id: "aurora",
    nome: "Aurora",
    resumo: "Roxo, laranja e azul, na volta inteira.",
    tintaSimples: "--susp",
  },
  {
    id: "mata",
    nome: "Mata",
    resumo: "Verde puxando para o azul.",
    tintaSimples: "--ok",
  },
  {
    id: "traco",
    nome: "Traço",
    resumo: "Um anel tracejado, discreto.",
    tintaSimples: "--tx-3",
  },
];

/** O mínimo que este módulo precisa saber de alguém. */
export type PessoaDaMoldura = { moldura?: string | null };

export function molduraPorId(id: string): Moldura | undefined {
  return MOLDURAS.find((m) => m.id === id);
}

/**
 * O que veio do banco → um id que existe.
 *
 * NA LEITURA, e não só na escrita, e é isso que permite a regra do Firestore ser
 * frouxa de propósito. Três caminhos passam por cima da regra e chegam aqui:
 * o Admin SDK (que ignora regras), o console do Firebase, e o próprio catálogo
 * ENCOLHENDO numa versão futura — o dia em que uma moldura sair da lista, o
 * documento de quem a tinha continua com o id antigo gravado.
 *
 * Nos três, a resposta é a mesma e é a segura: `"nenhuma"`. Um anel que não
 * pinta é o pior que uma moldura desconhecida consegue fazer.
 */
export function normalizarMoldura(bruto?: string | null): IdMoldura {
  if (typeof bruto !== "string") return MOLDURA_PADRAO;
  const limpo = bruto.trim().toLowerCase();
  if (!limpo) return MOLDURA_PADRAO;
  return molduraPorId(limpo)?.id ?? MOLDURA_PADRAO;
}

/**
 * A espessura do anel, em px, para um avatar de `size` px.
 *
 * PRESA DOS DOIS LADOS, e as duas pontas resolvem defeitos opostos. O piso de
 * 1,5 px existe porque uma fração de pixel some no antialias: em 22 px, 7% dá
 * 1,54 e um anel de 1 px é indistinguível da borda que o avatar já tem. O teto
 * de 8% do diâmetro existe porque o piso, sozinho, é generoso demais em cima:
 * sem ele, um retrato de 112 px no pódio ganharia um anel proporcionalmente
 * maior que o de 38 px, e a mesma moldura leria como duas.
 *
 * `Math.round(x * 2) / 2` prende em meios pixels: um anel de 2,66 px sai
 * borrado em tela 1×, e a diferença entre 2,5 e 2,66 não existe para o olho.
 */
export function espessuraDoAnel(size: number): number {
  const porCento = (p: number) => Math.round(size * p * 2) / 2;
  return Math.min(Math.max(1.5, porCento(0.07)), porCento(0.08));
}

/**
 * A moldura a desenhar, ou `null` para "não desenhe nada".
 *
 * `null` E NÃO UM OBJETO VAZIO, e isso é contrato de CUSTO, não de estilo — o
 * teste o fixa como asserção. `<Avatar>` aparece dezenas de vezes por quadro do
 * Kanban, e a esmagadora maioria das pessoas não escolhe moldura nenhuma. Um
 * objeto sempre presente faria o componente montar um `<span>` extra em volta
 * de cada rosto da tela para não pintar coisa alguma.
 *
 * As quatro saídas por `null` são: `"nenhuma"`, pessoa sem o campo, id que o
 * catálogo não conhece, e tamanho abaixo de `MOLDURA_MIN_PX`.
 */
export function molduraDe(
  p: PessoaDaMoldura | null | undefined,
  size: number,
): {
  id: Exclude<IdMoldura, "nenhuma">;
  anel: number;
  detalhe: "cheio" | "simples";
} | null {
  if (!p) return null;
  if (!Number.isFinite(size) || size < MOLDURA_MIN_PX) return null;

  const id = normalizarMoldura(p.moldura);
  if (id === "nenhuma") return null;

  return {
    id,
    anel: espessuraDoAnel(size),
    detalhe: size >= LIMIAR_DETALHE_PX ? "cheio" : "simples",
  };
}
