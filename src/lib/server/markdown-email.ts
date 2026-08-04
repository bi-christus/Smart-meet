/**
 * Markdown → HTML de e-mail, com estilo inline em cada elemento.
 *
 * Por que um renderizador e não substituição de string no HTML pronto: a
 * primeira versão trocava `<td>` por `<td style=…>`, e o `marked` emite
 * `<td align="left">` quando a tabela do markdown declara alinhamento
 * (`| :---- |`). O padrão não casava, e as 187 células da Ata detalhada saíam
 * sem estilo nenhum — sem grade, sem espaçamento. Trabalhando nos tokens, o
 * atributo deixa de importar.
 *
 * Regras de e-mail que ditam o resultado:
 *  - **Estilo inline em tudo.** Gmail remove `<style>` e classes.
 *  - **Tabela com `border`, `cellpadding` e `cellspacing` além do CSS.** O
 *    Outlook ignora `border-collapse`; sem os atributos a grade some.
 *  - Nada de `flex`/`grid`: cliente de e-mail é HTML de 2005.
 */
import { marked, Renderer, type Tokens } from "marked";

const COR = {
  texto: "#4a4237",
  forte: "#2c251d",
  suave: "#7a6f61",
  linha: "#e6ddcf",
  linhaClara: "#ece4d7",
  fundoSuave: "#fbf7f0",
  zebra: "#faf7f1",
  marca: "#8c5a2b",
  atencao: "#8a5b1e",
  atencaoFundo: "#fdf3e0",
  ok: "#2f7d5d",
};

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "Arial,Helvetica,sans-serif";
const MONO = "Consolas,'Courier New',monospace";

const P = `font-family:${SANS};font-size:14px;line-height:1.62;color:${COR.texto};`;

/**
 * Destaques semânticos do conteúdo das atas.
 *
 * Os modelos usam ✓ para decisão, → para encaminhamento, ⚠ para pendência, e
 * `[CONFERIR ...]` para o que a IA não conseguiu confirmar. Num e-mail longo
 * esses marcadores são o que a pessoa procura ao passar o olho — colorir custa
 * nada e é o que separa "parede de texto" de "documento que se lê".
 */
function realces(html: string): string {
  return html
    .replace(
      /\[CONFERIR([^\]]*)\]/g,
      (_m, resto) =>
        `<span style="background:${COR.atencaoFundo};color:${COR.atencao};border-radius:3px;padding:1px 5px;font-size:12.5px;white-space:nowrap;">[CONFERIR${resto}]</span>`,
    )
    .replace(
      /(^|[\s>])✓/g,
      `$1<span style="color:${COR.ok};font-weight:bold;">✓</span>`,
    )
    .replace(
      /(^|[\s>])→/g,
      `$1<span style="color:${COR.marca};font-weight:bold;">→</span>`,
    )
    .replace(
      /(^|[\s>])⚠/g,
      `$1<span style="color:${COR.atencao};font-weight:bold;">⚠</span>`,
    );
}

export function criarRenderer(): Renderer {
  const r = new Renderer();
  let linhaZebra = 0;

  r.heading = function ({ tokens, depth }: Tokens.Heading) {
    const txt = this.parser.parseInline(tokens);
    if (depth === 1) {
      return `<h1 style="font-family:${SERIF};font-size:23px;font-weight:600;line-height:1.3;color:${COR.forte};margin:0 0 12px;">${txt}</h1>`;
    }
    if (depth === 2) {
      return `<h2 style="font-family:${SERIF};font-size:18px;font-weight:600;line-height:1.35;color:${COR.forte};margin:28px 0 10px;padding-top:14px;border-top:1px solid ${COR.linha};">${txt}</h2>`;
    }
    return `<h3 style="font-family:${SERIF};font-size:15.5px;font-weight:600;color:${COR.forte};margin:20px 0 7px;">${txt}</h3>`;
  };

  r.paragraph = function ({ tokens }: Tokens.Paragraph) {
    return `<p style="${P}margin:0 0 13px;">${this.parser.parseInline(tokens)}</p>`;
  };

  r.strong = function ({ tokens }: Tokens.Strong) {
    return `<strong style="color:${COR.forte};font-weight:600;">${this.parser.parseInline(tokens)}</strong>`;
  };

  r.em = function ({ tokens }: Tokens.Em) {
    return `<em style="color:${COR.texto};">${this.parser.parseInline(tokens)}</em>`;
  };

  r.list = function (token: Tokens.List) {
    const itens = token.items.map((i) => this.listitem(i)).join("");
    const tag = token.ordered ? "ol" : "ul";
    const start =
      token.ordered && token.start !== 1 ? ` start="${token.start}"` : "";
    return `<${tag}${start} style="margin:0 0 13px;padding-left:22px;">${itens}</${tag}>`;
  };

  r.listitem = function (item: Tokens.ListItem) {
    const dentro = this.parser.parse(item.tokens);
    // Item de lista com um parágrafo só vira `<p>texto</p>`, e o margin do
    // parágrafo abriria um vão dentro da bolinha. Removemos o embrulho apenas
    // nesse caso — havendo mais de um bloco (lista aninhada, por exemplo), o
    // conteúdo passa intacto.
    const umParagrafoSo =
      (dentro.match(/<p\b/g) || []).length === 1 &&
      /^<p style="[^"]*">[\s\S]*<\/p>\s*$/.test(dentro);
    const conteudo = umParagrafoSo
      ? dentro.replace(/^<p style="[^"]*">/, "").replace(/<\/p>\s*$/, "")
      : dentro;
    return `<li style="${P}margin:0 0 6px;">${conteudo}</li>`;
  };

  /**
   * O exportador do Google embrulha as listas das atas em citação. Renderizar
   * a barra vertical faria o documento inteiro parecer um trecho citado — que
   * não é. Então a citação vira um contêiner neutro.
   */
  r.blockquote = function ({ tokens }: Tokens.Blockquote) {
    return `<div style="margin:0;padding:0;">${this.parser.parse(tokens)}</div>`;
  };

  r.hr = function () {
    return `<hr style="border:none;border-top:1px solid ${COR.linhaClara};margin:22px 0;">`;
  };

  r.link = function ({ href, tokens }: Tokens.Link) {
    return `<a href="${href}" style="color:${COR.marca};text-decoration:underline;">${this.parser.parseInline(tokens)}</a>`;
  };

  r.codespan = function ({ text }: Tokens.Codespan) {
    return `<code style="font-family:${MONO};font-size:12.5px;background:${COR.fundoSuave};border:1px solid ${COR.linha};border-radius:3px;padding:1px 4px;">${text}</code>`;
  };

  r.code = function ({ text }: Tokens.Code) {
    return `<pre style="font-family:${MONO};font-size:12.5px;line-height:1.5;background:${COR.fundoSuave};border:1px solid ${COR.linha};border-radius:6px;padding:12px;margin:0 0 13px;overflow-x:auto;color:${COR.forte};">${text}</pre>`;
  };

  // --- tabela ---

  r.table = function (token: Tokens.Table) {
    linhaZebra = 0;
    const cabecalho = token.header
      .map((c, i) => this.tablecell({ ...c, header: true, align: token.align[i] }))
      .join("");
    const corpo = token.rows
      .map((linha) =>
        this.tablerow({
          text: linha
            .map((c, i) =>
              this.tablecell({ ...c, header: false, align: token.align[i] }),
            )
            .join(""),
        }),
      )
      .join("");
    // border/cellpadding/cellspacing além do CSS: o Outlook ignora
    // border-collapse, e sem os atributos a grade simplesmente não aparece.
    return (
      `<table role="presentation" border="1" cellpadding="8" cellspacing="0" ` +
      `style="border-collapse:collapse;border:1px solid ${COR.linha};width:100%;margin:0 0 16px;font-family:${SANS};font-size:13px;">` +
      `<thead><tr style="background:${COR.fundoSuave};">${cabecalho}</tr></thead>` +
      `<tbody>${corpo}</tbody></table>`
    );
  };

  r.tablerow = function ({ text }: Tokens.TableRow) {
    // Zebra: numa matriz de ação com 14 linhas, é o que impede o olho de pular
    // de linha ao atravessar a tabela.
    const fundo = linhaZebra++ % 2 === 1 ? `background:${COR.zebra};` : "";
    return `<tr style="${fundo}">${text}</tr>`;
  };

  r.tablecell = function (token: Tokens.TableCell) {
    const conteudo = this.parser.parseInline(token.tokens);
    const al = token.align || "left";
    const base =
      `border:1px solid ${COR.linha};padding:8px 10px;text-align:${al};vertical-align:top;line-height:1.55;`;
    return token.header
      ? `<th style="${base}color:${COR.forte};font-weight:600;font-size:12.5px;letter-spacing:.2px;">${conteudo}</th>`
      : `<td style="${base}color:${COR.texto};">${conteudo}</td>`;
  };

  return r;
}

/** Converte o markdown do documento no HTML que vai no corpo do e-mail. */
export async function markdownParaEmail(md: string): Promise<string> {
  const html = await marked.parse(md, {
    async: true,
    gfm: true,
    breaks: false,
    renderer: criarRenderer(),
  });
  return realces(html);
}
