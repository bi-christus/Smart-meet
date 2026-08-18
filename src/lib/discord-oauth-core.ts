/**
 * O vínculo em um clique — as regras do caminho por OAuth.
 *
 * Moradia em módulo puro (AGENTS.md §4): sem SDK do Firestore, sem `fetch` e
 * sem `node:crypto`, então isto roda no navegador e no servidor com um teste só
 * (`scripts/test-discord-oauth.mjs`). A troca do código por token, que fala com
 * a rede, mora em `api/discord/oauth/callback`.
 *
 * O PROBLEMA que isto resolve. O `/vincular <codigo>` funciona e continua
 * existindo, mas ele cobra cinco passos de quem só queria ser avisado: abrir o
 * Perfil, gerar, copiar, trocar de janela, digitar — e o código morre em dez
 * minutos no meio disso. Numa equipe de cinco pessoas, "cada um faz isso quando
 * puder" termina com duas pessoas vinculadas e três recebendo aviso de canal
 * que não é para elas. A integração inteira depende do vínculo, e o vínculo
 * estava dependendo de paciência.
 *
 * COMO O CLIQUE PROVA AS DUAS PONTAS, que é a única coisa que importa aqui:
 *
 *   1. Quem clica está LOGADO no Smart Meet. O e-mail sai da sessão do Firebase,
 *      não de um campo que alguém preenche. Essa é a primeira ponta, e é a
 *      mesma que o código provava.
 *   2. Quem autoriza está LOGADO no Discord, e o `id` volta do Discord assinado
 *      pela troca de token — nunca do navegador. Essa é a segunda.
 *
 * Ou seja: o clique prova exatamente o que o código provava, com uma janela a
 * menos. O código não vira legado por isso — ele é o caminho de quem já está no
 * Discord no celular e não quer abrir o app, e o de quem tem popup bloqueado.
 *
 * POR QUE `email` NO ESCOPO se a sessão já diz quem é a pessoa. Ele não é
 * necessário para o caminho normal — é o que salva o caminho torto. Se o
 * `state` morrer no meio (dez minutos, ou a aba que ficou aberta desde ontem), o
 * e-mail verificado pelo Discord ainda permite achar o cadastro certo sem
 * mandar a pessoa começar de novo. Ver `alvoDoVinculo`.
 */

/**
 * O que se pede ao Discord.
 *
 * `identify` dá o `id` — a única coisa realmente indispensável. `email` é o
 * plano B descrito acima; ele é lido, comparado e descartado, nunca gravado.
 * Nada além destes dois: cada escopo a mais é uma linha a mais na tela de
 * autorização, e uma tela de autorização longa é uma tela que as pessoas
 * fecham.
 */
export const ESCOPOS_OAUTH = ["identify", "email"] as const;

/**
 * Quanto tempo o `state` vale.
 *
 * O mesmo dos códigos, e de propósito: são o mesmo tipo de segredo — curto,
 * de uso único, e vivo só durante uma troca de janela. Dois prazos diferentes
 * para a mesma coisa seriam duas explicações diferentes para dar a quem
 * perguntasse por que expirou.
 */
export const VALIDADE_ESTADO_MS = 10 * 60 * 1000;

/** Base64url do `randomBytes` — o que a rota gera. */
const FORMATO_ESTADO = /^[A-Za-z0-9_-]{20,128}$/;

export function estadoValido(bruto: string | null | undefined): boolean {
  return FORMATO_ESTADO.test((bruto ?? "").trim());
}

/**
 * Onde o Discord devolve a pessoa depois de ela autorizar.
 *
 * Sai de `APP_URL`, e NUNCA da origem da requisição — mesmo motivo de
 * `linkDoCard` e de `notify.ts`: no deploy da Vercel a origem é o host interno,
 * que não existe para quem clica, e o Discord recusaria por não bater com o que
 * está cadastrado no portal.
 */
export function urlDeRetorno(appUrl: string | null | undefined): string | null {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/api/discord/oauth/callback` : null;
}

/**
 * A URL para onde o botão manda a pessoa.
 *
 * `prompt=consent` fica de fora de propósito: quem já autorizou uma vez e está
 * trocando de conta do Discord passa direto, e quem nunca autorizou vê a tela
 * de qualquer jeito. Forçar a tela para todo mundo transformaria "reconectar"
 * num pedido de permissão repetido, que é o jeito de ensinar a clicar em
 * Autorizar sem ler.
 */
export function urlDeAutorizacao(args: {
  clientId: string;
  urlDeRetorno: string;
  estado: string;
}): string {
  const q = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.urlDeRetorno,
    response_type: "code",
    scope: ESCOPOS_OAUTH.join(" "),
    state: args.estado,
  });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}

/** A quem este retorno pertence, e por qual prova. */
export type Alvo = {
  email: string;
  /** `sessao` = o `state` provou. `email` = o e-mail verificado do Discord. */
  por: "sessao" | "email";
};

/**
 * De quem é o cadastro que vai receber este vínculo.
 *
 * DOIS CAMINHOS, e a ordem entre eles não é arbitrária:
 *
 * 1. O `state` GANHA SEMPRE que existir. Ele foi criado dentro de uma sessão
 *    autenticada do Smart Meet, e diz quem apertou o botão. É prova direta.
 *
 * 2. O e-mail verificado do Discord é o plano B, e só vale quando bate com um
 *    cadastro ATIVO. Ele existe para o `state` que morreu no caminho — a aba
 *    que ficou aberta, o "autorizar" clicado meia hora depois. Sem ele, a
 *    pessoa levaria "expirou, comece de novo" no fim de um fluxo que ela
 *    completou.
 *
 * `verificado` é a trava do plano B, e não detalhe: o Discord deixa cadastrar
 * um e-mail sem confirmá-lo, e aceitar um e-mail não confirmado seria aceitar
 * que alguém digite o endereço de outra pessoa e receba as demandas dela.
 *
 * Devolver `null` é o resultado certo quando nenhum dos dois responde. Vincular
 * "no melhor palpite" aqui é entregar as notificações de alguém para a conta
 * errada — e ninguém descobre pelo lado de quem deixou de receber.
 */
export function alvoDoVinculo(args: {
  /** E-mail guardado no `state`, quando ele ainda estava vivo. */
  emailDoEstado?: string | null;
  /** E-mail que o Discord devolveu, já em minúsculas. */
  emailDoDiscord?: string | null;
  emailDoDiscordVerificado?: boolean;
  /** Se existe cadastro ativo com o e-mail do Discord. Quem sabe é a rota. */
  cadastroAtivoComEmailDoDiscord?: boolean;
}): Alvo | null {
  const daSessao = (args.emailDoEstado ?? "").trim().toLowerCase();
  if (daSessao) return { email: daSessao, por: "sessao" };

  const doDiscord = (args.emailDoDiscord ?? "").trim().toLowerCase();
  if (
    doDiscord &&
    args.emailDoDiscordVerificado === true &&
    args.cadastroAtivoComEmailDoDiscord === true
  ) {
    return { email: doDiscord, por: "email" };
  }

  return null;
}

/** Motivos de recusa que a página de retorno sabe explicar. */
export type MotivoOauth =
  | "sem-codigo"
  | "estado-invalido"
  | "nao-achei-cadastro"
  | "sem-acesso"
  | "recusado"
  | "erro";

/**
 * A frase que a pessoa lê no fim do fluxo.
 *
 * Mora no módulo puro, com teste, porque é a ÚNICA coisa que ela vê quando algo
 * dá errado — a página de retorno é o fim da linha, e não há tela do app atrás
 * dela para consertar uma explicação ruim. Toda frase termina dizendo o que
 * fazer a seguir; "não foi possível concluir" sozinho manda a pessoa adivinhar.
 */
export function frasePorMotivo(motivo: MotivoOauth): string {
  switch (motivo) {
    case "recusado":
      return "Você cancelou a autorização no Discord. Nada foi alterado — pode fechar esta aba e tentar de novo quando quiser.";
    case "sem-codigo":
      return "O Discord não devolveu a autorização. Feche esta aba e clique em Conectar Discord de novo, no seu Perfil.";
    case "estado-invalido":
      return "Este link de conexão não vale mais — ele dura 10 minutos. Volte ao Perfil no Smart Meet e clique em Conectar Discord de novo.";
    case "nao-achei-cadastro":
      return "Não consegui descobrir a qual cadastro do Smart Meet ligar esta conta. Volte ao Perfil e use a opção do código (`/vincular`), que funciona mesmo quando o link expira.";
    case "sem-acesso":
      return "O cadastro ligado a esta conexão não está ativo no Smart Meet. Fale com o administrador do setor.";
    default:
      return "Deu erro do nosso lado ao concluir a conexão. Tente de novo em alguns minutos; se insistir, use a opção do código no Perfil.";
  }
}
