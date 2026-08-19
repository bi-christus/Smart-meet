"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { subscribeUsers, type UserProfile } from "@/lib/users";
import {
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  columnsBySector,
  deliveredBySector,
  updateCard,
  DEFAULT_COLUMNS,
  DEMAND_TYPE_LABEL,
  PRIORITY_LABEL,
  type Card,
  type ColumnDoc,
  type KanbanColumn,
} from "@/lib/kanban";
import {
  subscribeSolicitantes,
  subscribeSolicitanteSetores,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import {
  subscribeMeetings,
  updateMeeting,
  MEETING_STATUS_LABEL,
  type Meeting,
} from "@/lib/meetings";
import {
  addDays,
  daysBetween,
  DOW_LABEL,
  DOW_MINI_UTEIS,
  ehFimDeSemana,
  MES_LONGO,
  parseISO,
  startOfDay,
  startOfWeek,
  toISO,
} from "@/lib/datas";
import { diffCard } from "@/lib/historico-core";
import { codigoDe, fraseDeFalha } from "@/lib/erro-ui-core";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { Modal } from "@/components/modal";
import { OverlayPortal } from "@/components/overlay-portal";
import { Select, type SelectOption } from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow, classeAparece } from "@/components/skeleton";
import { CardModal } from "../kanban/card-modal";
import {
  autorDoRegistro,
  criarRotulos,
  PRIORITY_COLOR,
} from "../kanban/comum";
import styles from "./cronograma.module.css";

/**
 * Cronograma — o mês do setor numa página.
 *
 * Duas coisas ocupam a agenda de quem trabalha aqui: reunião (que já aconteceu
 * ou vai acontecer) e prazo de demanda. Elas viviam em telas separadas, e o
 * conflito entre as duas — a entrega marcada para o dia da reunião de status —
 * só aparecia quando já era tarde. Aqui elas dividem a mesma célula do dia.
 *
 * Demanda concluída sai do calendário: prazo cumprido não é compromisso, e
 * deixá-lo no quadro esconde o que ainda precisa de atenção.
 *
 * A PARTIR DAQUI O CALENDÁRIO TAMBÉM ESCREVE. Clicar numa demanda abre o mesmo
 * modal do Kanban, aqui mesmo; arrastar um item para outro dia muda a data. O
 * calendário era só leitura, e quem via o problema tinha de ir consertá-lo em
 * outra tela — o que na prática significava não consertar.
 */

type Item =
  | { tipo: "reuniao"; date: string; title: string; sector: string; ref: Meeting }
  | {
      tipo: "prazo";
      date: string;
      title: string;
      sector: string;
      ref: Card;
      col?: KanbanColumn;
    };

type Vista = "mes" | "semana";

/** Identidade estável de um item — chave de lista, alvo de arraste e da prévia. */
function chaveItem(it: Item): string {
  return `${it.tipo}:${it.ref.id}`;
}

/**
 * Listas vazias constantes, para os cálculos rodarem antes de os dados
 * chegarem. Fora do componente porque `?? []` no corpo cria um array novo a
 * cada render, e os `useMemo` que dependem dele recalculariam sempre.
 */
const SEM_CARDS: Card[] = [];
const SEM_MEETINGS: Meeting[] = [];
const SEM_COLS: ColumnDoc[] = [];
const SEM_USERS: UserProfile[] = [];
const SEM_SOLICITANTES: Solicitante[] = [];
const SEM_SETORES: SolicitanteSetor[] = [];

/** Assinatura que nem chegou a abrir: não há nada para fechar depois. */
const NADA_A_FECHAR = () => undefined;

/**
 * Quanto tempo o ponteiro precisa ficar parado antes de a prévia aparecer.
 *
 * A grade tem dezenas de chips e o mouse atravessa vários só para chegar ao
 * outro canto da tela: sem atraso, a página piscaria uma prévia por chip no
 * caminho. Uma vez que UMA prévia esteja aberta, a seguinte é instantânea — a
 * pessoa já declarou que está lendo os itens, e esperar de novo a cada um seria
 * cobrar duas vezes pela mesma decisão.
 */
const ABRIR_PREVIA_MS = 320;
/**
 * E a saída é tolerante: sair do chip não fecha na hora.
 *
 * O vão de 4px entre dois chips da mesma célula é atravessado em menos de um
 * quadro. Fechar no `mouseleave` faria a prévia sumir e voltar no meio do
 * caminho, que é a mesma piscada que o atraso de entrada existe para evitar.
 */
const FECHAR_PREVIA_MS = 140;

/**
 * As colunas de um setor no formato que o modal da demanda espera.
 *
 * `columnsBySector` NÃO serve aqui: ele devolve `KanbanColumn` (`id`, `title`,
 * `color`), e o modal lê `colId` para casar com `card.columnId` — com o formato
 * errado o select de etapa abriria sempre vazio. O fallback repete o do Kanban:
 * setor que nunca personalizou o quadro mostra as etapas padrão em vez de
 * nenhuma.
 */
function colunasDoSetor(
  porSetor: Record<string, ColumnDoc[]>,
  sector: string,
): ColumnDoc[] {
  const reais = porSetor[sector];
  if (reais?.length) return reais;
  return DEFAULT_COLUMNS.map((c, i) => ({
    id: `_fb_${sector}_${c.id}`,
    sector,
    colId: c.id,
    title: c.title,
    color: c.color,
    order: i,
  }));
}

/** Retângulo do chip na janela — é dele que a prévia se pendura. */
type Ancora = { left: number; right: number; top: number; bottom: number };

export default function CronogramaPage() {
  const { profile } = useAuth();

  const sectors = useSetoresDaPessoa(profile);

  /**
   * As quatro assinaturas, cada uma sabendo dizer se já respondeu.
   *
   * Antes eram quatro `useState([])`, e o calendário afirmava "Nenhuma reunião
   * ou prazo neste período" enquanto ainda buscava — com dois dos quatro erros
   * indo só para o console e os outros dois para lugar nenhum.
   */
  const chaveSetores = sectors.join("|");
  const fCards = useAsyncData<Card>(chaveSetores, (onData, onErro) =>
    subscribeCardsForSectors(sectors, onData, onErro),
  );
  const fMeetings = useAsyncData<Meeting>(chaveSetores, (onData, onErro) =>
    subscribeMeetings(sectors, onData, onErro),
  );
  const fCols = useAsyncData<ColumnDoc>(chaveSetores, (onData, onErro) =>
    subscribeColumnsForSectors(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  /**
   * O cadastro de solicitantes só é assinado quando alguém abre uma demanda.
   *
   * Ele não desenha NADA do calendário: são duas coleções que só existem para
   * preencher dois comboboxes dentro do modal. O Cronograma é a tela que mais
   * gente deixa aberta o dia inteiro sem clicar em nada, e assinar as duas na
   * montagem faria toda essa gente pagar duas escutas do Firestore por um
   * formulário que ninguém abriu.
   *
   * MAS A TRAVA NÃO VOLTA A FECHAR. Uma vez ligada, fica ligada até a página
   * sair: se a chave voltasse a `""` no fechar do modal, cada abertura seguinte
   * pagaria a leitura de novo — e a segunda abertura, ao contrário da primeira,
   * é sempre alguém que está em meio a um trabalho. O preço passa a ser uma
   * escuta por sessão em que alguém de fato editou algo, que é o que o Kanban
   * paga o tempo todo.
   *
   * O que acontece na janela entre abrir o modal e o cadastro chegar: os dois
   * comboboxes mostram só "— Não definido —". Nada se perde — o estado do
   * formulário nasce do card, não da lista, então salvar nesse intervalo não
   * apaga o solicitante que já estava lá.
   */
  const [precisaCadastro, setPrecisaCadastro] = useState(false);
  const fSolicitantes = useAsyncData<Solicitante>(
    precisaCadastro ? "todos" : "",
    (onData, onErro) => {
      if (!precisaCadastro) {
        onData([]);
        return NADA_A_FECHAR;
      }
      return subscribeSolicitantes(onData, onErro);
    },
  );
  const fReqSetores = useAsyncData<SolicitanteSetor>(
    precisaCadastro ? "todos" : "",
    (onData, onErro) => {
      if (!precisaCadastro) {
        onData([]);
        return NADA_A_FECHAR;
      }
      return subscribeSolicitanteSetores(onData, onErro);
    },
  );

  const cards = fCards.data ?? SEM_CARDS;
  const meetings = fMeetings.data ?? SEM_MEETINGS;
  const cols = fCols.data ?? SEM_COLS;
  // A lista de pessoas não entra no estado da grade: ela traduz e-mail em nome
  // e pinta o avatar do responsável no chip, e um chip sem o rosto resolvido
  // ainda diz tudo o que importa — o título, o dia e o setor. Fazer o
  // calendário inteiro esperar por ela seria segurar a agenda por causa de um
  // enfeite.
  const users = fUsers.data ?? SEM_USERS;
  const solicitantes = fSolicitantes.data ?? SEM_SOLICITANTES;
  const reqSetores = fReqSetores.data ?? SEM_SETORES;

  const [vista, setVista] = useState<Vista>("mes");
  const [filtroSetor, setFiltroSetor] = useState("");
  /** Deslocamento em meses (ou semanas, na vista de semana) a partir de hoje. */
  const [offset, setOffset] = useState(0);
  /**
   * O que está aberto — pelo ID, e não pelo objeto.
   *
   * O card chega de uma assinatura em tempo real: guardar a cópia que estava na
   * tela no momento do clique faria o modal editar um retrato do passado, e
   * — pior — sobreviver ao próprio sumiço. Mandar a demanda para a lixeira de
   * dentro do modal a tira de `cards`, e é isso que fecha a tela, sem nenhum
   * efeito para sincronizar nada.
   */
  const [aberto, setAberto] = useState<{
    tipo: "reuniao" | "prazo";
    id: string;
  } | null>(null);

  /**
   * O item sendo arrastado e o dia sob o ponteiro.
   *
   * `chave` junto do par tipo/id porque reunião e demanda vivem em coleções
   * diferentes: comparar só o id deixaria a porta aberta para uma reunião e uma
   * demanda de mesmo id aparecerem as duas como "saindo".
   */
  const [arrastando, setArrastando] = useState<{
    chave: string;
    tipo: "reuniao" | "prazo";
    id: string;
    de: string;
  } | null>(null);
  const [diaAlvo, setDiaAlvo] = useState<string | null>(null);
  const [erroMover, setErroMover] = useState<string | null>(null);

  /** A prévia aberta: o item e o retângulo do chip que a ancora. */
  const [previa, setPrevia] = useState<{ item: Item; ancora: Ancora } | null>(
    null,
  );
  const timerPrevia = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Efeito só de limpeza: sair da página com um atraso de entrada pendente
  // deixaria um `setTimeout` vivo tentando abrir a prévia de uma tela que já não
  // existe. Nada de `setState` aqui dentro — é o que a regra do projeto proíbe.
  useEffect(() => () => {
    if (timerPrevia.current) clearTimeout(timerPrevia.current);
  }, []);

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);

  const colsPorSetor = useMemo(
    () => columnsBySector(cols, sectors),
    [cols, sectors],
  );
  /** As mesmas colunas, cruas, para o modal — que precisa de `colId`. */
  const colDocsPorSetor = useMemo(() => {
    const m: Record<string, ColumnDoc[]> = {};
    cols.forEach((c) => (m[c.sector] = c.sector in m ? [...m[c.sector], c] : [c]));
    return m;
  }, [cols]);
  const entreguesPorSetor = useMemo(
    () => deliveredBySector(colsPorSetor),
    [colsPorSetor],
  );

  const hoje = useMemo(() => startOfDay(), []);

  /**
   * Janela visível: um mês inteiro, ou a semana — de segunda a DOMINGO.
   *
   * O `+6` continua sendo seis mesmo depois de a grade ter encolhido para cinco
   * colunas, e isto é de propósito. A janela é o período que a página responde
   * por; a grade é só o desenho dele. Encurtá-la para a sexta jogaria sábado e
   * domingo para fora do período — e com eles a faixa que avisa que existe
   * compromisso marcado lá, que é justamente o que não pode sumir. O passo da
   * navegação também é sete: `offset * 7`, porque a semana seguinte começa sete
   * dias depois, não cinco.
   */
  const janela = useMemo(() => {
    if (vista === "semana") {
      const ini = addDays(startOfWeek(hoje), offset * 7);
      return { ini, fim: addDays(ini, 6) };
    }
    const base = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
    return {
      ini: base,
      fim: new Date(base.getFullYear(), base.getMonth() + 1, 0),
    };
  }, [vista, offset, hoje]);

  const itens = useMemo(() => {
    const out: Item[] = [];
    const noFiltro = (s: string) => !filtroSetor || s === filtroSetor;

    meetings.forEach((m) => {
      if (!m.date || !noFiltro(m.sector)) return;
      out.push({
        tipo: "reuniao",
        date: m.date,
        title: m.title,
        sector: m.sector,
        ref: m,
      });
    });

    cards.forEach((c) => {
      if (!c.due || !noFiltro(c.sector)) return;
      const doQuadro = colsPorSetor[c.sector] ?? [];
      // Prazo cumprido não é compromisso: demanda entregue sai da agenda — e
      // com ela o selo "vencida há N dias" que aparecia sobre trabalho pronto.
      if (entreguesPorSetor[c.sector]?.has(c.columnId)) return;
      out.push({
        tipo: "prazo",
        date: c.due,
        title: c.title,
        sector: c.sector,
        ref: c,
        col: doQuadro.find((x) => x.id === c.columnId),
      });
    });
    return out;
  }, [meetings, cards, filtroSetor, colsPorSetor, entreguesPorSetor]);

  const porDia = useMemo(() => {
    const m: Record<string, Item[]> = {};
    itens.forEach((it) => (m[it.date] = [...(m[it.date] ?? []), it]));
    // Reunião primeiro: ela tem hora marcada, o prazo é do dia inteiro.
    Object.values(m).forEach((lista) =>
      lista.sort((a, b) =>
        a.tipo === b.tipo ? a.title.localeCompare(b.title, "pt-BR") : a.tipo === "reuniao" ? -1 : 1,
      ),
    );
    return m;
  }, [itens]);

  /**
   * Células da grade: semanas de segunda a sexta.
   *
   * DOIS PASSOS DIFERENTES convivem nesta conta, e trocá-los é o erro que não
   * trava nada — só desenha o mês errado com cara de mês certo. A grade tem
   * CINCO células por linha; o calendário anda SETE dias por linha. Por isso o
   * dia da célula `i` é `semana * 7 + coluna`, e nunca `i` corrido: com `i`
   * corrido a segunda linha começaria no sábado.
   *
   * O total vem da distância entre duas SEGUNDAS, e não mais do intervalo em
   * milissegundos ponta a ponta — aquela conta media as sete colunas que já não
   * existem. Como as duas pontas são segundas, a diferença é múltipla de sete
   * mesmo com uma virada de horário de verão no meio.
   */
  const celulas = useMemo(() => {
    const ini = startOfWeek(janela.ini);
    const dias = Math.round(
      (startOfWeek(janela.fim).getTime() - ini.getTime()) / 86400000,
    );
    const semanas = dias / 7 + 1;
    return Array.from({ length: semanas * 5 }, (_, i) =>
      addDays(ini, Math.floor(i / 5) * 7 + (i % 5)),
    );
  }, [janela]);

  /**
   * A contagem do subtítulo — e o que caiu em fim de semana ENTRA nela.
   *
   * A tentação era contar só o que a grade desenha, mas o subtítulo fala do
   * PERÍODO, e sábado e domingo continuam dentro dele: o compromisso marcado lá
   * está na tela, na faixa logo acima da grade. Descontá-lo faria a página
   * anunciar "3 compromissos" com quatro à vista — número que não bate com o
   * desenho é pior do que número nenhum. Pelo mesmo motivo o estado de vazio
   * (`noPeriodo === 0`) continua honesto: ele só aparece quando não há nada em
   * lugar nenhum, nem na grade nem na faixa.
   */
  const noPeriodo = useMemo(
    () =>
      itens.filter((it) => {
        const d = parseISO(it.date);
        return d >= janela.ini && d <= janela.fim;
      }).length,
    [itens, janela],
  );

  /**
   * O que caiu em sábado ou domingo dentro da janela — o que a grade de cinco
   * colunas não tem mais onde desenhar.
   *
   * Percorre os dias da janela em vez de filtrar `itens` para herdar a ordem já
   * resolvida em `porDia` (reunião antes de prazo, depois título): a faixa lista
   * na mesma ordem em que a célula listaria, e ninguém precisa manter duas
   * regras de ordenação em sincronia.
   */
  const fimDeSemana = useMemo(() => {
    const grupos: { iso: string; rotulo: string; itens: Item[] }[] = [];
    for (let d = janela.ini; d <= janela.fim; d = addDays(d, 1)) {
      if (!ehFimDeSemana(d)) continue;
      const iso = toISO(d);
      const doDia = porDia[iso];
      if (!doDia?.length) continue;
      // O dia da semana por extenso é a informação que EXPLICA a faixa: sem ele
      // a pessoa vê uma data solta e não entende por que aquilo não está no
      // quadro. "16 de agosto" não diz nada; "sábado, 16 de agosto" diz tudo.
      grupos.push({
        iso,
        rotulo: `${DOW_LABEL[d.getDay()]}, ${d.getDate()} de ${MES_LONGO[d.getMonth()]}`,
        itens: doDia,
      });
    }
    return grupos;
  }, [porDia, janela]);

  const noFimDeSemana = fimDeSemana.reduce((s, g) => s + g.itens.length, 0);

  /**
   * O que está aberto, lido do dado vivo.
   *
   * `find` e não a cópia guardada: quando a demanda vai para a lixeira — de
   * dentro do próprio modal ou pela mão de outra pessoa —, ela sai de `cards` e
   * o `undefined` daqui é o que tira o modal da tela. Sem `useEffect`, sem
   * `setState` em cascata, sem tela estourada.
   */
  const demandaAberta =
    aberto?.tipo === "prazo"
      ? cards.find((c) => c.id === aberto.id)
      : undefined;
  const reuniaoAberta =
    aberto?.tipo === "reuniao"
      ? meetings.find((m) => m.id === aberto.id)
      : undefined;

  /**
   * O que o modal precisa do setor da demanda aberta — SEM `useMemo`.
   *
   * Estes cinco derivam de `demandaAberta`, que sai de um `find` sobre a lista
   * viva. O React Compiler recusa memoização manual apoiada num valor que ele
   * não consegue provar imutável, e ao recusar ele desiste de otimizar o
   * COMPONENTE INTEIRO — o lint diz isso em letras maiúsculas ("Compilation
   * Skipped"). Sem os `useMemo`, o próprio compilador memoriza, e melhor: as
   * cinco contas só rodam de verdade quando `aberto` muda. E mesmo sem
   * compilador nenhum, percorrer os cards de um setor é trabalho de
   * microssegundos que só acontece com um modal na tela.
   */
  const setorAberto = demandaAberta?.sector ?? "";
  const colunasDaDemanda = colunasDoSetor(colDocsPorSetor, setorAberto);
  const rotulosDaDemanda = criarRotulos(usersMap, colunasDaDemanda);

  /**
   * Tags e demandas que o "#" do modal oferece — do QUADRO daquele setor.
   *
   * O Cronograma é multi-setor e o catálogo não é: sugerir a tag do RH dentro
   * de uma demanda do BI criaria, no quadro do BI, uma tag que ninguém de lá
   * escreveu. Sai de `cards` inteiro (e não de `itens`) porque o catálogo não
   * pode encolher por causa do filtro de setor nem do período na tela.
   */
  const cardsDoSetorAberto = setorAberto
    ? cards.filter((c) => c.sector === setorAberto)
    : SEM_CARDS;
  const usoDeTag = new Map<string, number>();
  cardsDoSetorAberto.forEach((c) =>
    (c.tags ?? []).forEach((t) => usoDeTag.set(t, (usoDeTag.get(t) ?? 0) + 1)),
  );
  const tagsDoQuadro = [...usoDeTag.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([tag, n]) => ({ tag, n }));
  const demandasDoQuadro = cardsDoSetorAberto.map((c) => ({
    id: c.id,
    title: c.title,
    columnId: c.columnId,
  }));

  /**
   * A grade lê de três assinaturas, e não de quatro.
   *
   * `cols` entra porque demanda entregue sai da agenda — sem as colunas, o
   * calendário mostraria prazo cumprido com selo de "vencida há N dias" sobre
   * trabalho pronto. Isso é número errado, não número faltando, e por isso
   * segura a grade junto com os cards e as reuniões.
   */
  const grade = juntarFontes([fCards, fMeetings, fCols]);
  const reabrirGrade = () => {
    fCards.tentarDeNovo();
    fMeetings.tentarDeNovo();
    fCols.tentarDeNovo();
  };

  const setorOptions: SelectOption[] = [
    { value: "", label: "Todos os setores" },
    ...sectors.map((s) => ({ value: s, label: s })),
  ];

  const titulo =
    vista === "semana"
      ? `${janela.ini.getDate()} a ${janela.fim.getDate()} de ${MES_LONGO[janela.fim.getMonth()]}`
      : `${MES_LONGO[janela.ini.getMonth()]} de ${janela.ini.getFullYear()}`;

  // --- prévia ao pairar -------------------------------------------------

  function pararTimerPrevia() {
    if (timerPrevia.current) clearTimeout(timerPrevia.current);
    timerPrevia.current = null;
  }
  function fecharPrevia() {
    pararTimerPrevia();
    setPrevia(null);
  }
  function ancoraDe(el: HTMLElement): Ancora {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  /**
   * O aparelho tem ponteiro que pousa sem clicar.
   *
   * Vale para os DOIS caminhos de abertura, e o do foco é o menos óbvio: no
   * celular, tocar num botão o FOCA — sem este guarda, o toque abriria uma
   * prévia que nenhum `mouseleave` viria fechar e que ficaria pendurada sobre a
   * grade. A pergunta é sobre o ponteiro e não sobre a largura da janela:
   * `(max-width: 900px)` esconderia a prévia de quem só encostou a janela do
   * navegador na metade da tela, com mouse e teclado na mão.
   */
  function temHover() {
    return window.matchMedia("(hover: hover)").matches;
  }
  /** Foco é decisão deliberada: quem tabulou até aqui não precisa esperar. */
  function previaNoFoco(it: Item, el: HTMLElement) {
    if (arrastando || !temHover()) return;
    pararTimerPrevia();
    setPrevia({ item: it, ancora: ancoraDe(el) });
  }
  function pairou(it: Item, el: HTMLElement) {
    if (arrastando || !temHover()) return;
    const ancora = ancoraDe(el);
    pararTimerPrevia();
    // Com uma prévia já aberta, a próxima é instantânea — e trocar o conteúdo
    // do MESMO nó (a `key` não muda) é o que impede a animação de entrada de
    // rodar de novo a cada chip atravessado.
    if (previa) {
      setPrevia({ item: it, ancora });
      return;
    }
    timerPrevia.current = setTimeout(
      () => setPrevia({ item: it, ancora }),
      ABRIR_PREVIA_MS,
    );
  }
  function saiu() {
    pararTimerPrevia();
    timerPrevia.current = setTimeout(() => setPrevia(null), FECHAR_PREVIA_MS);
  }

  const chavePrevia = previa ? chaveItem(previa.item) : null;

  // --- arrastar ---------------------------------------------------------

  /**
   * Quem pode mudar a data deste item.
   *
   * É a transcrição do `podeNoSetor` que a regra do Firestore exige no update
   * de `/cards` e de `/meetings`: usuário ativo que enxerga o setor. NÃO é
   * `gestorNoSetor` — mudar prazo é edição comum, e exigir gestão aqui deixaria
   * o operador olhando um atraso do próprio setor sem poder remarcá-lo, num
   * calendário onde o mesmo operador pode abrir o modal e trocar a data no
   * campo. Portão que é mais estrito que o banco mente para quem pode.
   */
  const podeMover = (sector: string) =>
    !!profile?.active && sectors.includes(sector);

  if (!profile) return null;

  // Preso a uma const aqui embaixo do guarda: `soltarNoDia` é declaração de
  // função, e o estreitamento de `profile` não atravessa até lá dentro.
  const autorAtual = profile.email;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Cronograma</h1>
            <p>Reuniões e prazos das demandas.</p>
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
   * Solta o item num dia da grade — e é aqui que o calendário escreve.
   *
   * NADA DE ESTADO OTIMISTA. O chip só muda de célula quando a assinatura
   * devolve o card com a data nova, e o SDK do Firestore faz isso no mesmo
   * quadro (a escrita local entra no snapshot antes de ir ao servidor). O ganho
   * é o que a Issue pede: se o servidor recusar, o próprio SDK desfaz a escrita
   * local e o chip volta sozinho para o dia de origem — não existe um "lugar
   * novo" pintado à mão que possa sobreviver à recusa mentindo que salvou.
   */
  async function soltarNoDia(iso: string) {
    const alvo = arrastando;
    setArrastando(null);
    setDiaAlvo(null);
    if (!alvo || alvo.de === iso) return;
    setErroMover(null);
    try {
      if (alvo.tipo === "reuniao") {
        const m = meetings.find((x) => x.id === alvo.id);
        if (!m) return;
        await updateMeeting(m.id, { date: iso });
        return;
      }
      const c = cards.find((x) => x.id === alvo.id);
      if (!c) return;
      // Arrastar é a mudança que menos deixa rastro na memória de quem
      // arrastou: não há formulário, não há botão Salvar, e uma semana depois
      // ninguém lembra que mexeu. Por isso o registro vai no MESMO lote da
      // escrita, como o modal faz — `updateCard` não aceita gravar sem ele.
      //
      // `acao: "editada"` e não `"movida"`: neste repositório "movida" é a
      // troca de ETAPA (é o que `moveCard` grava, junto com o reset do aging), e
      // "arrastou o card" na timeline mandaria quem lê procurar uma coluna que
      // não mudou. A linha que aparece é "Prazo: 12/08/2026 → 14/08/2026".
      await updateCard(
        c.id,
        { due: iso, rev: (c.rev ?? 0) + 1 },
        {
          ctx: { autor: autorAtual, sector: c.sector },
          acao: "editada",
          mudancas: diffCard(
            { due: c.due },
            { due: iso },
            criarRotulos(usersMap, colunasDoSetor(colDocsPorSetor, c.sector)),
          ),
        },
      );
    } catch (e) {
      console.error("[mudar data no cronograma]", codigoDe(e), e);
      setErroMover(
        fraseDeFalha("Não foi possível mudar a data.", e, navigator.onLine),
      );
    }
  }

  /** As props de arraste de um chip — iguais na grade e na faixa de fim de semana. */
  function propsDeArraste(it: Item) {
    if (!podeMover(it.sector)) return { draggable: false };
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", it.ref.id);
        e.dataTransfer.effectAllowed = "move";
        setArrastando({
          chave: chaveItem(it),
          tipo: it.tipo,
          id: it.ref.id,
          de: it.date,
        });
        // Prévia aberta durante o arraste cobre justamente as células para onde
        // se está mirando.
        fecharPrevia();
      },
      onDragEnd: () => {
        setArrastando(null);
        setDiaAlvo(null);
      },
    };
  }

  function abrir(it: Item) {
    fecharPrevia();
    if (it.tipo === "prazo") setPrecisaCadastro(true);
    setAberto({ tipo: it.tipo, id: it.ref.id });
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Cronograma</h1>
          {/* A contagem só entra depois da resposta: "0 compromissos no
              período" antes de saber é a mesma afirmação falsa da mensagem de
              vazio, dita com a autoridade de um número. */}
          <p>
            Reuniões e prazos de demandas
            {grade.carregando || grade.erro
              ? "."
              : ` — ${noPeriodo} ${noPeriodo === 1 ? "compromisso" : "compromissos"} no período.`}
          </p>
        </div>

        <div className={styles.headTools}>
          <div className={styles.legenda}>
            <span>
              <i className={styles.dotReuniao} />
              Reunião
            </span>
            <span>
              <i className={styles.dotPrazo} />
              Prazo
            </span>
          </div>

          <div className={styles.filtroSetor}>
            <Select
              value={filtroSetor}
              options={setorOptions}
              onChange={setFiltroSetor}
              placeholder="Todos os setores"
              ariaLabel="Filtrar por setor"
            />
          </div>

          <div className={styles.seg}>
            <button
              className={vista === "mes" ? styles.segOn : ""}
              onClick={() => {
                setVista("mes");
                setOffset(0);
              }}
            >
              Mês
            </button>
            <button
              className={vista === "semana" ? styles.segOn : ""}
              onClick={() => {
                setVista("semana");
                setOffset(0);
              }}
            >
              Semana
            </button>
          </div>
        </div>
      </div>

      <div className={styles.navBar}>
        <button
          className={styles.navBtn}
          onClick={() => setOffset((o) => o - 1)}
          aria-label={vista === "semana" ? "Semana anterior" : "Mês anterior"}
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className={styles.navTitulo}>{titulo}</div>
        <button
          className={styles.navBtn}
          onClick={() => setOffset((o) => o + 1)}
          aria-label={vista === "semana" ? "Próxima semana" : "Próximo mês"}
        >
          <Icon name="chevronRight" size={16} />
        </button>
        {/* Hoje é sábado ou domingo: a coluna do dia não existe mais, então
            nenhuma célula recebe o destaque de "hoje". Marcar a segunda seguinte
            resolveria o vazio visual mentindo sobre que dia é — num calendário,
            a pior troca possível. A ausência do destaque vem explicada aqui, e
            só no período que contém hoje (`offset === 0`): em dezembro a frase
            seria ruído. */}
        {offset === 0 && ehFimDeSemana(hoje) && (
          <span className={styles.navNota}>
            hoje é {DOW_LABEL[hoje.getDay()]} — fora da semana útil
          </span>
        )}
        {offset !== 0 && (
          <button className={styles.hojeBtn} onClick={() => setOffset(0)}>
            Hoje
          </button>
        )}
      </div>

      {/* A rolagem tira a prévia do lugar: ela é `position: fixed`, ancorada no
          retângulo que o chip tinha quando o ponteiro parou. Recalcular a cada
          quadro de rolagem seria trabalho para manter na tela algo que a pessoa
          deixou de olhar no instante em que rolou. */}
      <div className={styles.scroll} onScroll={fecharPrevia}>
        {erroMover && (
          <div className={styles.erroMover} role="alert">
            <Icon name="warn" size={15} />
            <span>{erroMover}</span>
            <button
              type="button"
              onClick={() => setErroMover(null)}
              aria-label="Dispensar aviso"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {/**
         * A faixa do que caiu em fim de semana.
         *
         * Ela SÓ existe depois da resposta. Enquanto `grade.carregando`, uma
         * faixa piscando "0 em fim de semana" — ou pior, a ausência dela — seria
         * a mesma afirmação falsa que o subtítulo aprendeu a não fazer: dita com
         * a autoridade de quem já sabe, antes de saber. E quando não há nada em
         * sábado ou domingo ela não deixa moldura nem espaço: o `&&` remove o
         * nó, em vez de renderizar uma caixa vazia.
         *
         * `classeAparece` é o crossfade de 150ms que o esqueleto já usa em todo
         * o app — isto é chegada de dado, o mesmo evento, e merece o mesmo
         * movimento. Nenhum keyframe novo: o bloco de `prefers-reduced-motion`
         * do `globals.css` já cobre este, como cobre os outros.
         *
         * Os itens daqui são arrastáveis como os da grade — é o único jeito de
         * TIRAR do sábado o que já está marcado nele, e a faixa existe
         * justamente para isso.
         */}
        {!grade.carregando && !grade.erro && fimDeSemana.length > 0 && (
          <div className={`${styles.fds} ${classeAparece}`}>
            <Icon name="warn" size={15} />
            <div className={styles.fdsCorpo}>
              <p className={styles.fdsTexto}>
                A grade agora vai de segunda a sexta.{" "}
                {noFimDeSemana === 1
                  ? "Este compromisso está marcado"
                  : `Estes ${noFimDeSemana} compromissos estão marcados`}{" "}
                em fim de semana — arraste para um dia útil, ou abra para ver.
              </p>
              <ul className={styles.fdsLista}>
                {fimDeSemana.map((g) => (
                  <li key={g.iso}>
                    <span className={styles.fdsDia}>{g.rotulo}</span>
                    {g.itens.map((it) => (
                      <button
                        key={chaveItem(it)}
                        className={`${styles.fdsItem} ${
                          arrastando?.chave === chaveItem(it) ? styles.itemSaindo : ""
                        }`}
                        onClick={() => abrir(it)}
                        onMouseEnter={(e) => pairou(it, e.currentTarget)}
                        onMouseLeave={saiu}
                        onFocus={(e) => previaNoFoco(it, e.currentTarget)}
                        onBlur={fecharPrevia}
                        aria-describedby={
                          chavePrevia === chaveItem(it)
                            ? "previa-cronograma"
                            : undefined
                        }
                        {...propsDeArraste(it)}
                      >
                        <i
                          className={
                            it.tipo === "reuniao"
                              ? styles.dotReuniao
                              : styles.dotPrazo
                          }
                        />
                        <span className={styles.fdsTitulo}>{it.title}</span>
                        <span className={styles.fdsMeta}>
                          {it.sector} ·{" "}
                          {it.tipo === "reuniao" ? "reunião" : "prazo"}
                        </span>
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/**
         * A grade fica na tela mesmo carregando, e o esqueleto vai abaixo dela.
         *
         * O mês é estrutura, não dado: os dias 1 a 31 existem antes de qualquer
         * `onSnapshot` e não afirmam nada sobre a agenda. Trocar a grade inteira
         * por barras cinzas tiraria a forma da página para devolvê-la meio
         * segundo depois — e o `aria-busy` abaixo é o que conta a mesma coisa a
         * quem não vê o esqueleto.
         */}
        <div
          className={`${styles.grade} ${vista === "semana" ? styles.gradeSemana : ""}`}
          aria-busy={grade.carregando || undefined}
        >
          {DOW_MINI_UTEIS.map((d) => (
            <div key={d} className={styles.gradeHead}>
              {d}
            </div>
          ))}

          {celulas.map((d) => {
            const iso = toISO(d);
            const doMes = vista === "semana" || d.getMonth() === janela.ini.getMonth();
            const isHoje = iso === toISO(hoje);
            const eventos = porDia[iso] ?? [];
            return (
              <div
                key={iso}
                className={`${styles.dia} ${doMes ? "" : styles.diaFora} ${
                  isHoje ? styles.diaHoje : ""
                } ${diaAlvo === iso ? styles.diaAlvo : ""}`}
                // Toda célula da grade é dia útil por construção (a grade tem
                // cinco colunas), então não há o que barrar aqui: o bloqueio de
                // fim de semana está no desenho, não numa condição.
                onDragOver={(e) => {
                  if (!arrastando) return;
                  e.preventDefault();
                  if (diaAlvo !== iso) setDiaAlvo(iso);
                }}
                onDrop={() => void soltarNoDia(iso)}
              >
                <div className={styles.diaNum}>
                  {d.getDate()}
                  {isHoje && <span className={styles.hojeTag}>hoje</span>}
                </div>
                {eventos.map((it) => {
                  const dono =
                    it.tipo === "prazo" && it.ref.assignee
                      ? it.ref.assignee
                      : null;
                  const nomeDono = dono
                    ? (usersMap[dono]?.name ?? dono)
                    : "";
                  return (
                    <button
                      key={chaveItem(it)}
                      className={`${styles.chip} ${
                        it.tipo === "reuniao"
                          ? styles.chipReuniao
                          : styles.chipPrazo
                      } ${arrastando?.chave === chaveItem(it) ? styles.itemSaindo : ""}`}
                      onClick={() => abrir(it)}
                      onMouseEnter={(e) => pairou(it, e.currentTarget)}
                      onMouseLeave={saiu}
                      onFocus={(e) => previaNoFoco(it, e.currentTarget)}
                      onBlur={fecharPrevia}
                      aria-describedby={
                        chavePrevia === chaveItem(it)
                          ? "previa-cronograma"
                          : undefined
                      }
                      {...propsDeArraste(it)}
                    >
                      <span className={styles.chipTitulo}>{it.title}</span>
                      {/* Reunião NÃO ganha rosto aqui. O único e-mail que ela
                          tem é o de quem mandou o áudio, e pintá-lo no lugar
                          reservado ao responsável faria o calendário afirmar
                          que alguém responde pela reunião — coisa que reunião
                          não tem. Quem enviou aparece na prévia, escrito.

                          E SEM `title`. O nome caberia ali, mas o `title` do
                          navegador aparece por volta de um segundo — depois de
                          a prévia já ter aberto aos 320ms com o mesmo nome
                          escrito por extenso. Seriam duas caixas de texto
                          sobrepostas dizendo a mesma coisa, e a nativa não tem
                          como ser posicionada para não cobrir a outra. Nos
                          aparelhos sem hover as duas somem juntas, então não há
                          nada que o `title` cubra sozinho. */}
                      {dono && (
                        <Avatar
                          className={styles.chipAvatar}
                          pessoa={autorDoRegistro(
                            dono,
                            nomeDono,
                            usersMap[dono],
                          )}
                          size={17}
                          alt=""
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {grade.erro ? (
          <ErrorState error={grade.erro} onRetry={reabrirGrade} />
        ) : grade.carregando ? (
          <SkeletonRow rows={3} texto="Carregando reuniões e prazos…" />
        ) : noPeriodo === 0 ? (
          <EmptyState
            icon="calendar"
            title="Nada marcado neste período"
            description={
              <>
                Nenhuma reunião e nenhum prazo entre estas datas. Prazos
                aparecem aqui quando uma demanda do Kanban ganha data de
                entrega.
              </>
            }
          />
        ) : null}
      </div>

      {previa && (
        <Previa
          item={previa.item}
          ancora={previa.ancora}
          hoje={hoje}
          usersMap={usersMap}
        />
      )}

      {/* A demanda abre o modal COMPLETO, o mesmo do quadro — quem chegou aqui
          pelo prazo quer mexer na demanda, e mandá-lo ao Kanban procurar o card
          de novo era o atrito que fazia o calendário ser só um cartaz. */}
      {demandaAberta && (
        <CardModal
          state={{ mode: "edit", card: demandaAberta }}
          sector={demandaAberta.sector}
          columns={colunasDaDemanda}
          canManage={
            (profile.role === "admin" || profile.role === "gestor") &&
            sectors.includes(demandaAberta.sector)
          }
          actorEmail={profile.email}
          activeUsers={activeUsers}
          usersMap={usersMap}
          solicitantes={solicitantes}
          reqSetores={reqSetores}
          tagsDoQuadro={tagsDoQuadro}
          demandasDoQuadro={demandasDoQuadro}
          rotulos={rotulosDaDemanda}
          onClose={() => setAberto(null)}
        />
      )}

      {reuniaoAberta && (
        <ReuniaoModal
          reuniao={reuniaoAberta}
          usersMap={usersMap}
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}

/**
 * A prévia que aparece ao pairar sobre um item.
 *
 * ELA NÃO RECEBE PONTEIRO (`pointer-events: none` no CSS). É o que resolve de
 * uma vez os dois riscos de uma prévia grande: ela não rouba o clique de quem
 * ia abrir o item, e cobrir o chip não interrompe o próprio hover que a
 * sustenta. Não há nada clicável dentro dela — é leitura — então a tolerância
 * de saída não precisa deixar o mouse "entrar" na prévia; precisa só não piscar
 * entre um chip e outro, e disso cuida o atraso de fechamento.
 *
 * Mora num portal porque `.scroll` tem `overflow: auto`: dentro dele, qualquer
 * caixa que passe da borda da grade é cortada.
 */
function Previa({
  item,
  ancora,
  hoje,
  usersMap,
}: {
  item: Item;
  ancora: Ancora;
  hoje: Date;
  usersMap: Record<string, UserProfile>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /**
   * Encaixa a prévia ao lado do chip sem deixá-la vazar da tela.
   *
   * `useLayoutEffect` e escrita direta no `style` do nó: a medida só existe
   * depois de o conteúdo ser desenhado (a altura varia com checklist, links e
   * comentários), e guardá-la em estado renderizaria a prévia duas vezes — a
   * primeira no canto errado, visível por um quadro. Escrever antes da pintura
   * não pisca, e não é `setState` dentro de efeito.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margem = 10;
    const { width: w, height: h } = el.getBoundingClientRect();
    // À direita do chip por padrão; à esquerda quando não cabe — que é o caso
    // da última coluna da grade.
    let left = ancora.right + margem;
    if (left + w > window.innerWidth - margem) left = ancora.left - w - margem;
    if (left < margem) left = Math.max(margem, window.innerWidth - w - margem);
    // Alinhada pelo topo do chip, e subida o quanto for preciso quando a última
    // linha da grade não deixa a prévia inteira caber embaixo.
    let top = ancora.top - 4;
    if (top + h > window.innerHeight - margem) {
      top = window.innerHeight - h - margem;
    }
    if (top < margem) top = margem;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // Origem no lado de onde ela nasceu: a prévia que abriu à esquerda cresce
    // da direita para a esquerda, e não do meio.
    el.style.transformOrigin =
      left < ancora.left ? "right center" : "left center";
  }, [ancora, item]);

  const d = parseISO(item.date);
  const dataLonga = `${d.getDate()} de ${MES_LONGO[d.getMonth()]} de ${d.getFullYear()}`;

  return (
    <OverlayPortal>
      <div
        ref={ref}
        id="previa-cronograma"
        role="tooltip"
        className={styles.previa}
      >
        <div className={styles.previaTopo}>
          <span
            className={`${styles.tag} ${
              item.tipo === "reuniao" ? styles.tagReuniao : styles.tagPrazo
            }`}
          >
            {item.tipo === "reuniao" ? "Reunião" : "Prazo de demanda"}
          </span>
          {item.tipo === "reuniao" ? (
            <span className={styles.tagNeutra}>
              {MEETING_STATUS_LABEL[item.ref.status] ?? item.ref.status}
            </span>
          ) : (
            <PrazoTag due={item.date} hoje={hoje} />
          )}
        </div>

        <h4 className={styles.previaTitulo}>{item.title}</h4>

        <dl className={styles.previaLinhas}>
          <Linha rotulo="Setor" valor={item.sector} />
          <Linha rotulo="Data" valor={dataLonga} />
          {item.tipo === "reuniao" ? (
            <>
              {item.ref.durationMin ? (
                <Linha rotulo="Duração" valor={`${item.ref.durationMin} min`} />
              ) : null}
              <Linha
                rotulo="Enviada por"
                valor={
                  usersMap[item.ref.createdBy ?? ""]?.name ??
                  item.ref.createdBy ??
                  "—"
                }
              />
              {item.ref.participants?.length ? (
                <Linha
                  rotulo="Participantes"
                  valor={`${item.ref.participants.length}`}
                />
              ) : null}
            </>
          ) : (
            <>
              <Linha
                rotulo="Responsável"
                valor={
                  item.ref.assignee
                    ? (usersMap[item.ref.assignee]?.name ?? item.ref.assignee)
                    : "Ninguém"
                }
                avatar={item.ref.assignee ?? undefined}
                usersMap={usersMap}
              />
              <Linha rotulo="Solicitante" valor={item.ref.requester || "—"} />
              <Linha
                rotulo="Etapa"
                valor={item.col?.title ?? "—"}
                cor={item.col?.color}
              />
              <Linha
                rotulo="Prioridade"
                valor={
                  PRIORITY_LABEL[item.ref.priority ?? "media"] ?? "Média"
                }
                cor={PRIORITY_COLOR[item.ref.priority ?? "media"]}
              />
              <Linha
                rotulo="Tipo"
                valor={
                  DEMAND_TYPE_LABEL[item.ref.type ?? "implementacao"] ?? "—"
                }
              />
            </>
          )}
        </dl>

        {item.tipo === "prazo" && <Contagens card={item.ref} />}
      </div>
    </OverlayPortal>
  );
}

/** Uma linha da prévia. `avatar` só existe no responsável — é o rosto dele. */
function Linha({
  rotulo,
  valor,
  cor,
  avatar,
  usersMap,
}: {
  rotulo: string;
  valor: string;
  cor?: string;
  avatar?: string;
  usersMap?: Record<string, UserProfile>;
}) {
  return (
    <div>
      <dt>{rotulo}</dt>
      <dd style={cor ? { color: cor } : undefined}>
        {avatar && usersMap && (
          <Avatar
            pessoa={autorDoRegistro(
              avatar,
              usersMap[avatar]?.name || avatar,
              usersMap[avatar],
            )}
            size={16}
            alt=""
          />
        )}
        {valor}
      </dd>
    </div>
  );
}

/**
 * Checklist, links e comentários — em número, e só quando existem.
 *
 * Zero de tudo é o caso comum de uma demanda recém-aberta, e três selos zerados
 * ocupariam a última linha da prévia dizendo que não há nada para contar.
 */
function Contagens({ card }: { card: Card }) {
  const itens = card.checklist ?? [];
  const feitos = itens.filter((i) => i.done).length;
  const links = card.links?.length ?? 0;
  const comentarios = card.comments?.length ?? 0;
  if (!itens.length && !links && !comentarios) return null;
  return (
    <div className={styles.previaContagens}>
      {itens.length > 0 && (
        <span>
          <Icon name="check" size={13} />
          {feitos}/{itens.length}
        </span>
      )}
      {links > 0 && (
        <span>
          <Icon name="link" size={13} />
          {links}
        </span>
      )}
      {comentarios > 0 && (
        <span>
          <Icon name="chat" size={13} />
          {comentarios}
        </span>
      )}
    </div>
  );
}

/**
 * Espiada rápida na reunião.
 *
 * Só a reunião mora aqui. O prazo saiu deste modal quando o calendário passou a
 * abrir o modal COMPLETO da demanda: manter as duas metades vivas deixaria
 * pronto, para sempre, um segundo caminho mais pobre até a mesma demanda — e
 * ninguém saberia dizer qual dos dois deveria abrir. A reunião fica porque ela
 * não tem editor próprio: o que dá para fazer com ela é ler e ir aos
 * Relatórios, que é exatamente o que esta tela oferece.
 */
function ReuniaoModal({
  reuniao,
  usersMap,
  onClose,
}: {
  reuniao: Meeting;
  usersMap: Record<string, UserProfile>;
  onClose: () => void;
}) {
  const d = parseISO(reuniao.date);
  const dataLonga = `${d.getDate()} de ${MES_LONGO[d.getMonth()]} de ${d.getFullYear()}`;

  return (
    <Modal
      onClose={onClose}
      ariaLabel="Detalhe da reunião"
      overlayClassName={styles.overlay}
      className={styles.modal}
      width={460}
    >
      <div className={styles.modalHead}>
        <span className={`${styles.tag} ${styles.tagReuniao}`}>Reunião</span>
        <span className={styles.tagNeutra}>
          {MEETING_STATUS_LABEL[reuniao.status] ?? reuniao.status}
        </span>
        <div style={{ flex: 1 }} />
        <button className={styles.fechar} onClick={onClose} aria-label="Fechar">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className={styles.modalBody}>
        <h3>{reuniao.title}</h3>
        <dl className={styles.detalhes}>
          <div>
            <dt>Setor</dt>
            <dd>{reuniao.sector}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{dataLonga}</dd>
          </div>
          {reuniao.durationMin ? (
            <div>
              <dt>Duração</dt>
              <dd>{reuniao.durationMin} min</dd>
            </div>
          ) : null}
          <div>
            <dt>Enviada por</dt>
            <dd>
              {usersMap[reuniao.createdBy ?? ""]?.name ??
                reuniao.createdBy ??
                "—"}
            </dd>
          </div>
        </dl>

        <Link className={styles.irPara} href="/relatorios">
          <Icon name="link" size={15} />
          Abrir em Relatórios IA
        </Link>
      </div>
    </Modal>
  );
}

function PrazoTag({ due, hoje }: { due: string; hoje: Date }) {
  const n = daysBetween(due, hoje);
  if (n > 0)
    return (
      <span className={styles.tagVencida}>
        vencida há {n} {n === 1 ? "dia" : "dias"}
      </span>
    );
  if (n === 0) return <span className={styles.tagHoje}>vence hoje</span>;
  const faltam = -n;
  return (
    <span className={faltam <= 3 ? styles.tagHoje : styles.tagNeutra}>
      em {faltam} {faltam === 1 ? "dia" : "dias"}
    </span>
  );
}
