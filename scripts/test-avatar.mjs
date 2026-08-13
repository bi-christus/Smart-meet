/**
 * Testes da foto de perfil.
 *
 * Errar aqui é caro em duas moedas, e nenhuma das duas aparece como erro na
 * tela de quem errou:
 *
 *  - PESO, PARA TODO MUNDO. A foto mora num campo do doc de `/users`, e
 *    `subscribeUsers` assina `/users` INTEIRA em sete telas. Um teto frouxo — ou
 *    medido na régua errada, que é o erro fácil, porque base64 infla 33% — não
 *    torna a foto de ninguém pesada: torna TODA tela do app um download de
 *    megabytes, para gente que nem sabe que existe foto de perfil. E o sintoma
 *    não é uma mensagem de erro, é o quadro demorando a abrir.
 *
 *  - EXECUÇÃO DE SCRIPT, PARA TODO MUNDO. O valor aprovado aqui vai direto para
 *    o `src` de um `<img>` que aparece no card, no histórico e no comentário —
 *    ou seja, na sessão de quem apenas ABRIU o quadro, sem clicar em nada.
 *    `data:image/svg+xml` é o caso que engana: tem "image" no nome, o navegador
 *    o desenha, e ele carrega `<script>`. Por isso a lista é de PERMISSÃO, e por
 *    isso ela é testada com os formatos que ninguém pediu.
 *
 * O terceiro bloco confere uma coisa que nenhum dos dois arquivos consegue
 * conferir sozinho: que `firestore.rules` e `avatar-core.ts` continuam dizendo o
 * MESMO teto e a MESMA lista. São duas linguagens diferentes escrevendo a mesma
 * decisão, e o dia em que uma mudar sozinha, a outra passa a mentir.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import {
  avatarDe,
  conferirFoto,
  corDeAvatar,
  inicialDe,
  LADO_FOTO_PX,
  LIMITE_FOTO_BYTES,
  LIMITE_FOTO_CHARS,
  tamanhoDataUri,
} from "../src/lib/avatar-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

/** Data URI com exatamente `bytes` bytes de conteúdo, codificado de verdade. */
function foto(bytes, mime = "image/jpeg") {
  return `data:${mime};base64,${Buffer.alloc(bytes, 7).toString("base64")}`;
}

const OK = foto(3000);

// --- tamanho: a conta tem de ser a do base64, não a da string --------------
// O `Buffer` decodifica de verdade; `tamanhoDataUri` só faz aritmética. Se os
// dois discordarem em qualquer comprimento, a aritmética está errada — inclusive
// nos três restos possíveis da divisão por 3, que são o que o `=` resolve.
const COMPRIMENTOS = [1, 2, 3, 4, 5, 6, 100, 999, 1000, 1001, 4095, 12288];
const discordantes = COMPRIMENTOS.filter((n) => {
  const uri = foto(n);
  const b64 = uri.slice(uri.indexOf(",") + 1);
  return tamanhoDataUri(uri) !== Buffer.from(b64, "base64").length;
});
checa(
  "o tamanho calculado bate com o decodificado, em todo resto de divisão",
  discordantes.length === 0,
  discordantes.join(", ") || `${COMPRIMENTOS.length} comprimentos conferidos`,
);

checa(
  "o enchimento '=' não conta como dado",
  tamanhoDataUri("data:image/png;base64,QUJD") === 3 &&
    tamanhoDataUri("data:image/png;base64,QUI=") === 2 &&
    tamanhoDataUri("data:image/png;base64,QQ==") === 1,
  `${tamanhoDataUri("data:image/png;base64,QUJD")}/${tamanhoDataUri("data:image/png;base64,QUI=")}/${tamanhoDataUri("data:image/png;base64,QQ==")}`,
);

// ISTO é a armadilha, escrita como asserção: a mesma imagem que TEM o tamanho
// do teto ocupa 33% a mais de caracteres. Um teto medido em `length` da string
// aceitaria só três quartos do que este módulo aprova.
const NO_TETO = foto(LIMITE_FOTO_BYTES);
checa(
  "medir a string em vez do conteúdo erraria a régua em ~1/3",
  tamanhoDataUri(NO_TETO) === LIMITE_FOTO_BYTES &&
    NO_TETO.length > LIMITE_FOTO_BYTES * 1.3,
  `${LIMITE_FOTO_BYTES} bytes viram ${NO_TETO.length} caracteres`,
);

checa("URL comum não tem tamanho de data URI", tamanhoDataUri("https://x.com/a.jpg") === 0);
checa("texto solto não tem tamanho de data URI", tamanhoDataUri("foto") === 0);
checa("data URI sem base64 não é medido", tamanhoDataUri("data:image/png,QUJD") === 0);
checa("string vazia devolve zero", tamanhoDataUri("") === 0);

// --- o portão: só bitmap, e só até o teto ---------------------------------
checa("JPEG pequeno passa", conferirFoto(OK).ok);
checa("PNG pequeno passa", conferirFoto(foto(3000, "image/png")).ok);
checa(
  "exatamente no teto ainda passa",
  conferirFoto(NO_TETO).ok,
  `${tamanhoDataUri(NO_TETO)} bytes`,
);

const ACIMA = foto(LIMITE_FOTO_BYTES + 1);
const rAcima = conferirFoto(ACIMA);
checa("um byte acima do teto é recusado", !rAcima.ok, rAcima.motivo ?? "");
checa(
  "a recusa por tamanho diz o tamanho e o limite, em KB",
  !rAcima.ok && /12,1 KB/.test(rAcima.motivo) && /12,0 KB/.test(rAcima.motivo),
  rAcima.motivo ?? "",
);
// Um byte acima do teto arredondado para baixo produziria "tem 12,0 KB e o
// limite é 12,0 KB" — que lê como defeito do sistema, não como foto grande.
checa(
  "a recusa nunca diz que o tamanho é igual ao limite",
  !rAcima.ok && !/com (\d+,\d) KB e o limite é \1 KB/.test(rAcima.motivo),
  rAcima.motivo ?? "",
);

// Estes são o ataque, não casos de borda. `image/svg+xml` tem "image" no nome e
// mesmo assim executa script no `<img>`; é ele que a lista de permissão existe
// para recusar.
const RECUSADOS = [
  ["data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==", "SVG em base64"],
  ["data:image/svg+xml,<svg onload=alert(1)>", "SVG cru"],
  ["data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "HTML em base64"],
  ["data:text/html,<script>alert(1)</script>", "HTML cru"],
  ["data:image/gif;base64,R0lGODlhAQABAAAAACw=", "GIF (fora da lista)"],
  ["data:image/webp;base64,UklGRg==", "WebP (fora da lista)"],
  ["javascript:alert(document.cookie)", "javascript:"],
  ["https://lh3.googleusercontent.com/a/abc", "URL comum não se grava em photo"],
  ["data:image/jpeg;base64,QUJD QUJD", "base64 com espaço no meio"],
  ["data:image/jpeg;base64,QUJD\nQUJD", "base64 com quebra de linha"],
  ["data:image/jpeg;base64,<script>", "conteúdo fora do alfabeto base64"],
  ["data:image/jpeg;base64,", "prefixo sem conteúdo"],
  ["", "string vazia"],
  ["    ", "só espaços"],
];
RECUSADOS.forEach(([valor, quem]) => {
  const r = conferirFoto(valor);
  checa(`recusado: ${quem}`, !r.ok, r.ok ? "PASSOU" : "");
});
checa(
  "toda recusa vem com motivo em português, pronto para a tela",
  RECUSADOS.every(([v]) => {
    const r = conferirFoto(v);
    return !r.ok && typeof r.motivo === "string" && r.motivo.trim().length > 10;
  }),
);
// A ordem das perguntas importa: um SVG de 2 KB é pequeno, e recusá-lo por
// "grande demais" mandaria a pessoa comprimir a imagem errada.
checa(
  "SVG é recusado por FORMATO, não por tamanho",
  /[Ff]ormato/.test(conferirFoto("data:image/svg+xml;base64,PHN2Zz4=").motivo),
  conferirFoto("data:image/svg+xml;base64,PHN2Zz4=").motivo,
);

// --- precedência do avatar --------------------------------------------------
const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocABC=s96-c";
const P = { email: "op@px.com.br", name: "Ítalo Araujo", color: "#54b8ff" };

checa(
  "a foto escolhida ganha do Google",
  JSON.stringify(avatarDe({ ...P, photo: OK }, GOOGLE)) ===
    JSON.stringify({ tipo: "foto", src: OK }),
);
checa(
  "sem foto escolhida, vale a do Google",
  avatarDe(P, GOOGLE).tipo === "foto" && avatarDe(P, GOOGLE).src === GOOGLE,
  JSON.stringify(avatarDe(P, GOOGLE)),
);
checa(
  "sem nenhuma das duas, a inicial",
  avatarDe(P).tipo === "inicial" && avatarDe(P).letra === "Í",
  JSON.stringify(avatarDe(P)),
);
checa("photo null cai para a inicial", avatarDe({ ...P, photo: null }).tipo === "inicial");

// A conferência na LEITURA é o que faz a saída ser segura por construção: um
// documento gravado pelo Admin SDK, ou antes desta versão, não passa a valer só
// porque está gravado.
checa(
  "photo com SVG guardado no banco NÃO chega ao <img>",
  avatarDe({ ...P, photo: "data:image/svg+xml;base64,PHN2Zz4=" }).tipo === "inicial",
);
checa(
  "photo acima do teto guardado no banco também não chega",
  avatarDe({ ...P, photo: ACIMA }).tipo === "inicial",
);
checa(
  "photo inválida cai para o Google, não para a inicial",
  avatarDe({ ...P, photo: "data:text/html,<script>" }, GOOGLE).src === GOOGLE,
);

// A URL do Google não é data URI e continua valendo — mas passa pelo mesmo
// portão de esquema dos links da demanda.
checa(
  "URL http (sem s) do provedor é recusada",
  avatarDe(P, "http://lh3.googleusercontent.com/a/x").tipo === "inicial",
);
checa(
  "javascript: no lugar da foto do provedor é recusado",
  avatarDe(P, "javascript:alert(1)").tipo === "inicial",
);
checa(
  "texto sem esquema não vira endereço de imagem",
  avatarDe(P, "lh3.googleusercontent.com/a/x").tipo === "inicial",
);
checa("foto do provedor vazia é ignorada", avatarDe(P, "").tipo === "inicial");
checa("foto do provedor null é ignorada", avatarDe(P, null).tipo === "inicial");

// --- a inicial, nos casos que a vida traz ---------------------------------
checa("nome comum", inicialDe("Fulano de Tal", "f@px.com.br") === "F");
checa("espaço na frente não vira a inicial", inicialDe("   ana", "a@px.com.br") === "A");
checa("nome vazio cai no e-mail", inicialDe("", "zelia@px.com.br") === "Z");
checa("nome só de espaços cai no e-mail", inicialDe("   ", "bruno@px.com.br") === "B");
checa("sem nome e sem e-mail sobra '?'", inicialDe("", "") === "?");
checa("nome e e-mail ausentes sobram '?'", inicialDe(null, undefined) === "?");
checa("acento é preservado e sobe para maiúscula", inicialDe("ítalo", "i@px") === "Í");
checa("dígito serve de inicial", inicialDe("3M Brasil", "x@px") === "3");
checa(
  "usuário inexistente ainda devolve avatar",
  avatarDe(null).tipo === "inicial" && avatarDe(null).letra === "?",
  JSON.stringify(avatarDe(null)),
);
checa(
  "usuário sem nome usa a inicial do e-mail",
  avatarDe({ email: "zelia@px.com.br" }).letra === "Z",
);

// --- a cor: a mesma pessoa, a mesma cor, em toda tela ----------------------
checa("cor é estável entre chamadas", corDeAvatar("op@px.com.br") === corDeAvatar("op@px.com.br"));
checa(
  "caixa e espaço não mudam a cor da mesma pessoa",
  corDeAvatar("  OP@px.com.BR ") === corDeAvatar("op@px.com.br"),
);
checa("cor é hex", /^#[0-9a-f]{6}$/i.test(corDeAvatar("op@px.com.br")));
checa("pessoas diferentes tendem a cores diferentes", corDeAvatar("a@px") !== corDeAvatar("b@px"));
checa("a cor guardada no cadastro é respeitada", avatarDe(P).cor === "#54b8ff");
checa(
  "cor guardada que não é hex volta para o hash (a tela não precisa de fallback)",
  avatarDe({ ...P, color: "laranja" }).cor === corDeAvatar(P.email),
  avatarDe({ ...P, color: "laranja" }).cor,
);
checa(
  "sem cor guardada, o hash do e-mail",
  avatarDe({ email: "op@px.com.br" }).cor === corDeAvatar("op@px.com.br"),
);

// --- o módulo e a regra dizem a mesma coisa? ------------------------------
// Sem isto, afrouxar um dos dois lados passa despercebido: o módulo recusa e a
// pessoa vê "formato não aceito", ou a regra recusa e ela vê "sem permissão" —
// e ninguém liga uma coisa à outra.
const regras = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

checa(
  "a conversão bytes→caracteres é a esperada",
  LIMITE_FOTO_CHARS === Math.ceil(LIMITE_FOTO_BYTES / 3) * 4 + 23 &&
    LIMITE_FOTO_CHARS === 16407,
  String(LIMITE_FOTO_CHARS),
);
// O recorte que a interface produz precisa caber com folga sobre o pior JPEG
// plausível daquele tamanho (~9 KiB), senão o laço de reencode dela desce a
// escada de qualidade inteira e entrega uma foto borrada — ou nenhuma.
checa(
  `o teto comporta o recorte de ${LADO_FOTO_PX}×${LADO_FOTO_PX} com folga`,
  LADO_FOTO_PX === 128 && LIMITE_FOTO_BYTES >= 9 * 1024,
  `${LADO_FOTO_PX}px · ${LIMITE_FOTO_BYTES} bytes`,
);

const tetoNaRegra = /f\.size\(\)\s*<=\s*(\d+)/.exec(regras);
checa(
  "o teto da regra é o mesmo do módulo, já convertido para caracteres",
  tetoNaRegra && Number(tetoNaRegra[1]) === LIMITE_FOTO_CHARS,
  `regra: ${tetoNaRegra?.[1] ?? "não encontrado"} · módulo: ${LIMITE_FOTO_CHARS}`,
);

const regexNaRegra = /f\.matches\('([^']+)'\)/.exec(regras);
checa("a regra tem a lista de permissão de formato", !!regexNaRegra);
if (regexNaRegra) {
  // Comparar o texto das duas regexes seria frágil (uma escapa a barra, a outra
  // não). O que importa é o VEREDITO: as duas têm de responder igual à mesma
  // bateria, incluindo o que cada uma recusa.
  const daRegra = new RegExp(regexNaRegra[1]);
  const AMOSTRAS = [
    OK,
    NO_TETO,
    foto(500, "image/png"),
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:text/html;base64,PHA+",
    "data:image/gif;base64,R0lGOD==",
    "data:image/jpeg;base64,QUJD QUJD",
    "data:image/jpeg;base64,",
    "https://lh3.googleusercontent.com/a/x",
    "javascript:alert(1)",
    "",
  ];
  const divergentes = AMOSTRAS.filter((v) => {
    const peloModulo = conferirFoto(v).ok;
    // O tamanho é comparado à parte; aqui só o formato.
    const soFormato = peloModulo || tamanhoDataUri(v) > LIMITE_FOTO_BYTES;
    return daRegra.test(v) !== soFormato;
  });
  checa(
    "regra e módulo recusam e aceitam exatamente os mesmos formatos",
    divergentes.length === 0,
    divergentes.map((v) => v.slice(0, 40)).join(" | ") ||
      `${AMOSTRAS.length} amostras conferidas`,
  );
}

checa(
  "o dono continua trancado em uid/lastLogin/photo — role e active fora",
  /hasOnly\(\['uid', 'lastLogin', 'photo'\]\)/.test(regras),
);

console.log(
  falhas === 0
    ? "\nTodos os testes de foto de perfil passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
