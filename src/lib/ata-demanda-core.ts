/**
 * A demanda que nasce DENTRO da ata — e a dimensão que ela é obrigada a ter.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * escreve é a tela, por `ata.ts` e `kanban.ts`; é isto que permite
 * `scripts/test-ata-demanda.mjs` rodar a régua inteira em Node puro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A ATA PASSOU A CRIAR DEMANDA — e por que isso NÃO fura a fronteira
 *
 * `ata-core.ts` diz, e continua valendo: o que é DECISÃO fica na ata, o que é
 * ESTADO vem do card. Nada aqui contraria isso. O que mudou é outra coisa: até
 * agora não havia caminho nenhum, na tela, para o assunto que a reunião discutiu
 * virar trabalho. O item sem card existia no tipo, o parser da reunião produzia
 * um por bloco de "Pontos importantes", e a única saída era abrir o Kanban em
 * outra aba, criar o card à mão e voltar — com o vínculo (`item.cardId`)
 * ficando para trás. Na reunião seguinte a ata não sabia que aquele assunto
 * tinha virado demanda, e o mesmo assunto era discutido de novo.
 *
 * `scripts/check-demandas-boundary.mjs` proíbe o CAMINHO AUTOMÁTICO — Cowork →
 * Drive → ingest, e `api/ata/gerar` — de escrever em `/cards`. Isto aqui é o
 * oposto disso: é clique humano, com formulário aberto, exatamente da mesma
 * natureza da criação no Kanban e da aceitação em `api/demandas/decidir`. A
 * proibição continua inteira, e o guarda ficou mais forte no mesmo PR: a rota
 * que monta a ata a partir do documento nunca vai poder criar card, e agora há
 * uma exigência escrita de que a criação pela ata seja humana e do lado do
 * cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A DIMENSÃO É OBRIGATÓRIA AQUI, E NÃO NO KANBAN
 *
 * O "Mapa de Domínios e Estrutura" das Cantinas (v2, 22/08/2026) organiza a
 * operação em quatro domínios e diz onde cada coisa vive:
 *
 *     Meta vive em Domínio × Cantina. Procedimento vive em Domínio × Fluxo.
 *     Manual muda em Domínio × Perfil. Decisão vive em Domínio × Nível.
 *
 * Toda linha começa em domínio. Trabalho sem domínio é trabalho sem meta-mãe e
 * sem responsável declarado — que é, literalmente, o sintoma que o mapa
 * registra: "assunto simples percorre muitas pessoas antes de fechar".
 *
 * A régua vale AQUI e não no Kanban porque os dois momentos são diferentes. No
 * Kanban a demanda é anotada às pressas, muitas vezes por quem ainda não sabe
 * onde ela mora, e um campo obrigatório ali vira dimensão escolhida no chute só
 * para o botão liberar. Na ata a pergunta já foi respondida em voz alta: o
 * assunto está sendo discutido, com as pessoas do domínio na sala. É o único
 * instante do fluxo em que exigir a classificação não é atrito — é registro.
 *
 * E a obrigatoriedade não vale só para o que nasce depois desta mudança: a
 * pauta CONTA quantas linhas estão sem classificação (`semClassificacao`), para
 * que a ata antiga não fique com o problema calado.
 */

import type { DimensaoDaPauta, ItemDaPauta, ItemDeAta } from "./ata-core.ts";
import { limparTexto, proximoIdDeItem } from "./ata-core.ts";

/** Quanto cabe no assunto de um item — o mesmo teto que `normalizarItem` aplica. */
export const LIMITE_ASSUNTO_CHARS = 200;

/**
 * O veredito de uma conferência.
 *
 * Mesma forma de `NomeConferido` em `dimensoes-core`, e pelo mesmo motivo: a
 * regra do Firestore é a SEGUNDA barreira e só sabe responder "sem permissão",
 * que é a mensagem errada para quem esqueceu de escolher a dimensão.
 */
export type Conferido<T> = { ok: true; valor: T } | { ok: false; motivo: string };

export type Classificacao = { dimensaoId: string; subdimensaoId: string };

/**
 * A classificação existe, e existe NA ÁRVORE DESTE SETOR?
 *
 * Conferir contra a árvore, e não só contra o vazio, cobre o caso que aparece
 * sozinho com o tempo: a dimensão escolhida ontem foi apagada do cadastro hoje.
 * Um id órfão desenha igual a nenhum id — a linha some do lugar certo da árvore
 * e reaparece em "Sem classificação" —, e sem esta conferência a tela deixaria
 * gravar de novo o mesmo id morto.
 *
 * A SUBDIMENSÃO CONTINUA OPCIONAL, de propósito. A árvore prevê a demanda que
 * mora direto na dimensão ("uma caixa que abriga vários trabalhos"), e há
 * dimensões sem filho nenhum — exigir o segundo nível tornaria impossível
 * classificar em D2 enquanto ninguém tivesse cadastrado uma subdimensão lá.
 * O que não passa é subdimensão de OUTRA dimensão: `subdimensaoId` sem
 * `dimensaoId` correspondente não é estado válido (ver o comentário do campo em
 * `kanban.ts`).
 */
export function conferirClassificacao(
  bruto: Partial<Classificacao> | null | undefined,
  dimensoes: readonly DimensaoDaPauta[],
): Conferido<Classificacao> {
  const dimensaoId = String(bruto?.dimensaoId ?? "").trim();
  const subdimensaoId = String(bruto?.subdimensaoId ?? "").trim();

  if (!dimensaoId) {
    return {
      ok: false,
      motivo: dimensoes.length
        ? "Escolha a dimensão. Toda demanda desta aba precisa de uma."
        : "Este setor ainda não tem dimensão cadastrada. Cadastre a árvore em Dimensões antes de abrir demanda pela ata.",
    };
  }

  const dim = dimensoes.find((d) => d.id === dimensaoId);
  if (!dim) {
    return {
      ok: false,
      motivo: "Esta dimensão não existe mais na árvore do setor. Escolha outra.",
    };
  }

  if (subdimensaoId && !dim.subs.some((s) => s.id === subdimensaoId)) {
    return {
      ok: false,
      motivo: `A subdimensão escolhida não pertence a "${dim.nome}".`,
    };
  }

  return { ok: true, valor: { dimensaoId, subdimensaoId } };
}

/**
 * O texto que nomeia a linha — assunto do item, ou título da demanda.
 *
 * Um teto só para os dois porque é o mesmo texto: o assunto vira o título do
 * card quando a linha é promovida, e um assunto que não coubesse no título
 * chegaria ao quadro cortado no meio de uma palavra.
 */
export function conferirTitulo(bruto: unknown, oQue: string): Conferido<string> {
  const texto = limparTexto(bruto, LIMITE_ASSUNTO_CHARS);
  if (!texto) return { ok: false, motivo: `Informe ${oQue}.` };
  return { ok: true, valor: texto };
}

export type AssuntoNovo = {
  assunto: string;
  contexto: string;
  dimensaoId: string;
  subdimensaoId: string;
};

/**
 * Confere e monta o item de pauta que ainda não é demanda.
 *
 * Devolve o ITEM PRONTO, e não um "ok" para a tela montar sozinha: montar o
 * item em dois lugares (aqui e na promoção a demanda) é como um campo novo
 * nasce preenchido num caminho e vazio no outro.
 */
export function conferirAssuntoNovo(
  bruto: Partial<AssuntoNovo> | null | undefined,
  itens: readonly ItemDeAta[],
  dimensoes: readonly DimensaoDaPauta[],
): Conferido<ItemDeAta> {
  const titulo = conferirTitulo(bruto?.assunto, "o assunto");
  if (!titulo.ok) return titulo;
  const classe = conferirClassificacao(bruto, dimensoes);
  if (!classe.ok) return classe;

  return {
    ok: true,
    valor: {
      id: proximoIdDeItem(itens),
      cardId: "",
      assunto: titulo.valor,
      contexto: limparTexto(bruto?.contexto),
      dimensaoId: classe.valor.dimensaoId,
      subdimensaoId: classe.valor.subdimensaoId,
      decisao: "",
      objetivo: "",
      proximaReuniao: false,
      tarefas: [],
    },
  };
}

/**
 * O array de itens da ata com um deles apontando para o card recém-criado.
 *
 * É PURO e devolve o array inteiro porque é assim que a ata grava (ver o
 * cabeçalho de `ata.ts`): os itens moram dentro do documento, e a escrita é
 * sempre do array completo.
 *
 * O ITEM PODE NÃO EXISTIR AINDA, e este é o caso que exige atenção. A linha da
 * pauta que ninguém tocou é desenhada a partir de um item FANTASMA que
 * `montarPauta` inventa na hora, com `id` igual ao `cardId` e sem estar gravado
 * em lugar nenhum. Promover essa linha significa criar o item de verdade — daí
 * o segundo braço. Sem ele a função devolveria o array intocado e o vínculo se
 * perderia em silêncio, que é o pior desfecho possível: o card existiria no
 * quadro e a ata continuaria chamando aquilo de assunto.
 */
export function vincularCard(
  itens: readonly ItemDeAta[],
  itemId: string,
  cardId: string,
  base?: ItemDeAta,
): ItemDeAta[] {
  const existe = itens.some((i) => i.id === itemId);
  if (existe) return itens.map((i) => (i.id === itemId ? { ...i, cardId } : i));
  const novo: ItemDeAta = {
    ...(base ?? {
      id: itemId,
      cardId: "",
      assunto: "",
      contexto: "",
      dimensaoId: "",
      subdimensaoId: "",
      decisao: "",
      objetivo: "",
      proximaReuniao: false,
      tarefas: [],
    }),
    // O id do fantasma é o `cardId` de origem, que não serve como id de item
    // gravado: ele colidiria com o próximo item novo que herdasse aquele card.
    id: proximoIdDeItem(itens),
    cardId,
  };
  return [...itens, novo];
}

/**
 * As linhas da pauta que ainda não têm dimensão.
 *
 * Conta as DUAS origens, porque a pergunta do gestor é uma só — "quanto desta
 * reunião está fora do mapa?" — e ela não distingue de onde a linha veio:
 *
 *   - o assunto sem card responde pela própria `dimensaoId`;
 *   - a demanda responde pela do CARD, porque dimensão é estado e estado vem do
 *     quadro (regra do cabeçalho de `ata-core.ts`).
 *
 * Consertar cada uma é escrita em lugar diferente — uma na ata, outra no card —
 * e é por isso que a tela precisa saber qual é qual. Quem responde isso é
 * `linhaEhDeCard`, logo abaixo, e não uma segunda varredura.
 */
export function semClassificacao(
  pauta: readonly ItemDaPauta[],
): ItemDaPauta[] {
  return pauta.filter((l) =>
    l.card ? !l.card.dimensaoId : !l.item.dimensaoId,
  );
}

/** A classificação que a linha mostra hoje, venha ela do card ou do item. */
export function classificacaoDaLinha(l: ItemDaPauta): Classificacao {
  return l.card
    ? {
        dimensaoId: l.card.dimensaoId ?? "",
        subdimensaoId: l.card.subdimensaoId ?? "",
      }
    : { dimensaoId: l.item.dimensaoId, subdimensaoId: l.item.subdimensaoId };
}
