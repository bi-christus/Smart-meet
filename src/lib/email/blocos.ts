/**
 * Peças de HTML de e-mail. Cada função recebe TEXTO e devolve HTML, escapando
 * por dentro — assim nenhum chamador precisa lembrar de escapar, que é como
 * conteúdo de usuário acaba injetado num e-mail institucional.
 *
 * ISOMÓRFICO: nada de Node. Ver o comentário de `tema.ts`.
 *
 * As decisões que parecem estranhas e não são:
 *
 * - **Estilo inline é a base; `<style>` é aditivo.** O Gmail aplica `<style>`
 *   desde 2016, mas o Outlook desktop ignora e conta importada "gmailificada"
 *   descarta. Se o inline não bastar sozinho, o e-mail quebra para uma parte
 *   dos destinatários — e ninguém reporta, só deixa de ler.
 * - **Ghost table condicional** em volta do envelope: o motor do Word não
 *   entende `max-width`, e sem ela o conteúdo ocupa a janela inteira no
 *   Outlook desktop.
 * - **Nada de `border-radius`, `letter-spacing` grande nem `text-transform`**
 *   como estrutura: o Outlook ignora os dois primeiros e o terceiro some,
 *   então o texto precisa já vir na caixa final.
 * - **Sem fundo colorido nos blocos de número.** O modo escuro do Gmail
 *   Android reescreve `color` e `background` de forma parcial, produzindo
 *   texto escuro sobre fundo escuro em um bloco e claro sobre claro em outro.
 *   Sem fundo, não há o que inverter errado.
 */
import {
  esc,
  numBr,
  type Acento,
  type Tema,
} from "./tema";

export type Ctx = { tema: Tema; acento: Acento; densidade: "confortavel" | "compacto" };

/** Espaçamento vertical das células, conforme a densidade. */
function padCel(c: Ctx): string {
  return c.densidade === "compacto" ? "6px 9px" : "9px 11px";
}
function fs(c: Ctx, base: number): number {
  return c.densidade === "compacto" ? base - 0.5 : base;
}

// ---------------------------------------------------------------------------

/** Documento completo: doctype, media queries, preheader e envelope. */
export function documento(
  c: Ctx,
  preheader: string,
  corpo: string,
  largura = 820,
): string {
  const t = c.tema;
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<style>
@media screen and (max-width:480px){
  .env{width:100%!important}
  .pad{padding-left:16px!important;padding-right:16px!important}
  .cab{display:none!important}
  .lin{display:block!important;border-bottom:1px solid ${t.linha}!important}
  .cel{display:block!important;width:100%!important;border:0!important;padding:1px 12px!important}
  .cel1{padding-top:11px!important}
  .celz{padding-bottom:11px!important}
  .rot{display:inline!important}
  .kpi{display:block!important;width:100%!important;padding:9px 0!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${t.fundo};">
<div style="display:none;mso-hide:all;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;color:${t.fundo};">
  ${esc(preheader)}${"&#8203;".repeat(8)}
</div>
<div style="background:${t.fundo};padding:24px 12px;-webkit-text-size-adjust:100%;">
<!--[if mso]><table role="presentation" width="${largura}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="env" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${largura}px;margin:0 auto;background:${t.papel};border:1px solid ${t.linha};">
${corpo}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</div>
</body></html>`;
}

/** Eyebrow, título, linha de contexto e o filete na cor do acento. */
export function cabecalho(
  c: Ctx,
  args: { eyebrow: string; titulo: string; contexto: string },
): string {
  const t = c.tema;
  return `  <tr><td class="pad" style="padding:26px 30px 0;">
    <p style="margin:0 0 7px;font-family:${t.fonte};font-size:11px;letter-spacing:1.5px;color:${t.suave};">${esc(args.eyebrow)}</p>
    <h1 style="margin:0 0 6px;font-family:${t.fonteTitulo};font-size:23px;font-weight:600;line-height:1.25;color:${t.forte};">${esc(args.titulo)}</h1>
    <p style="margin:0;font-family:${t.fonte};font-size:12.5px;line-height:1.5;color:${t.suave};">${esc(args.contexto)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
      <td width="56" height="3" bgcolor="${c.acento.cor}" style="width:56px;height:3px;font-size:1px;line-height:3px;">&nbsp;</td>
    </tr></table>
  </td></tr>`;
}

/** Recado de quem enviou, citado. */
export function citacao(c: Ctx, texto: string): string {
  const t = c.tema;
  return `  <tr><td class="pad" style="padding:18px 30px 0;">
    <p style="margin:0;padding:12px 15px;background:${t.faixa};border-left:3px solid ${c.acento.cor};font-family:${t.fonte};font-size:14px;line-height:1.55;color:${t.texto};white-space:pre-wrap;">${esc(texto)}</p>
  </td></tr>`;
}

/**
 * Números grandes entre dois fios. Sem caixas de propósito — ver o comentário
 * do topo sobre modo escuro.
 */
export function kpis(
  c: Ctx,
  itens: { valor: string; rotulo: string; cor?: string }[],
): string {
  const t = c.tema;
  const larg = Math.floor(100 / Math.max(1, itens.length));
  const cels = itens
    .map(
      (i) => `        <td class="kpi" width="${larg}%" style="padding:15px 12px 15px 0;vertical-align:top;">
          <div style="font-family:${t.fonteTitulo};font-size:27px;line-height:1;color:${i.cor ?? t.forte};">${esc(i.valor)}</div>
          <div style="margin-top:5px;font-family:${t.fonte};font-size:10.5px;letter-spacing:.7px;color:${t.suave};">${esc(i.rotulo)}</div>
        </td>`,
    )
    .join("\n");
  return `  <tr><td class="pad" style="padding:20px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${t.linha};border-bottom:1px solid ${t.linha};">
      <tr>
${cels}
      </tr>
    </table>
  </td></tr>`;
}

/** Título de seção. */
export function h2Secao(c: Ctx, texto: string): string {
  const t = c.tema;
  return `  <tr><td class="pad" style="padding:26px 30px 0;">
    <h2 style="margin:0;font-family:${t.fonteTitulo};font-size:17px;font-weight:600;color:${t.forte};">${esc(texto)}</h2>
  </td></tr>`;
}

/**
 * A linha sob o título que declara o recorte e a ordenação.
 *
 * É o que separa "bonito" de "organizado": sem ela, o gestor não sabe se a
 * tabela tem tudo ou uma amostra, nem por que a ordem é essa. A contagem total
 * vai AQUI, antes da tabela — a linha de corte cinza no fim ninguém lê.
 */
export function subtitulo(c: Ctx, texto: string): string {
  const t = c.tema;
  return `  <tr><td class="pad" style="padding:5px 30px 0;">
    <p style="margin:0;font-family:${t.fonte};font-size:12px;line-height:1.5;color:${t.suave};">${esc(texto)}</p>
  </td></tr>`;
}

export function paragrafo(c: Ctx, texto: string): string {
  const t = c.tema;
  return `  <tr><td class="pad" style="padding:10px 30px 0;">
    <p style="margin:0;font-family:${t.fonte};font-size:13.5px;line-height:1.6;color:${t.texto};">${esc(texto)}</p>
  </td></tr>`;
}

export type Celula = { texto: string; cor?: string; forte?: boolean; largura?: string };

/**
 * Tabela de dados. Em telas estreitas cada linha vira um bloco empilhado com
 * o rótulo da coluna à frente do valor — daí o `data-rot` virar `.rot`.
 */
export function tabelaDados(
  c: Ctx,
  cabecalhos: string[],
  linhas: Celula[][],
  zebra = true,
): string {
  const t = c.tema;
  const th = cabecalhos
    .map(
      (h) => `<th align="left" style="padding:${padCel(c)};border-bottom:2px solid ${t.linha};font-family:${t.fonte};font-size:11px;letter-spacing:.5px;color:${t.suave};font-weight:600;">${esc(h)}</th>`,
    )
    .join("");

  const tr = linhas
    .map((linha, i) => {
      const fundo = zebra && i % 2 === 1 ? `background:${t.zebra};` : "";
      const tds = linha
        .map((cel, j) => {
          const classe = `cel${j === 0 ? " cel1" : ""}${j === linha.length - 1 ? " celz" : ""}`;
          const rot =
            cabecalhos[j] && j > 0
              ? `<span class="rot" style="display:none;font-family:${t.fonte};font-size:11px;color:${t.suave};">${esc(cabecalhos[j])}: </span>`
              : "";
          return `<td class="${classe}" style="padding:${padCel(c)};border-bottom:1px solid ${t.linhaClara};font-family:${t.fonte};font-size:${fs(c, 13)}px;line-height:1.5;vertical-align:top;color:${cel.cor ?? t.texto};${cel.forte ? "font-weight:600;" : ""}">${rot}${esc(cel.texto)}</td>`;
        })
        .join("");
      return `      <tr class="lin" style="${fundo}">${tds}</tr>`;
    })
    .join("\n");

  return `  <tr><td class="pad" style="padding:12px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      <tr class="cab">${th}</tr>
${tr}
    </table>
  </td></tr>`;
}

/** Pílula de estado, em texto já na caixa final (o Outlook come text-transform). */
export function pilula(texto: string, cor: string, fundo: string): string {
  return `<span style="display:inline-block;padding:2px 7px;background:${fundo};color:${cor};font-size:11px;font-weight:600;">${esc(texto)}</span>`;
}

/**
 * Barra proporcional feita de tabela, não de div com width em %.
 * O Outlook não renderiza `width` percentual em `div` dentro de `td`.
 */
export function barra(c: Ctx, valor: number, total: number, cor: string): string {
  const p = total > 0 ? Math.max(2, Math.round((valor / total) * 100)) : 0;
  const t = c.tema;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:150px;"><tr>
    <td width="${p}%" height="7" bgcolor="${cor}" style="height:7px;font-size:1px;line-height:7px;">&nbsp;</td>
    <td width="${100 - p}%" height="7" bgcolor="${t.linhaClara}" style="height:7px;font-size:1px;line-height:7px;">&nbsp;</td>
  </tr></table>`;
}

/** Linha discreta ao fim de uma tabela cortada. */
export function linhaCorte(c: Ctx, texto: string): string {
  const t = c.tema;
  return `  <tr><td class="pad" style="padding:8px 30px 0;">
    <p style="margin:0;font-family:${t.fonte};font-size:11.5px;color:${t.suave};">${esc(texto)}</p>
  </td></tr>`;
}

export function rodape(c: Ctx, linhas: string[]): string {
  const t = c.tema;
  const p = linhas
    .map(
      (l) => `      <p style="margin:0 0 5px;font-family:${t.fonte};font-size:11px;line-height:1.5;color:${t.suave};">${esc(l)}</p>`,
    )
    .join("\n");
  return `  <tr><td class="pad" style="padding:26px 30px 26px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-top:1px solid ${t.linhaClara};padding-top:13px;">
${p}
      </td>
    </tr></table>
  </td></tr>`;
}

/** Espaço vertical entre seções, em tabela (margin some no Outlook). */
export function respiro(altura = 6): string {
  return `  <tr><td height="${altura}" style="height:${altura}px;font-size:1px;line-height:${altura}px;">&nbsp;</td></tr>`;
}

export { numBr };
