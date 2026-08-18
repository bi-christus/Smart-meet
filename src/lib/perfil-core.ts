/**
 * O card do perfil, sem o React e sem o banco.
 *
 * Módulo puro (AGENTS.md §4): sem `firebase/firestore`, sem DOM, sem React. O
 * próprio arquivo de teste é a prova — ele importa isto sob Node puro, sem
 * bundler, e um `import` de SDK aqui dentro faz o `prebuild` ficar vermelho
 * antes de o deploy sair.
 *
 * `Role` E `ROLE_LABEL` MUDARAM DE CASA para cá, e `users.ts` passa a
 * reexportá-los — como ele já faz com `avatarDe` e os limites da foto. Não é
 * arrumação: `users.ts` importa `firebase/firestore` na primeira linha, então um
 * core que buscasse o rótulo do papel lá dentro deixaria de ser core. A porta
 * continua sendo uma só para as telas; o que mudou é de que lado dela mora a
 * tabela.
 *
 * O QUE ESTE MÓDULO DECIDE são as duas coisas que o diálogo errava calado:
 *
 * 1. **O que o cabeçalho mostra quando o cadastro está incompleto.** Nome em
 *    branco, papel que não está na tabela, `sectors` ausente — todos existem no
 *    banco, e a versão anterior respondia `undefined` para os três, que o React
 *    desenha como nada. Um perfil sem nome nenhum é pior do que um perfil com o
 *    e-mail no lugar do nome.
 *
 * 2. **O que o botão de salvar promete.** Ele governa três campos (nome, foto e
 *    moldura) e um "Salvar" genérico não diz se a foto entra junto — que é
 *    justamente a dúvida de quem mexeu num campo só. Um "Salvando…" seco teria o
 *    mesmo defeito do "Carregando…" que o AGENTS.md §3 proíbe: anuncia que algo
 *    acontece sem dizer o quê.
 *
 * O QUE ELE NÃO DECIDE, de propósito: o estado assíncrono dos emblemas. Essa
 * regra já é `async-data-core.ts` (`data: T[] | undefined` + `juntarFontes`), que
 * tem teste próprio no `prebuild`. Uma segunda versão dela aqui seria uma segunda
 * verdade sobre o que significa "ainda não respondeu".
 */

export type Role = "admin" | "gestor" | "operador";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  operador: "Operador",
};

/**
 * O mínimo que o cabeçalho precisa saber de alguém.
 *
 * ESTRUTURAL, e não `Pick<UserProfile, …>`: nenhum `*-core` deste repositório
 * importa de `@/`, e este não vai ser o primeiro. `UserProfile` satisfaz esta
 * forma sem que o core saiba que ele existe — que é a direção certa da seta.
 *
 * Tudo é opcional menos o e-mail, porque o e-mail é a chave do documento e a
 * única coisa que sempre existe. O resto é o que um cadastro real pode não ter.
 */
export type PessoaDoCabecalho = {
  email: string;
  name?: string | null;
  role?: string | null;
  cargo?: string | null;
  sectors?: string[] | null;
};

/**
 * O cabeçalho do card, já resolvido — sem `undefined` em campo nenhum.
 *
 * `cargo` devolve `null` e NÃO "não informado": quem decide como o vazio se
 * parece é o TSX, que o pinta em itálico apagado. Um texto de ausência gravado
 * aqui apareceria igualzinho a um cargo de verdade chamado "não informado", e a
 * tela perderia a chance de diferenciá-los.
 *
 * `papel` cai para o valor CRU quando ele não está na tabela. É melhor mostrar
 * "supervisor" — um papel que uma versão futura pode ter criado — do que apagar
 * a linha e afirmar, em silêncio, que a pessoa não tem papel nenhum.
 */
export function cabecalhoDe(p: PessoaDoCabecalho): {
  nome: string;
  cargo: string | null;
  papel: string;
  setores: string[];
  email: string;
} {
  const email = (p.email ?? "").trim();
  const nome = (p.name ?? "").trim();
  const cargo = (p.cargo ?? "").trim();
  const role = (p.role ?? "").trim();

  return {
    // O e-mail é a reserva porque é o que identifica a pessoa para quem está
    // lendo — e é o mesmo critério que `subscribeUsers` já usa para ordenar.
    nome: nome || email,
    cargo: cargo || null,
    papel: role ? (ROLE_LABEL[role as Role] ?? role) : "—",
    setores: (p.sectors ?? []).map((s) => s.trim()).filter(Boolean),
    email,
  };
}

/** Em que estado está a foto que ainda não foi gravada. */
export type FotoPendente = "nova" | "remover" | null;

export type Pendencias = {
  nome: boolean;
  foto: FotoPendente;
  moldura: boolean;
  /** Há o que salvar? É este o portão do botão, não a soma dos três. */
  alguma: boolean;
  /** O que o botão escreve agora — ocioso ou gravando. */
  rotulo: string;
};

/**
 * Um dos três eixos mudou? E o que o botão passa a dizer?
 *
 * A MOLDURA JÁ ESTÁ AQUI, e ela ainda não existe na tela quando este arquivo
 * nasce. É de propósito: a frente da moldura entra depois, e sem o eixo pronto
 * ela teria de reabrir a tabela de rótulos inteira — que é exatamente o lugar
 * onde um caso se perde calado. O consumidor passa `molduraPendente: undefined`
 * enquanto não houver seletor, e o eixo fica em `false` sem custo nenhum.
 *
 * ELE NÃO RESPONDE POR `preparando`. Cortar a imagem é uma espera de outra
 * natureza — a pessoa não tem o que salvar ainda, e o botão fica desabilitado
 * por `ocupado`, no TSX. Trazer isso para cá misturaria "há o que gravar?" com
 * "dá para gravar agora?", que são perguntas diferentes com respostas
 * diferentes.
 */
export function mudancasPendentes(e: {
  nome: string;
  nomeSalvo: string;
  /** `undefined` = ninguém mexeu · `null` = pediu remoção · string = escolheu. */
  fotoPendente: string | null | undefined;
  /** `undefined` = ninguém mexeu · string = escolheu (inclusive "nenhuma"). */
  molduraPendente: string | undefined;
  molduraSalva: string;
  gravando: boolean;
}): Pendencias {
  // Comparação por `trim` nos dois lados: digitar um espaço no fim e apagá-lo
  // deixaria o botão aceso prometendo salvar uma diferença que não existe.
  const nome = e.nome.trim() !== e.nomeSalvo.trim();

  const foto: FotoPendente =
    e.fotoPendente === undefined
      ? null
      : e.fotoPendente === null
        ? "remover"
        : "nova";

  // Escolher a moldura que já está gravada NÃO é mudança. Sem isto, abrir o
  // seletor e clicar na opção atual acenderia o botão de salvar.
  const moldura =
    e.molduraPendente !== undefined && e.molduraPendente !== e.molduraSalva;

  const alguma = nome || foto !== null || moldura;

  return {
    nome,
    foto,
    moldura,
    alguma,
    rotulo: rotuloDoSalvar({ nome, foto, moldura, gravando: e.gravando }),
  };
}

/** "o nome" / "a moldura" — para a frase de gerúndio ficar em português. */
const COM_ARTIGO: Record<string, string> = {
  nome: "o nome",
  foto: "a foto",
  moldura: "a moldura",
};

/**
 * O rótulo do botão, COMPOSTO em vez de tabelado.
 *
 * A tabela literal seria 23 braços de ternário — três eixos, com o da foto
 * valendo dois estados, vezes ocioso e gravando. Escrita à mão, ela erra
 * exatamente no caso que ninguém enumera (remover a foto E trocar a moldura), e
 * erra em silêncio: o botão diz "Salvar foto" e o que acontece é uma remoção.
 * Composta, os casos nascem todos, e o teste confere que nenhum par de
 * combinações diferentes produz a mesma frase.
 *
 * A REMOÇÃO GOVERNA A FRASE quando existe. "Salvar foto" para quem pediu para
 * tirá-la é a promessa oposta do que o clique faz — e é o acerto do ternário
 * antigo que uma reescrita perderia calada.
 */
function rotuloDoSalvar(p: {
  nome: boolean;
  foto: FotoPendente;
  moldura: boolean;
  gravando: boolean;
}): string {
  const outros = [p.nome && "nome", p.moldura && "moldura"].filter(
    (x): x is string => !!x,
  );

  if (p.foto === "remover") {
    if (p.gravando) {
      if (outros.length === 0) return "Removendo a foto…";
      if (outros.length === 1)
        return `Removendo a foto e salvando ${COM_ARTIGO[outros[0]]}…`;
      return "Removendo a foto e salvando o resto…";
    }
    if (outros.length === 0) return "Remover foto";
    if (outros.length === 1) return `Remover foto e salvar ${outros[0]}`;
    return "Remover foto e salvar o resto";
  }

  const itens = [
    p.nome && "nome",
    p.foto === "nova" && "foto",
    p.moldura && "moldura",
  ].filter((x): x is string => !!x);

  if (p.gravando) {
    // Inalcançável pela tela — `alguma === false` desabilita o botão, então não
    // há como estar gravando sem nada pendente. A frase existe para o tipo ser
    // total, e é a única do conjunto que não nomeia o que faz, porque não há o
    // que nomear.
    if (itens.length === 0) return "Salvando…";
    if (itens.length === 1) return `Salvando ${COM_ARTIGO[itens[0]]}…`;
    if (itens.length === 2) return `Salvando ${itens[0]} e ${itens[1]}…`;
    return "Salvando nome, foto e moldura…";
  }

  if (itens.length === 0) return "Salvar";
  if (itens.length === 1) return `Salvar ${itens[0]}`;
  if (itens.length === 2) return `Salvar ${itens[0]} e ${itens[1]}`;
  return "Salvar nome, foto e moldura";
}
