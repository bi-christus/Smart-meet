"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { auth } from "@/lib/firebase";
import { useSetoresDaPessoa } from "@/lib/setores";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import {
  DEMAND_TYPES,
  DEMAND_TYPE_COLOR,
  DEMAND_TYPE_LABEL,
  KNOWN_PRIORITIES,
  PRIORITY_LABEL,
  columnsBySector,
  createCard,
  deliveredBySector,
  subscribeCards,
  subscribeColumns,
  updateCard,
  viva,
  type Card,
  type CardInput,
  type ColumnDoc,
  type DemandType,
  type Priority,
} from "@/lib/kanban";
import { diffCard, mudancasIniciais, type Rotulos } from "@/lib/historico-core";
import {
  corDaDimensao,
  subscribeDimensoes,
  type Dimensao,
} from "@/lib/dimensoes";
import {
  ESTADOS_NA_ATA,
  ESTADO_LABEL,
  ORIGEM_LABEL,
  STATUS_TAREFA,
  STATUS_TAREFA_LABEL,
  abrirProxima,
  classificacaoDaLinha,
  conferirAssuntoNovo,
  conferirClassificacao,
  conferirTitulo,
  LIMITE_ASSUNTO_CHARS,
  LIMITE_TEXTO_CHARS,
  deleteAta,
  editarAssunto,
  montarPauta,
  levarAssunto,
  moverAssunto,
  moverItensEntreAtas,
  proximoIdDeItem,
  resumoDaAta,
  salvarCabecalho,
  salvarItens,
  salvarItensNoLote,
  semClassificacao,
  subscribeAtas,
  tarefaNova,
  vincularCard,
  type Ata,
  type Classificacao,
  type EstadoNaAta,
  type ItemDaPauta,
  type SecaoDaPauta,
  type ItemDeAta,
  type OrigemDoItem,
  type StatusTarefa,
  type TarefaDeAta,
} from "@/lib/ata";
import {
  mesclagemFazAlgo,
  type CampoMesclavel,
  type ParDeMesclagem,
} from "@/lib/ata-de-reuniao-core";
import { subscribeMeetings, type Meeting } from "@/lib/meetings";
import { ehFimDeSemanaISO, fmtDayMonth, relDay, startOfDay, toISO } from "@/lib/datas";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { Select, type SelectOption } from "@/components/select";
import { Combobox } from "@/components/combobox";
import { Modal } from "@/components/modal";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import { LinhaDoTempo } from "./linha-do-tempo";
import styles from "./ata.module.css";

/**
 * Ata — a reunião organizada por DEMANDA, com a dimensão ao lado.
 *
 * POR QUE ESTA TELA EXISTE. A ata da reunião das cantinas registrou a queixa
 * que a originou: o grupo saía das reuniões "sem nada para fazer amanhã", as
 * pautas se misturavam e nada ficava medido. Registrou também a divergência
 * sobre o formato — organizar pelas dimensões, ou pelas demandas com a dimensão
 * ao lado — e prevaleceu a segunda, para que cada participante saísse com
 * tarefa no nome. Esta tela é essa decisão desenhada.
 *
 * O QUE ELA GUARDA CONTINUA SENDO DECISÃO. A pauta sai do quadro do setor, ao
 * vivo; o que a ata grava é o que a REUNIÃO produziu — decisão, objetivo para a
 * próxima, e as tarefas derivadas. A separação está escrita em `ata-core.ts` e
 * vale como regra: o que é decisão fica na ata, o que é estado vem do card.
 *
 * ELA PASSOU A CRIAR DEMANDA, e isso não contradiz o parágrafo acima. Até esta
 * versão, o assunto que a reunião discutiu não tinha caminho nenhum para virar
 * trabalho: a saída era abrir o Kanban em outra aba, criar o card à mão e
 * voltar — com o vínculo (`item.cardId`) ficando para trás, e a reunião
 * seguinte discutindo de novo um assunto que já era demanda. Agora o botão está
 * no bloco, o card nasce no MESMO lote que grava o vínculo, e a linha passa a
 * ler estado do quadro como qualquer outra. O porquê inteiro — inclusive por
 * que isso não fura a fronteira de demandas, e por que a dimensão é obrigatória
 * aqui e não no Kanban — está no cabeçalho de `ata-demanda-core.ts`.
 *
 * O QUE O ISOLAMENTO POR SETOR GARANTE: a ata das Cantinas não aparece para o
 * B.I. e vice-versa. Quem garante não é esta tela — é `firestore.rules`,
 * escopado por `setor` como todo o resto. Aqui a barra de quadros só oferece os
 * setores que a pessoa já enxerga.
 */

const SEM_CARDS: Card[] = [];
const SEM_COLS: ColumnDoc[] = [];
const SEM_ATAS: Ata[] = [];
const SEM_USERS: UserProfile[] = [];
const SEM_DIMS: Dimensao[] = [];
const SEM_REUNIOES: Meeting[] = [];

/**
 * A identidade de uma linha da pauta, estável entre renders.
 *
 * NÃO É `item.id` SOZINHO. A linha que ninguém tocou é desenhada a partir do
 * item fantasma de `itemVazio`, cujo `id` é o `cardId`; na primeira gravação o
 * item de verdade nasce com id numérico e o `id` troca. Como a `key` do React e
 * o conjunto de recolhidos são lidos por esta chave, um `item.id` cru faria o
 * bloco remontar (perdendo foco e rascunho) e a tabela de tarefas reabrir
 * sozinha, no meio da reunião.
 *
 * `cardId` é único por linha quando existe — `montarPauta` indexa um item por
 * card — e o assunto sem card já nasce com id próprio e estável.
 */
function chaveDaLinha(l: ItemDaPauta): string {
  return l.item.cardId || l.item.id;
}

/**
 * Como uma reunião se chama nas listas — título e dia, sempre nessa ordem.
 *
 * Um lugar só porque são três: o seletor do resumo, a lista de destino do
 * "Mover" e a frase que diz para onde o assunto foi. Duas reuniões com o mesmo
 * título são o caso comum ("Reunião Semanal de Operações"), e é a data que as
 * distingue — se um dos três esquecer dela, a escolha vira sorteio.
 */
function rotuloDaAta(a: Pick<Ata, "titulo" | "data">): string {
  return a.data ? `${a.titulo} · ${fmtDayMonth(a.data)}` : a.titulo;
}

/**
 * A reunião como OPÇÃO de lista — a data numa coluna, o título na outra.
 *
 * POR QUE NÃO É `rotuloDaAta`. O rótulo junta título e data numa string só, com
 * a data no fim; a lista corta o excedente com reticências, e o que ela cortava
 * era exatamente a data: "Acompanhamento de Demandas · 2 s…". Numa lista de
 * reuniões a data é o identificador — ninguém abre aquele menu para descobrir o
 * título, abre para achar o dia. O dado que identifica não pode ser o primeiro a
 * sumir.
 *
 * A data vai no `prefixo`, que é coluna fixa e não encolhe (ver `SelectOption`);
 * quem cede espaço passa a ser o título, que é o que a pessoa usa para
 * confirmar, não para escolher. De quebra as datas se alinham entre as linhas, e
 * a lista fica varrível de cima a baixo.
 *
 * "sem data" e não vazio: a ata sem data existe (nasce assim em "Abrir próxima
 * reunião" enquanto ninguém marcou o dia), e uma coluna em branco no meio das
 * outras se lê como falha de carregamento.
 */
function opcaoDeAta(a: Pick<Ata, "id" | "titulo" | "data">): SelectOption {
  return {
    value: a.id,
    label: a.titulo,
    prefixo: a.data ? fmtDayMonth(a.data) : "sem data",
  };
}

/** A cor de cada estado, na mesma ordem de gravidade da pauta. */
/**
 * A cor de cada estado — em TOKEN, e nunca mais em hex.
 *
 * Quatro dos cinco eram hex chumbados (`#f5b13d`, `#c084fc`, `#34d399`,
 * `#8b93a7`), desenhados para o tema escuro. Duas consequências, e as duas
 * medidas:
 *
 *   1. CONTRASTE. O selo pintava `color-mix(in srgb, COR 62%, var(--tx))` sobre
 *      `color-mix(in srgb, COR 16%, transparent)`. No tema claro isso dava
 *      3,37:1 em "Em andamento" e 3,42:1 em "Concluída" — abaixo dos 4,5:1 de
 *      AA. A única que passava era "Atrasada", justamente a única que já usava
 *      token.
 *   2. TEMA. O acento Entre Aulas redefine `--ok`, `--warn`, `--danger`,
 *      `--info` e `--susp` a partir da paleta da cantina. Com hex chumbado, a
 *      pauta continuaria com o verde e o roxo genéricos no meio de uma tela
 *      inteira em vinho e terracota.
 */
const COR_ESTADO: Record<EstadoNaAta, string> = {
  atrasada: "var(--danger)",
  andamento: "var(--warn)",
  pendente: "var(--susp)",
  concluida: "var(--ok)",
  // Neutro, e o único da paleta que não é uma cor de alerta: registro não pede
  // ação de ninguém. Ele acender igual aos outros ensinaria a ignorar todos.
  registro: "var(--tx-3)",
};

/**
 * O par fundo/texto do selo, que o tema já resolveu para cada família.
 *
 * Substitui o `color-mix` de 62% sobre `--tx`, que era o que produzia o cinza
 * claro ilegível no tema claro. Os pares `--*-bg` e `--*-tx` existem em
 * `globals.css` justamente porque foram escolhidos juntos, tema a tema.
 */
const SELO_ESTADO: Record<EstadoNaAta, { bg: string; tx: string }> = {
  atrasada: { bg: "var(--danger-bg)", tx: "var(--danger-tx)" },
  andamento: { bg: "var(--warn-bg)", tx: "var(--warn-tx)" },
  pendente: { bg: "var(--susp-bg)", tx: "var(--susp-tx)" },
  concluida: { bg: "var(--ok-bg)", tx: "var(--ok-tx)" },
  // Registro não tem família própria em `globals.css`, e não deveria ter: ele é
  // a ausência de alerta. Superfície neutra e texto secundário dizem isso sem
  // inventar um sexto par de tokens que só esta tela usaria.
  registro: { bg: "var(--s3)", tx: "var(--tx-2)" },
};

/**
 * OS TRÊS BLOCOS DA PAUTA, na ordem em que a reunião os percorre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ISTO CONSERTA, e a queixa chegou nestas palavras: "os assuntos estão
 * aparecendo em várias reuniões, alguns sem identificação, e a reunião que eu
 * criei já nasce cheia".
 *
 * A pauta empilhava três coisas diferentes com a mesma cara. O que a reunião
 * registrou, TODA demanda aberta do quadro do setor (`montarPauta` as injeta em
 * toda ata, de propósito — a reunião fala delas) e os apêndices do documento do
 * áudio desciam na mesma lista, e a linha vinda do quadro nem chip de origem
 * ganhava, porque onde há card a procedência de que se fala é a do card.
 *
 * O efeito em produção, no dia em que isto foi escrito, setor Cantinas: a ata de
 * 09/09/2026 tinha ZERO item gravado e abria com nove assuntos; a de 16/09 tinha
 * onze e abria com quinze. Quem conduz estava certo sobre o que via — os mesmos
 * nove assuntos nas quatro atas do setor —, ainda que a causa não fosse cópia.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE SEPARAR, E NÃO TIRAR. A demanda aberta PRECISA aparecer na reunião:
 * é dela que se fala. O que não podia continuar era a tela afirmar, pelo
 * silêncio, que aquilo é pauta que alguém montou. Separado e recolhido, o bloco
 * do quadro continua a um clique de distância e para de responder pela ata.
 *
 * `sempreAberta` vale só para o primeiro: uma reunião sem registro nenhum tem de
 * DIZER isso. Era exatamente o caso da ata de 09/09, e é a informação que a tela
 * escondia.
 */
const SECOES: readonly {
  chave: SecaoDaPauta;
  titulo: string;
  explica: string;
  sempreAberta?: boolean;
}[] = [
  {
    chave: "registrada",
    titulo: "O que esta reunião registrou",
    explica: "assuntos e decisões desta ata",
    sempreAberta: true,
  },
  {
    chave: "quadro",
    titulo: "Demandas abertas do quadro",
    explica: "vêm do Kanban do setor, não desta reunião",
  },
  {
    chave: "pendencia",
    titulo: "Pendências da reunião",
    explica: '"Em aberto" e "Outros pontos" do documento do áudio',
  },
];

/**
 * Os blocos que nascem RECOLHIDOS — e é a metade da correção que se vê.
 *
 * Os dois falam de coisa que não é pauta montada por ninguém: um é o quadro do
 * setor, o outro é apêndice do documento. Abertos por padrão, eles continuariam
 * fazendo a ata parecer cheia — que é a queixa inteira.
 */
const SECOES_FECHADAS: readonly SecaoDaPauta[] = ["quadro", "pendencia"];

/** O estado da TAREFA lê no mesmo eixo do estado da demanda — e nas mesmas cores. */
const COR_TAREFA: Record<StatusTarefa, string> = {
  concluida: "var(--ok)",
  andamento: "var(--warn)",
  pendente: "var(--susp)",
};

export default function AtaPage() {
  const { profile } = useAuth();
  const sectors = useSetoresDaPessoa(profile);

  const [quadroSel, setQuadroSel] = useState("");
  /** Setor guardado que saiu da lista volta para o primeiro — ver o Dashboard. */
  const setor = sectors.includes(quadroSel) ? quadroSel : (sectors[0] ?? "");

  const fCards = useAsyncData<Card>(setor, (onData, onErro) =>
    subscribeCards(setor, onData, onErro),
  );
  const fCols = useAsyncData<ColumnDoc>(setor, (onData, onErro) =>
    subscribeColumns(setor, onData, onErro),
  );
  const fAtas = useAsyncData<Ata>(setor, (onData, onErro) =>
    subscribeAtas(setor, onData, onErro),
  );
  const fDims = useAsyncData<Dimensao>(setor, (onData, onErro) =>
    subscribeDimensoes(setor, onData, onErro),
  );
  /**
   * As reuniões de TODOS os setores da pessoa, e não só o do quadro na tela.
   *
   * É o que permite gerar em Cantinas a ata de uma reunião que correu no B.I. —
   * o caso literal da primeira: o áudio subiu pelo setor de quem gravou, e o
   * assunto pertence a outro. Filtrar pelo setor da aba esconderia justamente a
   * reunião que se quer.
   */
  const fReunioes = useAsyncData<Meeting>(sectors.join("|"), (onData, onErro) =>
    subscribeMeetings(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const cards = fCards.data ?? SEM_CARDS;
  const cols = fCols.data ?? SEM_COLS;
  const atas = fAtas.data ?? SEM_ATAS;
  const dims = fDims.data ?? SEM_DIMS;
  const users = fUsers.data ?? SEM_USERS;
  const reunioes = fReunioes.data ?? SEM_REUNIOES;

  const [ataSel, setAtaSel] = useState("");
  const [gerarAberta, setGerarAberta] = useState(false);
  const [puxarAberta, setPuxarAberta] = useState(false);
  const [levando, setLevando] = useState<ItemDaPauta | null>(null);
  const [proximaAberta, setProximaAberta] = useState(false);
  const [cabecalhoAberto, setCabecalhoAberto] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroEscrita, setErroEscrita] = useState<string | null>(null);
  /**
   * Um recado que NÃO é erro — hoje só um, e ele merecia existir.
   *
   * A rota de gerar é idempotente e responde `jaExistia`; o cliente descartava
   * esse campo. Quem gerava de novo a ata de uma reunião que já tinha seis
   * decisões escritas não recebia sinal nenhum de que abriu a existente, e podia
   * passar a reunião inteira achando que estava numa ata em branco.
   *
   * Separado de `erroEscrita` porque não é a mesma coisa: um diz que algo
   * falhou, o outro que algo foi diferente do esperado e deu certo assim.
   */
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [fEstado, setFEstado] = useState<"" | EstadoNaAta>("");
  const [fResp, setFResp] = useState("");
  /** Ver só o que está fora do mapa — ver `semClassificacao`. */
  const [soSemDim, setSoSemDim] = useState(false);
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  /** Quais blocos da pauta estão fechados — ver `SECOES` e `SECOES_FECHADAS`. */
  const [secoesFechadas, setSecoesFechadas] = useState<Set<SecaoDaPauta>>(
    () => new Set(SECOES_FECHADAS),
  );
  const [assuntoAberto, setAssuntoAberto] = useState(false);
  /**
   * A linha que acabou de nascer, para a tela ir até ela.
   *
   * A PAUTA É ORDENADA POR GRAVIDADE, e isso não vai mudar — é a decisão que
   * originou a tela inteira (`ata-core.ts`): o que está atrasado fica em cima.
   * Só que ela cobra um preço no assunto recém-criado: sem decisão, sem
   * objetivo e sem tarefa, ele é "registro" e vai para o FIM de uma pauta de
   * quinze linhas. Quem clicou em "Acrescentar" vê a tela não mudar e conclui
   * que o botão não funcionou.
   *
   * A saída não é furar a ordem — é levar os olhos até onde a linha foi.
   */
  const [destaque, setDestaque] = useState("");
  /** A linha que está virando demanda no quadro, ou sendo classificada. */
  const [promovendo, setPromovendo] = useState<ItemDaPauta | null>(null);
  const [classificando, setClassificando] = useState<ItemDaPauta | null>(null);
  /**
   * A linha cujo ASSUNTO está sendo corrigido.
   *
   * Só entra aqui linha SEM card. Onde há card, o nome e a descrição são do
   * quadro — nome é estado, e estado vem do card (cabeçalho de `ata-core.ts`).
   * A recusa não fica só neste `if`: `editarAssunto` a repete no caminho da
   * escrita, porque régua que mora só no formulário é régua que o segundo
   * formulário esquece.
   */
  const [editando, setEditando] = useState<ItemDaPauta | null>(null);
  /** A linha que está mudando de reunião — mesma fronteira de `editando`. */
  const [movendo, setMovendo] = useState<ItemDaPauta | null>(null);
  /** O histórico do setor num eixo só — ver `linha-do-tempo.tsx`. */
  const [linhaAberta, setLinhaAberta] = useState(false);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const nomeDe = (email: string) => usersMap[email]?.name ?? email;

  /** A ata na tela: a escolhida, ou a mais recente. */
  const ata = atas.find((a) => a.id === ataSel) ?? atas[0];

  /**
   * TROCOU DE ATA? O que era da anterior sai do caminho.
   *
   * Três coisas viajavam de uma reunião para a outra, e as três mentiam:
   *
   *   - os FILTROS. `responsaveis` é derivado da ata atual, então o e-mail
   *     guardado em `fResp` sumia das opções e o `<Select>` voltava a mostrar
   *     o placeholder. A pauta ficava vazia, com "Nenhuma demanda com esses
   *     filtros" e nenhum filtro visível para tirar.
   *   - os RECOLHIDOS. A chave é o id do item, e os ids são sequenciais POR
   *     ATA: recolher os itens 1 a 4 de 26/08 abria os itens 1 a 4 de 02/09
   *     recolhidos, escondendo as tarefas da reunião de hoje.
   *   - a TARJA DE ERRO. Uma escrita negada nas Cantinas continuava vermelha
   *     depois da troca para o B.I., acusando uma ata que ninguém tocou.
   *
   * Derivado no render, e não em efeito: é o mesmo padrão de eco que os campos
   * de texto desta tela já usam, e o efeito custaria um segundo render com a
   * tela mostrando o estado velho.
   */
  const [ecoDaAta, setEcoDaAta] = useState("");
  if (ata && ata.id !== ecoDaAta) {
    setEcoDaAta(ata.id);
    setBusca("");
    setFEstado("");
    setFResp("");
    setSoSemDim(false);
    setRecolhidos(new Set());
    // Os blocos voltam ao padrão junto com os filtros: deixar o do quadro aberto
    // porque alguém o abriu na ata anterior faria a próxima reunião nascer com a
    // mesma aparência de cheia que esta mudança existe para desfazer.
    setSecoesFechadas(new Set(SECOES_FECHADAS));
    setErroEscrita(null);
    // E os modais que carregam UMA LINHA da ata anterior. A ata da tela pode
    // trocar sem ninguém clicar em nada — ela é `atas[0]` enquanto ninguém
    // escolheu, e alguém do setor criando uma reunião mais recente muda quem é
    // o primeiro. Um modal aberto continuaria mirando o item de id "1", que
    // existe nas duas atas e é um assunto diferente em cada uma.
    setPromovendo(null);
    setClassificando(null);
    setEditando(null);
    setMovendo(null);
  }

  const entregues = useMemo(
    () => deliveredBySector(columnsBySector(cols, setor ? [setor] : [])),
    [cols, setor],
  );

  const hoje = useMemo(() => startOfDay().getTime(), []);

  /**
   * As demandas vivas do quadro — a lixeira fica de fora.
   *
   * `viva` é o mesmo filtro do Kanban. Sem ele, uma demanda excluída
   * continuaria na pauta da reunião seguinte, e ninguém entenderia por que ela
   * some do quadro e não da ata.
   */
  const cardsVivos = useMemo(() => cards.filter(viva), [cards]);

  const pauta = useMemo(
    () =>
      ata
        ? montarPauta({
            cards: cardsVivos,
            ata,
            dimensoes: dims,
            entregues,
            hoje,
          })
        : [],
    [ata, cardsVivos, dims, entregues, hoje],
  );

  const resumo = useMemo(() => resumoDaAta(pauta), [pauta]);

  /**
   * O que ainda está fora do mapa.
   *
   * Vive na página e não dentro do bloco porque duas coisas leem a mesma
   * resposta: o contador do painel e o filtro. Contadas em dois lugares, elas
   * divergem no primeiro `if` que alguém escrever só num deles.
   */
  const foraDoMapa = useMemo(() => semClassificacao(pauta), [pauta]);

  /** Todas as demandas com as tarefas recolhidas? Decide o que o botão faz. */
  const tudoRecolhido =
    pauta.length > 0 && pauta.every((l) => recolhidos.has(chaveDaLinha(l)));
  const idsForaDoMapa = useMemo(
    () => new Set(foraDoMapa.map((l) => l.item.id)),
    [foraDoMapa],
  );

  const pautaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pauta.filter(
      (l) =>
        (!q ||
          l.titulo.toLowerCase().includes(q) ||
          l.item.tarefas.some((t) => t.texto.toLowerCase().includes(q))) &&
        (!fEstado || l.estado === fEstado) &&
        (!soSemDim || idsForaDoMapa.has(l.item.id)) &&
        (!fResp ||
          l.card?.assignee === fResp ||
          l.item.tarefas.some((t) => t.responsavel === fResp)),
    );
  }, [pauta, busca, fEstado, fResp, soSemDim, idsForaDoMapa]);

  /**
   * A pauta filtrada, repartida nos três blocos da tela.
   *
   * A REPARTIÇÃO É SÓ AGRUPAMENTO, e não uma segunda régua: `montarPauta` já
   * ordenou as linhas por seção antes de tudo, e já numerou. Recalcular aqui
   * quem é de qual bloco daria duas respostas para a mesma pergunta, e elas
   * divergiriam no primeiro `if` que alguém escrevesse só num dos lados.
   */
  const porSecao = useMemo(() => {
    const vazio: Record<SecaoDaPauta, ItemDaPauta[]> = {
      registrada: [],
      quadro: [],
      pendencia: [],
    };
    pautaFiltrada.forEach((l) => vazio[l.secao].push(l));
    return vazio;
  }, [pautaFiltrada]);

  /**
   * Quem pode receber uma tarefa desta ata.
   *
   * DUAS ORIGENS, e a segunda existe para não apagar trabalho de ninguém.
   *
   * A primeira é o SETOR. Antes desta lista, a tabela oferecia
   * `Object.values(usersMap)` — todo usuário ativo do app inteiro, porque
   * `subscribeUsers` assina a coleção sem filtro. Dava para atribuir a tarefa de
   * uma ata de Cantinas a alguém que a regra do Firestore nem deixa ler aquela
   * ata. O modal de participantes desta mesma tela já fazia o certo, e diz por
   * quê: convidar quem não pode ler é um convite que o app não cumpre.
   *
   * A segunda são os JÁ ATRIBUÍDOS. Quem recebeu tarefa e depois saiu do setor
   * some da primeira lista — e, sem esta segunda, o `<Combobox>` abriria sem
   * nenhuma opção correspondendo ao valor gravado. O campo apareceria vazio, e a
   * primeira pessoa a tocar naquela linha apagaria o responsável sem saber.
   *
   * `hint` só é preenchido no HOMÔNIMO. Duas "Ana Silva" numa lista de escolha
   * é escolha no escuro; o e-mail embaixo de todo nome único seria ruído.
   */
  const pessoasDaAta = useMemo<SelectOption[]>(() => {
    const doSetor = users.filter(
      (u) => u.active && (u.sectors ?? []).includes(setor),
    );
    const conhecidos = new Set(doSetor.map((u) => u.email));
    const forasteiros: { email: string; name: string; color?: string }[] = [];
    const vistos = new Set<string>();
    (ata?.itens ?? []).forEach((i) =>
      i.tarefas.forEach((t) => {
        if (!t.responsavel || conhecidos.has(t.responsavel) || vistos.has(t.responsavel))
          return;
        vistos.add(t.responsavel);
        const u = usersMap[t.responsavel];
        forasteiros.push({
          email: t.responsavel,
          name: u?.name ?? t.responsavel,
          color: u?.color,
        });
      }),
    );

    const todos = [...doSetor, ...forasteiros];
    const quantos = new Map<string, number>();
    todos.forEach((u) => quantos.set(u.name, (quantos.get(u.name) ?? 0) + 1));
    const opcao = (u: { email: string; name: string; color?: string }): SelectOption => ({
      value: u.email,
      label: u.name,
      color: u.color,
      hint: (quantos.get(u.name) ?? 0) > 1 ? u.email : undefined,
    });

    return [
      { value: "", label: "Sem responsável" },
      ...doSetor
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .map(opcao),
      // Depois de todo mundo do setor, e nunca misturados: quem já não pertence
      // ao setor é exceção, e exceção no meio da lista alfabética parece regra.
      ...forasteiros
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        .map(opcao),
    ];
  }, [users, usersMap, setor, ata]);

  /** Só quem tem demanda ou tarefa nesta ata entra no filtro. */
  const responsaveis = useMemo(() => {
    const set = new Set<string>();
    pauta.forEach((l) => {
      if (l.card?.assignee) set.add(l.card.assignee);
      l.item.tarefas.forEach((t) => t.responsavel && set.add(t.responsavel));
    });
    return [...set].sort((a, b) => nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauta, usersMap]);

  /**
   * Grava um item da pauta — e é o ÚNICO caminho de escrita da tabela.
   *
   * Todas as edições da tela passam por aqui: decisão, objetivo, marca de
   * próxima reunião, tarefa criada, mudada ou removida. Um caminho só é o que
   * garante que o array gravado seja sempre o array inteiro e coerente — ver o
   * cabeçalho de `ata.ts` sobre por que os itens moram dentro do documento.
   *
   * A CHAVE É O `id` DO ITEM, e não mais o `cardId`. A troca veio junto com o
   * item sem card: com `cardId` vazio em mais de uma linha, a busca por ele
   * acharia sempre a primeira e a edição de um assunto cairia em outro. A linha
   * que ainda não foi tocada chega aqui com o item fantasma que `montarPauta`
   * criou — dele só se aproveita o `cardId`, porque o `id` verdadeiro ainda não
   * existe e é agora que ele nasce.
   */
  async function gravarItem(base: ItemDeAta, muda: (i: ItemDeAta) => ItemDeAta) {
    if (!ata) return;
    const existe = ata.itens.some((i) => i.id === base.id);
    const novo = muda(
      existe ? ata.itens.find((i) => i.id === base.id)! : { ...base, id: proximoIdDeItem(ata.itens) },
    );
    const itens = existe
      ? ata.itens.map((i) => (i.id === base.id ? novo : i))
      : [...ata.itens, novo];
    try {
      setErroEscrita(null);
      await escrever(() => salvarItens(ata.id, itens));
    } catch (e) {
      setErroEscrita(
        e instanceof Error ? e.message : "Não foi possível salvar a ata.",
      );
    }
  }

  /**
   * O destaque apaga sozinho, e o relógio mora AQUI.
   *
   * Não no bloco: ele pode sair da lista filtrada antes de o tempo acabar, e um
   * `setTimeout` de dentro dele morreria junto — o anel voltaria aceso na
   * próxima vez que a linha aparecesse. O `setState` está dentro do timeout, e
   * não no corpo do efeito, que é o que a regra do lint pede.
   */
  useEffect(() => {
    if (!destaque) return;
    const t = setTimeout(() => setDestaque(""), 2400);
    return () => clearTimeout(t);
  }, [destaque]);

  /** Tira todos os filtros de uma vez — ver o comentário de `destaque`. */
  function limparFiltros() {
    setBusca("");
    setFEstado("");
    setFResp("");
    setSoSemDim(false);
  }

  /**
   * Quantas escritas estão em voo, e quando a última voltou.
   *
   * A TELA SÓ FALAVA QUANDO FALHAVA, e isso não cobre o caso mais comum de uma
   * reunião: a rede da sala oscilando. `updateDoc` offline **não rejeita** — a
   * escrita entra na fila local, o snapshot local já devolve o texto novo, e a
   * promessa simplesmente nunca resolve. O facilitador registra oito decisões e
   * vinte tarefas, tudo aparece na tela exatamente como se tivesse sido gravado,
   * e nada distingue isso de ter sido.
   *
   * O contador é a resposta honesta: ele fica em "Salvando…" enquanto a promessa
   * não voltar, que é precisamente a verdade. E "Tudo salvo às 14:32" só aparece
   * quando alguma voltou de fato.
   */
  const [emVoo, setEmVoo] = useState(0);
  const [salvoAs, setSalvoAs] = useState("");

  /**
   * Toda escrita da tela passa por aqui — inclusive as que criam card.
   *
   * Devolve o resultado e RELANÇA o erro: quem chama é que sabe se o erro vira
   * tarja no topo (a edição da pauta) ou mensagem dentro do modal (a criação).
   */
  async function escrever<T>(fn: () => Promise<T>): Promise<T> {
    setEmVoo((n) => n + 1);
    try {
      const r = await fn();
      setSalvoAs(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      return r;
    } finally {
      setEmVoo((n) => n - 1);
    }
  }

  /** As colunas do quadro deste setor, na ordem — a primeira é a de entrada. */
  const colunas = useMemo(
    () => columnsBySector(cols, setor ? [setor] : [])[setor] ?? [],
    [cols, setor],
  );

  /**
   * Como o histórico da demanda escreve cada valor.
   *
   * Igual ao do modal do Kanban, e de propósito: a timeline de uma demanda
   * nascida na ata tem de ler exatamente como a de uma nascida no quadro. Se
   * aqui dissesse "alta" e lá "Alta", a mesma demanda contaria duas histórias.
   */
  const rotulos: Rotulos = useMemo(
    () => ({
      pessoa: (email) => usersMap[email]?.name ?? email,
      coluna: (colId) => colunas.find((c) => c.id === colId)?.title ?? colId,
      prioridade: (p) => PRIORITY_LABEL[p as Priority] ?? p,
      tipo: (t) => DEMAND_TYPE_LABEL[t as DemandType] ?? t,
    }),
    [usersMap, colunas],
  );

  /**
   * O nome de um card pelo id — inclusive o que foi para a lixeira.
   *
   * `cards` cru e não `cardsVivos`: a linha do tempo é HISTÓRICO. Uma demanda
   * excluída depois da reunião continua tendo sido discutida naquele dia, e uma
   * busca por "hortifruti" precisa achar a reunião que decidiu sobre ela mesmo
   * que o card já não exista mais no quadro.
   */
  const tituloDoCard = useMemo(() => {
    const m = new Map(cards.map((c) => [c.id, c.title]));
    return (id: string) => m.get(id) ?? "";
  }, [cards]);

  /**
   * "D1 · Cadeia de Suprimentos · Estoque" de um item da pauta.
   *
   * A ORIGEM MUDA COM O ITEM, e é a mesma regra de `classificacaoDaLinha`: onde
   * há card, quem responde é o card (dimensão é estado, e estado vem do
   * quadro); onde não há, o item. Ler sempre do item faria a demanda aparecer
   * "sem dimensão" na reunião em que ela foi classificada no Kanban.
   */
  const classeDoItem = useMemo(() => {
    const doCard = new Map(cards.map((c) => [c.id, c]));
    return (item: ItemDeAta) => {
      const c = item.cardId ? doCard.get(item.cardId) : undefined;
      const dimId = c ? (c.dimensaoId ?? "") : item.dimensaoId;
      const subId = c ? (c.subdimensaoId ?? "") : item.subdimensaoId;
      const d = dims.find((x) => x.id === dimId);
      if (!d) return "";
      const s = d.subs.find((x) => x.id === subId);
      return s ? `${d.nome} · ${s.nome}` : d.nome;
    };
  }, [cards, dims]);

  /**
   * O texto do chip de origem — "do áudio", "lançado à mão", "veio de 26/08".
   *
   * O `herdado` é o único que não tem rótulo fixo em `ORIGEM_LABEL`, e é de
   * propósito: dizer só "veio de outra reunião" não responde a pergunta que se
   * faz olhando o chip, que é QUAL. A data é resolvida aqui a partir de
   * `origemAtaId`, e não guardada no item, pela mesma regra que faz o item
   * guardar `cardId` e não o título do card: nome é cópia, id é referência — a
   * data de uma reunião se corrige no cabeçalho, e o chip tem de acompanhar.
   *
   * ATA APAGADA CAI NO RÓTULO GENÉRICO. A herança continua tendo acontecido, e
   * a ata é registro: esconder o chip faria a linha passar a parecer lançada
   * ali. Quem some junto é o link — ver `onAbrirOrigem`.
   */
  const rotuloDaOrigem = useMemo(() => {
    const dataDe = new Map(atas.map((a) => [a.id, a.data]));
    return (item: ItemDeAta) => {
      if (item.origem !== "herdado") return ORIGEM_LABEL[item.origem];
      const data = dataDe.get(item.origemAtaId);
      return data ? `veio de ${fmtDayMonth(data)}` : ORIGEM_LABEL.herdado;
    };
  }, [atas]);

  /**
   * "16/09" da reunião para onde o assunto já foi levado — ou `null`.
   *
   * Par de `rotuloDaOrigem`, e com a mesma degradação: a ata de destino pode ter
   * sido apagada, e aí o chip some inteiro em vez de virar um link para lugar
   * nenhum. A diferença é que aqui SUMIR é a resposta certa, e não um rótulo
   * genérico — sem a ata de destino, a linha voltou a ser um assunto que não foi
   * levado a lugar nenhum, e o botão "Levar" tem de estar disponível de novo.
   */
  const rotuloDaLevada = useMemo(() => {
    const dataDe = new Map(atas.map((a) => [a.id, a.data]));
    return (item: ItemDeAta) => {
      if (!item.levadaParaAtaId) return null;
      const data = dataDe.get(item.levadaParaAtaId);
      return data ? `levado para ${fmtDayMonth(data)}` : null;
    };
  }, [atas]);

  /** Nome da dimensão e da subdimensão, para o histórico (que guarda texto). */
  const nomesDaArvore = (dimensaoId: string, subdimensaoId: string) => {
    const d = dims.find((x) => x.id === dimensaoId);
    return {
      dimensaoNome: d?.nome ?? null,
      subdimensaoNome: d?.subs.find((s) => s.id === subdimensaoId)?.nome ?? null,
    };
  };

  /**
   * O assunto novo entra na pauta.
   *
   * Ele nasce SEM card, e é isso que o distingue da demanda: a reunião discutiu
   * uma coisa, e ainda não decidiu que aquilo é trabalho de alguém. A fronteira
   * de demandas existe para que essa ordem não se inverta — o card não pode
   * nascer só porque alguém precisava de uma linha onde escrever.
   */
  async function criarAssunto(dados: {
    assunto: string;
    contexto: string;
    dimensaoId: string;
    subdimensaoId: string;
  }) {
    if (!ata) throw new Error("Nenhuma ata aberta.");
    const conferido = conferirAssuntoNovo(dados, ata.itens, dims);
    if (!conferido.ok) throw new Error(conferido.motivo);
    await escrever(() => salvarItens(ata.id, [...ata.itens, conferido.valor]));
    // Devolve a chave para a tela ir até lá — ver `destaque`.
    return conferido.valor.id;
  }

  /**
   * O assunto corrigido depois de criado.
   *
   * O QUE ISTO CONSERTA: até aqui, o assunto nascia e nunca mais mudava. A tela
   * desenhava `assunto` e `contexto` como texto morto, e o único editável da
   * linha era o que vem DEPOIS — decisão, objetivo, tarefas e a dimensão. Um
   * nome digitado errado no meio da reunião ficava errado para sempre naquela
   * ata, e a saída era excluir a ata inteira, levando junto as decisões e as
   * tarefas de todo mundo.
   *
   * A RÉGUA NÃO MORA AQUI, e sim em `editarAssunto` — a mesma do assunto novo,
   * inclusive a obrigatoriedade da dimensão. Esta função só leva ao banco o
   * array que ele conferiu.
   *
   * O ERRO SOBE em vez de virar tarja no topo: quem chama é o modal, que
   * continua aberto com o texto digitado. Uma tarja atrás do overlay diria o
   * que aconteceu num lugar onde ninguém está olhando.
   */
  async function salvarAssunto(
    linha: ItemDaPauta,
    dados: {
      assunto: string;
      contexto: string;
      dimensaoId: string;
      subdimensaoId: string;
    },
  ) {
    if (!ata) throw new Error("Nenhuma ata aberta.");
    const conferido = editarAssunto(ata.itens, linha.item.id, dados, dims);
    if (!conferido.ok) throw new Error(conferido.motivo);
    await escrever(() => salvarItens(ata.id, conferido.valor));
  }

  /**
   * O assunto muda de reunião — e as duas atas mudam no mesmo lote.
   *
   * A régua mora em `moverAssunto`, inclusive a renumeração do id no destino:
   * os ids são sequenciais POR ATA, e o item que chega encontra um homônimo do
   * outro lado. A escrita atômica mora em `moverItensEntreAtas`, e o porquê
   * está lá — o estado intermediário perde a decisão e as tarefas em silêncio.
   *
   * DEVOLVE A ATA DE DESTINO porque quem chama precisa dizer para onde a linha
   * foi. Ela some desta pauta no mesmo instante, e um sumiço sem endereço é
   * indistinguível de ter apagado.
   */
  async function mover(linha: ItemDaPauta, destinoId: string) {
    if (!ata) throw new Error("Nenhuma ata aberta.");
    const destino = atas.find((a) => a.id === destinoId);
    if (!destino) throw new Error("Escolha a reunião de destino.");
    const conferido = moverAssunto(ata, destino, linha.item.id);
    if (!conferido.ok) throw new Error(conferido.motivo);
    await escrever(() =>
      moverItensEntreAtas(
        { id: ata.id, itens: conferido.valor.origem },
        { id: destino.id, itens: conferido.valor.destino },
      ),
    );
    return destino;
  }

  /**
   * As reuniões deste setor que ainda vão acontecer — os destinos do "Levar".
   *
   * `> ata.data` e não `>= `: duas atas no mesmo dia existem (a semanal e uma
   * extraordinária), mas levar um assunto para a reunião do mesmo dia não é
   * levar para a próxima, e oferecer as duas faria a escolha parecer arbitrária.
   * Quem precisa disso está corrigindo um lançamento, e o botão para isso é
   * "Mover".
   *
   * Ordem CRESCENTE, ao contrário da lista da tela (que é a mais recente
   * primeiro): aqui a resposta certa é quase sempre a reunião mais próxima, e ela
   * tem de ser a primeira da lista.
   */
  const ataId = ata?.id ?? "";
  const ataData = ata?.data ?? "";
  const proximas = useMemo(
    () =>
      atas
        .filter((a) => a.id !== ataId && !!a.data && !!ataData && a.data > ataData)
        .sort((a, b) => a.data.localeCompare(b.data)),
    // Os dois campos são extraídos ANTES do memo, e não lidos de `ata` dentro
    // dele: com `ata?.id` na lista de dependências, o React Compiler infere
    // `ata` inteiro, discorda do que está escrito e desiste de otimizar o
    // componente — reclamando no lint. Extrair primeiro faz o corpo e a lista
    // falarem da mesma coisa, e mantém a precisão (a lista não se remonta a cada
    // tecla digitada numa decisão da pauta).
    [atas, ataId, ataData],
  );

  /**
   * O assunto é LEVADO para uma reunião que já existe — as duas atas num lote.
   *
   * O QUE ISTO CONSERTA. "Levar para próxima reunião" só acendia um interruptor,
   * e o interruptor era colhido em um lugar só: "Abrir a próxima reunião", que
   * apenas CRIA ata. Quando a próxima já existia, o botão não fazia nada — e não
   * é figura de linguagem. Na reunião de 02/09/2026 quem conduzia abriu a ata de
   * 26/08, discutiu os assuntos passados e marcou vários; os flags ficaram lá
   * sem ter para onde ir, porque colhê-los criaria uma quarta ata duplicando a
   * de 09/09. Sem erro, sem aviso.
   *
   * A RÉGUA MORA EM `levarAssunto`, inclusive a renumeração do id no destino e o
   * fantasma da linha que ninguém tocou. A escrita atômica é a mesma de "Mover"
   * (`moverItensEntreAtas`), e o porquê está lá: em duas escritas soltas, a
   * falha da segunda deixa o assunto marcado na origem e ausente no destino, sem
   * nada na tela dizendo qual das duas aconteceu.
   *
   * DEVOLVE A ATA DE DESTINO porque quem chama precisa dizer para onde foi. Ao
   * contrário de "Mover", a linha NÃO some desta pauta — então o aviso não é
   * "para onde sumiu", é a confirmação de que o bastão foi passado.
   */
  async function levar(linha: ItemDaPauta, destinoId: string) {
    if (!ata) throw new Error("Nenhuma ata aberta.");
    const destino = atas.find((a) => a.id === destinoId);
    if (!destino) throw new Error("Escolha a reunião de destino.");
    const conferido = levarAssunto(ata, destino, linha.item);
    if (!conferido.ok) throw new Error(conferido.motivo);
    await escrever(() =>
      moverItensEntreAtas(
        { id: ata.id, itens: conferido.valor.origem },
        { id: destino.id, itens: conferido.valor.destino },
      ),
    );
    return destino;
  }

  /**
   * O assunto vira demanda no quadro — em UMA escrita, e não em duas.
   *
   * O card, a primeira linha do histórico dele e o `cardId` no item da pauta
   * entram no MESMO lote (`salvarItensNoLote`). Em duas escritas separadas, a
   * falha da segunda deixaria o pior estado alcançável: um card de verdade no
   * Kanban e a ata ainda chamando aquilo de assunto — e o próximo clique
   * criaria um card duplicado, porque nada na ata diria que o primeiro existe.
   *
   * A DIMENSÃO É CONFERIDA AQUI TAMBÉM, e não só no formulário. O modal é uma
   * tela; esta função é o caminho. Régua que mora só no formulário é régua que
   * o segundo formulário esquece.
   */
  async function criarDemanda(
    linha: ItemDaPauta,
    dados: {
      titulo: string;
      descricao: string;
      dimensaoId: string;
      subdimensaoId: string;
      responsavel: string;
      tipo: DemandType;
      prioridade: Priority;
      prazo: string;
    },
  ) {
    if (!ata || !profile) throw new Error("Nenhuma ata aberta.");
    const titulo = conferirTitulo(dados.titulo, "o título da demanda");
    if (!titulo.ok) throw new Error(titulo.motivo);
    const classe = conferirClassificacao(dados, dims);
    if (!classe.ok) throw new Error(classe.motivo);
    const coluna = colunas[0];
    if (!coluna) {
      throw new Error(
        "O quadro deste setor não tem coluna nenhuma. Abra o Kanban e crie a primeira etapa.",
      );
    }

    const input: CardInput = {
      title: titulo.valor,
      description: dados.descricao.trim(),
      columnId: coluna.id,
      type: dados.tipo,
      assignee: dados.responsavel || null,
      // Solicitante fica em branco de propósito: a demanda foi pedida pela
      // reunião, e a reunião não é um nome do cadastro de solicitantes.
      // Inventar um ali encheria o relatório "demandas por solicitante" com um
      // rótulo que ninguém pediu.
      requester: null,
      requesterSector: null,
      dimensaoId: classe.valor.dimensaoId,
      subdimensaoId: classe.valor.subdimensaoId || null,
      startDate: null,
      due: dados.prazo || null,
      priority: dados.prioridade,
      tags: [],
      tagRefs: [],
      checklist: [],
      links: [],
    };

    return escrever(() =>
      createCard(
        setor,
        input,
        profile.email,
        mudancasIniciais(
          {
            ...input,
            ...nomesDaArvore(classe.valor.dimensaoId, classe.valor.subdimensaoId),
          },
          rotulos,
        ),
        {
          origem: "reuniao",
          // A reunião gravada que originou a ata, quando houve uma. É o mesmo
          // campo que `api/demandas/decidir` grava, para que a proveniência se
          // leia igual venha a demanda de qual caminho vier.
          meetingIds: ata.meetingId ? [ata.meetingId] : undefined,
          ataId: ata.id,
        },
        (batch, novoId) =>
          salvarItensNoLote(
            batch,
            ata.id,
            vincularCard(ata.itens, linha.item.id, novoId, linha.item),
          ),
      ),
    );
  }

  /**
   * Classifica a linha — e a escrita cai em lugar diferente conforme a origem.
   *
   * Onde há card, quem responde pela dimensão é o CARD: dimensão é estado, e
   * estado vem do quadro (regra do cabeçalho de `ata-core.ts`). Gravar no item
   * daria duas respostas para a mesma pergunta, e a ata passaria a discordar do
   * Kanban sobre onde a demanda mora.
   */
  async function classificar(linha: ItemDaPauta, escolha: Classificacao) {
    if (!ata || !profile) throw new Error("Nenhuma ata aberta.");
    const conferido = conferirClassificacao(escolha, dims);
    if (!conferido.ok) throw new Error(conferido.motivo);
    const { dimensaoId, subdimensaoId } = conferido.valor;

    if (!linha.card) {
      await gravarItem(linha.item, (i) => ({ ...i, dimensaoId, subdimensaoId }));
      return;
    }

    const antes = classificacaoDaLinha(linha);
    await escrever(() =>
      updateCard(
        linha.card!.id,
        { dimensaoId, subdimensaoId: subdimensaoId || null },
        {
          ctx: { autor: profile.email, sector: setor },
          acao: "editada",
          // O diff leva os NOMES resolvidos agora, porque o histórico guarda
          // texto congelado — o mesmo cuidado do modal do Kanban. Sem isso, a
          // troca de dimensão viraria uma linha "de undefined para undefined".
          mudancas: diffCard(
            nomesDaArvore(antes.dimensaoId, antes.subdimensaoId),
            nomesDaArvore(dimensaoId, subdimensaoId),
            rotulos,
          ),
        },
      ),
    );
  }

  /**
   * Apagar a ata é de GESTOR — e a tela precisa saber disso antes de oferecer.
   *
   * `firestore.rules` só permite `delete` em `/atas` a `gestorNoSetor`. O botão
   * era desenhado para qualquer participante: o clique rejeitava com
   * permission-denied dentro de um `onClick` async sem `try/catch`, virava
   * rejeição não tratada, o modal continuava aberto e a ata continuava lá — sem
   * uma palavra dizendo por quê.
   */
  const podeExcluir =
    profile?.role === "admin" ||
    (profile?.role === "gestor" && (profile.sectors ?? []).includes(setor));

  async function excluirAta() {
    if (!ata) return;
    try {
      setErroEscrita(null);
      await escrever(() => deleteAta(ata.id));
      setAtaSel("");
      setApagando(false);
    } catch (e) {
      setErroEscrita(
        e instanceof Error ? e.message : "Não foi possível excluir a ata.",
      );
      setApagando(false);
    }
  }

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Ata</h1>
          </div>
        </div>
        <div className={styles.vazioTela}>
          Você ainda não participa de nenhum setor. Peça ao administrador para
          incluí-lo em um.
        </div>
      </div>
    );
  }

  /**
   * As CINCO fontes, e não três.
   *
   * `fDims` e `fUsers` ficavam de fora, e o `.erro` das duas não era lido em
   * lugar nenhum: `data ?? SEM_DIMS` transformava falha em lista vazia — que é
   * exatamente a mentira que `async-data-core.ts` foi escrito para matar. Com a
   * assinatura de usuários quebrada, todo responsável virava e-mail cru, a
   * lista de responsáveis sumia e a tela não dizia nada; com a de dimensões
   * quebrada, a pauta inteira aparecia "sem classificação" e o painel acusava
   * um problema que era da rede.
   */
  const fontes = juntarFontes([fCards, fCols, fAtas, fDims, fUsers]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Ata — {setor}</h1>
          <p>
            A reunião organizada por demanda: o que foi decidido, o que fica de
            tarefa e o que vai para a próxima. A pauta sai da reunião gravada.
          </p>
        </div>
        {/* O estado da escrita fica ao lado do botão principal, no cabeçalho:
            é a única parte da tela que não rola, e a pergunta "isso foi
            gravado?" pode surgir com a pauta em qualquer posição. */}
        {(emVoo > 0 || salvoAs) && (
          <span
            className={`${styles.gravando} ${emVoo > 0 ? styles.gravandoOn : ""}`}
            role="status"
            aria-live="polite"
          >
            <Icon name={emVoo > 0 ? "clock" : "check"} size={13} />
            {emVoo > 0 ? "Salvando…" : `Tudo salvo às ${salvoAs}`}
          </span>
        )}
        {/* Antes do botão principal, e em cinza: a linha do tempo é para LER o
            histórico, e gerar ata é o que se vem fazer aqui. Dois botões com o
            mesmo peso fariam a pessoa escolher entre eles toda vez. */}
        <button
          className={styles.historicoBtn}
          onClick={() => setLinhaAberta(true)}
          title="Ver todas as reuniões deste setor num eixo de tempo"
        >
          <Icon name="trend" size={15} /> Linha do tempo
        </button>
        <button className={styles.novaBtn} onClick={() => setGerarAberta(true)}>
          <Icon name="reunioes" size={15} /> Gerar da reunião
        </button>
      </div>

      {sectors.length > 1 && (
        <div className={styles.quadros}>
          {sectors.map((s) => (
            <button
              key={s}
              className={`${styles.quadroBtn} ${s === setor ? styles.quadroOn : ""}`}
              onClick={() => {
                setQuadroSel(s);
                // A ata é de um setor; carregar a escolha para o próximo faria a
                // tela pedir um documento que a regra do Firestore vai negar.
                setAtaSel("");
              }}
              aria-pressed={s === setor}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {erroEscrita && (
        <div className={styles.avisoErro} role="alert">
          <Icon name="warn" size={14} />
          <span>{erroEscrita}</span>
          {/* Sem nome, este botão era um alvo mudo para quem usa leitor de tela:
              nem texto, nem `aria-label`, e o `<svg>` do `Icon` não contribui
              nome nenhum. */}
          <button onClick={() => setErroEscrita(null)} aria-label="Fechar o aviso">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {aviso && (
        // `status` e não `alert`: nada falhou, e anunciar com urgência de erro
        // uma coisa que deu certo ensina a ignorar os dois.
        <div className={styles.avisoInfo} role="status">
          <Icon name="info" size={14} />
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar o aviso">
            <Icon name="x" size={13} />
          </button>
        </div>
      )}

      {fontes.erro ? (
        <ErrorState
          error={fontes.erro}
          onRetry={() => {
            fCards.tentarDeNovo();
            fCols.tentarDeNovo();
            fAtas.tentarDeNovo();
            fDims.tentarDeNovo();
            fUsers.tentarDeNovo();
          }}
        />
      ) : fontes.carregando ? (
        <div className={styles.corpo}>
          <SkeletonRow rows={8} texto="Carregando a ata…" />
        </div>
      ) : !ata ? (
        /* "Ainda não respondeu" e "respondeu e está vazio" são telas diferentes
           (AGENTS.md §3), e este é o segundo caso: o setor não tem ata nenhuma. */
        <div className={styles.corpo}>
          <EmptyState
            icon="reunioes"
            title="Nenhuma ata neste setor"
            description="Escolha uma reunião já processada: o sistema monta a pauta a partir dos pontos importantes que ela gerou, e junta as demandas do quadro."
            action={
              <button className={styles.novaBtn} onClick={() => setGerarAberta(true)}>
                <Icon name="reunioes" size={15} /> Gerar da reunião
              </button>
            }
          />
        </div>
      ) : (
        <div className={styles.corpo}>
          <aside className={styles.lateral}>
            <section className={styles.painel}>
              <div className={styles.painelHead}>
                <h2>
                  <Icon name="calendar" size={14} /> Resumo da reunião
                </h2>
                {/* O CABEÇALHO ERA IMUTÁVEL, e isso não era uma decisão — era
                    uma função sem chamador. `salvarCabecalho` existe desde o
                    primeiro dia, escrita separada dos itens exatamente para
                    este caso, e nenhuma tela a chamava.

                    O efeito era permanente e visível: a ata sempre nasce por
                    `api/ata/gerar`, que grava horário e local vazios e põe como
                    facilitador quem SUBIU o áudio — quase nunca quem conduziu.
                    O painel ficava com "Horário —", "Local —" e o nome errado,
                    para sempre. */}
                <button
                  className={styles.editarCabecalho}
                  onClick={() => setCabecalhoAberto(true)}
                  title="Corrigir horário, local, facilitador e participantes"
                  aria-label="Editar o cabeçalho da reunião"
                >
                  <Icon name="edit" size={13} />
                </button>
              </div>
              {/* A escolha da reunião mora AQUI, e não no cabeçalho da página:
                  ela é a primeira linha do resumo, que é o bloco que descreve
                  qual reunião está na tela. */}
              <div className={styles.campo}>
                <span>Reunião</span>
                <Select
                  value={ata.id}
                  options={atas.map(opcaoDeAta)}
                  onChange={setAtaSel}
                  ariaLabel="Reunião"
                />
              </div>
              {/* O RELATIVO AO LADO DA DATA, e é aqui que ele cabe.
                  "9 set" não diz sozinho se a reunião já aconteceu — e essa é a
                  primeira coisa que se quer saber ao abrir uma ata. Na lista
                  suspensa não havia espaço para ele sem espremer o título; aqui
                  há, e a informação fica a um olhar de distância da escolha. */}
              <Linha
                rotulo="Data"
                valor={
                  ata.data
                    ? `${fmtDayMonth(ata.data)} · ${relDay(ata.data, new Date())}`
                    : "—"
                }
              />
              <Linha
                rotulo="Horário"
                valor={
                  ata.horaInicio || ata.horaFim
                    ? `${ata.horaInicio || "—"} – ${ata.horaFim || "—"}`
                    : "—"
                }
              />
              <Linha rotulo="Local" valor={ata.local || "—"} />
              <Linha
                rotulo="Facilitador"
                valor={ata.facilitador ? nomeDe(ata.facilitador) : "—"}
              />
              {/* Citados NÃO é participantes, e por isso é outra linha: são os
                  nomes que a gravação ouviu, gente que pode nem ter conta no
                  app. Ver o comentário do campo em `ata-core`. */}
              {ata.citados.length > 0 && (
                <Linha rotulo="Citados na conversa" valor={ata.citados.join(", ")} />
              )}
              <div className={styles.campo}>
                <span>Participantes</span>
                {ata.participantes.length === 0 ? (
                  <div className={styles.valor}>—</div>
                ) : (
                  <div className={styles.rostos}>
                    {ata.participantes.slice(0, 5).map((e) => (
                      <Avatar
                        key={e}
                        pessoa={usersMap[e] ?? { name: nomeDe(e), email: e }}
                        size={28}
                      />
                    ))}
                    {ata.participantes.length > 5 && (
                      <span className={styles.maisRostos}>
                        +{ata.participantes.length - 5}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className={styles.painel}>
              <div className={styles.painelHead}>
                <h2>
                  <Icon name="kanban" size={14} /> Demandas em aberto
                </h2>
              </div>
              {/* A ordem vem de `ESTADOS_NA_ATA`, no core, e não de um array
                  literal aqui: o filtro logo abaixo usa a mesma lista, e quando
                  "registro" nasceu os dois teriam de ser lembrados. */}
              {ESTADOS_NA_ATA.map((e) => (
                  <button
                    key={e}
                    className={`${styles.contagem} ${fEstado === e ? styles.contagemOn : ""}`}
                    onClick={() => setFEstado(fEstado === e ? "" : e)}
                    aria-pressed={fEstado === e}
                    title={`Ver só as demandas com estado "${ESTADO_LABEL[e]}"`}
                  >
                    <span className={styles.dot} style={{ background: COR_ESTADO[e] }} />
                    <span className={styles.contagemNome}>{ESTADO_LABEL[e]}</span>
                  <b>{resumo.porEstado[e]}</b>
                </button>
              ))}
              <div className={styles.total}>
                <span>Total de demandas em aberto</span>
                <b>{resumo.emAberto}</b>
              </div>
              {resumo.tarefas > 0 && (
                <div className={styles.total}>
                  <span>Tarefas concluídas</span>
                  <b>
                    {resumo.tarefasFeitas}
                    <em>/{resumo.tarefas}</em>
                  </b>
                </div>
              )}
              {/* SÓ APARECE QUANDO HÁ O QUE CONSERTAR. Um "0 sem classificação"
                  fixo na lateral é uma linha que se aprende a não ler — e a
                  primeira vez que ela virasse 3, ninguém veria. */}
              {foraDoMapa.length > 0 && (
                <button
                  className={`${styles.alerta} ${soSemDim ? styles.alertaOn : ""}`}
                  onClick={() => setSoSemDim((v) => !v)}
                  aria-pressed={soSemDim}
                  title="Ver só o que ainda não tem dimensão"
                >
                  <Icon name="warn" size={13} />
                  <span>
                    {foraDoMapa.length === 1
                      ? "1 linha sem dimensão"
                      : `${foraDoMapa.length} linhas sem dimensão`}
                  </span>
                </button>
              )}
            </section>

            <div className={styles.lateralAcoes}>
              {/* "PUXAR DO ÁUDIO" só aparece na ata que ainda não tem reunião
                  ligada, e essa condição é a função inteira. A ata que nasceu de
                  "Gerar da reunião" já veio do documento; a que nasceu de "Abrir
                  a próxima reunião" tem `meetingId` nulo, e é ela que fica
                  esperando o áudio processar. Oferecer o botão nas duas faria a
                  primeira mostrar um modal que só sabe dizer "já está tudo aqui".

                  Fica na lateral, junto de "Abrir próxima reunião", porque as
                  duas são ações sobre a ATA inteira — o lápis do painel ao lado
                  edita o cabeçalho, que é outra coisa. */}
              {!ata.meetingId && (
                <button
                  className={styles.acaoSec}
                  onClick={() => setPuxarAberta(true)}
                  title="Trazer os assuntos do documento que o processamento do áudio gerou"
                >
                  <Icon name="mic" size={14} /> Puxar do áudio
                </button>
              )}
              <button
                className={styles.acaoSec}
                onClick={() => setProximaAberta(true)}
                title="Abrir a próxima ata já com os itens marcados"
              >
                <Icon name="calendar" size={14} /> Abrir próxima reunião
              </button>
              {/* Só para quem a regra do Firestore deixa apagar. Oferecer o
                  botão a todo mundo era prometer uma ação que o banco nega —
                  e a negativa chegava como silêncio. */}
              {podeExcluir && (
                <button
                  className={styles.acaoPerigo}
                  onClick={() => setApagando(true)}
                >
                  <Icon name="trash" size={14} /> Excluir esta ata
                </button>
              )}
            </div>
          </aside>

          <main className={styles.principal}>
            <div className={styles.filtros}>
              <div className={styles.buscawrap}>
                <Icon name="search" size={15} />
                <input
                  className={styles.busca}
                  placeholder="Buscar demanda ou tarefa…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <div className={styles.filtro}>
                <Select
                  value={fEstado}
                  options={[
                    { value: "", label: "Todas as demandas" },
                    ...ESTADOS_NA_ATA.map((e) => ({
                      value: e,
                      label: `${ESTADO_LABEL[e]} (${resumo.porEstado[e]})`,
                      color: COR_ESTADO[e],
                    })),
                  ]}
                  onChange={(v) => setFEstado(v as "" | EstadoNaAta)}
                  ariaLabel="Estado da demanda"
                />
              </div>
              <div className={styles.filtro}>
                <Select
                  value={fResp}
                  options={[
                    { value: "", label: "Todos os responsáveis" },
                    ...responsaveis.map((e) => ({
                      value: e,
                      label: nomeDe(e),
                      color: usersMap[e]?.color,
                    })),
                  ]}
                  onChange={setFResp}
                  ariaLabel="Responsável"
                />
              </div>
              {/* No fim da barra de filtros, e não no cabeçalho da página: o
                  cabeçalho fala da ATA (qual reunião, gerar outra), e isto fala
                  da PAUTA — que é o que está logo abaixo. */}
              {/* Toda demanda abre com a tabela de tarefas aberta, e uma pauta
                  de quinze itens obriga a rolar muito antes de chegar ao
                  terceiro assunto. Um botão só, que alterna, porque dois
                  ("recolher" e "expandir") ocupariam o dobro para responder à
                  mesma pergunta. */}
              <button
                className={styles.recolherTudo}
                onClick={() =>
                  setRecolhidos(
                    tudoRecolhido
                      ? new Set()
                      : new Set(pauta.map((l) => chaveDaLinha(l))),
                  )
                }
                title={
                  tudoRecolhido
                    ? "Mostrar as tarefas de todas as demandas"
                    : "Recolher as tarefas de todas as demandas"
                }
                aria-pressed={tudoRecolhido}
              >
                <Icon
                  name={tudoRecolhido ? "chevronBaixo" : "chevronCima"}
                  size={14}
                />
              </button>
              <button
                className={styles.addAssunto}
                onClick={() => setAssuntoAberto(true)}
                title="Acrescentar à pauta um assunto que ainda não é demanda"
              >
                <Icon name="plus" size={14} /> Assunto
              </button>
            </div>

            {pautaFiltrada.length === 0 ? (
              <EmptyState
                icon="kanban"
                title={
                  pauta.length === 0
                    ? "Esta reunião ainda não tem pauta"
                    : "Nenhuma demanda com esses filtros"
                }
                description={
                  pauta.length === 0
                    ? "Acrescente aqui o primeiro assunto da reunião. As demandas em aberto do quadro deste setor aparecem em bloco separado, logo abaixo."
                    : "Tire um dos filtros para ver o resto da pauta."
                }
                action={
                  pauta.length === 0 ? (
                    <button onClick={() => setAssuntoAberto(true)}>
                      <Icon name="plus" size={14} /> Acrescentar assunto
                    </button>
                  ) : undefined
                }
              />
            ) : (
              SECOES.map(({ chave, titulo, explica, sempreAberta }) => {
                const linhas = porSecao[chave];
                /**
                 * SEÇÃO VAZIA NÃO DESENHA CABEÇALHO — com uma exceção.
                 *
                 * "O que esta reunião registrou" aparece mesmo vazia, e é o
                 * ponto inteiro desta mudança: a ata de 09/09/2026 das Cantinas
                 * não tinha item nenhum gravado e abria mostrando nove
                 * assuntos, todos do quadro. Quem a marcou leu aquilo como
                 * vazamento. Com o cabeçalho vazio ali, a tela passa a dizer a
                 * verdade — a reunião ainda não registrou nada — em vez de
                 * deixar o bloco do quadro responder por ela.
                 */
                if (!linhas.length && !sempreAberta) return null;
                const aberta = !secoesFechadas.has(chave);
                return (
                  <section key={chave} className={styles.secao}>
                    <button
                      className={styles.secaoTopo}
                      onClick={() =>
                        setSecoesFechadas((cur) => {
                          const n = new Set(cur);
                          if (n.has(chave)) n.delete(chave);
                          else n.add(chave);
                          return n;
                        })
                      }
                      aria-expanded={aberta}
                    >
                      <Icon name={aberta ? "chevronCima" : "chevronBaixo"} size={14} />
                      <span className={styles.secaoTitulo}>{titulo}</span>
                      <span className={styles.secaoConta}>{linhas.length}</span>
                      <span className={styles.secaoExplica}>{explica}</span>
                    </button>
                    {aberta && !linhas.length && (
                      <p className={styles.secaoVazia}>
                        Nada foi registrado nesta reunião ainda. O que a equipe
                        decidir aqui, e os assuntos que ela levantar, aparecem
                        neste bloco.
                      </p>
                    )}
                    {aberta &&
                      linhas.map((linha) => (
              <BlocoDaDemanda
                  key={chaveDaLinha(linha)}
                  linha={linha}
                  nomeDe={nomeDe}
                  usersMap={usersMap}
                  pessoas={pessoasDaAta}
                  semDimensao={idsForaDoMapa.has(linha.item.id)}
                  destacado={destaque === chaveDaLinha(linha)}
                  /* A MESMA chave da `key` acima, e não o `item.id` cru: com o
                     id trocando na primeira gravação, recolher as tarefas de
                     uma demanda e depois escrever a decisão dela faria a tabela
                     reabrir sozinha, desfazendo o que a pessoa acabou de pedir. */
                  recolhido={recolhidos.has(chaveDaLinha(linha))}
                  onRecolher={() =>
                    setRecolhidos((cur) => {
                      const n = new Set(cur);
                      const k = chaveDaLinha(linha);
                      if (n.has(k)) n.delete(k);
                      else n.add(k);
                      return n;
                    })
                  }
                  onGravar={(muda) => gravarItem(linha.item, muda)}
                  onClassificar={() => setClassificando(linha)}
                  onPromover={() => setPromovendo(linha)}
                  onEditar={() => setEditando(linha)}
                  /* Sem uma segunda reunião no setor não há para onde mover, e
                     o botão não nasce — ver `onMover`. */
                  onMover={atas.length > 1 ? () => setMovendo(linha) : null}
                  origemRotulo={rotuloDaOrigem(linha.item)}
                  levadaRotulo={rotuloDaLevada(linha.item)}
                  /* Só na linha que perdeu o card: `tituloDoCard` lê os cards
                     crus, lixeira inclusive — ver o comentário dele. */
                  tituloDeReserva={
                    linha.foraDoQuadro ? tituloDoCard(linha.item.cardId) : ""
                  }
                  /* Mesma regra do chip de origem: a ata de destino pode ter
                     sido apagada, e um link que não leva a lugar nenhum é pior
                     do que texto. */
                  onAbrirLevada={
                    atas.some((a) => a.id === linha.item.levadaParaAtaId)
                      ? () => setAtaSel(linha.item.levadaParaAtaId)
                      : null
                  }
                  /* A ata de origem pode ter sido apagada — aí o chip continua
                     dizendo que a linha é herdada, mas deixa de ser link. */
                  onAbrirOrigem={
                    linha.item.origem === "herdado" &&
                    atas.some((a) => a.id === linha.item.origemAtaId)
                      ? () => setAtaSel(linha.item.origemAtaId)
                      : null
                  }
                  temProxima={proximas.length > 0}
                  onLevar={() => setLevando(linha)}
                />
                      ))}
                  </section>
                );
              })
            )}
          </main>
        </div>
      )}

      {assuntoAberto && ata && (
        <ModalDeAssunto
          setor={setor}
          dimensoes={dims}
          onFechar={() => setAssuntoAberto(false)}
          onSalvar={async (dados) => {
            // Os filtros saem do caminho: acrescentar um assunto e ele não
            // aparecer porque um filtro de responsável de dez minutos atrás
            // continua ligado seria o mesmo que o botão não ter funcionado.
            limparFiltros();
            setDestaque(await criarAssunto(dados));
            setAssuntoAberto(false);
          }}
        />
      )}

      {editando && ata && (
        <ModalDeAssunto
          setor={setor}
          dimensoes={dims}
          /* Com `inicial` preenchido, o mesmo modal é o de EDIÇÃO. Um segundo
             componente com os mesmos três campos seria o lugar onde a régua da
             dimensão deixaria de valer no dia em que ela mudasse. */
          inicial={{
            assunto: editando.item.assunto,
            contexto: editando.item.contexto,
            dimensaoId: editando.item.dimensaoId,
            subdimensaoId: editando.item.subdimensaoId,
          }}
          onFechar={() => setEditando(null)}
          onSalvar={async (dados) => {
            await salvarAssunto(editando, dados);
            // A LINHA CORRIGIDA PODE SAIR DE ONDE ESTAVA, e por dois motivos:
            // um filtro de busca que o nome novo não casa mais, e a ordenação
            // da pauta, que desempata por dimensão e por título. Sem tirar os
            // filtros e sem levar os olhos até ela, salvar leria exatamente
            // como apagar.
            limparFiltros();
            setDestaque(chaveDaLinha(editando));
            setEditando(null);
          }}
        />
      )}

      {movendo && ata && (
        <ModalDeMover
          setor={setor}
          linha={movendo}
          /* A ata de origem sai da lista: mover para ela mesma é o único
             destino que `moverAssunto` recusa, e oferecê-lo seria desenhar um
             caminho que só sabe terminar em erro. */
          destinos={atas.filter((a) => a.id !== ata.id)}
          onFechar={() => setMovendo(null)}
          onMover={async (destinoId) => {
            const destino = await mover(movendo, destinoId);
            setMovendo(null);
            // A LINHA SOME DESTA PAUTA NO MESMO INSTANTE, e sumiço sem endereço
            // lê como exclusão. Esta frase é o recibo: diz para onde foi e o
            // que foi junto.
            setAviso(
              `“${movendo.titulo}” foi para ${rotuloDaAta(destino)}, com a decisão, o objetivo e as tarefas. Esta pauta não tem mais essa linha.`,
            );
          }}
        />
      )}

      {promovendo && ata && (
        <ModalDeDemanda
          setor={setor}
          linha={promovendo}
          dimensoes={dims}
          pessoas={pessoasDaAta}
          colunaDeEntrada={colunas[0]?.title ?? ""}
          onFechar={() => setPromovendo(null)}
          onCriar={async (dados) => {
            // A chave da linha passa a ser o `cardId` assim que o vínculo é
            // gravado (`chaveDaLinha`), e a linha muda de lugar na pauta —
            // deixa de ser "registro" e passa a valer o estado do card.
            setDestaque(await criarDemanda(promovendo, dados));
            setPromovendo(null);
          }}
        />
      )}

      {classificando && ata && (
        <ModalDeClassificar
          setor={setor}
          linha={classificando}
          dimensoes={dims}
          onFechar={() => setClassificando(null)}
          onSalvar={async (escolha) => {
            await classificar(classificando, escolha);
            setClassificando(null);
          }}
        />
      )}

      {linhaAberta && (
        <LinhaDoTempo
          setor={setor}
          atas={atas}
          tituloDoCard={tituloDoCard}
          classeDoItem={classeDoItem}
          nomeDe={nomeDe}
          usersMap={usersMap}
          onFechar={() => setLinhaAberta(false)}
          onAbrirAta={(id) => {
            // Sair da leitura para a edição: a reunião clicada passa a ser a da
            // tela de trás, e os dois modais fecham. Deixar o gráfico aberto por
            // cima da ata que ele acabou de escolher seria pedir mais um clique
            // para ver o que a pessoa já pediu.
            setAtaSel(id);
            setLinhaAberta(false);
          }}
        />
      )}

      {levando && ata && (
        <ModalDeLevar
          setor={setor}
          linha={levando}
          destinos={proximas}
          onFechar={() => setLevando(null)}
          onLevar={async (destinoId) => {
            const destino = await levar(levando, destinoId);
            setLevando(null);
            setAviso(
              `"${levando.titulo}" foi levado para ${rotuloDaAta(destino)}. Ele continua nesta ata, com a decisão de hoje.`,
            );
          }}
        />
      )}

      {puxarAberta && ata && (
        <ModalDePuxar
          ata={ata}
          reunioes={reunioes}
          fonte={fReunioes}
          onFechar={() => setPuxarAberta(false)}
          onMesclado={(entraram) => {
            setPuxarAberta(false);
            // Os filtros saem do caminho, como em `criarAssunto`: acrescentar
            // linhas e elas não aparecerem porque um filtro de dez minutos atrás
            // continua ligado seria o mesmo que o botão não ter funcionado.
            limparFiltros();
            setAviso(
              entraram > 0
                ? `${entraram} assunto(s) novo(s) do áudio entraram na pauta. O que já estava escrito na ata não foi tocado.`
                : "Os assuntos do áudio foram somados à pauta. O que já estava escrito na ata não foi tocado.",
            );
          }}
        />
      )}

      {gerarAberta && (
        <ModalDeGerar
          setor={setor}
          setores={sectors}
          reunioes={reunioes}
          fonte={fReunioes}
          onFechar={() => setGerarAberta(false)}
          onGerado={(id, setorDestino, jaExistia) => {
            // A ata pode ter nascido em OUTRO setor — é o caso normal, não a
            // exceção. Trocar o quadro junto é o que faz o botão terminar
            // mostrando a ata que ele acabou de criar, em vez de deixar a
            // pessoa procurando por ela numa aba que não a contém.
            if (setorDestino !== setor) setQuadroSel(setorDestino);
            setAtaSel(id);
            setGerarAberta(false);
            // A rota é idempotente e responde `jaExistia`. Sem dizer isso, quem
            // gerou de novo uma ata que já tinha seis decisões escritas não
            // recebe nenhum sinal de que abriu a existente — e pode passar a
            // reunião inteira achando que está numa ata nova, em branco.
            if (jaExistia) {
              setAviso(
                "Esta reunião já tinha ata neste setor. Abrimos a que existe, com o que já foi registrado nela.",
              );
            }
          }}
        />
      )}

      {proximaAberta && ata && (
        <ModalDeAta
          titulo="Abrir a próxima reunião"
          setor={setor}
          users={users}
          /* Os itens marcados como "levar para a próxima" já vêm junto — o
             cabeçalho é o que falta preencher. */
          aviso={`${ata.itens.filter((i) => i.proximaReuniao).length} item(ns) marcado(s) serão levados, com as tarefas ainda abertas.`}
          inicial={{
            titulo: ata.titulo,
            local: ata.local,
            facilitador: ata.facilitador,
            participantes: ata.participantes,
          }}
          onFechar={() => setProximaAberta(false)}
          onCriar={async (dados) => {
            // `dados` vai INTEIRO. Antes desta versão o `abrirProxima` só
            // aceitava título e data, e os outros cinco campos que o formulário
            // acabou de coletar caíam no chão — a ata nova nascia com o local e
            // o facilitador da reunião ANTERIOR, e sem horário nenhum.
            const id = await escrever(() =>
              abrirProxima(ata, dados, profile.email),
            );
            setAtaSel(id);
            setProximaAberta(false);
          }}
        />
      )}

      {cabecalhoAberto && ata && (
        <ModalDeAta
          titulo="Editar o cabeçalho da reunião"
          setor={setor}
          users={users}
          aviso="Isto muda só o cabeçalho. A pauta, as decisões e as tarefas ficam como estão."
          rotuloAcao="Salvar"
          inicial={{
            titulo: ata.titulo,
            data: ata.data,
            horaInicio: ata.horaInicio,
            horaFim: ata.horaFim,
            local: ata.local,
            facilitador: ata.facilitador,
            participantes: ata.participantes,
          }}
          onFechar={() => setCabecalhoAberto(false)}
          onCriar={async (dados) => {
            await escrever(() => salvarCabecalho(ata.id, dados));
            setCabecalhoAberto(false);
          }}
        />
      )}

      {apagando && ata && (
        <Modal
          onClose={() => setApagando(false)}
          ariaLabel="Excluir esta ata"
          overlayClassName={styles.overlay}
          className={styles.modal}
          width={430}
        >
          <div className={styles.mhead}>
            <span className={styles.mchip}>
              <Icon name="trash" size={12} /> Ata
            </span>
            <span className={styles.mchip}>{setor}</span>
          </div>
          <h2 className={styles.mtitulo}>{ata.titulo}</h2>
          <p className={styles.confirma}>
            <strong>Excluir esta ata?</strong> Ela some para todo o setor, com as
            decisões e as tarefas registradas nela.
          </p>
          <p className={styles.confirma}>
            As demandas do quadro NÃO são tocadas — a ata é o registro da
            reunião, não a dona delas.
          </p>
          <div className={styles.macoes}>
            <button className={styles.btnGhost} onClick={() => setApagando(false)} autoFocus>
              Manter a ata
            </button>
            <button
              className={styles.btnPerigo}
              onClick={excluirAta}
              disabled={emVoo > 0}
            >
              {emVoo > 0 ? "Excluindo…" : "Excluir"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className={styles.campo}>
      <span>{rotulo}</span>
      <div className={styles.valor}>{valor}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O bloco de uma demanda
// ---------------------------------------------------------------------------

/**
 * De onde este assunto veio — o chip ao lado da numeração.
 *
 * POR QUE ELE EXISTE. A pauta desenhava as três procedências iguais, e a
 * primeira pergunta de quem conduz a reunião é justamente qual é qual: o áudio
 * trouxe, alguém lançou antes de começar, ou é assunto pendurado da semana
 * passada. Na reunião de 02/09/2026 as três estavam na mesma ata, sem nada
 * distinguindo — e as três pedem coisas diferentes de quem lê. O que o áudio
 * trouxe já é registro do que foi dito; o que alguém lançou à mão ainda espera
 * ser falado; o herdado espera que se cobre o que ficou combinado.
 *
 * É UM CHIP, E NÃO TRÊS LAYOUTS. Desenhar cada origem com moldura, cor e
 * campos próprios daria uma pauta que parece três telas empilhadas, e a ata é
 * lida de cima a baixo em voz alta — a leitura é que tem de ser contínua. O que
 * muda entre as origens é uma informação, então o que muda na tela é um rótulo.
 *
 * SEM MOTION, e é a Frequency Gate do AGENTS.md §3 respondendo: é um rótulo
 * estático numa lista que redesenha a cada tecla digitada em qualquer decisão
 * da pauta. Animar a entrada dele faria a tela inteira piscar durante a
 * reunião.
 *
 * COR EM TOKEN, e neutra. Os pares `--s3`/`--tx-2` são os mesmos do selo de
 * `registro` (ver `SELO_ESTADO`), pelo mesmo motivo escrito lá: origem não é
 * alerta, e um chip aceso ao lado de cada linha ensinaria a ignorar os selos
 * que são. Hex chumbado está fora de questão — o acento Entre Aulas redefine a
 * paleta, e o tema claro reprovava em contraste.
 */
function OrigemDoAssunto({
  origem,
  rotulo,
  onAbrir,
}: {
  origem: OrigemDoItem;
  rotulo: string;
  onAbrir: (() => void) | null;
}) {
  const icone = origem === "reuniao" ? "mic" : origem === "herdado" ? "calendar" : "edit";

  // O herdado com origem viva é BOTÃO: "veio de 26/08" sem caminho até o 26/08
  // pede que a pessoa procure a reunião na lista para conferir o que ficou
  // combinado — e é a conferência que faz o chip valer a pena.
  if (origem === "herdado" && onAbrir) {
    return (
      <button
        className={`${styles.origemChip} ${styles.origemLink}`}
        onClick={onAbrir}
        title="Abrir a reunião de onde este assunto veio"
      >
        <Icon name={icone} size={11} /> {rotulo}
      </button>
    );
  }

  return (
    <span className={styles.origemChip}>
      <Icon name={icone} size={11} /> {rotulo}
    </span>
  );
}

/**
 * Uma demanda na pauta: o que se decidiu, o que se espera, e o que ficou.
 *
 * DECISÃO E OBJETIVO SÃO EDITADOS NO LUGAR, não num modal. A tela é preenchida
 * DURANTE a reunião, e um modal por campo custa dois cliques e tapa o resto da
 * pauta justo quando alguém está lendo em voz alta a demanda seguinte. Salvam
 * no `blur`: quem sai do campo já disse que terminou de escrever.
 */
function BlocoDaDemanda({
  linha,
  nomeDe,
  usersMap,
  pessoas,
  semDimensao,
  destacado,
  recolhido,
  onRecolher,
  onGravar,
  onClassificar,
  onPromover,
  onEditar,
  onMover,
  origemRotulo,
  onAbrirOrigem,
  levadaRotulo,
  tituloDeReserva,
  onAbrirLevada,
  temProxima,
  onLevar,
}: {
  linha: ItemDaPauta;
  nomeDe: (email: string) => string;
  usersMap: Record<string, UserProfile>;
  pessoas: SelectOption[];
  /** Calculado uma vez na página — ver `foraDoMapa`. */
  semDimensao: boolean;
  /** Acabou de nascer: rola até aqui e acende por um instante. */
  destacado: boolean;
  recolhido: boolean;
  onRecolher: () => void;
  onGravar: (muda: (i: ItemDeAta) => ItemDeAta) => void;
  onClassificar: () => void;
  onPromover: () => void;
  /** Corrigir o assunto e o contexto — só a linha sem card oferece. */
  onEditar: () => void;
  /**
   * Mudar de reunião, ou `null` quando não há para onde.
   *
   * Nulo em vez de um segundo `podeMover`: quem sabe se existe outra ata do
   * setor é a página, e um botão que só sabe responder "não há para onde" é
   * pior do que botão nenhum — ele ensina a duvidar dos outros.
   */
  onMover: (() => void) | null;
  /**
   * O texto do chip de origem — a página o resolve, e não este bloco.
   *
   * Quem sabe traduzir `origemAtaId` em "veio de 26/08" é quem tem a lista de
   * atas do setor, e ela mora na página. Passar o id cru para cá obrigaria o
   * bloco a receber `atas` inteiro só para procurar uma data — e a lista
   * redesenha a cada snapshot do Firestore, o que faria toda a pauta remontar.
   */
  origemRotulo: string;
  /**
   * Ir até a reunião de origem, ou `null` quando não há para onde.
   *
   * Nulo pelo mesmo motivo de `onMover`: a ata de origem pode ter sido
   * apagada. Aí o chip continua dizendo que a linha é herdada — isso é verdade
   * e é registro — mas deixa de ser botão, porque um link que não leva a lugar
   * nenhum é pior do que texto.
   */
  onAbrirOrigem: (() => void) | null;
  /**
   * "16/09" quando este assunto JÁ FOI levado para outra reunião, ou `null`.
   *
   * Mesma divisão de trabalho de `origemRotulo`, e pelo mesmo motivo: quem
   * traduz `levadaParaAtaId` em data é a página, que tem a lista de atas.
   *
   * POR QUE ELE PRECISOU EXISTIR. Até aqui, levar um assunto deixava a marca
   * `proximaReuniao` acesa e o botão dizendo "Levar para outra reunião" —
   * exatamente como antes do clique. Nada na linha dizia que o bastão já tinha
   * sido passado, nem para quem, e o segundo clique era o gesto natural de quem
   * não sabia se o primeiro funcionou.
   */
  levadaRotulo: string | null;
  /**
   * O título que a LIXEIRA ainda guarda, para a linha que ficou sem nome.
   *
   * O CASO, e ele apareceu em produção no dia em que isto foi escrito: a demanda
   * entrou na pauta pelo quadro, alguém escreveu uma tarefa nela — e a linha
   * gravou `cardId` com `assunto` vazio, que é o certo (nome é estado, e estado
   * vem do card). Depois o card foi para a lixeira. A partir daí `montarPauta`
   * desenha a linha SEM card, o título sai do `assunto` que nunca existiu, e o
   * que sobrava na tela era a frase "Demanda sem título na ata" — verdadeira e
   * inútil, no meio de uma pauta de reunião.
   *
   * A ata é REGISTRO: aquela demanda foi discutida naquele dia, e o nome dela
   * não deixou de existir por ter saído do quadro. Quem o tem é a página, que
   * assina os cards do setor INCLUSIVE os da lixeira.
   *
   * Não é copiado para dentro do item de propósito — continua sendo referência,
   * e continua acompanhando um rename. Quando nem a lixeira souber responder (o
   * card foi excluído de vez, ou mudou de setor), a frase de antes volta, que é
   * o que sobra de honesto.
   */
  tituloDeReserva: string;
  /**
   * Ir até a reunião para onde o assunto foi, ou `null` quando ela não existe
   * mais. Mesma degradação de `onAbrirOrigem`.
   */
  onAbrirLevada: (() => void) | null;
  /**
   * Existe reunião futura neste setor?
   *
   * Quem sabe é a página, que tem a lista de atas — o mesmo raciocínio de
   * `onMover`. Vem como booleano e não como lista porque o bloco não escolhe o
   * destino: ele só precisa saber se o clique abre uma escolha ou acende um
   * interruptor.
   */
  temProxima: boolean;
  /** Abrir o seletor de destino. Só é chamado quando `temProxima`. */
  onLevar: () => void;
}) {
  const {
    card,
    item,
    titulo,
    descricao,
    estado,
    numero,
    dimensao,
    subdimensao,
    foraDoQuadro,
  } = linha;
  const [decisao, setDecisao] = useState(item.decisao);
  const [objetivo, setObjetivo] = useState(item.objetivo);

  /**
   * O texto do banco só sobrescreve o rascunho quando eles DIVERGEM de verdade.
   *
   * O campo é não-controlado enquanto se digita (estado local) e volta a seguir
   * a ata quando o snapshot traz outro valor. Sem esta comparação, cada
   * snapshot do Firestore — inclusive o eco da própria escrita — devolveria o
   * cursor para o fim do campo no meio da digitação de outra pessoa.
   */
  const [ecoDecisao, setEcoDecisao] = useState(item.decisao);
  if (item.decisao !== ecoDecisao) {
    setEcoDecisao(item.decisao);
    setDecisao(item.decisao);
  }
  const [ecoObjetivo, setEcoObjetivo] = useState(item.objetivo);
  if (item.objetivo !== ecoObjetivo) {
    setEcoObjetivo(item.objetivo);
    setObjetivo(item.objetivo);
  }

  /**
   * A altura do campo acompanha o texto — a ata é lida muito mais vezes do que
   * escrita.
   *
   * As duas linhas fixas bastavam enquanto a decisão era digitada durante a
   * reunião, com o cronômetro correndo: ninguém escreve um parágrafo assim. A
   * decisão que vem do documento da reunião é bem mais longa, e duas linhas a
   * cortavam no meio de uma palavra — escondendo o campo mais importante da
   * tela atrás de uma barra de rolagem que ninguém vê.
   *
   * Conta de linha em vez de auto-resize: medir o textarea de verdade pede um
   * efeito lendo `scrollHeight` a cada render, e isso é trabalho de layout em
   * cima de uma lista inteira que já redesenha junto. O teto de 8 segura o
   * bloco; passou disso, a rolagem volta e a alça do canto continua lá.
   */
  const alturaDe = (texto: string) =>
    Math.min(
      8,
      Math.max(
        2,
        // As quebras de linha contam junto com o comprimento: desde que
        // `limparParagrafo` passou a preservá-las, um texto de três parágrafos
        // curtos ocupa três linhas e a conta por caractere sozinha devolveria
        // duas — cortando o parágrafo do meio atrás de uma rolagem que ninguém
        // vê.
        Math.ceil(texto.length / 38) + (texto.match(/\n/g)?.length ?? 0),
      ),
    );

  /**
   * Levar os olhos até a linha que acabou de nascer.
   *
   * `block: "center"` e não `"start"`: a linha nova quase sempre está no fim de
   * uma pauta longa, e alinhar no topo a deixaria colada na barra de filtros,
   * com a tabela de tarefas dela cortada embaixo.
   *
   * O `behavior` respeita `prefers-reduced-motion` porque o bloco global de
   * `globals.css` não alcança rolagem programática — ele força
   * `scroll-behavior: auto` no CSS, e este `behavior: "smooth"` passa por cima
   * de CSS. Aqui a pergunta tem de ser feita em JavaScript.
   *
   * QUEM APAGA O DESTAQUE É A PÁGINA, e não este bloco. O relógio precisa
   * sobreviver ao bloco sair da lista filtrada; um `setTimeout` daqui morreria
   * junto com ele e o anel voltaria aceso na próxima vez que a linha aparecesse.
   */
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!destacado) return;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({
      block: "center",
      behavior: suave ? "smooth" : "auto",
    });
  }, [destacado]);

  return (
    <section
      className={`${styles.bloco} ${destacado ? styles.blocoNovo : ""}`}
      ref={ref}
    >
      <div className={styles.blocoTopo}>
        <div className={styles.demanda}>
          {/* "Demanda" só quando é demanda. O assunto que a reunião discutiu e
              que ainda não virou card é ASSUNTO — chamá-lo de demanda faria a
              ata prometer um card que não existe no quadro.

              E "Demanda fora do quadro" quando o item aponta para um card que
              não está mais lá: chamá-la de assunto contaria a história errada —
              ela FOI demanda, e a decisão que a reunião tomou sobre ela continua
              valendo. */}
          <div className={styles.demandaRot}>
            {card ? "Demanda" : foraDoQuadro ? "Demanda fora do quadro" : "Assunto"} ·{" "}
            {numero}
            {/* O CHIP DE ORIGEM, e ele só aparece no assunto sem card.

                Onde há card, a procedência de que se fala é a do CARD — e ela
                já é do quadro, respondida por "origem" no histórico dele. Um
                chip "lançado à mão" ao lado de uma demanda diria uma coisa
                sobre a linha da ata que quem lê entenderia como sendo sobre a
                demanda, e as duas têm nascimentos diferentes.

                A linha fora do quadro também não recebe: ela FOI demanda, e o
                que ela precisa dizer é justamente isso — a frase logo abaixo já
                faz esse trabalho, e um segundo rótulo ali competiria com ela. */}
            {!card && !foraDoQuadro && (
              <OrigemDoAssunto
                origem={item.origem}
                rotulo={origemRotulo}
                onAbrir={onAbrirOrigem}
              />
            )}
            {/* O CHIP DO BASTÃO JÁ PASSADO, e este aparece TAMBÉM na linha com
                card — ao contrário do de origem.

                A diferença é que ele não fala da procedência da linha, e sim do
                que ESTA reunião decidiu sobre ela: "isto volta a ser falado em
                16/09". Levar aceita demanda do quadro de propósito (é o caso
                mais comum do botão), então esconder o chip onde há card
                esconderia o aviso justo na maioria das linhas. */}
            {levadaRotulo &&
              (onAbrirLevada ? (
                <button
                  className={`${styles.origemChip} ${styles.origemLink} ${styles.levadaChip}`}
                  onClick={onAbrirLevada}
                  title="Abrir a reunião para onde este assunto foi levado"
                >
                  <Icon name="calendar" size={11} /> {levadaRotulo}
                </button>
              ) : (
                <span className={`${styles.origemChip} ${styles.levadaChip}`}>
                  <Icon name="calendar" size={11} /> {levadaRotulo}
                </span>
              ))}
          </div>
          {/* A RESERVA VEM ANTES DO `titulo`, e não depois — é a regra da casa
              aplicada onde ela ainda não valia. Onde há card, quem responde pelo
              nome é o CARD; `assunto` é o que a reunião CHAMOU aquilo, e só é
              lido quando card nunca houve (cabeçalho de `ItemDeAta`). A linha
              fora do quadro teve card, e a lixeira ainda sabe o nome dele —
              preferir o `assunto` aqui faria uma demanda de verdade aparecer na
              pauta pelo apelido que um bloco do documento lhe deu. */}
          <h3>
            {tituloDeReserva ||
              titulo ||
              (foraDoQuadro ? "Demanda sem título na ata" : "")}
          </h3>
          {foraDoQuadro && (
            <p className={styles.foraDoQuadro}>
              A demanda saiu do quadro deste setor — foi para a lixeira, mudou de
              setor ou foi excluída. O que a reunião decidiu sobre ela fica aqui.
            </p>
          )}
          {descricao && <p>{descricao}</p>}
          <div className={styles.rodapeDemanda}>
            {/* A dimensão é CLASSIFICADOR, e vai ao lado — nunca por cima. É a
                decisão registrada na ata que originou esta tela.

                Virou BOTÃO, e sem classificação ele acende: toda demanda desta
                aba precisa de dimensão, e uma etiqueta que só some quando falta
                deixa o problema calado — que é o oposto de cobrar. */}
            <button
              className={`${styles.area} ${semDimensao ? styles.areaFalta : ""}`}
              onClick={onClassificar}
              title={
                semDimensao
                  ? "Escolher a dimensão desta linha"
                  : "Trocar a dimensão desta linha"
              }
            >
              <Icon name={semDimensao ? "warn" : "dimensoes"} size={12} />
              {semDimensao ? (
                "Sem dimensão"
              ) : (
                <>
                  {dimensao}
                  {subdimensao ? ` · ${subdimensao}` : ""}
                </>
              )}
            </button>
            {/* SÓ NO ASSUNTO — os três botões, e por razões diferentes.

                "Criar demanda": a linha que já tem card não vira demanda de
                novo, e oferecer o botão ali seria oferecer a duplicata — nem a
                que está no quadro, nem a que saiu dele: a segunda já teve card,
                e abrir outro perderia o vínculo com o que foi para a lixeira.

                "Editar": aqui o assunto e o contexto são o ÚNICO nome que a
                linha tem, e até esta versão eram texto morto — nascido no modal
                e sem caminho de volta. Onde há card, quem responde pelo nome é
                o quadro, e o lugar de corrigi-lo é o Kanban; oferecer o botão
                ali deixaria alguém achando que renomeou a demanda escrevendo em
                dois campos que a tela não lê mais. A dimensão continua no botão
                ao lado, porque ela também é editável na linha COM card — e lá a
                escrita cai no card, não no item.

                "Mover": o assunto mora DENTRO de uma ata, e é a única linha da
                pauta de que isso é verdade. A demanda do quadro já aparece em
                toda reunião do setor, vinda do Kanban — mover o item dela não a
                moveria, apenas levaria para outro dia a decisão tomada neste. */}
            {!card && !foraDoQuadro && (
              <>
                <button
                  className={styles.acaoAssunto}
                  onClick={onEditar}
                  title="Corrigir o assunto e o contexto desta linha"
                >
                  <Icon name="edit" size={12} /> Editar
                </button>
                {onMover && (
                  <button
                    className={styles.acaoAssunto}
                    onClick={onMover}
                    title="Mover este assunto para outra reunião do setor"
                  >
                    <Icon name="ata" size={12} /> Mover
                  </button>
                )}
                <button
                  className={styles.virarDemanda}
                  onClick={onPromover}
                  title="Abrir esta linha como demanda no quadro do setor"
                >
                  <Icon name="kanban" size={12} /> Criar demanda
                </button>
              </>
            )}
          </div>
        </div>

        <div className={`${styles.coluna} ${styles.colStatus}`}>
          <div className={styles.colunaRot}>Status da demanda</div>
          <span
            className={styles.selo}
            style={{
              background: SELO_ESTADO[estado].bg,
              color: SELO_ESTADO[estado].tx,
            }}
          >
            {ESTADO_LABEL[estado]}
          </span>
          {card?.assignee && (
            <div className={styles.resp}>
              <Avatar
                pessoa={
                  usersMap[card.assignee] ?? {
                    name: nomeDe(card.assignee),
                    email: card.assignee,
                  }
                }
                size={20}
              />
              {nomeDe(card.assignee)}
            </div>
          )}
        </div>

        <div className={`${styles.coluna} ${styles.colDecisao}`}>
          <div className={styles.colunaRot}>Decisão registrada</div>
          <textarea
            className={styles.campoTexto}
            value={decisao}
            placeholder="—"
            rows={alturaDe(decisao)}
            maxLength={LIMITE_TEXTO_CHARS}
            onChange={(e) => setDecisao(e.target.value)}
            onBlur={() => {
              if (decisao !== item.decisao)
                onGravar((i) => ({ ...i, decisao: decisao.trim() }));
            }}
            aria-label={`Decisão registrada sobre ${titulo}`}
          />
        </div>

        <div className={`${styles.coluna} ${styles.colObjetivo}`}>
          <div className={styles.colunaRot}>Objetivo na próxima reunião</div>
          <textarea
            className={styles.campoTexto}
            value={objetivo}
            placeholder="—"
            rows={alturaDe(objetivo)}
            maxLength={LIMITE_TEXTO_CHARS}
            onChange={(e) => setObjetivo(e.target.value)}
            onBlur={() => {
              if (objetivo !== item.objetivo)
                onGravar((i) => ({ ...i, objetivo: objetivo.trim() }));
            }}
            aria-label={`Objetivo na próxima reunião para ${titulo}`}
          />
          {/* DOIS COMPORTAMENTOS, e quem decide qual é a EXISTÊNCIA de uma
              reunião futura no setor — não uma preferência.

              Com reunião futura, o botão abre o seletor e a cópia acontece na
              hora: é o caso que estava quebrado, porque o flag só era colhido
              por "Abrir a próxima reunião", que apenas cria ata. Sem reunião
              futura, ele continua sendo o interruptor de antes, colhido na hora
              de abrir a próxima — e esse caminho é o certo para quando a próxima
              ainda não foi marcada.

              O rótulo muda junto, porque as duas coisas são diferentes: "Levar
              para…" abre uma escolha, "Vai para a próxima" é um estado. */}
          <button
            className={`${styles.levar} ${item.proximaReuniao ? styles.levarOn : ""}`}
            onClick={() =>
              temProxima
                ? onLevar()
                : onGravar((i) => ({ ...i, proximaReuniao: !i.proximaReuniao }))
            }
            aria-pressed={temProxima ? undefined : item.proximaReuniao}
            title={
              temProxima
                ? "Copiar este assunto para a pauta de uma reunião futura"
                : "Marcar para a próxima ata que for aberta"
            }
          >
            <Icon
              name={!temProxima && item.proximaReuniao ? "check" : "calendar"}
              size={13}
            />
            {temProxima
              ? "Levar para outra reunião"
              : item.proximaReuniao
                ? "Vai para a próxima"
                : "Levar para próxima reunião"}
          </button>
        </div>

        <button
          className={styles.recolher}
          onClick={onRecolher}
          aria-expanded={!recolhido}
          title={recolhido ? "Mostrar as tarefas" : "Recolher as tarefas"}
        >
          <Icon name={recolhido ? "chevronBaixo" : "chevronCima"} size={14} />
        </button>
      </div>

      {!recolhido && (
        <TabelaDeTarefas
          tarefas={item.tarefas}
          nomeDe={nomeDe}
          pessoas={pessoas}
          onGravar={onGravar}
        />
      )}
    </section>
  );
}

/**
 * Uma célula de texto da tabela de tarefas — que grava quando você SAI dela.
 *
 * Antes disto, os dois campos de texto da tabela chamavam `onGravar` no
 * `onChange`, e `onGravar` é `salvarItens`: uma escrita do array de itens
 * INTEIRO da ata, no Firestore, por caractere digitado. Uma tarefa de quarenta
 * letras eram quarenta escritas do documento inteiro, durante a reunião, com
 * outras pessoas na mesma tela recebendo os quarenta snapshots de volta.
 *
 * A decisão e o objetivo, no bloco acima, já faziam o certo — estado local e
 * gravação no `blur`. Isto é a mesma coisa, extraída porque agora são dois
 * campos por linha vezes as linhas de cada demanda da pauta.
 *
 * O Enter tira o foco de propósito: numa tabela que se preenche com o
 * cronômetro correndo, "terminei esta célula" é o gesto mais frequente que
 * existe, e ele não pode exigir mirar o mouse em outro lugar.
 */
function CelulaTexto({
  valor,
  placeholder,
  ariaLabel,
  onGravar,
}: {
  valor: string;
  placeholder?: string;
  ariaLabel: string;
  onGravar: (v: string) => void;
}) {
  const [texto, setTexto] = useState(valor);
  // O mesmo eco de `BlocoDaDemanda`, e pelo mesmo motivo: o campo é local
  // enquanto se digita e volta a seguir a ata quando o snapshot traz OUTRO
  // valor. Sem a comparação, o eco da própria escrita devolveria o cursor para
  // o fim do campo no meio da digitação de outra pessoa.
  const [eco, setEco] = useState(valor);
  if (valor !== eco) {
    setEco(valor);
    setTexto(valor);
  }
  return (
    <input
      className={styles.celula}
      value={texto}
      placeholder={placeholder}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto !== valor) onGravar(texto.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label={ariaLabel}
    />
  );
}

function TabelaDeTarefas({
  tarefas,
  nomeDe,
  pessoas,
  onGravar,
}: {
  tarefas: TarefaDeAta[];
  nomeDe: (email: string) => string;
  /** Montada uma vez na página — ver `pessoasDaAta`. */
  pessoas: SelectOption[];
  onGravar: (muda: (i: ItemDeAta) => ItemDeAta) => void;
}) {
  /** A tarefa cuja remoção está esperando o segundo clique. */
  const [confirmando, setConfirmando] = useState("");

  const mudar = (id: string, patch: Partial<TarefaDeAta>) =>
    onGravar((i) => ({
      ...i,
      tarefas: i.tarefas.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  return (
    <div className={styles.tarefas}>
      <div className={styles.tarefasRot}>Tarefas derivadas</div>
      {tarefas.length > 0 && (
        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Tarefa</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Status</th>
                <th>Observação</th>
                <th aria-label="Remover" />
              </tr>
            </thead>
            <tbody>
              {tarefas.map((t) => (
                <tr key={t.id}>
                  <td>
                    <CelulaTexto
                      valor={t.texto}
                      placeholder="O que fazer"
                      ariaLabel="Tarefa"
                      onGravar={(v) => mudar(t.id, { texto: v })}
                    />
                  </td>
                  <td>
                    {/* `<Combobox>` e não `<Select>`: a lista de gente cresce
                        sem teto, e quem preenche a ata durante a reunião sabe o
                        nome de cor — digitar três letras é mais rápido do que
                        procurar com o olho numa lista rolante. Mesmo motivo que
                        já tinha trocado os dois campos de Solicitante. */}
                    <Combobox
                      value={t.responsavel}
                      options={pessoas}
                      onChange={(v) => mudar(t.id, { responsavel: v })}
                      placeholder="Sem responsável"
                      ariaLabel={`Responsável por ${t.texto || "a tarefa"}`}
                      vazioTexto="Ninguém com esse nome neste setor."
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className={styles.celula}
                      value={t.prazo}
                      onChange={(e) => mudar(t.id, { prazo: e.target.value })}
                      aria-label="Prazo"
                    />
                  </td>
                  <td>
                    <Select
                      value={t.status}
                      options={STATUS_TAREFA.map((s) => ({
                        value: s,
                        label: STATUS_TAREFA_LABEL[s],
                        // Os mesmos tokens do selo da demanda, e não hex: os
                        // três estados de tarefa são leitura do mesmo eixo que
                        // "Concluída / Em andamento / Pendente decisão" logo
                        // acima, e trocar de tema não pode desalinhar os dois.
                        color: COR_TAREFA[s],
                      }))}
                      onChange={(v) => mudar(t.id, { status: v as StatusTarefa })}
                      ariaLabel="Status da tarefa"
                    />
                  </td>
                  <td>
                    <CelulaTexto
                      valor={t.observacao}
                      placeholder="—"
                      ariaLabel="Observação"
                      onGravar={(v) => mudar(t.id, { observacao: v })}
                    />
                  </td>
                  <td>
                    {/* CONFIRMA NA PRÓPRIA LINHA, e não num modal.

                        Um clique apagava a tarefa para o setor inteiro — com
                        responsável, prazo e observação — sem pergunta e sem
                        desfazer, num alvo de 26px colado no campo de prazo,
                        numa tabela de linhas de 30px preenchida com o
                        cronômetro correndo. Errar a linha vizinha era um
                        movimento de mouse de distância.

                        Modal seria caro demais para o gesto: a ata inteira
                        exige um, mas ela é uma por reunião e a tarefa é uma por
                        minuto. A confirmação inline custa um segundo clique no
                        lugar onde os olhos já estão. */}
                    {confirmando === t.id ? (
                      <span className={styles.confirmaLinha}>
                        <button
                          className={styles.confirmaSim}
                          onClick={() => {
                            setConfirmando("");
                            onGravar((i) => ({
                              ...i,
                              tarefas: i.tarefas.filter((x) => x.id !== t.id),
                            }));
                          }}
                        >
                          Remover
                        </button>
                        <button
                          className={styles.confirmaNao}
                          onClick={() => setConfirmando("")}
                          aria-label="Manter a tarefa"
                          autoFocus
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </span>
                    ) : (
                      <button
                        className={styles.remover}
                        onClick={() => setConfirmando(t.id)}
                        title={`Remover a tarefa "${t.texto || "sem texto"}"`}
                        aria-label="Remover tarefa"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Sem texto de "nenhuma tarefa": o botão já diz que não há e o que fazer
          a respeito, e um estado vazio de três linhas dentro de cada uma das
          quinze demandas da pauta seria mais tela do que conteúdo. */}
      <button
        className={styles.addTarefa}
        onClick={() =>
          onGravar((i) => ({ ...i, tarefas: [...i.tarefas, tarefaNova(i.tarefas)] }))
        }
      >
        <Icon name="plus" size={14} /> Adicionar tarefa
      </button>
      {tarefas.some((t) => t.responsavel) && (
        <span className={styles.tarefasResumo}>
          {[...new Set(tarefas.map((t) => t.responsavel).filter(Boolean))]
            .map(nomeDe)
            .join(", ")}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A demanda que nasce na ata — e a dimensão que ela é obrigada a ter
// ---------------------------------------------------------------------------

/**
 * O par dimensão + subdimensão, no formulário.
 *
 * Um componente para os três lugares que perguntam a mesma coisa (assunto novo,
 * promoção a demanda, reclassificação). Escrito três vezes, o dia em que a
 * árvore ganhar um terceiro nível seria o dia em que dois dos três formulários
 * continuariam com dois.
 *
 * A SUBDIMENSÃO É ZERADA QUANDO A DIMENSÃO TROCA, e isso não é zelo: os ids de
 * subdimensão são locais à dimensão ("s1" existe em todas), então manter a
 * escolha antiga produziria um par que aponta para outra caixa — sem erro
 * nenhum na tela, e com a demanda indo parar no lugar errado da árvore.
 */
function SeletorDeDimensao({
  dimensoes,
  valor,
  onChange,
}: {
  dimensoes: Dimensao[];
  valor: Classificacao;
  onChange: (c: Classificacao) => void;
}) {
  const dim = dimensoes.find((d) => d.id === valor.dimensaoId);
  const subs = dim?.subs ?? [];

  if (dimensoes.length === 0) {
    return (
      <p className={styles.avisoModal}>
        Este setor ainda não tem dimensão cadastrada, e toda demanda desta aba
        precisa de uma. Abra a aba <b>Dimensões</b> e cadastre a árvore do setor
        primeiro.
      </p>
    );
  }

  return (
    <>
      <label className={styles.rotulo}>
        Dimensão <span className={styles.obrigatorio}>obrigatória</span>
      </label>
      <Combobox
        value={valor.dimensaoId}
        options={dimensoes.map(
          (d): SelectOption => ({
            value: d.id,
            label: d.nome,
            color: corDaDimensao(d.ordem),
          }),
        )}
        onChange={(v) => onChange({ dimensaoId: v, subdimensaoId: "" })}
        placeholder="Escolha a dimensão…"
        ariaLabel="Dimensão"
        vazioTexto="Nenhuma dimensão com esse nome."
      />
      {/* A subdimensão só aparece quando há onde escolher. Um campo vazio e
          desabilitado ali embaixo parece defeito; a ausência dele não. */}
      {subs.length > 0 && (
        <>
          <label className={styles.rotulo}>Subdimensão (opcional)</label>
          <Combobox
            value={valor.subdimensaoId}
            options={[
              { value: "", label: "Direto na dimensão" },
              ...subs.map((s): SelectOption => ({ value: s.id, label: s.nome })),
            ]}
            onChange={(v) => onChange({ ...valor, subdimensaoId: v })}
            placeholder="Direto na dimensão"
            ariaLabel="Subdimensão"
            vazioTexto="Nenhuma subdimensão com esse nome."
          />
        </>
      )}
    </>
  );
}

/**
 * O assunto da pauta — a linha que ainda NÃO é demanda. Acrescenta e corrige.
 *
 * Ela nasce sem card de propósito, e é a fronteira de demandas em ação: a
 * reunião discute muita coisa que ainda não é trabalho de ninguém, e forçar um
 * card para poder registrar a conversa inverteria a ordem — o card nasceria da
 * necessidade de ter onde escrever, e não de alguém decidir que aquilo é
 * trabalho. Quando a decisão vier, o botão "Criar demanda" está no bloco.
 *
 * UM COMPONENTE PARA OS DOIS MOMENTOS, com `inicial` decidindo qual é — mesmo
 * partido de `ModalDeAta`, que já serve para abrir a próxima reunião e para
 * editar o cabeçalho desta. São os mesmos três campos e a MESMA régua
 * (`conferirAssuntoNovo` e `editarAssunto` chamam as duas mesmas conferências);
 * um segundo formulário seria o lugar onde a obrigatoriedade da dimensão
 * deixaria de valer no dia em que ela mudasse — e ninguém veria, porque os dois
 * desenham igual.
 */
function ModalDeAssunto({
  setor,
  dimensoes,
  inicial,
  onFechar,
  onSalvar,
}: {
  setor: string;
  dimensoes: Dimensao[];
  /** O ponto de partida do formulário. Ausente = assunto NOVO. */
  inicial?: {
    assunto: string;
    contexto: string;
    dimensaoId: string;
    subdimensaoId: string;
  };
  onFechar: () => void;
  onSalvar: (dados: {
    assunto: string;
    contexto: string;
    dimensaoId: string;
    subdimensaoId: string;
  }) => Promise<void>;
}) {
  const editando = !!inicial;
  const [assunto, setAssunto] = useState(inicial?.assunto ?? "");
  const [contexto, setContexto] = useState(inicial?.contexto ?? "");
  const [classe, setClasse] = useState<Classificacao>({
    dimensaoId: inicial?.dimensaoId ?? "",
    subdimensaoId: inicial?.subdimensaoId ?? "",
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !salvando}
      ariaLabel={
        editando ? "Editar o assunto da pauta" : "Acrescentar assunto à pauta"
      }
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={520}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name={editando ? "edit" : "plus"} size={12} />{" "}
          {editando ? "Editar assunto" : "Assunto da pauta"}
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      <p className={styles.avisoModal}>
        {editando ? (
          <>
            Isto muda só como a reunião <b>chamou</b> o assunto. A decisão, o
            objetivo e as tarefas desta linha ficam como estão — e a dimensão
            nova vale a partir de agora, inclusive no dia em que a linha virar
            demanda no quadro.
          </>
        ) : (
          <>
            Assunto é o que a reunião discutiu e que <b>ainda não é demanda</b>.
            Ele entra na pauta com decisão, objetivo e tarefas — e vira demanda
            no quadro quando alguém decidir que é trabalho.
          </>
        )}
      </p>

      <label className={styles.rotulo}>Assunto</label>
      <input
        className={styles.input}
        value={assunto}
        onChange={(e) => setAssunto(e.target.value)}
        placeholder="Padrão de recebimento e tipificação"
        maxLength={LIMITE_ASSUNTO_CHARS}
        autoFocus
      />

      <label className={styles.rotulo}>Contexto (opcional)</label>
      <input
        className={styles.input}
        value={contexto}
        onChange={(e) => setContexto(e.target.value)}
        placeholder="O que se falou em volta do assunto"
      />

      <SeletorDeDimensao dimensoes={dimensoes} valor={classe} onChange={setClasse} />

      {erro && <p className={styles.erroModal}>{erro}</p>}
      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          disabled={salvando || !assunto.trim() || !classe.dimensaoId}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onSalvar({ assunto, contexto, ...classe });
            } catch (e) {
              setErro(
                e instanceof Error
                  ? e.message
                  : editando
                    ? "Não foi possível salvar o assunto."
                    : "Não foi possível acrescentar o assunto.",
              );
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Salvando…" : editando ? "Salvar" : "Acrescentar"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * "Criar demanda" — o assunto vira card no quadro do setor.
 *
 * O FORMULÁRIO É CURTO DE PROPÓSITO. O modal do Kanban tem tags, checklist,
 * links, comentários, solicitante, setor solicitante e data de início; aqui
 * ficam só os campos que a reunião responde em voz alta na hora — o quê, de
 * quem, para quando, e onde mora. O resto se preenche depois, no quadro, que é
 * onde a demanda é acompanhada. Um formulário completo aqui pararia a reunião.
 *
 * A COLUNA NÃO É PERGUNTADA: a demanda entra na primeira etapa do quadro, que é
 * a de entrada. Perguntar seria oferecer a alguém, no meio da reunião, a chance
 * de abrir uma demanda já em "Concluído".
 */
function ModalDeDemanda({
  setor,
  linha,
  dimensoes,
  pessoas,
  colunaDeEntrada,
  onFechar,
  onCriar,
}: {
  setor: string;
  linha: ItemDaPauta;
  dimensoes: Dimensao[];
  pessoas: SelectOption[];
  colunaDeEntrada: string;
  onFechar: () => void;
  onCriar: (dados: {
    titulo: string;
    descricao: string;
    dimensaoId: string;
    subdimensaoId: string;
    responsavel: string;
    tipo: DemandType;
    prioridade: Priority;
    prazo: string;
  }) => Promise<void>;
}) {
  // Título e descrição já vêm do que a reunião escreveu. Reaproveitar é o ponto
  // inteiro deste botão: quem chegou aqui já digitou isso uma vez.
  const [titulo, setTitulo] = useState(linha.titulo);
  const [descricao, setDescricao] = useState(linha.descricao);
  const [classe, setClasse] = useState<Classificacao>(
    classificacaoDaLinha(linha),
  );
  const [responsavel, setResponsavel] = useState("");
  const [tipo, setTipo] = useState<DemandType>("implementacao");
  const [prioridade, setPrioridade] = useState<Priority>("media");
  const [prazo, setPrazo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O prazo em fim de semana é AVISO, e não recusa: o modal do Kanban cobra
  // porque lá a demanda é planejada; aqui ela é anotada com a reunião correndo,
  // e travar o botão por causa de um sábado faria alguém desistir de registrar.
  const prazoNoFimDeSemana = !!prazo && ehFimDeSemanaISO(prazo);

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !salvando}
      ariaLabel="Criar demanda a partir do assunto"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={560}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="kanban" size={12} /> Nova demanda
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      <p className={styles.avisoModal}>
        A demanda entra no quadro em <b>{colunaDeEntrada || "—"}</b> e passa a
        aparecer nesta pauta com o estado dela, ao vivo. A decisão e as tarefas
        que você já registrou continuam na ata.
      </p>

      <label className={styles.rotulo}>Título da demanda</label>
      <input
        className={styles.input}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="O que precisa ser feito"
        maxLength={LIMITE_ASSUNTO_CHARS}
        autoFocus
      />

      <label className={styles.rotulo}>Descrição</label>
      <textarea
        className={styles.inputArea}
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
        placeholder="O contexto que quem for executar precisa saber"
        rows={3}
      />

      <SeletorDeDimensao dimensoes={dimensoes} valor={classe} onChange={setClasse} />

      <label className={styles.rotulo}>Responsável</label>
      <Combobox
        value={responsavel}
        options={pessoas}
        onChange={setResponsavel}
        placeholder="Sem responsável"
        ariaLabel="Responsável pela demanda"
        vazioTexto="Ninguém com esse nome neste setor."
      />

      <div className={styles.linhaCampos}>
        <div>
          <label className={styles.rotulo}>Tipo</label>
          <Select
            value={tipo}
            options={DEMAND_TYPES.map((t) => ({
              value: t,
              label: DEMAND_TYPE_LABEL[t],
              color: DEMAND_TYPE_COLOR[t],
            }))}
            onChange={(v) => setTipo(v as DemandType)}
            ariaLabel="Tipo da demanda"
          />
        </div>
        <div>
          <label className={styles.rotulo}>Prioridade</label>
          <Select
            value={prioridade}
            options={KNOWN_PRIORITIES.map((p) => ({
              value: p,
              label: PRIORITY_LABEL[p],
            }))}
            onChange={(v) => setPrioridade(v as Priority)}
            ariaLabel="Prioridade"
          />
        </div>
        <div>
          <label className={styles.rotulo}>Prazo</label>
          <input
            type="date"
            className={styles.input}
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
            aria-label="Prazo de entrega"
          />
        </div>
      </div>
      {prazoNoFimDeSemana && (
        <p className={styles.avisoCampo}>
          {fmtDayMonth(prazo)} cai no fim de semana. Dá para gravar assim, mas
          quase ninguém entrega no sábado.
        </p>
      )}

      {erro && <p className={styles.erroModal}>{erro}</p>}
      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          disabled={salvando || !titulo.trim() || !classe.dimensaoId}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onCriar({
                titulo,
                descricao,
                responsavel,
                tipo,
                prioridade,
                prazo,
                ...classe,
              });
            } catch (e) {
              setErro(
                e instanceof Error
                  ? e.message
                  : "Não foi possível criar a demanda.",
              );
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Criando…" : "Criar demanda"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Trocar a dimensão de uma linha da pauta.
 *
 * O MESMO BOTÃO, DUAS ESCRITAS DIFERENTES — e a tela diz qual, porque as
 * consequências não são iguais. No assunto, a classificação fica na ata. Na
 * demanda ela vai para o CARD, aparece na árvore de Dimensões e deixa linha no
 * histórico da demanda. Quem clica precisa saber que está mexendo no quadro.
 */
function ModalDeClassificar({
  setor,
  linha,
  dimensoes,
  onFechar,
  onSalvar,
}: {
  setor: string;
  linha: ItemDaPauta;
  dimensoes: Dimensao[];
  onFechar: () => void;
  onSalvar: (c: Classificacao) => Promise<void>;
}) {
  const [classe, setClasse] = useState<Classificacao>(
    classificacaoDaLinha(linha),
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !salvando}
      ariaLabel="Classificar a linha da pauta"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={480}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="dimensoes" size={12} /> Dimensão
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      <h2 className={styles.mtitulo}>{linha.titulo}</h2>
      <p className={styles.avisoModal}>
        {linha.card
          ? "Esta linha é uma demanda do quadro: a dimensão é gravada no card, aparece na árvore de Dimensões e deixa registro no histórico da demanda."
          : "Esta linha ainda é um assunto: a dimensão fica na ata, e passa para o card no dia em que ela virar demanda."}
      </p>

      <SeletorDeDimensao dimensoes={dimensoes} valor={classe} onChange={setClasse} />

      {erro && <p className={styles.erroModal}>{erro}</p>}
      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          disabled={salvando || !classe.dimensaoId}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onSalvar(classe);
            } catch (e) {
              setErro(
                e instanceof Error
                  ? e.message
                  : "Não foi possível gravar a dimensão.",
              );
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * "Levar para outra reunião" — o bastão passado para uma pauta que já existe.
 *
 * IRMÃO DE `ModalDeMover`, e a semelhança é o risco: os dois escolhem uma ata do
 * setor numa lista igual. O que os separa está escrito na frase de aviso, e ela
 * é a parte mais importante desta tela — "a linha CONTINUA nesta ata" é o
 * oposto do que "Mover" faz, e quem confundir os dois perde a decisão de hoje
 * numa reunião que ainda não aconteceu.
 *
 * A LISTA SÓ TEM REUNIÃO FUTURA, e vem da mais próxima para a mais distante.
 * `levarAssunto` recusa destino anterior, mas oferecer o que vai ser recusado é
 * desenhar um caminho para o erro — e a recusa aqui chegaria depois do clique,
 * quando a pessoa já decidiu.
 *
 * `<Combobox>` e não `<Select>`, pelo mesmo motivo de "Mover": a lista de
 * reuniões de um setor só cresce.
 */
function ModalDeLevar({
  setor,
  linha,
  destinos,
  onFechar,
  onLevar,
}: {
  setor: string;
  linha: ItemDaPauta;
  /** Só as reuniões FUTURAS do setor — ver `proximas` na página. */
  destinos: Ata[];
  onFechar: () => void;
  onLevar: (destinoId: string) => Promise<void>;
}) {
  // A mais próxima já vem escolhida: ela é a resposta em quase todo caso, e
  // `destinos` chega ordenada por data crescente justamente para isso. Trocar é
  // um clique; escolher do zero, dois.
  const [destino, setDestino] = useState(destinos[0]?.id ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Só as ABERTAS vão junto, e dizer o número é o que faz a frase valer: quem
  // tem seis tarefas na linha precisa saber que duas ficam para trás.
  const abertas = linha.item.tarefas.filter((t) => t.status !== "concluida").length;
  const feitas = linha.item.tarefas.length - abertas;

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !salvando}
      ariaLabel="Levar o assunto para outra reunião"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={480}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="calendar" size={12} /> Levar assunto
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      <h2 className={styles.mtitulo}>{linha.titulo}</h2>
      <p className={styles.avisoModal}>
        {/* A PRIMEIRA FRASE É A QUE SEPARA ESTE MODAL DO "MOVER". Ela vem antes
            de tudo de propósito: é o mal-entendido que custa caro. */}
        <strong>A linha continua nesta ata</strong>, com a decisão de hoje. Uma
        cópia entra na pauta da reunião escolhida com o objetivo
        {abertas === 0
          ? ""
          : abertas === 1
            ? " e a tarefa que continua aberta"
            : ` e as ${abertas} tarefas que continuam abertas`}
        , e sem a decisão — ela é desta reunião.
        {feitas > 0 &&
          ` ${feitas === 1 ? "A tarefa já concluída fica" : `As ${feitas} tarefas já concluídas ficam`} para trás.`}
      </p>

      <label className={styles.rotulo}>Para qual reunião</label>
      <Combobox
        value={destino}
        options={destinos.map(opcaoDeAta)}
        onChange={setDestino}
        placeholder="Escolha a reunião…"
        ariaLabel="Reunião de destino"
        vazioTexto="Nenhuma reunião futura deste setor com esse nome."
      />

      {erro && <p className={styles.erroModal}>{erro}</p>}
      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          disabled={salvando || !destino}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onLevar(destino);
            } catch (e) {
              // O ERRO SOBE PARA CÁ e não para a tarja do topo: o modal continua
              // aberto, e as quatro recusas de `levarAssunto` são todas
              // acionáveis aqui — trocar o destino resolve três delas.
              setErro(
                e instanceof Error ? e.message : "Não foi possível levar o assunto.",
              );
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Levando…" : "Levar para a reunião"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * "Mover" — o assunto lançado na reunião errada muda de ata.
 *
 * O ERRO QUE ELE DESFAZ é barato de cometer: a pauta que se abre é sempre a
 * reunião mais recente, e o assunto que se quer registrar é muitas vezes o da
 * semana passada. Antes disto, desfazer custava redigitar a decisão, o objetivo
 * e a tabela de tarefas inteira na ata certa — ou excluir a ata, que é de
 * gestor e apaga a reunião de todo mundo.
 *
 * A LISTA DIZ O DIA, e não só o título. "Reunião Semanal de Operações" é o nome
 * de todas elas; sem a data ao lado, escolher o destino seria sorteio — e o
 * sorteio erra exatamente do mesmo jeito que o erro que se veio consertar.
 *
 * `<Combobox>` e não `<Select>`: a lista de reuniões de um setor só cresce, e
 * uma ata de seis meses atrás está a muitas rolagens de distância.
 */
function ModalDeMover({
  setor,
  linha,
  destinos,
  onFechar,
  onMover,
}: {
  setor: string;
  linha: ItemDaPauta;
  /** As outras atas do setor — a de origem já saiu da lista. */
  destinos: Ata[];
  onFechar: () => void;
  onMover: (destinoId: string) => Promise<void>;
}) {
  const [destino, setDestino] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Dizer o número é o que faz a frase valer alguma coisa: "e as 6 tarefas"
  // responde a pergunta que a pessoa tem antes de clicar, e "e as tarefas" não.
  const quantas = linha.item.tarefas.length;
  const eAsTarefas =
    quantas === 0 ? "" : quantas === 1 ? " e a tarefa" : ` e as ${quantas} tarefas`;

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !salvando}
      ariaLabel="Mover o assunto para outra reunião"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={480}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="ata" size={12} /> Mover assunto
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      <h2 className={styles.mtitulo}>{linha.titulo}</h2>
      <p className={styles.avisoModal}>
        A linha inteira muda de reunião: o contexto, a dimensão, a decisão, o
        objetivo{eAsTarefas}. Ela sai desta pauta e aparece na da reunião
        escolhida.
      </p>

      <label className={styles.rotulo}>Para qual reunião</label>
      <Combobox
        value={destino}
        options={destinos.map(opcaoDeAta)}
        onChange={setDestino}
        placeholder="Escolha a reunião…"
        ariaLabel="Reunião de destino"
        vazioTexto="Nenhuma reunião deste setor com esse nome."
      />

      {erro && <p className={styles.erroModal}>{erro}</p>}
      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          disabled={salvando || !destino}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onMover(destino);
            } catch (e) {
              setErro(
                e instanceof Error
                  ? e.message
                  : "Não foi possível mover o assunto.",
              );
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Movendo…" : "Mover"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// O formulário de ata — serve para criar e para abrir a próxima

// ---------------------------------------------------------------------------

/** O nome de cada campo mesclável na tela — em prosa, não no nome do campo. */
const CAMPO_LABEL: Record<CampoMesclavel, string> = {
  decisao: "decisão",
  objetivo: "objetivo",
  contexto: "contexto",
};

/**
 * "Puxar do áudio" — o documento da reunião entrando numa ata que JÁ tem pauta.
 *
 * POR QUE ELE EXISTE, e por que não bastava "Gerar da reunião". A ata de uma
 * reunião semanal nasce ANTES de o áudio ficar pronto: a equipe lança os
 * assuntos que quer discutir, e "Levar para próxima reunião" já deixou lá o que
 * ficou pendurado. Depois o áudio processa. "Gerar da reunião" só sabe CRIAR, e
 * criar naquele momento produz uma segunda ata da mesma reunião no mesmo setor —
 * mesma data, mesmo título na lista, uma com o que as pessoas lançaram e outra
 * com o que o áudio trouxe. Foi o estado da ata de 02/09/2026 das Cantinas.
 *
 * A CONFERÊNCIA NÃO É ENFEITE, é o que torna a mesclagem aceitável num registro.
 * O casamento entre bloco do documento e linha da pauta é por texto exato, e
 * texto exato acerta ou não acerta — mas quem responde pela ata é quem conduziu
 * a reunião, e ela vê o que vai entrar, em que linha, e por quê. Aplicar direto
 * pediria confiança cega numa comparação de strings.
 *
 * TRÊS GRUPOS, e o terceiro é o que mais importa:
 *
 *   1. ASSUNTOS NOVOS — blocos que não casaram nada. Marcados por padrão.
 *   2. ASSUNTOS QUE CASARAM — com a linha que casaram e o que seria preenchido.
 *      Marcados por padrão.
 *   3. DIVERGÊNCIAS — o áudio trouxe texto para um campo que já tem texto
 *      humano, e diferente. SEM checkbox: não há o que aplicar, o texto humano
 *      fica. Está aqui porque as duas alternativas silenciosas são piores —
 *      sobrescrever apaga o que alguém digitou na reunião, e omitir esconde o
 *      que a gravação registrou. Quem conduz decide se corrige à mão.
 *
 * O PLANO VEM DO SERVIDOR E VOLTA COMO ÍNDICES. O que este modal manda de volta
 * é só a lista de blocos aprovados; a rota recomputa o plano do mesmo documento
 * antes de aplicar. O porquê está no cabeçalho de `api/ata/gerar`: ela roda com
 * o Admin SDK, que ignora `firestore.rules`.
 */
function ModalDePuxar({
  ata,
  reunioes,
  fonte,
  onFechar,
  onMesclado,
}: {
  ata: Ata;
  reunioes: Meeting[];
  /** A fonte inteira, e não só o `carregando` — mesmo motivo de `ModalDeGerar`. */
  fonte: {
    data: Meeting[] | undefined;
    erro: Error | null;
    tentarDeNovo: () => void;
  };
  onFechar: () => void;
  onMesclado: (entraram: number) => void;
}) {
  const [reuniaoSel, setReuniaoSel] = useState("");
  const [plano, setPlano] = useState<ParDeMesclagem[] | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [lendo, setLendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const elegiveis = useMemo(
    () =>
      reunioes.filter(
        (r) =>
          r.status === "processado" &&
          (r.driveOutputs ?? []).some((o) => o.kind === "resumo"),
      ),
    [reunioes],
  );
  const estadoDaFonte = juntarFontes([fonte]);

  async function pedir(corpo: Record<string, unknown>) {
    const user = auth.currentUser;
    if (!user) throw new Error("Sessão expirada. Entre novamente.");
    const r = await fetch("/api/ata/gerar", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ataId: ata.id, ...corpo }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || "Não foi possível ler o documento.");
    return body as { plano?: ParDeMesclagem[]; entraram?: number };
  }

  async function conferir(meetingId: string) {
    setReuniaoSel(meetingId);
    setPlano(null);
    setErro(null);
    if (!meetingId) return;
    setLendo(true);
    try {
      const body = await pedir({ meetingId, preview: true });
      const p = body.plano ?? [];
      setPlano(p);
      // TUDO MARCADO POR PADRÃO, e é a escolha certa aqui: o caminho comum é
      // querer o documento inteiro na ata, e desmarcar o que não se quer é mais
      // raro do que marcar o que se quer. Nada disso aplica sozinho — o clique
      // final continua sendo o que grava.
      setMarcados(new Set(p.filter(mesclagemFazAlgo).map((x) => x.bloco)));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler o documento.");
    } finally {
      setLendo(false);
    }
  }

  async function aplicar() {
    setAplicando(true);
    setErro(null);
    try {
      const body = await pedir({ meetingId: reuniaoSel, aprovados: [...marcados] });
      onMesclado(body.entraram ?? 0);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível puxar do áudio.");
      setAplicando(false);
    }
  }

  const alternar = (bloco: number) =>
    setMarcados((cur) => {
      const n = new Set(cur);
      if (n.has(bloco)) n.delete(bloco);
      else n.add(bloco);
      return n;
    });

  const acoes = plano?.filter(mesclagemFazAlgo) ?? [];
  const novos = acoes.filter((p) => p.itemId === null);
  const casaram = acoes.filter((p) => p.itemId !== null);
  const divergentes = plano?.filter((p) => p.divergencias.length > 0) ?? [];
  /** O nome da linha da pauta que o par vai tocar — o assunto, ou a demanda. */
  const linhaDe = (p: ParDeMesclagem) => {
    const item = ata.itens.find((i) => i.id === p.itemId);
    return item?.assunto || (p.cardId ? "a demanda do quadro" : "linha sem nome");
  };

  /** O que o par faria, em prosa, para caber numa linha da lista. */
  const oQueFaz = (p: ParDeMesclagem) => {
    const partes: string[] = [];
    if (p.preenche.length) {
      partes.push(`preenche ${p.preenche.map((c) => CAMPO_LABEL[c]).join(", ")}`);
    }
    if (p.tarefas.length) {
      partes.push(p.tarefas.length === 1 ? "1 tarefa nova" : `${p.tarefas.length} tarefas novas`);
    }
    if (p.vinculaCard) partes.push("liga à demanda do quadro");
    if (p.classifica) partes.push("classifica na dimensão");
    return partes.join(" · ");
  };

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !aplicando}
      ariaLabel="Puxar os assuntos do áudio"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={640}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="mic" size={12} /> Puxar os assuntos do áudio
        </span>
        <span className={styles.mchip}>{rotuloDaAta(ata)}</span>
      </div>

      {/* O ERRO GANHA DE CARREGANDO E DE VAZIO, nesta ordem — é o que o cabeçalho
          de `juntarFontes` explica, e o mesmo cuidado de `ModalDeGerar`: sem
          isso, uma falha na assinatura de reuniões cai no estado vazio e afirma
          que não há reunião processada, mandando a pessoa gravar de novo um
          áudio que já existe. */}
      {estadoDaFonte.erro ? (
        <ErrorState error={estadoDaFonte.erro} onRetry={fonte.tentarDeNovo} />
      ) : estadoDaFonte.carregando ? (
        <SkeletonRow rows={3} texto="Procurando reuniões processadas…" />
      ) : elegiveis.length === 0 ? (
        <EmptyState
          icon="reunioes"
          title="Nenhuma reunião processada"
          description="Os assuntos saem dos pontos importantes que o processamento gera. Envie o áudio em Reuniões e volte quando ele estiver processado."
        />
      ) : (
        <>
          <label className={styles.rotulo}>Reunião gravada</label>
          <Select
            value={reuniaoSel}
            options={[
              { value: "", label: "Escolha a reunião…" },
              ...elegiveis.map(
                (r): SelectOption => ({
                  value: r.id,
                  label: `${r.title} · ${r.date ? fmtDayMonth(r.date) : "sem data"} · ${r.sector}`,
                }),
              ),
            ]}
            onChange={conferir}
            ariaLabel="Reunião gravada"
          />

          {/* Ler o Doc no Drive passa de 400 ms com folga (AGENTS.md §3). */}
          {lendo && <SkeletonRow rows={4} texto="Lendo os pontos importantes…" />}

          {plano && !acoes.length && !divergentes.length && (
            /* "Ainda não respondeu" e "respondeu e está vazio" são telas
               diferentes, e este é o segundo caso — e ele é uma boa notícia, não
               um erro: quem clica duas vezes por não ter certeza se o primeiro
               clique funcionou precisa ler isto, e não um modal em branco. */
            <EmptyState
              icon="check"
              title="Este áudio já está todo nesta ata"
              description="Nenhum assunto novo e nada a preencher: o documento desta reunião já foi puxado para cá."
            />
          )}

          {!!novos.length && (
            <section className={styles.grupoMescla}>
              <h4>
                Assuntos novos <span>{novos.length}</span>
              </h4>
              <p className={styles.grupoDica}>
                O áudio falou deles e a pauta não os tem. Entram como linhas novas.
              </p>
              {novos.map((p) => (
                <LinhaDeMescla
                  key={p.bloco}
                  marcado={marcados.has(p.bloco)}
                  onAlternar={() => alternar(p.bloco)}
                  titulo={p.assunto}
                  detalhe={oQueFaz(p) || "só o assunto"}
                />
              ))}
            </section>
          )}

          {!!casaram.length && (
            <section className={styles.grupoMescla}>
              <h4>
                Assuntos que a pauta já tem <span>{casaram.length}</span>
              </h4>
              <p className={styles.grupoDica}>
                Só o que está em branco é preenchido. O que alguém escreveu fica
                como está.
              </p>
              {casaram.map((p) => (
                <LinhaDeMescla
                  key={p.bloco}
                  marcado={marcados.has(p.bloco)}
                  onAlternar={() => alternar(p.bloco)}
                  titulo={p.assunto}
                  detalhe={oQueFaz(p)}
                  /* POR QUE casou, e não só que casou: "pela demanda do quadro"
                     é um casamento mais forte que "pelo nome do assunto", e quem
                     confere precisa saber em qual dos dois está confiando. */
                  casou={
                    p.casouPor === "card"
                      ? "pela demanda do quadro"
                      : `pelo nome — ${linhaDe(p)}`
                  }
                />
              ))}
            </section>
          )}

          {!!divergentes.length && (
            <section className={styles.grupoMescla}>
              <h4>
                O áudio diz outra coisa <span>{divergentes.length}</span>
              </h4>
              <p className={styles.grupoDica}>
                Nada disto é aplicado: o texto da ata fica. Está aqui para você
                comparar e corrigir à mão se quiser.
              </p>
              {divergentes.map((p) =>
                p.divergencias.map((d) => (
                  <div key={`${p.bloco}-${d.campo}`} className={styles.divergencia}>
                    <div className={styles.divergTitulo}>
                      {p.assunto} · {CAMPO_LABEL[d.campo]}
                    </div>
                    <div className={styles.divergPar}>
                      <div>
                        <span>na ata</span>
                        <p>{d.naAta}</p>
                      </div>
                      <div>
                        <span>no áudio</span>
                        <p>{d.doAudio}</p>
                      </div>
                    </div>
                  </div>
                )),
              )}
            </section>
          )}

          {erro && <p className={styles.erroModal}>{erro}</p>}
        </>
      )}

      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={aplicando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          onClick={aplicar}
          disabled={aplicando || lendo || !marcados.size}
        >
          {aplicando
            ? "Puxando…"
            : marcados.size
              ? `Puxar ${marcados.size} para a ata`
              : "Puxar para a ata"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Uma linha da conferência: o que entra, e onde.
 *
 * `<label>` em volta do checkbox, e não um `onClick` na `<div>`: a área de
 * clique passa a ser a linha inteira sem inventar um alvo que leitor de tela
 * nenhum entende, e o estado marcado/desmarcado é lido de graça.
 */
function LinhaDeMescla({
  marcado,
  onAlternar,
  titulo,
  detalhe,
  casou,
}: {
  marcado: boolean;
  onAlternar: () => void;
  titulo: string;
  detalhe: string;
  casou?: string;
}) {
  return (
    <label className={styles.linhaMescla}>
      <input type="checkbox" checked={marcado} onChange={onAlternar} />
      <span className={styles.linhaMesclaTx}>
        <strong>{titulo}</strong>
        {casou && <em>{casou}</em>}
        {detalhe && <span>{detalhe}</span>}
      </span>
    </label>
  );
}
// ---------------------------------------------------------------------------

/**
 * "Gerar da reunião" — o único caminho para uma ata nascer.
 *
 * SUBSTITUIU O FORMULÁRIO EM BRANCO, e a troca é a razão de ser deste PR. O que
 * havia antes pedia à pessoa que redigitasse título, data, horário, local,
 * facilitador e participantes de uma reunião que o sistema já tinha processado
 * inteira — e a pauta nascia vazia, sem nenhuma das decisões que a reunião
 * tomou. Aqui ela escolhe a reunião, e o servidor monta a ata.
 *
 * SÓ APARECE REUNIÃO QUE TEM DO QUE SAIR: processada e com o documento "Pontos
 * importantes". Uma reunião ainda na esteira ofereceria um botão que só sabe
 * devolver erro, e um botão que falha por desenho é pior do que um botão
 * ausente — ele ensina a duvidar dos outros.
 */
function ModalDeGerar({
  setor,
  setores,
  reunioes,
  fonte,
  onFechar,
  onGerado,
}: {
  setor: string;
  setores: string[];
  reunioes: Meeting[];
  /**
   * A FONTE INTEIRA, e não só o `carregando`.
   *
   * Recebendo só o `carregando`, o erro virava vazio: `juntarFontes` responde
   * `carregando: false` quando há erro e `data` fica `undefined`, então uma
   * falha em `subscribeMeetings` — regra negando um dos setores, rede caída —
   * produzia o estado vazio afirmando "Nenhuma reunião processada". A pessoa era
   * mandada gravar de novo um áudio que já existe.
   */
  fonte: {
    data: Meeting[] | undefined;
    erro: Error | null;
    tentarDeNovo: () => void;
  };
  onFechar: () => void;
  onGerado: (id: string, setorDestino: string, jaExistia: boolean) => void;
}) {
  const [reuniaoSel, setReuniaoSel] = useState("");
  const [destino, setDestino] = useState(setor);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const elegiveis = useMemo(
    () =>
      reunioes.filter(
        (r) =>
          r.status === "processado" &&
          (r.driveOutputs ?? []).some((o) => o.kind === "resumo"),
      ),
    [reunioes],
  );

  const escolhida = elegiveis.find((r) => r.id === reuniaoSel);
  // `juntarFontes` derruba "carregando" quando há erro — é ele que garante a
  // ordem erro → carregando → vazio logo abaixo.
  const estadoDaFonte = juntarFontes([fonte]);

  async function gerar() {
    if (!escolhida) return;
    setGerando(true);
    setErro(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const token = await user.getIdToken();
      const r = await fetch("/api/ata/gerar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ meetingId: escolhida.id, setor: destino }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Não foi possível gerar a ata.");
      onGerado(body.id as string, destino, body.jaExistia === true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar a ata.");
      setGerando(false);
    }
  }

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !gerando}
      ariaLabel="Gerar ata da reunião"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={520}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="reunioes" size={12} /> Gerar ata da reunião
        </span>
        <span className={styles.mchip}>{destino}</span>
      </div>

      {/* O ERRO GANHA DE CARREGANDO E DE VAZIO, nesta ordem — é o que o
          cabeçalho de `juntarFontes` explica. Antes desta linha, uma falha na
          assinatura de reuniões caía direto no estado vazio e afirmava que não
          havia reunião processada, mandando a pessoa gravar de novo um áudio
          que já existe. */}
      {estadoDaFonte.erro ? (
        <ErrorState error={estadoDaFonte.erro} onRetry={fonte.tentarDeNovo} />
      ) : estadoDaFonte.carregando ? (
        <SkeletonRow rows={3} texto="Procurando reuniões processadas…" />
      ) : elegiveis.length === 0 ? (
        /* "Ainda não respondeu" e "respondeu e está vazio" são telas diferentes
           (AGENTS.md §3) — este é o segundo caso. */
        <EmptyState
          icon="reunioes"
          title="Nenhuma reunião processada"
          description="A ata sai dos pontos importantes que o processamento gera. Envie o áudio em Reuniões e volte quando ele estiver processado."
        />
      ) : (
        <>
          <label className={styles.rotulo}>Reunião</label>
          <Select
            value={reuniaoSel}
            options={[
              { value: "", label: "Escolha uma reunião…" },
              ...elegiveis.map(
                (r): SelectOption => ({
                  value: r.id,
                  label: `${r.title} · ${r.date ? fmtDayMonth(r.date) : "sem data"} · ${r.sector}`,
                }),
              ),
            ]}
            onChange={(v) => {
              setReuniaoSel(v);
              setErro(null);
            }}
            ariaLabel="Reunião"
          />

          {/* O setor de destino é escolha, e não o setor da reunião: o áudio
              sobe pelo setor de quem gravou, e o assunto costuma pertencer a
              outro. A primeira ata desta tela é exatamente isso — reunião do
              B.I., ata das Cantinas. */}
          <label className={styles.rotulo}>Setor da ata</label>
          <Select
            value={destino}
            options={setores.map((x): SelectOption => ({ value: x, label: x }))}
            onChange={setDestino}
            ariaLabel="Setor da ata"
          />

          {escolhida && escolhida.sector !== destino && (
            <p className={styles.avisoModal}>
              A reunião correu no setor {escolhida.sector} e a ata vai para{" "}
              {destino}. A pauta dela junta as demandas do quadro de {destino}.
            </p>
          )}

          {erro && <p className={styles.erroModal}>{erro}</p>}
        </>
      )}

      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={gerando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          onClick={gerar}
          disabled={gerando || !escolhida || !destino}
        >
          {gerando ? "Gerando…" : "Gerar ata"}
        </button>
      </div>
    </Modal>
  );
}

function ModalDeAta({
  titulo,
  setor,
  users,
  aviso,
  inicial,
  rotuloAcao,
  onFechar,
  onCriar,
}: {
  titulo: string;
  setor: string;
  users: UserProfile[];
  aviso?: string;
  /**
   * O ponto de partida do formulario — e o unico papel que a ata anterior tem
   * aqui. Os campos de data e horario entraram com o modo de EDICAO do
   * cabecalho: sem eles, editar a ata de 26/08 abria um formulario com a data de
   * hoje, e salvar mudava a data da reuniao sem ninguem ter pedido.
   */
  inicial?: {
    titulo?: string;
    data?: string;
    horaInicio?: string;
    horaFim?: string;
    local?: string;
    facilitador?: string;
    participantes?: string[];
  };
  /** O que o botão principal diz. Ausente = "Criar". */
  rotuloAcao?: string;
  onFechar: () => void;
  onCriar: (dados: {
    titulo: string;
    data: string;
    horaInicio: string;
    horaFim: string;
    local: string;
    facilitador: string;
    participantes: string[];
  }) => Promise<void>;
}) {
  const [nome, setNome] = useState(inicial?.titulo ?? "");
  const [data, setData] = useState(inicial?.data || toISO(startOfDay()));
  const [hi, setHi] = useState(inicial?.horaInicio ?? "");
  const [hf, setHf] = useState(inicial?.horaFim ?? "");
  const [local, setLocal] = useState(inicial?.local ?? "");
  const [facil, setFacil] = useState(inicial?.facilitador ?? "");
  const [participantes, setParticipantes] = useState<string[]>(
    inicial?.participantes ?? [],
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const id = useId();

  const doSetor = users
    .filter((u) => u.active && (u.sectors ?? []).includes(setor))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <Modal
      onClose={onFechar}
      /* Fechar no meio da escrita deixaria a tela sem dizer como terminou. */
      podeFechar={() => !salvando}
      ariaLabel={titulo}
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={520}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="reunioes" size={12} /> {titulo}
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      {aviso && <p className={styles.avisoModal}>{aviso}</p>}
      {/* O <label> APONTA para o campo. Os cinco inputs deste formulário tinham
          rótulo visual sem `htmlFor`, sem `aria-label` e sem envolver o campo:
          para quem usa leitor de tela eram cinco caixas sem nome, e o clique no
          rótulo não levava o cursor a lugar nenhum. */}
      <label className={styles.rotulo} htmlFor={`${id}-titulo`}>
        Título da reunião
      </label>
      <input
        id={`${id}-titulo`}
        className={styles.input}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Reunião Semanal de Operações"
        autoFocus
      />
      <div className={styles.linhaCampos}>
        <div>
          <label className={styles.rotulo} htmlFor={`${id}-data`}>
            Data
          </label>
          <input
            id={`${id}-data`}
            type="date"
            className={styles.input}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        <div>
          <label className={styles.rotulo} htmlFor={`${id}-inicio`}>
            Início
          </label>
          <input
            id={`${id}-inicio`}
            type="time"
            className={styles.input}
            value={hi}
            onChange={(e) => setHi(e.target.value)}
          />
        </div>
        <div>
          <label className={styles.rotulo} htmlFor={`${id}-fim`}>
            Fim
          </label>
          <input
            id={`${id}-fim`}
            type="time"
            className={styles.input}
            value={hf}
            onChange={(e) => setHf(e.target.value)}
          />
        </div>
      </div>
      <label className={styles.rotulo} htmlFor={`${id}-local`}>
        Local
      </label>
      <input
        id={`${id}-local`}
        className={styles.input}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Sala 2 / Híbrido"
      />
      <label className={styles.rotulo}>Facilitador</label>
      <Select
        value={facil}
        options={[
          { value: "", label: "Sem facilitador" },
          ...doSetor.map((u) => ({ value: u.email, label: u.name, color: u.color })),
        ]}
        onChange={setFacil}
        ariaLabel="Facilitador"
      />
      <label className={styles.rotulo}>Participantes</label>
      {/* Só quem é do setor: convidar para a ata alguém que a regra do Firestore
          não deixa ler a ata seria um convite que o app não cumpre. */}
      <div className={styles.pessoas}>
        {doSetor.length === 0 && (
          <span className={styles.vazioInline}>
            Ninguém cadastrado neste setor ainda.
          </span>
        )}
        {doSetor.map((u) => {
          const on = participantes.includes(u.email);
          return (
            <button
              key={u.email}
              className={`${styles.pessoa} ${on ? styles.pessoaOn : ""}`}
              onClick={() =>
                setParticipantes((cur) =>
                  on ? cur.filter((x) => x !== u.email) : [...cur, u.email],
                )
              }
              aria-pressed={on}
            >
              <Avatar pessoa={u} size={20} />
              {u.name}
            </button>
          );
        })}
      </div>
      {erro && <p className={styles.erroModal}>{erro}</p>}
      <div className={styles.macoes}>
        <button className={styles.btnGhost} onClick={onFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          className={styles.btnPrim}
          disabled={salvando || !nome.trim()}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onCriar({
                titulo: nome,
                data,
                horaInicio: hi,
                horaFim: hf,
                local,
                facilitador: facil,
                participantes,
              });
            } catch (e) {
              setErro(
                e instanceof Error ? e.message : "Não foi possível criar a ata.",
              );
            } finally {
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Salvando…" : (rotuloAcao ?? "Criar")}
        </button>
      </div>
    </Modal>
  );
}
