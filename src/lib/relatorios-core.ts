/**
 * Como as reuniões de "Relatórios IA" se organizam na tela — sem Firebase.
 *
 * A tela desenhava tudo numa grade só, em ordem de chegada da consulta: uma
 * reunião de fevereiro já conferida ocupava o mesmo tamanho, a mesma posição e
 * o mesmo peso de uma de ontem com três demandas esperando decisão. E o
 * problema crescia sozinho, porque cada reunião processada acrescenta um card e
 * nenhum sai.
 *
 * Agrupar e ordenar é justamente o tipo de regra que erra CALADA: a tela
 * continua bonita com o card na pasta errada, e ninguém confere um agrupamento
 * olhando — confere-se procurando uma reunião específica, meses depois, e não
 * achando. Por isso mora aqui, e por isso tem teste.
 */

import { normalizar } from "./discord-consulta-core.ts";

/** O tanto de reunião que a organização lê. */
export type ReuniaoNaTela = {
  id: string;
  title: string;
  sector: string;
  /** `aaaa-mm-dd`. Ordena por string, que é como o resto do app trata data. */
  date: string;
};

export type Pasta<T> = {
  /**
   * O nome do setor COMO ELE É — "B.I." com os pontos.
   *
   * A chave de agrupamento é normalizada (ver `agrupar`), o rótulo não. Setor é
   * cadastro, não texto livre: exibir uma versão "limpa" faria a tela discordar
   * de todas as outras que mostram o mesmo nome.
   */
  setor: string;
  itens: T[];
};

export type Organizacao<T> = {
  /** O que ainda pede decisão. Em evidência, fora de qualquer pasta. */
  pendentes: T[];
  /** O que já foi resolvido, uma pasta por setor. */
  pastas: Pasta<T>[];
  /** Quantas reuniões o recorte tem ao todo — pendentes mais arquivadas. */
  total: number;
};

/**
 * Se a reunião responde ao termo buscado.
 *
 * Título E setor, porque as duas são formas legítimas de lembrar de uma reunião
 * ("aquela do RH" é tão comum quanto "a do orçamento"). Todas as palavras do
 * termo precisam casar, em qualquer ordem e em qualquer um dos dois campos —
 * `combina` do Discord olha um campo só, e aqui isso deixaria "rh orçamento"
 * sem resultado mesmo com a reunião na tela.
 *
 * Termo vazio casa com TUDO, ao contrário da busca do Discord. Lá o vazio vinha
 * de um comando mal digitado e devolver o quadro inteiro faria a pessoa achar
 * que acertou; aqui o campo vazio é o estado normal da tela, e esconder tudo
 * enquanto ninguém digitou seria a tela nascendo mentindo.
 */
export function casaBusca(r: ReuniaoNaTela, termo: string): boolean {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return true;
  const alvo = `${normalizar(r.title)} ${normalizar(r.sector)}`;
  return palavras.every((p) => alvo.includes(p));
}

/**
 * Mais recente primeiro; empate desfeito pelo título.
 *
 * O desempate não é capricho: várias reuniões do mesmo dia é o caso comum (uma
 * manhã de comitês), e sem ele a ordem delas passa a ser a que o Firestore
 * devolveu — que muda entre uma carga e outra. Uma lista que se reordena sozinha
 * a cada F5 faz quem estava procurando perder o lugar.
 */
export function ordenarRecentes<T extends ReuniaoNaTela>(itens: T[]): T[] {
  return [...itens].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "pt-BR"),
  );
}

/**
 * Separa o que pede decisão do que já está resolvido, e arquiva por setor.
 *
 * `resolvida` entra por parâmetro porque a regra é da tela: "resolvida" ali é
 * ata conferida E nenhuma proposta pendente, e a segunda metade depende de uma
 * coleção que este módulo não conhece. Trazê-la para cá arrastaria as propostas
 * junto; deixá-la de fora mantém a organização testável com dados de mentira.
 */
export function organizar<T extends ReuniaoNaTela>(
  reunioes: T[],
  resolvida: (r: T) => boolean,
  termo = "",
): Organizacao<T> {
  const visiveis = reunioes.filter((r) => casaBusca(r, termo));
  const pendentes = ordenarRecentes(visiveis.filter((r) => !resolvida(r)));
  const arquivadas = visiveis.filter(resolvida);

  /**
   * A chave agrupa NORMALIZADA, o rótulo sai do primeiro que apareceu.
   *
   * "B.I." e "b.i." são o mesmo setor para quem lê, e duas pastas para um
   * `Map` ingênuo — e duas pastas com o mesmo nome, uma com 3 e outra com 1, é
   * a tela afirmando que existem dois setores. Não deveria acontecer (setor é
   * cadastro), mas dados de anos atrás não passaram pelo cadastro de hoje.
   */
  const porSetor = new Map<string, Pasta<T>>();
  for (const r of arquivadas) {
    const chave = normalizar(r.sector);
    const pasta = porSetor.get(chave);
    if (pasta) pasta.itens.push(r);
    else porSetor.set(chave, { setor: r.sector, itens: [r] });
  }

  const pastas = [...porSetor.values()]
    .map((p) => ({ setor: p.setor, itens: ordenarRecentes(p.itens) }))
    .sort((a, b) => a.setor.localeCompare(b.setor, "pt-BR"));

  return { pendentes, pastas, total: visiveis.length };
}
