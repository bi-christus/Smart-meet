import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  inicio: (
    <>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  reunioes: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>
  ),
  relatorios: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h5" />
    </>
  ),
  kanban: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="10" rx="1" />
      <rect x="17" y="4" width="4" height="13" rx="1" />
    </>
  ),
  dashboard: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-4 3 3 4-6" />
    </>
  ),
  cronograma: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  admin: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />,
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3M8 21h8" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
    </>
  ),
  online: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  wave: <path d="M4 10v4M8 6v12M12 3v18M16 6v12M20 10v4" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  chat: (
    <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 5l12 7-12 7z" />,
  recorrencias: (
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  filter: <path d="M3 4h18l-7 8v7l-4 2v-9z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  warn: (
    <>
      <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  /* corrente de tres elos: `link` no singular sao dois elos em diagonal, e a
     aba junta varios — o elo do meio inteiro e o que diz "mais de um" */
  links: (
    <>
      <path d="M8 7.5H6a4.5 4.5 0 0 0 0 9h2" />
      <rect x="7" y="7.5" width="10" height="9" rx="4.5" />
      <path d="M16 7.5h2a4.5 4.5 0 0 1 0 9h-2" />
    </>
  ),
  trend: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </>
  ),
  users: (
    <>
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13A4 4 0 0 1 16 11.9" />
    </>
  ),
  /* relógio com a seta voltando: "o que já aconteceu aqui" */
  history: (
    <>
      <path d="M3.2 9.5A9 9 0 1 1 3 12" />
      <path d="M2.5 4.5v5h5" />
      <path d="M12 8v4.3l3 1.7" />
    </>
  ),
  /* tres degraus assentados na mesma linha de base, o do meio mais alto — e a
     base desenhada, que e o que separa isto do icone `kanban` (tres retangulos
     pendurados no topo) e do `dashboard` (eixo com uma linha subindo) */
  rank: (
    <>
      <path d="M3 21h18" />
      <path d="M4 21v-6h5v6" />
      <path d="M9 21v-11h6v11" />
      <path d="M15 21v-8h5v8" />
    </>
  ),
  /* ---------------------------------------------------------------------
     Icones de CONTEUDO, para o seletor do card de link (`icones-core.ts`).

     Os de cima sao de NAVEGACAO: eles nomeiam uma aba, e por isso podem ser
     abstratos. Estes nomeiam o que esta do outro lado de uma URL, e a regra
     deles e outra — tem de ser reconheciveis em 18px dentro de uma grade de
     trinta, sem rotulo ao lado no primeiro olhar.

     NENHUM E LOGOTIPO, de proposito. Quem diz a marca e o selo de texto embaixo
     do titulo do card; guardar dezoito marcas registradas aqui dentro seria
     carregar dezoito riscos juridicos para dizer o que uma palavra ja diz.

     O `d` de cada um e DISTINTO do de todos os outros do catalogo, e isso e
     asserção de `scripts/test-icones.mjs` — o repositorio ja tem tres pares
     identicos por acidente (`admin`/`shield`, `cronograma`/`calendar`,
     `dashboard`/`trend`), e um seletor com gemeos pede a quem usa que escolha
     entre duas celulas que desenham a mesma coisa.
     --------------------------------------------------------------------- */
  pasta: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  /* grade com cabecalho: o que separa isto do `kanban` (tres retangulos soltos)
     e do `calendar` (retangulo com dois ganchos em cima) sao as colunas
     internas descendo ate a base */
  planilha: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14.5h18M9 9v11M15 9v11" />
    </>
  ),
  /* tela de projecao com o pe: `online` e um monitor de mesa (base larga e
     curta); aqui a tela pendura de uma barra e o pe e um trepe */
  apresentacao: (
    <>
      <path d="M3 4h18" />
      <path d="M4.5 4v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V4" />
      <path d="M9 21l3-3 3 3" />
    </>
  ),
  prancheta: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  livro: (
    <>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z" />
      <path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20" />
    </>
  ),
  banco: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13" />
      <path d="M20 12c0 1.66-3.58 3-8 3s-8-1.34-8-3" />
    </>
  ),
  dinheiro: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 10v4M18 10v4" />
    </>
  ),
  alvo: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  /* `play` sozinho e o botao de tocar (uma acao); com a moldura em volta vira o
     substantivo "video", que e o que um link e */
  video: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M10 9.5l5 2.5-5 2.5z" />
    </>
  ),
  imagem: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  globo: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </>
  ),
  mapa: (
    <>
      <path d="M12 21.5s7-6.4 7-11.5a7 7 0 1 0-14 0c0 5.1 7 11.5 7 11.5z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  /* as duas pontas mais a barra inclinada: sem a barra, as pontas sozinhas sao
     `chevronLeft` e `chevronRight` coladas, que e o desenho de navegacao */
  codigo: (
    <>
      <path d="M8.5 17.5L3 12l5.5-5.5" />
      <path d="M15.5 6.5L21 12l-5.5 5.5" />
      <path d="M13.5 3.5l-3 17" />
    </>
  ),
  estrela: (
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1.1 6.2-5.5-2.9-5.5 2.9 1.1-6.2L3.2 9.5l6.1-.9z" />
  ),
  /* fita de premiacao: o disco em cima e as duas pontas embaixo.

     E DESENHO NOVO, e nao o `shield` reaproveitado, por um motivo concreto: o
     `d` de `shield` e LITERALMENTE identico ao de `admin` (as duas linhas sao a
     mesma). Reusa-lo faria emblema e administracao terem o mesmo simbolo em
     telas vizinhas — o perfil e a aba Admin, que e justamente onde os emblemas
     sao configurados. */
  emblema: (
    <>
      <circle cx="12" cy="8.5" r="5.5" />
      <path d="M8.5 13.2L7 22l5-2.8 5 2.8-1.5-8.8" />
    </>
  ),
  dimensoes: (
    <>
      <rect x="9" y="2.5" width="6" height="4.5" rx="1.2" />
      <rect x="2.5" y="16" width="6" height="4.5" rx="1.2" />
      <rect x="15.5" y="16" width="6" height="4.5" rx="1.2" />
      <path d="M12 7v4.5M5.5 16v-4.5h13V16" />
    </>
  ),
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
};

export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name] ?? null}
    </svg>
  );
}

/**
 * O punho de seis pontos que marca "isto se arrasta".
 *
 * Fora do mapa `PATHS` de propósito: ele é preenchido (`fill`), e não traçado
 * como todos os outros — passá-lo pelo `<Icon>`, que chumba `fill="none"`, o
 * deixaria invisível. Dois lugares o desenham (o card da demanda e o cabeçalho
 * da coluna do quadro), e depois que o card virou componente próprio um deles
 * teria de manter uma cópia.
 */
export function GripDots() {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="2" cy="2" r="1.3" />
      <circle cx="8" cy="2" r="1.3" />
      <circle cx="2" cy="7" r="1.3" />
      <circle cx="8" cy="7" r="1.3" />
      <circle cx="2" cy="12" r="1.3" />
      <circle cx="8" cy="12" r="1.3" />
    </svg>
  );
}
