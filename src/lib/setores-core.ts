/**
 * O cadastro de setores de EXECUÇÃO, sem o banco.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * fala com o banco é `setores.ts`, o irmão, e é isto que permite
 * `scripts/test-setores.mjs` rodar a decisão inteira em Node puro.
 *
 * POR QUE ESTE ARQUIVO PASSOU A EXISTIR. Até aqui, setor de execução não era
 * cadastro: era a constante `DEFAULT_SECTORS = ["B.I."]` em `users.ts`, copiada
 * como regra em nove telas. Pôr uma pessoa num setor novo custava um deploy — e
 * foi exatamente isso que travou a entrada da Direção no app, que não tinha
 * onde existir. Cadastro que só o build muda não é cadastro; é código com nome
 * de dado.
 *
 * NÃO CONFUNDIR COM `/solicitanteSetores`. Aquele é quem PEDE a demanda, tem
 * cadastro próprio desde sempre e treze entradas. Este é quem FAZ. A distinção
 * é a mesma que o comentário de `DEFAULT_SECTORS` explicava, e ela continua
 * valendo — o que mudou é que agora os dois lados são dado.
 */

/**
 * O piso: o que uma tela enxerga enquanto o cadastro não respondeu.
 *
 * É o valor que `DEFAULT_SECTORS` tinha, e ele continua sendo "B.I." pelo
 * motivo de sempre: a conferência do banco achou os cards, as reuniões e as
 * colunas todos nessa grafia.
 *
 * EXISTE PARA QUE NENHUMA TELA RENDERIZE COM ZERO SETORES. As nove páginas
 * montam a chave de assinatura com `sectors.join("|")`; lista vazia produz a
 * chave `""`, e o quadro fica em branco sem erro nenhum — que é o falso vazio
 * que este projeto já caçou uma vez. Piso errado por um instante é melhor do
 * que tela vazia sem explicação.
 */
export const SETORES_SEMENTE: readonly string[] = ["B.I."];

/** Quanto cabe no nome de um setor. Espelhado em `firestore.rules`. */
export const LIMITE_SETOR_CHARS = 40;

/** Um setor do cadastro. `id` é o do documento; `nome` é o que se lê. */
export type Setor = { id: string; nome: string };

export type NomeDeSetorConferido =
  | { ok: true; nome: string }
  | { ok: false; motivo: string };

/**
 * A régua do campo, aplicada ANTES do banco.
 *
 * A regra do Firestore é a segunda barreira, não a primeira, e pelo motivo que
 * `saveOwnProfile` já documenta: ela só sabe responder "sem permissão", que é a
 * mensagem errada para quem digitou um espaço. O teto de caracteres é o mesmo
 * dos dois lados, e `test-setores.mjs` reprova se um andar sem o outro.
 */
export function conferirNomeDeSetor(bruto: unknown): NomeDeSetorConferido {
  if (typeof bruto !== "string") return { ok: false, motivo: "Informe o nome do setor." };
  const nome = bruto.trim();
  if (!nome) return { ok: false, motivo: "Informe o nome do setor." };
  if (nome.length > LIMITE_SETOR_CHARS) {
    return {
      ok: false,
      motivo: `O nome do setor passa de ${LIMITE_SETOR_CHARS} caracteres.`,
    };
  }
  return { ok: true, nome };
}

/**
 * Este nome já está no cadastro? Devolve o que está gravado, se estiver.
 *
 * Compara SEM diferenciar caixa, pelo mesmo motivo de `garantirSetorSolicitante`
 * em `solicitantes.ts`: "Compras" e "compras" digitados em semanas diferentes
 * viram dois setores, e cada um leva metade dos cards. Devolver a grafia já
 * gravada é o que faz o segundo cadastro virar um apontamento para o primeiro.
 */
export function setorExistente(
  nome: string,
  cadastro: readonly Setor[],
): Setor | undefined {
  const alvo = nome.trim().toLowerCase();
  return cadastro.find((s) => s.nome.trim().toLowerCase() === alvo);
}

/**
 * Lê a coleção como se ela pudesse estar em qualquer estado — e ela pode.
 *
 * É um documento que o admin edita pela tela, que o console do Firebase altera
 * à mão e que o script de semeadura escreveu. Documento sem `name`, com `name`
 * de outro tipo ou repetido não pode derrubar a barra de setores de todo mundo,
 * então cada um deles é descartado em silêncio, e o resto passa.
 *
 * Ordena em pt-BR porque a lista é lida por gente: sem o `localeCompare`,
 * "Pós-graduação" cai depois de "Processos" pela tabela de código, e a pessoa
 * procura onde não está.
 */
export function normalizarSetores(brutos: unknown): Setor[] {
  if (!Array.isArray(brutos)) return [];
  const vistos = new Set<string>();
  const out: Setor[] = [];
  for (const b of brutos) {
    if (!b || typeof b !== "object") continue;
    const id = (b as { id?: unknown }).id;
    const nomeBruto = (b as { nome?: unknown }).nome;
    if (typeof id !== "string" || !id) continue;
    const conferido = conferirNomeDeSetor(nomeBruto);
    if (!conferido.ok) continue;
    const chave = conferido.nome.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ id, nome: conferido.nome });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Só os nomes, que é o que as telas e o `sectors` do usuário usam. */
export function nomesDosSetores(cadastro: readonly Setor[]): string[] {
  return cadastro.map((s) => s.nome);
}

/** O mínimo que este módulo precisa saber de alguém. */
export type PessoaDoSetor = {
  role?: string | null;
  sectors?: string[] | null;
};

/**
 * Os setores que esta pessoa enxerga — a regra que existia NOVE VEZES COPIADA.
 *
 * Era o mesmo `useMemo` em `kanban`, `dashboard`, `cronograma`, `links`, `rank`,
 * `recorrencias`, `relatorios`, `reunioes` e `emblemas-perfil`, e nada obrigava
 * as nove cópias a mudarem juntas. Agora é uma, e é aqui que ela é testada.
 *
 * ADMIN VÊ O CADASTRO INTEIRO, e não `sectors`. É o comportamento que
 * `DEFAULT_SECTORS` já tinha, e o motivo é o mesmo do `podeVerAba`: admin é
 * quem conserta a configuração, então ele não pode ser trancado por ela.
 *
 * NÃO-ADMIN VÊ `sectors` COMO ESTÁ, sem filtrar pelo cadastro — e isto é
 * decisão, não esquecimento. O cadastro diz o que se OFERECE, nunca o que se
 * PERMITE; quem permite é `firestore.rules`, escopado por setor. Filtrar aqui
 * faria um admin que apagou uma linha por engano trancar para fora todo mundo
 * daquele setor, e a tela diria "não há nada aqui", que não conta nada disso.
 *
 * O PISO só se aplica ao admin. Para quem não é, lista vazia é a resposta certa
 * — é uma pessoa que ninguém pôs em setor nenhum, e mostrar-lhe B.I. seria
 * inventar um acesso que o Firestore vai negar na linha seguinte.
 */
export function setoresVisiveis(
  pessoa: PessoaDoSetor | null | undefined,
  cadastro: readonly string[],
): string[] {
  if (!pessoa) return [];
  if (pessoa.role === "admin") {
    return cadastro.length > 0 ? [...cadastro] : [...SETORES_SEMENTE];
  }
  return [...(pessoa.sectors ?? [])];
}

/**
 * Os setores que o formulário de usuário OFERECE para marcar.
 *
 * O cadastro, mais o que já está gravado em alguém e saiu da lista — mesmo
 * raciocínio do `setoresOferecidos` do quadro de Permissões. Sem a segunda
 * parte, apagar um setor do cadastro faria o setor sumir do formulário de quem
 * ainda está nele, e a primeira edição de nome apagaria o vínculo em silêncio.
 */
export function setoresOferecidos(
  cadastro: readonly string[],
  jaGravados: readonly string[],
): string[] {
  const s = new Set<string>(cadastro.length > 0 ? cadastro : SETORES_SEMENTE);
  jaGravados.forEach((x) => {
    const n = x.trim();
    if (n) s.add(n);
  });
  return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
