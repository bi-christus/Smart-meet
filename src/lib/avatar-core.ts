/**
 * Foto de perfil — o que dá para decidir sobre uma imagem sem abrir a imagem.
 *
 * Módulo puro, como `links-core`, `tags-ref` e `historico-core`: sem
 * `firebase/firestore` e — o que é menos óbvio — SEM DOM. Nada de `document`,
 * `Image` ou `canvas` aqui dentro. O redimensionamento acontece no navegador e
 * mora na interface; o que é REGRA (o que cabe, o que é imagem, qual avatar
 * ganha) mora aqui e é testado por `scripts/test-avatar.mjs` no Node puro.
 *
 * ONDE A FOTO VIVE, e por quê. Ela é um campo do próprio doc de `/users`,
 * gravado como data URI. As duas alternativas foram descartadas por motivo
 * concreto:
 *
 *  - Firebase Storage exigiria habilitar um bucket no console, que é ação
 *    humana (AGENTS.md §6) — a frente inteira ficaria parada esperando.
 *  - Subcoleção de preferências (como `/users/{id}/prefs`) esconderia a foto de
 *    quem precisa dela: o avatar aparece no card, no histórico, no comentário e
 *    no Dashboard, sempre de OUTRA pessoa. Numa subcoleção seria uma leitura por
 *    pessoa por tela; no doc, vem de graça no `subscribeUsers` que as telas já
 *    assinam.
 *
 * E É EXATAMENTE POR ISSO QUE O TAMANHO É O DESENHO INTEIRO. `subscribeUsers`
 * assina `/users` INTEIRA em sete telas. Cada byte gravado em `photo` é baixado
 * por todo cliente, em toda tela. `LIMITE_FOTO_BYTES` abaixo não é higiene: é a
 * única coisa que separa "avatar" de "cada pessoa baixando megabytes o dia
 * inteiro".
 *
 * A SEGUNDA TRANCA é o formato, e ela é lista de PERMISSÃO — só JPEG e PNG.
 * Mesmo raciocínio de `normalizarUrl` em `links-core.ts`: o que sai daqui vai
 * para o `src` de um `<img>`, e `data:image/svg+xml` é o caso que engana, porque
 * tem "image" no nome e mesmo assim carrega `<script>`. Lista de proibição
 * deixaria passar o formato que ninguém previu; a de permissão recusa por
 * padrão, e o preço de errar para o lado do rigor é uma foto recusada.
 */
import { normalizarUrl } from "./links-core.ts";

/**
 * Lado do recorte, em pixels, que a interface produz antes de gravar.
 *
 * Mora aqui, e não dentro do modal que corta a imagem, porque ele e o teto
 * abaixo são UMA decisão só: dobrar este número para 256 multiplica por ~4 o
 * peso do JPEG e derruba a conta de quanto todo cliente baixa. Separados, um
 * mudaria sem o outro — e o sintoma seria a interface reencodando até a foto
 * ficar borrada, ou nunca conseguindo gravar.
 *
 * 128 porque o maior avatar do app tem 38 px de CSS: cobre 2× em tela retina
 * com sobra, e o passo seguinte da escada não caberia no teto.
 */
export const LADO_FOTO_PX = 128;

/**
 * Teto do que pode ser gravado em `photo`, em bytes da imagem DECODIFICADA.
 *
 * A conta que decide este número não é "quanto pesa uma foto", é "quanto todo
 * mundo baixa". No pior caso — cadastro inteiro com foto no teto — cada cliente
 * puxa, por tela:
 *
 *      40 pessoas × 12 KiB =  480 KiB
 *      80 pessoas × 12 KiB =  960 KiB
 *     150 pessoas × 12 KiB = 1,76 MiB   ← aqui este desenho acaba
 *
 * 12 KiB é o maior valor que mantém o cadastro inteiro abaixo de 1 MiB no
 * tamanho que a Rede tem hoje, e ainda deixa folga do outro lado: o avatar
 * maior do app tem 40 px de CSS, a interface grava um recorte de 128×128 (2×
 * com sobra em tela retina), e 128×128 em JPEG sai entre 5 e 9 KiB. Quem não
 * couber, a interface reencoda com menos qualidade e pergunta de novo a
 * `conferirFoto` — o teto é o único lugar onde esse laço para.
 *
 * O número é múltiplo de 3 de propósito: base64 empacota de 3 em 3 bytes, e
 * 12288 / 3 = 4096 dá a conversão exata para caracteres, sem sobra a arredondar
 * (ver `LIMITE_FOTO_CHARS`).
 *
 * Se um dia a Rede passar de ~150 pessoas, o conserto NÃO é apertar este
 * número — é tirar a foto de `/users` (coleção espelho ou Storage). O que se
 * vigia é o total por tela, nunca o tamanho de uma foto isolada.
 */
export const LIMITE_FOTO_BYTES = 12 * 1024;

/** Os únicos prefixos aceitos. Acrescentar um aqui obriga a mexer na regra. */
const PREFIXOS = ["data:image/jpeg;base64,", "data:image/png;base64,"];

/**
 * O MESMO teto, em caracteres da string gravada — a única régua que a regra do
 * Firestore sabe medir, e por isso o número que aparece em `firestore.rules`.
 *
 * `size()` sobre string em CEL conta CARACTERES, não bytes de imagem, e o valor
 * é base64: cada 3 bytes viram 4 caracteres. Copiar `LIMITE_FOTO_BYTES` para a
 * regra seria régua diferente — ela negaria 1/4 das fotos que este módulo
 * aprova, e a rejeição chegaria como "sem permissão" para quem tem permissão.
 *
 *   ceil(12288 / 3) × 4 = 16384 caracteres de base64
 *   + 23 do prefixo mais longo ('data:image/jpeg;base64,')
 *   = 16407
 *
 * A regra só pode confiar nesse número porque TAMBÉM prende o alfabeto a ASCII
 * com uma regex: sem isso, 16407 caracteres fora do ASCII pesariam até 4× mais
 * na rede de todo mundo, e `size()` não veria diferença nenhuma.
 */
export const LIMITE_FOTO_CHARS =
  Math.ceil(LIMITE_FOTO_BYTES / 3) * 4 +
  Math.max(...PREFIXOS.map((p) => p.length));

/**
 * O que passa. Idêntica, caractere a caractere, à regex de `fotoOk()` em
 * `firestore.rules` — as duas são a mesma decisão escrita em duas linguagens, e
 * `test-avatar.mjs` confere que não se afastaram.
 */
const FOTO_ACEITA = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Tamanho em bytes do conteúdo de um data URI base64, SEM alocar o binário.
 *
 * Decodificar para medir seria gastar memória (e, no navegador, um `atob` de
 * 16 KB por foto por render) para responder uma pergunta que a aritmética
 * responde: base64 leva 4 caracteres para cada 3 bytes, e o `=` do fim é
 * enchimento, não dado.
 *
 * Contar `uri.length` — o erro fácil — mediria a régua errada por 33%: um teto
 * de 12288 CARACTERES aceitaria só 9216 bytes de imagem.
 *
 * Devolve 0 para o que não é data URI base64 (inclusive URL comum). Quem decide
 * se isso é aceitável é `conferirFoto`; aqui, "não tem payload base64" e "tem um
 * payload vazio" são a mesma resposta de propósito, porque a resposta seguinte é
 * a mesma nos dois casos.
 *
 * A conta só vale porque `FOTO_ACEITA` proíbe espaço e quebra de linha dentro do
 * base64 — com elas, o comprimento deixaria de prever o tamanho decodificado.
 */
export function tamanhoDataUri(uri: string): number {
  const t = (uri ?? "").trim();
  const marca = ";base64,";
  const i = t.indexOf(marca);
  if (!t.startsWith("data:") || i < 0) return 0;

  const b64 = t.slice(i + marca.length);
  if (!b64) return 0;
  const enchimento = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - enchimento);
}

export type FotoConferida = { ok: true } | { ok: false; motivo: string };

/**
 * "12,1 KB" — com vírgula, que é como se lê número em português.
 *
 * Arredonda PARA CIMA, e isso não é detalhe: uma foto um byte acima do teto
 * arredondada para baixo produziria "a imagem tem 12,0 KB e o limite é 12,0 KB",
 * que lê como defeito do sistema. Para cima, o número recusado é sempre maior
 * que o limite — que é o que a frase promete.
 */
function emKB(bytes: number): string {
  const kb = Math.ceil((bytes / 1024) * 10) / 10;
  return `${kb.toFixed(1).replace(".", ",")} KB`;
}

/**
 * A imagem cabe e é imagem?
 *
 * O `motivo` é texto de tela, não de log: ele aparece do lado do botão que a
 * pessoa acabou de clicar. Por isso diz o que fazer a seguir, e não o nome do
 * campo que falhou.
 *
 * A ordem das perguntas é a ordem do risco. O formato vem antes do tamanho
 * porque um `data:image/svg+xml` de 2 KB é pequeno e mesmo assim é o problema
 * grave; recusá-lo por "grande demais" seria a mensagem errada.
 */
export function conferirFoto(uri: string): FotoConferida {
  const t = (uri ?? "").trim();
  if (!t) return { ok: false, motivo: "Nenhuma imagem foi escolhida." };

  if (!FOTO_ACEITA.test(t)) {
    return {
      ok: false,
      motivo:
        "Formato não aceito. A foto precisa ser JPEG ou PNG — SVG, HTML e " +
        "endereços de outro site não entram aqui.",
    };
  }

  const bytes = tamanhoDataUri(t);
  if (bytes <= 0) return { ok: false, motivo: "A imagem chegou vazia." };
  if (bytes > LIMITE_FOTO_BYTES) {
    return {
      ok: false,
      motivo:
        `A imagem ficou com ${emKB(bytes)} e o limite é ` +
        `${emKB(LIMITE_FOTO_BYTES)}. Recorte mais perto do rosto ou escolha ` +
        `uma foto menor.`,
    };
  }
  return { ok: true };
}

/**
 * Paleta do avatar. Mora aqui e não em `users.ts` porque quem precisa dela é a
 * regra (qual cor sai para qual pessoa), e regra tem de caber no módulo puro;
 * `users.ts` reexporta como `pickColor`, que é o nome que o resto do app já usa.
 */
const CORES_AVATAR = [
  "#ff6a2b",
  "#37d39b",
  "#f5b13d",
  "#c77dff",
  "#54b8ff",
  "#ff8f6b",
  "#6e79ff",
];

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/**
 * Cor estável a partir de uma semente (na prática, o e-mail).
 *
 * Estável é o requisito inteiro: a mesma pessoa tem de sair na mesma cor no
 * card, no histórico e no Dashboard, senão a cor deixa de ser pista e vira
 * ruído. Mesmo hash de `tagColor` e `corDoLink`.
 *
 * A semente é normalizada (aparada e em minúsculas) porque o e-mail chega cru do
 * token do Google numa tela e minúsculo do id do documento na outra — sem isso a
 * MESMA pessoa teria duas cores dependendo de quem a mostrou.
 */
export function corDeAvatar(semente: string): string {
  const s = (semente ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CORES_AVATAR[h % CORES_AVATAR.length];
}

/**
 * A letra do avatar sem foto.
 *
 * Nome primeiro, e-mail como socorro: cadastro recém-criado pelo admin pode
 * chegar sem nome, e "?" no lugar de "F" de fulano@ é pior do que a inicial do
 * endereço. `trim` antes do primeiro caractere porque nome colado de planilha
 * vem com espaço na frente mais vezes do que se imagina — e " " maiúsculo
 * continua sendo " ".
 *
 * O desdobramento em `[...base]` (e não `base[0]`) é para nome que começa com
 * caractere fora do plano básico: `[0]` devolveria meia letra.
 */
export function inicialDe(
  nome?: string | null,
  email?: string | null,
): string {
  const base = (nome ?? "").trim() || (email ?? "").trim();
  const primeira = [...base][0] ?? "";
  return primeira ? primeira.toUpperCase() : "?";
}

export type Avatar =
  | { tipo: "foto"; src: string }
  | { tipo: "inicial"; letra: string; cor: string };

/** O recorte de `UserProfile` que o avatar enxerga. Tudo opcional de propósito:
 *  o chamador quase sempre tem um `usersMap[email]` que pode não ter ninguém. */
export type PessoaDoAvatar = {
  email?: string | null;
  name?: string | null;
  color?: string | null;
  photo?: string | null;
};

/**
 * URL externa que pode virar `src` — hoje, só a do Google.
 *
 * Reusa o portão de `links-core` em vez de repetir a lista de esquemas: é o
 * mesmo perigo (o valor vira atributo de tag) e manter duas listas de permissão
 * é garantir que uma delas fique para trás. O que se acrescenta aqui é exigir
 * `https` JÁ ESCRITO: `normalizarUrl` promove texto sem esquema a `https://`
 * por conveniência de quem cola link numa demanda, e essa conveniência viraria,
 * aqui, "qualquer palavra solta vira requisição de imagem".
 */
function urlDeFotoExterna(bruta?: string | null): string {
  const t = (bruta ?? "").trim();
  if (!/^https:\/\//i.test(t)) return "";
  const norm = normalizarUrl(t);
  return norm.startsWith("https://") ? norm : "";
}

/**
 * Qual avatar mostrar, decidido num lugar só.
 *
 * A precedência é: foto escolhida → foto do Google → inicial. A escolhida ganha
 * porque é a única que a pessoa decidiu; a do Google vem depois porque ela
 * existe sem ninguém ter pedido (vem da conta) e some quando o login é de outro
 * provedor; a inicial nunca falta.
 *
 * `photo` é CONFERIDA na leitura, e não só na escrita. Parece redundante — a
 * regra do Firestore já barra — e não é: o Admin SDK ignora as regras, um
 * documento pode ter sido gravado antes desta versão, e o que está em jogo é o
 * `src` de um `<img>` na sessão de quem apenas abriu o quadro. Conferir aqui é o
 * que faz a saída desta função ser segura por construção, e quem chama não
 * precisa saber disso.
 *
 * A cor também passa por peneira: sem ela, cada tela ficaria repetindo
 * `u?.color || "#555"` — e era assim, em seis lugares, cada um com o seu
 * fallback. Cor guardada que não é hex volta para o hash do e-mail, que é a
 * resposta estável.
 */
export function avatarDe(
  u: PessoaDoAvatar | null | undefined,
  fotoDoGoogle?: string | null,
): Avatar {
  const p = u ?? {};

  const escolhida = (p.photo ?? "").trim();
  if (escolhida && conferirFoto(escolhida).ok) {
    return { tipo: "foto", src: escolhida };
  }

  const doGoogle = urlDeFotoExterna(fotoDoGoogle);
  if (doGoogle) return { tipo: "foto", src: doGoogle };

  const guardada = (p.color ?? "").trim();
  return {
    tipo: "inicial",
    letra: inicialDe(p.name, p.email),
    cor: HEX.test(guardada) ? guardada : corDeAvatar(p.email ?? p.name ?? ""),
  };
}
