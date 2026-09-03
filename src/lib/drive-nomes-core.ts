/**
 * O contrato de NOMES combinado com o Cowork — e só ele.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore`, nada de rede e
 * nenhuma chamada ao Drive. Quem fala com o Google é `api/drive/sync`; o que
 * mora aqui é a regra que decide **o que cada arquivo da pasta é**, e é isso que
 * permite `scripts/test-drive-nomes.mjs` rodá-la inteira em Node puro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO PRECISOU SAIR DA ROTA
 *
 * `classify` é a função mais silenciosa do pipeline. Ela não lança, não devolve
 * erro e não aparece em log: quando erra, o efeito é um documento linkado no
 * lugar de outro — a aba Ata lendo a ata didática achando que é a pauta, ou a
 * reunião marcada como processada com o campo que interessa vazio. Nada na tela
 * diz que houve troca, e o `prebuild` não tinha como cobrar nada dela porque ela
 * morava dentro de um arquivo que carrega o Admin SDK junto.
 *
 * O gatilho para extrair foi o quarto documento (`pauta`, 03/09/2026): a ordem
 * dos `if` passou a importar de verdade, e ordem de `if` é exatamente o tipo de
 * coisa que se estraga num refactor sem nada ficar vermelho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O CONTRATO, como ele é de fato
 *
 * O Cowork grava, na MESMA pasta do áudio, arquivos com o nome-base do áudio
 * seguido de um separador " - " e uma palavra que diz o que aquilo é:
 *
 *     Reunião de compras.m4a              ← o áudio
 *     Reunião de compras - Transcrição
 *     Reunião de compras - Pontos importantes
 *     Reunião de compras - Pauta da reunião
 *     Reunião de compras - Ata detalhada
 *
 * Quando termina, ele RENOMEIA o áudio para `… - Transcrito.m4a`. É esse
 * marcador que o sync usa para saber que pode olhar a pasta — e é por isso que
 * ele precisa sair do nome-base antes de casar os documentos.
 */

/** O que o processador externo (Cowork) sabe gerar. */
export const TIPOS_DE_SAIDA = [
  "transcricao",
  "resumo",
  "pauta",
  "detalhada",
  "didatica",
] as const;
export type TipoDeSaida = (typeof TIPOS_DE_SAIDA)[number];

/**
 * "o Cowork terminou com este áudio".
 *
 * ANCORADO NO FIM do nome, e nunca solto: um áudio chamado "Transcrito do dia
 * 5.m4a" seria dado como pronto no instante em que aparecesse — a reunião
 * viraria "processado" com zero links, e como o status só é gravado uma vez,
 * nunca mais seria reavaliada.
 */
export const MARCADOR_TRANSCRITO = /[\s\-–—]*\[?transcrito\]?\s*$/i;

export function semExtensao(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  return ponto > 0 ? nome.slice(0, ponto) : nome;
}

export function jaTranscrito(nomeDoArquivo: string): boolean {
  return MARCADOR_TRANSCRITO.test(semExtensao(nomeDoArquivo));
}

/**
 * Nome-base: sem extensão e sem o marcador do fim.
 *
 * O MESMO `MARCADOR_TRANSCRITO` da detecção, e não uma cópia parecida: se um
 * lado aceitasse "[Transcrito]" e o outro não, o nome-base sairia com o marcador
 * colado e nenhum documento casaria — a reunião ficaria processada e vazia.
 */
export function nomeBase(nomeDoAudio: string): string {
  return semExtensao(nomeDoAudio).replace(MARCADOR_TRANSCRITO, "").trim();
}

/**
 * O que este sufixo diz que o arquivo é — ou `null`, que significa "não é meu".
 *
 * A ORDEM DOS TESTES É A REGRA, e não uma sequência qualquer. Cada linha é uma
 * palavra que só pode pertencer a um tipo, e as de baixo são as mais genéricas:
 *
 *   1. `transcri`  — "Transcrição", e também o marcador "Transcrito".
 *   2. `detalhad`  — "Ata detalhada".
 *   3. `didatic`   — "Ata didática", com e sem acento.
 *   4. `pauta`     — "Pauta da reunião". VEM ANTES do bloco de baixo de
 *                    propósito: hoje o nome não contém nenhuma das palavras dali,
 *                    mas o dia em que alguém renomear para "Pauta de pontos" o
 *                    documento passaria a se classificar como a ata principal, e
 *                    o app linkaria o arquivo errado na aba Ata sem um erro
 *                    sequer. A mesma ordem vale na cópia que o Cowork carrega em
 *                    `smart-meet.mjs` — se um lado mudar, os dois mudam.
 *   5. `ponto` / `importante` / `resumo` — "Pontos importantes", que já foi
 *                    chamado de "Resumo" em safras antigas do prompt.
 *
 * `null` e não um tipo-coringa: a pasta tem o áudio, pode ter o `Demandas.json`
 * e pode ter arquivo que alguém largou ali. Chutar um tipo para tudo faria o app
 * linkar um PDF qualquer como se fosse a ata.
 */
export function classificarSaida(sufixo: string): TipoDeSaida | null {
  const s = sufixo.toLowerCase();
  if (s.includes("transcri")) return "transcricao";
  if (s.includes("detalhad")) return "detalhada";
  if (s.includes("didatic") || s.includes("didátic")) return "didatica";
  if (s.includes("pauta")) return "pauta";
  if (s.includes("ponto") || s.includes("importante") || s.includes("resumo")) {
    return "resumo";
  }
  return null;
}

/**
 * O arquivo pertence a este áudio? E, se pertence, o que ele é?
 *
 * DUAS CONFERÊNCIAS, e a segunda é a que evita o falso positivo caro. A primeira
 * é o prefixo: o nome do arquivo começa com o nome-base do áudio. A segunda é o
 * SEPARADOR: o que vem depois do nome-base precisa começar com " - ".
 *
 * Sem a segunda, "Reunião" casaria com "Reunião de compras - Pontos
 * importantes" — o documento de OUTRA reunião entraria nesta, e as duas
 * passariam a mostrar a mesma ata. É o mesmo cuidado que o `marcar-transcrito`
 * do Cowork chama de "conferência estrita".
 *
 * Devolve `null` quando não é deste áudio, quando é o próprio áudio, ou quando o
 * sufixo não diz nada conhecido.
 */
export function saidaDoArquivo(opcoes: {
  base: string;
  nomeDoArquivo: string;
}): TipoDeSaida | null {
  const base = opcoes.base;
  if (!base) return null;
  const nome = opcoes.nomeDoArquivo;
  if (!nome.toLowerCase().startsWith(base.toLowerCase())) return null;
  const sufixo = nome.slice(base.length);
  if (!/^\s*[-–—]\s*/.test(sufixo)) return null;
  return classificarSaida(sufixo);
}
