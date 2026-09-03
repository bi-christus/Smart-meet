/**
 * A ata montada a partir da reunião que já foi processada.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` e nada de rede aqui
 * dentro. Ele recebe texto e devolve uma ata; quem busca o documento no Drive e
 * quem grava no banco são `api/ata/gerar` e `scripts/ata-da-reuniao.mjs`. É isso
 * que permite `scripts/test-ata-de-reuniao.mjs` rodar a extração inteira contra
 * documentos de verdade, em Node puro, sem tocar em nada.
 *
 * POR QUE ISTO EXISTE. A aba Ata só sabia nascer vazia: um formulário em branco
 * onde alguém redigitava título, data, participantes e pauta de uma reunião que
 * o sistema já tinha processado inteira. O `meetingId` estava lá em `Ata` desde
 * o primeiro dia e nunca foi preenchido por ninguém.
 *
 * POR QUE SEM IA, E POR QUE ISSO NÃO É UMA LIMITAÇÃO. O app não chama modelo
 * nenhum — quem transcreve e redige é o Cowork, fora deste repositório. Não
 * precisa: o documento "Pontos importantes" JÁ é estruturado, por contrato do
 * prompt `Cowork/Prompts/Pontos Importantes.md`, e a estrutura dele é
 * exatamente a da aba Ata. A regra de ouro do próprio Cowork — "só vira
 * proposta o bloco que tem `✓ Decisão:` ou `→` encaminhamento" — é o mesmo eixo
 * que a ata usa para separar o que foi decidido do que ficou de tarefa.
 *
 * O gabarito, conferido contra os 24 documentos reais gerados até aqui:
 *
 *     # <Título>
 *     <DD/MM/AAAA> · ~<duração> · Citados na conversa: <nomes>
 *
 *     ## 1. <Assunto>
 *     - <contexto>
 *     ✓ Decisão: <o que se decidiu>
 *     ✗ Sem decisão: <o que ficou para depois>
 *     → <quem> <faz o quê> até <quando>
 *
 *     ## Outros pontos
 *     ⚠ Em aberto
 *     - <pendência>
 *
 * ELE DEGRADA PARA MENOS, NUNCA PARA ERRADO. É a propriedade que faz valer a
 * pena depender de um contrato que mora fora deste repositório: se o prompt do
 * Cowork mudar e os sentinelas sumirem, cada bloco vira um item sem decisão e
 * sem tarefa — a ata fica pobre, e a tela continua editável. O que ele nunca
 * faz é inventar uma decisão que a reunião não tomou.
 */

import {
  LIMITE_TAREFA_CHARS,
  LIMITE_TEXTO_CHARS,
  chaveDeAssunto,
  chaveDeTexto,
  limparTexto,
  proximoIdDeItem,
  proximoIdDeTarefa,
  type Ata,
  type DimensaoDaPauta,
  type ItemDeAta,
  type TarefaDeAta,
} from "./ata-core.ts";

/** O recorte da reunião gravada que a ata aproveita. */
export type ReuniaoDaAta = {
  id: string;
  title: string;
  /** `aaaa-mm-dd`. */
  date: string;
  /** E-mails. */
  participants: string[];
  /** E-mail de quem enviou o áudio. */
  createdBy: string;
};

/** Um bloco `## n. Assunto` do documento, já separado por papel. */
export type BlocoDoDocumento = {
  /** O texto do cabeçalho sem a numeração: "Estoque, recebimento e conferência". */
  assunto: string;
  /** Os bullets de contexto, na ordem. */
  contexto: string[];
  /** Uma entrada por `✓ Decisão:`. */
  decisoes: string[];
  /** Uma entrada por `✗ Sem decisão:`. */
  semDecisao: string[];
  /** Uma entrada por `→`. */
  encaminhamentos: string[];
};

export type PontosImportantes = {
  /** O H1 do documento — o título editorial que o Cowork deu à reunião. */
  titulo: string;
  /** `aaaa-mm-dd`, quando o documento traz a data. */
  data: string;
  /** Os nomes que a linha de metadados lista. */
  citados: string[];
  blocos: BlocoDoDocumento[];
};

/** O rótulo do bloco final de pendências, que não tem cabeçalho `##`. */
const ASSUNTO_EM_ABERTO = "Em aberto";

/**
 * Tira do começo da linha o que a viagem até o Google Docs acrescentou.
 *
 * O Cowork escreve `- item`. O Doc guarda isso como lista, e o exportador de
 * volta para Markdown devolve `> * item` — bloco de citação por fora, asterisco
 * por dentro. Os dois convivem no corpus, e às vezes na mesma reunião, então a
 * limpeza tira o que houver em vez de assumir um dos formatos. Os sentinelas
 * (`✓ ✗ → ⚠`) sobrevivem inteiros ao round-trip; é por isso que dá para
 * confiar neles como gramática.
 */
function semEnfeite(linha: string): string {
  return linha
    .replace(/^[\s>]+/, "")
    .replace(/^[*+-]\s+/, "")
    .trim();
}

/**
 * Tira a marcação de dentro da linha. A ata é texto puro.
 *
 * O documento é Markdown e usa negrito com fartura — "criar mais duas
 * categorias: **dimensões** e as **subdivisões**". A tela da ata desenha os
 * campos com `<textarea>` e `<td>`, que não interpretam nada: sem esta limpeza,
 * cada decisão chega com asteriscos no meio da frase, e a ata inteira parece
 * ter sido colada de outro lugar pela metade.
 *
 * Renderizar o Markdown em vez de limpá-lo seria a outra saída, e é pior aqui:
 * os campos são EDITÁVEIS. Quem corrige uma decisão teria de digitar asterisco
 * para manter o negrito, e o primeiro que esquecesse deixaria o texto meio
 * marcado e meio não.
 *
 * O `[CONFERIR …]` sobrevive de propósito: colchete sem parênteses depois não é
 * link, e aquilo é conteúdo — é a dúvida que o Cowork declarou.
 */
function semMarcacao(t: string): string {
  return t
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*/g, "$1")
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

/** O bloco YAML do começo, quando existe — o Cowork o emite de forma irregular. */
function semFrontmatter(md: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

/** `26/08/2026` → `2026-08-26`. Devolve "" para qualquer outra coisa. */
function paraISO(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * Os nomes da linha de metadados.
 *
 * Duas formas convivem no corpus, e a segunda existe justamente porque a
 * transcrição não separa falantes:
 *
 *     … · Citados na conversa: Murilo Brasil, Adeline Freitas
 *     … · Participantes não identificados no áudio (citados na conversa: Kauã, Priscila)
 *
 * O `[CONFERIR …]` que o Cowork gruda num nome de grafia duvidosa sai fora: ele
 * é recado para quem lê a ata, não parte do nome.
 */
function lerCitados(meta: string): string[] {
  const m = /citados na conversa:\s*([^)]*)/i.exec(meta);
  if (!m) return [];
  return m[1]
    .split(/[,;]/)
    .map((n) => n.replace(/\[[^\]]*\]/g, "").trim())
    .filter(Boolean);
}

/**
 * Lê o documento inteiro e o parte em blocos.
 *
 * Exportada porque o teste precisa poder perguntar do documento sem precisar de
 * uma reunião em volta — e porque é aqui que mora tudo o que pode quebrar
 * quando o prompt do Cowork mudar.
 */
export function lerPontosImportantes(markdown: string): PontosImportantes {
  const linhas = semFrontmatter(String(markdown ?? "")).split(/\r?\n/);

  let titulo = "";
  let data = "";
  let citados: string[] = [];
  const blocos: BlocoDoDocumento[] = [];
  let atual: BlocoDoDocumento | null = null;

  const abrir = (assunto: string): BlocoDoDocumento => {
    const bloco: BlocoDoDocumento = {
      assunto,
      contexto: [],
      decisoes: [],
      semDecisao: [],
      encaminhamentos: [],
    };
    blocos.push(bloco);
    return bloco;
  };

  for (const bruta of linhas) {
    const linha = semMarcacao(semEnfeite(bruta));
    if (!linha) continue;

    // A linha "> Relacionados: [[…]]" é navegação do vault do Cowork, e os
    // colchetes duplos não significam nada fora dele.
    if (/^Relacionados:/i.test(linha)) continue;

    if (/^#\s+/.test(linha)) {
      if (!titulo) titulo = linha.replace(/^#\s+/, "").trim();
      continue;
    }

    if (/^##\s+/.test(linha)) {
      // "## 3. Sistema Connect e totens" → "Sistema Connect e totens". A
      // numeração é da leitura em voz alta ("vamos ao três"), e a ata refaz a
      // sua própria depois de ordenar por gravidade — carregar as duas daria
      // uma pauta numerada duas vezes, em ordens diferentes.
      atual = abrir(linha.replace(/^##\s+/, "").replace(/^\d+\.\s*/, "").trim());
      continue;
    }

    // "⚠ Em aberto" abre bloco sem ser cabeçalho: no documento ele vem solto,
    // depois do último "##", e o que vem embaixo dele são as pendências da
    // reunião inteira — não do bloco anterior.
    if (/^⚠\s*Em aberto/i.test(linha)) {
      atual = abrir(ASSUNTO_EM_ABERTO);
      continue;
    }

    // Antes do primeiro bloco só existe a linha de metadados.
    if (!atual) {
      if (!data) data = paraISO(/(\d{2}\/\d{2}\/\d{4})/.exec(linha)?.[1] ?? "");
      if (!citados.length) citados = lerCitados(linha);
      continue;
    }

    const decisao = /^✓\s*Decis[ãa]o:?\s*/i.exec(linha);
    if (decisao) {
      atual.decisoes.push(linha.slice(decisao[0].length).trim());
      continue;
    }
    const sem = /^✗\s*Sem decis[ãa]o:?\s*/i.exec(linha);
    if (sem) {
      atual.semDecisao.push(linha.slice(sem[0].length).trim());
      continue;
    }
    if (/^→\s*/.test(linha)) {
      atual.encaminhamentos.push(linha.replace(/^→\s*/, "").trim());
      continue;
    }
    atual.contexto.push(linha);
  }

  return { titulo, data, citados, blocos };
}

// ---------------------------------------------------------------------------
// Do bloco para o item
// ---------------------------------------------------------------------------


/**
 * A dimensão do assunto, por casamento léxico com a árvore do setor.
 *
 * Determinístico e conservador de propósito: só classifica quando o nome de uma
 * subdimensão aparece INTEIRO dentro do cabeçalho do bloco, com fronteira de
 * palavra. "Estoque, recebimento e conferência" acha "Estoque"; "Sistema
 * Connect e totens" não acha nada e fica sem classificação, que é a resposta
 * honesta — inventar D4 ali seria o app decidindo o que a reunião não decidiu.
 *
 * É a mesma técnica do `varrer-mencoes` do Cowork, e pelo mesmo motivo: onde dá
 * para casar por texto exato, casar por texto exato não erra em silêncio.
 *
 * O nome mais longo ganha, para "Engenharia de cardápio" vencer um eventual
 * "Cardápio" solto em outra dimensão.
 */
function classificar(
  assunto: string,
  dimensoes: readonly DimensaoDaPauta[],
): { dimensaoId: string; subdimensaoId: string } {
  const alvo = chaveDeTexto(assunto);
  let achado = { dimensaoId: "", subdimensaoId: "", tamanho: 0 };
  for (const d of dimensoes) {
    for (const s of d.subs) {
      const nome = chaveDeTexto(s.nome);
      if (!nome || nome.length <= achado.tamanho) continue;
      // `\b` não funciona com acento já removido? Funciona: `chave` remove os
      // diacríticos, então sobra a-z, e a fronteira de palavra vale.
      if (new RegExp(`\\b${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(alvo)) {
        achado = { dimensaoId: d.id, subdimensaoId: s.id, tamanho: nome.length };
      }
    }
  }
  return { dimensaoId: achado.dimensaoId, subdimensaoId: achado.subdimensaoId };
}

/**
 * Um encaminhamento vira uma tarefa — sem responsável e sem prazo.
 *
 * ISTO NÃO É PREGUIÇA, é a regra da casa. `api/demandas/decidir` e o prompt do
 * Cowork dizem a mesma coisa com as mesmas palavras: nunca inventar
 * responsável, prazo ou prioridade. Prazo e nome derivam de número e de nome
 * próprio, que é exatamente o que a transcrição automática erra — e o erro
 * chega aqui com a mesma cara de acerto. "até 27/08" vira uma data que ninguém
 * mais confere; "Ítalo Araújo" vira um e-mail adivinhado a partir de um nome
 * que o cadastro registra como "Italo".
 *
 * Então o texto do encaminhamento entra INTEIRO em `texto`: quem lê a tarefa lê
 * o nome e a data que a reunião falou, e é quem preenche os campos decide se
 * eles estão certos.
 *
 * O que sai do texto é só o `[CONFERIR …]`, que muda de coluna e não some: ele
 * é a dúvida declarada do Cowork, e a coluna de observação é o lugar dela.
 */
function paraTarefa(encaminhamento: string, id: string): TarefaDeAta {
  const conferir: string[] = [];
  const semConferir = encaminhamento
    .replace(/\[\s*CONFERIR[^\]]*\]/gi, (m) => {
      conferir.push(m.trim());
      return " ";
    })
    // "Responsável a definir: pedir nova proposta…" — o prefixo é a forma que o
    // Cowork tem de dizer que ninguém foi nomeado, e o campo vazio já diz isso.
    .replace(/^respons[áa]vel a definir:\s*/i, "");
  return {
    id,
    texto: limparTexto(semConferir, LIMITE_TAREFA_CHARS),
    responsavel: "",
    prazo: "",
    status: "pendente",
    observacao: limparTexto(conferir.join(" ")),
  };
}

/**
 * O bloco do documento vira um item da ata.
 *
 * O mapeamento tem uma escolha que decide como a tela se comporta: `✗ Sem
 * decisão` NÃO vira decisão, vira objetivo, e a decisão fica vazia. Com a
 * decisão vazia o item acende o selo "Pendente decisão" (`estadoNaAta`) e sobe
 * para o topo da pauta — que é precisamente o que se quer de um assunto que a
 * reunião discutiu e não resolveu. Gravar o texto em `decisao` faria a ata
 * afirmar que decidiu não decidir, e o assunto desceria para o meio da lista.
 */
/** Os campos de uma linha de pauta que o documento sabe preencher. */
export const CAMPOS_MESCLAVEIS = ["decisao", "objetivo", "contexto"] as const;
export type CampoMesclavel = (typeof CAMPOS_MESCLAVEIS)[number];

/**
 * O texto que o bloco traz para cada campo — a ÚNICA definição disso.
 *
 * `blocoParaItem` e `planejarMesclagem` precisam concordar caractere por
 * caractere: a segunda decide se um campo seria preenchido comparando este
 * texto com o que está na ata, e a primeira é quem o grava quando o bloco vira
 * item novo. Enquanto as duas repetiam as expressões, bastava uma delas trocar
 * `" · "` por `"; "` para a tela de conferência passar a anunciar preenchimento
 * de um campo que já estava igual — divergência inventada, em toda linha.
 *
 * A escolha de `✗ Sem decisão` virar OBJETIVO, e não decisão, está explicada no
 * cabeçalho de `blocoParaItem`, e é o eixo da tela: com a decisão vazia o item
 * acende "Pendente decisão" e sobe para o topo da pauta.
 */
function textoDoBloco(bloco: BlocoDoDocumento): Record<CampoMesclavel, string> {
  return {
    // Várias decisões no mesmo bloco são várias frases sobre o mesmo assunto —
    // e o assunto é a linha. Juntar com " · " é o que a tela já faz com dimensão
    // e subdimensão, e cabe nos 600 de `limparTexto`.
    decisao: limparTexto(bloco.decisoes.join(" · "), LIMITE_TEXTO_CHARS),
    objetivo: limparTexto(bloco.semDecisao.join(" · "), LIMITE_TEXTO_CHARS),
    contexto: limparTexto(bloco.contexto.join(" · ")),
  };
}

export function blocoParaItem(
  bloco: BlocoDoDocumento,
  id: string,
  dimensoes: readonly DimensaoDaPauta[],
): ItemDeAta {
  const { dimensaoId, subdimensaoId } = classificar(bloco.assunto, dimensoes);
  const texto = textoDoBloco(bloco);
  return {
    id,
    cardId: "",
    assunto: limparTexto(bloco.assunto, 200),
    contexto: texto.contexto,
    dimensaoId,
    subdimensaoId,
    // Esta é a única função do app que produz item `reuniao`: ela é a fronteira
    // entre o documento que o Cowork redigiu e a pauta. O chip que a tela
    // desenha a partir daqui é o que permite a quem conduz a reunião saber que
    // aquela decisão foi extraída da gravação, e não digitada por alguém.
    origem: "reuniao",
    origemAtaId: "",
    decisao: texto.decisao,
    objetivo: texto.objetivo,
    proximaReuniao: false,
    tarefas: bloco.encaminhamentos.map((e, i) => paraTarefa(e, String(i + 1))),
  };
}

/**
 * A ata inteira, pronta para gravar.
 *
 * O CABEÇALHO VEM DA REUNIÃO, NÃO DO DOCUMENTO, e cada campo tem motivo:
 *
 *   - `titulo` é `meeting.title` porque é o nome pelo qual a pessoa reconhece a
 *     reunião em `/reunioes` e em `/relatorios`. O H1 do documento é editorial
 *     ("Cantinas — Estruturação da reunião por dimensões") e muda de safra em
 *     safra do prompt; a ata ficaria com um nome que ninguém procurou.
 *   - `data` é `meeting.date` porque foi digitada por quem esteve lá. A do
 *     documento entra só quando aquela falta: o Cowork marca `[CONFERIR data]`
 *     justamente quando teve de deduzi-la do nome do arquivo.
 *   - `participantes` são e-mails, e por isso saem de `meeting.participants`.
 *     Os nomes ouvidos na gravação vão para `citados`, que é outro campo por
 *     serem outra coisa — ver o comentário dele em `ata-core`.
 *   - `facilitador` é quem enviou o áudio. É aproximação, e é editável.
 *   - `horaInicio`, `horaFim` e `local` nascem vazios. O documento fala deles em
 *     prosa ("início por volta de 17h33", "presencial [CONFERIR sede/sala]"), e
 *     ler prosa como se fosse campo é a maneira mais rápida de encher uma ata
 *     de dado errado com aparência de dado certo.
 */
export function montarAtaDaReuniao(opcoes: {
  markdown: string;
  reuniao: ReuniaoDaAta;
  setor: string;
  dimensoes?: readonly DimensaoDaPauta[];
}): Omit<Ata, "id"> {
  const { markdown, reuniao, setor } = opcoes;
  const dimensoes = opcoes.dimensoes ?? [];
  const doc = lerPontosImportantes(markdown);

  return {
    setor,
    titulo: limparTexto(reuniao.title, 120) || doc.titulo || "Reunião sem título",
    data: /^\d{4}-\d{2}-\d{2}$/.test(reuniao.date) ? reuniao.date : doc.data,
    horaInicio: "",
    horaFim: "",
    local: "",
    facilitador: reuniao.createdBy ?? "",
    participantes: [...new Set((reuniao.participants ?? []).filter(Boolean))],
    citados: doc.citados,
    meetingId: reuniao.id,
    itens: doc.blocos.map((b, i) => blocoParaItem(b, String(i + 1), dimensoes)),
  };
}

/**
 * Liga os itens da ata aos cards que a mesma reunião já produziu.
 *
 * Uma proposta aceita em `api/demandas/decidir` vira card, e a proposta guarda o
 * `assunto` — que, por contrato do sidecar, É o cabeçalho do bloco em "Pontos
 * importantes". Então o casamento é por texto exato, sem heurística: bloco e
 * proposta ou nomeiam a mesma coisa ou não.
 *
 * SÓ LIGA CARD DO MESMO SETOR DA ATA. A pauta lê os cards do setor dela
 * (`montarPauta`), então um `cardId` de outro setor viraria uma linha que
 * aponta para um card que a tela não tem — item mudo, sem título e sem estado.
 * É o caso literal desta primeira ata: a reunião das cantinas correu no setor
 * B.I., e o card que nasceu dela ficou lá.
 */
export function ligarCards(
  itens: ItemDeAta[],
  cards: readonly { id: string; assunto: string }[],
): ItemDeAta[] {
  const porAssunto = indiceDeCards(cards);
  const usados = new Set<string>();
  return itens.map((i) => {
    if (i.cardId) return i;
    const cardId = porAssunto.get(chaveDeAssunto(i.assunto));
    if (!cardId || usados.has(cardId)) return i;
    usados.add(cardId);
    return { ...i, cardId };
  });
}

/** Card por assunto que o originou. O primeiro ganha, como em `ligarCards`. */
function indiceDeCards(
  cards: readonly { id: string; assunto: string }[],
): Map<string, string> {
  const porAssunto = new Map<string, string>();
  cards.forEach((c) => {
    const k = chaveDeAssunto(c.assunto);
    if (k && !porAssunto.has(k)) porAssunto.set(k, c.id);
  });
  return porAssunto;
}

// ---------------------------------------------------------------------------
// Puxar o documento para uma ata que JÁ tem pauta
// ---------------------------------------------------------------------------

/**
 * A MESCLAGEM, e por que ela precisou existir separada de `montarAtaDaReuniao`.
 *
 * `montarAtaDaReuniao` monta uma ata do zero, e é o certo quando a reunião não
 * tem ata nenhuma. O que faltava era o caso comum: a reunião JÁ tem ata, feita
 * antes de o áudio ficar pronto — porque a equipe lança os assuntos que quer
 * discutir antes de entrar na sala, e porque "Levar para próxima reunião" já
 * deixou lá o que ficou pendurado da semana passada. Foi exatamente o estado da
 * ata de 02/09/2026 das Cantinas.
 *
 * Sem mesclagem, o único caminho era gerar uma SEGUNDA ata da mesma reunião no
 * mesmo setor: mesma data, mesmo título na lista, uma com o que as pessoas
 * lançaram e outra com o que o áudio trouxe, e nenhuma sabendo da outra.
 *
 * A REGRA DE OURO É UMA: o que humano escreveu não se sobrescreve, e nada é
 * removido. Todo o resto deste bloco é consequência dela.
 *
 * NADA DE IA, e não é limitação — é a mesma razão do cabeçalho deste arquivo. O
 * documento já é estruturado por contrato do prompt do Cowork, e o casamento
 * entre bloco e item é por texto exato. Onde dá para casar por texto exato,
 * casar por texto exato não erra em silêncio; similaridade erraria, e erraria
 * com cara de acerto, escrevendo a decisão de um assunto dentro de outro.
 *
 * PLANEJAR E APLICAR SÃO DUAS FUNÇÕES, e é o que sustenta a tela de
 * conferência: quem conduz a reunião vê o que vai entrar, em que linha, e
 * aprova. Uma função só que gravasse direto pediria confiança cega num
 * casamento de texto — e a ata é registro, não rascunho.
 */

/** O que aconteceria com UM bloco do documento. */
export type ParDeMesclagem = {
  /**
   * O índice do bloco em `PontosImportantes.blocos` — a chave do plano.
   *
   * É POR ÍNDICE, e não por assunto, porque é ele que o cliente devolve para
   * dizer o que aprovou. O servidor recomputa o plano do mesmo documento antes
   * de aplicar (ver `api/ata/gerar`), então o índice aponta para o mesmo bloco
   * nas duas passadas. Assunto como chave quebraria no caso que o documento
   * produz sozinho: dois blocos com o mesmo cabeçalho.
   */
  bloco: number;
  /** O cabeçalho do bloco, para a tela poder nomear a linha. */
  assunto: string;
  /** O item da ata que este bloco casou, ou `null` quando é assunto novo. */
  itemId: string | null;
  /** Como casou, para a tela poder dizer por quê. */
  casouPor: "card" | "assunto" | null;
  /** O card do quadro que o assunto deste bloco resolve, quando resolve. */
  cardId: string;
  /** Aplicar faria a linha passar a apontar para `cardId` — ver `aplicarMesclagem`. */
  vinculaCard: boolean;
  /** Os campos que seriam preenchidos: o documento traz, e a ata não tem. */
  preenche: CampoMesclavel[];
  /** As tarefas do documento que entrariam como linhas novas na tabela. */
  tarefas: TarefaDeAta[];
  /**
   * O documento traz texto para um campo que a ata JÁ tem escrito, e diferente.
   *
   * NÃO É CONFLITO E NÃO É ERRO, e não é aplicado: o texto humano fica. Vai para
   * a tela lado a lado porque as duas saídas silenciosas são piores —
   * sobrescrever apaga o que alguém digitou na reunião, e ignorar sem mostrar
   * esconde o que a gravação registrou. Quem conduz decide se corrige à mão.
   */
  divergencias: { campo: CampoMesclavel; doAudio: string; naAta: string }[];
  /** A dimensão que o parser achou entraria, porque a linha não tem nenhuma. */
  classifica: boolean;
};

/**
 * O que a mesclagem faria, sem fazer nada.
 *
 * ORDEM DO CASAMENTO, e ela é da mais forte para a mais fraca:
 *
 *   1. POR CARD. O assunto do bloco resolve um card (pela mesma via de
 *      `ligarCards`: assunto do bloco × assunto da proposta que gerou o card), e
 *      existe item na ata apontando para aquele card. É o casamento mais forte
 *      porque os dois lados apontam para a mesma demanda do quadro — o texto
 *      pode ter sido reescrito no Kanban e o vínculo continua valendo.
 *   2. POR ASSUNTO. `chaveDeAssunto` dos dois lados bate. É o caso do assunto
 *      que alguém lançou à mão antes da reunião com o mesmo nome que o Cowork
 *      deu ao bloco.
 *   3. NADA CASOU: o bloco é assunto novo.
 *
 * UM ITEM CASA UM BLOCO SÓ, e um bloco casa um item só. O `Set` de usados é o
 * que garante — é a mesma proteção de `ligarCards`, e aqui ela vale mais: dois
 * blocos com cabeçalho parecido escreveriam no mesmo item, e o segundo apagaria
 * o que o primeiro acabou de pôr.
 *
 * O ITEM PODE NÃO EXISTIR AINDA e o bloco ainda assim resolver um card. É o caso
 * que `montarPauta` esconde: a demanda do quadro que ninguém tocou nesta ata é
 * desenhada a partir de um item FANTASMA, que não está gravado. Sem `cardId` no
 * plano, o bloco viraria um item novo sem card ao lado da linha da própria
 * demanda — duas linhas para o mesmo trabalho, na mesma pauta.
 */
export function planejarMesclagem(opcoes: {
  blocos: readonly BlocoDoDocumento[];
  itens: readonly ItemDeAta[];
  /** Os cards que esta reunião produziu, com o assunto que os originou. */
  cards: readonly { id: string; assunto: string }[];
  dimensoes: readonly DimensaoDaPauta[];
}): ParDeMesclagem[] {
  const { blocos, itens, dimensoes } = opcoes;
  const cardPorAssunto = indiceDeCards(opcoes.cards);

  const itemPorCard = new Map<string, ItemDeAta>();
  itens.forEach((i) => {
    if (i.cardId && !itemPorCard.has(i.cardId)) itemPorCard.set(i.cardId, i);
  });
  const itemPorAssunto = new Map<string, ItemDeAta>();
  itens.forEach((i) => {
    const k = chaveDeAssunto(i.assunto);
    if (k && !itemPorAssunto.has(k)) itemPorAssunto.set(k, i);
  });

  const usados = new Set<string>();

  return blocos.map((bloco, indice) => {
    const k = chaveDeAssunto(bloco.assunto);
    const cardId = (k && cardPorAssunto.get(k)) || "";

    let alvo: ItemDeAta | undefined;
    let casouPor: ParDeMesclagem["casouPor"] = null;
    const porCard = cardId ? itemPorCard.get(cardId) : undefined;
    if (porCard && !usados.has(porCard.id)) {
      alvo = porCard;
      casouPor = "card";
    } else {
      const porAssunto = k ? itemPorAssunto.get(k) : undefined;
      if (porAssunto && !usados.has(porAssunto.id)) {
        alvo = porAssunto;
        casouPor = "assunto";
      }
    }
    if (alvo) usados.add(alvo.id);

    const texto = textoDoBloco(bloco);
    const preenche: CampoMesclavel[] = [];
    const divergencias: ParDeMesclagem["divergencias"] = [];
    for (const campo of CAMPOS_MESCLAVEIS) {
      const doAudio = texto[campo];
      if (!doAudio) continue;
      const naAta = alvo ? alvo[campo] : "";
      // Igual não é divergência nem preenchimento: anunciar qualquer um dos dois
      // aqui encheria a tela de conferência de linhas que não mudam nada, e uma
      // lista assim se aprova sem ler.
      if (naAta === doAudio) continue;
      if (naAta) divergencias.push({ campo, doAudio, naAta });
      else preenche.push(campo);
    }

    const classe = classificar(bloco.assunto, dimensoes);
    return {
      bloco: indice,
      assunto: limparTexto(bloco.assunto, 200),
      itemId: alvo?.id ?? null,
      casouPor,
      cardId,
      // Vincular é escrita de VÍNCULO, não de texto, e por isso não entra em
      // `preenche`: quem lê a conferência precisa saber que aquela linha vai
      // deixar de ser assunto e passar a ler estado do quadro.
      vinculaCard: !!cardId && !alvo?.cardId,
      preenche,
      tarefas: tarefasQueFaltam(bloco, alvo),
      divergencias,
      // A classificação HUMANA ganha sempre. O `classificar` é conservador, mas
      // é léxico: ele acha "Estoque" dentro de "Estoque, recebimento e
      // conferência" e não sabe que alguém já decidiu, na reunião, que aquilo
      // mora em outra dimensão.
      classifica: !!classe.dimensaoId && !alvo?.dimensaoId,
    };
  });
}

/**
 * Os encaminhamentos do bloco que a tabela do item ainda NÃO tem.
 *
 * SEM ISTO A MESCLAGEM NÃO É IDEMPOTENTE, e o defeito é o pior tipo: silencioso
 * e cumulativo. Os campos de texto se protegem sozinhos — preenchido deixa de
 * ser vazio, e na segunda passada não há o que preencher. As tarefas não: elas
 * entram como linhas NOVAS por desenho (a tabela pode estar sendo preenchida por
 * outra pessoa, e editar linha alheia é pior), então cada clique em "puxar do
 * áudio" acrescentava a mesma tarefa outra vez. Dois cliques, tabela dobrada; e
 * o segundo clique é exatamente o gesto de quem não tem certeza se o primeiro
 * funcionou.
 *
 * A COMPARAÇÃO É POR `chaveDeTexto`, a mesma do casamento de assunto: sem acento
 * sem caixa. Comparação literal deixaria passar a tarefa que alguém redigitou
 * com outra caixa — e o duplicado apareceria justamente na linha em que alguém
 * já estava trabalhando.
 *
 * O que ela NÃO faz é comparar responsável, prazo ou estado: a tarefa do
 * documento nasce sem nenhum dos três (ver `paraTarefa`), e quem os preencheu
 * depois foi uma pessoa. Considerar "diferente" a tarefa que ganhou responsável
 * a traria de volta como linha nova, vazia, ao lado da que está sendo cumprida.
 */
function tarefasQueFaltam(
  bloco: BlocoDoDocumento,
  alvo: ItemDeAta | undefined,
): TarefaDeAta[] {
  const doDocumento = bloco.encaminhamentos.map((e, i) => paraTarefa(e, String(i + 1)));
  if (!alvo?.tarefas.length) return doDocumento;
  const jaTem = new Set(alvo.tarefas.map((t) => chaveDeTexto(t.texto)));
  return doDocumento.filter((t) => {
    const k = chaveDeTexto(t.texto);
    // Encaminhamento que virou texto vazio não tem o que acrescentar, e sem esta
    // guarda o primeiro deles envenenaria o `Set` com "" e barraria os outros.
    if (!k) return false;
    if (jaTem.has(k)) return false;
    // Dois encaminhamentos idênticos no MESMO bloco entram uma vez só. O Cowork
    // repete o encaminhamento quando ele aparece duas vezes na conversa.
    jaTem.add(k);
    return true;
  });
}

/** O par tem alguma coisa a fazer? É o que separa a tela vazia da tela cheia. */
export function mesclagemFazAlgo(par: ParDeMesclagem): boolean {
  return (
    par.itemId === null ||
    par.preenche.length > 0 ||
    par.tarefas.length > 0 ||
    par.vinculaCard ||
    par.classifica
  );
}

/**
 * Aplica o plano — só os blocos aprovados, e nunca por cima de ninguém.
 *
 * DEVOLVE O ARRAY INTEIRO de itens, como `vincularCard` e `editarAssunto` e pelo
 * mesmo motivo: os itens moram dentro do documento da ata e a escrita é sempre
 * do array completo (cabeçalho de `ata.ts`).
 *
 * O QUE ELE NUNCA FAZ, e cada linha aqui é uma decisão:
 *
 *   - NUNCA remove item. O item que nenhum bloco casou fica exatamente como
 *     está: é o assunto que entrou na pauta e sobre o qual a reunião não falou,
 *     ou falou e o Cowork não separou em bloco. Apagar seria a ata perdendo o
 *     que alguém lançou — e é justamente para não perder isso que esta função
 *     existe.
 *   - NUNCA toca em `assunto`. Foi humano que o escreveu e é o único nome que a
 *     linha tem. O cabeçalho que o Cowork deu ao bloco é editorial e muda de
 *     safra em safra do prompt.
 *   - NUNCA sobrescreve texto. Campo com texto na ata fica; o do documento vira
 *     divergência no plano, e para na tela.
 *   - NUNCA edita nem remove tarefa existente. As do documento entram como
 *     linhas novas, com id acima de todas — a tabela pode estar sendo preenchida
 *     por outra pessoa na reunião, e `proximoIdDeTarefa` existe para que a linha
 *     nova não herde em silêncio o lugar de uma apagada.
 *   - NUNCA troca `origem`. O item que já estava lá continua sendo o que era; só
 *     o que nasce deste documento é `reuniao`, e quem o marca é `blocoParaItem`.
 *
 * O ID DO ITEM NOVO é calculado contra o array ACUMULADO, e não contra o
 * original. Dois blocos novos na mesma passada pediriam o mesmo
 * `proximoIdDeItem` do array de entrada, e a segunda linha nasceria com a chave
 * da primeira — o estado que `idsUnicos` conserta na leitura, e que aqui dá para
 * simplesmente não criar.
 */
export function aplicarMesclagem(opcoes: {
  itens: readonly ItemDeAta[];
  blocos: readonly BlocoDoDocumento[];
  plano: readonly ParDeMesclagem[];
  /** Os índices de bloco que quem conferiu aprovou. */
  aprovados: readonly number[];
  dimensoes: readonly DimensaoDaPauta[];
}): ItemDeAta[] {
  const { blocos, plano, dimensoes } = opcoes;
  const ok = new Set(aprovadosValidos(plano, opcoes.aprovados));
  let itens: ItemDeAta[] = [...opcoes.itens];

  for (const par of plano) {
    if (!ok.has(par.bloco)) continue;
    const bloco = blocos[par.bloco];
    if (!bloco) continue;

    if (par.itemId === null) {
      const novo = blocoParaItem(bloco, proximoIdDeItem(itens), dimensoes);
      // O `cardId` que o bloco resolveu entra junto, e é o que impede a linha
      // nova de aparecer ao lado da própria demanda que ela nomeia.
      itens = [...itens, par.cardId ? { ...novo, cardId: par.cardId } : novo];
      continue;
    }

    const texto = textoDoBloco(bloco);
    const classe = classificar(bloco.assunto, dimensoes);
    itens = itens.map((i) => {
      if (i.id !== par.itemId) return i;
      const mudado = { ...i };
      // Só o que o PLANO prometeu — e o plano é o que a pessoa leu na tela.
      // Reperguntar aqui "está vazio?" daria um segundo juiz para a mesma
      // pergunta, e os dois divergiriam no dia em que alguém escrevesse no campo
      // entre a conferência e o clique de aplicar. Como o servidor recomputa o
      // plano imediatamente antes de aplicar, o plano é a resposta mais nova que
      // existe.
      for (const campo of par.preenche) mudado[campo] = texto[campo];
      if (par.vinculaCard && par.cardId) mudado.cardId = par.cardId;
      if (par.classifica) {
        mudado.dimensaoId = classe.dimensaoId;
        mudado.subdimensaoId = classe.subdimensaoId;
      }
      if (par.tarefas.length) {
        const tarefas = [...mudado.tarefas];
        for (const t of par.tarefas) {
          tarefas.push({ ...t, id: proximoIdDeTarefa(tarefas) });
        }
        mudado.tarefas = tarefas;
      }
      return mudado;
    });
  }

  return itens;
}

/**
 * Os índices aprovados que existem no plano E têm o que fazer.
 *
 * O array vem do cliente, e é a única coisa desta rota que vem de lá — o plano
 * inteiro é recomputado no servidor. Um índice fora da faixa é o caso benigno; o
 * que esta função protege é o outro: aprovar um par que `mesclagemFazAlgo`
 * reprova gravaria a ata inteira de novo sem mudar um caractere, e cada gravação
 * dessas é uma chance de sobrescrever o array que outra pessoa está editando na
 * mesma reunião (é o custo do modelo, escrito no cabeçalho de `ata.ts`).
 */
function aprovadosValidos(
  plano: readonly ParDeMesclagem[],
  aprovados: readonly number[],
): number[] {
  const uteis = new Set(plano.filter(mesclagemFazAlgo).map((p) => p.bloco));
  return [...new Set(aprovados)].filter((n) => uteis.has(n));
}
