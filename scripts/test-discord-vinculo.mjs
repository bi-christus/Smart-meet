/**
 * Testes do vínculo com o Discord.
 *
 * Duas coisas muito diferentes são testadas aqui, e as duas falham calado:
 *
 *  - A ASSINATURA. É o único portão da rota `/api/discord/interactions`, que é
 *    pública por obrigação (o Discord chama de fora) e grava vínculo de conta.
 *    Um `assinaturaConfere` que devolve `true` a mais deixa qualquer pessoa na
 *    internet ligar a própria conta do Discord ao e-mail de quem quiser. E o
 *    modo de falhar é traiçoeiro: uma rota que responde 200 para assinatura
 *    inválida é ACEITA pelo Discord na hora de salvar a URL — tudo parece
 *    configurado. Por isso o teste usa um par de chaves DE VERDADE, gerado
 *    aqui, e verifica os dois lados: o que passa e o que não pode passar.
 *
 *  - O CÓDIGO. Ele é lido numa tela e digitado noutra, às vezes do computador
 *    para o celular. Um alfabeto com `l1O0` transforma um fluxo de dez segundos
 *    em três tentativas e uma desistência — e a pessoa conclui que "não
 *    funciona", não que digitou errado.
 *
 * Roda com o strip de tipos nativo do Node sobre os .ts reais — sem cópia.
 */
import { generateKeyPairSync, sign } from "node:crypto";

import {
  ALFABETO_CODIGO,
  COMANDOS,
  FLAG_EFEMERA,
  TAMANHO_CODIGO,
  TIPO_INTERACAO,
  TIPO_RESPOSTA,
  VALIDADE_CODIGO_MS,
  codigoValido,
  expirado,
  formatarCodigo,
  gerarCodigo,
  lerComando,
  normalizarCodigo,
  respostaEfemera,
  respostaPong,
  segundosRestantes,
} from "../src/lib/discord-vinculo-core.ts";
import { assinaturaConfere } from "../src/lib/server/discord-assinatura.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- o alfabeto: nada que se leia errado ----------------------------------
for (const ruim of ["I", "L", "O", "0", "1"]) {
  checa(
    `'${ruim}' está fora do alfabeto (é o par que se digita errado)`,
    !ALFABETO_CODIGO.includes(ruim),
  );
}
checa(
  "o alfabeto não tem repetido",
  new Set(ALFABETO_CODIGO).size === ALFABETO_CODIGO.length,
);
checa(
  "o espaço de códigos é grande o bastante para força bruta não valer a pena",
  ALFABETO_CODIGO.length ** TAMANHO_CODIGO > 100_000_000,
  `${(ALFABETO_CODIGO.length ** TAMANHO_CODIGO).toLocaleString("pt-BR")}`,
);

// --- gerarCodigo: o sorteio entra por fora ---------------------------------
let n = 0;
const sequencial = (teto) => n++ % teto;
const codigo = gerarCodigo(sequencial);
checa("o código tem o tamanho combinado", codigo.length === TAMANHO_CODIGO, codigo);
checa("e só usa o alfabeto", codigoValido(codigo), codigo);
checa(
  "o sorteio é de fora, então o teste é determinístico",
  (() => {
    n = 0;
    return gerarCodigo(sequencial) === codigo;
  })(),
);
checa(
  "sorteio no topo do teto não estoura o alfabeto",
  gerarCodigo(() => ALFABETO_CODIGO.length - 1) ===
    ALFABETO_CODIGO.at(-1).repeat(TAMANHO_CODIGO),
);

// --- normalizarCodigo: o que sai de um copiar-e-colar ---------------------
checa("minúscula sobe", normalizarCodigo("abcd23") === "ABCD23");
checa(
  "o hífen que a tela mostra não atrapalha",
  normalizarCodigo("ABC-D23") === "ABCD23",
);
checa("espaço em volta e no meio some", normalizarCodigo(" AB CD 23 ") === "ABCD23");
checa(
  "caractere que não existe no alfabeto é descartado, não vira erro",
  normalizarCodigo("A@B#C$D%2^3") === "ABCD23",
);
checa(
  "código longo demais é cortado, não aceito inteiro",
  normalizarCodigo("ABCD23XYZW").length === TAMANHO_CODIGO,
);
checa("vazio continua vazio", normalizarCodigo("") === "");
checa("nulo não explode", normalizarCodigo(undefined) === "");
checa(
  "o que sobra curto NÃO passa por válido",
  codigoValido(normalizarCodigo("AB")) === false,
);

// --- formatarCodigo: só para mostrar --------------------------------------
checa("o código sai legível na tela", formatarCodigo("ABCD23") === "ABC-D23");
checa(
  "a formatação volta pela normalização (é o ciclo que a pessoa faz)",
  normalizarCodigo(formatarCodigo("ABCD23")) === "ABCD23",
);
checa("código incompleto não ganha hífen", formatarCodigo("AB") === "AB");

// --- validade -------------------------------------------------------------
const t0 = 1_700_000_000_000;
checa("recém-criado vale", expirado(t0, t0) === false);
checa("um milissegundo antes ainda vale", expirado(t0, t0 + VALIDADE_CODIGO_MS - 1) === false);
checa("no instante da validade já morreu", expirado(t0, t0 + VALIDADE_CODIGO_MS) === true);
checa("bem depois, morto", expirado(t0, t0 + 3 * VALIDADE_CODIGO_MS) === true);
checa(
  "a contagem regressiva bate com a validade",
  segundosRestantes(t0, t0) === VALIDADE_CODIGO_MS / 1000,
  `${segundosRestantes(t0, t0)}`,
);
checa(
  "contagem nunca fica negativa (a tela mostraria '-42 s')",
  segundosRestantes(t0, t0 + 10 * VALIDADE_CODIGO_MS) === 0,
);

// --- lerComando -----------------------------------------------------------
const dentroDoServidor = {
  type: TIPO_INTERACAO.COMANDO,
  data: { name: "vincular", options: [{ name: "codigo", type: 3, value: "ABC-D23" }] },
  member: { user: { id: "42", username: "italo", global_name: "Ítalo" } },
};
const lido = lerComando(dentroDoServidor);
checa("lê o nome do comando", lido.nome === "vincular");
checa("lê a opção de texto", lido.opcoes.codigo === "ABC-D23");
checa("o id vem do Discord, não do corpo", lido.discordId === "42");
checa(
  "o nome mostrado é o que a pessoa reconhece (global_name antes do @)",
  lido.discordNome === "Ítalo",
);

const naDM = {
  type: TIPO_INTERACAO.COMANDO,
  data: { name: "desvincular" },
  user: { id: "99", username: "kaua" },
};
checa(
  "comando digitado na DM também é lido — `user` em vez de `member.user`",
  lerComando(naDM)?.discordId === "99",
);
checa(
  "sem global_name, cai no @",
  lerComando(naDM)?.discordNome === "kaua",
);
checa("PING não é comando", lerComando({ type: TIPO_INTERACAO.PING }) === null);
checa("payload sem usuário é recusado", lerComando({ type: 2, data: { name: "x" } }) === null);
checa("payload sem nome é recusado", lerComando({ type: 2, member: { user: { id: "1" } } }) === null);
checa("lixo não explode", lerComando(null) === null && lerComando("oi") === null);
checa(
  "opção que não é texto é ignorada, não convertida",
  lerComando({
    type: 2,
    data: { name: "v", options: [{ name: "codigo", value: 12345 }] },
    user: { id: "1" },
  }).opcoes.codigo === undefined,
);

// --- respostas ------------------------------------------------------------
checa("PING responde PONG", respostaPong().type === TIPO_RESPOSTA.PONG);
const r = respostaEfemera("Pronto — vinculado a ia02@px.com.br");
checa("a resposta é mensagem", r.type === TIPO_RESPOSTA.MENSAGEM);
checa(
  "e é EFÊMERA — o e-mail de quem vinculou não vira mensagem pública",
  r.data.flags === FLAG_EFEMERA,
);
checa(
  "texto gigante é cortado no teto do Discord",
  respostaEfemera("x".repeat(5000)).data.content.length === 2000,
);

// --- os comandos registrados ----------------------------------------------
// A lista é conferida por INTEIRO, e de propósito: o script de registro manda
// tudo com PUT, e PUT substitui. Um comando que sumisse daqui sumiria do
// Discord no registro seguinte, e o sintoma seria "esse comando não existe"
// para quem já usava.
checa(
  "a lista é exatamente a que o Discord deve oferecer",
  COMANDOS.map((c) => c.name).join(",") ===
    "vincular,desvincular,minhas-demandas,demanda",
  COMANDOS.map((c) => c.name).join(","),
);
checa(
  "nome de comando do Discord: minúsculo, sem espaço",
  COMANDOS.every((c) => /^[a-z][a-z0-9-]{0,31}$/.test(c.name)),
);
checa(
  "a busca é opção obrigatória de /demanda",
  COMANDOS.find((c) => c.name === "demanda").options[0].name === "busca" &&
    COMANDOS.find((c) => c.name === "demanda").options[0].required === true,
);
checa(
  "todo comando tem descrição (o Discord recusa sem)",
  COMANDOS.every((c) => c.description.length > 0 && c.description.length <= 100),
);
checa(
  "o código é opção obrigatória de /vincular",
  COMANDOS[0].options[0].name === "codigo" && COMANDOS[0].options[0].required === true,
);

// --- a assinatura: com par de chaves de verdade ---------------------------
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const chavePublicaHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

const corpoCru = JSON.stringify({ type: 1 });
const timestamp = "1700000000";
const assinar = (ts, corpo) =>
  sign(null, Buffer.from(ts + corpo, "utf8"), privateKey).toString("hex");
const boa = assinar(timestamp, corpoCru);

checa(
  "assinatura legítima passa",
  assinaturaConfere({
    chavePublicaHex,
    assinaturaHex: boa,
    timestamp,
    corpoCru,
  }) === true,
);
checa(
  "corpo adulterado NÃO passa",
  assinaturaConfere({
    chavePublicaHex,
    assinaturaHex: boa,
    timestamp,
    corpoCru: JSON.stringify({ type: 2 }),
  }) === false,
);
checa(
  "timestamp trocado NÃO passa (é o que impede reenvio de requisição antiga)",
  assinaturaConfere({
    chavePublicaHex,
    assinaturaHex: boa,
    timestamp: "1700000001",
    corpoCru,
  }) === false,
);
checa(
  "assinatura de OUTRA chave NÃO passa",
  assinaturaConfere({
    chavePublicaHex: generateKeyPairSync("ed25519")
      .publicKey.export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex"),
    assinaturaHex: boa,
    timestamp,
    corpoCru,
  }) === false,
);
checa(
  "sem chave configurada NÃO passa (Preview sem variável não vira porta aberta)",
  assinaturaConfere({
    chavePublicaHex: undefined,
    assinaturaHex: boa,
    timestamp,
    corpoCru,
  }) === false,
);
checa(
  "sem assinatura NÃO passa",
  assinaturaConfere({ chavePublicaHex, assinaturaHex: null, timestamp, corpoCru }) === false,
);
checa(
  "chave colada pela metade NÃO passa por prefixo",
  assinaturaConfere({
    chavePublicaHex: chavePublicaHex.slice(0, 40),
    assinaturaHex: boa,
    timestamp,
    corpoCru,
  }) === false,
);
checa(
  "assinatura com lixo não-hex NÃO passa",
  assinaturaConfere({
    chavePublicaHex,
    assinaturaHex: `${boa.slice(0, 126)}zz`,
    timestamp,
    corpoCru,
  }) === false,
);
checa(
  "assinatura truncada NÃO passa",
  assinaturaConfere({
    chavePublicaHex,
    assinaturaHex: boa.slice(0, 100),
    timestamp,
    corpoCru,
  }) === false,
);
checa(
  "chave com espaço em volta ainda passa (é o Ctrl+V do painel da Vercel)",
  assinaturaConfere({
    chavePublicaHex: `  ${chavePublicaHex}\n`,
    assinaturaHex: boa,
    timestamp,
    corpoCru,
  }) === true,
);
checa(
  "corpo real de comando, assinado, passa",
  (() => {
    const corpo = JSON.stringify(dentroDoServidor);
    return assinaturaConfere({
      chavePublicaHex,
      assinaturaHex: assinar(timestamp, corpo),
      timestamp,
      corpoCru: corpo,
    });
  })() === true,
);

console.log(
  falhas === 0
    ? "\n✅ vínculo com o discord: ok"
    : `\n❌ vínculo com o discord: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
