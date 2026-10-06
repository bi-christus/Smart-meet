import { lookup } from "node:dns/promises";
import { HttpError, requireUser } from "@/lib/server/drive-server";
import { normalizarUrl } from "@/lib/links-core";
import { candidatosDeIcone, ehEnderecoPrivado, lerDataUri } from "@/lib/favicon-core";

export const runtime = "nodejs";

/**
 * O ícone do site de um link — a imagem crua, para o navegador reduzir e
 * gravar como logo (ver `prepararLogo`, em `links/link-modal.tsx`).
 *
 * Só quem está logado e ativo chama (`requireUser`): sem isso, esta rota seria
 * um proxy aberto de imagens na conta da Vercel do setor.
 *
 * O CUIDADO QUE ESTA ROTA EXISTE PARA TER é não virar ponte para a rede de
 * dentro (SSRF). Cada salto — a página, cada redirecionamento, cada ícone — é
 * resolvido no DNS e recusado se cair em endereço privado (`favicon-core`).
 * Redirecionamento é seguido À MÃO, até 3, para a conferência valer em todos.
 * Fica uma brecha conhecida e aceita: entre a conferência do DNS e a conexão o
 * nome pode passar a apontar para outro lugar (DNS rebinding). Fechá-la exigiria
 * conectar no IP conferido, o que o `fetch` do Node não expõe; o que se arrisca
 * é a leitura de uma IMAGEM de até 512 KB, por usuário autenticado.
 */

const TEMPO_MS = 5000;
const TETO_HTML = 512 * 1024;
const TETO_ICONE = 512 * 1024;
const SALTOS = 3;

async function conferirDestino(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new HttpError(400, "Endereço não é http nem https.");
  if (url.port && !["80", "443", ""].includes(url.port))
    throw new HttpError(400, "Este endereço usa uma porta que a busca não acessa.");
  const ends = await lookup(url.hostname, { all: true }).catch(() => []);
  if (ends.length === 0) throw new HttpError(404, "O endereço do site não foi encontrado.");
  if (ends.some((e) => ehEnderecoPrivado(e.address)))
    throw new HttpError(400, "O site está numa rede interna, que a busca não acessa.");
}

/** `fetch` com conferência em cada salto, tempo-limite e teto de bytes. */
async function buscar(
  inicial: string,
  teto: number,
): Promise<{ url: string; tipo: string; corpo: Uint8Array }> {
  let atual = new URL(inicial);
  for (let salto = 0; salto <= SALTOS; salto++) {
    await conferirDestino(atual);
    const r = await fetch(atual, {
      redirect: "manual",
      signal: AbortSignal.timeout(TEMPO_MS),
      headers: { "user-agent": "SmartMeeting-favicon/1.0", accept: "*/*" },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      atual = new URL(r.headers.get("location") as string, atual);
      continue;
    }
    if (!r.ok || !r.body) throw new HttpError(404, `O site respondeu ${r.status}.`);
    const declarado = Number(r.headers.get("content-length") || 0);
    if (declarado > teto) throw new HttpError(413, "Arquivo grande demais.");
    const partes: Uint8Array[] = [];
    let total = 0;
    const leitor = r.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > teto) {
        await leitor.cancel();
        throw new HttpError(413, "Arquivo grande demais.");
      }
      partes.push(value);
    }
    const corpo = new Uint8Array(total);
    let i = 0;
    for (const p of partes) {
      corpo.set(p, i);
      i += p.byteLength;
    }
    return { url: atual.toString(), tipo: (r.headers.get("content-type") || "").toLowerCase(), corpo };
  }
  throw new HttpError(400, "O site redireciona demais.");
}

/** Tem cara de imagem? O cabeçalho mente às vezes (ICO servido como texto). */
function pareceImagem(tipo: string, b: Uint8Array): boolean {
  if (tipo.startsWith("image/")) return true;
  const ini = Array.from(b.slice(0, 4));
  const png = ini[0] === 0x89 && ini[1] === 0x50;
  const ico = ini[0] === 0 && ini[1] === 0 && ini[2] === 1 && ini[3] === 0;
  const jpg = ini[0] === 0xff && ini[1] === 0xd8;
  const gif = ini[0] === 0x47 && ini[1] === 0x49;
  return png || ico || jpg || gif;
}

export async function GET(req: Request) {
  try {
    await requireUser(req);
    const bruto = new URL(req.url).searchParams.get("url") || "";
    const alvo = normalizarUrl(bruto);
    if (!alvo) throw new HttpError(400, "Endereço inválido.");
    // O endereço do link é conferido FORA do try da página: rede interna é
    // recusa que a pessoa precisa ler como tal, e não como "sem ícone".
    await conferirDestino(new URL(alvo));

    // A página pode falhar (login, bloqueio) e o /favicon.ico ainda existir:
    // sem HTML, os candidatos são só a reserva.
    let html = "";
    let base = alvo;
    try {
      const pagina = await buscar(alvo, TETO_HTML);
      base = pagina.url;
      if (pagina.tipo.includes("html")) html = new TextDecoder().decode(pagina.corpo);
    } catch {
      // segue para a reserva
    }

    for (const c of candidatosDeIcone(html, base).slice(0, 6)) {
      try {
        // Ícone embutido no HTML: decodifica aqui, sem rede.
        const embutido = c.url.startsWith("data:") ? lerDataUri(c.url, TETO_ICONE) : null;
        if (c.url.startsWith("data:") && !embutido) continue;
        const icone = embutido
          ? { tipo: embutido.tipo, corpo: embutido.bytes }
          : await buscar(c.url, TETO_ICONE);
        if (!pareceImagem(icone.tipo, icone.corpo)) continue;
        const tipo = icone.tipo.startsWith("image/") ? icone.tipo.split(";")[0] : "image/x-icon";
        return new Response(new Blob([icone.corpo.slice()]), {
          headers: {
            "content-type": tipo,
            "cache-control": "private, max-age=3600",
            "x-content-type-options": "nosniff",
            // SVG servido daqui não pode rodar script na origem do app, nem
            // se alguém abrir esta rota direto na aba.
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      } catch {
        // próximo candidato
      }
    }
    throw new HttpError(404, "Este site não tem um ícone que dê para usar.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Erro desconhecido.";
    return Response.json({ ok: false, error: message }, { status });
  }
}
