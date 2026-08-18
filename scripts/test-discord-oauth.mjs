/**
 * Testes do vínculo em um clique.
 *
 * O que se está protegendo aqui não é a URL: é QUEM RECEBE O VÍNCULO. Errar
 * este julgamento entrega as notificações de uma pessoa para a conta de outra —
 * e o defeito é invisível dos dois lados. Quem recebe demanda alheia acha que o
 * bot está confuso; quem deixou de receber acha que ninguém mexeu na demanda
 * dele. Ninguém abre chamado por nenhuma das duas coisas.
 *
 * Três moedas:
 *
 *  - A PRECEDÊNCIA. O `state` prova quem apertou o botão; o e-mail do Discord é
 *    plano B. Inverter faz o cadastro errado ganhar sempre que os dois e-mails
 *    forem diferentes — que é o caso comum, porque quase ninguém usa o e-mail
 *    corporativo no Discord pessoal.
 *
 *  - O `verified`. O Discord deixa cadastrar e-mail sem confirmar. Aceitar um
 *    e-mail não confirmado é aceitar que alguém digite o endereço de outra
 *    pessoa e receba as demandas dela.
 *
 *  - A URL. `redirect_uri` diferente da cadastrada no portal é recusa do
 *    Discord no meio do fluxo, e a mesma função monta a do pedido e a da troca
 *    de token — se ela errar, erra nas duas.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  ESCOPOS_OAUTH,
  alvoDoVinculo,
  estadoValido,
  frasePorMotivo,
  urlDeAutorizacao,
  urlDeRetorno,
} from "../src/lib/discord-oauth-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- a URL de retorno ------------------------------------------------------
checa(
  "o retorno sai de APP_URL, e é o caminho da rota",
  urlDeRetorno("https://app.exemplo.com") ===
    "https://app.exemplo.com/api/discord/oauth/callback",
);
checa(
  "barra sobrando não vira barra dupla — o Discord compara texto",
  urlDeRetorno("https://app.exemplo.com///") ===
    "https://app.exemplo.com/api/discord/oauth/callback",
);
checa("sem APP_URL não há retorno possível", urlDeRetorno("") === null);
checa("APP_URL indefinida também", urlDeRetorno(undefined) === null);

// --- a URL de autorização --------------------------------------------------
const url = new URL(
  urlDeAutorizacao({
    clientId: "123",
    urlDeRetorno: "https://app.exemplo.com/api/discord/oauth/callback",
    estado: "abc-123_XYZ",
  }),
);
checa("vai para o endereço de autorização do Discord", url.origin === "https://discord.com");
checa("pede code, e não token implícito", url.searchParams.get("response_type") === "code");
checa("leva o client id", url.searchParams.get("client_id") === "123");
checa("leva o state", url.searchParams.get("state") === "abc-123_XYZ");
checa(
  "o redirect vai escapado, inteiro",
  url.searchParams.get("redirect_uri") ===
    "https://app.exemplo.com/api/discord/oauth/callback",
);
checa(
  "pede identify e email, e nada além disso",
  url.searchParams.get("scope") === "identify email" &&
    ESCOPOS_OAUTH.length === 2,
  url.searchParams.get("scope"),
);
checa(
  "não força a tela de consentimento a cada reconexão",
  url.searchParams.get("prompt") === null,
);

// --- a forma do state ------------------------------------------------------
checa("base64url de 24 bytes passa", estadoValido("a".repeat(32)));
checa("com hífen e sublinhado também", estadoValido("ab-cd_ef" + "g".repeat(20)));
checa("curto demais não passa", !estadoValido("abc"));
checa("vazio não passa", !estadoValido(""));
checa("nulo não passa", !estadoValido(null));
checa(
  "caractere fora do alfabeto não passa (é o que chega numa URL adulterada)",
  !estadoValido("a".repeat(30) + "=="),
);

// --- de quem é o vínculo: o julgamento que não pode errar -------------------
checa(
  "o state manda quando existe",
  alvoDoVinculo({
    emailDoEstado: "kaua@px.com.br",
    emailDoDiscord: "outro@gmail.com",
    emailDoDiscordVerificado: true,
    cadastroAtivoComEmailDoDiscord: true,
  })?.email === "kaua@px.com.br",
);
checa(
  "e a prova fica registrada",
  alvoDoVinculo({ emailDoEstado: "kaua@px.com.br" })?.por === "sessao",
);
checa(
  "o e-mail do estado é normalizado — é ele que vira id de documento",
  alvoDoVinculo({ emailDoEstado: "  Kaua@PX.com.BR " })?.email ===
    "kaua@px.com.br",
);
checa(
  "sem state, o e-mail verificado com cadastro ativo salva o fluxo",
  alvoDoVinculo({
    emailDoEstado: null,
    emailDoDiscord: "kaua@px.com.br",
    emailDoDiscordVerificado: true,
    cadastroAtivoComEmailDoDiscord: true,
  })?.por === "email",
);
checa(
  "e-mail NÃO verificado não vale, mesmo com cadastro ativo",
  alvoDoVinculo({
    emailDoDiscord: "kaua@px.com.br",
    emailDoDiscordVerificado: false,
    cadastroAtivoComEmailDoDiscord: true,
  }) === null,
);
checa(
  "e-mail verificado sem cadastro ativo não vale",
  alvoDoVinculo({
    emailDoDiscord: "estranho@gmail.com",
    emailDoDiscordVerificado: true,
    cadastroAtivoComEmailDoDiscord: false,
  }) === null,
);
checa(
  "sem nada, o resultado é NULO — nunca um palpite",
  alvoDoVinculo({}) === null,
);
checa(
  "estado em branco não conta como prova",
  alvoDoVinculo({ emailDoEstado: "   " }) === null,
);

// --- as frases do fim da linha ---------------------------------------------
const MOTIVOS = [
  "sem-codigo",
  "estado-invalido",
  "nao-achei-cadastro",
  "sem-acesso",
  "recusado",
  "erro",
];
checa(
  "todo motivo tem frase, e nenhuma é curta demais para explicar",
  MOTIVOS.every((m) => frasePorMotivo(m).length > 40),
);
checa(
  "cancelar no Discord não é apresentado como erro nosso",
  /nada foi alterado/i.test(frasePorMotivo("recusado")),
);
checa(
  "o link expirado manda a pessoa para o lugar certo",
  /perfil/i.test(frasePorMotivo("estado-invalido")),
);
checa(
  "quando não dá para saber de quem é, a saída oferecida é o código",
  /vincular/i.test(frasePorMotivo("nao-achei-cadastro")),
);

console.log(
  falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ vínculo em um clique: ok",
);
process.exit(falhas ? 1 : 0);
