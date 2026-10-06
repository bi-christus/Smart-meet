/**
 * O ícone do site — onde procurar, e onde NÃO deixar o servidor ir.
 *
 * Módulo puro (AGENTS.md §4): sem rede e sem SDK. Quem busca é
 * `api/links/favicon`; aqui moram as duas decisões que dá para testar em Node
 * puro (`scripts/test-favicon.mjs`).
 *
 * POR QUE NO SERVIDOR, e não um `<img src="https://site/favicon.ico">`. O
 * navegador desenharia, mas não deixa o canvas LER a imagem de outro site
 * (CORS) — e sem ler não dá para reduzir e gravar o logo no documento. Também
 * não se usa o serviço de favicons do Google: ele entregaria ao Google a lista
 * de domínios internos da rede (o mesmo motivo escrito em `links/page.tsx`).
 *
 * O RISCO de um servidor que busca qualquer endereço é ele virar a ponte para
 * dentro da rede onde roda (SSRF). Por isso `ehEnderecoPrivado` existe, e é
 * conferido em CADA salto de redirecionamento, não só no endereço colado.
 */

/** Um ícone declarado na página, com o maior lado que ele anuncia (0 = não diz). */
export type Candidato = { url: string; lado: number; tipo: "apple" | "icone" | "padrao" };

/**
 * IPv4 ou IPv6 que não é internet pública: loopback, rede privada, link-local
 * (inclui o 169.254.169.254 dos metadados de nuvem), CGNAT, "este host",
 * multicast e reservados. Texto que nem é IP responde `true` — quem chama só
 * pergunta sobre endereços resolvidos, e na dúvida o servidor não vai.
 */
export function ehEnderecoPrivado(ip: string): boolean {
  const t = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (!t.includes(":")) return true;
  // IPv4 embutido (::ffff:10.0.0.1) responde pela parte v4.
  const embutido = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(t);
  if (embutido) return ehEnderecoPrivado(embutido[1]);
  if (t === "::" || t === "::1") return true;
  const primeiro = parseInt(t.split(":")[0] || "0", 16);
  return (
    (primeiro & 0xfe00) === 0xfc00 || // fc00::/7, rede local única
    (primeiro & 0xffc0) === 0xfe80 || // fe80::/10, link-local
    (primeiro & 0xff00) === 0xff00 // multicast
  );
}

/**
 * Um `data:image/...` → o tipo e os bytes, ou `null`.
 *
 * Aceita as duas formas que aparecem em ícone embutido: base64 e texto
 * percent-encoded (o SVG do Ocupa). Teto em bytes para um HTML não mandar o
 * servidor decodificar megabytes.
 */
export function lerDataUri(
  uri: string,
  teto: number,
): { tipo: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z0-9.+-]+)((?:;[^,;]*)*?)(;base64)?,([\s\S]*)$/i.exec(uri.trim());
  if (!m) return null;
  const tipo = m[1].toLowerCase();
  try {
    let bytes: Uint8Array;
    if (m[3]) {
      const bin = atob(m[4].replace(/\s+/g, ""));
      bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[4]));
    }
    if (bytes.byteLength === 0 || bytes.byteLength > teto) return null;
    return { tipo, bytes };
  } catch {
    return null;
  }
}

/** Valor de um atributo dentro de uma tag, aspas simples, duplas ou nenhuma. */
function atributo(tag: string, nome: string): string | null {
  const m = new RegExp(`\\b${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/**
 * Os ícones que a página declara, do melhor para o pior, e `/favicon.ico` por
 * último como reserva.
 *
 * A ordem é a de quem vai virar logo de 96 px: o `apple-touch-icon` (180 px,
 * quadrado, sem transparência estranha) vem primeiro; depois os `icon` pelo
 * MAIOR tamanho anunciado — um 16×16 ampliado é o borrão que ninguém
 * reconhece. SVG conta como o maior de todos: escala sem perder nada.
 *
 * Lê HTML com expressão regular de propósito: só as tags `<link>` interessam,
 * e um parser de verdade no servidor seria dependência nova para isso.
 */
export function candidatosDeIcone(html: string, base: string): Candidato[] {
  const vistos = new Set<string>();
  const achados: Candidato[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (atributo(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const ehApple = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!ehApple && !rel.includes("icon")) continue;
    const href = (atributo(tag, "href") ?? "").trim();
    if (!href) continue;
    let url: string;
    if (/^data:/i.test(href)) {
      // Ícone EMBUTIDO no HTML (o Ocupa faz assim, com um SVG). Só imagem;
      // quem decodifica é `lerDataUri`, sem ir à rede.
      if (!/^data:image\//i.test(href)) continue;
      url = href;
    } else {
      try {
        url = new URL(href, base).toString();
      } catch {
        continue;
      }
      if (!/^https?:/i.test(url)) continue;
    }
    if (vistos.has(url)) continue;
    vistos.add(url);
    const sizes = (atributo(tag, "sizes") ?? "").toLowerCase();
    const tipoMime = (atributo(tag, "type") ?? "").toLowerCase();
    let lado = 0;
    if (
      sizes === "any" ||
      tipoMime.includes("svg") ||
      /\.svg(\?|$)/i.test(url) ||
      /^data:image\/svg/i.test(url)
    )
      lado = 1000;
    else
      for (const s of sizes.matchAll(/(\d+)x(\d+)/g)) lado = Math.max(lado, Number(s[1]));
    if (ehApple && !lado) lado = 180;
    achados.push({ url, lado, tipo: ehApple ? "apple" : "icone" });
  }
  achados.sort((a, b) => b.lado - a.lado || (a.tipo === "apple" ? -1 : b.tipo === "apple" ? 1 : 0));
  try {
    const padrao = new URL("/favicon.ico", base).toString();
    if (!vistos.has(padrao)) achados.push({ url: padrao, lado: 0, tipo: "padrao" });
  } catch {
    // base inválida: sem reserva.
  }
  return achados;
}
