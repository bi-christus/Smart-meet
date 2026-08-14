/**
 * Quem enxerga qual aba — a regra, sem o banco.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * fala com o banco é `permissoes.ts`, o irmão. É isto que permite
 * `scripts/test-permissoes.mjs` rodar a decisão inteira em Node puro, sem subir
 * nada — e a decisão aqui merece teste mais do que a média, porque errar para o
 * lado frouxo abre uma aba para quem não devia e errar para o lado apertado
 * tranca gente para fora de um app que não tem tela de suporte.
 *
 * O CATÁLOGO `ABAS` É A NAVEGAÇÃO. Antes desta frente, a barra do topo era um
 * array literal dentro de `app-shell` e o controle de acesso era um `if` de uma
 * linha (`role === "admin"` acrescentava a aba Admin). Aba nova exigia mexer nos
 * dois lugares, e nada obrigava a lembrar do segundo. Agora a lista é uma só: a
 * barra é desenhada a partir daqui, e o guarda de rota pergunta daqui.
 *
 * ESCONDER O BOTÃO NÃO É CONTROLE DE ACESSO, e este módulo não finge que é. Ele
 * decide o que a INTERFACE mostra. Quem impede a leitura do dado é
 * `firestore.rules`, escopado por setor, e continua sendo. Uma aba escondida
 * cujo conteúdo o Firestore entregasse continuaria acessível por qualquer
 * caminho que não passasse por esta tela — é por isso que as duas camadas
 * existem, e por isso nenhuma coleção nova deve nascer confiando só nesta.
 */

/** Uma aba da barra do topo. */
export type Aba = {
  /** Também é o nome do ícone em `icons.tsx` e a chave no documento do banco. */
  id: string;
  label: string;
  href: string;
  /**
   * `false` = a aba não aparece no quadro de Permissões e ninguém a restringe.
   *
   * Só duas abas são assim, e por motivos opostos: `inicio` porque é onde o
   * login cai (restringi-la seria mandar a pessoa para uma parede), e `admin`
   * porque ela já tem uma regra mais forte, logo abaixo.
   */
  configuravel: boolean;
  /**
   * `true` = só administrador, aconteça o que acontecer no quadro de
   * Permissões. Existe para a aba Admin: é de lá que se conserta uma
   * configuração errada, então ela não pode ser o que a configuração errada
   * trancou.
   */
  soAdmin?: boolean;
};

/**
 * A ordem daqui é a ordem da barra do topo. `Rank` fecha a lista por ser a mais
 * nova; `Admin` fica por último porque é a única que muda de dono.
 */
export const ABAS: Aba[] = [
  { id: "inicio", label: "Início", href: "/", configuravel: false },
  { id: "reunioes", label: "Reuniões", href: "/reunioes", configuravel: true },
  {
    id: "relatorios",
    label: "Relatórios IA",
    href: "/relatorios",
    configuravel: true,
  },
  { id: "kanban", label: "Kanban", href: "/kanban", configuravel: true },
  {
    id: "recorrencias",
    label: "Recorrências",
    href: "/recorrencias",
    configuravel: true,
  },
  { id: "dashboard", label: "Dashboard", href: "/dashboard", configuravel: true },
  {
    id: "cronograma",
    label: "Cronograma",
    href: "/cronograma",
    configuravel: true,
  },
  { id: "links", label: "Links", href: "/links", configuravel: true },
  {
    id: "admin",
    label: "Admin",
    href: "/admin",
    configuravel: false,
    soAdmin: true,
  },
];

/** As abas que o quadro de Permissões oferece para configurar. */
export const ABAS_CONFIGURAVEIS = ABAS.filter((a) => a.configuravel);

/**
 * Como uma aba decide quem entra.
 *
 * `"todos"` é o estado de quem nunca foi configurado, e é de propósito que ele
 * seja o padrão: uma aba que nasce fechada some da barra de todo mundo no
 * instante em que é criada, e quem for procurar o motivo vai olhar para o
 * código, não para uma tela de configuração que ninguém abriu ainda.
 *
 * `"restrito"` é uma UNIÃO das duas listas, não uma interseção: quem está em
 * `setores` OU em `pessoas` entra. São perguntas diferentes — "o setor X
 * inteiro" e "além dele, fulano" — e exigir as duas juntas tornaria impossível
 * escrever a segunda.
 */
export type RegraDaAba = {
  modo: "todos" | "restrito";
  /** Setores de execução liberados (os mesmos de `UserProfile.sectors`). */
  setores: string[];
  /** E-mails liberados individualmente, sempre em minúsculas. */
  pessoas: string[];
};

export type Permissoes = {
  /** Uma entrada por aba configurada. Aba ausente = `"todos"`. */
  abas: Record<string, RegraDaAba>;
};

/** Nada configurado: todo mundo vê tudo (menos o que é só de admin). */
export const PERMISSOES_ABERTAS: Permissoes = { abas: {} };

export function regraPadrao(): RegraDaAba {
  return { modo: "todos", setores: [], pessoas: [] };
}

/** O mínimo que este módulo precisa saber de alguém. */
export type PessoaDaPermissao = {
  email: string;
  role: string;
  sectors?: string[] | null;
};

function textos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const limpos = v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean);
  return [...new Set(limpos)];
}

/**
 * Lê o documento do banco como se ele pudesse estar em qualquer estado.
 *
 * E ele pode: é um documento que um admin edita, que uma versão futura deste
 * app pode ter escrito com outro formato, e que o console do Firebase permite
 * alterar à mão. Confiar na forma dele significaria um `undefined.length` no
 * meio da montagem da barra do topo — ou seja, o app inteiro em branco por
 * causa de um campo.
 *
 * DOCUMENTO que não dá para entender vira o padrão ABERTO, nunca o fechado. É a
 * escolha de projeto que mais importa neste arquivo: o pior caso de uma leitura
 * frouxa é uma aba visível a mais durante o tempo em que alguém conserta o
 * documento; o pior caso de uma leitura rígida é o app trancado para todo mundo,
 * sem nenhuma tela de onde destrancá-lo — inclusive a de Permissões.
 *
 * O padrão aberto vale até onde há dúvida, e PARA onde ela acaba. `modo`
 * ilegível vira `"todos"`; `modo` legível vale mesmo que a lista ao lado dele
 * não dê para ler, e o resultado é uma aba fechada. A diferença é que ali
 * alguém DISSE "restrito", e abrir seria desobedecer a uma instrução que se
 * entendeu. O motivo do padrão aberto também não se aplica nesse caso: admin
 * atravessa a regra antes de ela ser consultada, então nunca falta quem conserte
 * — é a primeira linha de `podeVerAba`, e o teste do topo de
 * `scripts/test-permissoes.mjs` existe para ela não cair.
 */
export function normalizarPermissoes(bruto: unknown): Permissoes {
  if (!bruto || typeof bruto !== "object") return PERMISSOES_ABERTAS;
  const abasBrutas = (bruto as { abas?: unknown }).abas;
  if (!abasBrutas || typeof abasBrutas !== "object") return PERMISSOES_ABERTAS;

  const abas: Record<string, RegraDaAba> = {};
  for (const aba of ABAS_CONFIGURAVEIS) {
    const r = (abasBrutas as Record<string, unknown>)[aba.id];
    if (!r || typeof r !== "object") continue;
    const modoBruto = (r as { modo?: unknown }).modo;
    abas[aba.id] = {
      modo: modoBruto === "restrito" ? "restrito" : "todos",
      setores: textos((r as { setores?: unknown }).setores),
      pessoas: textos((r as { pessoas?: unknown }).pessoas).map((e) =>
        e.toLowerCase(),
      ),
    };
  }
  return { abas };
}

export function abaPorId(id: string): Aba | undefined {
  return ABAS.find((a) => a.id === id);
}

/**
 * A aba a que um caminho pertence — o que o guarda de rota pergunta.
 *
 * `"/"` casa exato e o resto casa por prefixo, exatamente como a marcação de aba
 * ativa sempre fez na barra do topo: `/kanban?setor=B.I.` e `/relatorios/123`
 * são a aba de quem os abriu. Caminho que não casa nada devolve `undefined`, e
 * quem chama trata isso como "não é aba" — não como "negado". Rota que este
 * catálogo não conhece não é rota que este módulo deva trancar.
 */
export function abaDaRota(pathname: string): Aba | undefined {
  if (pathname === "/") return abaPorId("inicio");
  return ABAS.find((a) => a.href !== "/" && pathname.startsWith(a.href));
}

/**
 * Esta pessoa enxerga esta aba?
 *
 * A ORDEM DAS PERGUNTAS É A REGRA, e a primeira delas é a que impede o desastre:
 * **admin enxerga tudo, sempre**. Sem essa linha, um admin que se restringisse
 * por engano perderia a aba Admin — e com ela a única tela de onde a
 * configuração se conserta. Não haveria caminho de volta pela interface: o
 * conserto seria pelo console do Firebase, e a mensagem na tela seria "sem
 * acesso", que não diz nada disso a quem a lê.
 *
 * O super admin não é testado pelo e-mail aqui porque `ensureUserProfile`
 * (`users.ts`) já devolve `role: "admin"` para ele em toda sessão, com ou sem
 * cadastro — o papel é a forma de saber, e uma segunda forma seria uma segunda
 * verdade a manter sincronizada.
 */
export function podeVerAba(
  abaId: string,
  pessoa: PessoaDaPermissao | null | undefined,
  permissoes: Permissoes,
): boolean {
  if (!pessoa) return false;
  const aba = abaPorId(abaId);
  if (!aba) return false;

  if (pessoa.role === "admin") return true;
  if (aba.soAdmin) return false;
  if (!aba.configuravel) return true;

  const regra = permissoes.abas[aba.id];
  if (!regra || regra.modo !== "restrito") return true;

  const email = (pessoa.email ?? "").trim().toLowerCase();
  if (email && regra.pessoas.includes(email)) return true;

  const meus = pessoa.sectors ?? [];
  return regra.setores.some((s) => meus.includes(s));
}

/** As abas da barra do topo, na ordem do catálogo. */
export function abasVisiveis(
  pessoa: PessoaDaPermissao | null | undefined,
  permissoes: Permissoes,
): Aba[] {
  return ABAS.filter((a) => podeVerAba(a.id, pessoa, permissoes));
}

/**
 * A regra está fechada para TODO MUNDO que não seja admin?
 *
 * Serve à tela de Permissões, não à decisão de acesso: restrito com as duas
 * listas vazias é uma configuração válida e o resultado dela é "ninguém". Ela é
 * quase sempre um passo pela metade — alguém trocou o modo e ainda não escolheu
 * quem entra — e a diferença entre esse engano e a intenção real é grande
 * demais para a tela ficar calada.
 */
export function regraFechadaParaTodos(regra: RegraDaAba): boolean {
  return (
    regra.modo === "restrito" &&
    regra.setores.length === 0 &&
    regra.pessoas.length === 0
  );
}
