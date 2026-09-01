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
  limparTexto,
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

/** Sem caixa e sem acento — a mesma comparação de `semear-cantinas.mjs`. */
function chave(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
}

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
  const alvo = chave(assunto);
  let achado = { dimensaoId: "", subdimensaoId: "", tamanho: 0 };
  for (const d of dimensoes) {
    for (const s of d.subs) {
      const nome = chave(s.nome);
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
export function blocoParaItem(
  bloco: BlocoDoDocumento,
  id: string,
  dimensoes: readonly DimensaoDaPauta[],
): ItemDeAta {
  const { dimensaoId, subdimensaoId } = classificar(bloco.assunto, dimensoes);
  return {
    id,
    cardId: "",
    assunto: limparTexto(bloco.assunto, 200),
    contexto: limparTexto(bloco.contexto.join(" · ")),
    dimensaoId,
    subdimensaoId,
    // Várias decisões no mesmo bloco são várias frases sobre o mesmo assunto —
    // e o assunto é a linha. Juntar com " · " é o que a tela já faz com dimensão
    // e subdimensão, e cabe nos 600 de `limparTexto`.
    decisao: limparTexto(bloco.decisoes.join(" · "), LIMITE_TEXTO_CHARS),
    objetivo: limparTexto(bloco.semDecisao.join(" · "), LIMITE_TEXTO_CHARS),
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
  const porAssunto = new Map<string, string>();
  // A numeração do cabeçalho ("1. Método…") sobrevive no `assunto` da proposta e
  // não no do item, que já a perdeu — então ela sai dos dois lados antes de
  // comparar.
  cards.forEach((c) => {
    const k = chave(String(c.assunto ?? "").replace(/^\d+\.\s*/, ""));
    if (k && !porAssunto.has(k)) porAssunto.set(k, c.id);
  });
  const usados = new Set<string>();
  return itens.map((i) => {
    if (i.cardId) return i;
    const cardId = porAssunto.get(chave(i.assunto));
    if (!cardId || usados.has(cardId)) return i;
    usados.add(cardId);
    return { ...i, cardId };
  });
}
