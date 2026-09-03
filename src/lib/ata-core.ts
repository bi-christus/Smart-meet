/**
 * A ata da reunião: o que foi decidido sobre cada demanda, e o que fica de tarefa.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * fala com o banco é `ata.ts`, o irmão, e é isto que permite
 * `scripts/test-ata.mjs` rodar a montagem inteira da pauta em Node puro.
 *
 * POR QUE ESTA COLEÇÃO EXISTE — e é uma ata de reunião de verdade que a pediu,
 * a das cantinas. O que ela registrou, em uma frase: o grupo saía das reuniões
 * "sem nada para fazer amanhã". As pautas se misturavam, nada ficava medido, e
 * a sensação de estagnação vinha de não haver objetivo comum. A decisão foi
 * organizar a reunião POR DEMANDA, com a dimensão ao lado como classificador —
 * e não por dimensão, com as demandas dentro. Houve divergência declarada sobre
 * isso, e prevaleceu a demanda, pelo motivo que este arquivo inteiro serve:
 * assim cada participante sai com tarefa no nome.
 *
 * A ATA É UM REGISTRO, NÃO UMA VISTA DO QUADRO. É a decisão mais importante
 * daqui, e ela explica por que `decisao`, `objetivo` e `tarefas` moram no
 * documento da ata em vez de no card:
 *
 *   - A ata responde "o que foi decidido no dia 26/08". Se ela lesse o card, a
 *     resposta mudaria toda vez que alguém mexesse na demanda, e a ata da
 *     semana passada passaria a contar outra história — que é precisamente o
 *     que uma ata existe para impedir.
 *   - O card responde "como esta demanda está agora". Esse é o trabalho dele, e
 *     ele continua fazendo: status e prazo aparecem na ata LIDOS do card, ao
 *     vivo, e é por isso que eles não são copiados para dentro dela.
 *
 * A regra prática que sai daí: o que é DECISÃO fica na ata; o que é ESTADO vem
 * do card. Quando estiver em dúvida sobre onde um campo novo mora, pergunte se
 * ele deveria mudar sozinho depois que a reunião acabou.
 */

// A regra de "este card conta como entregue" é UMA no app inteiro e mora em
// `entregas-core`. A ata lê a mesma que o Rank, os emblemas e a árvore de
// Dimensões — o pior defeito possível aqui seria a ata dizer "concluída" sobre
// uma demanda que o quadro ainda mostra em andamento.
import { ehEntrega, type CardContavel, type EntreguePorSetor } from "./entregas-core.ts";

// "Esta demanda está atrasada?" também é uma só, e é a mesma que pinta o selo
// de prazo do card.
import { estaAtrasada, inicioDoDia } from "./prazo-core.ts";

export type { EntreguePorSetor };

/** Quanto cabe no texto de uma tarefa, de uma decisão e de um objetivo. */
export const LIMITE_TAREFA_CHARS = 160;
export const LIMITE_TEXTO_CHARS = 600;

/**
 * O estado de uma tarefa derivada da reunião.
 *
 * Três, e não os cinco do quadro. A tarefa de ata é miúda por natureza —
 * "agendar com o time de Suprimentos", "aplicar o formulário" — e um estado a
 * mais é uma linha a mais para manter atualizada numa tabela que se preenche
 * durante a reunião, com o cronômetro correndo. Quem precisa de mais que três
 * estados está descrevendo uma demanda, e demanda tem quadro.
 */
export const STATUS_TAREFA = ["pendente", "andamento", "concluida"] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];

export const STATUS_TAREFA_LABEL: Record<StatusTarefa, string> = {
  pendente: "Pendente",
  andamento: "Em andamento",
  concluida: "Concluída",
};

export type TarefaDeAta = {
  /** Único dentro do item, e NUNCA reaproveitado — ver `proximoIdDeTarefa`. */
  id: string;
  texto: string;
  /** E-mail do responsável, ou vazio enquanto ninguém assumiu. */
  responsavel: string;
  /** `aaaa-mm-dd`, ou vazio. */
  prazo: string;
  status: StatusTarefa;
  observacao: string;
};

/**
 * A procedência de uma linha da pauta — ver o campo `origem` de `ItemDeAta`.
 *
 * A ordem do array é a que a tela usa para agrupar e para o filtro, e ela é a
 * do fluxo da reunião: o que a gravação trouxe, o que se lançou à mão, e o que
 * veio pendurado de outra reunião.
 */
export const ORIGENS_DO_ITEM = ["reuniao", "manual", "herdado"] as const;
export type OrigemDoItem = (typeof ORIGENS_DO_ITEM)[number];

/**
 * O rótulo do chip, e ele fala do PASSADO da linha, não do formato dela.
 *
 * "do áudio" e não "gerado pela IA": quem transcreve e redige é o Cowork, fora
 * deste repositório, e o que a ata recebe é um documento estruturado — chamar
 * aquilo de IA na tela prometeria um julgamento que o parser não faz (ver o
 * cabeçalho de `ata-de-reuniao-core.ts`).
 *
 * O `herdado` não está aqui: o rótulo dele carrega a reunião de origem
 * ("veio de 26/08") e por isso é montado na tela, que é quem sabe resolver
 * `origemAtaId` em data.
 */
export const ORIGEM_LABEL: Record<OrigemDoItem, string> = {
  reuniao: "do áudio",
  manual: "lançado à mão",
  herdado: "veio de outra reunião",
};

/**
 * O que a reunião registrou sobre UM assunto.
 *
 * Quando o assunto já é demanda, guarda-se `cardId` e mais nada do card:
 * título, área e status são lidos do quadro na hora de desenhar. Copiar o
 * título para cá faria a ata mostrar o nome velho depois do primeiro rename — o
 * mesmo defeito que `tags-ref.ts` documenta, e pela mesma razão (nome é cópia;
 * id é referência).
 *
 * NEM TODO ASSUNTO É DEMANDA, e é por isso que `cardId` pode estar vazio. Uma
 * reunião discute coisas que ainda não têm card — e forçar um card para poder
 * registrar a decisão inverteria a ordem das coisas: o card nasceria da
 * necessidade de escrever a ata, e não de alguém decidir que aquilo é trabalho.
 * A fronteira de demandas existe justamente para impedir isso. Enquanto não há
 * card, o assunto e o contexto moram aqui; quando houver, `cardId` passa a
 * responder por eles e estes dois viram histórico do que a reunião chamou.
 *
 * A TRAVESSIA DE UM PARA O OUTRO mora em `ata-demanda-core.ts`, e ela é sempre
 * um clique humano: `vincularCard` preenche este campo no mesmo lote em que o
 * card nasce. Nada aqui preenche `cardId` sozinho.
 */
export type ItemDeAta = {
  /**
   * Único dentro da ata, e estável: é a chave da linha na tela e o alvo de toda
   * escrita. Antes deste campo o `cardId` fazia esse papel, o que só funcionava
   * enquanto todo item tinha card.
   */
  id: string;
  /** O card do quadro, quando este assunto já é demanda. Vazio = ainda não é. */
  cardId: string;
  /** Como a reunião chamou o assunto. Só é lido quando não há card. */
  assunto: string;
  /** O que a reunião registrou em volta da decisão. Só é lido quando não há card. */
  contexto: string;
  /**
   * A classificação do assunto que ainda não é demanda. Quando há card, quem
   * responde é o card — a dimensão é estado, e estado vem do quadro.
   */
  dimensaoId: string;
  subdimensaoId: string;
  /**
   * De onde esta linha da pauta veio — e as três são coisas diferentes.
   *
   * A pauta desenhava tudo igual, e isso escondia a pergunta que quem conduz a
   * reunião faz primeiro: "isto o áudio trouxe, alguém lançou antes, ou é
   * assunto que ficou pendurado da semana passada?". Sem a resposta, o mesmo
   * bloco de tela ora era registro do que foi dito, ora era pauta que alguém
   * combinou de trazer — e a reunião de 02/09/2026 teve as três origens na
   * mesma ata, sem nada distinguindo.
   *
   * Ela também é o que permite a mesclagem com o documento do áudio saber o que
   * pode preencher: o que humano escreveu não se sobrescreve.
   *
   *   - `reuniao`  — saiu de um bloco de "Pontos importantes" (`blocoParaItem`)
   *   - `manual`   — alguém digitou em "Novo assunto" (`conferirAssuntoNovo`)
   *   - `herdado`  — foi copiado de outra reunião (`herdarParaProxima`)
   */
  origem: OrigemDoItem;
  /**
   * Só no `herdado`: a ata de onde o assunto foi copiado. Vazio nos outros.
   *
   * GUARDA ID, e não o título nem a data da reunião de origem — mesma regra de
   * `tags-ref.ts` e do `cardId` acima: nome é cópia, id é referência. A reunião
   * de origem pode ser renomeada ou ter a data corrigida, e o chip da tela tem
   * de continuar dizendo a verdade. Quem resolve o rótulo é a tela, que já lê a
   * lista de atas do setor.
   */
  origemAtaId: string;
  /** O que ficou decidido. Vazio = a demanda foi discutida e nada se decidiu. */
  decisao: string;
  /** O que se espera ter na próxima reunião. */
  objetivo: string;
  /** Levada para a pauta da próxima. */
  proximaReuniao: boolean;
  tarefas: TarefaDeAta[];
};

export type Ata = {
  id: string;
  /** Setor de execução dono desta ata. É por ele que a regra do Firestore fecha. */
  setor: string;
  titulo: string;
  /** `aaaa-mm-dd`. */
  data: string;
  /** "09:00" e "10:30", ou vazios. */
  horaInicio: string;
  horaFim: string;
  local: string;
  /** E-mail de quem conduz. */
  facilitador: string;
  /** E-mails. */
  participantes: string[];
  /**
   * Os nomes que a reunião citou, como ela os citou.
   *
   * Separado de `participantes` porque são coisas diferentes: participante é
   * gente do app, com e-mail, que pode receber tarefa; citado é um nome ouvido
   * na gravação, que pode nem ter conta. Enfiar um nome solto em
   * `participantes` daria um avatar que não leva a lugar nenhum e um e-mail que
   * não existe — e o campo é usado para decidir quem responde pelo quê.
   */
  citados: string[];
  /** A reunião gravada que originou esta ata, quando houve uma. */
  meetingId: string | null;
  itens: ItemDeAta[];
  createdBy?: string;
};

/** O texto como ele vai para o banco: sem sobra de espaço, no teto. */
export function limparTexto(bruto: unknown, teto = LIMITE_TEXTO_CHARS): string {
  return String(bruto ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, teto)
    .trim();
}

/**
 * O mesmo, para o campo que aceita PARÁGRAFO — decisão e objetivo.
 *
 * `limparTexto` faz `replace(/\s+/g, " ")`, e isso engolia a quebra de linha.
 * Os dois campos são `<textarea>` com altura calculada para até oito linhas: o
 * Enter é o comportamento esperado ali, e a decisão que vem do documento da
 * reunião já chega com mais de uma frase. O que acontecia era invisível e
 * irreversível — a pessoa escrevia em três parágrafos, a escrita ia inteira
 * para o banco, e o snapshot de volta devolvia tudo numa linha só, sem nada na
 * tela dizendo que o texto tinha sido reescrito.
 *
 * O que ele ainda aparta: espaço e tabulação sobrando DENTRO da linha, e mais de
 * duas quebras seguidas. Parágrafo é separação, não espaço em branco vertical —
 * e um `<textarea>` colado de outro lugar chega com cinco quebras com
 * frequência.
 */
export function limparParagrafo(bruto: unknown, teto = LIMITE_TEXTO_CHARS): string {
  return String(bruto ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, teto)
    .trim();
}

/**
 * A chave de comparação de um texto: sem acento, sem caixa, sem sobra.
 *
 * MORA AQUI, e não em quem a usa, porque três módulos fazem a mesma pergunta e
 * ela tem de ter uma resposta só. `ata-de-reuniao-core` casa bloco do documento
 * com item da pauta; `ata-demanda-core` pergunta se o assunto já está na pauta da
 * reunião de destino. Se as duas normalizassem por conta própria, bastaria uma
 * delas parar de tirar o acento para o casamento falhar em silêncio — nenhum
 * erro, nenhuma linha vermelha, só um assunto duplicado numa pauta.
 *
 * É a mesma normalização de `semear-cantinas.mjs` e do `varrer-mencoes` do
 * Cowork, e pelo mesmo motivo: onde dá para casar por texto exato, casar por
 * texto exato não erra em silêncio.
 */
export function chaveDeTexto(bruto: unknown): string {
  return String(bruto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

/**
 * O mesmo, para ASSUNTO — a numeração do cabeçalho sai antes.
 *
 * "1. Método da reunião" e "Método da reunião" são o mesmo assunto: a numeração
 * é da leitura em voz alta ("vamos ao três"), sobrevive no `assunto` da proposta
 * que gerou um card, e não sobrevive no do item (`lerPontosImportantes` já a
 * tira). Tirá-la dos dois lados é mais barato do que confiar em qual deles a tem.
 */
export function chaveDeAssunto(bruto: unknown): string {
  return chaveDeTexto(String(bruto ?? "").replace(/^\d+\.\s*/, ""));
}

/**
 * O próximo id de tarefa — sempre MAIOR que todos, nunca um buraco reaproveitado.
 *
 * Mesma regra e mesmo motivo de `proximoIdDeSub` em `dimensoes-core`: id
 * reaproveitado faz a tarefa nova herdar em silêncio o que a apagada deixou
 * para trás. Aqui o que ela herdaria é a linha aberta de um `key` do React no
 * meio de uma edição, e o efeito visível seria o responsável de uma tarefa
 * aparecendo em outra.
 */
export function proximoIdDeTarefa(tarefas: readonly TarefaDeAta[]): string {
  const maior = tarefas.reduce((m, t) => {
    const n = Number(t.id);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(maior + 1);
}

/**
 * O próximo id de item — mesma regra e mesmo motivo de `proximoIdDeTarefa`.
 *
 * O id migrado de uma ata antiga é o `cardId` (ver `normalizarItem`), que não é
 * numérico; `Number("abc")` não é finito e simplesmente não conta, então o
 * primeiro item novo de uma ata migrada nasce como "1" sem colidir com nada.
 */
export function proximoIdDeItem(itens: readonly ItemDeAta[]): string {
  const usados = new Set(itens.map((i) => i.id));
  const maior = itens.reduce((m, i) => {
    const n = Number(i.id);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  let n = maior + 1;
  while (usados.has(String(n))) n++;
  return String(n);
}

/** Uma tarefa nova, vazia, pronta para a linha da tabela. */
export function tarefaNova(tarefas: readonly TarefaDeAta[]): TarefaDeAta {
  return {
    id: proximoIdDeTarefa(tarefas),
    texto: "",
    responsavel: "",
    prazo: "",
    status: "pendente",
    observacao: "",
  };
}

function normalizarTarefa(bruto: unknown, i: number): TarefaDeAta | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const id = typeof b.id === "string" && b.id ? b.id : String(i + 1);
  const status = STATUS_TAREFA.includes(b.status as StatusTarefa)
    ? (b.status as StatusTarefa)
    : "pendente";
  return {
    id,
    texto: limparTexto(b.texto, LIMITE_TAREFA_CHARS),
    responsavel: typeof b.responsavel === "string" ? b.responsavel : "",
    prazo: /^\d{4}-\d{2}-\d{2}$/.test(String(b.prazo ?? "")) ? String(b.prazo) : "",
    status,
    observacao: limparTexto(b.observacao),
  };
}

/**
 * @param origemPadrao O que assumir quando o item não traz `origem` gravada.
 *   NÃO é um valor fixo, e não pode ser: nenhuma ata gravada antes desta versão
 *   tem o campo, e a de 26/08 nasceu inteira do documento da reunião — um
 *   padrão `"manual"` cravado a marcaria toda como lançada à mão, que é
 *   afirmação errada sobre uma reunião de verdade. Quem decide é `normalizarAta`
 *   pela presença de `meetingId`, e o porquê está lá.
 */
function normalizarItem(
  bruto: unknown,
  origemPadrao: OrigemDoItem,
): ItemDeAta | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const cardId = typeof b.cardId === "string" ? b.cardId : "";
  const assunto = limparTexto(b.assunto, 200);
  // Sem card e sem assunto não há o que desenhar na linha — some em silêncio,
  // pela mesma razão que um item sem `cardId` sumia antes de existir assunto.
  if (!cardId && !assunto) return null;
  // ID MIGRADO DO `cardId`. Até esta versão o `cardId` era a chave da linha, e
  // era única por item; reaproveitá-lo como `id` faz toda ata já gravada abrir
  // com identidade estável, sem script de migração e sem reescrever nada.
  const id = typeof b.id === "string" && b.id ? b.id : cardId;
  const tarefas = Array.isArray(b.tarefas)
    ? b.tarefas.map(normalizarTarefa).filter((t): t is TarefaDeAta => !!t)
    : [];
  // Id repetido dentro do mesmo item é o único estado que quebra a edição (duas
  // linhas com a mesma `key`); o segundo é renumerado em vez de descartado,
  // porque descartar apagaria uma tarefa de alguém por causa de um id.
  const vistos = new Set<string>();
  tarefas.forEach((t) => {
    if (vistos.has(t.id)) t.id = proximoIdDeTarefa(tarefas);
    vistos.add(t.id);
  });
  return {
    id,
    cardId,
    assunto,
    contexto: limparTexto(b.contexto),
    dimensaoId: typeof b.dimensaoId === "string" ? b.dimensaoId : "",
    subdimensaoId: typeof b.subdimensaoId === "string" ? b.subdimensaoId : "",
    origem: ORIGENS_DO_ITEM.includes(b.origem as OrigemDoItem)
      ? (b.origem as OrigemDoItem)
      : origemPadrao,
    // Só o `herdado` guarda de onde veio. Num item de outra origem o campo é
    // ruído — e um `origemAtaId` sobrevivente de um "Mover" faria o chip
    // "lançado à mão" carregar um link para uma reunião que nada tem com ele.
    origemAtaId:
      b.origem === "herdado" && typeof b.origemAtaId === "string"
        ? b.origemAtaId
        : "",
    // Os dois únicos campos de parágrafo da ata — ver `limparParagrafo`.
    decisao: limparParagrafo(b.decisao),
    objetivo: limparParagrafo(b.objetivo),
    proximaReuniao: b.proximaReuniao === true,
    tarefas,
  };
}

/**
 * Lê o documento como se ele pudesse estar em qualquer estado — e ele pode.
 *
 * Mesmo partido de `normalizarSetores` e `normalizarDimensao`: é um documento
 * que a tela edita, que o console do Firebase altera à mão e que uma versão
 * antiga do app pode ter gravado sem campo nenhum. Item sem `cardId` não tem o
 * que desenhar e sai em silêncio; o resto passa com o padrão no lugar do que
 * faltou. Uma ata que não abre é pior do que uma ata com um item a menos.
 */
export function normalizarAta(id: string, bruto: unknown): Ata | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const setor = typeof b.setor === "string" ? b.setor : "";
  if (!setor) return null;
  const meetingId = typeof b.meetingId === "string" && b.meetingId ? b.meetingId : null;
  /**
   * A ORIGEM PADRÃO SAI DA ATA, e é o que dispensa script de migração.
   *
   * Nenhum item gravado antes desta versão tem `origem`, e as duas respostas
   * possíveis erram em metade do banco se aplicadas às cegas. O `meetingId`
   * desempata sem adivinhar nada:
   *
   *   - ata COM `meetingId` nasceu por `api/ata/gerar`, e todo item dela veio
   *     de um bloco de "Pontos importantes" — a rota é o único caminho para uma
   *     ata com reunião ligada, e ela monta a pauta inteira do documento;
   *   - ata SEM `meetingId` nasceu por "Abrir a próxima reunião", e o que ela
   *     tem foi digitado por alguém ou herdado da anterior. `manual` é a
   *     resposta honesta: nada no documento gravado distingue os dois, e chamar
   *     de `herdado` sem `origemAtaId` daria um chip que promete um link e não
   *     tem para onde levar.
   *
   * Vale só para o que já estava lá. Daqui para a frente cada caminho grava a
   * sua — ver a tabela no cabeçalho de `origem`.
   */
  const origemPadrao: OrigemDoItem = meetingId ? "reuniao" : "manual";
  return {
    id,
    setor,
    titulo: limparTexto(b.titulo, 120) || "Reunião sem título",
    data: /^\d{4}-\d{2}-\d{2}$/.test(String(b.data ?? "")) ? String(b.data) : "",
    horaInicio: /^\d{2}:\d{2}$/.test(String(b.horaInicio ?? "")) ? String(b.horaInicio) : "",
    horaFim: /^\d{2}:\d{2}$/.test(String(b.horaFim ?? "")) ? String(b.horaFim) : "",
    local: limparTexto(b.local, 80),
    facilitador: typeof b.facilitador === "string" ? b.facilitador : "",
    participantes: Array.isArray(b.participantes)
      ? [...new Set(b.participantes.filter((p): p is string => typeof p === "string" && !!p))]
      : [],
    citados: Array.isArray(b.citados)
      ? [...new Set(b.citados.filter((c): c is string => typeof c === "string" && !!c))]
      : [],
    meetingId,
    itens: idsUnicos(
      Array.isArray(b.itens)
        ? b.itens
            .map((x) => normalizarItem(x, origemPadrao))
            .filter((x): x is ItemDeAta => !!x)
        : [],
    ),
    createdBy: typeof b.createdBy === "string" ? b.createdBy : undefined,
  };
}

/**
 * Id repetido entre itens quebra a edição do mesmo jeito que quebra entre
 * tarefas: duas linhas com a mesma `key` do React, e a escrita de uma caindo na
 * outra. O segundo é renumerado, nunca descartado — descartar apagaria da tela
 * um assunto inteiro da reunião por causa de um id.
 */
function idsUnicos(itens: ItemDeAta[]): ItemDeAta[] {
  const vistos = new Set<string>();
  itens.forEach((i) => {
    if (!i.id || vistos.has(i.id)) i.id = proximoIdDeItem(itens);
    vistos.add(i.id);
  });
  return itens;
}

/** Ata sem item nenhum, para o formulário de criação. */
export function ataVazia(setor: string, data: string): Omit<Ata, "id"> {
  return {
    setor,
    titulo: "",
    data,
    horaInicio: "",
    horaFim: "",
    local: "",
    facilitador: "",
    participantes: [],
    citados: [],
    meetingId: null,
    itens: [],
  };
}

// ---------------------------------------------------------------------------
// A pauta: as demandas da reunião, na ordem em que se fala delas
// ---------------------------------------------------------------------------

/** O recorte de card que a pauta lê. */
export type CardDaPauta = CardContavel & {
  id: string;
  title: string;
  description?: string;
  due?: string | null;
  dimensaoId?: string | null;
  subdimensaoId?: string | null;
};

/**
 * O estado da demanda como a ata o conta, e ele NÃO é a coluna do quadro.
 *
 * A ata da reunião pediu uma leitura por decisão, não por etapa: "pendente
 * decisão" é a demanda que está na pauta e sobre a qual nada foi decidido — e
 * essa é a informação que faz alguém falar dela na reunião. As outras três são
 * do quadro, lidas ao vivo.
 */
export type EstadoNaAta =
  | "atrasada"
  | "andamento"
  | "pendente"
  | "concluida"
  | "registro";

export const ESTADO_LABEL: Record<EstadoNaAta, string> = {
  atrasada: "Atrasada",
  andamento: "Em andamento",
  pendente: "Pendente decisão",
  concluida: "Concluída",
  registro: "Registro",
};

/**
 * A ordem em que os estados aparecem no painel e no filtro.
 *
 * Existe para que a lista lateral e o filtro não repitam o mesmo array literal
 * em dois lugares — quando "registro" nasceu, os dois teriam de ser lembrados,
 * e é o tipo de coisa que se lembra num e no outro não.
 */
export const ESTADOS_NA_ATA: readonly EstadoNaAta[] = [
  "atrasada",
  "andamento",
  "pendente",
  "concluida",
  "registro",
];

/**
 * A ORDEM É A DA GRAVIDADE, e é ela que ordena a pauta.
 *
 * Quem abre a ata com trinta minutos de reunião pela frente precisa que o que
 * está atrasado esteja em cima. Ordem alfabética ou de criação faria a reunião
 * gastar os primeiros dez minutos no que menos importa — que é a queixa
 * registrada na ata que originou esta tela.
 */
const PESO: Record<EstadoNaAta, number> = {
  atrasada: 0,
  pendente: 1,
  andamento: 2,
  concluida: 3,
  // Depois até das concluídas, e de propósito: registro é o que a reunião
  // anotou sem pedir nada de ninguém. Ele entrou porque os blocos "Outros
  // pontos" e "Em aberto" do documento chegavam sem decisão e, contados como
  // "pendente decisão", abriam a pauta — empurrando para baixo os seis assuntos
  // sobre os quais a reunião de fato decidiu alguma coisa.
  registro: 4,
};

export function estadoNaAta(
  card: CardDaPauta | null,
  item: ItemDeAta | undefined,
  entregues: EntreguePorSetor,
  hoje: number,
): EstadoNaAta {
  // Assunto que ainda não é demanda não tem quadro, e por isso não pode estar
  // "atrasado" nem "concluído": os dois são estado de card. Sobra a leitura por
  // decisão — e uma distinção que só aparece aqui: um assunto sobre o qual a
  // reunião não decidiu, não pediu e não prometeu nada não está "pendente
  // decisão", está anotado. É o caso de "Outros pontos" e "Em aberto", que o
  // documento da reunião traz como apêndice; chamá-los de pendentes os colocaria
  // na frente dos assuntos que realmente esperam alguém decidir.
  if (!card) {
    if (item?.decisao) return "andamento";
    if (item?.objetivo || item?.tarefas.length) return "pendente";
    return "registro";
  }
  if (ehEntrega(card, entregues)) return "concluida";
  // `false` no segundo argumento: a pergunta "já foi entregue?" acabou de ser
  // respondida na linha acima, e passá-la de novo daria duas fontes para a
  // mesma verdade.
  if (estaAtrasada(card.due, false, hoje)) return "atrasada";
  // Sem decisão registrada, a demanda está na pauta esperando uma. Um item que
  // nunca foi tocado e um item cuja decisão foi apagada são a mesma coisa aqui,
  // e é de propósito: os dois precisam ser falados.
  if (!item?.decisao) return "pendente";
  return "andamento";
}

/** Uma linha da pauta: a demanda, o que a reunião registrou, e o estado de hoje. */
export type ItemDaPauta = {
  /** O card do quadro, ou `null` no assunto que ainda não é demanda. */
  card: CardDaPauta | null;
  item: ItemDeAta;
  /** O que a tela imprime: o título do card, ou o assunto que a reunião deu. */
  titulo: string;
  descricao: string;
  estado: EstadoNaAta;
  /** "01", "02"… — a numeração que a tela imprime, sempre na ordem final. */
  numero: string;
  /** Nome da dimensão e da subdimensão, quando classificada. */
  dimensao: string;
  subdimensao: string;
  /**
   * O item aponta para um card que não está mais no quadro do setor.
   *
   * Lixeira, mudança de setor, exclusão definitiva. A linha continua na pauta —
   * a decisão da reunião não some porque a demanda saiu —, mas ela não tem
   * estado, prazo nem responsável para mostrar, e a tela precisa dizer por quê.
   * Sem este campo, ela leria como um assunto que nunca virou demanda, que é
   * uma história diferente da verdadeira.
   */
  foraDoQuadro?: boolean;
};

/** O mínimo que a pauta precisa da árvore de dimensões. */
export type DimensaoDaPauta = {
  id: string;
  nome: string;
  ordem: number;
  subs: { id: string; nome: string }[];
};

/** Item vazio, para a demanda que entrou na pauta e ainda não foi tocada. */
function itemVazio(cardId: string): ItemDeAta {
  return {
    // O id do item ainda não existe: ele só nasce quando alguém escreve alguma
    // coisa, e aí `gravarItem` o cria. Usar o `cardId` aqui é o que mantém a
    // `key` do React estável entre o item fantasma e o item gravado.
    id: cardId,
    cardId,
    assunto: "",
    contexto: "",
    dimensaoId: "",
    subdimensaoId: "",
    // A demanda que entrou na pauta pelo QUADRO, e não pela reunião: ninguém a
    // digitou aqui e nenhum bloco do áudio a trouxe. `manual` é o mais próximo
    // da verdade, e é inofensivo — a tela não desenha chip em linha com card,
    // porque lá a procedência de que se fala é a do card.
    origem: "manual",
    origemAtaId: "",
    decisao: "",
    objetivo: "",
    proximaReuniao: false,
    tarefas: [],
  };
}

/**
 * Monta a pauta: uma linha por demanda, ordenada por gravidade e numerada.
 *
 * QUAIS DEMANDAS ENTRAM. Todas as do setor que estão em aberto, mais as que a
 * ata já registrou — inclusive as concluídas. A segunda metade é o que faz a
 * ata continuar sendo ata: uma demanda decidida na reunião e entregue no dia
 * seguinte sairia da lista, e a decisão sobre ela sumiria do documento que a
 * registrou.
 *
 * A DIMENSÃO VAI AO LADO, e não por cima. É a decisão da ata das cantinas, e
 * está no cabeçalho deste arquivo: agrupar por dimensão foi a proposta que NÃO
 * prevaleceu, porque ela produz uma reunião em que se discute a caixa em vez do
 * trabalho, e ninguém sai com tarefa. Aqui a dimensão é texto ao lado do
 * título, exatamente como "Área: Suprimentos".
 *
 * O `numero` é atribuído DEPOIS da ordenação, e nunca antes: numerar na ordem
 * do banco e depois reordenar daria uma pauta que começa em "07", e a numeração
 * existe para que alguém possa dizer "vamos ao três" em voz alta.
 */
export function montarPauta(opcoes: {
  cards: readonly CardDaPauta[];
  ata: Pick<Ata, "itens">;
  dimensoes: readonly DimensaoDaPauta[];
  entregues: EntreguePorSetor;
  /** Milissegundos de hoje à meia-noite — entra por parâmetro para poder testar. */
  hoje: number;
}): ItemDaPauta[] {
  const { cards, ata, dimensoes, entregues } = opcoes;
  const hoje = inicioDoDia(opcoes.hoje);
  // Só entra no índice o item que aponta para card. Os demais são a terceira
  // origem, logo abaixo — e uma chave vazia colidiria todos eles num só.
  const porCard = new Map<string, ItemDeAta>();
  ata.itens.forEach((i) => {
    if (i.cardId) porCard.set(i.cardId, i);
  });

  const nomeDim = new Map(dimensoes.map((d) => [d.id, d.nome]));
  const nomeSub = new Map<string, string>();
  dimensoes.forEach((d) => d.subs.forEach((s) => nomeSub.set(`${d.id}/${s.id}`, s.nome)));

  const linha = (
    card: CardDaPauta | null,
    item: ItemDeAta | undefined,
    dimensaoId: string,
    subdimensaoId: string,
  ) => ({
    card,
    item: item ?? itemVazio(card?.id ?? ""),
    titulo: card ? card.title : item?.assunto || "",
    descricao: card ? (card.description ?? "") : item?.contexto || "",
    estado: estadoNaAta(card, item, entregues, hoje),
    numero: "",
    dimensao: (dimensaoId && nomeDim.get(dimensaoId)) || "",
    subdimensao:
      (dimensaoId && subdimensaoId && nomeSub.get(`${dimensaoId}/${subdimensaoId}`)) || "",
  });

  // Quais cards de fato viraram linha. É o conjunto que responde a pergunta da
  // terceira origem, logo abaixo — e ele precisa ser montado aqui, e não a
  // partir de `cards`, porque nem todo card entra (a demanda entregue sem item
  // fica de fora).
  const desenhados = new Set<string>();
  const doQuadro = cards
    .filter((c) => porCard.has(c.id) || !ehEntrega(c, entregues))
    .map((card) => {
      desenhados.add(card.id);
      return linha(
        card,
        porCard.get(card.id),
        card.dimensaoId ?? "",
        card.subdimensaoId ?? "",
      );
    });

  const linhas = [
    ...doQuadro,
    /**
     * A terceira origem: TODO item que não ganhou linha lá em cima.
     *
     * São dois casos, e o segundo levou um tempo para aparecer:
     *
     *   1. O assunto que a reunião discutiu e que ainda não é demanda
     *      (`cardId` vazio). Sumir daqui apagaria da ata a decisão tomada sobre
     *      ele, que é o oposto do que uma ata faz.
     *   2. O item que APONTA para um card que não está mais no quadro — a
     *      demanda foi para a lixeira, mudou de setor ou foi apagada de vez.
     *      Enquanto o filtro aqui era `!i.cardId`, esse item não entrava por
     *      nenhuma das origens: a decisão registrada em 26/08 sobre aquela
     *      demanda simplesmente desaparecia do documento que a registrou.
     *
     * Nos dois casos a linha é desenhada SEM card, caindo no assunto e no
     * contexto que a própria ata guarda. O segundo caso ganha `foraDoQuadro`,
     * porque quem lê precisa saber por que aquela linha não tem estado nem
     * responsável — e a diferença entre "ainda não é demanda" e "era e saiu" é
     * a diferença entre uma pauta e um erro.
     */
    ...ata.itens
      .filter((i) => !i.cardId || !desenhados.has(i.cardId))
      .map((i) => ({
        ...linha(null, i, i.dimensaoId, i.subdimensaoId),
        foraDoQuadro: !!i.cardId,
      })),
  ];

  linhas.sort(
    (a, b) =>
      PESO[a.estado] - PESO[b.estado] ||
      // Dentro do mesmo estado, a ordem é a da dimensão: é o classificador, e
      // manter as da mesma área juntas evita a reunião pular de assunto a cada
      // linha. `ordem` da dimensão, não o nome — é ela que a árvore respeita.
      ordemDaDim(a, dimensoes) - ordemDaDim(b, dimensoes) ||
      a.titulo.localeCompare(b.titulo, "pt-BR"),
  );

  return linhas.map((l, i) => ({ ...l, numero: String(i + 1).padStart(2, "0") }));
}

/**
 * Sem classificação vai para o fim, e não para o começo com `ordem` 0.
 *
 * Quem responde pela dimensão é o CARD quando existe um — dimensão é estado, e
 * estado vem do quadro. Só o assunto que ainda não é demanda carrega a sua.
 */
function ordemDaDim(
  l: { card: CardDaPauta | null; item: ItemDeAta },
  dimensoes: readonly DimensaoDaPauta[],
): number {
  const id = l.card ? l.card.dimensaoId : l.item.dimensaoId;
  const d = dimensoes.find((x) => x.id === id);
  return d ? d.ordem : Number.MAX_SAFE_INTEGER;
}

/** A contagem por estado que vai na coluna da esquerda. */
export type ResumoDaAta = {
  porEstado: Record<EstadoNaAta, number>;
  /** Tudo que não está concluído — o número grande do painel. */
  emAberto: number;
  /** Tarefas da ata inteira, e quantas já foram feitas. */
  tarefas: number;
  tarefasFeitas: number;
};

export function resumoDaAta(pauta: readonly ItemDaPauta[]): ResumoDaAta {
  const porEstado: Record<EstadoNaAta, number> = {
    atrasada: 0,
    andamento: 0,
    pendente: 0,
    concluida: 0,
    registro: 0,
  };
  let tarefas = 0;
  let tarefasFeitas = 0;
  pauta.forEach((l) => {
    porEstado[l.estado]++;
    l.item.tarefas.forEach((t) => {
      tarefas++;
      if (t.status === "concluida") tarefasFeitas++;
    });
  });
  return {
    porEstado,
    // Registro não é trabalho em aberto: é anotação da reunião. Contá-lo aqui
    // inflaria o número grande do painel com linhas que ninguém tem de entregar.
    emAberto: pauta.length - porEstado.concluida - porEstado.registro,
    tarefas,
    tarefasFeitas,
  };
}

/**
 * O que a próxima reunião herda desta: os itens marcados, sem o que já passou.
 *
 * A decisão NÃO vem junto — ela é desta reunião, e repeti-la na próxima faria a
 * ata nova nascer afirmando que decidiu o que outra decidiu. O objetivo vem,
 * porque ele foi escrito olhando para a frente ("validar resultados do piloto"),
 * e é exatamente a pauta que se prometeu.
 *
 * As tarefas concluídas ficam para trás; as abertas seguem. Uma tarefa feita
 * que reaparece na reunião seguinte é a linha que todo mundo aprende a pular, e
 * depois de duas semanas ninguém lê mais a tabela.
 *
 * A CÓPIA NASCE `herdado`, apontando para a ata de onde veio. É o que faz a
 * pauta da reunião nova conseguir dizer "isto ficou pendurado da anterior" em
 * vez de desenhar a linha como se o assunto tivesse nascido ali — que era o
 * estado antes de `origem` existir, e é o que fazia o mesmo assunto ser
 * discutido de novo do zero.
 */
export function herdarParaProxima(ata: Pick<Ata, "id" | "itens">): ItemDeAta[] {
  return ata.itens
    .filter((i) => i.proximaReuniao)
    .map((i) => ({
      id: i.id,
      cardId: i.cardId,
      // Assunto, contexto e classificação vão junto: sem card, são a única
      // coisa que diz do que a linha trata. Deixá-los para trás levaria para a
      // próxima reunião uma pauta de itens sem nome.
      assunto: i.assunto,
      contexto: i.contexto,
      dimensaoId: i.dimensaoId,
      subdimensaoId: i.subdimensaoId,
      // A origem NÃO é preservada, e é o único campo de que isso é verdade: o
      // que esta linha é, na reunião nova, é herança — venha ela de um bloco do
      // áudio da reunião passada ou de alguém que a digitou lá. Preservar diria
      // "do áudio" sobre uma linha que áudio nenhum desta reunião trouxe.
      origem: "herdado" as const,
      origemAtaId: ata.id,
      decisao: "",
      objetivo: i.objetivo,
      proximaReuniao: false,
      tarefas: i.tarefas.filter((t) => t.status !== "concluida"),
    }));
}
