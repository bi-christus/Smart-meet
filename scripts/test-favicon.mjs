/**
 * Testes do ícone do site.
 *
 * O que dói errar aqui não aparece na tela: `ehEnderecoPrivado` deixando
 * passar um endereço da rede interna transforma a rota de favicon numa ponte
 * para dentro de onde o servidor roda (SSRF). E a ordem dos candidatos errada
 * só faz o logo sair borrado — mas sai borrado em todo card.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { candidatosDeIcone, ehEnderecoPrivado, lerDataUri } from "../src/lib/favicon-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(`${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`);
}

console.log("— a rede interna fica de fora —");
for (const ip of [
  "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10",
  "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::",
  "fd00::1", "fe80::1", "::ffff:10.0.0.1", "[::1]", "999.1.1.1", "nao-e-ip",
]) {
  checa(`${ip} é recusado`, ehEnderecoPrivado(ip));
}
for (const ip of ["8.8.8.8", "142.250.79.46", "172.32.0.1", "2606:4700::1111"]) {
  checa(`${ip} é público`, !ehEnderecoPrivado(ip));
}

console.log("\n— onde procurar o ícone —");
const html = `
  <head>
    <link rel="stylesheet" href="/estilo.css">
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link rel='icon' href='/favicon-32.png' sizes='32x32'>
    <link rel="apple-touch-icon" href="/apple.png">
    <link rel=icon href=/x.svg type="image/svg+xml">
    <link rel="icon" href="data:image/png;base64,AAAA">
    <link rel="icon" href="https://cdn.exemplo.com/i.png" sizes="64x64">
  </head>`;
const c = candidatosDeIcone(html, "https://app.exemplo.com/painel/x");
const urls = c.map((x) => x.url);
checa("SVG vem primeiro (escala sem perder)", urls[0] === "https://app.exemplo.com/x.svg", urls.join(" | "));
checa("depois o apple-touch-icon (180)", urls[1] === "https://app.exemplo.com/apple.png");
checa("depois pelo maior tamanho", urls[2] === "https://cdn.exemplo.com/i.png" && urls[3].endsWith("favicon-32.png"));
checa("o 16×16 é o último dos declarados", urls[4].endsWith("favicon-16.png"));
checa("/favicon.ico entra como reserva, no fim", urls.at(-1) === "https://app.exemplo.com/favicon.ico");
checa("stylesheet não entra", !urls.some((u) => u.includes("estilo")));
checa("ícone embutido (data:image) entra", urls.includes("data:image/png;base64,AAAA"));
checa(
  "data: que não é imagem não entra",
  !candidatosDeIcone('<link rel="icon" href="data:text/html,<script>x</script>">', "https://a.com/").some((x) => x.url.startsWith("data:")),
);
{
  // O caso real do Ocupa: SVG embutido, percent-encoded.
  const ocupa = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect fill='%23416180'/%3E%3C/svg%3E">`;
  const [primeiro] = candidatosDeIcone(ocupa, "https://ocupa.app/");
  checa("SVG embutido vem primeiro", primeiro.url.startsWith("data:image/svg+xml"));
  const lido = lerDataUri(primeiro.url, 512 * 1024);
  checa(
    "SVG embutido é decodificado sem rede",
    lido?.tipo === "image/svg+xml" && new TextDecoder().decode(lido.bytes).startsWith("<svg"),
  );
  const b64 = lerDataUri("data:image/png;base64,iVBORw0KGgo=", 1024);
  checa("base64 é decodificado", b64?.tipo === "image/png" && b64.bytes[0] === 0x89);
  checa("acima do teto é recusado", lerDataUri("data:image/png;base64,iVBORw0KGgo=", 3) === null);
  checa("data:text é recusado", lerDataUri("data:text/html,oi", 1024) === null);
}
checa("caminho relativo resolve contra a página", urls.includes("https://app.exemplo.com/favicon-16.png"));
checa(
  "página sem nenhum <link> ainda tenta /favicon.ico",
  candidatosDeIcone("<html></html>", "https://a.com/b").map((x) => x.url).join() === "https://a.com/favicon.ico",
);
checa(
  "javascript: no href não vira candidato",
  !candidatosDeIcone('<link rel="icon" href="javascript:alert(1)">', "https://a.com/").some((x) => x.url.startsWith("javascript")),
);

console.log("\n— o core é puro —");
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonte = readFileSync(join(raiz, "src/lib/favicon-core.ts"), "utf8");
checa("nada de firebase nem rede dentro do core", !/from\s+["'](firebase|node:)/.test(fonte) && !/\bfetch\(/.test(fonte));

console.log(falhas === 0 ? "\nfavicon: ok" : `\nfavicon: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
