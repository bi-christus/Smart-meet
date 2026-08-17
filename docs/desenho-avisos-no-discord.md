# Avisos no Discord — desenho

> Pedido: *"configurar o smart meet para disparar mensagens para o discord ao criar demandas ou modificações, eu tenho um servidor e quero linkar o usuário do discord com o usuário do smart meet! Com um bot e usando o Webhook!"*

---

## Em uma frase

Todo evento que já entra no histórico da demanda vira, no mesmo instante, uma mensagem no canal do Discord — publicada por **webhook**, montada no servidor a partir do que está no banco, e clicável direto para o card.

O vínculo entre a pessoa do Discord e a do Smart Meet — a parte que faz o aviso **mencionar** o responsável — está em [#90](https://github.com/bi-christus/Smart-meet/issues/90) e neste documento a partir da seção "O vínculo".

---

## Por que webhook para sair e bot para entrar

São dois caminhos opostos, e o pedido precisa dos dois:

| | Webhook | Bot |
|---|---|---|
| Direção | Smart Meet → Discord | Discord → Smart Meet |
| Serve para | publicar o aviso no canal | receber `/vincular` |
| Custo | uma URL, nada mais | app registrado, assinatura |

Webhook **não recebe** nada — ele é uma URL que aceita POST e publica. Bot **não é** o jeito certo de publicar aqui: exigiria token de bot numa chamada que o webhook resolve sem autenticação nenhuma.

---

## As seis decisões que importam

### 1. O gancho mora em `kanban.ts`, não nas telas

Seis lugares escrevem card: `card-modal.tsx`, `kanban/page.tsx`, `cronograma/page.tsx`, `api/demandas/decidir`, `api/recorrencias/gerar` e a própria lixeira. Pendurar o aviso em cada um deles é o desenho que apodrece calado — o sétimo caminho que alguém abrir no mês que vem nasce sem aviso, e ninguém percebe, porque a tela funciona perfeitamente.

O aviso entra nas cinco funções de `src/lib/kanban.ts` que já gravam o evento no mesmo lote (`createCard`, `updateCard`, `moveCard`, `moverParaLixeira`, `restaurarDaLixeira`), uma linha depois do `batch.commit()`. É o mesmo argumento que fez `registro` virar parâmetro **obrigatório** de `updateCard`: aqui é impossível gravar sem avisar, porque é a mesma função.

### 2. O cliente manda dois ids, e mais nada

`POST /api/discord/avisar` recebe `{ cardId, eventoId }`. Título, setor, autor, mudanças e horário a rota **relê do banco** pelo Admin SDK.

Sem isso, qualquer pessoa logada abriria o console e publicaria no canal do setor uma mensagem dizendo o que quisesse, assinada como Smart Meet. É o mesmo princípio de `api/demandas/decidir`: o que o cliente manda é sugestão, e aqui nem isso — são duas chaves de busca.

A URL do webhook fica no servidor pelo mesmo motivo. Ela é uma credencial: quem a tem publica no canal para sempre, sem passar por login. Em `NEXT_PUBLIC_*` ela estaria no bundle de todo mundo.

### 3. A marca de "já avisado" vem **antes** do envio

O evento ganha `discordAt`, gravado numa transação que também confere se ele já existe.

Marcar depois do envio deixaria a janela de duplicata aberta exatamente durante a chamada de rede — o pedaço lento. Duas requisições para o mesmo evento (um retry do `keepalive`, um duplo clique) leriam as duas `discordAt` vazio, e o canal receberia a mesma mensagem duas vezes.

O preço é que a falha de envio precisa **desfazer** a marca. Sem isso o evento ficaria registrado como avisado sem nunca ter sido — e o reenvio, a única correção possível, deixaria de acontecer para sempre.

### 4. Nada disto pode quebrar o ato de salvar

O aviso é consequência do trabalho, não parte dele. Três decisões saem daí:

- O disparo é **fire-and-forget** (`avisarDiscord` nunca lança). A demanda já está gravada quando ele acontece; esperar o Discord faria o botão Salvar rodar por causa de uma mensagem, e um Discord fora do ar transformaria "salvar demanda" em "não consigo salvar demanda".
- Toda saída "não deu para avisar" é **200 com motivo**, não erro: `ja-avisado`, `sem-noticia`, `sem-webhook`.
- Sem `DISCORD_WEBHOOK_URL` configurada, o app funciona igual. É o estado de qualquer Preview antes de alguém colar a variável.

O custo, dito na cara: **um aviso perdido é perdido**. Se o navegador fechar entre o commit e a requisição, ou o Discord estiver fora do ar naquele segundo, aquele evento não vira mensagem — o `discordAt` desfeito permite reenviar, mas ninguém vai. A demanda está no quadro, e o histórico está certo; o que faltou foi a notificação. Uma varredura de reenvio caberia num cron, e não existe hoje porque o plano da Vercel só permite cron diário — um aviso do dia seguinte não é aviso.

### 5. Os tetos do Discord são regra, e regra tem teste

A API recusa o embed **inteiro** quando um campo estoura, com 400. Uma descrição de 4 mil caracteres não é caso de borda: é o tamanho que `updateCard` permite gravar. Um título de 300 caracteres apagaria o aviso daquela demanda para sempre, em silêncio.

Por isso `discord-core.ts` é módulo puro com `scripts/test-discord.mjs` no `prebuild`, e os tetos estão nomeados (`LIMITE_TITULO`, `LIMITE_TOTAL_EMBED`…) em vez de números soltos: são números **deles**, e mudá-los não afrouxa nada — só quebra em produção.

Quando o embed não cabe nos 6000 caracteres, o corte é **anunciado** ("mais 20 itens — abra a demanda"). Um aviso que silenciosamente perde metade das mudanças mente sobre o que aconteceu.

### 6. A menção vai no `content`, nunca dentro do embed

O Discord **não notifica** por menção escrita em embed — ela vira texto azul e ninguém recebe nada. É o erro que faz a integração parecer pronta e não chegar em ninguém.

E `allowed_mentions` sai sempre com `parse: []`, que desliga toda menção automática, reabrindo a permissão só para o id do responsável. Sem isso, um título de demanda contendo `@everyone` — texto que qualquer pessoa digita no campo Título — notificaria o servidor inteiro.

---

## O que a mensagem mostra

```
Ítalo Araujo arrastou o card
┃ Painel de consumo do refeitório          ← link para o card
┃ Etapa            Responsável
┃ A fazer → Fazendo   Kauã Silva
┃ Prazo            Prioridade
┃ 01/09/2026       Alta
┃ Smart Meet · B.I. · Nova implementação   17/08 09:00
```

A ordem não é estética: **a notícia primeiro, o contexto depois**. O que mudou é o motivo de a mensagem existir; o estado atual é o que ajuda a entender. E o que já foi notícia não se repete no contexto — mostrar "Etapa: Fazendo" logo abaixo de "Etapa: A fazer → Fazendo" é a mesma informação ocupando duas linhas do celular de quem leu.

A cor da barra lateral é a única pista que se lê antes do texto, numa lista de avisos empilhados: laranja da marca para a demanda que nasce, vermelho e verde para o par excluir/restaurar, azul para o card que anda, **cinza para a edição** — o evento mais frequente e o que menos precisa puxar o olho.

O título leva a `/kanban?setor=<setor>&card=<id>`, que já abre o card direto (`src/app/(app)/kanban/page.tsx:296`). A base vem de `APP_URL` e nunca da origem da requisição — pelo mesmo motivo de `src/lib/server/notify.ts:197`: seria o host interno do deploy, que não existe para quem clica.

---

## O que vira aviso

Tudo que virou linha na timeline, menos evento sem notícia.

`diffCard` já é o filtro de ruído do projeto: reordenar checklist e renomear um link não geram evento nenhum, então não chegam até aqui. Duplicar esse julgamento criaria uma demanda que aparece no histórico e não aparece no Discord, e a diferença entre as duas listas seria impossível de explicar para quem usa.

O que `deveAvisar` recusa é o verbo que precisa de par e não tem: "editada" sem nenhuma mudança viraria "fulano editou a demanda" sem dizer o quê.

É a política mais generosa possível, e é onde mexer quando o canal encher — um lugar, com teste.

---

## Mudança de assinatura: `anexarEvento`

Passou a devolver o **id do evento** (`string | null`) em vez de `boolean`. A truthiness foi preservada, então os pontos que usavam o retorno como condição continuam corretos.

O id existe porque a rota precisa apontar para um evento específico. Sem ele, ela teria de adivinhar "o último evento deste card" — e duas pessoas salvando o mesmo card no mesmo segundo publicariam o aviso uma da outra.

---

## `demanda-rotulos.ts`: por que um módulo novo

O aviso é montado no **servidor**, e precisa escrever "Alta" e "Nova implementação", não "alta" e "implementacao". Os dois mapas moravam em `kanban.ts`, que carrega `firebase/firestore` do cliente junto e por isso nenhuma rota consegue importar.

Copiá-los para dentro da rota criaria dois mapas envelhecendo separados: no dia em que alguém acrescentasse um tipo de demanda, a tela mostraria o nome novo e o Discord mostraria o identificador cru. `kanban.ts` reexporta tudo, então nenhuma tela mudou de import — mesmo padrão de `lixeira-core`, `kanban-columns` e `tags-ref`.

---

## Regras do Firestore: nenhuma muda

`discordAt` é escrito só pelo Admin SDK, que não passa por regra nenhuma. Do cliente, o `hasOnly` do histórico já barra o campo — e `update` em evento gravado é negado para todos, o que continua certo: o cliente não tem o que fazer ali.

---

## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | para o aviso sair | webhook do canal padrão |
| `DISCORD_WEBHOOK_URLS` | não | JSON `{"B.I.":"https://…"}`, um canal por setor |
| `APP_URL` | já existia | base do link que abre o card |

`DISCORD_WEBHOOK_URLS` ganha do padrão quando o setor tem entrada própria. Hoje um setor só executa demanda (`DEFAULT_SECTORS`), então o padrão basta — a porta fica aberta porque o dia em que um segundo setor entrar, ele vai querer o próprio canal, e descobrir isso com o quadro em produção é tarde.

JSON quebrado **não cala o aviso**: cai no padrão e segue. Variável mal colada é erro de configuração, e configuração errada não pode calar a notificação inteira.
