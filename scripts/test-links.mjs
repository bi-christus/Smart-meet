/**
 * Testes dos links da demanda.
 *
 * Errar aqui é caro em três moedas diferentes, e nenhuma delas aparece como
 * erro na tela:
 *
 *  - SEGURANÇA. O que `normalizarUrl` aprova vai direto para um `href`. Um
 *    `javascript:` que passe vira execução de script com a sessão de quem
 *    clicou — dentro de um app onde a pessoa está logada com a conta da Rede.
 *    Não trava, não loga, não avisa: só funciona, para quem plantou.
 *
 *  - CONFIANÇA NA LISTA. `jaTem` que não reconhece o repetido colado sem
 *    esquema deixa a mesma planilha aparecer duas vezes, e uma lista com
 *    duplicata é uma lista que ninguém mais lê inteira.
 *
 *  - LEITURA. Cor e monograma são o que faz reconhecer o link antes de ler. Cor
 *    instável (mesma URL, cor diferente a cada render) e monograma "HT" em todo
 *    lugar não quebram nada — só apagam a única pista que a lista tinha.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  corDoLink,
  dominioDe,
  jaTem,
  monogramaDe,
  normalizarUrl,
  novoIdLink,
  rotuloDoLink,
  servicoDe,
  SERVICO_ROTULO,
  seloDoLink,
} from "../src/lib/links-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- o portão: só http e https saem daqui ---------------------------------
checa(
  "javascript: é recusado (é o ataque, não um caso de borda)",
  normalizarUrl("javascript:alert(document.cookie)") === "",
  normalizarUrl("javascript:alert(document.cookie)"),
);
checa(
  "javascript: com maiúscula e espaço em volta também",
  normalizarUrl("  JaVaScRiPt:alert(1)  ") === "",
);
checa(
  "data: é recusado",
  normalizarUrl("data:text/html;base64,PHNjcmlwdD4=") === "",
);
checa("vbscript: é recusado", normalizarUrl("vbscript:msgbox(1)") === "");
checa("file: é recusado", normalizarUrl("file:///C:/senhas.txt") === "");
checa("mailto: é recusado", normalizarUrl("mailto:ia02@px.com.br") === "");

// --- o portão não pode recusar link legítimo ------------------------------
checa(
  "https passa inteiro",
  normalizarUrl("https://bi.christus.com/painel") ===
    "https://bi.christus.com/painel",
  normalizarUrl("https://bi.christus.com/painel"),
);
checa(
  "http passa (quem só serve http redireciona)",
  normalizarUrl("http://intranet.christus.com/x") ===
    "http://intranet.christus.com/x",
);
checa(
  "sem esquema vira https",
  normalizarUrl("drive.google.com/file/d/abc") ===
    "https://drive.google.com/file/d/abc",
  normalizarUrl("drive.google.com/file/d/abc"),
);
checa("espaço em volta é aparado", normalizarUrl("   x.com/a   ") !== "");
checa("string vazia devolve vazio", normalizarUrl("   ") === "");
checa(
  "query e fragmento são preservados",
  normalizarUrl("https://x.com/p?a=1&b=2#topo") === "https://x.com/p?a=1&b=2#topo",
  normalizarUrl("https://x.com/p?a=1&b=2#topo"),
);
checa(
  "host com porta não é confundido com esquema",
  normalizarUrl("bi.christus.com:8080/painel") ===
    "https://bi.christus.com:8080/painel",
  normalizarUrl("bi.christus.com:8080/painel"),
);

// --- texto que não é URL ---------------------------------------------------
checa(
  "frase solta não vira link",
  normalizarUrl("reunião de terça com o financeiro") === "",
);
checa("palavra solta não vira link", normalizarUrl("rascunho") === "");
checa(
  "nome de arquivo solto não vira link",
  normalizarUrl("relatorio final") === "",
);

// --- domínio: o que a tela mostra quando não há título ---------------------
checa(
  "www. cai fora",
  dominioDe("https://www.youtube.com/watch?v=abc") === "youtube.com",
  dominioDe("https://www.youtube.com/watch?v=abc"),
);
checa(
  "porta cai fora",
  dominioDe("https://bi.christus.com:8080/painel") === "bi.christus.com",
  dominioDe("https://bi.christus.com:8080/painel"),
);
checa(
  "subdomínio fica (é ele que diz de onde é)",
  dominioDe("https://docs.google.com/document/d/1") === "docs.google.com",
);
checa(
  "MAIÚSCULA vira minúscula",
  dominioDe("HTTPS://WWW.GitHub.COM/bi-christus") === "github.com",
  dominioDe("HTTPS://WWW.GitHub.COM/bi-christus"),
);
checa("url inválida não tem domínio", dominioDe("javascript:alert(1)") === "");

// --- serviço: cada ramo -----------------------------------------------------
const casos = [
  ["https://drive.google.com/drive/folders/1a2b", "drive"],
  ["https://docs.google.com/document/d/1a2b/edit", "docs"],
  ["https://docs.google.com/spreadsheets/d/1a2b/edit#gid=0", "sheets"],
  ["https://docs.google.com/presentation/d/1a2b/edit", "slides"],
  ["https://docs.google.com/forms/d/e/1a2b/viewform", "forms"],
  ["https://forms.gle/abc123", "forms"],
  ["https://lookerstudio.google.com/reporting/abc", "looker"],
  ["https://datastudio.google.com/reporting/abc", "looker"],
  ["https://app.powerbi.com/groups/me/reports/abc", "powerbi"],
  ["https://www.youtube.com/watch?v=abc", "youtube"],
  ["https://youtu.be/abc", "youtube"],
  ["https://meet.google.com/abc-defg-hij", "meet"],
  ["https://calendar.google.com/calendar/u/0/r", "calendar"],
  ["https://github.com/bi-christus/Smart-meet", "github"],
  ["https://www.figma.com/file/abc/mockup", "figma"],
  ["https://www.notion.so/abc", "notion"],
  ["https://christus.notion.site/abc", "notion"],
  ["https://trello.com/b/abc", "trello"],
  ["https://wa.me/5585999999999", "whatsapp"],
  ["https://web.whatsapp.com/send?phone=55", "whatsapp"],
  ["https://christus.com/manuais/regimento.pdf", "pdf"],
  ["https://christus.com/dados/consumo.xlsx", "planilha"],
  ["https://christus.com/dados/consumo.xls", "planilha"],
  ["https://christus.com/dados/consumo.csv", "planilha"],
  ["https://bi.christus.com/painel", "generico"],
  ["nao é url nenhuma", "generico"],
];
casos.forEach(([url, esperado]) => {
  checa(
    `serviço: ${url.slice(0, 52)} → ${esperado}`,
    servicoDe(url) === esperado,
    servicoDe(url),
  );
});
checa(
  "o host manda na extensão: PDF no Drive continua sendo Drive",
  servicoDe("https://drive.google.com/file/d/abc/manual.pdf") === "drive",
  servicoDe("https://drive.google.com/file/d/abc/manual.pdf"),
);
checa(
  "todo serviço chega à tela com rótulo em português",
  Object.values(SERVICO_ROTULO).every((v) => typeof v === "string" && v.length),
);

// --- cor: a mesma entrada, sempre a mesma saída ----------------------------
const alvo = "https://bi.christus.com/painel";
checa(
  "cor do genérico é estável entre duas chamadas",
  corDoLink(alvo) === corDoLink(alvo),
  `${corDoLink(alvo)} vs ${corDoLink(alvo)}`,
);
checa(
  "cor é a mesma com e sem esquema (é o mesmo domínio)",
  corDoLink("bi.christus.com/painel") === corDoLink(alvo),
);
checa(
  "cor do genérico não depende do caminho, só do domínio",
  corDoLink("https://bi.christus.com/outra/pagina") === corDoLink(alvo),
);
checa("cor é hex", /^#[0-9a-f]{6}$/i.test(corDoLink(alvo)), corDoLink(alvo));
checa(
  "marca conhecida usa a cor da marca, não o hash",
  corDoLink("https://www.youtube.com/watch?v=abc") ===
    corDoLink("https://youtu.be/outro"),
);

// --- monograma: nunca HT, nunca WW ----------------------------------------
checa(
  "monograma vem do rótulo do domínio",
  monogramaDe("https://bi.christus.com") === "BI",
  monogramaDe("https://bi.christus.com"),
);
checa(
  "nunca HT (o esquema não conta)",
  monogramaDe("https://christus.com") === "CH",
  monogramaDe("https://christus.com"),
);
checa(
  "nunca WW (o www. não conta)",
  monogramaDe("https://www.google.com") === "GO",
  monogramaDe("https://www.google.com"),
);
checa(
  "no máximo duas letras, sempre maiúsculas",
  /^[A-Z0-9?]{1,2}$/.test(monogramaDe("https://drive.google.com/x")),
  monogramaDe("https://drive.google.com/x"),
);

// --- rótulo: título, senão domínio, senão a url crua ----------------------
const base = { id: "x", addedBy: "ia02@px.com.br", addedAt: 0 };
checa(
  "título vence, aparado",
  rotuloDoLink({ ...base, url: "https://x.com", title: "  Painel de consumo " }) ===
    "Painel de consumo",
);
checa(
  "sem título, o domínio",
  rotuloDoLink({ ...base, url: "https://docs.google.com/document/d/1" }) ===
    "docs.google.com",
);
checa(
  "título só de espaços conta como ausente",
  rotuloDoLink({ ...base, url: "https://x.com/a", title: "   " }) === "x.com",
);

// --- duplicata: o caso real é colar de novo sem o https:// ----------------
const lista = [
  { ...base, id: "a", url: "https://docs.google.com/spreadsheets/d/1a2b/edit" },
];
checa(
  "acha o repetido colado sem esquema",
  jaTem(lista, "docs.google.com/spreadsheets/d/1a2b/edit"),
);
checa(
  "acha o repetido com a barra final que o navegador acrescenta",
  jaTem([{ ...base, id: "a", url: "https://x.com/" }], "x.com"),
);
checa("link novo não é confundido com o que já está", !jaTem(lista, "https://x.com"));
checa("url inválida nunca 'já está' na lista", !jaTem(lista, "javascript:alert(1)"));
checa(
  "url inválida não casa com outra url inválida",
  !jaTem([{ ...base, id: "a", url: "javascript:alert(1)" }], "data:text/html,x"),
);

// --- id: determinístico, e diferente para links diferentes ----------------
const t = 1_755_000_000_000;
checa(
  "mesmo par url+instante, mesmo id (o render não pode mudá-lo)",
  novoIdLink("https://x.com/a", t) === novoIdLink("https://x.com/a", t),
  novoIdLink("https://x.com/a", t),
);
checa(
  "urls diferentes, ids diferentes",
  novoIdLink("https://x.com/a", t) !== novoIdLink("https://x.com/b", t),
);
checa(
  "instantes diferentes, ids diferentes",
  novoIdLink("https://x.com/a", t) !== novoIdLink("https://x.com/a", t + 1),
);
checa(
  "a mesma url escrita de dois jeitos dá o mesmo id",
  novoIdLink("x.com/a", t) === novoIdLink("https://x.com/a", t),
);
checa(
  "id é curto e sem caractere que atrapalhe chave de lista",
  /^[0-9a-z]{2,16}$/.test(novoIdLink("https://x.com/a", t)),
  novoIdLink("https://x.com/a", t),
);

// --- a tinta do selo -------------------------------------------------------
// Este é o teste que impede a regressão silenciosa: o selo continua "bonito"
// com texto branco sobre amarelo, e simplesmente não se lê. Aqui a régua é
// numérica, e é a mesma da WCAG.

/** Contraste WCAG entre dois hex, para o teste conferir por fora. */
function contrasteEntre(a, b) {
  const lum = (hex) => {
    const h = hex.replace("#", "");
    const canal = (i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  };
  const [x, y] = [lum(a), lum(b)];
  const [claro, escuro] = x > y ? [x, y] : [y, x];
  return (claro + 0.05) / (escuro + 0.05);
}

// 4.5:1 é o mínimo da WCAG AA para texto deste tamanho — o monograma tem 14px,
// e 14px em negrito ainda NÃO conta como "texto grande" (que começa em 18.66px
// em negrito). Por isso a régua é a cheia, e não a folgada de 3:1.
const AMOSTRAS = [
  ["https://drive.google.com/x", "o amarelo do Drive"],
  ["https://app.powerbi.com/x", "o amarelo do Power BI"],
  ["https://notion.so/x", "o cinza claro do Notion"],
  ["https://youtube.com/x", "o vermelho do YouTube"],
  ["https://docs.google.com/document/x", "o azul do Docs"],
  ["https://bi.christus.com", "um domínio sem marca"],
  ["https://sistema.rede.local/x", "outro domínio sem marca"],
];
AMOSTRAS.forEach(([url, quem]) => {
  const { fundo, tinta } = seloDoLink(url);
  const r = contrasteEntre(fundo, tinta);
  checa(`o selo se lê sobre ${quem}`, r >= 4.5, `${r.toFixed(2)}:1`);
});

checa(
  "sobre fundo claro a tinta escurece",
  seloDoLink("https://drive.google.com/x").tinta === "#1a1a17",
);
checa(
  "sobre fundo escuro a tinta clareia",
  seloDoLink("https://docs.google.com/forms/x").tinta === "#ffffff",
);
checa(
  "o selo é estável: mesma url, mesmo par",
  JSON.stringify(seloDoLink("https://x.com/a")) ===
    JSON.stringify(seloDoLink("https://x.com/a")),
);
// O YouTube é o caso que motivou o segundo passo: nenhuma das duas tintas
// alcançava 4,5:1 sobre o vermelho cheio. O fundo tem de ter mudado.
checa(
  "a cor que nenhuma tinta salvava foi escurecida",
  seloDoLink("https://youtube.com/x").fundo !== corDoLink("https://youtube.com/x"),
  `${corDoLink("https://youtube.com/x")} → ${seloDoLink("https://youtube.com/x").fundo}`,
);
// E o que já passava não pode ser mexido: escurecer à toa apagaria a marca.
checa(
  "a cor que já se lia fica intacta",
  seloDoLink("https://drive.google.com/x").fundo ===
    corDoLink("https://drive.google.com/x"),
);
// Toda a paleta, e não só as amostras: uma cor acrescentada amanhã em `CORES`
// entra por aqui sem ninguém lembrar de escrever o teste dela.
const TODOS_OS_SERVICOS = [
  "https://drive.google.com/x",
  "https://docs.google.com/document/x",
  "https://docs.google.com/spreadsheets/x",
  "https://docs.google.com/presentation/x",
  "https://docs.google.com/forms/x",
  "https://lookerstudio.google.com/x",
  "https://app.powerbi.com/x",
  "https://youtube.com/x",
  "https://meet.google.com/x",
  "https://calendar.google.com/x",
  "https://github.com/x",
  "https://figma.com/x",
  "https://notion.so/x",
  "https://trello.com/x",
  "https://wa.me/x",
  "https://exemplo.com/a.pdf",
  "https://exemplo.com/a.xlsx",
];
const reprovados = TODOS_OS_SERVICOS.filter((u) => {
  const { fundo, tinta } = seloDoLink(u);
  return contrasteEntre(fundo, tinta) < 4.5;
});
checa(
  "todo serviço da paleta tem selo legível",
  reprovados.length === 0,
  reprovados.join(", ") || `${TODOS_OS_SERVICOS.length} conferidos`,
);

console.log(
  falhas === 0
    ? "\nTodos os testes de links passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
