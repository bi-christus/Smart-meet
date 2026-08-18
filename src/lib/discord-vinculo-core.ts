/**
 * O vínculo entre a pessoa do Discord e a do Smart Meet — as regras.
 *
 * Moradia em módulo puro (AGENTS.md §4): sem SDK do Firestore, sem `fetch` e
 * sem `node:crypto`, então isto roda no navegador (a tela do Perfil mostra o
 * código) e no servidor (a rota valida o que chegou), com um teste só —
 * `scripts/test-discord-vinculo.mjs`. A conferência da assinatura, que precisa
 * de `node:crypto`, mora separada em `src/lib/server/discord-assinatura.ts`
 * justamente para não arrastar Node para dentro do bundle do navegador.
 *
 * O PROBLEMA que isto resolve: o aviso no canal já sai (Issue #89), mas o
 * Discord não sabe que `ia02@px.com.br` é `@italo` no servidor. Sem essa
 * tradução o aviso chega no canal e só é lido por quem está olhando — o
 * responsável pela demanda, que é justamente quem precisa saber, descobre
 * junto com todo mundo.
 *
 * COMO O VÍNCULO SE PROVA. São dois segredos, um de cada lado:
 *
 *   1. O Smart Meet gera um código curto e o mostra a quem está logado. Quem
 *      tem o código provou ser dono do e-mail — a sessão do Google já garantiu
 *      isso.
 *   2. A pessoa digita `/vincular <codigo>` no Discord. A requisição chega
 *      assinada com a chave do aplicativo, e o `user.id` vem do Discord, não do
 *      corpo. Quem digitou provou ser dono da conta do Discord.
 *
 * Nenhum dos dois lados vincula sozinho, e é por isso que o código pode ser
 * curto: ele é inútil sem uma conta do Discord digitando-o, e some em dez
 * minutos.
 *
 * POR QUE NÃO UM BOT DE VERDADE. Bot com conexão de gateway precisa de processo
 * vivo, e a Vercel é serverless — não existe processo vivo. O caminho que
 * funciona é o Interactions Endpoint: o Discord faz POST HTTPS na nossa rota a
 * cada comando. Mesmo bot, mesmos comandos de barra, sem processo nenhum. Quem
 * chegar aqui achando que falta um `discord.js` rodando: não falta, e colocar um
 * quebraria o deploy.
 */

/**
 * O alfabeto do código, sem os caracteres que se leem errado.
 *
 * Fora: `I`, `L`, `O`, `0` e `1`. O código é LIDO NUMA TELA E DIGITADO NOUTRA —
 * às vezes do computador para o celular — e "l1O0" é o jeito conhecido de
 * transformar um fluxo de dez segundos em três tentativas e uma desistência.
 * Sobram 31 caracteres; seis deles dão 887 milhões de combinações, o que é
 * muito mais do que suficiente para um segredo que vive dez minutos e só serve
 * uma vez.
 */
export const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const TAMANHO_CODIGO = 6;

/**
 * Quanto tempo o código vale.
 *
 * Dez minutos é o tempo de trocar de janela, achar o servidor e digitar. Mais
 * do que isso é um segredo esquecido aberto num banco; menos é a pessoa que
 * atendeu ao telefone no meio voltando para um código morto.
 */
export const VALIDADE_CODIGO_MS = 10 * 60 * 1000;

/**
 * Sorteia um código.
 *
 * O sorteio entra por PARÂMETRO, e não como `Math.random()` aqui dentro, por
 * dois motivos: o teste precisa de resultado determinístico, e quem chama de
 * verdade — o servidor — deve passar `crypto.randomInt`, que é o gerador certo
 * para segredo. `Math.random()` é previsível o bastante para não ser usado em
 * nada que autoriza.
 */
export function gerarCodigo(sorteio: (teto: number) => number): string {
  let out = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) {
    out += ALFABETO_CODIGO[sorteio(ALFABETO_CODIGO.length)];
  }
  return out;
}

/**
 * O que a pessoa digitou, no formato em que o código foi gravado.
 *
 * Aceita minúscula, espaço no meio e o hífen que a tela mostra — porque tudo
 * isso é o que sai de um copiar-e-colar ou de quem digita olhando. Recusar por
 * causa de um espaço colado junto seria recusar por causa da nossa própria
 * formatação.
 */
export function normalizarCodigo(bruto: string): string {
  return (bruto ?? "")
    .toUpperCase()
    .split("")
    .filter((c) => ALFABETO_CODIGO.includes(c))
    .join("")
    .slice(0, TAMANHO_CODIGO);
}

export function codigoValido(codigo: string): boolean {
  return (
    codigo.length === TAMANHO_CODIGO &&
    codigo.split("").every((c) => ALFABETO_CODIGO.includes(c))
  );
}

/** `ABC123` → `ABC-123`. Só para mostrar: o hífen sai na normalização. */
export function formatarCodigo(codigo: string): string {
  const meio = Math.ceil(TAMANHO_CODIGO / 2);
  return codigo.length === TAMANHO_CODIGO
    ? `${codigo.slice(0, meio)}-${codigo.slice(meio)}`
    : codigo;
}

/** Se o código já passou da validade. `agora` entra para o teste ter relógio. */
export function expirado(criadoEm: number, agora: number): boolean {
  return agora - criadoEm >= VALIDADE_CODIGO_MS;
}

/** Quanto falta, em segundos, para o código morrer. Nunca negativo. */
export function segundosRestantes(criadoEm: number, agora: number): number {
  return Math.max(0, Math.ceil((criadoEm + VALIDADE_CODIGO_MS - agora) / 1000));
}

// ---------------------------------------------------------------------------
// O protocolo de interações do Discord.
//
// Os números são DELES. Ficam nomeados aqui porque `type: 4` espalhado pela
// rota não diz nada a quem lê depois, e porque errar um deles faz o Discord
// responder "interação falhou" sem explicar qual.
// ---------------------------------------------------------------------------

export const TIPO_INTERACAO = {
  /** O Discord conferindo se a URL está viva. Acontece ao salvar o endpoint. */
  PING: 1,
  COMANDO: 2,
} as const;

export const TIPO_RESPOSTA = {
  PONG: 1,
  MENSAGEM: 4,
} as const;

/** Mensagem que só quem digitou o comando enxerga. */
export const FLAG_EFEMERA = 64;

/** Tipo de opção de comando: texto. */
const OPCAO_TEXTO = 3;

/**
 * Os comandos de barra deste app.
 *
 * A lista mora aqui, e não dentro do script de registro, porque ela é lida
 * pelos DOIS lados: o script a envia ao Discord, e a rota decide o que fazer
 * pelo `name`. Em dois lugares, um comando renomeado no script vira comando que
 * o Discord oferece e a rota não reconhece — e o sintoma é "a aplicação não
 * respondeu", sem nada no log.
 */
export const COMANDOS = [
  {
    name: "vincular",
    description: "Liga sua conta do Discord à sua conta do Smart Meet",
    options: [
      {
        name: "codigo",
        description: "O código que aparece no seu Perfil, dentro do Smart Meet",
        type: OPCAO_TEXTO,
        required: true,
      },
    ],
  },
  {
    name: "desvincular",
    description: "Desfaz a ligação com o Smart Meet e para de te mencionar",
    options: [],
  },
] as const;

export type ComandoRecebido = {
  nome: string;
  opcoes: Record<string, string>;
  /** Id numérico do usuário no Discord. Vem do Discord, nunca do corpo. */
  discordId: string;
  /** Como chamá-lo na resposta. */
  discordNome: string;
};

/** O recorte do payload de interação que este app lê. */
type PayloadInteracao = {
  type?: number;
  data?: {
    name?: string;
    options?: { name?: string; value?: unknown }[];
  };
  member?: { user?: { id?: string; username?: string; global_name?: string } };
  user?: { id?: string; username?: string; global_name?: string };
};

/**
 * Lê o comando que chegou, ou `null` quando o payload não é um comando usável.
 *
 * `member.user` é o caminho quando o comando é digitado DENTRO de um servidor;
 * `user` é o caminho quando é digitado numa DM com o bot. Ler só um dos dois é
 * o defeito que faz o comando funcionar em todo lugar menos onde a pessoa
 * tentou.
 */
export function lerComando(payload: unknown): ComandoRecebido | null {
  const p = (payload ?? {}) as PayloadInteracao;
  if (p.type !== TIPO_INTERACAO.COMANDO) return null;

  const quem = p.member?.user ?? p.user;
  const discordId = (quem?.id ?? "").trim();
  const nome = (p.data?.name ?? "").trim();
  if (!discordId || !nome) return null;

  const opcoes: Record<string, string> = {};
  for (const o of p.data?.options ?? []) {
    if (typeof o?.name === "string" && typeof o.value === "string") {
      opcoes[o.name] = o.value;
    }
  }

  return {
    nome,
    opcoes,
    discordId,
    // `global_name` é o nome que a pessoa escolheu mostrar; `username` é o
    // arroba. O primeiro é o que ela reconhece como sendo ela.
    discordNome: (quem?.global_name || quem?.username || "").trim() || discordId,
  };
}

/**
 * A resposta de um comando — sempre EFÊMERA.
 *
 * Sem a flag, "Pronto — vinculado a ia02@px.com.br" vira mensagem pública no
 * canal: o e-mail corporativo de quem vinculou fica visível para o servidor
 * inteiro, e a lista de quem trabalha em quê vira histórico de chat. O vínculo
 * é assunto de uma pessoa só.
 */
export function respostaEfemera(texto: string) {
  return {
    type: TIPO_RESPOSTA.MENSAGEM,
    data: { content: texto.slice(0, 2000), flags: FLAG_EFEMERA },
  };
}

export function respostaPong() {
  return { type: TIPO_RESPOSTA.PONG };
}
