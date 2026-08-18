/**
 * A conferência da assinatura das interações do Discord.
 *
 * ISTO É O PORTÃO. Não há outro. A rota `/api/discord/interactions` é pública —
 * tem de ser, o Discord chama de fora — e o que ela faz é gravar vínculo de
 * conta. Sem esta conferência, qualquer pessoa na internet manda um POST
 * dizendo ser o Discord e liga a própria conta ao e-mail de quem quiser, com um
 * código roubado ou por força bruta.
 *
 * O Discord assina cada requisição com Ed25519 sobre `timestamp + corpo cru`.
 * A chave pública do aplicativo (`DISCORD_PUBLIC_KEY`) confere a assinatura.
 *
 * SEM DEPENDÊNCIA NOVA, de propósito. `discord-interactions` e `tweetnacl`
 * fazem exatamente isto, e o Node 24 já sabe fazer sozinho — o que falta é um
 * envelope de doze bytes. A chave vem em hex de 32 bytes crus, e
 * `createPublicKey` quer DER/SPKI; o prefixo abaixo é o cabeçalho SPKI fixo do
 * Ed25519 (OID 1.3.101.112). Instalar um pacote por causa de doze bytes
 * constantes é dívida que se paga em toda auditoria de dependência daqui para
 * frente.
 *
 * MORA SEPARADO de `discord-vinculo-core.ts` porque importa `node:crypto`, e
 * aquele módulo é lido também pelo navegador (a tela do Perfil). Módulo puro
 * que arrasta Node junto é módulo que quebra o bundle.
 *
 * Não importa nada com o alias `@/` — é o que permite o teste
 * (`scripts/test-discord-vinculo.mjs`) carregá-lo pelo strip de tipos do Node.
 */
import { createPublicKey, verify } from "node:crypto";

/** Cabeçalho DER/SPKI do Ed25519 (OID 1.3.101.112), antes dos 32 bytes da chave. */
const PREFIXO_SPKI = Buffer.from("302a300506032b6570032100", "hex");

const BYTES_CHAVE = 32;
const BYTES_ASSINATURA = 64;

/**
 * Hex → bytes, recusando o que não for hex de verdade.
 *
 * `Buffer.from(x, "hex")` para na primeira letra inválida e devolve o pedaço de
 * antes, SEM erro. Uma chave colada pela metade viraria um buffer curto, o
 * `createPublicKey` falharia, e o log diria "chave inválida" quando o problema
 * era um Ctrl+V incompleto. Pior: uma assinatura com lixo no fim passaria a ser
 * comparada por um prefixo.
 */
function hexParaBytes(hex: string, bytesEsperados: number): Buffer | null {
  const t = (hex ?? "").trim();
  if (t.length !== bytesEsperados * 2 || !/^[0-9a-fA-F]+$/.test(t)) return null;
  return Buffer.from(t, "hex");
}

/**
 * Confere a assinatura. Devolve `false` para qualquer coisa fora do lugar —
 * nunca lança.
 *
 * O `false` é a resposta certa para todos os casos: chave mal configurada,
 * assinatura ausente, hex quebrado, corpo adulterado. Quem chama responde 401,
 * e 401 é o que o Discord espera — é assim que ele valida a URL no momento em
 * que ela é salva no portal. Uma rota que responde 200 para assinatura inválida
 * é ACEITA pelo Discord na hora do cadastro, e é aí que o defeito passa
 * despercebido: tudo parece configurado.
 */
export function assinaturaConfere(args: {
  chavePublicaHex: string | undefined;
  assinaturaHex: string | null;
  timestamp: string | null;
  corpoCru: string;
}): boolean {
  const { chavePublicaHex, assinaturaHex, timestamp, corpoCru } = args;
  if (!chavePublicaHex || !assinaturaHex || !timestamp) return false;

  const chave = hexParaBytes(chavePublicaHex, BYTES_CHAVE);
  const assinatura = hexParaBytes(assinaturaHex, BYTES_ASSINATURA);
  if (!chave || !assinatura) return false;

  try {
    const publica = createPublicKey({
      key: Buffer.concat([PREFIXO_SPKI, chave]),
      format: "der",
      type: "spki",
    });
    // O corpo tem de ser o CRU, byte a byte. Um `JSON.parse` seguido de
    // `JSON.stringify` reordena chaves e reformata números, e a assinatura
    // deixa de bater por um espaço.
    return verify(
      null,
      Buffer.from(timestamp + corpoCru, "utf8"),
      publica,
      assinatura,
    );
  } catch {
    return false;
  }
}
