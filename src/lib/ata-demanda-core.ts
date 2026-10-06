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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MAIS MORA AQUI HOJE
 *
 * O arquivo nasceu para o nascimento da demanda, e virou o do CICLO DE VIDA da
 * linha de pauta que ainda não é uma: ela nasce (`conferirAssuntoNovo`), se
 * corrige (`editarAssunto`), muda de reunião (`moverAssunto`) e vira card
 * (`vincularCard`). Os quatro dividem as mesmas duas conferências e o mesmo
 * `Conferido`; em quatro arquivos, seriam quatro lugares para a régua da
 * dimensão deixar de valer — e o quarto ninguém lembraria de mudar.
 */

import type { DimensaoDaPauta, ItemDaPauta, ItemDeAta } from "./ata-core.ts";
import { chaveDeAssunto, limparTexto, proximoIdDeItem } from "./ata-core.ts";

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
        : "Este setor ainda não tem dimensão cadastrada. A árvore é cadastrada em Admin › Dimensões, por quem administra o sistema, antes de abrir demanda pela ata.",
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
      // O único caminho do app que produz item `manual`: alguém abriu o
      // formulário e digitou. É o que a mesclagem com o documento do áudio lê
      // para saber que aquele texto tem autor humano e não se sobrescreve.
      origem: "manual",
      origemAtaId: "",
      decisao: "",
      objetivo: "",
      proximaReuniao: false,
      levadaParaAtaId: "",
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
      // Mesmo caso e mesmo motivo de `itemVazio` em `ata-core`: é a linha que
      // entrou pelo QUADRO, e a tela não desenha chip de origem onde há card.
      origem: "manual",
      origemAtaId: "",
      decisao: "",
      objetivo: "",
      proximaReuniao: false,
      levadaParaAtaId: "",
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
  return pauta.filter((l) => {
    // A linha cuja demanda saiu do quadro é REGISTRO, não trabalho: não há
    // card para classificar e não há o que cobrar de ninguém. Contá-la aqui
    // encheria o alerta de linhas históricas que ninguém pode resolver — e um
    // alerta que não se consegue zerar é um alerta que se aprende a ignorar.
    if (l.foraDoQuadro) return false;
    // A PENDÊNCIA TAMBÉM NÃO, e pela mesma razão: "Em aberto" e "Outros pontos"
    // são apêndice do documento do áudio, não assunto (ver `ehPendenciaDaReuniao`
    // em `ata-core`). Não há o que classificar num apêndice, e cobrá-lo aqui
    // deixaria o alerta de "fora do mapa" travado em duas linhas por ata —
    // impossível de zerar, e por isso rápido de aprender a ignorar.
    if (l.secao === "pendencia") return false;
    return l.card ? !l.card.dimensaoId : !l.item.dimensaoId;
  });
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

/**
 * O assunto corrigido — mesmo item, outro nome, outro contexto, outra caixa.
 *
 * POR QUE ISTO PRECISOU EXISTIR. O assunto nascia e nunca mais mudava: a tela
 * desenhava `assunto` e `contexto` como texto morto, e o único editável da
 * linha era o que vem DEPOIS da criação — decisão, objetivo, tarefas e a
 * dimensão. Um nome digitado errado no meio da reunião ficava errado para
 * sempre naquela ata, e a única saída era excluir a ata inteira, levando junto
 * as decisões e as tarefas de todo mundo.
 *
 * DEVOLVE O ARRAY INTEIRO, como `vincularCard` e pelo mesmo motivo: os itens
 * moram dentro do documento e a ata grava sempre o array completo (cabeçalho de
 * `ata.ts`). Devolver só o item mudado obrigaria quem chama a remontar o array,
 * que é onde o `id` errado acaba escrevendo por cima de outra linha.
 *
 * O QUE ELE NÃO TOCA, de propósito: decisão, objetivo, `proximaReuniao` e as
 * tarefas. Corrigir o nome de um assunto não é motivo para a reunião perder o
 * que decidiu sobre ele — e o oposto (recriar o item) foi justamente o
 * contorno que a falta desta função obrigava.
 *
 * DUAS RECUSAS QUE SÃO DE NEGÓCIO, e não de formulário:
 *
 *   1. ITEM QUE NÃO EXISTE MAIS. A ata é editada por várias pessoas na mesma
 *      reunião; entre abrir o modal e salvar, o item pode ter sumido do array.
 *      Sem esta conferência, o `map` não acharia nada, a escrita passaria
 *      "com sucesso" e a correção sumiria calada.
 *   2. LINHA QUE JÁ TEM CARD. Aí `assunto` e `contexto` viram histórico do que
 *      a reunião chamou, e quem responde pelo nome é o quadro — nome é estado,
 *      e estado vem do card (cabeçalho de `ata-core.ts`). Deixar gravar aqui
 *      daria a alguém a impressão de ter renomeado a demanda, escrevendo em
 *      dois campos que a tela não lê mais.
 *
 * A régua do título e a da dimensão são as MESMAS da criação, chamadas daqui e
 * não copiadas: régua que mora só no formulário é régua que o segundo
 * formulário esquece.
 */
export function editarAssunto(
  itens: readonly ItemDeAta[],
  itemId: string,
  bruto: Partial<AssuntoNovo> | null | undefined,
  dimensoes: readonly DimensaoDaPauta[],
): Conferido<ItemDeAta[]> {
  const atual = itens.find((i) => i.id === itemId);
  if (!atual) {
    return {
      ok: false,
      motivo:
        "Este assunto não está mais na pauta desta ata. Feche e abra a ata para ver como ela está agora.",
    };
  }
  if (atual.cardId) {
    return {
      ok: false,
      motivo:
        "Esta linha já é uma demanda do quadro: o título e a descrição dela se editam no Kanban.",
    };
  }

  const titulo = conferirTitulo(bruto?.assunto, "o assunto");
  if (!titulo.ok) return titulo;
  const classe = conferirClassificacao(bruto, dimensoes);
  if (!classe.ok) return classe;

  return {
    ok: true,
    valor: itens.map((i) =>
      i.id === itemId
        ? {
            ...i,
            assunto: titulo.valor,
            contexto: limparTexto(bruto?.contexto),
            dimensaoId: classe.valor.dimensaoId,
            subdimensaoId: classe.valor.subdimensaoId,
          }
        : i,
    ),
  };
}

/**
 * O assunto lançado na reunião errada muda de ata — levando tudo o que tem.
 *
 * POR QUE ISTO PRECISOU EXISTIR. A pauta que se abre é quase sempre a mais
 * recente, e o assunto que se quer registrar é muitas vezes o da reunião
 * passada. Errar o alvo era barato de fazer e caríssimo de desfazer: sem
 * "remover", a linha errada ficava lá para sempre; recriar na reunião certa
 * cobrava redigitar a decisão, o objetivo, a marca de próxima reunião e a
 * tabela de tarefas inteira; e a única saída limpa era excluir a ata, que é de
 * gestor e apaga a reunião de todo mundo.
 *
 * DEVOLVE OS DOIS ARRAYS, e quem chama grava os dois no MESMO `writeBatch` —
 * ver `moverItensEntreAtas`. Em duas escritas soltas, a falha da segunda deixa
 * o assunto nas duas atas ou em nenhuma, e nada na tela diria qual dos dois
 * aconteceu.
 *
 * O `id` É RENUMERADO NO DESTINO, e este é o detalhe que derruba tudo se
 * passar. Os ids são sequenciais POR ATA: o item "3" que chega de outra ata
 * colide com o "3" que já mora lá, e duas linhas com a mesma `key` do React
 * fazem a escrita de uma cair na outra — é o mesmo estado que `idsUnicos`
 * conserta na leitura, e que aqui dá para simplesmente não criar.
 *
 * O RESTO VAI INTEIRO: assunto, contexto, dimensão, decisão, objetivo,
 * `proximaReuniao` e as tarefas. O item não mudou de natureza, mudou de pasta —
 * e a decisão que a reunião tomou sobre ele continua sendo a mesma decisão.
 *
 * A `origem` VAI INTEIRA TAMBÉM, e essa é a que dá vontade de trocar. "Mover"
 * existe para o assunto lançado na reunião errada — é a correção de um erro de
 * endereço, e não uma passagem de bastão entre reuniões. Marcar a linha como
 * `herdado` faria a ata de destino afirmar que aquele assunto veio de outra
 * reunião, quando o que houve é que ele sempre foi desta e foi digitado na
 * porta ao lado. Quem quer passar bastão usa "Levar para próxima reunião".
 *
 * TRÊS RECUSAS, e as três são de negócio:
 *
 *   1. A MESMA ATA de origem e destino. Sem isto o item sairia do array e
 *      voltaria com id novo — inofensivo por acaso, e confuso de ler para
 *      sempre.
 *   2. SETORES DIFERENTES. A ata é escopada por setor em `firestore.rules`, e a
 *      árvore de dimensões também: o `dimensaoId` do item não aponta para a
 *      mesma caixa do outro lado, e a linha chegaria classificada em algo que
 *      não existe lá. A tela só oferece atas do mesmo setor; esta é a segunda
 *      barreira, no caminho.
 *   3. LINHA COM CARD. A demanda do quadro aparece na pauta de TODA reunião do
 *      setor, vinda do Kanban — mover o item não a moveria, apenas levaria para
 *      outro dia a decisão tomada neste. Uma ata que empresta a decisão de
 *      outra deixou de ser registro.
 */
export function moverAssunto(
  origem: { id: string; setor: string; itens: readonly ItemDeAta[] },
  destino: { id: string; setor: string; itens: readonly ItemDeAta[] },
  itemId: string,
): Conferido<{ origem: ItemDeAta[]; destino: ItemDeAta[] }> {
  if (origem.id === destino.id) {
    return { ok: false, motivo: "Escolha uma reunião diferente desta." };
  }
  if (origem.setor !== destino.setor) {
    return {
      ok: false,
      motivo:
        "As duas reuniões precisam ser do mesmo setor: a dimensão do assunto só existe na árvore do setor dele.",
    };
  }

  const item = origem.itens.find((i) => i.id === itemId);
  if (!item) {
    return {
      ok: false,
      motivo:
        "Este assunto não está mais na pauta desta ata. Feche e abra a ata para ver como ela está agora.",
    };
  }
  if (item.cardId) {
    return {
      ok: false,
      motivo:
        "Esta linha é uma demanda do quadro: ela já aparece na pauta de toda reunião do setor, e o que a ata guarda sobre ela é a decisão daquele dia.",
    };
  }

  return {
    ok: true,
    valor: {
      origem: origem.itens.filter((i) => i.id !== itemId),
      destino: [
        ...destino.itens,
        { ...item, id: proximoIdDeItem(destino.itens) },
      ],
    },
  };
}

/** O recorte de ata que `moverAssunto` e `levarAssunto` precisam. */
export type AtaEmMovimento = {
  id: string;
  setor: string;
  /** `aaaa-mm-dd` — só `levarAssunto` a usa, para não levar para trás no tempo. */
  data: string;
  itens: readonly ItemDeAta[];
};

/**
 * "Levar para próxima reunião" quando a próxima JÁ EXISTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTAVA QUEBRADO, e é o defeito mais silencioso desta aba até aqui
 *
 * O botão só acendia um interruptor: `item.proximaReuniao = true`, e nada
 * acontecia. O flag era colhido em UM lugar — "Abrir a próxima reunião" —, e
 * aquele caminho só sabe CRIAR ata.
 *
 * Quando a próxima reunião já existe, o botão não fazia nada. Não é figura de
 * linguagem: o setor Cantinas tinha ata de 26/08, 02/09 e 09/09; durante a
 * reunião de 02/09 quem conduzia abriu a ata de 26/08, discutiu os assuntos
 * passados e clicou em "Levar para próxima reunião" em vários deles. Os flags
 * ficaram acesos no 26/08 sem ter para onde ir — colhê-los exigiria criar uma
 * QUARTA ata, duplicando a de 09/09. Sem erro na tela, sem aviso: o botão
 * acendia, e pronto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEVAR NÃO É MOVER, e a diferença é o que este arquivo guarda
 *
 * As duas funções vivem lado a lado de propósito, porque dividem as réguas e
 * porque a semelhança é enganosa:
 *
 *                     `moverAssunto`          `levarAssunto`
 *   origem            perde o item            MANTÉM o item
 *   decisão           vai junto               FICA na origem, vazia no destino
 *   objetivo          vai junto               vai junto
 *   tarefas           todas                   só as não concluídas
 *   linha com card    recusa                  ACEITA
 *   origem/origemAtaId preserva               "herdado" / id da origem
 *
 * "Mover" conserta um endereço errado: o assunto sempre foi daquela reunião e
 * foi digitado na porta ao lado. "Levar" passa bastão: a reunião decidiu que
 * aquilo volta a ser falado. As três primeiras linhas da tabela são a régua que
 * `herdarParaProxima` já aplica, e o porquê está no cabeçalho dela — a decisão é
 * daquela reunião, e repeti-la faria a ata nova nascer afirmando o que outra
 * decidiu; tarefa concluída que reaparece é a linha que todo mundo aprende a
 * pular.
 *
 * ACEITAR LINHA COM CARD é a decisão nova, e é o caso mais comum do botão:
 * "esta demanda continua na pauta da semana que vem". `moverAssunto` recusa card
 * porque mover não moveria a demanda — ela vem do Kanban e aparece na pauta de
 * toda reunião do setor. Levar não pretende mover nada: pretende registrar o que
 * se espera dela na próxima, e é o `objetivo` copiado que carrega isso. Como
 * `montarPauta` indexa um item por card, o item que chega vira A linha daquela
 * demanda no destino — não uma segunda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O ITEM PODE SER FANTASMA, e é o caso que exige atenção
 *
 * A linha da pauta que ninguém tocou é desenhada a partir de um item que
 * `montarPauta` inventa na hora (`itemVazio`), com `id` igual ao `cardId` e sem
 * estar gravado. Levar essa linha significa criar o item de verdade na origem —
 * daí o item vir por parâmetro em vez de ser procurado por id. É o mesmo
 * segundo braço de `vincularCard`, e pelo mesmo motivo: sem ele a função
 * devolveria os arrays intocados e o clique não faria nada, em silêncio, que é
 * exatamente o defeito que ela vem consertar.
 */
export function levarAssunto(
  origem: AtaEmMovimento,
  destino: AtaEmMovimento,
  item: ItemDeAta,
): Conferido<{ origem: ItemDeAta[]; destino: ItemDeAta[] }> {
  if (origem.id === destino.id) {
    return { ok: false, motivo: "Escolha uma reunião diferente desta." };
  }
  if (origem.setor !== destino.setor) {
    return {
      ok: false,
      motivo:
        "As duas reuniões precisam ser do mesmo setor: a dimensão do assunto só existe na árvore do setor dele.",
    };
  }
  /**
   * PARA TRÁS NO TEMPO NÃO É LEVAR, é reescrever uma reunião que já aconteceu.
   *
   * A recusa é de negócio, e é a única das quatro que `moverAssunto` não tem —
   * porque mover para trás é justamente o conserto que ele existe para fazer
   * ("lancei na reunião de hoje o que era da semana passada"). Aqui o gesto
   * significa "volte a falar disto", e uma ata anterior não vai voltar a
   * acontecer. Sem esta recusa, o objetivo apareceria na pauta de uma reunião
   * encerrada, cobrando de todo mundo uma coisa que ninguém mais vai ler.
   *
   * Data vazia passa: a ata sem data ainda não foi marcada, e é destino legítimo.
   */
  if (origem.data && destino.data && destino.data < origem.data) {
    return {
      ok: false,
      motivo:
        "Essa reunião é anterior a esta. Para corrigir onde o assunto foi lançado, use \"Mover\".",
    };
  }

  /**
   * JÁ ESTÁ LÁ, e por dois caminhos: o card e o nome.
   *
   * Sem esta conferência, dois cliques criam duas linhas iguais na pauta do
   * destino — e o segundo clique é o gesto de quem não tem certeza se o primeiro
   * funcionou. Recusar em vez de preencher o que falta é a escolha honesta: o
   * item de lá pode ter objetivo escrito por alguém, e sobrescrevê-lo violaria a
   * mesma régua que vale na mesclagem com o documento do áudio.
   */
  const chaveDoItem = chaveDeAssunto(item.assunto);
  const jaEstaLa = destino.itens.some(
    (i) =>
      (item.cardId && i.cardId === item.cardId) ||
      (!!chaveDoItem && chaveDeAssunto(i.assunto) === chaveDoItem),
  );
  if (jaEstaLa) {
    return {
      ok: false,
      motivo:
        "Este assunto já está na pauta daquela reunião. Abra-a para escrever o que se espera dele.",
    };
  }

  /**
   * A CÓPIA, e cada campo dela é uma decisão já tomada em `herdarParaProxima`.
   *
   * O `id` é novo, calculado contra os itens do DESTINO: os ids são sequenciais
   * por ata, e o item que chega encontraria um homônimo do outro lado — duas
   * linhas com a mesma `key` do React, e a escrita de uma caindo na outra.
   */
  const copia: ItemDeAta = {
    ...item,
    id: proximoIdDeItem(destino.itens),
    decisao: "",
    proximaReuniao: false,
    origem: "herdado",
    origemAtaId: origem.id,
    // A cópia chega SEM destino. `levadaParaAtaId` diz que aquela linha já foi
    // passada adiante, e a que acabou de chegar não foi — carregá-lo faria a
    // linha nova nascer se declarando levada para uma reunião que ela nunca viu.
    levadaParaAtaId: "",
    tarefas: item.tarefas.filter((t) => t.status !== "concluida"),
  };

  /**
   * A ORIGEM MANTÉM O ITEM — é o que distingue levar de mover. O que ela NÃO
   * mantém mais é a marca acesa, e essa é a correção.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * O VAZAMENTO QUE ISTO FECHA
   *
   * `proximaReuniao` ficava aceso depois de levar, como registro de que a
   * reunião decidiu levar aquilo adiante. Só que ele não é só registro: é o que
   * `herdarParaProxima` COLHE quando alguém clica em "Abrir a próxima reunião".
   * Os dois caminhos convivem de propósito — um serve à reunião já marcada, o
   * outro à que ainda vai ser —, e enquanto nenhum sabia do outro, levar e
   * depois abrir punha o mesmo assunto em duas reuniões futuras.
   *
   * Em produção, no dia em que isto foi escrito: a ata de 26/08/2026 das
   * Cantinas tinha seis itens marcados que já estavam gravados na ata de 16/09.
   * Um clique em "Abrir a próxima reunião" teria criado uma quinta ata com os
   * seis duplicados, sem erro e sem aviso — que é exatamente a forma que a
   * queixa de quem conduz tomou: "o mesmo assunto está em várias reuniões".
   *
   * ─────────────────────────────────────────────────────────────────────────
   * O REGISTRO NÃO SE PERDE — ele fica MELHOR
   *
   * `levadaParaAtaId` responde a mesma pergunta que a marca respondia ("a
   * reunião decidiu levar isto adiante?") e mais uma que ela nunca respondeu:
   * PARA ONDE. É o par de `origemAtaId`, e é o que permite a tela trocar o botão
   * "Levar" por "levado para 16/09", com link. A marca acesa dizia à pessoa que
   * havia algo pendente de acontecer; o ponteiro diz que já aconteceu, e onde.
   */
  const marcado = { ...item, proximaReuniao: false, levadaParaAtaId: destino.id };
  const existeNaOrigem = origem.itens.some((i) => i.id === item.id);
  return {
    ok: true,
    valor: {
      origem: existeNaOrigem
        ? origem.itens.map((i) => (i.id === item.id ? marcado : i))
        : // O FANTASMA VIRA ITEM DE VERDADE. O `id` dele é o `cardId`, que não
          // serve como id de item gravado: ele colidiria com o próximo item novo
          // que herdasse aquele card. Mesma renumeração de `vincularCard`.
          [...origem.itens, { ...marcado, id: proximoIdDeItem(origem.itens) }],
      destino: [...destino.itens, copia],
    },
  };
}
