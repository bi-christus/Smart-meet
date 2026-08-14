"use client";

/**
 * O formulário da demanda — criar e editar.
 *
 * Saiu de `page.tsx` quando o arquivo passou de 3300 linhas. Nada além do
 * endereço mudou: as mesmas props, os mesmos hooks na mesma ordem.
 */
import { Fragment, useMemo, useRef, useState } from "react";
import {
  garantirSetorSolicitante,
  garantirSolicitante,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import {
  createCard,
  updateCard,
  moverParaLixeira,
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
  servicoDe,
  seloDoLink,
  monogramaDe,
  rotuloDoLink,
  jaTem,
  novoIdLink,
  SERVICO_ROTULO,
} from "@/lib/links-core";
import {
  MES_LONGO,
  ehFimDeSemanaISO,
  proximoDiaUtilISO,
  rotuloDoDiaISO,
} from "@/lib/datas";
import { codigoDe, fraseDeFalha } from "@/lib/erro-ui-core";
import { diffCard, mudancasIniciais, type Rotulos } from "@/lib/historico-core";
import { type UserProfile } from "@/lib/users";
import { Icon } from "@/components/icons";
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

/** Texto comparável: sem acento e em minúsculas — "Manutenção" acha por "manut". */
function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

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
function mesmoValor(a: unknown, b: unknown): boolean {
  const vazio = (v: unknown) => v === undefined || v === null || v === "";
  if (vazio(a) && vazio(b)) return true;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return a === b;
}

export type EditState =
  | { mode: "new"; columnId: string }
  | { mode: "edit"; card: Card }
  | null;

export function CardModal({
  state,
  sector,
  columns,
  canManage,
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
  const [excluindo, setExcluindo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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

  const columnOptions: SelectOption[] = columns.map((c) => ({
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
    const limpa = t.trim();
    if (!limpa || tags.includes(limpa)) {
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
    incluirTag(newTag.replace(/^\s*#+/, "").trim());
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
      const base = {
        title: title.trim(),
        description: description.trim(),
        columnId,
        type,
        assignee: assignee || null,
        requester: requester || null,
        requesterSector: requesterSector || null,
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
      const ctx = { autor: actorEmail, sector };
      if (isNew) {
        const input: CardInput = base;
        // O estado inicial vira a primeira linha da timeline: sem ela, a
        // demanda que já nasce com dono e prazo apareceria como se tivesse
        // nascido vazia e ganhado tudo depois, sem que ninguém tivesse mexido.
        await createCard(sector, input, actorEmail, mudancasIniciais(base, rotulos));
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
            mudancas: diffCard(card, base, rotulos),
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
              do Drive, e o monograma é a única pista visual da linha. */}
          <span
            className={styles.linkIcone}
            style={{
              background: seloDoLink(l.url).fundo,
              color: seloDoLink(l.url).tinta,
            }}
            title={SERVICO_ROTULO[servicoDe(l.url)]}
            aria-hidden="true"
          >
            {monogramaDe(l.url)}
          </span>
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
        <div className={styles.spacer} />
        <button
          className={styles.btnGhost}
          onClick={() => void fechar()}
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
