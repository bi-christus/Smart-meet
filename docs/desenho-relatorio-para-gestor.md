# Relatório para gestor — desenho final

> Base: **poucos-botoes** (venceu 2 dos 3 painéis). Enxertos de conteúdo do **conteudo-primeiro**, três correções pontuais do **poder-total**. Todos os problemas graves das duas revisões adversariais estão endereçados — cada um com a marca `[RA-n]` (revisão de e-mail) ou `[RC-n]` (revisão de configuração) no ponto onde é resolvido.
>
> Números de linha abaixo foram conferidos no código agora, não herdados dos textos anteriores. Correções relevantes: `.filters` está em **`page.tsx:416`** (e não 369 — 369 é o corpo de `onColDrop`); `.sectors` é o primeiro filho hoje (`:417`); `moveCard` tem **uma** chamada (`:384`) e o caminho de edição também mexe em `enteredAt` (`:1014`); **não existe** ícone `mail` em `icons.tsx` (existe `relatorios`); `createdAt` **já é gravado** em `createCard` (`kanban.ts:186`) e no aceite de proposta (`api/demandas/decidir/route.ts:241`), mas não está no type `Card`; `subscribeColumnsForSectors` não existe; `firestore.rules:105-109` é mesmo `hasOnly(['uid','lastLogin'])`; `Modal` exige `ariaLabel` e fecha no clique do overlay sem confirmação (`modal.tsx:64`).

---

## Em uma frase

Um botão na ponta esquerda da barra de filtros do Kanban abre um estúdio de duas colunas — controles à esquerda, o e-mail real dentro de um `<iframe>` à direita — que monta um relatório de demandas com **poucas opções fechadas** (3 temas, 4 acentos, 2 densidades, agrupamento, ordenação, catálogo de colunas e 6 blocos), salvas por usuário em `/users/{email}/prefs/relatorioGestor` e **lidas pelo servidor no Firestore** na hora de enviar, com o mesmo módulo puro gerando a prévia e o e-mail.

---

## A tela

### O botão

Primeiro filho de `.filters`, **antes** de `.sectors` — inserido imediatamente após `page.tsx:416`:

```tsx
<button
  className={`${styles.filterBtn} ${styles.reportBtn}`}
  onClick={() => setRelatorio(true)}
  title="Montar e enviar o relatório de demandas para o gestor"
>
  <Icon name="relatorios" size={14} />
  Relatório para gestor
</button>
```

`.filters` já é `display:flex; align-items:center; gap:9px` e `.filterBtn` já tem `height:34px` + `white-space:nowrap` (`kanban.module.css:103-115`) — o botão nasce alinhado com a busca e os selects. Não uso `.head`: o `.head` só tem `.headMain`, e um botão ali criaria uma segunda faixa de comando desligada do quadro.

```css
.reportBtn {
  flex: none;                 /* .filters tem flex-wrap: não pode encolher */
  display: inline-flex; align-items: center; gap: 7px;
  border-color: var(--brand);
  color: var(--tx);
}
.reportBtn svg { color: var(--brand); }
```

Sem ícone novo: `relatorios` já existe em `icons.tsx`. Estado `const [relatorio, setRelatorio] = useState(false)` junto de `page.tsx:217-218`; render condicional no fim do `return`, ao lado dos blocos de `CardModal`/`ColumnModal`.

Visível para **todos os papéis**. Quem enxerga os cards pode relatá-los ao próprio gestor; a restrição real é de setor e é reaplicada no servidor.

### O que abre

`<Modal>` compartilhado, com `ariaLabel="Relatório de demandas para o gestor"` (prop obrigatória — as três propostas a omitiram), `overlayClassName={styles.relOverlay}`, `className={styles.relModal}`, sem `width` (o CSS define `width:min(1180px, calc(100vw - 40px)); height:min(86vh, 880px)`).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Relatório para gestor                    Escopo: B.I. · 23 demandas       ✕  │
├───────────────────────────┬──────────────────────────────────────────────────┤
│ CONTROLES (350px)         │  ┌─ caixa de entrada simulada ────────────────┐  │
│ scroll próprio            │  │ Smart Meet <setorbiunichristus@gmail.com>  │  │
│                           │  │ Relatório de demandas — B.I. — 05/08/2026  │  │
│ ▸ Escopo                  │  │ 23 abertas · 6 atrasadas · 4 sem prazo     │  │
│ ▸ Conteúdo                │  └────────────────────────────────────────────┘  │
│ ▸ Colunas da tabela       │  [ Desktop ] [ Celular ] [ Outlook (simulado) ]  │
│ ▸ Aparência               │  ┌────────────────────────────────────────────┐  │
│                           │  │  <iframe srcDoc sandbox="">                │  │
│ ⚠ CVU saiu do seu acesso  │  │  o HTML que vai ser enviado                │  │
│   e foi removido daqui.   │  │                                            │  │
│                           │  └────────────────────────────────────────────┘  │
│                           │  62 KB de 85 KB · 78 de 78 linhas cabem          │
├───────────────────────────┴──────────────────────────────────────────────────┤
│ Salvo · há 3 s   [chips de destinatários]  [Enviar teste p/ mim] [Enviar ▸]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Sete decisões que carregam peso:

1. **Autosave com debounce de 800 ms.** O `Modal` fecha no clique do overlay sem confirmação (`modal.tsx:64`); com salvamento explícito, um clique de 2px fora apagaria a configuração inteira. Autosave torna o problema inexistente — e o rodapé mostra "Salvo · há 3 s". `[RC-13]`
2. **O painel assina os próprios dados.** Ele **não** recebe `cards` da página (que assina um setor só, `page.tsx:233`). Ele chama `subscribeCardsForSectors(setoresEfetivos)` (já existe, `kanban.ts:143`) e um `subscribeColumnsForSectors` novo. Enquanto as assinaturas não chegam, **Enviar fica desabilitado**. Sem isso, a prévia mostra 23 demandas de um setor e o e-mail sai com 180 de quatro. `[RC-1]`
3. **Reconciliação de setores ao abrir.** `setoresEfetivos = prefs.setores ∩ (admin ? DEFAULT_SECTORS : profile.sectors)`. Se sobrar diferença, uma faixa amarela diz qual setor caiu e as prefs são reescritas. Sem isso, um `where("sector","in",[...])` com setor perdido faz o `onSnapshot` inteiro falhar com `permission-denied` — o Firestore não devolve resultado parcial. `[RC-9]`
4. **A caixa de entrada simulada** acima do iframe mostra remetente (`Smart Meet <MAIL_USER>`), **assunto já com os tokens resolvidos** e **preheader resolvido**. Token desconhecido (`{Setores}` com S maiúsculo) fica em vermelho e **bloqueia o envio** com "token {Setores} não existe — use {setores}". É a parte mais visível do e-mail e a única que nenhuma das propostas mostrava. `[RC-4]`
5. **Três modos de prévia.** `Desktop` (820px), `Celular` (390px) e **`Outlook (simulado)`**, que injeta no `srcDoc` um reset com as cinco quebras reais do motor Word:
   ```css
   *{border-radius:0!important;text-transform:none!important;letter-spacing:normal!important}
   span{display:inline!important;padding:0!important}
   table{border-spacing:0!important}
   .env{max-width:none!important;width:900px!important}
   ```
   Não é emulador. É o que impede o usuário de calibrar no Chrome e descobrir a diferença pelo gestor. `[RA-3]`
6. **Contador de bytes com o orçamento real** (85 KB) e a contagem de linhas que couberam. O corte acontece dentro da função pura, então a prévia mostra exatamente o mesmo corte do envio. `[RA-2]` `[RC-2]`
7. **"Enviar teste para mim"** manda o relatório real só para o próprio usuário, com `[TESTE] ` no assunto. Como a prévia comprovadamente não reproduz corte do Gmail, inversão de modo escuro nem `text/plain`, o teste é a única verificação real que existe. `[RC-13]`

O recálculo é síncrono e local (`useMemo` sobre `[dados, prefs]`), com debounce de 150 ms só para o campo de recado. Nenhuma chamada de rede ao mexer num controle.

---

## As opções

### Escopo

| Opção | Valores | Padrão | O que muda de verdade no e-mail |
|---|---|---|---|
| `setores` | pílulas dos setores do usuário (admin: `DEFAULT_SECTORS`), **máx. 4** | `[setor atual]` | Quais cards entram. Acima de 1 setor, a coluna `setor` entra sozinha na tabela |
| `recorte` | `abertas` · `risco` (atrasadas + sem prazo + vencem em ≤3 d) · `todas` | `abertas` | Quantas linhas e qual o tom do relatório |
| `periodo` | `7d` · `14d` · `30d` · `90d` | `30d` | Só a janela do bloco "Fluxo do período" |

Teto de 4 setores, não 8 nem 10: acima disso a leitura no servidor vira `where in` sobre coleções inteiras sem paginação, e a tabela deixa de ser legível. `[RC-11]`

**A etapa que significa "entregue" não é opção desta tela.** Ela é propriedade do quadro (ver Modelo de dados) — decisão explicada abaixo.

### Conteúdo

| Opção | Valores | Padrão | O que muda de verdade no e-mail |
|---|---|---|---|
| `agrupamento` | `etapa` · `responsavel` · `prioridade` · `risco` · `nenhum` | `etapa` | Quantos `<h2>` e como as linhas se distribuem |
| `ordenacao` | `prazo` · `prioridade` · `atraso` · `parado` · `titulo` | `prazo` | Quem aparece primeiro dentro do grupo — e, com corte por orçamento, **quem aparece** |
| `blocos.resumo` | on/off | **on** | Faixa de 4 números no topo |
| `blocos.fluxo` | on/off | **on** | Entraram × concluídas no período + saldo |
| `blocos.carga` | on/off | **on** | Tabela agregada por responsável, com barra |
| `blocos.paradas` | on/off | **on** | Top 5 por `enteredAt` mais antigo |
| `blocos.distribuicao` | on/off | off | Barras por etapa (omitido automaticamente se `agrupamento === "etapa"`) |
| `blocos.qualidade` | on/off | off | % sem responsável / sem prazo / sem solicitante / sem data de entrada |
| `recado` | texto, ≤ 400 | vazio | Parágrafo citado logo abaixo do cabeçalho |

A **tabela de demandas** não tem toggle: sem ela não é relatório. Todos os blocos ligados por padrão, exceto ela, são **agregados** — custo de bytes fixo, independente do número de cards. Só `paradas` (5 linhas) e a tabela principal crescem.

`limite` por bloco **não existe como controle**. O corte é por orçamento de bytes, aplicado do fim de cada grupo para trás, e declarado no e-mail. Isso elimina a ambiguidade "10 por grupo ou 10 no bloco" e a opção `limite: 0`, que é um convite a estourar o Gmail. `[RC-12d]` `[RA-2]`

### Colunas da tabela

Lista com checkbox e alça de arrastar. `titulo` é fixa e sempre a primeira.

| id | Rótulo | Peso | Padrão |
|---|---|---|---|
| `titulo` | Demanda | 40 (travado) | ✔ |
| `responsavel` | Responsável | 18 | ✔ |
| `prioridade` | Prioridade | 12 | ✔ |
| `prazo` | Prazo | 16 | ✔ (data + situação **na mesma célula**) |
| `etapa` | Etapa | 14 | ✔ (some quando `agrupamento === "etapa"`) |
| `parado` | Parada há | 11 | ☐ |
| `inicio` | Início | 11 | ☐ |
| `tipo` | Tipo | 14 | ☐ |
| `solicitante` | Solicitante | 16 | ☐ |
| `setorSolicitante` | Setor solicitante | 16 | ☐ |
| `setor` | Setor | 12 | automático (multi-setor) |
| `checklist` | Progresso | 11 | ☐ |
| `tags` | Tags | 16 | ☐ |
| `origem` | Origem | 11 | ☐ |

Três regras automáticas, para o usuário não precisar pensar:

1. A coluna que repete o critério de agrupamento é **omitida**.
2. `setor` entra sozinha quando o escopo tem mais de um setor, e sai quando volta a um.
3. **A trava é de orçamento de largura, não de contagem.** Soma dos pesos > 100 → aviso "acima disso o Outlook começa a quebrar palavras no meio; desmarque uma coluna". Contar colunas é a métrica errada: `titulo + tags + solicitante + setorSolicitante` são quatro e já passam. `[RC-13]`

Fundir **Prazo + Atraso numa célula só** (data na primeira linha, "8 dias de atraso" / "sem prazo" / "no prazo" na segunda, coloridas) é o enxerto do `poder-total`: derruba o padrão de 6 para 5 colunas e o `min-width` de ~494px para ~430px, o que leva o corpo efetivo no celular de ~10,3px para ~11,7px. É o único ajuste que ataca a fraqueza confessada do desenho vencedor. `[RA-6]`

### Aparência

| Opção | Valores | Padrão | O que muda de verdade no e-mail |
|---|---|---|---|
| `tema` | `pergaminho` · `clinico` · `institucional` | `pergaminho` | Fundo, cartão, grade, zebra **e as duas famílias de fonte** |
| `acento` | `cafe` #8c5a2b · `grafite` #3f4a55 · `verde` #2f7d5d · `bordo` #8a3b3b | `cafe` | Filete do cabeçalho, números dos KPIs, barras, filete de seção |
| `densidade` | `confortavel` (pad 8 / 13px) · `compacto` (pad 6 / 12,5px) | `confortavel` | Quantas linhas cabem no orçamento de bytes |

Os três temas, todos claros:

- **Pergaminho** — fundo `#f4efe6`, cartão `#fffdf8`, grade `#d9ccb6`, zebra `#faf7f1`; Georgia nos títulos, Arial no corpo. É a paleta que `markdown-email.ts:19-31` já usa: um relatório com a mesma cara das atas parece do mesmo sistema.
- **Clínico** — fundo `#eef0f2`, cartão `#ffffff`, grade `#cfd6dc`, zebra `#f7f9fa`; Arial em tudo. Para quem imprime ou reencaminha para fora.
- **Institucional** — cartão branco, faixa de 4px na cor do acento no topo do cartão, títulos em Arial 700, grade `#d5d5cf`. É o mais "documento oficial" sem nenhuma superfície escura.

Os quatro acentos foram medidos contra branco (WCAG, texto normal): café **5,8:1**, grafite **8,7:1**, verde **5,0:1**, bordo **7,3:1**. As cores semânticas idem: risco `#a33a2e` **6,6:1**, atenção `#8a5b1e` **5,8:1**. Como a paleta é fechada e verificada, **não existe guarda de contraste em tempo de execução** — e não existe o bug de o seletor mostrar laranja e o e-mail sair marrom. `[RC-8]`

### O que foi CORTADO do pedido original, e por quê

O Ítalo pediu "cores, temas, fontes, formatos, organização". Entrego tema, acento, densidade, colunas, agrupamento, ordenação e blocos. Fica de fora:

| Cortado | Por quê |
|---|---|
| **Seletor de fonte** | E-mail tem quatro fontes realmente seguras. Solto, isso rende Verdana 13px com títulos Georgia 23px e entrelinha errada — tipografia é proporção, não item de lista. Fonte é **propriedade do tema**. E há um modo de falha pior: pilha sem genérica final (`-apple-system`) faz o Word cair em **Times New Roman**, não na próxima da lista, e o relatório inteiro chega serifado. `[RA-11]` |
| **Cor livre / hex** | Um hex livre entra dentro de `style="…"` num e-mail que parte da conta institucional. Com paleta fechada, o saneador não precisa acertar — não há o que sanear. |
| **Tema escuro** | O modo escuro do Gmail Android reescreve `color`/`background` mas trata `bgcolor` diferente, e faz isso **parcialmente**: texto escuro sobre fundo escuro num bloco, claro sobre claro em outro. E o remetente não tem como ter visto — a prévia é Chrome. Um aviso transferiria ao usuário uma decisão que ele não tem informação para tomar. `[RA-12]` `[RC-10]` |
| **Zebra, borda, largura, cantos, numerar seções, caixa alta** | Seis controles que só conseguem piorar o que o tema resolveu, e cuja combinação `borda:limpo + zebra:off + compacto` produz 40 linhas de 12px sem uma única divisória. Cortar é mais barato que fazer as opções dependerem umas das outras. `[RC-7]` |
| **Reordenar as seções** | A ordem *é* o argumento: números → fluxo → carga → risco → detalhe. Arrastar produz relatório que começa por uma tabela de 40 linhas. |
| **Colunas `descrição`, `último comentário`, `última atividade`** | `description` e `comments[]` são texto livre de operador para operador. Um clique num checkbox chamado "Descrição" põe isso em **todas** as linhas; o usuário vê as 5 primeiras na prévia e a linha 34 diz "a Marina não entregou de novo". É o vetor de vazamento mais provável porque parece inofensivo. `[RC-6]` |
| **Herdar os filtros do quadro** | Filtro invisível dentro de e-mail que vai para o gestor é a pior classe de erro: ninguém descobre que o número está errado. O relatório **ignora** busca, prioridade e responsável ativos, e a tela diz isso. |
| **Agendamento semanal** | Fora da v1 — mas o desenho já suporta (prefs no Firestore + montagem server-side). Virar cron é uma rota com `Bearer CRON_SECRET` e uma linha no `vercel.json`. |
| **Modelos salvos (até 5)** | Reconhecidamente útil ("Semanal enxuto" × "Mensal completo"), mas multiplica por 5 a superfície de prefs a validar e migrar. Fica na Fase 4. |

Sobram **13 controles**, dos quais 6 são select de valor único e 6 são toggles. Configurável em 40 segundos, e todo caminho leva a um e-mail apresentável.

---

## O e-mail

### Estrutura, de cima para baixo

1. **Preheader oculto** — `6 atrasadas · 11 paradas há 7+ dias · 23 abertas`, com `mso-hide:all` e enchimento só de `&#8203;`.
2. **Envelope** — 820px, com **ghost table condicional** para o Outlook e `align="center"` como atributo.
3. **Cabeçalho** — eyebrow em maiúsculas literais, título serifado, linha de contexto com a data **por extenso**, filete de 56×3px na cor do acento.
4. **Recado**, se houver — parágrafo citado com `border-left:3px` no acento.
5. **Resumo em números** — 4 números grandes entre dois fios, **sem caixas**.
6. **Fluxo do período** — entraram / concluídas / saldo, com a ressalva embutida.
7. **Carga por responsável** — tabela agregada com barra embutida e o número **à direita** da barra.
8. **Paradas há mais tempo** — top 5, com o balde "sem data de entrada (N)" ao lado.
9. **Demandas** — `<h2>` do grupo → **subtítulo de uma linha declarando o recorte e a ordenação** → tabela → linha de corte.
10. **Rodapé** — apuração + as três limitações reais do modelo de dados, em uma frase.

O subtítulo sob cada `<h2>` é o enxerto mais barato e mais valioso do `conteudo-primeiro`: é o que separa "bonito" de "organizado", e é texto puro. A contagem total vai **no subtítulo, antes da tabela** ("6 atrasadas — as 4 piores abaixo"), nunca só na linha de corte cinza no fim, que ninguém lê. `[RC-12c]`

### HTML real, pronto para colar

Tema `pergaminho`, acento `cafe`, densidade `confortavel`, agrupamento por etapa. Salve como `.html` e abra: é o documento completo que a rota emite.

```html
<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<!-- Sem <title>: textoSimples() do mailer remove a TAG mas mantém o TEXTO,
     e o título viraria a primeira linha do text/plain, duplicando o assunto. -->
<style>
/* ADITIVO, nunca a base. O Gmail (web/Android/iOS) aplica <style> desde 2016;
   o Outlook desktop ignora e fica com a tabela — que é o que se quer nele.
   Conta importada gmailificada também descarta: por isso o inline é a base. */
@media screen and (max-width:480px){
  .env{width:100%!important}
  .pad{padding-left:16px!important;padding-right:16px!important}
  .cab{display:none!important}
  .lin{display:block!important;border-bottom:1px solid #c9b894!important}
  .cel{display:block!important;width:100%!important;border:0!important;padding:1px 12px!important}
  .cel1{padding-top:11px!important}
  .celz{padding-bottom:11px!important}
  .rot{display:inline!important}
  .kpi{display:block!important;width:100%!important;padding:9px 0!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:#f4efe6;">

<!-- preheader: o trecho ao lado do assunto na lista do Gmail -->
<div style="display:none;mso-hide:all;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4efe6;">
  6 atrasadas &middot; 11 paradas h&aacute; 7+ dias &middot; 23 abertas
  &#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
</div>

<div style="background:#f4efe6;padding:24px 12px;-webkit-text-size-adjust:100%;">
<!--[if mso]><table role="presentation" width="820" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="env" align="center" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:820px;margin:0 auto;background:#fffdf8;border:1px solid #d9ccb6;">

  <!-- 1. CABEÇALHO -->
  <tr><td class="pad" style="padding:26px 30px 0;">
    <p style="margin:0 0 7px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.5px;color:#a08b6d;">SMART MEET &middot; RELAT&Oacute;RIO DE DEMANDAS</p>
    <h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:600;line-height:1.25;color:#2c251d;">B.I. &mdash; demandas abertas</h1>
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.5;color:#7a6f61;">
      Posi&ccedil;&atilde;o de 5 de agosto de 2026, 09h12 &middot; 23 demandas &middot; enviado por &Iacute;talo Ara&uacute;jo
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
      <td width="56" height="3" bgcolor="#8c5a2b" style="width:56px;height:3px;font-size:1px;line-height:3px;">&nbsp;</td>
    </tr></table>
  </td></tr>

  <!-- 2. RESUMO EM NÚMEROS — sem caixas: nada de fundo para o modo escuro inverter -->
  <tr><td class="pad" style="padding:20px 30px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border-top:1px solid #d9ccb6;border-bottom:1px solid #d9ccb6;">
      <tr>
        <td class="kpi" width="25%" style="padding:15px 12px 15px 0;vertical-align:top;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1;color:#2c251d;">23</div>
          <div style="margin-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:.7px;color:#7a6f61;">ABERTAS</div>
        </td>
        <td class="kpi" width="25%" style="padding:15px 12px 15px 0;vertical-align:top;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1;color:#a33a2e;">6</div>
          <div style="margin-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:.7px;color:#7a6f61;">ATRASADAS</div>
        </td>
        <td class="kpi" width="25%" style="padding:15px 12px 15px 0;vertical-align:top;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1;color:#8a5b1e;">11</div>
          <div style="margin-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:.7px;color:#7a6f61;">PARADAS 7D+</div>
        </td>
        <td class="kpi" width="25%" style="padding:15px 0 15px;vertical-align:top;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1;color:#8a5b1e;">4</div>
          <div style="margin-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:.7px;color:#7a6f61;">SEM RESPONS&Aacute;VEL</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- 3. CARGA POR RESPONSÁVEL — barra à prova de Outlook -->
  <tr><td class="pad" style="padding:24px 30px 0;">
    <h2 style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:600;color:#2c251d;">Carga por respons&aacute;vel</h2>
    <p style="margin:0 0 11px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#7a6f61;">
      Demandas abertas por pessoa; a barra compara com quem tem mais. &ldquo;Sem respons&aacute;vel&rdquo; &eacute; capacidade n&atilde;o alocada, n&atilde;o folga.
    </p>
    <table border="1" cellpadding="8" cellspacing="0" width="100%"
           style="border-collapse:collapse;border:1px solid #d9ccb6;font-family:Arial,Helvetica,sans-serif;font-size:13px;">
      <thead><tr class="cab" style="background:#fbf7f0;">
        <th scope="col" width="30%" align="left" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Respons&aacute;vel</th>
        <th scope="col" width="46%" align="left" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Abertas</th>
        <th scope="col" width="12%" align="center" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Alta</th>
        <th scope="col" width="12%" align="center" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Atrasadas</th>
      </tr></thead>
      <tbody>
        <tr class="lin">
          <td class="cel cel1" style="border:1px solid #d9ccb6;padding:8px 10px;color:#2c251d;vertical-align:middle;">&Iacute;talo Ara&uacute;jo</td>
          <td class="cel" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:middle;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
              <!-- width no ATRIBUTO e no style; font-size:1px (não 0) e line-height igual à altura:
                   font-size:0 colapsa no Gmail Android e infla no motor Word. -->
              <td width="63%" height="9" bgcolor="#8c5a2b" style="width:63%;height:9px;font-size:1px;line-height:9px;">&nbsp;</td>
              <td width="30%" height="9" bgcolor="#ece4d7" style="width:30%;height:9px;font-size:1px;line-height:9px;">&nbsp;</td>
              <td width="7%" align="right" style="padding-left:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#2c251d;">12</td>
            </tr></table>
          </td>
          <td class="cel" align="center" style="border:1px solid #d9ccb6;padding:8px 10px;color:#a33a2e;vertical-align:middle;"><span class="rot" style="display:none;color:#8a7f6e;">Alta: </span>5</td>
          <td class="cel celz" align="center" style="border:1px solid #d9ccb6;padding:8px 10px;color:#a33a2e;font-weight:700;vertical-align:middle;"><span class="rot" style="display:none;color:#8a7f6e;">Atrasadas: </span>4</td>
        </tr>
        <tr class="lin" style="background:#faf7f1;">
          <td class="cel cel1" style="border:1px solid #d9ccb6;padding:8px 10px;color:#2c251d;vertical-align:middle;">Marina Feitosa</td>
          <td class="cel" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:middle;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
              <td width="47%" height="9" bgcolor="#8c5a2b" style="width:47%;height:9px;font-size:1px;line-height:9px;">&nbsp;</td>
              <td width="46%" height="9" bgcolor="#ece4d7" style="width:46%;height:9px;font-size:1px;line-height:9px;">&nbsp;</td>
              <td width="7%" align="right" style="padding-left:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#2c251d;">9</td>
            </tr></table>
          </td>
          <td class="cel" align="center" style="border:1px solid #d9ccb6;padding:8px 10px;color:#4a4237;vertical-align:middle;"><span class="rot" style="display:none;color:#8a7f6e;">Alta: </span>2</td>
          <td class="cel celz" align="center" style="border:1px solid #d9ccb6;padding:8px 10px;color:#a33a2e;font-weight:700;vertical-align:middle;"><span class="rot" style="display:none;color:#8a7f6e;">Atrasadas: </span>3</td>
        </tr>
      </tbody>
    </table>
  </td></tr>

  <!-- 4. UM GRUPO DA TABELA PRINCIPAL -->
  <tr><td class="pad" style="padding:26px 30px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 4px;"><tr>
      <!-- filete de seção: border-left na célula, não célula de 4px com &nbsp;
           (o espaço ocupa a largura da fonte herdada e a célula não fica com 4px) -->
      <td style="border-left:4px solid #8c5a2b;padding-left:10px;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:600;color:#2c251d;">
        Em andamento
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:400;color:#7a6f61;">&mdash; 7 demandas</span>
      </td>
    </tr></table>
    <p style="margin:0 0 11px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#7a6f61;">
      Abertas nesta etapa, ordenadas pelo prazo mais pr&oacute;ximo. As 3 sem prazo aparecem no fim, marcadas.
    </p>

    <!-- border/cellpadding/cellspacing ALÉM do CSS: o Outlook ignora border-collapse.
         Tabela de DADOS não leva role="presentation" — leitor de tela precisa anunciá-la. -->
    <table border="1" cellpadding="8" cellspacing="0" width="100%"
           style="border-collapse:collapse;border:1px solid #d9ccb6;font-family:Arial,Helvetica,sans-serif;font-size:13px;">
      <thead><tr class="cab" style="background:#fbf7f0;">
        <th scope="col" width="46%" align="left" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Demanda</th>
        <th scope="col" width="21%" align="left" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Respons&aacute;vel</th>
        <th scope="col" width="14%" align="left" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Prioridade</th>
        <th scope="col" width="19%" align="left" style="border:1px solid #d9ccb6;padding:8px 10px;font-size:12px;font-weight:600;color:#2c251d;">Prazo</th>
      </tr></thead>
      <tbody>
        <tr class="lin">
          <td class="cel cel1" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;line-height:1.5;color:#2c251d;">
            Painel de ocupa&ccedil;&atilde;o das cantinas
            <div style="font-size:11.5px;color:#9b8f7e;padding-top:3px;">Nutri&ccedil;&atilde;o &middot; Nova implementa&ccedil;&atilde;o</div>
          </td>
          <td class="cel" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;color:#4a4237;"><span class="rot" style="display:none;color:#8a7f6e;">Respons&aacute;vel: </span>Rafael Lima</td>
          <td class="cel" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;">
            <!-- pílula como tabela de uma célula: o motor Word não aplica padding
                 a elemento inline nem entende display:inline-block/border-radius -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td bgcolor="#fbe4e2" style="background:#fbe4e2;padding:3px 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.4px;color:#a33a2e;white-space:nowrap;">ALTA</td>
            </tr></table>
          </td>
          <td class="cel celz" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;white-space:nowrap;">
            <span class="rot" style="display:none;color:#8a7f6e;">Prazo: </span><span style="color:#2c251d;font-weight:600;">28/07</span>
            <div style="font-size:11.5px;font-weight:700;color:#a33a2e;padding-top:2px;">8 dias de atraso</div>
          </td>
        </tr>
        <tr class="lin" style="background:#faf7f1;">
          <td class="cel cel1" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;line-height:1.5;color:#2c251d;">
            Automatizar o envio do fechamento mensal
            <div style="font-size:11.5px;color:#9b8f7e;padding-top:3px;">Vinda de reuni&atilde;o &middot; Melhoria</div>
          </td>
          <td class="cel" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;color:#9b8f7e;font-style:italic;"><span class="rot" style="display:none;color:#8a7f6e;">Respons&aacute;vel: </span>sem respons&aacute;vel</td>
          <td class="cel" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td bgcolor="#fdf3e0" style="background:#fdf3e0;padding:3px 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.4px;color:#8a5b1e;white-space:nowrap;">M&Eacute;DIA</td>
            </tr></table>
          </td>
          <td class="cel celz" style="border:1px solid #d9ccb6;padding:8px 10px;vertical-align:top;white-space:nowrap;">
            <span class="rot" style="display:none;color:#8a7f6e;">Prazo: </span><span style="color:#9b8f7e;">&mdash;</span>
            <div style="font-size:11.5px;font-weight:700;color:#8a5b1e;padding-top:2px;">sem prazo</div>
          </td>
        </tr>
      </tbody>
    </table>
    <p style="margin:7px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#9b8f7e;">
      Mostrando 4 de 7 nesta etapa &mdash; o e-mail atingiu o limite de tamanho. Reduza o escopo ou as colunas.
    </p>
  </td></tr>

  <!-- 5. RODAPÉ -->
  <tr><td class="pad" style="padding:26px 30px 30px;">
    <p style="margin:0;padding-top:12px;border-top:1px solid #ece4d7;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#9b8f7e;">
      Apurado direto do quadro em 5 de agosto de 2026, 09h12.
      &ldquo;Parada h&aacute;&rdquo; conta o tempo na etapa atual &mdash; mover a demanda reinicia a contagem, e 3 demandas antigas n&atilde;o t&ecirc;m data de entrada registrada (contadas &agrave; parte).
      &ldquo;Conclu&iacute;das no per&iacute;odo&rdquo; &eacute; aproximado: o sistema ainda n&atilde;o guarda hist&oacute;rico de movimenta&ccedil;&atilde;o, ent&atilde;o conta o que <em>est&aacute;</em> numa etapa final e entrou nela na janela.
    </p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</div>
</body></html>
```

Correções de renderização embutidas acima, uma a uma: ghost table + `align="center"` porque o Word não implementa `max-width` nem centraliza com `margin:0 auto` `[RA-1]`; `<style>` aditivo com `@media` para empilhar no celular `[RA-4]`; separação por `border` de tom médio `#d9ccb6` em vez de depender de 1,5% de luminância entre cartão e zebra `[RA-5]`; pílula como tabela de uma célula `[RA-6]`; sem `border-spacing` em lugar nenhum `[RA-7]`; texto de eyebrow e rótulos **escrito** em maiúsculas `[RA-8]`; barras com `width` em atributo e em estilo, `font-size:1px`, `line-height` igual à altura, e filete de seção via `border-left` `[RA-9]`; sem `<title>` `[RA-10]`; `mso-hide:all` no preheader com enchimento só de `&#8203;`, `role="presentation"` só nas tabelas de layout, `<th scope="col">` na de dados, data por extenso e nenhum e-mail cru no corpo (para não virar link azul sublinhado no Apple Mail), `-webkit-text-size-adjust` no `<div>` externo porque o Gmail descarta o `<body>` `[RA-13]`.

**Uma decisão contra a revisão:** ela pede ≥3:1 de contraste entre grade e cartão. A 3:1 (algo como `#a89a80`) a grade vira o elemento dominante e o "muito bonito" morre. Escolhi `#d9ccb6` (≈1,6:1, contra os 1,09:1 de `#e6ddcf`) e compensei o modo escuro por outra via: **a faixa de KPIs não tem nenhum fundo para inverter** e, no celular, o separador principal é o `border-bottom` do bloco empilhado, não a zebra.

### Orçamento de bytes

Uma linha real do HTML acima custa **~1,0 KB** minificada (5 colunas, pílula e rótulos de celular). Cabeçalho + KPIs + carga + rodapé custam ~7 KB. O `sendMail` codifica em quoted-printable, que acrescenta ~5% (`=\r\n` a cada 76 caracteres e `=` → `=3D`) — então **medir com `TextEncoder` e comparar com 102 KB subestima**.

Teto duro: **85 KB no HTML cru** (≈ 89 KB codificado, folgado abaixo do corte de ~102 KB do Gmail). Isso dá ~78 linhas de 5 colunas ou ~55 de 8. `MAX_LINHAS = 150` teria estourado. O corte roda **dentro da função pura**, do fim de cada grupo para trás, proporcionalmente — então a prévia mostra exatamente o mesmo relatório que sai.

---

## Onde as preferências vivem

### Caminho

```
/users/{email}/prefs/relatorioGestor
```

Subcoleção, doc de id fixo. **Não** campo no doc de `/users`: hoje o dono só escreve `['uid','lastLogin']` (`firestore.rules:105-109`), e ampliar aquele `hasOnly` é mexer na mesma regra que protege `role`, `active` e `sectors`. A subcoleção tem regra própria e ainda evita que a config viaje em `subscribeUsers` (que assina `/users` inteira) e em cada `requireUser`.

### Regra nova, aninhada em `match /users/{userId}`

Regras v2 não cascateiam (o match do pai não usa `{document=**}`), então o bloco aninhado é obrigatório.

```js
    // ---- preferências do próprio usuário ----
    // Subcoleção de propósito: o doc-pai só aceita ['uid','lastLogin'] do dono,
    // e abrir aquele hasOnly seria arriscar role/active/sectors por causa de uma
    // preferência de e-mail. hasOnly aqui trava a FORMA do documento.
    match /users/{userId}/prefs/{docId} {
      allow read:  if isSignedIn() && (souEu(userId) || isAdmin());
      allow write: if isSignedIn() && souEu(userId) && isActive()
                   && docId == 'relatorioGestor'
                   && request.resource.data.keys().hasOnly([
                        'v','tema','acento','densidade','setores','recorte','periodo',
                        'agrupamento','ordenacao','colunas','blocos','assunto','recado',
                        'destinatariosPadrao','atualizadoEm'
                      ]);
    }

    // ---- freio de frequência de envio: só o servidor escreve ----
    match /relatorioEnvios/{email} {
      allow read, write: if false;
    }
```

O `hasOnly` na forma é o enxerto do `poder-total`; o freio numa coleção server-only é o único lugar onde ele funciona — no doc de prefs o próprio usuário zeraria o contador.

### Como o servidor lê

`POST /api/kanban/relatorio`, `runtime = "nodejs"`, mesmo padrão de `enviar-doc` (`HttpError` + um `catch` no fim, `console.error` só em `status >= 500`).

O corpo carrega **só** `{ para: string[], recado?: string, teste?: boolean, prefsRev: string }`. **Nenhuma cor, fonte, largura ou limite vem do cliente** — isso é entrada controlada indo para dentro de `style="…"` num e-mail que parte da conta institucional.

```ts
const caller = await requireUser(req);
if (!mailerConfigured()) throw new HttpError(503, "O envio de e-mail não está configurado.");

const db = adminDb();
const snap = await db.collection("users").doc(caller.email)
                     .collection("prefs").doc("relatorioGestor").get();

// Doc ausente, versão antiga ou campo corrompido: mescla sobre PREFS_PADRAO,
// campo a campo, com whitelist por enum. Nunca e-mail vazio.
const prefs = normalizarPrefs(snap.exists ? snap.data() : null);

// PARIDADE prévia↔envio: o cliente manda o hash das prefs com que renderizou.
// Divergiu = as prefs mudaram (outra aba, migração de versão, edição manual).
// Rejeita em vez de coagir em silêncio.
if (hashPrefs(prefs) !== body.prefsRev) {
  throw new HttpError(409, "A configuração mudou desde a pré-visualização. Reabra a tela.");
}

// Autorização de RECURSO no momento do envio: um setor salvo pode ter saído.
const permitidos = caller.role === "admin" ? DEFAULT_SECTORS : caller.sectors;
const perdidos = prefs.setores.filter((s) => !permitidos.includes(s));
if (perdidos.length) throw new HttpError(403, `Você não tem mais acesso a ${perdidos.join(", ")}. Reabra a tela.`);
if (prefs.setores.length === 0) throw new HttpError(400, "Selecione pelo menos um setor.");
if (prefs.setores.length > 4)   throw new HttpError(400, "No máximo 4 setores por relatório.");

const [cardsSnap, colsSnap, usersSnap] = await Promise.all([
  db.collection("cards").where("sector", "in", prefs.setores).limit(2000).get(),
  db.collection("columns").where("sector", "in", prefs.setores).get(),
  db.collection("users").get(),
]);

const agora = Date.now();
const dados = agregar(cards, colunas, usuarios, prefs, agora);           // puro
const { assunto, html, texto } = montarRelatorio(dados, prefs, {         // puro
  remetente: usuarios[caller.email]?.name ?? caller.email, agora,
});

await sendMail({ to: destino, cc: teste ? [] : [caller.email], replyTo: caller.email,
                 subject: assunto, html, text: texto });

await db.collection("logs").add({
  tipo: "relatorio.enviado", sectors: prefs.setores, recorte: prefs.recorte,
  agrupamento: prefs.agrupamento, linhas: dados.linhasEnviadas,
  cortadas: dados.linhasCortadas, teste: !!body.teste,
  por: caller.email, para: destino, em: new Date(),
});
```

Rejeitar em vez de coagir (`409`) resolve a divergência silenciosa sem deixar string de estilo vir do cliente — as duas propostas concorrentes escolhiam um dos dois males. `[RC-8]`

Antes do POST, a tela faz `await flushPrefs()`: a rota lê do Firestore, então o Firestore precisa estar em dia.

### Preferência antiga ou corrompida

- **Doc ausente** → `PREFS_PADRAO`. O usuário que nunca abriu a tela recebe um relatório completo, não um vazio.
- **`v` menor que a atual** → `migrarPrefs(v)` roda os passos em ordem e regrava. `v` maior (usuário voltou de uma versão futura) → cai em `PREFS_PADRAO` com faixa de aviso na tela.
- **Enum desconhecido** (tema, acento, agrupamento, ordenação, recorte, densidade) → valor padrão daquele campo, silenciosamente. Não é o caminho crítico e não muda número.
- **`colunas`** → filtrado contra o catálogo, deduplicado, `titulo` forçada na primeira posição, orçamento de largura aplicado.
- **`setores`** → interseção com o acesso atual, na tela (com faixa) e no servidor (com 403 nomeando o setor).
- **Nenhum `colId` é armazenado nas prefs.** A etapa terminal vive em `/columns`, então apagar ou recriar uma coluna não deixa a configuração de ninguém apontando para um id fantasma. Esse era o buraco estrutural das três propostas. `[RC-3]`

---

## Modelo de dados

### Novo — `/users/{email}/prefs/relatorioGestor`

```ts
export type PrefsRelatorio = {
  v: 1;
  tema: "pergaminho" | "clinico" | "institucional";
  acento: "cafe" | "grafite" | "verde" | "bordo";
  densidade: "confortavel" | "compacto";
  setores: string[];                       // máx. 4
  recorte: "abertas" | "risco" | "todas";
  periodo: 7 | 14 | 30 | 90;               // janela do bloco "Fluxo"
  agrupamento: "etapa" | "responsavel" | "prioridade" | "risco" | "nenhum";
  ordenacao: "prazo" | "prioridade" | "atraso" | "parado" | "titulo";
  colunas: ColunaId[];                     // ordenadas; "titulo" sempre a 1ª
  blocos: { resumo: boolean; fluxo: boolean; carga: boolean;
            paradas: boolean; distribuicao: boolean; qualidade: boolean };
  assunto: string;                         // tokens {setores} {data} {total} {atrasadas}
  recado: string;                          // ≤ 400
  destinatariosPadrao: string[];           // ≤ 10 — sugere, nunca pré-envia
  atualizadoEm: Timestamp;
};

export const PREFS_PADRAO: Omit<PrefsRelatorio, "atualizadoEm"> = {
  v: 1, tema: "pergaminho", acento: "cafe", densidade: "confortavel",
  setores: [], recorte: "abertas", periodo: 30,
  agrupamento: "etapa", ordenacao: "prazo",
  colunas: ["titulo", "responsavel", "prioridade", "prazo", "etapa"],
  blocos: { resumo: true, fluxo: true, carga: true,
            paradas: true, distribuicao: false, qualidade: false },
  assunto: "Relatório de demandas — {setores} — {data}",
  recado: "", destinatariosPadrao: [],
};
```

`setores: []` significa "a tela injeta o setor atual do quadro".

### Novo — `/relatorioEnvios/{email}`

`{ ultimoEnvioEm: Date }`, escrito só pelo servidor. Freio de 60 s entre envios — protege contra clique duplo e loop, não contra ator malicioso. O freio real continua sendo `MAX_DESTINATARIOS = 10` e o log.

### Alterado — `/columns`: campo `terminal?: boolean`

**Esta é a decisão estrutural do desenho.** Duas ideias boas conflitavam:

- `poucos-botoes` e `conteudo-primeiro` põem "qual etapa significa entregue" **nas prefs do usuário**. Vantagem: ninguém precisa de permissão. Defeito: dois usuários discordam sobre o que é "concluído" no mesmo quadro, o `colId` salvo apodrece quando a coluna é recriada, e — se algum dia se gravar `completedAt` — o campo do card passa a depender de quem arrastou por último.
- Um campo no quadro exige papel gestor para editar.

**Escolhi o campo no quadro**, porque "o que conta como entregue" é uma propriedade do processo do setor, não do gosto de quem manda o e-mail. As regras já cobrem: `/columns` update exige `isGestorOrAdmin() && canSeeSector(...)` (`firestore.rules:144-146`) — **nenhuma mudança de regra**. Um checkbox no `ColumnModal` que já existe (`page.tsx:1395`), ao lado de título e cor, e `updateColumn` ganha `terminal?: boolean` no patch.

**Zero migração**, porque a leitura tem fallback:

```ts
export function colunaEhTerminal(c: ColumnDoc): boolean {
  return c.terminal ?? (c.colId === "concluido" || /conclu/i.test(c.title));
}
```

Isso é exatamente o comportamento de hoje quando o campo não existe, e é o que a Fase 1 usa antes de o checkbox existir. Consequência de bônus: `dashboard/page.tsx:58,90` e `cronograma/page.tsx:76`, que hardcodam a string `"concluido"`, ganham um lugar certo para onde migrar depois.

### Alterado — `src/lib/kanban.ts`

- **`createdAt` no type `Card`** — `createdAt?: Timestamp | Date | null`, mais `export function msDe(v: unknown): number | null` que aceita `Timestamp` (cliente e Admin), `Date` (cards de reunião, `decidir/route.ts:241`) e `number`. O campo **já é gravado nos dois caminhos de criação** e é o único carimbo imutável do modelo — é o que torna "Entraram no período" o número mais confiável do relatório. Sem `createdAt`, o card fica de fora do bloco Fluxo e entra no balde "sem data de criação" do bloco Qualidade. Nunca inventado.
- **`terminal?: boolean` em `ColumnDoc`** e no patch de `updateColumn`.
- **`subscribeColumnsForSectors(sectors, cb, onError)`** — irmão de `subscribeColumns` (`:247`) com `where("sector","in", sectors.slice(0,30))`. Não existe hoje e é obrigatório para a prévia multi-setor.
- **`completedAt` — Fase 4, não agora.** Quando entrar, `moveCard(id, columnId, ehTerminal)` grava `completedAt: ehTerminal ? now : null`, e o mesmo tratamento vai no caminho de edição (`page.tsx:1014`), que também troca de coluna. Só é coerente **porque** `terminal` passou a ser do setor.

### Alterado — `src/lib/server/mailer.ts`

```ts
export type MailRequest = {
  to: string[]; cc?: string[];
  replyTo?: string;   // sem isto a resposta do gestor cai na conta do B.I. e some
  subject: string; html: string;
  text?: string;      // quem monta o HTML pode entregar a versão texto pronta
  attachments?: MailAttachment[];
};
```

E `textoSimples` corrigido, porque ele serve os outros dois chamadores (`notify.ts` e `enviar-doc`) e hoje cola as células:

```ts
    .replace(/<head[\s\S]*?<\/head>/gi, "")     // <title> vira 1ª linha do texto
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(td|th)>/gi, " · ")
    .replace(/<\/(tr|table|h3|li)>/gi, "\n")
```
mais a decodificação de entidades numéricas (`&#(\d+);`) e das nomeadas latinas que os geradores emitem — hoje o texto puro sai com `Distribui&ccedil;&atilde;o` literal. Um `text/plain` degradado, vindo de um gmail.com para domínio institucional, também custa pontuação de entrega. `[RA-10]` `[RC-5]`

### Não alterado

`/cards` (nenhum campo novo na v1, nenhuma migração), `MailAttachment` (o relatório não tem anexo), `firestore.rules` para `/cards` e `/columns`.

---

## Arquivos a criar e alterar

### Criar

| Arquivo | O que é |
|---|---|
| `C:\Users\Italo Araujo\Desktop\Smart meet\src\lib\email\tema.ts` | Isomórfico. `COR`, `SERIF`, `SANS`, `MONO`, `TEMAS` (3), `ACENTOS` (4), `DENSIDADES` (2), `resolverTema(prefs)`, `esc()` (escapando também `'`), `dataExtenso()`, `dataCurta()`, `numBr()`, `pct()`, `plural()`. **Sem import de Node** — precisa rodar no navegador. |
| `…\src\lib\email\blocos.ts` | Primitivas puras que recebem **texto** e devolvem HTML, escapando por dentro: `documento()` (doctype + `<style>` responsivo + preheader + ghost table), `cabecalho()`, `h2Secao()`, `subtitulo()`, `kpis()`, `tabelaDados()`, `pilula()`, `celulaPrazo()`, `barra()`, `citacao()`, `rodape()`. |
| `…\src\lib\relatorio\config.ts` | `PrefsRelatorio`, `PREFS_PADRAO`, `CATALOGO_COLUNAS`, `normalizarPrefs()`, `migrarPrefs()`, `hashPrefs()`, `ORCAMENTO_BYTES = 85_000`, `MAX_SETORES = 4`, `MAX_DESTINATARIOS = 10`. |
| `…\src\lib\relatorio\agregar.ts` | Puro. `agregar(cards, colunas, usuarios, prefs, agora): DadosRelatorio`. Recebe `agora` por parâmetro — nada de `Date.now()` dentro, para ser testável. |
| `…\src\lib\relatorio\montar.ts` | Puro e isomórfico. `montarRelatorio(dados, prefs, meta): { assunto, preheader, html, texto, linhasEnviadas, linhasCortadas }`. **Não pode importar nada de `src/lib/server/`** — é o contrato que mantém prévia e envio idênticos. |
| `…\src\lib\relatorio\prefs.ts` | Cliente Firestore: `subscribePrefsRelatorio(email, cb)`, `salvarPrefsRelatorio(email, prefs)` com `serverTimestamp()`. |
| `…\src\app\(app)\kanban\relatorio-modal.tsx` | O estúdio: 4 grupos de controle, caixa de entrada simulada, iframe com 3 modos, barra de envio, autosave debounced, reconciliação de setores. |
| `…\src\app\(app)\kanban\relatorio.module.css` | Grid do estúdio, trilho de controles, lista de colunas arrastável, chips de destinatário, moldura do preview. |
| `…\src\app\api\kanban\relatorio\route.ts` | `POST`. `runtime = "nodejs"`. |

### Alterar

| Arquivo | Mudança |
|---|---|
| `…\src\app\(app)\kanban\page.tsx` | `useState` junto de `:217-218`; botão como primeiro filho de `.filters` (após `:416`); `{relatorio && <RelatorioModal …/>}` no fim do `return`. Passa `sector`, `sectors`, `profile`, `usersMap` — **não** `cards` nem `fireColumns`. Fase 3: checkbox "Esta etapa significa entregue" no `ColumnModal` (`:1395`). |
| `…\src\app\(app)\kanban\kanban.module.css` | `.reportBtn`, `.relOverlay`, `.relModal`. |
| `…\src\lib\kanban.ts` | `createdAt` e `msDe()`; `terminal` em `ColumnDoc` + `colunaEhTerminal()` + patch de `updateColumn`; `subscribeColumnsForSectors`. |
| `…\src\lib\server\mailer.ts` | `replyTo?` e `text?` em `MailRequest`; `textoSimples` corrigido. |
| `…\src\lib\server\markdown-email.ts` | Passa a **importar** `COR`/`SERIF`/`SANS`/`MONO` de `@/lib/email/tema` (tema pergaminho) em vez de declarar (`:19-37`); exporta `realces`. Refactor puro, saída byte a byte igual. |
| `…\firestore.rules` | Bloco `match /users/{userId}/prefs/{docId}` e `match /relatorioEnvios/{email}`. |

Fora de escopo, anotado: `notify.ts` e `enviar-doc/route.ts` continuam com o próprio `esc()` e o próprio envelope. Migrá-los para o kit é limpeza posterior — mas as correções de `text-transform` (`enviar-doc:122`, `notify.ts:96,117`) e de `max-width` sem ghost table (`enviar-doc:120`, `notify.ts:94`) já são bugs hoje e valem duas linhas cada.

---

## Ordem de implementação

**Fase 1 — Enviar o relatório padrão (a menor coisa útil).**
`tema.ts`, `blocos.ts`, `agregar.ts`, `montar.ts` com `PREFS_PADRAO` **fixo em código**; botão; modal com prévia, destinatários, assunto, recado e "Enviar teste para mim"; rota; log; `replyTo`/`text`/`textoSimples` no mailer. Um setor só (o do quadro), etapa terminal pela heurística de `colunaEhTerminal`. **Nenhuma coleção nova, nenhuma regra nova.** Já entrega o pedido central: um e-mail bonito e organizado com as demandas, para o gestor.

**Fase 2 — Os controles e as preferências por usuário.**
Subcoleção `prefs` + regra + `normalizarPrefs`/`migrarPrefs`/`hashPrefs` + autosave + `prefsRev` no POST; os quatro grupos de controle; multi-setor com `subscribeCardsForSectors` e `subscribeColumnsForSectors`; reconciliação de setores; freio em `/relatorioEnvios`. É aqui que o pedido "salvo por usuário" se cumpre.

**Fase 3 — Blocos analíticos e etapa terminal explícita.**
`createdAt` no type `Card` + `msDe`; blocos `fluxo`, `carga`, `qualidade`, `distribuicao`; campo `terminal` em `/columns` + checkbox no `ColumnModal`. É o que transforma o extrato bonito em instrumento de gestão.

**Fase 4 — Precisão e alcance.**
`completedAt` em `moveCard` e no caminho de edição (agora coerente, porque `terminal` é do setor) — vale só para a frente, e o rodapé declara quantas linhas usaram o palpite; modelos salvos (até 5); envio semanal por cron. Depois: migrar `dashboard` e `cronograma` para `colunaEhTerminal` e apagar o hardcode de `"concluido"`.

---

## Decisões que dependem do Ítalo

1. **Teto de setores por relatório: 4 ou 8?** *Recomendo 4.* Acima disso a leitura no servidor fica sem paginação real e a tabela deixa de caber. Um relatório consolidado de 8 setores é outro produto (agregado, sem linha por demanda).
2. **Quem pode enviar: todos os papéis ou só gestor/admin?** *Recomendo todos.* Quem enxerga os cards pode relatá-los; o escopo por setor já é a restrição real e é reaplicada no servidor.
3. **"Qual etapa significa entregue" vira propriedade do quadro (editável só por gestor/admin) em vez de preferência de cada um?** *Recomendo sim* — é o que impede dois usuários de discordarem sobre o mesmo número. O custo: um operador que discorde precisa pedir ao gestor.
4. **Gravar `completedAt` agora ou na Fase 4?** *Recomendo Fase 4.* Só ajuda para a frente e toca o caminho de escrita do card; a Fase 3 já entrega o par entrada/saída com a saída declarada como aproximação.
5. **Coluna "Descrição" no catálogo: cortada de vez, ou opt-in com aviso?** *Recomendo cortada.* É texto interno de operador para operador, o usuário não rola a prévia inteira, e não tem desfazer depois de enviado.
6. **Assunto editável com tokens, ou fixo?** *Recomendo editável*, com os tokens resolvidos na caixa de entrada simulada e envio bloqueado em token desconhecido.
7. **Destinatários padrão salvos nas prefs?** *Recomendo salvar como sugestão*, com os chips já preenchidos ao abrir — mas nunca enviar sem o clique.
8. **O relatório ignora de propósito os filtros ativos do quadro.** *Recomendo manter*, e é contraintuitivo o bastante para merecer confirmação: se o Ítalo estiver com "Minhas demandas" ligado, o relatório ainda sai com o quadro inteiro.
9. **Modo escuro do e-mail e tema escuro: cortados.** Confirmar que não faz falta — é a decisão que mais reduz risco invisível.

---

## O que este desenho NÃO resolve

- **Throughput medido, cycle time por etapa e burndown.** Não há histórico de transições; `moveCard` sobrescreve `enteredAt` (`kanban.ts:210-217`). "Concluídas no período" é "está numa etapa terminal e entrou nela na janela" — quem concluiu há 40 dias some, quem foi arrastado de volta e para frente reaparece. Nem `completedAt` (Fase 4) reconstrói o passado. A correção de verdade é uma subcoleção `/cards/{id}/eventos` gravada a cada movimentação: outro projeto.
- **Cards antigos sem `enteredAt`.** `agingDays` devolve `0` (`page.tsx:105-108`), então as demandas mais esquecidas seriam as que o bloco "Paradas há mais tempo" menos mostra. Mitigo separando-as num balde declarado ("sem data de entrada: 3") em vez de contar como 0 — mas elas continuam fora do ranking.
- **Fidelidade da prévia.** O iframe é Chrome. Ele não reproduz o corte de ~102 KB do Gmail, a inversão de cores do modo escuro, a remoção do `<style>` em conta importada, nem o layout de tabela do motor Word. O modo "Outlook (simulado)" mostra cinco quebras conhecidas; não é emulador. O "Enviar teste para mim" existe justamente porque a prévia não é autoridade — e isso é uma admissão de que a funcionalidade central do pedido é aproximada por construção.
- **Renomear uma coluna preserva o `colId` e troca a semântica.** Com `terminal` explícito o caso fica muito menor (a flag continua onde o gestor a pôs), mas trocar "Concluído" por "Em revisão" mantendo `terminal: true` não é detectável.
- **Legibilidade real no celular fora do Gmail.** O empilhamento por `@media` funciona no Gmail (web/Android/iOS) e no Apple Mail. Numa conta não-Google lida dentro do Gmail, o `<style>` é descartado e a tabela de 5 colunas volta a encolher — vira ~11,7px com o prazo fundido, legível no limite, não confortável.
- **Deriva de dados entre a prévia e o envio.** O `onSnapshot` continua vivo e o servidor reconsulta; segundos de diferença podem mudar um número. O rodapé de apuração cobre a intenção, não o fato.
- **Remetente.** Continua `Smart Meet <setorbiunichristus@gmail.com>` para caixas `@christus.com.br`. O `replyTo` resolve a resposta perdida; não resolve o "via gmail.com" nem a reputação de domínio.
- **Não substitui o Dashboard.** É um retrato enviado por alguém, com o recorte de alguém. Se a pergunta do gestor for "como isso evoluiu", a resposta não está neste e-mail — e nenhuma opção de tema muda isso.