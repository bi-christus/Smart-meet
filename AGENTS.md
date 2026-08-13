<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Smart Meeting — como se trabalha aqui

Este arquivo é o contrato. Vale para qualquer agente, de qualquer modelo, e para
qualquer pessoa. Se você está lendo isto, siga daqui até o fim antes de escrever a
primeira linha de código.

O projeto é um app de gestão de demandas (Kanban) com pipeline de áudio → ata, em
Next.js 16 + React 19 + Firebase/Firestore, publicado na Vercel. Tudo em produção,
usado por setores reais da Rede Christus. Não existe ambiente de homologação: o que
quebra, quebra para gente de verdade.

---

## 1. Processo de trabalho — obrigatório

Nenhum código entra na `main` sem passar por aqui. A ordem é sempre esta:

**Issue → branch → commit → PR → preview → merge com squash.**

### 1.1 Toda tarefa vira Issue ANTES do código

Conversa não é registro. Se a tarefa não está no GitHub, ela não existe.

```bash
gh issue create \
  --title "verbo no imperativo, concreto, minúsculo" \
  --label "tipo: correcao" --label "P1" --label "area: kanban" \
  --body "..."
```

Toda Issue leva **exatamente três** labels: um `tipo:`, uma `P`, uma `area:`.

| Grupo | Valores |
|---|---|
| `tipo:` | `tipo: correcao` · `tipo: melhoria` · `tipo: nova-funcao` |
| Prioridade | `P0` (bloqueia outras ou já está quebrado) · `P1` · `P2` |
| `area:` | `observabilidade` `qualidade` `testes` `motion` `processo` `kanban` `infra` `seguranca` |
| Extra | `bloqueado: acao-humana` — quando depende de conta, token ou credencial que nenhum agente obtém |

O corpo da Issue precisa ser **auto-suficiente**: quem executar pode ser um agente de
outro modelo, sem nada do contexto da conversa que a originou. Isso significa
`arquivo:linha`, comandos exatos e critério de pronto verificável.

### 1.2 Branch

Sempre a partir da `main` atualizada:

```
<fix|feat|chore>/<numero-da-issue>-<slug-curto>
```

Exemplo: `fix/12-modal-atras-do-header`.

### 1.3 Commit

Conventional Commits, **em português, sem acentos no assunto**, descrevendo o efeito
para quem usa — não a mecânica interna.

```
feat(kanban): setor e solicitante viram lista que se digita     ← bom
refactor: extrai hook useSetores                                 ← ruim
```

O corpo explica o **porquê**, em prosa. Olhe `git log` antes de escrever o seu: o
padrão da casa é denso e vale a pena manter.

Rodapé obrigatório quando um agente escreveu o código:

```
Co-Authored-By: <nome do agente> <noreply@…>
```

### 1.4 PR

A primeira linha do corpo do PR **tem** de fechar a Issue:

```
Closes #12
```

Sem isso o PR é rejeitado. É o que mantém Issue e código amarrados depois que a
conversa some.

### 1.5 Antes de pedir merge, estes três comandos passam

```bash
npm run lint
npx next typegen && npx tsc --noEmit
npm run prebuild
```

**O `next typegen` antes do `tsc` não é opcional.** `tsconfig.json` inclui
`.next/types/**/*.ts` e `next-env.d.ts`, e o `next-env.d.ts` é gitignored
(`.gitignore:41`). Sem gerar os tipos primeiro, o `tsc` checa uma árvore incompleta e
**passa por checar de menos**. Os próprios docs desta versão mandam
`next typegen && tsc --noEmit` (`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md:183`).

> **Manutenção.** Esta lista de comandos existe em três lugares: aqui, no checklist do
> `.github/PULL_REQUEST_TEMPLATE.md` e — quando existir — nos jobs do CI. Se um comando
> mudar, os três mudam **no mesmo PR**. Lista de portão que diverge entre os lugares é
> pior do que não ter lista: cada um passa a acreditar num portão diferente.

### 1.6 Preview, e depois merge

A Vercel publica um Preview Deployment por PR, automaticamente. **Confira na URL do
preview** antes de pedir merge — principalmente qualquer coisa visual. Merge com
**squash**.

### 1.7 A `main` não está protegida — e isso não é permissão

`gh api repos/bi-christus/Smart-meet/branches/main/protection` responde **403
"Upgrade to GitHub Pro"**: o repositório é privado num plano que não tem branch
protection. Ou seja, `git push origin main` **funciona**.

Descobrir que funciona não autoriza fazer. O portão aqui é disciplina, não tecnologia.
Se você é um agente e concluiu que pode commitar direto porque nada te impediu, você
concluiu errado — volte para o passo 1.1.

---

## 2. Publicação

O push na `main` dispara deploy de produção na Vercel, sozinho. Não rode
`vercel --prod` depois — seria um segundo deploy do mesmo código.

**Regra de ordem que já quebrou produção uma vez:** quando o código novo depende de
uma regra nova do Firestore, **publique as regras primeiro**:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Regra nova não quebra o app antigo; app novo sem a regra quebra na hora, porque as
escritas passam a ser negadas. E use `firebase` sem `npx` — a permissão configurada
casa por prefixo literal.

---

## 3. Motion e estados de interface

O projeto tem a skill **`design-motion-principles`** instalada em
`.claude/skills/design-motion-principles/` (MIT, de kylezantos). **Leia-a antes de
mexer em qualquer animação.** Ela é a autoridade nesta frente, e o que está escrito
abaixo é a aplicação dela a este produto.

Smart Meeting é ferramenta de trabalho, usada o dia inteiro. No mapa da skill isso é
*productivity tool*: **Emil primário, Jakub secundário, Jhey só em estado vazio**.

### A regra, em uma linha

> Feedback de sistema em todo lugar. Motion só onde ele ganha o lugar.

**Sempre (isto é feedback, não enfeite):**
- Skeleton em tudo que carrega. Nunca "Carregando…" em texto puro.
- Estado vazio que diferencia **ainda não respondeu** de **respondeu e está vazio** —
  são coisas diferentes e o usuário precisa saber qual é.
- Estado de erro visível, com o que fazer a seguir.
- Progresso em qualquer operação acima de ~400 ms.

**Motion, só quando passa na Frequency Gate da skill:**
- Entrada e saída de modal, chegada de dados, troca de aba, transição de estado. Sim.
- Interação de alta frequência — arrastar card, digitar, filtrar, marcar checklist.
  **Não.** Animar aqui é lentidão percebida, e é exatamente o que a skill chama de
  *AI-slop motion*.
- Duração alvo: **até 300 ms, 180 ms é o ideal**. Acima disso, justifique no PR.

**Inegociável:** toda animação respeita `prefers-reduced-motion`. Sem exceção.

---

## 4. Cultura do código

Estas não são preferências de estilo. São o que faz o repositório continuar legível
depois que ninguém lembra do porquê.

**Comentário explica o PORQUÊ, nunca o o-quê.** Em português. O código já diz o que
faz; o comentário diz qual alternativa foi descartada e por qual motivo. Se o seu
comentário parafraseia a linha abaixo dele, apague-o.

**Módulo puro é separado do SDK.** Regra que dá para testar mora num `*-core.ts` sem
`firebase/firestore` dentro. O acesso ao banco fica no módulo irmão. É isso que
permite testar sem subir nada — veja `kanban-columns.ts`, `tags-ref.ts`,
`historico-core.ts`, `recorrencias-core.ts`, `datas.ts`.

**Todo módulo puro tem teste, e o teste roda no `prebuild`.** Os scripts em
`scripts/*.mjs` importam o `.ts` real pelo strip de tipos nativo do Node — sem cópia,
sem build. O `prebuild` é o portão do deploy: **ele roda de verdade na Vercel**
(confirmado no log: `> smart-meeting@0.1.0 prebuild` → `fronteira de demandas: ok`).
Se ele fica vermelho, o deploy não sai. É de propósito.

**A fronteira de demandas é sagrada.** `scripts/check-demandas-boundary.mjs` garante
que o caminho automático (Cowork → Drive → ingest) **nunca** escreve em `/cards` e
nunca apaga nada. Um card só nasce por decisão humana em `api/demandas/decidir`. Não
"otimize" isso.

**Escrita e registro andam no mesmo lote.** Quando uma mudança precisa deixar rastro
(ver `historico.ts`), a escrita do dado e a do registro vão no mesmo `writeBatch`: ou
as duas entram, ou nenhuma. Trilha que depende de alguém lembrar de chamar apodrece
calada.

**Regras do Firestore são código.** Toda coleção nova precisa da sua regra, escopada
por setor, com o comentário explicando o que está fechado e — honestamente — o que
não está.

**Componente novo entra no mesmo PR do primeiro consumidor.** Entregar o componente
num PR e usá-lo no seguinte parece organizado, mas deixa código sem chamador na
`main` — e o detector de código morto reprova, com razão: da perspectiva dele, aquilo
é lixo. Se o componente é grande demais para caber junto do consumidor, o problema é
o tamanho dele, não a regra.

---

## 5. Observabilidade

Arquitetura decidida: **OpenTelemetry como camada de instrumentação neutra + Sentry
como backend padrão**. Datadog e New Relic ficam escritos porém **inertes**, ligando
por variável de ambiente no dia que fizerem falta. Não instale `dd-trace` nem
`newrelic`: eles fazem monkey-patching no require e custam cold start em serverless.

Cuidado conhecido: as 13 rotas em `src/app/api/` capturam os próprios erros e
devolvem JSON. Nada propaga para o Next, então `onRequestError` sozinho não veria
quase nada — e elas logam `e.message`, jogando o stack fora. Instrumentar sem
consertar isso primeiro não mede nada.

---

## 6. O que nenhum agente consegue fazer

Quando esbarrar em um destes, **pare e peça**. Não contorne, não simule, não finja
que fez.

- Criar conta em serviço externo, ou obter DSN, API key e token (Sentry, Codecov…).
- `gh auth refresh -h github.com -s workflow` — é interativo e abre o navegador. Sem
  esse escopo, **push de qualquer arquivo em `.github/workflows/` é recusado** pelo
  GitHub. O bloqueio é exclusivo dessa pasta: o resto de `.github/` (templates de
  Issue e PR) passa normalmente.
- Ligar branch protection — exige plano pago.
- Rodar o emulador do Firebase: ele é um JAR e **este ambiente não tem Java**. Teste
  de auth depende disso.
  > **Regra do Firestore, não.** Isto aqui já foi uma impossibilidade e deixou de
  > ser. A API `firebaserules.projects.test` avalia um ruleset contra requisições
  > sintéticas **no servidor do Google**, com `get()`/`exists()` dublados — nada
  > local, nada de Java. Use `scripts/comparar-regras.mjs`, que roda a mesma
  > bateria contra as regras da `main` e as suas e mostra só o que mudou de
  > resposta. **Rode antes de publicar qualquer mudança em `firestore.rules`.**
- Fazer login no app com conta Google real.

---

## 7. Ambiente

| | |
|---|---|
| Node | 24.x, local e na Vercel (o strip de tipos nativo depende disso) |
| Firebase | projeto `smart-meet-d441b`, conta `setorbiunichristus@gmail.com` |
| Vercel | projeto `smart-meeting`, deploy automático no push da `main` |
| GitHub | `bi-christus/Smart-meet`, tudo direto na `main` até aqui |
| Crons | `vercel.json` — sync do Drive 06:00, geração de recorrências 06:10 |
