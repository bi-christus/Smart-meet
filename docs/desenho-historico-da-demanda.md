# Histórico da demanda — desenho

> Pedido: *"em cada card de demanda, no canto superior direito, um local para visualizar as mudanças da demanda. Ex.: dia tal a demanda passou do Ítalo para o responsável Kauã."*

---

## Em uma frase

Um botão de relógio no canto superior direito de cada card abre uma timeline lida sob demanda de `cards/{id}/historico` — **um evento por salvamento**, com autor, hora do servidor e a lista do que mudou em texto já legível ("Responsável: Ítalo Araujo → Kauã Silva").

---

## O sistema já registrava?

Não isto. Existe `/logs`, mas é outra coisa: só o servidor escreve, o cliente nem lê, e ele cobre três caminhos (aceite de proposta, envio de doc, envio do relatório). Nada no Kanban deixava rastro — o card guardava apenas o estado **atual**. Uma demanda que estava com o Ítalo e hoje está com o Kauã não tinha, em lugar nenhum do sistema, o registro de quando passou nem de quem passou.

---

## As cinco decisões que importam

### 1. Subcoleção, não um array no card

O quadro assina **todos** os cards do setor em tempo real. Um array de eventos dentro do card faria cada snapshot carregar o histórico inteiro de cada demanda — a tela pagaria, em toda atualização, por um dado que ninguém está olhando. Na subcoleção, o histórico só é lido quando alguém clica.

O preço: o Firestore não apaga subcoleção junto com o pai. Por isso `deleteCardById` varre o histórico **antes** de apagar o card (`apagarHistorico`) — e nessa ordem, porque a regra de leitura precisa do setor, e as duas exclusões exigem gestor, então ou as duas podem acontecer ou nenhuma começa.

### 2. Um evento por salvamento, não um por campo

Quem move o card e troca o responsável no mesmo *Salvar* fez **uma** coisa. Virar duas linhas na timeline esconderia que foram a mesma decisão. O evento carrega uma lista de mudanças; a tela desenha o autor uma vez e as mudanças embaixo, presas por uma barra à esquerda.

### 3. `de` e `para` são texto já resolvido, não e-mail nem id

Grava-se `"Ítalo Araujo"`, não `italo@px.com.br`; `"Em andamento"`, não `fazendo`. O usuário pode ser desativado e a coluna renomeada, e o registro precisa continuar legível dez meses depois — com o nome que a coisa tinha **naquele dia**, que é exatamente o que a pergunta quer saber.

É a escolha oposta à de `tags-ref.ts`, pelo motivo oposto: lá o vínculo é que tem de sobreviver ao rename; aqui é a fotografia.

### 4. A descrição guarda o fato, não o texto

São até 4 mil caracteres por edição. Guardar as duas pontas faria o histórico de uma demanda pesar mais do que a demanda. A linha diz "Descrição · reescrita"; o texto atual está no card, a um clique.

Pela mesma economia de ruído: reordenar a checklist sem concluir nada **não** vira linha (só o placar `2/5 → 4/5` vira), e as tags registram só a diferença (`+ Infra   − Urgente`), não a lista inteira duas vezes.

### 5. A escrita anda no mesmo lote da escrita do card

`updateCard`, `moveCard` e `createCard` gravam a mudança e o registro dela num `writeBatch`: ou os dois entram, ou nenhum entra. E o registro é **parâmetro obrigatório** dessas funções, não uma chamada separada — trilha que depende de disciplina no ponto de uso apodrece no primeiro caminho novo que alguém abrir, e apodrece calada, porque a tela continua funcionando perfeitamente sem ela.

---

## Até onde isto vale como auditoria

Quem escreve aqui é o **navegador**. As regras fecham o que dá para fechar:

| Fechado | Como |
|---|---|
| Registrar em nome de outra pessoa | `souEu(novo('autor'))` |
| Escolher a data | `request.resource.data.em == request.time` (o cliente manda `serverTimestamp()`) |
| Reescrever um evento | `allow update: if false` — para todos |
| Campo extra no documento | `hasOnly(['sector','autor','em','acao','mudancas'])` |
| Esconder o evento em outro setor | na criação, o `sector` tem de bater com o do card pai |
| Apagar avulso | só `isGestorOrAdmin`, que é quem já podia apagar o card |

**O que fica aberto, dito na cara:** quem tem acesso ao setor pode criar um evento descrevendo algo que não fez. Essa mesma pessoa poderia, mais simples, apenas fazer a mudança de verdade — então a brecha não dá poder novo. Isto é a trilha de trabalho do quadro, honesta sobre a sua origem; **não é prova pericial**. Auditoria à prova de insider é `/logs`, que só o servidor escreve.

---

## Por que a consulta filtra por setor

A regra de leitura é escopada por setor (`canSeeSector(cur('sector'))`), e uma consulta do Firestore só passa numa regra dessas se carregar a restrição correspondente — mesmo contrato de `/cards`. Daí o `where("sector", "==", sector)` em `carregarHistorico` e em `apagarHistorico`.

A alternativa — perguntar o setor ao card pai com um `get()` na regra — seria um acesso a documento **por evento avaliado**. Numa listagem de 100 eventos ou numa varrida de exclusão de 400, é o tipo de coisa que estoura o teto de acessos das regras e derruba a tela inteira em vez de negar uma linha. O `get()` ficou só na criação, que acontece uma vez por evento e paga com folga.

Esse filtro exige o índice composto (`sector` ASC + `em` DESC) declarado em `firestore.indexes.json`. **Sem ele a timeline abre vazia**, com erro de índice ausente no console.

---

## Cards que já existiam

Não têm evento nenhum, e o painel diz isso em vez de mentir: *"Nenhuma mudança registrada ainda. Demandas abertas antes desta versão começam a registrar a partir da próxima alteração."*

O selo com o número conta `histCount - 1`, porque o primeiro evento é o nascimento e um "1" em todo card do quadro não informaria nada. Nas demandas antigas isso conta um a menos — a primeira edição delas cai no lugar do nascimento que não houve. É o erro certo a cometer: some sozinho na segunda edição, e o contrário (contar um a mais em todo card, para sempre) não some nunca.

---

## Cards que nascem fora do quadro

Duas rotas criam card sem passar pelo navegador, e as duas passaram a gravar a primeira linha da timeline — senão a demanda abriria o histórico vazio, e *"não tem registro"* leria como *"ninguém mexeu"*:

- **`api/demandas/decidir`** (aceite de proposta de reunião): autor é quem aceitou.
- **`api/recorrencias/gerar`** (cron e "Gerar card agora"): autor é quem ligou a regra — o card não apareceu sozinho, apareceu porque alguém programou que apareceria.

As duas resolvem o nome do responsável e o título da coluna antes de gravar, como o cliente faz. A rota de recorrências ganhou um cache de nomes por execução: o cron abre dezenas de cards por rodada, quase sempre do mesmo punhado de responsáveis.

---

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/historico-core.ts` | módulo **puro**: `diffCard`, `mudancasIniciais`, `linhaDaMudanca`, rótulos |
| `scripts/test-historico.mjs` | 24 asserções sobre o módulo puro, no `prebuild` |
| `src/lib/historico.ts` | Firestore: `anexarEvento`, `carregarHistorico`, `apagarHistorico` |
| `src/lib/kanban.ts` | mutações do card, agora com o registro no mesmo lote |
| `src/app/(app)/kanban/page.tsx` | botão no canto do card + `HistoricoModal` |
| `firestore.rules` | bloco `/cards/{cardId}/historico/{evento}` |
| `firestore.indexes.json` | índice composto `sector` + `em` |

---

## Para publicar

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

Sem as regras, toda escrita de evento é negada (a demanda **não salva**, porque a escrita anda no mesmo lote). Sem o índice, a timeline abre vazia.
