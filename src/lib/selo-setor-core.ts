/**
 * O selo de cada setor — uma forma e um tom, sempre ao lado do nome.
 *
 * Módulo puro (AGENTS.md §4): sem import nenhum. Quem desenha a forma é
 * `components/selo-setor.tsx`; quem pinta o tom é `components/selo-setor.module.css`,
 * a partir dos tokens `--setor-N` de `globals.css`. Aqui mora só a decisão de
 * QUAL selo cada setor recebe.
 *
 * O SELO SAI SÓ DO NOME, e não de um campo no documento do setor. Quem não é
 * admin não lê `/setores` (`setores.ts`), então guardar a forma lá obrigaria
 * todas as telas a assinar a coleção e mudaria as regras do Firestore — para
 * decidir um desenho que o próprio nome já decide sozinho.
 *
 * NEM PELA POSIÇÃO NA LISTA, que é o que o Dashboard faz com as cores dos
 * gráficos. Lá a cor muda de uma pessoa para outra (cada uma vê a sua lista de
 * setores), e muda para todo mundo no dia em que o admin cadastra um setor novo
 * no meio da ordem alfabética. Um selo que troca de desenho sozinho é pior do
 * que nenhum: quem aprendeu "o triângulo é Cantinas" passa a ler errado.
 *
 * Por isso há DOIS caminhos, e nenhum depende do cadastro:
 *
 *  1. Uma TABELA FIXA para os setores que já existem — os do cadastro e os que
 *     aparecem nos perfis e solicitantes. Ela é escrita à mão porque o hash
 *     sozinho colide: com as 8 cores do hash de tags, B.I. e Infraestrutura
 *     saíam iguais (calculado em 26/11/2026). A tabela garante o que o hash
 *     não garante: os quatro setores que têm reunião hoje com forma E tom
 *     diferentes, e nenhum par da tabela confundível (ver `confunde`).
 *  2. Um HASH ESTÁVEL do nome para qualquer setor que nasça depois, com
 *     sondagem que pula as combinações da tabela. Setor novo já nasce com o
 *     seu selo, e ele não muda quando outro setor é cadastrado — o hash só lê o
 *     próprio nome.
 */

/**
 * As formas, desenhadas em viewBox 16×16 e conferidas a 14 px.
 *
 * Ficaram de fora, e cada uma por um motivo visto na tela: o hexágono cheio
 * (a 14 px vira um círculo), a estrela (já é o ícone de favorito/Rank), ✓ ✕ !
 * (são estado, e ao lado do chip "Processado" mentiriam) e a nuvem (é o Drive,
 * o envio do áudio).
 */
export const FORMAS = [
  "circulo",
  "quadrado",
  "triangulo",
  "losango",
  "gota",
  "pilula",
  "pentagono",
  "paralelogramo",
  "cruz",
  "meialua",
] as const;
export type Forma = (typeof FORMAS)[number];

/**
 * Quantos tons existem — os `--setor-1` a `--setor-7` de `globals.css`.
 *
 * SETE, e não os oito da paleta do Dashboard. Com oito, o oitavo tom sempre
 * caía perto de outro em algum tema (o melhor candidato, um magenta, ficou a
 * ΔE 8,4 do violeta com visão normal, abaixo do piso de 15 da skill de
 * dataviz). Sete bastam para os sete setores do cadastro terem tons diferentes
 * entre si, e a forma desempata o resto.
 */
export const TONS = 7;
export type Tom = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** O nome de cada tom, para o teste e para quem lê a folha. */
export const NOME_DO_TOM: Record<Tom, string> = {
  1: "violeta",
  2: "rosa",
  3: "azul",
  4: "âmbar",
  5: "verde-água",
  6: "laranja",
  7: "verde",
};

export type Selo = { forma: Forma; tom: Tom };

/**
 * A chave do nome: minúsculo, sem acento, sem pontuação e sem espaço.
 *
 * Mais agressiva que o `normalizar` do Discord, que guarda a pontuação: lá ele
 * compara texto digitado com texto digitado; aqui "B.I.", "b.i." e "BI" são o
 * mesmo setor escrito por pessoas diferentes, e um selo diferente para cada
 * grafia seria a tela afirmando que existem três setores. O NOME NÃO MUDA —
 * "B.I." continua com os pontos no banco e na tela; só a comparação ignora.
 */
export function chaveDoSetor(nome: string): string {
  return (nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Pares de forma que se parecem a 14 px.
 *
 * Redondo com redondo (gota, pentágono e meia-lua têm a silhueta do círculo
 * quando o olho passa rápido) e retângulo com retângulo inclinado. Quadrado e
 * losango ficam FORA: canto reto em cima × ponta em cima é a diferença que os
 * marcadores de gráfico usam há décadas, e ela sobrevive aos 14 px.
 */
export const FORMAS_PARECIDAS: ReadonlyArray<readonly [Forma, Forma]> = [
  ["circulo", "gota"],
  ["circulo", "pentagono"],
  ["gota", "pentagono"],
  ["circulo", "meialua"],
  ["quadrado", "pilula"],
  ["quadrado", "paralelogramo"],
  ["losango", "paralelogramo"],
];

/**
 * Pares de tom que se confundem em algum dos três temas.
 *
 * Saem da validação dos valores de `globals.css` (skill dataviz, OKLab ×100,
 * todos os pares, pior caso entre escuro, claro e contraste): visão normal
 * abaixo de 15 ou daltonismo (protan/deutan) abaixo de 8. Laranja × verde é o
 * clássico do deutan (2,7); rosa × laranja fica a 10,3 com visão normal. Se um
 * valor de `--setor-N` mudar na folha, esta lista tem de ser medida de novo —
 * o teste confere a tabela contra ela, não contra a folha.
 */
export const TONS_PARECIDOS: ReadonlyArray<readonly [Tom, Tom]> = [
  [2, 5],
  [2, 6],
  [2, 7],
  [4, 6],
  [4, 7],
  [5, 7],
  [6, 7],
];

function parecidos<T>(pares: ReadonlyArray<readonly [T, T]>, a: T, b: T) {
  return a === b || pares.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/**
 * Dois selos se confundem quando a forma E o tom se confundem.
 *
 * Basta um dos dois diferir para o selo se distinguir — forma diferente com o
 * mesmo tom é o caso normal da tabela, e é por isso que sete tons bastam.
 */
export function confunde(a: Selo, b: Selo): boolean {
  return (
    parecidos(FORMAS_PARECIDAS, a.forma, b.forma) &&
    parecidos(TONS_PARECIDOS, a.tom, b.tom)
  );
}

/**
 * A tabela fixa, em ordem de prioridade.
 *
 * Os QUATRO PRIMEIROS são os que têm reunião hoje (B.I. 68, Cantinas 13,
 * Infraestrutura 10, Diretoria 2): as quatro formas mais distintas entre si e
 * os quatro tons que passam em TODOS os pares da validação, nos três temas
 * (daltonismo ≥ 9,4; visão normal ≥ 18,3). Os três seguintes fecham o
 * cadastro de `/setores`, e os sete têm forma e tom diferentes entre si. O
 * resto são os setores que já aparecem nos perfis e solicitantes (CESIU, CVU,
 * Compras, Nutrição, RH) e os outros da Rede que a decisão de 26/11/2026
 * listou; ali a forma repete, mas nenhum par confunde.
 *
 * NÃO REORDENE NEM TROQUE uma entrada que já existe: o selo é o que as pessoas
 * aprenderam a reconhecer — e os sete primeiros ainda decidem o selo de todo
 * setor que não está aqui (`VIZINHOS`). Setor novo entra no FIM, com uma
 * combinação que o teste aceite.
 */
export const TABELA: ReadonlyArray<{ nome: string } & Selo> = [
  { nome: "B.I.", forma: "circulo", tom: 1 },
  { nome: "Cantinas", forma: "triangulo", tom: 2 },
  { nome: "Infraestrutura", forma: "quadrado", tom: 3 },
  { nome: "Diretoria", forma: "losango", tom: 4 },
  { nome: "Livros Escolares", forma: "pilula", tom: 5 },
  { nome: "Medicina Veterinária", forma: "cruz", tom: 7 },
  { nome: "Serve-cy", forma: "gota", tom: 6 },
  { nome: "CESIU", forma: "pentagono", tom: 3 },
  { nome: "CVU", forma: "paralelogramo", tom: 1 },
  { nome: "Compras", forma: "meialua", tom: 2 },
  { nome: "Nutrição", forma: "triangulo", tom: 1 },
  { nome: "RH", forma: "losango", tom: 2 },
  { nome: "CPA", forma: "gota", tom: 5 },
  { nome: "Odonto", forma: "pilula", tom: 1 },
  { nome: "Comercial", forma: "cruz", tom: 1 },
  { nome: "UnichStore", forma: "meialua", tom: 3 },
  { nome: "Pedagógico", forma: "triangulo", tom: 3 },
  { nome: "Financeiro", forma: "pilula", tom: 4 },
];

const POR_CHAVE = new Map(
  TABELA.map((e) => [chaveDoSetor(e.nome), { forma: e.forma, tom: e.tom }]),
);
const OCUPADAS = new Set(TABELA.map((e) => `${e.forma}:${e.tom}`));

/**
 * Os sete do cadastro de `/setores` em 26/11/2026 — os vizinhos de qualquer
 * setor que for cadastrado depois, na tela do admin e no acervo dele.
 *
 * Um setor novo pode até repetir o selo de outro setor NOVO (o nome
 * desempata), mas não deve nascer parecido com um destes, que aparecem o tempo
 * todo. Contra os 18 da tabela inteira sobrariam 4 combinações — e o hash
 * empilharia todo setor novo nelas; contra estes 7 sobram 19.
 */
const VIZINHOS = TABELA.slice(0, 7);

/**
 * FNV-1a de 32 bits — determinístico, igual no navegador e no Node.
 *
 * Não é o `h*31` de `tagColor`/`corDeAvatar`: com ele (e 8 cores), B.I. e
 * Infraestrutura caíam na mesma cor. FNV-1a mistura cada caractere no
 * resultado inteiro, e o texto típico aqui tem de 2 a 20 letras.
 */
function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Quantas combinações forma × tom existem. */
const COMBINACOES = FORMAS.length * TONS;

function combinacao(i: number): Selo {
  return {
    forma: FORMAS[i % FORMAS.length],
    tom: ((Math.floor(i / FORMAS.length) % TONS) + 1) as Tom,
  };
}

/**
 * O selo de um setor, pelo nome.
 *
 * Fora da tabela, o hash escolhe o ponto de partida e a sondagem anda de um em
 * um até achar uma combinação que (1) não seja de ninguém da tabela e (2) não
 * se confunda com os `VIZINHOS`. Se a segunda exigência não couber — só se a
 * tabela crescer muito —, a volta seguinte aceita qualquer combinação livre:
 * selo parecido é ruim, selo IGUAL ao de outro setor conhecido é mentira.
 *
 * Cada passo troca a FORMA (`i % FORMAS.length`): pular uma combinação ocupada
 * cai numa forma vizinha, e não na mesma forma com outro tom — que é o que mais
 * se confunde com o dono da combinação pulada.
 */
export function seloDoSetor(nome: string): Selo {
  const chave = chaveDoSetor(nome);
  const fixo = POR_CHAVE.get(chave);
  if (fixo) return fixo;
  const inicio = fnv1a(chave) % COMBINACOES;
  for (const exigente of [true, false]) {
    for (let passo = 0; passo < COMBINACOES; passo++) {
      const s = combinacao((inicio + passo) % COMBINACOES);
      if (OCUPADAS.has(`${s.forma}:${s.tom}`)) continue;
      if (exigente && VIZINHOS.some((v) => confunde(s, v))) continue;
      return s;
    }
  }
  // Inalcançável enquanto a tabela tiver menos entradas que as 70 combinações —
  // o teste confere. Fica para o tipo não mentir sobre o retorno.
  return { forma: "circulo", tom: 1 };
}
