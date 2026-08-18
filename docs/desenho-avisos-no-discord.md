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

### 1. O gancho mora em `kanban.ts`, não nas telas — e no servidor, num lugar só

Escrever card acontece em duas famílias de caminho, e as duas precisam do gancho. Pendurar o aviso em cada tela é o desenho que apodrece calado: o caminho novo que alguém abrir no mês que vem nasce sem aviso, e ninguém percebe, porque a tela funciona perfeitamente.

**No navegador**, o aviso entra nas cinco funções de `src/lib/kanban.ts` que já gravam o evento no mesmo lote (`createCard`, `updateCard`, `moveCard`, `moverParaLixeira`, `restaurarDaLixeira`), uma linha depois do `batch.commit()`. É o mesmo argumento que fez `registro` virar parâmetro **obrigatório** de `updateCard`: ali é impossível gravar sem avisar, porque é a mesma função.

**No servidor**, quem cria card pelo Admin SDK chama `publicarEvento` de `src/lib/server/discord-aviso.ts` direto — sem salto HTTP e sem forjar um token para o servidor falar consigo mesmo. São dois: `api/demandas/decidir` (a proposta de reunião que um humano aceitou) e `api/recorrencias/gerar` (o cron das 06:10).

> **Isto foi um furo, e a nota fica.** O #89 entregou só a metade do navegador e a documentação afirmava cobrir tudo. Demanda nascida de reunião e de recorrência entrava no quadro com o canal mudo — exatamente o modo de falha que esta seção diz evitar. Consertado em #93. A regra que sobrou: **quem cria card ou evento pelo Admin SDK chama `discord-aviso.ts`.**

O cron é a exceção de FORMATO, não de cobertura: ele publica **um resumo por rodada**, não um aviso por card. Ver "O resumo das recorrências".

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

## Um canal por assunto

O servidor do setor não tem um canal de demandas — tem quatro, e a organização é de quem montou:

| Canal | Chave | O que cai ali |
|---|---|---|
| `#demandas-novas` | `novas` | demanda nascendo (`criada`) |
| `#demandas-fluxo` | `fluxo` | `editada`, `movida`, `excluida`, `restaurada` |
| `#alertas-e-recorrencias` | `alertas` | o resumo da rodada do cron, e o que for alerta |
| `#resumo-diario` | `resumo` | o panorama do dia |

**Por que separar entrada de fluxo.** "Nasceu uma demanda" é notícia para quem acompanha entrada de trabalho; "mudou de etapa" é acompanhamento, e é o volume — num quadro ativo, um card criado gera cinco ou seis eventos até ser entregue. Jogar os dois no mesmo canal obriga quem só quer o primeiro a ler todos, e o jeito conhecido de sobreviver a isso é silenciar o canal, que apaga junto o aviso que importava. É a mesma aritmética que fez o cron das recorrências publicar um resumo em vez de vinte mensagens.

**A lixeira fica no fluxo**, e não num canal próprio: excluir e restaurar são raros o bastante para não incomodar ali, e um canal a mais por causa deles seria um canal que ninguém abre.

**O cron das recorrências deixou de cair em `novas`.** O canal de entrada existe para o trabalho que alguém pediu; rotina automática de manutenção não é isso, e quinze linhas de recorrência amanhecendo lá dentro apagariam justamente a demanda nova que alguém precisa ver.

Quem decide é `canalDoEvento` em `discord-core.ts` — módulo puro, com teste. Como `deveAvisar`, é política de ruído: um lugar só para mexer quando um canal encher.


## A mensagem direta ao responsável

O canal resolve *"o setor precisa saber"*. Ele não resolve *"você precisa saber"*: a menção chega junto com todas as outras, e quem está com o Discord no celular durante uma aula lê a notificação do servidor uma vez por dia. A demanda que mudou de prazo hoje de manhã é justamente a que menos pode esperar por isso.

Por isso existe o direto, e por isso ele é **estreito de propósito**.

### O que o faz sair, e o que o segura

`deveMandarDireto` recusa três casos, e cada um vale ser lido:

| Recusa | Por quê |
|---|---|
| sem vínculo | não há para onde mandar; é o caso comum enquanto ninguém conectou a conta, e o aviso do canal sai igual |
| **o autor é o próprio responsável** | quem arrastou o próprio card acabou de ver a tela responder — a DM chegaria antes de ele soltar o mouse |
| evento sem notícia | mesma régua do canal (`deveAvisar`), e é a **mesma função** de propósito |

A segunda é a que importa. Mensagem direta é o canal mais caro que existe: ela vibra o telefone e não dá para silenciar sem silenciar o bot inteiro. Gastá-la com eco do próprio clique é o jeito mais rápido de ensinar alguém a ignorar todas as outras.

Duas réguas separadas para canal e DM divergiriam no dia em que alguém mexesse numa só, e a diferença entre "apareceu no canal" e "chegou na DM" seria impossível de explicar para quem usa. Por isso `deveMandarDireto` termina chamando `deveAvisar`.

**O que ele não cobre, e a nota fica:** quem *perdeu* a demanda não é avisado. A mudança de responsável guarda só o nome de quem saiu (`Mudanca.de`), não o e-mail — e sem e-mail não há vínculo a procurar. Resolver isso exigiria o evento carregar identidade além de rótulo, o que é mudança no histórico, não aqui.

### A primeira linha é o porquê

Uma DM do nada com um embed dentro é um susto: a pessoa não pediu, e o embed sozinho não diz se ela precisa fazer alguma coisa. `linhaDoDireto` resolve em cinco palavras — e é o que aparece na prévia da notificação do celular, antes de qualquer toque.

```
Esta demanda passou a ser sua.
┃ Painel de consumo do refeitório
┃ Responsável: Ítalo → Kauã Silva
┃ Smart Meet · B.I. · Nova implementação
```

"passou a ser sua" ganha das outras frases quando o responsável mudou, porque é a única que muda o que a pessoa tem a fazer hoje.

O embed é o **mesmo** do canal, montado por `montarAviso`. Um segundo montador acabaria mostrando um campo a mais aqui e um a menos ali, e quem lesse os dois teria de decidir em qual acreditar.

### Duas chamadas, e nenhum id guardado

O Discord não aceita "mande para o usuário X": ele exige abrir (ou reencontrar) o canal privado e só então publicar. `POST /users/@me/channels` é idempotente — chamá-lo de novo devolve o mesmo canal.

O id desse canal **não é guardado**. Guardá-lo economizaria ~100 ms num caminho que ninguém está esperando, e custaria um campo a mais para manter certo: no dia em que o cadastro trocasse de conta do Discord, o canal guardado apontaria para a caixa da pessoa anterior — e a demanda de alguém chegaria em quem não tem nada com ela.

### O direto vem depois do canal, e falhar nele não desfaz nada

`enviarDireto` **nunca lança**, ao contrário de `enviarAviso`. É diferença de contrato, e é deliberada: quem chama usa a exceção de `enviarAviso` para desfazer o `discordAt`. Se o direto lançasse, uma caixa de mensagens fechada desfaria a marca de um aviso **já publicado** no canal — e o reenvio duplicaria a mensagem de lá para tentar de novo uma coisa que vai falhar igual.

Pelo mesmo motivo o direto não tem marca própria de idempotência: `discordAt` cobre o evento inteiro. Uma segunda marca abriria a possibilidade de as duas discordarem, e o sintoma seria uma DM repetida sem nada repetido no canal.

`403` na abertura do canal significa que a pessoa desligou "mensagens diretas de membros do servidor" na privacidade dela. É escolha dela, não defeito nosso — vira `motivo: "dm-fechada"` no log, e o aviso do canal já saiu de qualquer jeito.

### O token do bot passou a existir em produção

Isto **contradiz o que este documento dizia**, e a nota fica. Enquanto o bot só recebia comandos, produção não precisava do token: interação se autentica por assinatura. Mandar DM é *agir* como o aplicativo, e a API exige `Authorization: Bot <token>`. Não existe caminho sem isso.

Sem `DISCORD_BOT_TOKEN` na Vercel, o app funciona igual — só sem DM (`motivo: "sem-token"`). É o estado de qualquer Preview.


## O resumo das recorrências

O cron das 06:10 é a única exceção ao "um evento, um aviso", e a razão é aritmética: ele pode abrir dezenas de cards de uma vez (ver `LIMITE_POR_EXECUCAO` em `api/recorrencias/gerar`). Vinte mensagens seguidas no canal, todas iguais menos o título, é o jeito de fazer alguém **silenciar o canal** — e canal silenciado apaga também os avisos que importam. Preço alto demais por uma rotina automática que ninguém precisa acompanhar card a card.

Então a rodada publica **uma** mensagem por setor, com até 15 títulos clicáveis e a contagem do que sobrou. Cor verde-água, a mesma de `manutencao` em `DEMAND_TYPE_COLOR`, para o resumo se reconhecer de longe entre os avisos comuns.

E ele **não menciona ninguém**, mesmo com todo mundo vinculado. O responsável ganha menção quando alguém *mexer* na demanda dele; ser acordado às 6h por um cron é o tipo de notificação que ensina a ignorar todas as outras.

Sem marca de idempotência aqui, ao contrário de `publicarEvento`: a chamada acontece uma vez por rodada, e a rodada já é protegida contra repetição pela transação que cria a ocorrência (um card por data prevista). Não há evento único a marcar.

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
| `DISCORD_WEBHOOK_CANAIS` | para o aviso sair | JSON `{"novas":"https://…","fluxo":"https://…","alertas":"https://…"}` — um webhook por assunto |
| `DISCORD_WEBHOOK_URL` | não | canal único, para quando nenhum dos dois acima responde |
| `DISCORD_WEBHOOK_URLS` | não | JSON por setor: `{"B.I.":"https://…"}` ou `{"B.I.":{"novas":"https://…","padrao":"https://…"}}` |
| `DISCORD_BOT_TOKEN` | para a DM sair | token do bot; sem ele só o canal recebe aviso |
| `APP_URL` | já existia | base do link que abre o card |

A resolução tem quatro degraus, do mais específico ao mais genérico, e o primeiro que responde ganha: canal do setor → canal único do setor → canal do servidor → `DISCORD_WEBHOOK_URL`. A ordem não é arbitrária — o que alguém escreveu para um setor específico é decisão mais informada do que a regra geral do servidor, e inverter qualquer par faz uma configuração nova ser silenciosamente ignorada, que é o modo de falha em que tudo parece certo e a mensagem continua saindo no canal errado.

`DISCORD_WEBHOOK_URLS` na forma antiga (setor → string) continua valendo sem alteração nenhuma: quem já a configurou não precisa mexer em nada.

JSON quebrado **não cala o aviso**: cai no padrão e segue. Variável mal colada é erro de configuração, e configuração errada não pode calar a notificação inteira.

---

# O vínculo — quem é quem nos dois lados

> Segunda metade do mesmo pedido: *"quero linkar o usuário do discord com o usuário do smart meet! Com um bot"*.

## Em uma frase

A pessoa gera um código no Perfil, digita `/vincular <codigo>` no Discord, e a partir daí é **mencionada** nos avisos das demandas onde é a responsável.

---

## Por que um bot HTTP, e não um bot de verdade

Bot com conexão de gateway precisa de **processo vivo**. A Vercel é serverless — não existe processo vivo. Um `discord.js` aqui não ficaria de pé: a função morre entre requisições, e a conexão com ele.

O caminho que funciona é o **Interactions Endpoint URL**: o Discord faz POST HTTPS na nossa rota a cada comando, assinado com Ed25519. Mesmo bot, mesmos comandos de barra, sem processo nenhum.

Quem chegar aqui achando que falta uma biblioteca de bot rodando: não falta, e colocar uma quebraria o deploy.

---

## As decisões que importam

### 1. Dois segredos, um de cada lado

| Prova | Quem dá |
|---|---|
| "este e-mail é meu" | o código, que só aparece para quem está logado no Smart Meet |
| "esta conta do Discord é minha" | o `user.id`, que vem do Discord assinado, nunca do corpo |

Nenhum dos dois lados vincula sozinho. É por isso que o código pode ser **curto**: ele é inútil sem uma conta do Discord digitando-o, morre em dez minutos e serve uma vez só.

### 2. A assinatura é o único portão, e vem antes do `JSON.parse`

`/api/discord/interactions` é pública por obrigação — o Discord chama de fora, sem token nosso, sem sessão, sem cookie. E o que ela faz é gravar vínculo de conta.

Ler o JSON antes, para "decidir se precisa verificar", é o jeito de abrir a porta sem perceber. A conferência acontece sobre o corpo **cru**: um `req.json()` seguido de `JSON.stringify` reordena chaves e reformata números, e a assinatura deixa de bater por um espaço.

Assinatura inválida responde **401**, e não 403 — é o código que o Discord exige. Ele testa a URL com uma assinatura propositalmente errada no momento em que ela é salva no portal, e só aceita o endpoint se levar 401. Uma rota que responde 200 para assinatura inválida **passa nesse cadastro**, e é aí que o defeito passa despercebido: tudo parece configurado.

### 3. Ed25519 sem dependência nova

`discord-interactions` e `tweetnacl` fazem exatamente isto, e o Node 24 já sabe fazer sozinho. O que falta é um envelope de doze bytes: a chave vem em hex de 32 bytes crus, e `createPublicKey` quer DER/SPKI, então o prefixo `302a300506032b6570032100` (cabeçalho SPKI do OID 1.3.101.112) vai na frente.

Instalar um pacote por causa de doze bytes constantes é dívida que se paga em toda auditoria de dependência daqui para frente. O teste usa um par de chaves **de verdade**, gerado na hora, e verifica os dois lados: o que passa e o que não pode passar.

### 4. Uma conta do Discord responde por uma pessoa

Sem isso, duas demandas de donos diferentes mencionariam o mesmo `@`, e não haveria como saber qual era para quem — a menção deixaria de ser endereço e viraria enfeite.

Vincular uma conta já ligada a outro cadastro **muda** o vínculo, não recusa. Quem digitou o comando provou as duas pontas; recusar mandaria a pessoa desvincular primeiro, e ela chegaria lá sem saber que existia um vínculo antigo. A resposta diz que a ligação anterior foi desfeita.

### 5. A resposta do comando é sempre efêmera

Sem a flag, "Pronto — vinculado a `ia02@px.com.br`" vira mensagem pública no canal: o e-mail corporativo de quem vinculou fica visível para o servidor inteiro, e a lista de quem trabalha em quê vira histórico de chat. O vínculo é assunto de uma pessoa só.

### 6. O código é o **id** do documento

Assim a busca do `/vincular` é um `get` direto pelo caminho — sem consulta, sem índice — e a unicidade é do banco, não de uma checagem que alguém pode esquecer de fazer. `create` em vez de `set` faz a colisão virar retentativa em vez de roubo silencioso do código de outra pessoa.

Gerar um código novo apaga os anteriores da mesma pessoa. Quem apertasse o botão três vezes deixaria três segredos vivos por dez minutos.

### 7. O alfabeto não tem `I`, `L`, `O`, `0` nem `1`

O código é **lido numa tela e digitado noutra**, às vezes do computador para o celular. `l1O0` é o jeito conhecido de transformar um fluxo de dez segundos em três tentativas e uma desistência — e a pessoa conclui que "não funciona", não que digitou errado.

Sobram 31 caracteres; seis deles dão 887 milhões de combinações, muito além do necessário para um segredo que vive dez minutos e serve uma vez.

### 8. A tela do Perfil assina o próprio cadastro

O vínculo **não acontece nesta tela** — acontece no Discord, na outra janela, segundos depois. O `pessoa` que o modal recebe vem do perfil carregado no login e não muda até o próximo; quem confiasse nele mostraria "não conectado" para sempre, e a pessoa ficaria olhando um código morto sem saber que já deu certo.

Com a assinatura em `users/{email}`, o instante em que ela aperta Enter no Discord é o instante em que o quadro vira **Conectado**. É a única confirmação que o fluxo tem, e ela chega sozinha.

**Motion: nenhum**, e é escolha. Os três momentos — o código aparecer, a contagem descer, o quadro virar Conectado — são todos resposta direta a uma ação, com a pessoa esperando para digitar do outro lado. Animar a entrada do código atrasaria o único dado que ela veio buscar. O que existe é feedback: esqueleto enquanto não se sabe, estados separados para "ainda não respondeu" e "respondeu e está solto", contagem regressiva porque o código morre.

---

## Regras do Firestore: nenhuma muda

- `/discordCodigos` cai no `match /{document=**} { allow read, write: if false }` do fim do arquivo. O cliente nunca a enxerga, que é o certo.
- `discordId` em `/users` é escrito só pelo Admin SDK. O `hasOnly` do dono (`uid`, `lastLogin`, `photo`, `name`) continua fechado — abri-lo para mais um campo seria arriscar `role`, `active` e `sectors` por causa de um id que nem é segredo.

Por isso `npm run test:regras` não se aplica a esta frente.

---

## Variáveis de ambiente

| Variável | Onde | O que é |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | **Vercel** | confere a assinatura das interações |
| `DISCORD_APP_ID` | só local | o script de registro dos comandos |
| `DISCORD_BOT_TOKEN` | **Vercel** e local | manda a DM em produção; registra os comandos aqui |
| `DISCORD_GUILD_ID` | só local | idem |

O token do bot **passou a ir para a Vercel** — ver "O token do bot passou a existir em produção", acima. Enquanto o bot só recebia comandos isto era desnecessário, e este documento dizia o contrário com razão; a mensagem direta inverteu o quadro, porque mandar DM exige que o aplicativo se identifique.

---

## O passo a passo de quem configura

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** → *Reset Token* → guarde o token (ele só aparece uma vez).
3. **OAuth2 → URL Generator** → escopo `applications.commands` (e `bot`, se quiser vê-lo na lista de membros) → abra a URL e adicione ao servidor.
4. Registre os comandos, na sua máquina:
   ```bash
   DISCORD_APP_ID=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npm run discord:comandos
   ```
5. **General Information** → copie a **Public Key** → na Vercel, `DISCORD_PUBLIC_KEY`.
6. Depois do deploy, volte a **General Information** → **Interactions Endpoint URL** =
   `https://<seu-dominio>/api/discord/interactions` → **Save**. O Discord manda um PING assinado na hora; se a chave estiver certa, ele aceita.

A ordem dos passos 5 e 6 não é negociável: salvar a URL antes de a chave estar na Vercel faz o Discord recusar o endpoint, porque a rota responde 401 para tudo enquanto não souber conferir.

---

## O vínculo em um clique

O `/vincular <codigo>` funciona e continua existindo. Mas ele cobra cinco passos de quem só queria ser avisado: abrir o Perfil, gerar, copiar, trocar de janela, digitar — e o código morre em dez minutos no meio disso. Numa equipe de cinco pessoas, "cada um faz quando puder" termina com duas vinculadas e três recebendo aviso de canal que não é para elas. **A integração inteira depende do vínculo, e o vínculo estava dependendo de paciência.**

O botão **Conectar Discord** resolve numa tela: abre a autorização do Discord numa aba nova, a pessoa confirma, e a aba do Perfil vira **Conectado** sozinha — ela já assinava `users/{email}` desde antes do clique.

### O clique prova exatamente o que o código provava

| Ponta | O código provava por | O clique prova por |
|---|---|---|
| "este e-mail é meu" | o segredo que só aparece logado | a **sessão do Firebase**, que criou o `state` |
| "esta conta do Discord é minha" | o `user.id` da interação assinada | o `id` que volta da **troca de token** |

Nenhum dos dois lados vincula sozinho, nos dois caminhos. A diferença é uma janela a menos.

Um `code` roubado sem o `DISCORD_CLIENT_SECRET` não vale nada, e um `state` roubado sem a conta do Discord também não.

### Por que `email` no escopo, se a sessão já diz quem é

Ele não é necessário para o caminho normal — é o que salva o caminho torto. Se o `state` morrer no meio (dez minutos, ou a aba aberta desde ontem), o e-mail **verificado** pelo Discord ainda permite achar o cadastro certo sem mandar a pessoa começar de novo.

`alvoDoVinculo` decide, e a precedência não é negociável:

1. **O `state` ganha sempre que existir.** Ele nasceu dentro de uma sessão autenticada e diz quem apertou o botão.
2. **O e-mail do Discord é plano B**, e só vale se for `verified` **e** houver cadastro **ativo** com ele.
3. **Nenhum dos dois? `null`.** Vincular "no melhor palpite" entrega as notificações de alguém para a conta errada — e ninguém descobre pelo lado de quem deixou de receber.

Inverter 1 e 2 faria o cadastro errado ganhar sempre que os dois e-mails diferissem, que é o caso comum: quase ninguém usa o e-mail corporativo no Discord pessoal. E `verified` é trava, não detalhe — o Discord deixa cadastrar e-mail sem confirmar.

### O código não virou legado

Ele é o caminho de quem já está no Discord no celular e não quer abrir o app, e o de quem tem **popup bloqueado**. Por isso aparece como segunda opção visível no Perfil, e não escondido atrás de "problemas?": esconder faria a única saída de um popup bloqueado ser invisível justamente para quem precisa dela.

E a tela abre a aba **antes** do `await`. `window.open` chamado depois da resposta do servidor já não conta como resposta ao clique, e o navegador bloqueia — o sintoma seria um botão que não faz nada.

### A escrita do vínculo mora num lugar só

`server/discord-vinculo.ts` (`ligarConta`) é chamada pelos dois caminhos. Copiar a transação para o segundo criaria duas versões de "o que acontece ao vincular", e o defeito seria silencioso: um dos caminhos deixaria de desligar o vínculo anterior, e duas pessoas passariam a receber a menção uma da outra sem nada ficar vermelho.

O que cada caminho ainda faz sozinho é **provar** quem é quem. Daqui para baixo as duas provas valem o mesmo.

> **O código passou a ser consumido numa transação própria**, antes da escrita. O preço está assumido: cadastro inativo queima o código e a pessoa gera outro. A alternativa — apagar só depois de o vínculo dar certo — deixaria o código vivo durante a escrita, que é exatamente a janela em que "uso único" deixa de ser único.

### A página de retorno responde HTML

É o fim da linha de um fluxo que abriu uma aba nova: não há tela do app atrás dela, e um JSON cru na cara de quem só queria ser avisado das demandas é o pior fim possível. A página é autossuficiente — sem CSS do app, sem fonte remota, sem script —, porque qualquer dependência externa ali viraria tela em branco no exato momento em que a pessoa precisa saber se deu certo.

Cancelar no Discord volta por essa mesma rota e **não é apresentado como erro**: nada aconteceu, e é isso que a frase diz.

### Regras do Firestore: nenhuma muda

`/discordOauth` cai no `match /{document=**} { allow read, write: if false }` do fim do arquivo, como `/discordCodigos`. O cliente nunca a enxerga, que é o certo.

### Variáveis de ambiente

| Variável | Onde | O que é |
|---|---|---|
| `DISCORD_CLIENT_ID` | **Vercel** | o Application ID; monta a URL de autorização |
| `DISCORD_CLIENT_SECRET` | **Vercel** | troca o `code` por token, servidor a servidor |
| `APP_URL` | já existia | base do `redirect_uri` — tem de bater com o que está cadastrado no portal |

No portal do Discord, **OAuth2 → Redirects** precisa conter exatamente `https://<dominio>/api/discord/oauth/callback`. O Discord compara texto: uma barra a mais recusa no meio do fluxo, e a mensagem que a pessoa vê é do lado deles.

Sem `DISCORD_CLIENT_ID`, o botão explica que a conexão em um clique não está configurada e aponta para o código. O app não quebra.

