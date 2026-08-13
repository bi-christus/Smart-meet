/**
 * De um erro de leitura para uma frase que a pessoa consegue agir.
 *
 * O PROBLEMA: hoje, quando uma assinatura do Firestore falha, o app não diz
 * nada — a tela fica no vazio, indistinguível de "não há nada aqui". Quando
 * passar a dizer, não pode dizer o que o Firestore diz. "Missing or
 * insufficient permissions." não é português, não diz de que setor se trata e
 * não sugere o que fazer; é o texto de quem escreveu o banco, não de quem usa o
 * sistema. Traduzir na hora, em cada uma das oito telas, é garantir oito
 * traduções diferentes.
 *
 * A DISTINÇÃO QUE CARREGA O MÓDULO é entre falha que passa e falha que não
 * passa. "Não conseguimos falar com o servidor" pede um botão "Tentar de novo";
 * "Você não tem acesso a este setor" pede que a pessoa fale com alguém — e
 * oferecer "Tentar de novo" aqui é pior do que não oferecer nada, porque
 * promete uma saída que não existe e a pessoa clica cinco vezes antes de
 * desistir. Por isso `podeTentarDeNovo` é campo, e não é sempre `true`.
 *
 * Módulo PURO: sem `react`, sem `firebase`, sem `@/`. É o que permite
 * `scripts/test-erro-ui.mjs` rodar em Node puro no prebuild — e é lá que está
 * escrito, como asserção, que nenhuma mensagem crua do Firestore atravessa
 * daqui para a tela.
 */

export type ClasseErro =
  | "permissao"
  | "sessao"
  | "rede"
  | "limite"
  | "config"
  | "desconhecido";

export type MensagemErro = {
  classe: ClasseErro;
  /** Nome do ícone em `components/icons.tsx`. */
  icone: string;
  titulo: string;
  descricao: string;
  /** `false` quando repetir a MESMA leitura daria exatamente o mesmo resultado. */
  podeTentarDeNovo: boolean;
};

/**
 * O código do erro, normalizado.
 *
 * O Firestore devolve `permission-denied`; o SDK de auth devolve
 * `auth/network-request-failed`. O prefixo antes da barra é do produto, não do
 * problema, então some — assim uma falha de rede é a mesma falha de rede tenha
 * ela vindo de onde vier.
 */
export function codigoDe(erro: unknown): string {
  if (typeof erro !== "object" || erro === null) return "";
  const bruto = (erro as { code?: unknown }).code;
  if (typeof bruto !== "string") return "";
  const semPrefixo = bruto.includes("/") ? bruto.split("/").pop() : bruto;
  return (semPrefixo ?? "").trim().toLowerCase();
}

const PERMISSAO: MensagemErro = {
  classe: "permissao",
  icone: "lock",
  titulo: "Você não tem acesso a este setor",
  descricao:
    "Seu usuário não tem permissão para ler estes dados. Peça acesso a quem administra o sistema.",
  podeTentarDeNovo: false,
};

const SESSAO: MensagemErro = {
  classe: "sessao",
  icone: "lock",
  titulo: "Sua sessão expirou",
  descricao: "Saia e entre de novo para continuar de onde você parou.",
  podeTentarDeNovo: false,
};

const REDE: MensagemErro = {
  classe: "rede",
  icone: "warn",
  titulo: "Não conseguimos falar com o servidor",
  descricao: "Verifique sua conexão e tente de novo.",
  podeTentarDeNovo: true,
};

const SEM_CONEXAO: MensagemErro = {
  classe: "rede",
  icone: "warn",
  titulo: "Você está sem conexão",
  descricao:
    "Os dados voltam sozinhos assim que a internet voltar. Se já voltou, tente de novo.",
  podeTentarDeNovo: true,
};

const LIMITE: MensagemErro = {
  classe: "limite",
  icone: "clock",
  titulo: "O sistema atingiu o limite de leituras",
  descricao: "Aguarde alguns instantes e tente de novo.",
  podeTentarDeNovo: true,
};

const CONFIG: MensagemErro = {
  classe: "config",
  icone: "warn",
  titulo: "Esta consulta precisa de um ajuste no sistema",
  descricao:
    "Não é algo que dê para resolver por aqui. Avise quem administra o sistema.",
  podeTentarDeNovo: false,
};

const DESCONHECIDO: MensagemErro = {
  classe: "desconhecido",
  icone: "warn",
  titulo: "Não foi possível carregar",
  descricao:
    "Algo deu errado ao buscar estes dados. Tente de novo; se continuar, avise quem administra o sistema.",
  podeTentarDeNovo: true,
};

/**
 * `failed-precondition` e `invalid-argument` quase sempre são índice do
 * Firestore faltando — erro nosso, de deploy, não de quem está usando. Fica
 * numa classe própria porque a ação é diferente das outras duas: não adianta
 * tentar de novo (é determinístico) nem pedir acesso (a permissão está certa).
 */
const POR_CODIGO: Record<string, MensagemErro> = {
  "permission-denied": PERMISSAO,
  unauthenticated: SESSAO,
  "user-token-expired": SESSAO,
  unavailable: REDE,
  "deadline-exceeded": REDE,
  cancelled: REDE,
  "network-request-failed": REDE,
  "resource-exhausted": LIMITE,
  "quota-exceeded": LIMITE,
  "failed-precondition": CONFIG,
  "invalid-argument": CONFIG,
};

/**
 * Falha de transporte — a que estar sem rede explica. As outras, não.
 *
 * Uma negação de permissão foi o servidor DIZENDO não, e continua valendo com o
 * wi-fi caído; trocá-la por "você está sem conexão" mandaria a pessoa consertar
 * a internet para um problema que a internet não causou.
 */
const EXPLICADAS_POR_ESTAR_OFFLINE: ReadonlySet<ClasseErro> = new Set([
  "rede",
  "desconhecido",
]);

/**
 * Classifica o erro de uma leitura.
 *
 * @param online o que o navegador acha da conexão. Vem de fora porque
 *   `navigator` não existe aqui — e porque a resposta muda com ele: o Firestore
 *   reporta `unavailable` tanto para servidor fora do ar quanto para a máquina
 *   sem rede, e essas duas frases pedem calmas diferentes de quem lê.
 */
export function classificarErro(erro: unknown, online = true): MensagemErro {
  const mensagem = POR_CODIGO[codigoDe(erro)] ?? DESCONHECIDO;
  if (!online && EXPLICADAS_POR_ESTAR_OFFLINE.has(mensagem.classe)) {
    return SEM_CONEXAO;
  }
  return mensagem;
}

/**
 * A frase de uma AÇÃO que falhou — salvar, excluir, trocar a foto.
 *
 * Um `setErr("Não foi possível remover.")` escondeu por dias uma negação de
 * permissão em produção: a frase não dizia de quem era o problema nem o que
 * fazer, e o código do Firestore só aparecia para quem soubesse expandir um
 * objeto no console. Esta função existe para que isso não se repita.
 *
 * `classificarErro` foi escrito para LEITURA: o título genérico dele é "Não foi
 * possível carregar", e quem clicou em Salvar não estava carregando nada. Daí
 * esta função, que põe a ação na frente e aproveita do módulo o que independe
 * do verbo — o título quando ele NOMEIA a causa (permissão, sessão, rede,
 * limite, ajuste), e a última frase da descrição, que é onde mora o que fazer
 * agora, em todas as classes.
 *
 * Vive aqui, e não em cada tela, porque nasceu duplicada em duas: o modal da
 * demanda e o da foto de perfil. Duas cópias de uma regra de redação divergem
 * na primeira vez que alguém melhora uma delas, e ninguém percebe — cada tela
 * continua funcionando perfeitamente com a versão velha.
 *
 * `online` vem de fora pelo mesmo motivo de `classificarErro`, e por um a mais:
 * o Node tem `navigator` desde a 21, mas sem `onLine` — ler o global aqui daria
 * "offline" dentro do teste, e a suíte passaria a provar a frase errada.
 *
 * O código do Firestore NÃO entra na frase; ele vai para o `console.error`. É a
 * asserção que este arquivo guarda e que o `prebuild` faz valer.
 */
export function fraseDeFalha(
  acao: string,
  erro: unknown,
  online = true,
): string {
  const m = classificarErro(erro, online);
  const oQueFazer = m.descricao.split(". ").pop() ?? m.descricao;
  const causa = m.classe === "desconhecido" ? "" : `${m.titulo}. `;
  return `${acao} ${causa}${oQueFazer}`;
}
