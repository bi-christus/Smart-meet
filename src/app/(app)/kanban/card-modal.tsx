"use client";

/**
 * O formulário da demanda — criar e editar.
 *
 * Saiu de `page.tsx` quando o arquivo passou de 3300 linhas. Nada além do
 * endereço mudou: as mesmas props, os mesmos hooks na mesma ordem.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  camposMudados,
  mesmoValor,
  resumoDosCampos,
  type Rascunho,
} from "@/lib/rascunho-core";
import {
  garantirSetorSolicitante,
  garantirSolicitante,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
// A regra de "para onde aponta o pedido" e "já existe um?" mora no core puro,
// que é o mesmo que o quadro lê. Duas leituras do campo seriam duas definições
// de pedido válido, e elas divergiriam no primeiro documento pela metade.
import { colunaDeConclusao, temPedido } from "@/lib/conclusao-core.ts";
// A conta de quem pode mover, para onde, e o que a mudança arrasta junto mora
// num core puro com teste — não neste arquivo. Aqui só passa a escrita e o que
// se mostra antes dela.
import {
  destinosPossiveis,
  planoDaMudanca,
  type ColunaSimples,
  type PessoaQueMove,
} from "@/lib/mover-setor-core.ts";
import {
  createCard,
  updateCard,
  moverParaLixeira,
  moverDeSetor,
  pedirConclusao,
  subscribeColumnsForSectors,
  addComment,
  editComment,
  removeComment,
  PRIORITY_LABEL,
  DEMAND_TYPES,
  DEMAND_TYPE_LABEL,
  DEMAND_TYPE_COLOR,
  tagColor,
  type Card,
  type CardLink,
  type TagRef,
  type CardInput,
  type Priority,
  type ChecklistItem,
  type ColumnDoc,
  type DemandType,
  type Comment,
} from "@/lib/kanban";
import {
  normalizarUrl,
  dominioDe,
  seloDoLink,
  monogramaDe,
  rotuloDoLink,
  jaTem,
  novoIdLink,
} from "@/lib/links-core";
import { aplicarIcone, iconeDoLink } from "@/lib/icones-core";
import {
  MES_LONGO,
  ehFimDeSemanaISO,
  proximoDiaUtilISO,
  rotuloDoDiaISO,
} from "@/lib/datas";
import { conferirTag, normalizarTag, semAcento } from "@/lib/tags-core";
import { codigoDe, fraseDeFalha } from "@/lib/erro-ui-core";
import { diffCard, mudancasIniciais, type Rotulos } from "@/lib/historico-core";
import { subscribeDimensoes, type Dimensao } from "@/lib/dimensoes";
import { type UserProfile } from "@/lib/users";
import { Icon } from "@/components/icons";
import { IconePicker } from "@/components/icone-picker";
import { Avatar } from "@/components/avatar";
import { Select, type SelectOption } from "@/components/select";
import { Combobox } from "@/components/combobox";
import { Modal } from "@/components/modal";
import {
  KNOWN_PRIORITIES,
  PRIORITY_COLOR,
  autorDoRegistro,
  parseDue,
  relTime,
} from "./comum";
import styles from "./kanban.module.css";

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
}

/**
 * De onde veio cada sugestão do "#".
 *
 * O grupo não muda o que é gravado — tudo vira tag de texto. Ele existe para
 * quem está escolhendo saber o que está escolhendo: "Infra" pode ser a tag que
 * o quadro já usa, o setor solicitante do cadastro, ou nenhum dos dois.
 */
type GrupoSugestao = "tag" | "setor" | "demanda";
type Sugestao = {
  valor: string;
  grupo: GrupoSugestao;
  detalhe?: string;
  /** Presente em setor e demanda: é o que sobrevive ao rename do alvo. */
  ref?: TagRef;
};
const GRUPO_ROTULO: Record<GrupoSugestao, string> = {
  tag: "Tags do quadro",
  setor: "Setores solicitantes",
  demanda: "Demandas do quadro",
};

/**
 * A comparação de tag saiu daqui e mora em `tags-core`, uma no app inteiro.
 *
 * Enquanto era local, o menu de sugestões escondia "Infra" por já existir no
 * card e o Enter criava "infra" assim mesmo — duas respostas para a mesma
 * pergunta, e quem desempatava era a velocidade de digitação.
 */

function toStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function todayStr(): string {
  return toStr(new Date());
}
function plusDays(dateStr: string, n: number): string {
  const d = parseDue(dateStr);
  d.setDate(d.getDate() + n);
  return toStr(d);
}
/**
 * "13 de setembro" — por extenso, e não 13/09.
 *
 * A frase que recusa um sábado é lida uma vez, no meio de um formulário; ali o
 * número seco obriga quem lê a traduzir o mês de volta para saber de que dia se
 * está falando. Nos chips do card, onde a data aparece dezenas de vezes, o
 * curto continua sendo o certo — são leituras diferentes.
 */
function diaEMes(iso: string): string {
  const d = parseDue(iso);
  return `${d.getDate()} de ${MES_LONGO[d.getMonth()]}`;
}
/**
 * "13 de setembro é um sábado. O prazo mais próximo é segunda-feira, 15 de
 * setembro."
 *
 * Duas orações porque são duas informações: por que está recusado, e o que
 * fazer. Dizer só "escolha um dia útil" manda a pessoa contar no calendário —
 * e o `<input type="date">` não sabe desabilitar sábado e domingo, então ela
 * contaria de novo no clique seguinte.
 */
function fraseFimDeSemana(campo: "inicio" | "prazo", iso: string): string {
  const alvo = campo === "inicio" ? "O início" : "O prazo";
  const util = proximoDiaUtilISO(iso);
  return (
    `${diaEMes(iso)} é um ${rotuloDoDiaISO(iso)}. ` +
    `${alvo} mais próximo é ${rotuloDoDiaISO(util)}, ${diaEMes(util)}.`
  );
}

/**
 * Identidade de um comentário na tela.
 *
 * O `id` só existe nos comentários publicados pelo modal; os que vieram da
 * ingestão de reunião e os mais antigos nasceram sem ele — daí o autor mais a
 * data como reserva, que é única na prática (dois comentários da mesma pessoa
 * no mesmo milissegundo não acontecem).
 */
function chaveComentario(c: Comment): string {
  return c.id ?? `${c.author}|${c.at}`;
}

/** Campo de texto que substitui o select enquanto se cadastra um nome novo. */
function NovoCadastro({
  valor,
  onChange,
  onSalvar,
  salvando,
  placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  onSalvar: () => void | Promise<void>;
  salvando: boolean;
  placeholder: string;
}) {
  return (
    <div className={styles.novoCadastroLinha}>
      <input
        className={styles.input}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void onSalvar();
          }
        }}
        placeholder={placeholder}
        maxLength={80}
        autoFocus
      />
      <button
        type="button"
        className={styles.novoCadastroOk}
        onClick={() => void onSalvar()}
        disabled={salvando || !valor.trim()}
        aria-label="Cadastrar"
      >
        <Icon name="check" size={13} />
      </button>
    </div>
  );
}

/**
 * Igualdade tolerante para decidir se um campo do formulário mudou.
 *
 * `undefined`, `null` e `""` contam como o mesmo nada: um card antigo sem
 * `description` não deve gerar escrita só porque o formulário devolve string
 * vazia. Arrays e objetos (tags, checklist) comparam por conteúdo, e a ordem
 * conta — reordenar a checklist É uma mudança.
 */
export type EditState =
  /**
   * `dimensaoId` e `subdimensaoId` chegam preenchidos quando a demanda nasce de
   * um lugar da árvore — o botão "Criar demanda aqui" da aba Dimensões. É o que
   * evita a pergunta idiota: quem clicou DENTRO da subdimensão já disse onde a
   * demanda entra, e o formulário abrindo vazio faria ele dizer de novo.
   *
   * Opcionais porque o Kanban não sabe nada de árvore: lá o campo abre no
   * padrão, como qualquer outro.
   */
  | {
      mode: "new";
      columnId: string;
      dimensaoId?: string | null;
      subdimensaoId?: string | null;
    }
  | { mode: "edit"; card: Card }
  | null;

export function CardModal({
  state,
  sector,
  columns,
  canManage,
  concluiDireto,
  entregues,
  pessoa,
  setoresDaPessoa,
  actorEmail,
  activeUsers,
  usersMap,
  solicitantes,
  reqSetores,
  tagsDoQuadro,
  demandasDoQuadro,
  rotulos,
  onClose,
}: {
  state: NonNullable<EditState>;
  sector: string;
  columns: ColumnDoc[];
  /** Quem manda a demanda para a lixeira. A regra do Firestore nega o resto. */
  canManage: boolean;
  /**
   * Quem dá a demanda por concluída sem pedir a ninguém.
   *
   * PROP SEPARADA de `canManage`, e não a mesma reaproveitada, embora hoje as
   * duas respondam igual para todo mundo. São perguntas diferentes —
   * "administra o quadro?" e "conclui sozinho?" — e no dia em que uma delas
   * mudar, reaproveitar teria mudado a outra junto, em silêncio, num lugar que
   * ninguém iria olhar. Quem responde é `podeConcluirDireto`, no core.
   */
  concluiDireto: boolean;
  /**
   * As etapas em que a demanda conta como entregue, por `colId`.
   *
   * Vem pronta de `colunasEntregues` (`kanban-columns.ts`), que é a regra única
   * do app — o modal não recalcula "isto é conclusão?" a partir do nome da
   * coluna, senão passariam a existir duas respostas para a mesma pergunta.
   */
  entregues: ReadonlySet<string>;
  /**
   * Quem está mexendo — papel e setores. Só para a mudança de setor.
   *
   * O modal já recebia `actorEmail`, que basta para assinar o que se grava; a
   * mudança de setor precisa de mais, porque a pergunta dela não é "quem é
   * você?" e sim "você enxerga os dois lados deste movimento?".
   */
  pessoa: PessoaQueMove;
  /**
   * Os setores que a pessoa enxerga — para admin, o cadastro inteiro.
   *
   * É a mesma lista que a barra de setores do quadro desenha
   * (`useSetoresDaPessoa`), e é dela que saem os destinos possíveis. Oferecer um
   * destino fora dela seria oferecer um erro: a regra do Firestore recusaria a
   * escrita, e o que chegaria na tela é "sem permissão" sobre uma opção que a
   * própria tela apresentou.
   */
  setoresDaPessoa: string[];
  actorEmail: string;
  activeUsers: UserProfile[];
  usersMap: Record<string, UserProfile>;
  solicitantes: Solicitante[];
  reqSetores: SolicitanteSetor[];
  /** tags já usadas no quadro, da mais usada para a menos, com a contagem */
  tagsDoQuadro: { tag: string; n: number }[];
  /** demandas do quadro, para citar uma existente pelo título */
  demandasDoQuadro: { id: string; title: string; columnId: string }[];
  /** como o histórico traduz id em nome, na hora de gravar */
  rotulos: Rotulos;
  onClose: () => void;
}) {
  const isNew = state.mode === "new";
  const card = state.mode === "edit" ? state.card : null;

  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const [columnId, setColumnId] = useState(
    state.mode === "new" ? state.columnId : state.card.columnId,
  );
  const [type, setType] = useState<DemandType>(card?.type ?? "implementacao");
  const [priority, setPriority] = useState<Priority>(card?.priority ?? "media");
  const [assignee, setAssignee] = useState(card?.assignee ?? "");
  const [requester, setRequester] = useState(card?.requester ?? "");
  const [criando, setCriando] = useState<null | "setor" | "pessoa">(null);
  const [novoNome, setNovoNome] = useState("");
  const [salvandoCadastro, setSalvandoCadastro] = useState(false);
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);
  const [requesterSector, setRequesterSector] = useState(
    card?.requesterSector ?? "",
  );
  const [dimensaoId, setDimensaoId] = useState(
    card?.dimensaoId ?? (state.mode === "new" ? (state.dimensaoId ?? "") : ""),
  );
  const [subdimensaoId, setSubdimensaoId] = useState(
    card?.subdimensaoId ??
      (state.mode === "new" ? (state.subdimensaoId ?? "") : ""),
  );

  /**
   * A árvore do setor, assinada AQUI e não recebida por prop.
   *
   * Dois lugares abrem este modal — o quadro e a aba Dimensões —, e nenhum dos
   * dois precisa do cadastro para desenhar a si mesmo do jeito que precisaria
   * para alimentar esta prop. Passá-lo obrigaria as duas telas a assinar a
   * coleção o tempo todo por causa de um seletor que só existe enquanto o modal
   * está aberto; aqui, o listener nasce e morre com ele.
   *
   * `[]` inicial e não `undefined`: enquanto a resposta não chega, o seletor
   * mostra "— Sem dimensão —" e nada mais, que é o estado honesto. O caso do
   * falso vazio que este projeto caça é a tela dizer "não há nenhuma"; um
   * seletor ainda sem opções não afirma isso.
   */
  const [dims, setDims] = useState<Dimensao[]>([]);
  useEffect(
    () => subscribeDimensoes(sector, setDims, (e) => console.error("[dimensoes]", e)),
    [sector],
  );

  const dimAtual = dims.find((d) => d.id === dimensaoId);
  /**
   * Trocar de dimensão zera a subdimensão, e é obrigatório que zere: o id da
   * subdimensão só é único DENTRO da dimensão, então mantê-lo apontaria para
   * uma gaveta de outra árvore — ou, pior, para uma que existe com o mesmo id e
   * outro significado.
   */
  function trocarDimensao(novo: string) {
    setDimensaoId(novo);
    setSubdimensaoId("");
  }

  /** id → nome, para o histórico gravar texto e não identificador. */
  function nomesDaArvore(dId?: string | null, sId?: string | null) {
    const d = dId ? dims.find((x) => x.id === dId) : undefined;
    const sub = d && sId ? d.subs.find((x) => x.id === sId) : undefined;
    return {
      dimensaoNome: d?.nome ?? null,
      subdimensaoNome: sub?.nome ?? null,
    };
  }
  /**
   * Início e prazo já nascem em dia útil.
   *
   * Sete dias a partir de uma quarta caem numa quarta, mas a partir de um
   * sábado caem num sábado — e o formulário abriria cobrando de quem o abriu
   * uma data que ele mesmo escolheu. O `todayStr()` do início tem o mesmo
   * problema um dia por semana: quem abre o Kanban no sábado.
   */
  const [startDate, setStartDate] = useState(
    card?.startDate ?? (isNew ? proximoDiaUtilISO(todayStr()) : ""),
  );
  const [due, setDue] = useState(
    card?.due ?? (isNew ? proximoDiaUtilISO(plusDays(todayStr(), 7)) : ""),
  );
  /**
   * As datas que já estavam gravadas quando o modal abriu.
   *
   * Congeladas na abertura, e não lidas de `card` a cada render, porque o card
   * chega de uma assinatura e pode ser reescrito por outra pessoa com o modal
   * aberto: o que define "herdado" é o que ESTA pessoa encontrou ao abrir, não
   * o que está no banco agora. `useState` com inicializador e não `useRef` — a
   * comparação acontece durante o render, e ler `.current` ali é justamente o
   * que o React proíbe.
   */
  const [dataAoAbrir] = useState(() => ({
    inicio: card?.startDate ?? "",
    prazo: card?.due ?? "",
  }));
  /**
   * Demanda pode nascer sem prazo — e isso é um estado, não um esquecimento.
   *
   * Quando o pedido chega antes de a data existir, exigir um prazo faz alguém
   * inventar um, e prazo inventado vira atraso falso no relatório do gestor.
   * Marcado aqui, o card sai como "sem prazo definido" em toda a leitura.
   */
  const [semPrazo, setSemPrazo] = useState(isNew ? false : !card?.due);
  const [tags, setTags] = useState<string[]>(card?.tags ?? []);
  /** Quais tags são referência. Anda junto de `tags`, ligada pelo texto. */
  const [tagRefs, setTagRefs] = useState<TagRef[]>(card?.tagRefs ?? []);
  const [newTag, setNewTag] = useState("");
  /** Escape fecha a lista de tags sem apagar o que já foi digitado. */
  const [menuTagFechado, setMenuTagFechado] = useState(false);
  const [tagAtiva, setTagAtiva] = useState(0);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() =>
    (card?.checklist ?? []).map((it) => ({ ...it, id: it.id ?? uid() })),
  );
  const [newItem, setNewItem] = useState("");
  /**
   * Links da demanda.
   *
   * Só entram normalizados: guardar o texto cru deixaria "docs.google.com/…"
   * sem esquema — que o navegador lê como caminho relativo e abre dentro do
   * próprio Smart Meeting, num 404. Quem digita não vê essa diferença.
   */
  const [links, setLinks] = useState<CardLink[]>(() => card?.links ?? []);
  const [novoLink, setNovoLink] = useState("");
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>(card?.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  /** Qual comentário está sendo reescrito (chave), e o texto em edição. */
  const [comentarioEmEdicao, setComentarioEmEdicao] = useState<string | null>(
    null,
  );
  const [textoEditado, setTextoEditado] = useState("");
  /** Comentário sendo apagado — para o botão parar de convidar ao duplo clique. */
  const [comentarioSaindo, setComentarioSaindo] = useState<string | null>(null);
  /**
   * Trava de gravação de comentário.
   *
   * `useRef` e não estado: entre o Ctrl+Enter e o clique em fechar não há
   * re-render que atualize `posting` a tempo, e sem esta trava o mesmo texto
   * era publicado duas vezes.
   */
  const gravandoComentario = useRef(false);
  const [saving, setSaving] = useState(false);
  /** A exclusão pedida, esperando o segundo clique. */
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  /** A saída pedida com alterações por salvar, esperando a decisão. */
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  /** O pedido de conclusão em curso, para o botão não ser clicado duas vezes. */
  const [pedindo, setPedindo] = useState(false);
  /** O painel de mudança de setor, aberto, e o destino escolhido nele. */
  const [movendo, setMovendo] = useState(false);
  const [destino, setDestino] = useState("");
  const [transferindo, setTransferindo] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Para onde esta demanda pode ir, na conta do core. */
  const destinos = card
    ? destinosPossiveis(pessoa, card.sector, setoresDaPessoa)
    : [];

  /**
   * As etapas do setor de destino, assinadas só quando há um destino escolhido.
   *
   * `undefined` é "ainda não respondeu" e `[]` é "respondeu e está vazio" — os
   * dois estados que AGENTS.md §3 manda separar, e aqui a diferença muda o que
   * a tela diz: com `undefined` ela espera, com `[]` ela explica que aquele
   * quadro ainda não tem etapa nenhuma. Um `[]` inicial faria o resumo afirmar
   * "vai para a entrada" antes de saber qual é a entrada.
   */
  const [colsLidas, setColsLidas] = useState<{
    setor: string;
    cols: ColunaSimples[];
  } | null>(null);
  useEffect(() => {
    if (!destino) return;
    return subscribeColumnsForSectors(
      [destino],
      (cols) =>
        setColsLidas({
          setor: destino,
          cols: cols.map((c) => ({ colId: c.colId, title: c.title })),
        }),
      (e) => console.error("[colunas do destino]", e),
    );
  }, [destino]);
  /**
   * O setor viaja JUNTO da resposta, e a comparação acontece no render.
   *
   * A forma óbvia — zerar o estado dentro do efeito ao trocar de destino — é um
   * `setState` síncrono em efeito, que causa render em cascata e que o lint
   * deste projeto reprova com razão. Guardando de quem é a resposta, trocar de
   * destino faz a lista velha deixar de casar no mesmo render em que a troca
   * acontece: nunca há um quadro exibindo as etapas do setor errado.
   */
  const colsDestino =
    colsLidas && colsLidas.setor === destino ? colsLidas.cols : undefined;

  const plano =
    card && destino && colsDestino?.length
      ? planoDaMudanca({
          pessoa,
          card,
          tituloDaColunaAtual:
            columns.find((c) => c.colId === card.columnId)?.title ?? "",
          destino,
          colsDestino,
          setoresDoResponsavel: card.assignee
            ? (usersMap[card.assignee]?.sectors ?? null)
            : null,
          /**
           * ZERO, e não `Date.now()`, porque isto é a PRÉVIA.
           *
           * O `agora` só alimenta `enteredAt` e `order`, que a prévia não
           * mostra — ela responde "para que etapa vai, e o que se perde". Ler o
           * relógio durante o render é impureza (o lint reprova, e com razão:
           * dois renders do mesmo estado dariam resultados diferentes). A hora
           * de verdade é lida em `mover()`, no instante da escrita, que é o
           * único momento em que ela significa alguma coisa.
           */
          agora: 0,
        })
      : null;

  /**
   * Para onde o botão "Solicitar conclusão" aponta, e se já há um pedido.
   *
   * A COLUNA vem de `colunaDeConclusao`, que escolhe a ÚLTIMA etapa de entrega
   * na ordem do quadro — quem clica no botão não escolheu etapa nenhuma, então
   * a escolha tem de ser a menos surpreendente. Quem arrasta escolhe com o
   * gesto, e aí é a coluna em que soltou que vale.
   *
   * `columns` já vem na ordem do quadro (quem monta é a página, a partir de
   * `/columns` ordenado), e a ordem é o que decide qual é a última.
   */
  const alvoDaConclusao = colunaDeConclusao(
    columns.map((c) => c.colId),
    entregues,
  );
  const jaPediuConclusao = !!card && temPedido(card);
  /**
   * Qual campo travou o salvamento.
   *
   * Sem isto o aviso era só uma linha de 12px no rodapé: numa demanda com
   * checklist o modal passa da altura da tela, o título fica dez rolagens
   * acima — e ele nem parece um campo, é um texto grande sem moldura. O
   * usuário lia "informe um título", não achava título nenhum, e a demanda
   * não saía. Agora o campo é levado até os olhos, marcado, e o aviso some
   * sozinho assim que ele é corrigido.
   */
  const [campoErro, setCampoErro] = useState<
    null | "titulo" | "inicio" | "prazo"
  >(null);
  const tituloRef = useRef<HTMLInputElement>(null);
  const inicioRef = useRef<HTMLInputElement>(null);
  const prazoRef = useRef<HTMLInputElement>(null);

  /**
   * Data em fim de semana que ESTA edição não criou — ela já estava gravada.
   *
   * Existem demandas antigas com prazo em sábado, e a regra do dia útil chegou
   * depois delas. Barrar o salvamento aqui cobraria de quem abriu a demanda só
   * para trocar o responsável a correção de um campo que ele não tocou: a
   * pessoa não consegue salvar o que veio fazer até resolver um problema que
   * não é dela. Deixar passar calado, por outro lado, seria reintroduzir
   * exatamente o que a regra veio impedir. O meio-termo é este: a frase e o
   * conserto de um clique aparecem sempre, em tom de nota e não de recusa, mas
   * o botão Salvar continua funcionando. Assim que a pessoa MEXE na data, ela
   * deixa de ser herdada e passa a valer a regra inteira.
   */
  const inicioHerdado =
    !!startDate &&
    startDate === dataAoAbrir.inicio &&
    ehFimDeSemanaISO(startDate);
  const prazoHerdado =
    !semPrazo && !!due && due === dataAoAbrir.prazo && ehFimDeSemanaISO(due);

  const col = columns.find((c) => c.colId === columnId);
  const doneCount = checklist.filter((i) => i.done).length;
  const pct = checklist.length
    ? Math.round((doneCount / checklist.length) * 100)
    : 0;

  /**
   * A ETAPA DE CONCLUSÃO NÃO É OFERECIDA a quem não conclui direto.
   *
   * Sem isto, o operador teria dois caminhos para a mesma coisa e eles dariam
   * respostas diferentes: arrastar o card abriria o pedido, e escolher a etapa
   * aqui gravaria a conclusão. Um dos dois é o furo, e seria justamente o mais
   * silencioso — ninguém repara numa opção de lista.
   *
   * A etapa em que a demanda JÁ ESTÁ continua na lista mesmo assim. Ela é o
   * valor atual do campo: tirá-la faria o `Select` abrir mostrando outra coisa,
   * e salvar moveria a demanda sem ninguém ter pedido.
   */
  const columnOptions: SelectOption[] = columns
    .filter(
      (c) => concluiDireto || !entregues.has(c.colId) || c.colId === columnId,
    )
    .map((c) => ({
      value: c.colId,
      label: c.title,
      color: c.color,
    }));
  const typeOptions: SelectOption[] = DEMAND_TYPES.map((t) => ({
    value: t,
    label: DEMAND_TYPE_LABEL[t],
    color: DEMAND_TYPE_COLOR[t],
  }));
  const priorityOptions: SelectOption[] = KNOWN_PRIORITIES.map((p) => ({
    value: p,
    label: PRIORITY_LABEL[p],
    color: PRIORITY_COLOR[p],
  }));
  function userOptions(noneLabel: string, current: string): SelectOption[] {
    const opts: SelectOption[] = [{ value: "", label: noneLabel }];
    activeUsers.forEach((u) =>
      opts.push({ value: u.email, label: u.name || u.email, color: u.color }),
    );
    if (current && !activeUsers.some((u) => u.email === current)) {
      const u = usersMap[current];
      opts.push({
        value: current,
        label: (u?.name || current) + " (inativo)",
        color: u?.color,
      });
    }
    return opts;
  }

  // Solicitante e Setor solicitante vêm do CADASTRO (aba Admin), não dos
  // usuários — e são campos independentes: a pessoa não pertence a um setor,
  // então um não filtra nem limpa o outro.
  const reqSetorOptions: SelectOption[] = [
    { value: "", label: "— Não definido —" },
    ...reqSetores.map((s) => ({ value: s.name, label: s.name })),
  ];
  const solicOptions: SelectOption[] = (() => {
    const opts: SelectOption[] = [{ value: "", label: "— Não definido —" }];
    solicitantes.forEach((s) => opts.push({ value: s.name, label: s.name }));
    // valor legado (nome já apagado do cadastro) continua visível para não sumir
    if (requester && !solicitantes.some((s) => s.name === requester)) {
      opts.push({ value: requester, label: requester });
    }
    return opts;
  })();

  /**
   * Cadastra o setor ou o solicitante sem sair do formulário.
   *
   * Quem percebe que o nome não está na lista é quem está preenchendo a
   * demanda. Mandá-lo abrir o Admin e voltar significa, na prática, salvar a
   * demanda sem solicitante. Apagar continua só no Admin — remover um nome em
   * uso deixa cards apontando para algo que não existe mais.
   */
  async function salvarCadastro() {
    const n = novoNome.trim();
    if (!n) return;
    setErroCadastro(null);
    setSalvandoCadastro(true);
    try {
      if (criando === "setor") {
        const nome = await garantirSetorSolicitante(n, reqSetores);
        setRequesterSector(nome);
      } else {
        const nome = await garantirSolicitante(n, solicitantes);
        setRequester(nome);
      }
      setNovoNome("");
      setCriando(null);
    } catch (e) {
      setErroCadastro(
        e instanceof Error ? e.message : "Não foi possível cadastrar.",
      );
    } finally {
      setSalvandoCadastro(false);
    }
  }

  // --- tags: menção com "#" ---------------------------------------------
  //
  // O "#" abre o catálogo do quadro; o que vem depois filtra. Sem isso a mesma
  // tag nascia três vezes ("Smart", "smart", "Smart Meet") e o filtro por tag
  // deixava de encontrar metade das demandas.

  /** O que foi digitado depois do "#" — null quando não há menção aberta. */
  const buscaTag = newTag.trimStart().startsWith("#")
    ? newTag.trimStart().slice(1).trim()
    : null;

  const sugestoesTag = useMemo(() => {
    if (buscaTag === null) return [];
    const q = semAcento(buscaTag);
    // A comparação é toda sem acento e sem maiúscula: é o que impede "Infra",
    // "infra" e "INFRA" de virarem três tags diferentes no mesmo quadro.
    const usadas = new Set(tags.map(semAcento));
    const vistos = new Set<string>();

    /**
     * Filtra um grupo, tira o que já apareceu antes e corta no limite.
     *
     * `vistos` é marcado antes do corte de propósito: se uma tag ficou de fora
     * por limite, o setor de mesmo nome não pode entrar no lugar dela como se
     * fosse outra coisa — na hora de escolher, as duas dariam a mesma tag.
     */
    const pegar = (
      grupo: GrupoSugestao,
      brutos: { valor: string; detalhe?: string; ref?: TagRef }[],
      limite: number,
    ): Sugestao[] => {
      const out: Sugestao[] = [];
      for (const b of brutos) {
        const valor = b.valor.trim();
        const chave = semAcento(valor);
        if (!chave || usadas.has(chave) || vistos.has(chave)) continue;
        vistos.add(chave);
        if (q && !chave.includes(q)) continue;
        out.push({ ...b, valor, grupo });
      }
      // Quem começa com o que foi digitado vem antes de quem só contém: digitar
      // "s" tem de oferecer "Smart" antes de "Requisição do RH". `sort` é
      // estável, então dentro de cada grupo a ordem de origem continua valendo.
      if (q) {
        out.sort(
          (a, b) =>
            Number(semAcento(b.valor).startsWith(q)) -
            Number(semAcento(a.valor).startsWith(q)),
        );
      }
      return out.slice(0, limite);
    };

    const doQuadro = pegar(
      "tag",
      tagsDoQuadro.map((t) => ({
        valor: t.tag,
        detalhe: `${t.n} demanda${t.n === 1 ? "" : "s"}`,
      })),
      6,
    );
    const setores = pegar(
      "setor",
      reqSetores.map((s) => ({
        valor: s.name,
        ref: { tipo: "setor" as const, id: s.id, texto: s.name },
      })),
      6,
    );
    const demandas = pegar(
      "demanda",
      demandasDoQuadro
        // A demanda não se cita: sobraria uma tag com o próprio título.
        .filter((d) => d.id !== card?.id)
        .map((d) => ({
          valor: d.title,
          detalhe: columns.find((c) => c.colId === d.columnId)?.title,
          ref: { tipo: "demanda" as const, id: d.id, texto: d.title },
        })),
      6,
    );
    return [...doQuadro, ...setores, ...demandas];
  }, [
    buscaTag,
    tagsDoQuadro,
    reqSetores,
    demandasDoQuadro,
    columns,
    card?.id,
    tags,
  ]);

  /**
   * As tags do quadro que se PARECEM com o que está sendo digitado.
   *
   * O aviso avisa, e não recusa (ver o cabeçalho de `tags-core`): "Compras" e
   * "Compra" podem ser coisas diferentes num setor que ninguém aqui conhece, e
   * um campo que recusa o que a pessoa sabe ser certo ensina a contornar o
   * campo — que é como se ganha uma tag chamada "Compras2".
   *
   * Só aparece FORA da menção com "#": com o menu aberto, as sugestões já estão
   * na tela e o aviso repetiria embaixo o que a lista diz em cima.
   */
  const parecidasComOTexto = useMemo(() => {
    if (buscaTag !== null) return [];
    const c = conferirTag(newTag, tagsDoQuadro.map((x) => x.tag));
    if (!c.ok) return [];
    // O empate não vira aviso: `incluirTag` já grava a grafia existente sem
    // perguntar, e avisar sobre uma decisão que não é da pessoa é ruído.
    return c.mesma ? [] : c.parecidas.slice(0, 3);
  }, [newTag, buscaTag, tagsDoQuadro]);

  /** A grafia que o Enter vai gravar — é ela que o aviso cita entre aspas. */
  const conferirTagTexto = normalizarTag(newTag);

  /** A lista está na tela — mesmo vazia, ela explica que o Enter cria a tag. */
  const menuTagVisivel = buscaTag !== null && !menuTagFechado;
  /** Só quando há o que escolher é que as setas e o Enter mudam de comportamento. */
  const menuTagAberto = menuTagVisivel && sugestoesTag.length > 0;
  // O índice é preso à lista a cada render: apagar uma letra encurta as
  // sugestões, e um índice antigo escolheria a tag errada no Enter.
  const idxTag = Math.min(tagAtiva, sugestoesTag.length - 1);

  /**
   * Põe a tag no card — com a referência, quando ela veio da lista.
   *
   * A tag escrita à mão NÃO ganha referência, mesmo que o texto bata com uma
   * demanda existente: quem digitou "Portal" digitou uma palavra, e transformar
   * isso em vínculo faria a palavra mudar sozinha quando a demanda de nome
   * parecido fosse renomeada.
   */
  function incluirTag(t: string, ref?: TagRef) {
    /**
     * A grafia passa pela régua ANTES de entrar, mesmo vinda do menu.
     *
     * Vinda do menu ela já está normalizada, e a conferência é barata — mas o
     * caminho tem de ser um só. Enquanto o Enter normalizava e o clique não, a
     * mesma tag entrava de dois jeitos conforme o gesto de quem digitou.
     *
     * `mesma` ganha da digitada: quem escreveu "PORTAL DO ALUNO" num quadro que
     * já tem "Portal do aluno" escreveu a mesma tag, e gravar as duas grafias
     * partiria o filtro em duas metades para sempre. Isto não é palpite do app
     * sobre o que a pessoa quis — as duas TÊM a mesma chave, são a mesma tag.
     */
    const conferida = conferirTag(t, tagsDoQuadro.map((x) => x.tag));
    if (!conferida.ok) {
      setNewTag("");
      return;
    }
    const limpa = conferida.mesma ?? conferida.tag;
    if (tags.some((x) => semAcento(x) === semAcento(limpa))) {
      setNewTag("");
      return;
    }
    setTags((cur) => [...cur, limpa]);
    if (ref) setTagRefs((cur) => [...cur, { ...ref, texto: limpa }]);
    setNewTag("");
    setMenuTagFechado(false);
    setTagAtiva(0);
  }
  /** Enter fora do menu: cria a tag digitada, com ou sem o "#" na frente. */
  function addTag() {
    incluirTag(newTag);
  }
  function removeTag(t: string) {
    setTags((cur) => cur.filter((x) => x !== t));
    // A referência sai junto: uma `tagRef` sem a tag correspondente é lixo que
    // nada mais resolve, e voltaria a valer se alguém redigitasse o mesmo texto.
    setTagRefs((cur) => cur.filter((r) => r.texto !== t));
  }

  function teclaNaTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && menuTagAberto) {
      // O Escape do modal fecha o diálogo inteiro. Aqui ele só fecha a lista —
      // e o `stopPropagation` é o que impede a demanda de ser perdida.
      e.preventDefault();
      e.stopPropagation();
      setMenuTagFechado(true);
      return;
    }
    if (menuTagAberto && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const passo = e.key === "ArrowDown" ? 1 : -1;
      const n = sugestoesTag.length;
      setTagAtiva((cur) => (Math.min(cur, n - 1) + passo + n) % n);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (menuTagAberto)
        incluirTag(sugestoesTag[idxTag].valor, sugestoesTag[idxTag].ref);
      else addTag();
    }
  }
  function addItem() {
    const t = newItem.trim();
    if (!t) return;
    setChecklist((c) => [...c, { id: uid(), text: t, done: false }]);
    setNewItem("");
  }
  function toggleItem(i: number) {
    setChecklist((c) =>
      c.map((x, idx) => (idx === i ? { ...x, done: !x.done } : x)),
    );
  }
  function editItem(i: number, text: string) {
    setChecklist((c) => c.map((x, idx) => (idx === i ? { ...x, text } : x)));
  }
  function editItemDesc(i: number, desc: string) {
    setChecklist((c) => c.map((x, idx) => (idx === i ? { ...x, desc } : x)));
  }
  function removeItem(i: number) {
    setChecklist((c) => c.filter((_, idx) => idx !== i));
  }

  function addLink() {
    const url = normalizarUrl(novoLink);
    if (!url) {
      setErroLink(
        "Endereço inválido. Cole um link começando com http:// ou https://.",
      );
      return;
    }
    // O mesmo endereço duas vezes não é erro de quem cola — é o resultado
    // normal de colar de novo o que já estava lá. Recusar em silêncio pareceria
    // que o campo não funciona, então a recusa é dita.
    if (jaTem(links, url)) {
      setErroLink("Esse link já está na demanda.");
      return;
    }
    const agora = Date.now();
    setLinks((c) => [
      ...c,
      { id: novoIdLink(url, agora), url, addedBy: actorEmail, addedAt: agora },
    ]);
    setNovoLink("");
    setErroLink(null);
  }
  function removeLink(id: string) {
    setLinks((c) => c.filter((l) => l.id !== id));
  }
  /** O rótulo é de quem lê depois: "Planilha de custos" acha; a URL, não. */
  /**
   * O ícone escolhido — NO RASCUNHO, como o título ao lado.
   *
   * A aba Links grava direto no banco porque lá não existe rascunho: o card não
   * está aberto para edição. Aqui existe, e escrever no banco no clique faria a
   * troca do ícone escapar do Cancelar — a pessoa desistiria da demanda inteira
   * e o ícone teria ficado. `aplicarIcone` devolve `null` quando não há o que
   * mudar, e aí o estado não é tocado: um `setLinks` com a mesma lista
   * remontaria a seção a cada clique repetido.
   */
  function editIconeLink(id: string, icone: string | null) {
    setLinks((c) => aplicarIcone(c, id, icone) ?? c);
  }

  function editTituloLink(id: string, title: string) {
    setLinks((c) => c.map((l) => (l.id === id ? { ...l, title } : l)));
  }

  // --- comentários: escrever basta, o botão não ------------------------
  //
  // Comentário não tem rascunho: ou está gravado, ou não existe. Antes era
  // preciso clicar em "Comentar" — e quem escrevia e fechava o card perdia o
  // texto sem nenhum aviso. Agora fechar o card grava o que estiver escrito,
  // e o Ctrl+Enter continua valendo para quem quer publicar sem sair daqui.

  /** Publica o comentário novo. `false` = não gravou, então não pode fechar. */
  async function publicarComentario(): Promise<boolean> {
    const text = newComment.trim();
    if (!text || !card) return true;
    const comment: Comment = {
      id: uid(),
      author: actorEmail,
      text,
      at: Date.now(),
    };
    try {
      await addComment(card.id, comment);
      setComments((c) => [...c, comment]);
      setNewComment("");
      return true;
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar o comentário.");
      return false;
    }
  }

  /** Grava a reescrita em andamento, se houver alguma. */
  async function salvarEdicaoComentario(): Promise<boolean> {
    if (!card || comentarioEmEdicao === null) return true;
    const alvo = comments.find((c) => chaveComentario(c) === comentarioEmEdicao);
    const text = textoEditado.trim();
    // Apagar tudo não é editar: sem texto, o comentário fica como estava — para
    // remover a fala de alguém não basta esvaziar um campo por acidente.
    if (!alvo || !text || text === alvo.text) {
      setComentarioEmEdicao(null);
      return true;
    }
    try {
      const editedAt = await editComment(
        card.id,
        { id: alvo.id, author: alvo.author, at: alvo.at },
        text,
      );
      setComments((cur) =>
        cur.map((c) =>
          chaveComentario(c) === comentarioEmEdicao
            ? { ...c, text, editedAt }
            : c,
        ),
      );
      setComentarioEmEdicao(null);
      return true;
    } catch (e) {
      console.error(e);
      setErr("Não foi possível salvar a edição do comentário.");
      return false;
    }
  }

  /** Tudo o que está escrito na área de comentários vai para o banco. */
  async function gravarComentarios(): Promise<boolean> {
    if (gravandoComentario.current) {
      setErr(
        "O comentário ainda está sendo salvo — tente de novo em instantes.",
      );
      return false;
    }
    gravandoComentario.current = true;
    setPosting(true);
    try {
      const editou = await salvarEdicaoComentario();
      const publicou = await publicarComentario();
      return editou && publicou;
    } finally {
      gravandoComentario.current = false;
      setPosting(false);
    }
  }

  /**
   * Apaga um comentário, com confirmação.
   *
   * Confirmação porque não há desfazer: o texto sai do array e não fica cópia
   * em lugar nenhum. Diferente de excluir a demanda, que desde a lixeira é
   * reversível e por isso confirma na própria tela em vez de no navegador.
   */
  async function excluirComentario(c: Comment) {
    if (!card) return;
    if (!confirm("Remover este comentário? Esta ação não pode ser desfeita."))
      return;
    const chave = chaveComentario(c);
    setComentarioSaindo(chave);
    try {
      await removeComment(card.id, {
        id: c.id,
        author: c.author,
        at: c.at,
      });
      setComments((cur) => cur.filter((x) => chaveComentario(x) !== chave));
      // Se era este que estava sendo reescrito, a edição perdeu o alvo — deixar
      // a caixa aberta faria o fechamento do card tentar salvar num vazio.
      if (comentarioEmEdicao === chave) setComentarioEmEdicao(null);
    } catch (e) {
      console.error(e);
      setErr("Não foi possível remover o comentário.");
    } finally {
      setComentarioSaindo(null);
    }
  }

  /** Abre a reescrita de um comentário sem perder a que já estava aberta. */
  async function abrirEdicaoComentario(chave: string, texto: string) {
    if (comentarioEmEdicao !== null && comentarioEmEdicao !== chave) {
      if (!(await salvarEdicaoComentario())) return;
    }
    setComentarioEmEdicao(chave);
    setTextoEditado(texto);
  }

  /**
   * O formulário reduzido ao que VAI PARA O BANCO — a única fonte dos dois.
   *
   * Isto estava escrito dentro do `submit`, e por isso "o que se grava" e "o que
   * conta como alteração não salva" eram duas listas de campos mantidas por
   * ninguém. Agora são a mesma: o guarda de saída compara instantâneos desta
   * função, e o `submit` monta o patch a partir dela. Um campo novo entra aqui
   * uma vez e as duas perguntas passam a conhecê-lo — que é o contrário do bug
   * silencioso em que o campo é salvo mas não é vigiado (ou vigiado e não salvo).
   *
   * As normalizações fazem parte do contrato e por isso moram aqui: `trim()` no
   * texto e `"" → null` nos opcionais. Sem elas, um espaço a mais digitado e
   * apagado contaria como alteração pendente.
   */
  function montarBase() {
    return {
      title: title.trim(),
      description: description.trim(),
      columnId,
      type,
      assignee: assignee || null,
      requester: requester || null,
      requesterSector: requesterSector || null,
      dimensaoId: dimensaoId || null,
      // Subdimensão sem dimensão não é estado válido — ver o campo em
      // `kanban.ts`. O seletor já impede, e a guarda aqui é o cinto: o estado
      // pode ter sobrado de uma dimensão apagada com o modal aberto.
      subdimensaoId: (dimensaoId && subdimensaoId) || null,
      startDate: startDate || null,
      due: semPrazo ? null : due || null,
      priority,
      tags,
      // Só as referências das tags que sobraram: remover a tag e deixar a
      // referência gravada devolveria o vínculo na próxima edição.
      tagRefs: tagRefs.filter((r) => tags.includes(r.texto)),
      checklist,
      links,
    };
  }

  /**
   * O formulário como ele estava quando o modal abriu.
   *
   * Congelado, e comparado contra `montarBase()` de agora. Duas alternativas
   * foram descartadas:
   *
   * Comparar contra o CARD cru (como o `submit` faz para montar o patch) daria
   * falso positivo no primeiro card antigo que aparecesse: um card gravado antes
   * de as tags existirem não tem a chave, o formulário abre com `[]`, e `[]`
   * contra `undefined` dá diferente. A tela perguntaria "descartar alterações?"
   * para quem só abriu e fechou. Passando os DOIS lados pela mesma construção,
   * o campo que ninguém tocou sai idêntico dos dois.
   *
   * E congelar, em vez de reler `card`, porque o card chega de uma assinatura e
   * pode ser reescrito por outra pessoa com o modal aberto. O que define "você
   * alterou" é o que ESTA pessoa encontrou ao abrir — senão a edição de um
   * colega apareceria como alteração dela, para ela decidir se descarta.
   */
  const [baseAoAbrir] = useState<Rascunho>(() => montarBase());

  /**
   * Fecha o card gravando o comentário escrito.
   *
   * Vale também no "Cancelar" e no Escape: comentário nunca fez parte do
   * formulário — ele já era gravado na hora, direto no card. Cancelar desfaz a
   * edição da demanda, não apaga o que alguém acabou de escrever. Se a gravação
   * falha, o modal FICA ABERTO: fechar aqui seria jogar o texto fora.
   */
  async function fechar() {
    if (!(await gravarComentarios())) return;
    onClose();
  }

  /** Campos que diferem do que havia na abertura, na ordem do formulário. */
  const mudados = camposMudados(baseAoAbrir, montarBase());
  const temMudanca = mudados.length > 0;

  /**
   * O veto do `<Modal>`: com alteração por salvar, o clique fora e o Escape
   * NÃO fecham.
   *
   * Devolve `false` uma vez só por gesto e, na mesma passada, abre a pergunta.
   * Enquanto ela está na tela, o veto sai do caminho (`confirmandoSaida` já é
   * true) — quem já viu a pergunta e clica fora de novo está dizendo "some", e
   * insistir a partir daí seria a tela prendendo a pessoa dentro de um diálogo
   * que ela só quer abandonar. Sair por ali descarta, que é o que os botões
   * também oferecem, e o segundo clique é deliberado.
   */
  function podeFechar(): boolean {
    if (saving || excluindo) return false;
    if (!temMudanca || confirmandoSaida) return true;
    setErr(null);
    setConfirmandoExclusao(false);
    setConfirmandoSaida(true);
    return false;
  }

  /** Sai jogando fora o que foi digitado — o comentário escrito ainda grava. */
  async function descartarEFechar() {
    setConfirmandoSaida(false);
    await fechar();
  }

  /** Leva o campo que travou o salvamento até os olhos de quem clicou. */
  function cobrar(
    campo: "titulo" | "inicio" | "prazo",
    mensagem: string,
    ref: { current: HTMLInputElement | null },
  ) {
    setErr(mensagem);
    setCampoErro(campo);
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    // `preventScroll` porque a rolagem suave acima já está a caminho: sem ele o
    // foco dá um pulo seco e desfaz o movimento no meio.
    el.focus({ preventScroll: true });
  }

  /** Some com a cobrança assim que o campo cobrado é preenchido. */
  function corrigiu(campo: "titulo" | "inicio" | "prazo") {
    if (campoErro !== campo) return;
    setCampoErro(null);
    setErr(null);
  }

  /**
   * Cobra o dia útil ao SAIR do campo — marcando, sem puxar o foco de volta.
   *
   * A frase é a mesma do Salvar, e é de propósito: quem já leu a recusa uma vez
   * não deveria reencontrá-la escrita de outro jeito e ter de decidir se são o
   * mesmo problema. O que muda é só o gesto — aqui não se rola nem se refoca
   * como em `cobrar()`, porque devolver o foco a quem acabou de tabular para o
   * campo seguinte é armadilha, e a frase já nasce embaixo do campo, onde os
   * olhos acabaram de estar.
   */
  function saiuDaData(campo: "inicio" | "prazo") {
    const valor = campo === "inicio" ? startDate : due;
    const herdado = campo === "inicio" ? inicioHerdado : prazoHerdado;
    if (!valor || herdado || !ehFimDeSemanaISO(valor)) return;
    setCampoErro(campo);
  }

  async function submit() {
    setErr(null);
    if (!title.trim()) {
      cobrar("titulo", "Informe um título.", tituloRef);
      return;
    }
    // Na ordem em que os campos aparecem na tela: quem for cobrado de dois de
    // uma vez resolve o de cima primeiro e não vê a página saltar para trás.
    //
    // O rodapé leva a linha curta e o campo leva a frase inteira — a mesma
    // divisão que o título já usa. Repetir "13 de setembro é um sábado" duas
    // vezes na mesma tela faria a pessoa procurar dois problemas onde há um.
    if (startDate && !inicioHerdado && ehFimDeSemanaISO(startDate)) {
      cobrar("inicio", "Escolha um dia útil para o início.", inicioRef);
      return;
    }
    if (!semPrazo && !due) {
      cobrar(
        "prazo",
        "Informe o prazo de entrega ou marque “sem prazo definido”.",
        prazoRef,
      );
      return;
    }
    if (!semPrazo && due && !prazoHerdado && ehFimDeSemanaISO(due)) {
      cobrar("prazo", "Escolha um dia útil para o prazo de entrega.", prazoRef);
      return;
    }
    setCampoErro(null);
    setSaving(true);
    try {
      const base = montarBase();
      const ctx = { autor: actorEmail, sector };
      if (isNew) {
        const input: CardInput = base;
        // O estado inicial vira a primeira linha da timeline: sem ela, a
        // demanda que já nasce com dono e prazo apareceria como se tivesse
        // nascido vazia e ganhado tudo depois, sem que ninguém tivesse mexido.
        await createCard(
          sector,
          input,
          actorEmail,
          mudancasIniciais(base, rotulos),
        );
      } else if (card) {
        // Só os campos que REALMENTE mudaram. Enviar o formulário inteiro fazia
        // o último a salvar apagar, em silêncio, a edição de quem salvou antes
        // — inclusive em campos que ele nem abriu.
        const atual = card as unknown as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        for (const [campo, valor] of Object.entries(base)) {
          if (!mesmoValor(atual[campo], valor)) patch[campo] = valor;
        }
        if (card.columnId !== columnId) {
          // Trocar de coluna reinicia o aging e joga para o topo.
          patch.order = -Date.now();
          patch.enteredAt = Date.now();
        }
        if (Object.keys(patch).length > 0) {
          // Contador de versão: quem for aplicar mudança automática no futuro
          // precisa saber se o card mudou desde que o leu.
          patch.rev = (card.rev ?? 0) + 1;
          // O diff sai de `card` contra `base`, e não do `patch`: o patch já
          // perdeu o valor ANTERIOR, que é metade do que o histórico conta.
          await updateCard(card.id, patch as Partial<Omit<Card, "id">>, {
            ctx,
            acao: "editada",
            /**
             * O `antes` leva os NOMES da dimensão e da subdimensão resolvidos
             * agora, porque o card guarda id e o histórico guarda texto
             * congelado (ver `EstadoCard`). Sem isto, os dois lados do diff
             * ficariam `undefined` e uma troca de dimensão não deixaria rastro.
             */
            mudancas: diffCard(
              { ...card, ...nomesDaArvore(card.dimensaoId, card.subdimensaoId) },
              { ...base, ...nomesDaArvore(dimensaoId, subdimensaoId) },
              rotulos,
            ),
          });
        }
      }
      // O comentário vai junto — e se ele não gravar, o modal fica aberto com o
      // texto na tela. A demanda já está salva; clicar em Salvar de novo só
      // repete a tentativa do comentário.
      if (!(await gravarComentarios())) {
        setSaving(false);
        return;
      }
      onClose();
    } catch (e) {
      // O código ao LADO do objeto, e não dentro dele: assim quem está com o
      // console aberto copia uma palavra em vez de expandir um objeto para
      // achá-la — e essa palavra é o que faz a diferença entre "quebrou" e
      // "permission-denied" na hora de pedir ajuda.
      console.error("[salvar demanda]", codigoDe(e), e);
      setErr(fraseDeFalha("Não foi possível salvar a demanda.", e, navigator.onLine));
      setSaving(false);
    }
  }

  /**
   * Exclusão da demanda — que agora é reversível.
   *
   * O `confirm()` do navegador saiu daqui de propósito. Ele existia para
   * segurar um apagamento sem volta, e não é mais isso que acontece: a demanda
   * vai para a lixeira do setor e volta de lá. Além disso ele é desenhado pelo
   * navegador FORA do diálogo — rouba o foco que o `<Modal>` prende, não fala
   * na voz do app e não cabe a frase que explica para onde a demanda foi. A
   * confirmação passa a ser a própria tela, a dois cliques, onde os olhos já
   * estão.
   */
  /**
   * O outro caminho do pedido: pela demanda aberta, não pelo arrasto.
   *
   * Os dois existem porque as duas situações existem. Quem está olhando o
   * quadro arrasta; quem abriu a demanda para conferir o checklist antes de
   * dizer que acabou já está aqui dentro, e mandá-lo fechar e arrastar seria
   * fazer o caminho longo do gesto mais natural.
   *
   * Não pergunta nada antes: o clique já é deliberado — a pessoa abriu a
   * demanda e leu o botão. O diálogo do quadro existe porque LÁ o gesto é um
   * arrasto, que erra o alvo com facilidade.
   */
  async function solicitarConclusao() {
    if (!card || !alvoDaConclusao) return;
    setErr(null);
    setPedindo(true);
    try {
      await pedirConclusao(card.id, actorEmail, alvoDaConclusao, {
        autor: actorEmail,
        sector,
      });
      onClose();
    } catch (e) {
      console.error("[pedir conclusão]", codigoDe(e), e);
      setErr(
        fraseDeFalha(
          "Não foi possível registrar o pedido de conclusão.",
          e,
          navigator.onLine,
        ),
      );
      setPedindo(false);
    }
  }

  /**
   * Grava a mudança de setor.
   *
   * O plano é recalculado AQUI, e não reaproveitado do render, por causa da
   * hora: `planoDaMudanca` recebe `agora`, e o valor do render é de quando a
   * pessoa abriu o painel — que pode ter sido minutos atrás. `enteredAt` e
   * `order` sairiam do passado, e o card chegaria no destino já parecendo
   * antigo.
   */
  async function mover() {
    if (!card || !destino || !colsDestino?.length) return;
    const p = planoDaMudanca({
      pessoa,
      card,
      tituloDaColunaAtual:
        columns.find((c) => c.colId === card.columnId)?.title ?? "",
      destino,
      colsDestino,
      setoresDoResponsavel: card.assignee
        ? (usersMap[card.assignee]?.sectors ?? null)
        : null,
      agora: Date.now(),
    });
    if (!p) return;
    setErr(null);
    setTransferindo(true);
    try {
      await moverDeSetor(card.id, p.patch, {
        // O evento fica no setor de ORIGEM — a regra exige que ele bata com o
        // setor do card PAI, e dentro deste lote o pai ainda é o antigo. Ver o
        // comentário de `moverDeSetor`.
        ctx: { autor: actorEmail, sector: card.sector },
        mudancas: [
          { campo: "setor", de: card.sector, para: p.destino },
          ...(card.columnId !== p.coluna.colId
            ? [
                {
                  campo: "coluna" as const,
                  de: columns.find((c) => c.colId === card.columnId)?.title ?? null,
                  para: p.coluna.title,
                },
              ]
            : []),
        ],
      });
      onClose();
    } catch (e) {
      console.error("[mover de setor]", codigoDe(e), e);
      setErr(
        fraseDeFalha(
          "Não foi possível mudar a demanda de setor.",
          e,
          navigator.onLine,
        ),
      );
      setTransferindo(false);
    }
  }

  async function remove() {
    if (!card) return;
    setErr(null);
    setExcluindo(true);
    try {
      await moverParaLixeira(card.id, { ctx: { autor: actorEmail, sector } });
      onClose();
    } catch (e) {
      console.error("[mover demanda para a lixeira]", codigoDe(e), e);
      setErr(
        fraseDeFalha(
          "Não foi possível mover a demanda para a lixeira.",
          e,
          navigator.onLine,
        ),
      );
      setExcluindo(false);
    }
  }

  return (
    <Modal
      onClose={() => void fechar()}
      podeFechar={podeFechar}
      ariaLabel={isNew ? "Nova demanda" : "Editar demanda"}
      overlayClassName={styles.overlay}
      className={styles.modal}
    >
      <div className={styles.mhead}>
        {col && (
          <span className={styles.mchip}>
            <span className={styles.mdot} style={{ background: col.color }} />
            {col.title}
          </span>
        )}
        <span className={styles.mchip}>{sector}</span>
      </div>

      <input
        ref={tituloRef}
        className={`${styles.mtitle} ${campoErro === "titulo" ? styles.mtitleErro : ""}`}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (e.target.value.trim()) corrigiu("titulo");
        }}
        placeholder="Título da demanda"
        aria-label="Título da demanda"
        aria-invalid={campoErro === "titulo"}
        autoFocus
      />
      {campoErro === "titulo" && (
        <div className={styles.campoAviso}>
          Toda demanda começa pelo título — é ele que aparece no card.
        </div>
      )}

      {/**
       * Daqui até o rodapé, o diálogo é de duas colunas — ver `.mcorpo` no CSS.
       * À esquerda os dados da demanda; à direita o que se escreve sobre ela.
       * A ordem do arquivo é a ordem da tela e a ordem do Tab: nada aqui é
       * reposicionado por CSS, e por isso a leitura por teclado e por leitor de
       * tela continua sendo a mesma de quando isto era uma pilha só.
       */}
      <div className={styles.mcorpo}>
      <div className={styles.mdados}>
      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Tipo</label>
          <Select
            value={type}
            options={typeOptions}
            onChange={(v) => setType(v as DemandType)}
            ariaLabel="Tipo da demanda"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Prioridade</label>
          <Select
            value={priority}
            options={priorityOptions}
            onChange={(v) => setPriority(v as Priority)}
            ariaLabel="Prioridade"
          />
        </div>
      </div>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.labelLinha}>
            Setor solicitante
            <button
              type="button"
              className={styles.novoCadastro}
              onClick={() => {
                setCriando(criando === "setor" ? null : "setor");
                setNovoNome("");
                setErroCadastro(null);
              }}
            >
              {criando === "setor" ? "cancelar" : "+ novo"}
            </button>
          </label>
          {criando === "setor" ? (
            <NovoCadastro
              valor={novoNome}
              onChange={setNovoNome}
              onSalvar={salvarCadastro}
              salvando={salvandoCadastro}
              placeholder="Nome do setor…"
            />
          ) : (
            <Combobox
              value={requesterSector}
              options={reqSetorOptions}
              onChange={setRequesterSector}
              placeholder="Digite para buscar…"
              ariaLabel="Setor solicitante"
              vazioTexto="Nenhum setor com esse nome. Use “+ novo” para cadastrar."
            />
          )}
        </div>
        <div className={styles.field}>
          <label className={styles.labelLinha}>
            Solicitante
            <button
              type="button"
              className={styles.novoCadastro}
              onClick={() => {
                setCriando(criando === "pessoa" ? null : "pessoa");
                setNovoNome("");
                setErroCadastro(null);
              }}
            >
              {criando === "pessoa" ? "cancelar" : "+ novo"}
            </button>
          </label>
          {criando === "pessoa" ? (
            <NovoCadastro
              valor={novoNome}
              onChange={setNovoNome}
              onSalvar={salvarCadastro}
              salvando={salvandoCadastro}
              placeholder="Nome do solicitante…"
            />
          ) : (
            <Combobox
              value={requester}
              options={solicOptions}
              onChange={setRequester}
              placeholder="Digite para buscar…"
              ariaLabel="Solicitante"
              vazioTexto="Ninguém com esse nome. Use “+ novo” para cadastrar."
            />
          )}
        </div>
        {erroCadastro && (
          <div className={styles.err} style={{ gridColumn: "1 / -1" }}>
            {erroCadastro}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Responsável</label>
        <Select
          value={assignee ?? ""}
          options={userOptions("— Ninguém —", assignee ?? "")}
          onChange={setAssignee}
          placeholder="— Ninguém —"
          ariaLabel="Responsável"
        />
      </div>

      {/**
        * ONDE ESTA DEMANDA MORA NA ÁRVORE DO SETOR.
        *
        * Aparece SÓ quando o setor tem árvore cadastrada. Um par de seletores
        * vazios em todo formulário do app seria a pergunta "em qual dimensão?"
        * feita a quem ainda não tem dimensão nenhuma — e o Kanban dos setores
        * que nunca vão usar a aba não devia ficar mais comprido por causa dela.
        *
        * A subdimensão é OPCIONAL de propósito: a ata prevê a demanda que fica
        * direto na dimensão, "uma caixa que abriga vários trabalhos". Obrigar o
        * segundo nível faria quem não soubesse escolher chutar, e chute vira
        * dado errado que ninguém revisa.
        */}
      {dims.length > 0 && (
        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label}>Dimensão</label>
            <Select
              value={dimensaoId}
              options={[
                { value: "", label: "— Sem dimensão —" },
                ...dims.map((d) => ({ value: d.id, label: d.nome })),
              ]}
              onChange={trocarDimensao}
              placeholder="— Sem dimensão —"
              ariaLabel="Dimensão"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Subdimensão</label>
            <Select
              value={subdimensaoId}
              options={[
                { value: "", label: "— Direto na dimensão —" },
                ...(dimAtual?.subs ?? []).map((sub) => ({
                  value: sub.id,
                  label: sub.nome,
                })),
              ]}
              onChange={setSubdimensaoId}
              // Sem dimensão escolhida a lista tem só a opção neutra, e o
              // texto diz o motivo em vez de deixar um seletor mudo na tela.
              placeholder={
                dimAtual ? "— Direto na dimensão —" : "Escolha a dimensão primeiro"
              }
              ariaLabel="Subdimensão"
            />
          </div>
        </div>
      )}

      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Início</label>
          <input
            ref={inicioRef}
            className={`${styles.inp} ${campoErro === "inicio" ? styles.inpErro : ""}`}
            type="date"
            value={startDate ?? ""}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (!e.target.value || !ehFimDeSemanaISO(e.target.value)) {
                corrigiu("inicio");
              }
            }}
            onBlur={() => saiuDaData("inicio")}
            aria-invalid={campoErro === "inicio"}
            aria-label="Início"
          />
          {(campoErro === "inicio" || inicioHerdado) &&
            !!startDate &&
            ehFimDeSemanaISO(startDate) && (
              <div
                className={
                  inicioHerdado ? styles.avisoDataNota : styles.avisoData
                }
              >
                {fraseFimDeSemana("inicio", startDate)}{" "}
                <button
                  type="button"
                  className={styles.avisoAcao}
                  onClick={() => {
                    setStartDate(proximoDiaUtilISO(startDate));
                    corrigiu("inicio");
                  }}
                >
                  Usar {diaEMes(proximoDiaUtilISO(startDate))}
                </button>
              </div>
            )}
        </div>
        <div className={styles.field}>
          {/* `div` e não `label`: o `label` da opção mora aqui dentro, e um
              dentro do outro é ambíguo para o clique e inválido no HTML. */}
          <div className={styles.labelLinha}>
            Prazo de entrega
            <label className={styles.semPrazoOpc}>
              <input
                type="checkbox"
                checked={semPrazo}
                onChange={(e) => {
                  const marcou = e.target.checked;
                  setSemPrazo(marcou);
                  if (marcou) corrigiu("prazo");
                  // Desmarcar devolve uma data usável em vez de campo vazio:
                  // quem desmarca quer prazo, não quer procurar o calendário.
                  // E usável inclui ser dia útil — senão o campo voltaria já
                  // recusado pela regra que ele mesmo acabou de reativar.
                  setDue(
                    marcou
                      ? ""
                      : proximoDiaUtilISO(plusDays(startDate || todayStr(), 7)),
                  );
                }}
              />
              sem prazo definido
            </label>
          </div>
          {semPrazo ? (
            <div className={styles.semPrazoAviso}>
              A definir — sai como “sem prazo definido” no relatório
            </div>
          ) : (
            <input
              ref={prazoRef}
              className={`${styles.inp} ${campoErro === "prazo" ? styles.inpErro : ""}`}
              type="date"
              value={due ?? ""}
              onChange={(e) => {
                setDue(e.target.value);
                if (e.target.value && !ehFimDeSemanaISO(e.target.value)) {
                  corrigiu("prazo");
                }
              }}
              onBlur={() => saiuDaData("prazo")}
              aria-invalid={campoErro === "prazo"}
              aria-label="Prazo de entrega"
            />
          )}
          {!semPrazo &&
            (campoErro === "prazo" || prazoHerdado) &&
            !!due &&
            ehFimDeSemanaISO(due) && (
              <div
                className={
                  prazoHerdado ? styles.avisoDataNota : styles.avisoData
                }
              >
                {fraseFimDeSemana("prazo", due)}{" "}
                <button
                  type="button"
                  className={styles.avisoAcao}
                  onClick={() => {
                    setDue(proximoDiaUtilISO(due));
                    corrigiu("prazo");
                  }}
                >
                  Usar {diaEMes(proximoDiaUtilISO(due))}
                </button>
              </div>
            )}
        </div>
      </div>

      {/* Sozinho na linha e ainda assim dentro de `.row2`: é a grade que o
          segura na largura de um campo. O `<div className={styles.field} />`
          vazio que fazia esse papel no layout antigo saiu — ele não era um
          campo, era um calço, e na coluna estreita ele viraria 14px de vão
          entre "Coluna" e "Tags" sem nada dentro. */}
      <div className={styles.row2}>
        <div className={styles.field}>
          <label className={styles.label}>Coluna</label>
          <Select
            value={columnId}
            options={columnOptions}
            onChange={setColumnId}
            ariaLabel="Coluna"
          />
        </div>
      </div>

      <div className={styles.sectionLabel}>Tags</div>
      <div className={styles.tagsEdit}>
        {tags.map((t) => (
          <span key={t} className={styles.tagChip}>
            <span className={styles.tagDot} style={{ background: tagColor(t) }} />
            {t}
            <button
              className={styles.tagDel}
              onClick={() => removeTag(t)}
              title="Remover tag"
              aria-label={`Remover tag ${t}`}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <div className={styles.tagBox}>
          <input
            className={styles.tagInput}
            value={newTag}
            onChange={(e) => {
              setNewTag(e.target.value);
              setMenuTagFechado(false);
              setTagAtiva(0);
            }}
            onKeyDown={teclaNaTag}
            onBlur={() => setMenuTagFechado(true)}
            placeholder="# busca tags, setores e demandas"
            aria-label="Adicionar tag"
            role="combobox"
            aria-expanded={menuTagVisivel}
            aria-controls="menu-tags"
            aria-autocomplete="list"
            aria-activedescendant={
              menuTagAberto ? `tag-op-${idxTag}` : undefined
            }
          />
          {menuTagVisivel && (
            <div className={styles.tagMenu} id="menu-tags" role="listbox">
              {sugestoesTag.length === 0 ? (
                <div className={styles.tagMenuVazio}>
                  {buscaTag
                    ? `Nada com “${buscaTag}” em tags, setores ou demandas. Enter cria a tag assim mesmo.`
                    : "Nenhuma tag, setor ou demanda para sugerir. Enter cria a primeira."}
                </div>
              ) : (
                sugestoesTag.map((s, i) => (
                  <Fragment key={`${s.grupo}-${s.valor}`}>
                    {(i === 0 || sugestoesTag[i - 1].grupo !== s.grupo) && (
                      <div className={styles.tagGrupo}>
                        {GRUPO_ROTULO[s.grupo]}
                      </div>
                    )}
                    <button
                      id={`tag-op-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === idxTag}
                      className={`${styles.tagOpcao} ${i === idxTag ? styles.tagOpcaoAtiva : ""}`}
                      // `onMouseDown` prevenido: sem isso o blur do campo fecha
                      // a lista antes de o clique chegar, e escolher com o mouse
                      // simplesmente não funcionava.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setTagAtiva(i)}
                      onClick={() => incluirTag(s.valor, s.ref)}
                    >
                      <span
                        className={styles.tagDot}
                        style={{ background: tagColor(s.valor) }}
                      />
                      <span className={styles.tagOpcaoNome}>{s.valor}</span>
                      {s.detalhe && (
                        <span className={styles.tagOpcaoUso}>{s.detalhe}</span>
                      )}
                    </button>
                  </Fragment>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/**
       * "Já existe algo parecido" — o aviso que impede o catálogo de inchar.
       *
       * Fica FORA de `.tagsEdit` porque aquele bloco é uma linha que embrulha
       * chips: um aviso lá dentro entraria na fila deles e apareceria ao lado
       * de uma tag qualquer, como se fosse dela.
       *
       * Cada tag parecida é um BOTÃO, e não texto. O aviso sem ação é só uma
       * repreensão — quem lê "já existe Processos" ainda precisa apagar o campo,
       * lembrar a grafia e redigitar, e nessa hora todo mundo prefere apertar
       * Enter no que já escreveu. Um clique é mais barato que teimar.
       *
       * `onMouseDown` prevenido pelo mesmo motivo do menu logo acima: o blur do
       * campo desmonta o aviso antes de o clique chegar.
       */}
      {parecidasComOTexto.length > 0 && (
        <div className={styles.tagAviso} role="status">
          <Icon name="info" size={13} />
          <span>Já existe no quadro:</span>
          {parecidasComOTexto.map((t) => (
            <button
              key={t}
              type="button"
              className={styles.tagAvisoBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => incluirTag(t)}
              title={`Usar a tag "${t}", que já existe neste quadro`}
            >
              <span className={styles.tagDot} style={{ background: tagColor(t) }} />
              {t}
            </button>
          ))}
          <span className={styles.tagAvisoFim}>
            — ou Enter para criar “{conferirTagTexto}” assim mesmo.
          </span>
        </div>
      )}

      </div>
      <div className={styles.mconteudo}>

      <div className={styles.sectionLabel}>Descrição</div>
      <textarea
        className={styles.textarea}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Contexto, requisitos, links…"
      />

      {/* O campo acima já promete "links" — e é ali que eles vinham parando, no
          meio da prosa: sem poder abrir num clique, sem rótulo, e apagados sem
          querer na primeira reescrita da descrição. Esta seção é a mesma coisa
          em forma de dado: cada endereço vira uma linha que abre, se nomeia e
          se remove sozinha. Fica fora do `!isNew` de propósito — a demanda
          costuma nascer de um arquivo que já existe. */}
      <div className={styles.sectionLabel}>
        Links{links.length > 0 ? ` · ${links.length}` : ""}
      </div>
      {links.map((l) => (
        <div key={l.id} className={styles.linkRow}>
          {/* Fundo e tinta saem juntos: branco chapado desaparece no amarelo
              do Drive, e o selo é a única pista visual da linha.

              Ele DESENHA o ícone agora, e não só o monograma. Antes esta linha
              e o card da aba Links mostravam coisas diferentes para o mesmo
              link — aqui duas letras, lá o desenho do serviço —, e quem
              cadastrava não tinha como saber o que ia aparecer. */}
          <IconePicker
            valor={l.icone ?? null}
            deduzido={iconeDoLink({ ...l, icone: undefined })}
            rotulo={rotuloDoLink(l)}
            onEscolher={(nome) => editIconeLink(l.id, nome)}
            className={styles.linkIcone}
            style={{
              background: seloDoLink(l.url).fundo,
              color: seloDoLink(l.url).tinta,
            }}
          >
            {iconeDoLink(l) ? (
              <Icon name={iconeDoLink(l) as string} size={15} />
            ) : (
              monogramaDe(l.url)
            )}
          </IconePicker>
          <div className={styles.linkMain}>
            <input
              className={styles.linkTitulo}
              value={l.title ?? ""}
              onChange={(e) => editTituloLink(l.id, e.target.value)}
              placeholder={dominioDe(l.url)}
              aria-label={`Rótulo do link ${l.url}`}
            />
            {/* A URL inteira no `title`: o texto corta na largura do modal, e
                saber para onde o link vai antes de clicar é o que separa um
                link de confiança de um que ninguém abre. */}
            <span className={styles.linkUrl} title={l.url}>
              {l.url}
            </span>
          </div>
          {/* `noopener` não é formalidade: sem ele a página aberta recebe
              `window.opener` e pode trocar o endereço desta aba por outro.

              E o portão roda DE NOVO aqui, sobre o que veio do banco. Quem
              grava passou por `normalizarUrl`, mas o campo aceita escrita de
              qualquer pessoa do setor e do console do Firestore — e o React
              não recusa um `javascript:` em `href`, só avisa. Sem `href` o
              elemento deixa de ser link, que é a falha certa: não abre nada. */}
          <a
            className={styles.linkAbrir}
            href={normalizarUrl(l.url) || undefined}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir em nova aba"
            aria-label={`Abrir ${rotuloDoLink(l)} em nova aba`}
          >
            <Icon name="link" size={14} />
          </a>
          <button
            type="button"
            className={styles.linkDel}
            onClick={() => removeLink(l.id)}
            title="Remover link"
            aria-label={`Remover ${rotuloDoLink(l)}`}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
      <div className={styles.linkAdd}>
        <input
          value={novoLink}
          onChange={(e) => {
            setNovoLink(e.target.value);
            // O aviso morre no primeiro toque de tecla: mantê-lo enquanto a
            // pessoa já está corrigindo o endereço é acusar quem obedeceu.
            if (erroLink) setErroLink(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
          placeholder="Colar link…"
          inputMode="url"
          aria-label="Colar link da demanda"
        />
        <button type="button" className={styles.linkAddBtn} onClick={addLink}>
          Adicionar
        </button>
      </div>
      {erroLink && (
        <div className={styles.linkErro} role="alert">
          {erroLink}
        </div>
      )}

      <div className={styles.sectionLabel}>
        Checklist
        {checklist.length > 0 ? ` · ${doneCount}/${checklist.length}` : ""}
      </div>
      {checklist.length > 0 && (
        <div className={styles.checkBar} style={{ marginBottom: 10 }}>
          <div className={styles.checkFill} style={{ width: `${pct}%` }} />
        </div>
      )}
      {checklist.map((it, i) => (
        <div key={it.id ?? i} className={styles.checkRow}>
          <div className={styles.checkMain}>
            <input
              type="checkbox"
              className={styles.checkBox}
              checked={it.done}
              onChange={() => toggleItem(i)}
              aria-label={`Concluir item: ${it.text}`}
            />
            <input
              className={`${styles.checkText} ${it.done ? styles.checkDone : ""}`}
              value={it.text}
              onChange={(e) => editItem(i, e.target.value)}
              aria-label="Item do checklist"
            />
            <button
              className={styles.checkDel}
              onClick={() => removeItem(i)}
              title="Remover item"
              aria-label="Remover item"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <input
            className={styles.checkDesc}
            value={it.desc ?? ""}
            onChange={(e) => editItemDesc(i, e.target.value)}
            placeholder="mini descrição (opcional)"
            aria-label="Descrição do item"
          />
        </div>
      ))}
      <div className={styles.checkAdd}>
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Adicionar item…"
          aria-label="Adicionar item ao checklist"
        />
        <button className={styles.checkAddBtn} onClick={addItem}>
          Adicionar
        </button>
      </div>

      {!isNew && (
        <>
          <div className={styles.sectionLabel}>
            Comentários{comments.length ? ` · ${comments.length}` : ""}
          </div>
          <div className={styles.comments}>
            {comments.length === 0 ? (
              <div className={styles.noComments}>Nenhum comentário ainda.</div>
            ) : (
              [...comments]
                .sort((a, b) => a.at - b.at)
                .map((c, i) => {
                  const u = usersMap[c.author];
                  const name = u?.name || c.author;
                  const chave = chaveComentario(c);
                  // Só o autor reescreve o próprio comentário: editar a fala de
                  // outra pessoa mudaria o registro do que ela disse.
                  const meu = c.author === actorEmail;
                  const editando = comentarioEmEdicao === chave;
                  return (
                    <div key={c.id ?? i} className={styles.comment}>
                      {/* alt vazio: o primeiro nome vem escrito logo ao lado. */}
                      <Avatar
                        pessoa={autorDoRegistro(c.author, name, u)}
                        size={26}
                        alt=""
                        title={name}
                      />
                      <div className={styles.cBody}>
                        <div className={styles.cHead}>
                          <span className={styles.cName}>
                            {name.split(" ")[0]}
                          </span>
                          <span className={styles.cTime}>
                            {relTime(c.at)}
                            {c.editedAt ? " · editado" : ""}
                          </span>
                          {meu && !editando && (
                            <span className={styles.cAcoes}>
                              <button
                                type="button"
                                className={styles.cEdit}
                                onClick={() =>
                                  void abrirEdicaoComentario(chave, c.text)
                                }
                                disabled={comentarioSaindo === chave}
                              >
                                editar
                              </button>
                              <button
                                type="button"
                                className={styles.cExcluir}
                                onClick={() => void excluirComentario(c)}
                                disabled={comentarioSaindo === chave}
                              >
                                {comentarioSaindo === chave
                                  ? "removendo…"
                                  : "excluir"}
                              </button>
                            </span>
                          )}
                        </div>
                        {editando ? (
                          <>
                            <textarea
                              className={styles.cEditInput}
                              value={textoEditado}
                              onChange={(e) => setTextoEditado(e.target.value)}
                              aria-label="Editar comentário"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  // Só sai da edição; o Escape do modal
                                  // fecharia a demanda inteira.
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setComentarioEmEdicao(null);
                                  return;
                                }
                                if (
                                  e.key === "Enter" &&
                                  (e.metaKey || e.ctrlKey)
                                ) {
                                  e.preventDefault();
                                  void gravarComentarios();
                                }
                              }}
                            />
                            <div className={styles.cEditAcoes}>
                              <button
                                type="button"
                                className={styles.cEdit}
                                onClick={() => void gravarComentarios()}
                                disabled={posting}
                              >
                                {posting ? "salvando…" : "salvar"}
                              </button>
                              <button
                                type="button"
                                className={styles.cEditCancelar}
                                onClick={() => setComentarioEmEdicao(null)}
                                disabled={posting}
                              >
                                descartar edição
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className={styles.cText}>{c.text}</div>
                        )}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
          <div className={styles.commentAdd}>
            <textarea
              className={styles.commentInput}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Escreva um comentário…"
              aria-label="Novo comentário"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void gravarComentarios();
                }
              }}
            />
          </div>
          <div className={styles.commentHint} aria-live="polite">
            {posting
              ? "Salvando comentário…"
              : "Salvo sozinho ao fechar o card — Ctrl+Enter salva agora."}
          </div>
        </>
      )}

      </div>
      </div>

      {err && <div className={styles.err}>{err}</div>}

      {/**
       * A pergunta da saída — mesmo `.confirmaBloco` da exclusão, de propósito.
       *
       * É a segunda pergunta perigosa deste modal, e as duas aparecem no mesmo
       * lugar, com a mesma moldura e a mesma ordem de botões (a saída segura à
       * esquerda, a consequência à direita). Inventar um segundo formato para a
       * segunda pergunta obrigaria a ler de novo uma coisa já aprendida.
       *
       * `aria-live` e foco: o tremor do `<Modal>` é visual e não chega a quem
       * usa leitor de tela, e o bloco nasce no fim de um formulário longo —
       * quem apertou Escape pode estar a três telas de rolagem daqui.
       */}
      {confirmandoSaida && (
        <div
          className={styles.confirmaBloco}
          role="alertdialog"
          aria-live="assertive"
          ref={(el) => el?.scrollIntoView({ block: "nearest" })}
        >
          <div className={styles.confirmaTexto}>
            <strong>Fechar sem salvar?</strong> Você alterou{" "}
            {resumoDosCampos(mudados)} nesta demanda.{" "}
            {mudados.length === 1
              ? "Fechando agora, essa alteração é perdida"
              : "Fechando agora, essas alterações são perdidas"}{" "}
            — o que já estava salvo continua no quadro.
          </div>
          <div className={styles.confirmaAcoes}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setConfirmandoSaida(false)}
              disabled={saving}
              autoFocus
            >
              Continuar editando
            </button>
            <button
              type="button"
              className={styles.btnConfirmaDescarta}
              onClick={() => void descartarEFechar()}
              disabled={saving}
            >
              Descartar e fechar
            </button>
            {/* Salvar daqui é o MESMO `submit` do rodapé: ele valida, e se o
                título estiver vazio ou o prazo cair num sábado, o modal fica
                aberto com o campo cobrado. Um atalho que gravasse sem validar
                publicaria no quadro de todo mundo o rascunho que a validação
                existe para barrar. */}
            <button
              type="button"
              className={styles.btnSave}
              onClick={submit}
              disabled={saving}
            >
              {saving ? "Salvando…" : "Salvar e fechar"}
            </button>
          </div>
        </div>
      )}

      {confirmandoExclusao && (
        <div className={styles.confirmaBloco}>
          <div className={styles.confirmaTexto}>
            <strong>Mover esta demanda para a lixeira?</strong> Ela sai do
            quadro de {sector} e fica guardada na lixeira do setor, de onde dá
            para trazer de volta. Nada é apagado agora.
          </div>
          <div className={styles.confirmaAcoes}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setConfirmandoExclusao(false)}
              disabled={excluindo}
            >
              Manter no quadro
            </button>
            <button
              type="button"
              className={styles.btnConfirmaPerigo}
              onClick={() => void remove()}
              disabled={excluindo}
            >
              {excluindo ? "Movendo…" : "Mover para a lixeira"}
            </button>
          </div>
        </div>
      )}

      {/**
       * MOVER DE SETOR — o painel, e por que ele mostra o plano antes.
       *
       * Mover é a mudança mais radical que uma demanda sofre neste app: troca de
       * quadro, de etapa e de classificação de uma vez. Os dois modos de falha
       * são silenciosos (etapa que não existe no destino, dimensão de outro
       * setor), e é por isso que o que vai acontecer está escrito aqui, com o
       * nome da etapa de chegada, antes de qualquer escrita.
       */}
      {movendo && (
        <div className={styles.confirmaBloco}>
          <div className={styles.confirmaTexto}>
            <strong>Levar esta demanda para outro setor?</strong> Ela sai do
            quadro de {sector} e passa a ser do setor escolhido. Solicitante,
            setor solicitante e responsável continuam os mesmos.
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Setor de destino</label>
            <Select
              value={destino}
              options={[
                { value: "", label: "Escolha o setor…" },
                ...destinos.map((s) => ({ value: s, label: s })),
              ]}
              onChange={setDestino}
              ariaLabel="Setor de destino"
            />
          </div>
          {/* O esqueleto espera as colunas do destino chegarem. Um resumo
              montado sobre lista vazia diria "vai para a entrada" sobre um
              quadro que ainda não respondeu — e "vai para a entrada" é
              justamente o que se diz quando a etapa não existe lá. */}
          {destino && !colsDestino && (
            <div className={styles.confirmaTexto}>
              Lendo as etapas de {destino}…
            </div>
          )}
          {plano && (
            <ul className={styles.planoMudanca}>
              <li>
                Vai para a etapa <strong>{plano.coluna.title}</strong>
                {plano.coluna.por === "entrada" &&
                  " — a etapa atual não existe lá, então ela chega na entrada do quadro"}
                {plano.coluna.por === "mesmo-nome" &&
                  " — casada pelo nome, porque os dois setores criaram essa etapa separadamente"}
                .
              </li>
              {plano.limpaClassificacao && (
                <li>
                  A classificação de dimensão é <strong>apagada</strong>: a
                  árvore é cadastro de cada setor, e o galho de {sector} não
                  existe em {plano.destino}.
                </li>
              )}
              {plano.responsavelForaDoDestino && (
                <li>
                  O responsável atual <strong>não participa de {plano.destino}</strong>.
                  Ele continua na demanda — troque depois, se for o caso.
                </li>
              )}
              {plano.cancelaPedidoDeConclusao && (
                <li>
                  O pedido de conclusão em aberto é{" "}
                  <strong>cancelado</strong>: ele apontava para uma etapa de{" "}
                  {sector}.
                </li>
              )}
            </ul>
          )}
          {destino && colsDestino && colsDestino.length === 0 && (
            <div className={styles.confirmaTexto}>
              O quadro de {destino} ainda não tem etapa nenhuma. Abra o Kanban
              desse setor uma vez para as etapas serem criadas, e volte aqui.
            </div>
          )}
          <div className={styles.confirmaAcoes}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => {
                setMovendo(false);
                setDestino("");
              }}
              disabled={transferindo}
            >
              Cancelar
            </button>
            <button
              type="button"
              className={styles.btnConfirma}
              onClick={() => void mover()}
              disabled={!plano || transferindo}
            >
              {transferindo ? "Movendo…" : "Mover a demanda"}
            </button>
          </div>
        </div>
      )}

      <div className={styles.mactions}>
        {/* Escondido de quem a regra do Firestore recusaria. Ele aparecia para
            operador, que clicava e levava um "Não foi possível remover." sem
            nome nem motivo — o botão prometia o que o banco negava. */}
        {!isNew && canManage && !confirmandoExclusao && (
          <button
            className={styles.btnDanger}
            onClick={() => {
              setErr(null);
              setConfirmandoExclusao(true);
            }}
            disabled={saving || posting || excluindo}
          >
            <Icon name="trash" size={15} /> Excluir
          </button>
        )}
        {/**
         * "Solicitar conclusão" — e as quatro condições que o fazem existir.
         *
         * Não é demanda nova (não há o que concluir antes de existir), quem
         * está olhando não conclui direto, ainda não há pedido em aberto (dois
         * pedidos sobre a mesma demanda fariam o gestor decidir duas vezes), e
         * o quadro tem alguma etapa de conclusão para onde apontar. Faltando
         * qualquer uma, o botão não aparece — em vez de aparecer e falhar.
         */}
        {/* Só aparece se houver para onde ir. Sem outro setor no cadastro, o
            botão só produziria uma lista vazia — e a regra do Firestore
            recusaria de todo jeito. */}
        {!isNew && !confirmandoExclusao && !movendo && destinos.length > 0 && (
          <button
            className={styles.btnGhost}
            onClick={() => {
              setErr(null);
              setMovendo(true);
            }}
            disabled={saving || posting || excluindo}
          >
            <Icon name="dimensoes" size={15} /> Mover de setor
          </button>
        )}
        {!isNew &&
          !concluiDireto &&
          !confirmandoExclusao &&
          !movendo &&
          !jaPediuConclusao &&
          alvoDaConclusao && (
            <button
              className={styles.btnGhost}
              onClick={() => void solicitarConclusao()}
              disabled={saving || posting || excluindo || pedindo}
            >
              <Icon name="check" size={15} />{" "}
              {pedindo ? "Enviando…" : "Solicitar conclusão"}
            </button>
          )}
        <div className={styles.spacer} />
        {/* Cancelar passa pelo MESMO guarda do clique fora: ele é o gesto mais
            deliberado dos três, mas perde exatamente a mesma coisa. Deixá-lo de
            fora daria uma porta sem tranca ao lado de duas trancadas. */}
        <button
          className={styles.btnGhost}
          onClick={() => {
            if (podeFechar()) void fechar();
          }}
          disabled={saving || posting || excluindo}
        >
          Cancelar
        </button>
        <button
          className={styles.btnSave}
          onClick={submit}
          disabled={saving || posting || excluindo}
        >
          {saving ? "Salvando…" : isNew ? "Criar demanda" : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
