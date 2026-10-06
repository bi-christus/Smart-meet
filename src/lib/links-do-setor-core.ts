/**
 * Os links do setor — o cadastro da aba Links, sem o banco.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * fala com o banco é `links-do-setor.ts`, o irmão, e é isto que permite
 * `scripts/test-links-do-setor.mjs` conferir a régua inteira em Node puro.
 *
 * DE ONDE ISTO VEIO. A aba Links nasceu sem cadastro próprio: ela lia os
 * `links` de dentro dos cards e virava o avesso, um card por link, com o
 * TÍTULO DA DEMANDA em destaque. Usada como catálogo dos aplicativos do setor —
 * o painel do Power BI, a planilha de custos, o sistema da clínica —, isso deu
 * três defeitos que nenhum ajuste de tela resolvia:
 *
 * 1. Para um link aparecer, ele precisava de uma demanda que o hospedasse. Quem
 *    queria só registrar "onde fica o painel de vendas" tinha de abrir um card
 *    de mentira no Kanban.
 * 2. O nome em destaque era o da demanda, não o do aplicativo. "Ajustar filtro
 *    do relatório de março" não diz a ninguém que ali mora o painel de vendas.
 * 3. Não havia onde dizer O QUE é o aplicativo — o campo não existia no link do
 *    card, e a descrição da demanda fala do trabalho, não da ferramenta.
 *
 * Por isso o link da aba virou documento próprio (`/links`), com nome e
 * descrição escritos por quem cadastra. O link de DENTRO da demanda continua
 * onde estava, no modal do card: ele responde "o que esta demanda usa", e é
 * outra pergunta.
 *
 * A URL continua passando pela MESMA régua de `links-core` — `normalizarUrl` é
 * portão de segurança (o valor vai para um `href`), e uma segunda cópia dele
 * aqui seria o primeiro passo para as duas discordarem sobre o que é seguro.
 */
import { dominioDe, normalizarUrl, SERVICO_ROTULO, servicoDe } from "./links-core.ts";

/**
 * Os tetos dos campos. Espelhados em `linkOk()`, no `firestore.rules`, e
 * `test-links-do-setor.mjs` reprova se as duas cópias se afastarem.
 *
 * Os números contam UNIDADES UTF-16, que é o que `String.length` conta aqui e o
 * que `size()` conta nas regras — a mesma unidade dos dois lados, sem conversão
 * (o mesmo raciocínio que está escrito em `nomeOk()` das regras).
 */
export const LIMITE_NOME_LINK = 80;
export const LIMITE_DESCRICAO_LINK = 300;
export const LIMITE_URL_LINK = 2048;

export type LinkDoSetor = {
  /** id do documento. */
  id: string;
  /** Setor de execução dono do link — é a chave do escopo nas regras. */
  setor: string;
  nome: string;
  /** `""` quando ninguém escreveu. Nunca `undefined`: a tela testa uma coisa só. */
  descricao: string;
  /** Já passou por `normalizarUrl` na gravação. A tela confere de novo. */
  url: string;
  /** O ícone escolhido. Ausente = deduzido da URL, como no link da demanda. */
  icone?: string;
  /** E-mail de quem cadastrou. */
  createdBy: string;
  /** Milissegundos; `null` só no instante entre a gravação e o eco do servidor. */
  createdAt: number | null;
  updatedBy?: string;
  updatedAt?: number | null;
};

/** O que o formulário entrega: texto cru, do jeito que foi digitado. */
export type RascunhoDeLink = {
  nome: string;
  descricao: string;
  url: string;
};

export type CampoDoLink = "nome" | "descricao" | "url";

export type LinkConferido =
  | { ok: true; dados: RascunhoDeLink }
  | { ok: false; campo: CampoDoLink; motivo: string };

/**
 * Tem pelo menos uma letra ou um dígito — a mesma pergunta de `nomeOk()` nas
 * regras, e não "sobrou algo depois do trim". O `trim()` do JavaScript apara o
 * espaço inquebrável e o do CEL não; perguntar por letra ou dígito responde
 * igual nas duas linguagens e ainda recusa "...", "-" e o emoji solitário.
 */
const TEM_CONTEUDO = /[\p{L}\p{N}]/u;

/**
 * A régua do formulário, aplicada ANTES do banco.
 *
 * A regra do Firestore é a segunda barreira e só sabe dizer "sem permissão" —
 * a mensagem errada para quem esqueceu o nome ou colou um endereço quebrado. O
 * motivo volta com o CAMPO, para a tela apontar onde está o problema em vez de
 * deixar a pessoa adivinhar qual dos três foi recusado.
 *
 * O nome vem antes do endereço porque é o primeiro campo do formulário: a
 * pessoa corrige de cima para baixo, e apontar o segundo campo com o primeiro
 * ainda vazio a faria subir e descer.
 */
export function conferirLink(bruto: Partial<RascunhoDeLink>): LinkConferido {
  const nome = typeof bruto.nome === "string" ? bruto.nome.trim() : "";
  if (!nome || !TEM_CONTEUDO.test(nome)) {
    return { ok: false, campo: "nome", motivo: "Dê um nome ao link." };
  }
  if (nome.length > LIMITE_NOME_LINK) {
    return {
      ok: false,
      campo: "nome",
      motivo: `O nome passa de ${LIMITE_NOME_LINK} caracteres.`,
    };
  }

  const urlBruta = typeof bruto.url === "string" ? bruto.url.trim() : "";
  if (!urlBruta) {
    return { ok: false, campo: "url", motivo: "Cole o endereço do link." };
  }
  const url = normalizarUrl(urlBruta);
  if (!url) {
    return {
      ok: false,
      campo: "url",
      motivo: "Este endereço não é um link http ou https válido.",
    };
  }
  if (url.length > LIMITE_URL_LINK) {
    return {
      ok: false,
      campo: "url",
      motivo: `O endereço passa de ${LIMITE_URL_LINK} caracteres.`,
    };
  }

  const descricao =
    typeof bruto.descricao === "string" ? bruto.descricao.trim() : "";
  if (descricao.length > LIMITE_DESCRICAO_LINK) {
    return {
      ok: false,
      campo: "descricao",
      motivo: `A descrição passa de ${LIMITE_DESCRICAO_LINK} caracteres.`,
    };
  }

  return { ok: true, dados: { nome, descricao, url } };
}

/** Caixa e espaço sobrando não fazem dois nomes diferentes. */
function chaveDeNome(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR");
}

/**
 * O cadastro já tem este link NO MESMO SETOR? Devolve o campo e a frase que a
 * tela mostra — o campo, para o formulário apontar qual dos dois repete.
 *
 * Duas perguntas, nesta ordem:
 *
 * - MESMO ENDEREÇO é a duplicata de verdade: o mesmo painel cadastrado duas
 *   vezes, com nomes diferentes, divide quem procura entre dois cards. Compara
 *   normalizado, pelo motivo de `jaTem` em `links-core`: o segundo cadastro
 *   raramente cola a URL do mesmo jeito que o primeiro.
 * - MESMO NOME com endereço diferente é o caso em que a pessoa lê os dois cards
 *   e não sabe qual abrir. O nome é o que este cadastro existe para dar ao
 *   link; dois iguais no mesmo setor desfazem isso.
 *
 * Só dentro do setor: o B.I. e as Cantinas podem ter cada um o seu
 * "Painel de consumo" sem que um saiba do outro — eles nem se enxergam.
 *
 * `ignorarId` é o próprio link na edição; sem ele, salvar sem mudar nada
 * acusaria o link de ser duplicata de si mesmo.
 *
 * Como em `addSetor` e `addDimensao`, a conferência é contra a lista que a TELA
 * já tem. Duas pessoas cadastrando o mesmo endereço no mesmo segundo criam dois
 * documentos — e uma transação por causa de um empate que ninguém viu
 * acontecer seria caro demais para um cadastro deste tamanho.
 */
export function conflitoDeLink(
  dados: Pick<RascunhoDeLink, "nome" | "url">,
  setor: string,
  existentes: readonly LinkDoSetor[],
  ignorarId?: string,
): { campo: CampoDoLink; motivo: string } | null {
  const doSetor = existentes.filter((l) => l.setor === setor && l.id !== ignorarId);

  const alvo = normalizarUrl(dados.url);
  if (alvo) {
    const mesmoEndereco = doSetor.find((l) => normalizarUrl(l.url) === alvo);
    if (mesmoEndereco) {
      return {
        campo: "url",
        motivo: `Este endereço já está cadastrado como “${mesmoEndereco.nome}”.`,
      };
    }
  }

  const nome = chaveDeNome(dados.nome);
  const mesmoNome = doSetor.find((l) => chaveDeNome(l.nome) === nome);
  if (mesmoNome) {
    return {
      campo: "nome",
      motivo: `Já existe um link chamado “${mesmoNome.nome}” neste setor.`,
    };
  }
  return null;
}

/** Texto que é texto; qualquer outra coisa vira vazio. */
function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Número finito, ou `null`. */
function instante(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * O documento lido, do jeito que a tela pode confiar — ou `null`.
 *
 * Documento ilegível é DESCARTADO, não derruba a lista: o Firestore aceita
 * escrita pelo console e pelo Admin SDK, que não passam pelas regras, e um
 * único documento torto não pode deixar a aba inteira em branco. É a mesma
 * escolha de `normalizarDimensao`.
 *
 * O que descarta é o mínimo para o card existir: nome e setor. Endereço
 * inválido NÃO descarta — o card aparece sem abrir nada (a tela confere a URL
 * de novo antes do `href`) e continua editável, que é o único jeito de alguém
 * consertá-lo sem abrir o console.
 *
 * As datas chegam já em milissegundos: converter o `Timestamp` do SDK é tarefa
 * do irmão, que é quem conhece o SDK.
 */
export function normalizarLinkDoSetor(id: string, bruto: unknown): LinkDoSetor | null {
  if (!bruto || typeof bruto !== "object") return null;
  const d = bruto as Record<string, unknown>;
  const nome = texto(d.nome);
  const setor = texto(d.setor);
  if (!nome || !setor) return null;

  const link: LinkDoSetor = {
    id,
    setor,
    nome,
    descricao: texto(d.descricao),
    url: typeof d.url === "string" ? d.url.trim() : "",
    createdBy: texto(d.createdBy),
    createdAt: instante(d.createdAt),
  };
  // A chave só existe quando há valor. `icone: undefined` é diferente de
  // ausente para o SDK do Firestore, e um objeto lido daqui pode voltar numa
  // escrita — é o tropeço que `aplicarIcone` já documenta em `icones-core`.
  const icone = texto(d.icone);
  if (icone) link.icone = icone;
  const updatedBy = texto(d.updatedBy);
  if (updatedBy) link.updatedBy = updatedBy;
  if (d.updatedAt !== undefined) link.updatedAt = instante(d.updatedAt);
  return link;
}

/**
 * A ordem da grade: pelo NOME, em ordem alfabética.
 *
 * A aba antiga ordenava pelo mais recente, porque o card trazia o título de uma
 * demanda e "o link colado hoje" era o que alguém tinha vindo procurar. Num
 * catálogo com nome próprio, a pessoa procura pelo nome — e lista de nomes fora
 * da ordem alfabética obriga a ler a grade inteira para achar um.
 *
 * `sensitivity: "base"` junta caixa e acento ("Ágil" ao lado de "agenda"), e o
 * desempate pelo id garante a mesma ordem em todo render, para dois nomes
 * iguais em setores diferentes não trocarem de lugar sozinhos.
 */
export function ordenarLinks(links: readonly LinkDoSetor[]): LinkDoSetor[] {
  return [...links].sort(
    (a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * A busca da aba: nome, descrição, domínio e o nome do serviço.
 *
 * O serviço entra porque é assim que se procura uma ferramenta sem lembrar o
 * nome que alguém deu a ela: "power bi" acha os painéis do Power BI, mesmo os
 * cadastrados como "Vendas por unidade". Ele já aparece escrito no card, então
 * a busca não promete nada que a tela não mostre.
 *
 * Sem acento e sem caixa dos dois lados: quem digita "manutencao" está
 * procurando "Manutenção", e o teclado do celular nem sempre ajuda.
 */
export function casaBusca(link: LinkDoSetor, busca: string): boolean {
  const q = semAcento(busca.trim());
  if (!q) return true;
  const servico = servicoDe(link.url);
  const campos = [
    link.nome,
    link.descricao,
    dominioDe(link.url),
    servico === "generico" ? "" : SERVICO_ROTULO[servico],
  ];
  return campos.some((c) => semAcento(c).includes(q));
}

function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
