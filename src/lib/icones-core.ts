/**
 * O ícone de um link — o que o app deduz, e o que a pessoa escolhe por cima.
 *
 * Módulo puro (AGENTS.md §4), como `links-core`, `tags-ref` e `avatar-core`: sem
 * `firebase/firestore`, sem React, sem DOM. Quem grava é `kanban.ts`; quem
 * desenha é `icons.tsx`. Aqui mora só a decisão.
 *
 * DE ONDE ISTO VEIO. O mapa de serviço → ícone morava dentro de
 * `app/(app)/links/page.tsx`, numa constante de página. Era regra — "que desenho
 * representa uma planilha" — escondida numa tela, sem teste, e invisível para o
 * modal da demanda, que mostra os mesmos links e desenhava só o monograma. Mudar
 * de casa não é arrumação: é o que faz as duas telas concordarem e o que põe a
 * decisão dentro do `prebuild`.
 *
 * TRÊS DECISÕES QUE VALE LER ANTES DE MEXER:
 *
 * 1. **A DEDUÇÃO NÃO SAI DE CENA.** O campo escolhido é a exceção, não o novo
 *    padrão. Link sem escolha continua deduzindo pela URL para sempre — inclusive
 *    os que já estão gravados, que são todos. Um seletor que obrigasse a escolher
 *    transformaria um acerto automático em trabalho manual para dezenas de links.
 *
 * 2. **NOME DESCONHECIDO DEGRADA, NUNCA EMBRANQUECE.** `iconeDoLink` cai no
 *    deduzido quando a escolha não está no catálogo. Isso acontece de verdade: o
 *    catálogo pode ENCOLHER (um ícone sai numa versão futura) e o Firestore
 *    aceita escrita pelo console, que não passa por aqui. A alternativa —
 *    devolver a string crua e mandá-la para `<Icon>` — desenha um SVG vazio: um
 *    quadrado em branco no lugar do selo, que passa por `lint`, por `tsc`, pelo
 *    `next build` e pelo guarda de CSS Modules sem uma linha de aviso.
 *
 * 3. **`ehIconeDeLink` USA `Set`, e o teste existe para provar isso.** A versão
 *    óbvia — `CATALOGO[nome] !== undefined` sobre um objeto literal — responde
 *    `true` para `"constructor"`, `"toString"` e `"valueOf"`, porque objeto
 *    literal herda de `Object.prototype`. O valor vem do banco, então essa não é
 *    uma hipótese acadêmica: seria uma função indo parar dentro do JSX.
 */
import { servicoDe, type CardLink, type ServicoLink } from "./links-core.ts";

/** Uma entrada do catálogo. `nome` é a chave em `PATHS`, dentro de `icons.tsx`. */
export type IconeDeLink = {
  nome: string;
  /** O que se lê no seletor e no `aria-label` da célula. */
  rotulo: string;
  /** O cabeçalho sob o qual a célula aparece. */
  grupo: string;
};

/**
 * A grade do seletor tem seis colunas, e o catálogo tem cinco grupos de seis.
 *
 * O número aparece nos dois lugares porque ele é a mesma decisão dita duas
 * vezes: é a largura da grade no CSS e é o passo de `proximoIndiceNaGrade`.
 * Divergirem faz a seta para baixo pular para a célula errada — e nada quebra,
 * só o teclado passa a mentir sobre onde o foco está.
 */
export const COLUNAS_DA_GRADE = 6;

/**
 * O catálogo oferecido, na ordem de leitura da grade.
 *
 * O QUE O ÍCONE DIZ É O TIPO DA COISA do outro lado — documento, planilha,
 * vídeo, painel —, nunca a marca. É a mesma regra que já governava a dedução, e
 * o motivo continua o mesmo: guardar dezoito logotipos aqui dentro seria carregar
 * dezoito marcas registradas para dizer o que uma palavra diz. Quem nomeia a
 * marca é o selo de texto embaixo do título; quem a colore é `seloDoLink`.
 *
 * `dashboard` ficou DE FORA de propósito, e ele existe em `icons.tsx`: o `d` dele
 * difere do de `trend` em quatro números, e numa célula de 34 px os dois são o
 * mesmo desenho. Oferecer as duas seria pedir à pessoa que escolhesse entre
 * gêmeos — e o teste reprova qualquer par novo com o mesmo traçado, justamente
 * para esta lista não voltar a ter um.
 */
export const ICONES_DE_LINK: readonly IconeDeLink[] = [
  // ---- Documentos ----
  { nome: "relatorios", rotulo: "Documento", grupo: "Documentos" },
  { nome: "pasta", rotulo: "Pasta", grupo: "Documentos" },
  { nome: "planilha", rotulo: "Planilha", grupo: "Documentos" },
  { nome: "apresentacao", rotulo: "Apresentação", grupo: "Documentos" },
  { nome: "prancheta", rotulo: "Formulário", grupo: "Documentos" },
  { nome: "livro", rotulo: "Manual", grupo: "Documentos" },
  // ---- Dados ----
  { nome: "trend", rotulo: "Painel", grupo: "Dados" },
  { nome: "banco", rotulo: "Base de dados", grupo: "Dados" },
  { nome: "dinheiro", rotulo: "Financeiro", grupo: "Dados" },
  { nome: "alvo", rotulo: "Meta", grupo: "Dados" },
  { nome: "rank", rotulo: "Indicadores", grupo: "Dados" },
  { nome: "filter", rotulo: "Consulta", grupo: "Dados" },
  // ---- Mídia ----
  { nome: "video", rotulo: "Vídeo", grupo: "Mídia" },
  { nome: "imagem", rotulo: "Imagem", grupo: "Mídia" },
  { nome: "mic", rotulo: "Áudio", grupo: "Mídia" },
  { nome: "online", rotulo: "Reunião", grupo: "Mídia" },
  { nome: "globo", rotulo: "Site", grupo: "Mídia" },
  { nome: "mapa", rotulo: "Local", grupo: "Mídia" },
  // ---- Trabalho ----
  { nome: "kanban", rotulo: "Quadro", grupo: "Trabalho" },
  { nome: "calendar", rotulo: "Agenda", grupo: "Trabalho" },
  { nome: "clock", rotulo: "Prazo", grupo: "Trabalho" },
  { nome: "users", rotulo: "Pessoas", grupo: "Trabalho" },
  { nome: "recorrencias", rotulo: "Rotina", grupo: "Trabalho" },
  { nome: "check", rotulo: "Checklist", grupo: "Trabalho" },
  // ---- Sinais ----
  { nome: "link", rotulo: "Link", grupo: "Sinais" },
  { nome: "chat", rotulo: "Conversa", grupo: "Sinais" },
  { nome: "edit", rotulo: "Rascunho", grupo: "Sinais" },
  { nome: "warn", rotulo: "Atenção", grupo: "Sinais" },
  { nome: "codigo", rotulo: "Código", grupo: "Sinais" },
  { nome: "estrela", rotulo: "Favorito", grupo: "Sinais" },
];

/** Os grupos na ordem em que aparecem, sem repetir. */
export const GRUPOS_DE_ICONE: readonly string[] = [
  ...new Set(ICONES_DE_LINK.map((i) => i.grupo)),
];

/** Ver a decisão 3 do cabeçalho: `Set`, e não índice em objeto literal. */
const NOMES = new Set(ICONES_DE_LINK.map((i) => i.nome));

export function ehIconeDeLink(nome: string | null | undefined): boolean {
  return typeof nome === "string" && NOMES.has(nome);
}

export function iconePorNome(nome: string): IconeDeLink | undefined {
  return ICONES_DE_LINK.find((i) => i.nome === nome);
}

/**
 * Serviço reconhecido → o ícone que o representa quando ninguém escolheu.
 *
 * `Record` TOTAL, e não `Partial`, pelo mesmo motivo de `CORES` em
 * `links-core.ts`: serviço novo sem ícone passa a reprovar no `tsc`. Com
 * `Partial`, ele degradaria calado para o monograma — que é indistinguível de
 * "este link é de um domínio que ninguém conhece", e a pessoa nunca saberia que
 * faltou cadastrar.
 *
 * `generico` fica de fora da lista de propósito: ele não tem ícone, tem
 * monograma. É `iconeDoLink` devolvendo `null` que diz isso à tela.
 */
const ICONE_DO_SERVICO: Record<Exclude<ServicoLink, "generico">, string> = {
  drive: "pasta",
  docs: "relatorios",
  sheets: "planilha",
  slides: "apresentacao",
  forms: "prancheta",
  looker: "trend",
  powerbi: "trend",
  youtube: "video",
  meet: "online",
  calendar: "calendar",
  github: "codigo",
  figma: "edit",
  notion: "livro",
  trello: "kanban",
  whatsapp: "chat",
  pdf: "relatorios",
  planilha: "planilha",
};

/**
 * O ícone deste link. `null` significa "desenhe o monograma".
 *
 * A ordem é escolha → dedução → monograma, e o meio dela é o que importa: uma
 * escolha que o catálogo não conhece cai na DEDUÇÃO, não no monograma. Quem
 * gravou "planilha" numa versão em que esse nome existia não perde o desenho
 * quando o catálogo mudar; perde a escolha, e volta ao que o app já sabia.
 */
export function iconeDoLink(l: CardLink): string | null {
  if (ehIconeDeLink(l.icone)) return l.icone as string;
  const servico = servicoDe(l.url);
  return servico === "generico" ? null : ICONE_DO_SERVICO[servico];
}

/**
 * A lista de links com o ícone trocado — ou `null` quando não há o que gravar.
 *
 * `null` é a resposta única para as três situações em que a escrita seria
 * desperdício ou dano: o id não está na lista (o link foi removido por outra
 * pessoa enquanto esta aba estava aberta), o valor já é o que está lá, e o nome
 * não está no catálogo. Quem chama testa uma coisa só, e não há caminho em que
 * uma escrita inútil chegue ao banco "só desta vez".
 *
 * VOLTAR AO AUTOMÁTICO É `icone: null`, e ele RECONSTRÓI O OBJETO SEM A CHAVE —
 * não a define como `undefined`. A diferença não é estética: o SDK do Firestore
 * lança `Unsupported field value: undefined` no `updateDoc`, porque
 * `firebase.ts` usa `getFirestore` cru, sem `ignoreUndefinedProperties`. Um
 * `{ ...l, icone: undefined }` compila, passa no `tsc` e explode em produção no
 * clique de "Automático".
 */
export function aplicarIcone(
  links: readonly CardLink[],
  linkId: string,
  icone: string | null,
): CardLink[] | null {
  const alvo = links.find((l) => l.id === linkId);
  if (!alvo) return null;

  if (icone === null) {
    if (alvo.icone === undefined) return null;
    return links.map((l) => {
      if (l.id !== linkId) return l;
      // Desestruturação para descartar a chave. O `_` é lido pelo eslint como
      // variável não usada, e o nome com underscore é o que a configuração do
      // projeto aceita para "descartado de propósito".
      const { icone: _descartado, ...resto } = l;
      void _descartado;
      return resto;
    });
  }

  if (!ehIconeDeLink(icone)) return null;
  if (alvo.icone === icone) return null;
  return links.map((l) => (l.id === linkId ? { ...l, icone } : l));
}

/**
 * O índice seguinte na grade, a partir de uma tecla.
 *
 * `-1` NÃO É "NENHUM": é a linha larga do "Automático", que fica acima da grade
 * e é uma opção como as outras. Tratá-la como ausência de seleção obrigaria a
 * tela a ter dois modelos de foco — um para a linha, outro para as células — e o
 * caminho entre eles seria escrito à mão nos dois sentidos.
 *
 * TRAVA NAS QUATRO BORDAS, não dá a volta. Grade que circula é ótima para um
 * menu de seis itens e péssima para trinta em cinco grupos: quem segura a seta
 * para baixo esperando chegar ao fim recomeça do topo sem perceber, e passa
 * duas vezes pelo mesmo ícone achando que são dois.
 */
export function proximoIndiceNaGrade(
  atual: number,
  tecla: string,
  colunas: number,
  total: number,
): number {
  if (total <= 0) return -1;
  // Índice vindo de fora pode ser qualquer coisa (estado antigo, catálogo que
  // encolheu). Prender aqui evita que uma tecla devolva algo fora da lista.
  const a = Math.min(Math.max(atual, -1), total - 1);

  switch (tecla) {
    case "Home":
      return -1;
    case "End":
      return total - 1;
    case "ArrowRight":
      return a < 0 ? 0 : Math.min(a + 1, total - 1);
    case "ArrowLeft":
      // Da primeira célula para a esquerda não se sai da grade: "Automático"
      // está ACIMA, e é a seta para cima que leva até ele. Sair pelo lado
      // faria a linha larga ser alcançada por dois caminhos diferentes.
      return a <= 0 ? a : a - 1;
    case "ArrowDown":
      if (a < 0) return 0;
      return a + colunas <= total - 1 ? a + colunas : a;
    case "ArrowUp":
      if (a < 0) return -1;
      return a - colunas >= 0 ? a - colunas : -1;
    default:
      return a;
  }
}
