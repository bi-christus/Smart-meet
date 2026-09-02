"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  montarPauta,
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
  type ItemDeAta,
  type StatusTarefa,
  type TarefaDeAta,
} from "@/lib/ata";
import { subscribeMeetings, type Meeting } from "@/lib/meetings";
import { ehFimDeSemanaISO, fmtDayMonth, startOfDay, toISO } from "@/lib/datas";
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

/** A cor de cada estado, na mesma ordem de gravidade da pauta. */
const COR_ESTADO: Record<EstadoNaAta, string> = {
  atrasada: "var(--danger, #fb7185)",
  andamento: "#f5b13d",
  pendente: "#c084fc",
  concluida: "#34d399",
  // Cinza, e o único da paleta que não é uma cor de alerta: registro não pede
  // ação de ninguém. Ele acender igual aos outros ensinaria a ignorar todos.
  registro: "#8b93a7",
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
    setErroEscrita(null);
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
                  options={atas.map(
                    (a): SelectOption => ({
                      value: a.id,
                      label: a.data ? `${a.titulo} · ${fmtDayMonth(a.data)}` : a.titulo,
                    }),
                  )}
                  onChange={setAtaSel}
                  ariaLabel="Reunião"
                />
              </div>
              <Linha rotulo="Data" valor={ata.data ? fmtDayMonth(ata.data) : "—"} />
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
                    ? "A pauta junta as demandas em aberto do quadro deste setor com os assuntos que a reunião levantou. Acrescente o primeiro assunto aqui, ou abra uma demanda no Kanban."
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
              pautaFiltrada.map((linha) => (
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
                />
              ))
            )}
          </main>
        </div>
      )}

      {assuntoAberto && ata && (
        <ModalDeAssunto
          setor={setor}
          dimensoes={dims}
          onFechar={() => setAssuntoAberto(false)}
          onCriar={async (dados) => {
            // Os filtros saem do caminho: acrescentar um assunto e ele não
            // aparecer porque um filtro de responsável de dez minutos atrás
            // continua ligado seria o mesmo que o botão não ter funcionado.
            limparFiltros();
            setDestaque(await criarAssunto(dados));
            setAssuntoAberto(false);
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
          </div>
          <h3>{titulo || (foraDoQuadro ? "Demanda sem título na ata" : "")}</h3>
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
            {/* SÓ NO ASSUNTO. A linha que já tem card não vira demanda de novo,
                e oferecer o botão ali seria oferecer a duplicata — nem a que
                está no quadro, nem a que saiu dele: a segunda já teve card, e
                abrir outro perderia o vínculo com o que foi para a lixeira. */}
            {!card && !foraDoQuadro && (
              <button
                className={styles.virarDemanda}
                onClick={onPromover}
                title="Abrir esta linha como demanda no quadro do setor"
              >
                <Icon name="kanban" size={12} /> Criar demanda
              </button>
            )}
          </div>
        </div>

        <div className={styles.coluna}>
          <div className={styles.colunaRot}>Status da demanda</div>
          <span
            className={styles.selo}
            style={{
              background: `color-mix(in srgb, ${COR_ESTADO[estado]} 16%, transparent)`,
              color: `color-mix(in srgb, ${COR_ESTADO[estado]} 62%, var(--tx))`,
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

        <div className={styles.coluna}>
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

        <div className={styles.coluna}>
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
          <button
            className={`${styles.levar} ${item.proximaReuniao ? styles.levarOn : ""}`}
            onClick={() =>
              onGravar((i) => ({ ...i, proximaReuniao: !i.proximaReuniao }))
            }
            aria-pressed={item.proximaReuniao}
          >
            <Icon name={item.proximaReuniao ? "check" : "calendar"} size={13} />
            {item.proximaReuniao ? "Vai para a próxima" : "Levar para próxima reunião"}
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
                        color:
                          s === "concluida"
                            ? "#34d399"
                            : s === "andamento"
                              ? "#f5b13d"
                              : "#c084fc",
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
 * "Acrescentar assunto" — a linha de pauta que ainda NÃO é demanda.
 *
 * Ela nasce sem card de propósito, e é a fronteira de demandas em ação: a
 * reunião discute muita coisa que ainda não é trabalho de ninguém, e forçar um
 * card para poder registrar a conversa inverteria a ordem — o card nasceria da
 * necessidade de ter onde escrever, e não de alguém decidir que aquilo é
 * trabalho. Quando a decisão vier, o botão "Criar demanda" está no bloco.
 */
function ModalDeAssunto({
  setor,
  dimensoes,
  onFechar,
  onCriar,
}: {
  setor: string;
  dimensoes: Dimensao[];
  onFechar: () => void;
  onCriar: (dados: {
    assunto: string;
    contexto: string;
    dimensaoId: string;
    subdimensaoId: string;
  }) => Promise<void>;
}) {
  const [assunto, setAssunto] = useState("");
  const [contexto, setContexto] = useState("");
  const [classe, setClasse] = useState<Classificacao>({
    dimensaoId: "",
    subdimensaoId: "",
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <Modal
      onClose={onFechar}
      podeFechar={() => !salvando}
      ariaLabel="Acrescentar assunto à pauta"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={520}
    >
      <div className={styles.mhead}>
        <span className={styles.mchip}>
          <Icon name="plus" size={12} /> Assunto da pauta
        </span>
        <span className={styles.mchip}>{setor}</span>
      </div>
      <p className={styles.avisoModal}>
        Assunto é o que a reunião discutiu e que <b>ainda não é demanda</b>. Ele
        entra na pauta com decisão, objetivo e tarefas — e vira demanda no quadro
        quando alguém decidir que é trabalho.
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
              await onCriar({ assunto, contexto, ...classe });
            } catch (e) {
              setErro(
                e instanceof Error
                  ? e.message
                  : "Não foi possível acrescentar o assunto.",
              );
              setSalvando(false);
            }
          }}
        >
          {salvando ? "Salvando…" : "Acrescentar"}
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
// ---------------------------------------------------------------------------
// O formulário de ata — serve para criar e para abrir a próxima
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
      <label className={styles.rotulo}>Título da reunião</label>
      <input
        className={styles.input}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Reunião Semanal de Operações"
        autoFocus
      />
      <div className={styles.linhaCampos}>
        <div>
          <label className={styles.rotulo}>Data</label>
          <input
            type="date"
            className={styles.input}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        <div>
          <label className={styles.rotulo}>Início</label>
          <input
            type="time"
            className={styles.input}
            value={hi}
            onChange={(e) => setHi(e.target.value)}
          />
        </div>
        <div>
          <label className={styles.rotulo}>Fim</label>
          <input
            type="time"
            className={styles.input}
            value={hf}
            onChange={(e) => setHf(e.target.value)}
          />
        </div>
      </div>
      <label className={styles.rotulo}>Local</label>
      <input
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
