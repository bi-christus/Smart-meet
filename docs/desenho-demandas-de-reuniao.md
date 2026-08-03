# DESENHO FINAL — Demandas a partir de reuniões (Cowork → Smart Meet)

## Em uma frase

O Cowork ganha **olhos por HTTP** (lê o catálogo de demandas, somente leitura) e uma **boca sem verbo de apagar** (deposita um `.json` na pasta do Drive onde ele é Colaborador e não consegue deletar); o app puxa esse arquivo dentro do `/api/drive/sync` que já existe, cria **propostas em quarentena** com evidência citável, e nenhum card no Kanban muda sem um clique humano dentro de uma transação com log.

---

## Como funciona (fluxo do áudio à demanda aceita)

```
[1]  usuário grava/sobe áudio        → app grava properties.smGerar no Drive
[2]  Cowork: listar-pendentes        → áudio pronto (idade > 15 min, título confirmado)
[3]  Cowork: catalogo-demandas       → GET /api/cowork/catalogo → cache local (24h)
[4]  Cowork: baixar + transcrever.py → transcrição .md em <pastaTrabalho>
[5]  MOTOR: conferir-transcricao     → se achar "[⚠️ trecho não transcrito]" ABORTA aqui
[6]  MOTOR: varrer-mencoes           → casamento léxico determinístico (sem LLM)
                                       → mencoes.json + catalogo-reuniao.json (podado)
[7]  SUBAGENTE (contexto isolado)    → Pontos importantes.md, atas, e demandas.json
[8]  MOTOR: validar-demandas         → POST /api/cowork/validar (dry-run, zero escrita)
                                       falhou → NÃO sobe nada de demandas, reporta em pt-BR
[9]  MOTOR: demandas-doc             → renderiza "Demandas.md" A PARTIR do JSON
[10] Cowork: subir-doc  "<base> - Transcrição" | "- Pontos importantes" | "- Demandas"
     Cowork: subir-json "<base> - Demandas.json"
[11] Cowork: marcar-transcrito       → trava dupla + NOVA trava: se existe o Doc
                                       "- Demandas", exige o ".json" ao lado
[12] Cowork: avisar-app              → GET /api/drive/sync com CRON_SECRET
─────────────────────────────────────────────────── fronteira: o Cowork acabou
[13] /api/drive/sync                 → status processado, driveOutputs, syncGrants, e-mail
[14]   + ingestDemandas()            → busca o sidecar por QUERY DIRETA no Drive,
                                       valida, calcula confiança NO SERVIDOR,
                                       cria lote + propostas com tx.create()
[15] tela /demandas                  → humano lê citações, corrige, aceita ou recusa
[16] POST /api/demandas/decidir      → transação com CAS em card.rev + log em /logs
[17] card no Kanban                  → comentário automático + e-mail ao responsável
```

**A entrega é *pull*, não *push*.** O Cowork nunca faz `POST` de escrita. Se o notebook fechar entre o passo 10 e o 12, o sidecar já está no Drive e o cron das 6h ingere. Isso elimina retry, backoff, endpoint de status e a classe inteira de falha "o POST caiu depois do `marcar-transcrito` e ninguém sabe".

---

## O artefato do Cowork

### Formato

Dois arquivos na **mesma pasta do áudio**, ambos derivados de **uma fonte só** (o JSON):

| Arquivo | Nome exato | mimeType | Papel |
|---|---|---|---|
| Payload | `<base> - Demandas.json` | `application/json` | lido pelo app; **nunca** entra em `driveOutputs` |
| Legível | `<base> - Demandas` | Google Doc | humano; entra em `driveOutputs` (`kind: "demandas"`), é compartilhado e anexado no e-mail |

O Doc é **renderizado pelo motor** a partir do JSON (`demandas-doc`), depois da validação. O subagente produz **um** artefato. Isso mata a divergência "o Doc diz 3 demandas, o app mostra 2".

Guarda no `collectOutputs` (`src/app/api/drive/sync/route.ts`, logo após a linha 126):
```ts
if (f.mimeType === "application/json") continue;
```

### Schema `smart-meet/demandas@1`

```
schema        "smart-meet/demandas@1"     literal; qualquer outro → lote rejeitado
driveFileId   string                      chave dura; o app resolve meetingId por ela
base          string
geradoEm      ISO-8601 com fuso
gerador       { skill, versaoSkill, motor, modeloIA }
transcricao   { arquivo, truncada: false, palavras }   truncada:true → lote rejeitado
catalogo      { geradoEm, hash, totalCards, origem: "rede"|"cache" }
propostas     Proposta[]   0..5 na v1  (0 é resultado VÁLIDO e de sucesso)
```

```
Proposta:
  acao          "nova" | "ajuste"          ← não existe "remover", não existe "substituir"
  certezaLLM    "alta" | "media" | "baixa" ← é TETO da confiança, nunca piso
  assunto       string ≤200   deve existir como bloco em "Pontos importantes.md"
  resumo        string ≤200
  evidencia     { citacao ≤400, marca? }[]  1..3   citação LITERAL da transcrição
  conferir      string[] ≤5

  quando acao === "nova":
    proposta            { title≤120, description≤4000, type, priority,
                          requester|null, requesterSector|null,
                          tags≤8, checklist≤10 [{text,desc?}] }
    possivelDuplicataDe string[] ≤3   cardIds do catálogo

  quando acao === "ajuste":
    cardId          string     copiado VERBATIM do catálogo
    refHash         string     copiado VERBATIM — sha1(cardId|norm(titulo)).slice(0,12)
    cardTituloVisto string
    acrescimos  {
      descricao   string ≤2000 | null    APPEND, nunca replace
      tags        string[] ≤5
      checklist   [{text, desc?}] ≤5
      observacao  string ≤600 | null     vira Comment no card
    }
```

**O que a gramática torna inexpressável:** apagar card, esvaziar campo, remover tag, remover item de checklist, trocar título, trocar setor, trocar coluna, **e trocar prazo/prioridade/responsável**.

**Por que `substituir` está fora da v1 inteira.** Prazo, prioridade e responsável derivam de número, data e nome — exatamente o que o ASR erra. Uma transcrição que ouviu "dia doze" no lugar de "dia dois" produz uma citação *literalmente verificável* que sustenta um valor errado; a verificação de citação **aumenta** a confiança num erro que ela é estruturalmente incapaz de detectar. Então o Cowork pode dizer "a reunião falou em antecipar o prazo" dentro de `acrescimos.observacao`, que vira comentário `[CONFERIR]` no card. Quem muda a data é o dono da demanda.

### Exemplo completo — o caso Orkestria

Áudio `Infra - alinhamento semanal 31.07.m4a`, setor `Infraestrutura`, enviado por `ia02@px.com.br`. O card do Guilherme (`Orkestria — integração com o portal de chamados`) está no setor **B.I.** — cross-setor, o caso literal do requisito 3.

**`Infra - alinhamento semanal 31.07 - Demandas.json`**

```json
{
  "schema": "smart-meet/demandas@1",
  "driveFileId": "1kZq7Yb3nR9pW2xVfT0aDm4Lc",
  "base": "Infra - alinhamento semanal 31.07",
  "geradoEm": "2026-08-03T14:22:10-03:00",
  "gerador": { "skill": "processar-smart-meet", "versaoSkill": "2026-08-03",
               "motor": "smart-meet.mjs", "modeloIA": "claude-opus-5" },
  "transcricao": { "arquivo": "Infra - alinhamento semanal 31.07.md",
                   "truncada": false, "palavras": 8412 },
  "catalogo": { "geradoEm": "2026-08-03T13:58:41.902Z",
                "hash": "sha256:9f2c1ad4e7b0", "totalCards": 137, "origem": "rede" },
  "propostas": [
    {
      "acao": "ajuste",
      "certezaLLM": "alta",
      "assunto": "1. Orkestria — chamado não volta quando o SSO expira",
      "resumo": "Quando o token de SSO expira, o Orkestria não devolve o chamado ao portal e o usuário refaz tudo. Exigido tratar antes de produção.",
      "cardId": "kY8vN2pQzR3tLm1c",
      "refHash": "a1b2c3d4e5f6",
      "cardTituloVisto": "Orkestria — integração com o portal de chamados",
      "evidencia": [
        { "citacao": "o Orkestria não devolve o chamado pro portal quando o SSO expira, aí o cara faz tudo de novo. Isso tem que entrar antes de subir pra produção", "marca": "00:12:40" },
        { "citacao": "isso aí já é a demanda que o Guilherme abriu, não precisa abrir outra", "marca": "00:14:03" }
      ],
      "acrescimos": {
        "descricao": "Tratar expiração de SSO: quando o token expira, o chamado não é devolvido ao portal e o usuário refaz o preenchimento. Correção exigida antes da subida para produção.",
        "tags": ["sso"],
        "checklist": [
          { "text": "Reproduzir expiração de SSO em homologação", "desc": "Cenário: token expira com chamado aberto." },
          { "text": "Garantir reenvio do chamado após renovação de token" }
        ],
        "observacao": "Na reunião foi pedido \"mais duas semanas em cima do que tá lá\" para o prazo, e foi dito que isso trava a subida para produção. [CONFERIR] com o responsável — o Cowork não altera prazo nem prioridade."
      },
      "conferir": ["o prazo não foi dito como data, foi dito como \"duas semanas a mais\""]
    },
    {
      "acao": "nova",
      "certezaLLM": "media",
      "assunto": "2. Licenças do antivírus",
      "resumo": "Levantar licenças ativas do antivírus antes da renovação de setembro.",
      "evidencia": [
        { "citacao": "ninguém sabe quantas licenças ativas a gente tem. Precisa de um levantamento antes da renovação de setembro", "marca": "00:31:05" }
      ],
      "proposta": {
        "title": "Inventário de licenças do antivírus corporativo",
        "description": "Levantar o número de licenças ativas e em uso do antivírus corporativo, com quebra por unidade, antes da renovação contratual de setembro.",
        "type": "relatorio",
        "priority": "media",
        "requester": "Guilherme Souza",
        "requesterSector": "Infraestrutura",
        "tags": ["antivirus", "licencas"],
        "checklist": [
          { "text": "Extrair a lista de endpoints do console do antivírus" },
          { "text": "Cruzar com o inventário de máquinas ativas" }
        ]
      },
      "possivelDuplicataDe": [],
      "conferir": ["responsável não nomeado em voz alta", "prazo não dito — não preenchi"]
    },
    {
      "acao": "nova",
      "certezaLLM": "baixa",
      "assunto": "3. Backup dos servidores do CESIU",
      "resumo": "Backup do CESIU ainda é manual; padronizar rotina.",
      "evidencia": [
        { "citacao": "o backup do CESIU ainda é manual, todo mundo sabe disso", "marca": "00:44:12" }
      ],
      "proposta": {
        "title": "Padronizar rotina de backup dos servidores do CESIU",
        "description": "O backup dos servidores do CESIU é executado manualmente. Definir e automatizar a rotina, com verificação de integridade.",
        "type": "melhoria",
        "priority": "media",
        "requester": null, "requesterSector": null,
        "tags": ["backup", "cesiu"],
        "checklist": []
      },
      "possivelDuplicataDe": ["mB4rT7wYh1nK9sEd"],
      "conferir": ["pode ser o mesmo assunto do card \"Backup — revisar política dos servidores\" (B.I.)"]
    }
  ]
}
```

Repare no que **não** existe no JSON: `sector`, `columnId`, `status`, `assignee`, `due`, `priority` de ajuste, `createdBy`, `meetingId`. Tudo isso o app resolve. O Cowork não define escopo, destino nem prazo.

**Doc `Infra - alinhamento semanal 31.07 - Demandas`** (gerado pelo motor a partir do JSON acima):

```markdown
# Demandas — Infra · alinhamento semanal
Setor da reunião: Infraestrutura · Data: 31/07/2026 · 3 propostas (1 ajuste, 2 novas)

⚠ Isto é uma PROPOSTA. Nada foi criado nem alterado no Kanban.
   Valide em Smart Meet › Demandas.

## 1. Orkestria — chamado não volta quando o SSO expira
► AJUSTE em demanda existente · confiança: calculada no app
   Card: "Orkestria — integração com o portal de chamados" (setor B.I.)

A acrescentar (nada é apagado):
+ descrição: o problema do SSO expirando e a exigência de tratar antes de produção
+ checklist: reproduzir a expiração em homologação · garantir reenvio após renovação
+ tags: sso
+ comentário: pedido de mais duas semanas no prazo [CONFERIR] — o Cowork não altera prazo

> "o Orkestria não devolve o chamado pro portal quando o SSO expira, aí o cara faz
>  tudo de novo. Isso tem que entrar antes de subir pra produção" (~00:12:40)
> "isso aí já é a demanda que o Guilherme abriu, não precisa abrir outra" (~00:14:03)

⚠ [CONFERIR] o prazo não foi dito como data, foi dito como "duas semanas a mais".

## 2. Licenças do antivírus
► NOVA demanda · Relatório · Média
…

## 3. Backup dos servidores do CESIU
► NOVA demanda · Melhoria · Média
⚠ Possível duplicata de "Backup — revisar política dos servidores" (B.I.)
…

---
⚠ Em aberto: falaram em "trocar o storage" sem decidir nada — não virou proposta.
```

---

## Como o Cowork enxerga as demandas existentes

Assimetria deliberada: **lê por HTTP, entrega por Drive.** A leitura precisa ser fresca e pode falhar sem prejuízo; a entrega precisa passar por um canal onde a conta comprovadamente **não consegue apagar** — o Drive Compartilhado onde ele é Colaborador (`canDelete: false`).

### `GET /api/cowork/catalogo`

`src/app/api/cowork/catalogo/route.ts`, `runtime = "nodejs"`. **Só exporta `GET`.**

- **Auth:** `Authorization: Bearer ${COWORK_TOKEN}`, comparado com `crypto.timingSafeEqual`. Segredo **separado** do `CRON_SECRET` — o `CRON_SECRET` dispara escrita, este não. Sem `COWORK_TOKEN` definido a rota devolve **503**, nunca cai em `requireUser`.
- **Query:** `?setores=A,B` (default: todos — a reunião de infra precisa ver o card do B.I.), `?limite=800`.
- **Implementação:** `adminDb().collection("cards").get()` + projeção em memória. Sem índice novo.

Projeção — sai isto e só isto:

```ts
type CatalogoCard = {
  cardId: string; refHash: string;      // sha1(`${cardId}|${norm(titulo)}`).slice(0,12)
  sector: string; columnId: string; colunaTitulo: string;
  titulo: string;
  resumo: string;                       // description truncada em 240
  tipo?: DemandType; priority?: Priority;
  requester: string | null; requesterSector: string | null;
  tags: string[];
  apelidos: string[];                   // DERIVADOS: tags ∪ tokens ≥4 do título fora da stoplist
  checklistAberto: string[];            // texts com done:false, máx 8
  aberto: boolean;                      // columnId !== "concluido"
  rev: number;                          // versão do card, para o CAS do aceite
};
```

Nunca sai: `comments`, `assignee`, `createdBy`, `description` completa, `checklist.desc`, `due`, `startDate`. Resposta traz `{ geradoEm, hash, totalCards, truncado, colunas: {setor: [{colId,title}]} }`. O `hash` volta em `catalogo.hash` no sidecar — proveniência auditável.

**`apelidos` é derivado, não curado.** A revisão adversarial acertou: um campo `card.apelidos` de preenchimento manual não seria preenchido por ninguém, e o desenho passaria a depender de curadoria fantasma. Derivar de título + tags entrega 80% do valor com 0% de disciplina exigida.

### `POST /api/cowork/validar` — dry-run

Mesmo token. Recebe o `demandas.json`, roda **exatamente o mesmo** `validarSidecar()` do ingest e devolve `{ ok, propostas, rejeitadas: [{indice, motivo}] }`. **Zero escrita, zero leitura de card.** Existe por um motivo só: o validador tem **uma cópia** no repositório, testada, em vez de duas cópias divergentes (uma no app, outra no `.mjs`) que ninguém compara.

### Comandos no motor

```
catalogo-demandas [--forcar]     → GET, grava ~/.gcp/sheetstool/_catalogo-demandas.json
varrer-mencoes <catalogo> <transcricao.md> --setor S
    → mencoes.json (casamento léxico EXATO de apelidos com fronteira de palavra, sem fuzzy)
    → catalogo-reuniao.json (podado: setor da reunião + qualquer card mencionado)
validar-demandas <arq.json>      → POST /api/cowork/validar; exit 1 se !ok
```

**Regra de frescor.** Cache < 24 h → usa. Rede falhou e cache ≤ 7 dias → usa, marca `origem: "cache"`, e o subagente fica **proibido de emitir `ajuste`** (só `nova`). Rede falhou e cache > 7 dias ou inexistente → **não gera demandas nesta passada**; transcrição e atas seguem normalmente e o relatório em pt-BR diz por quê.

**O varredor léxico é o que segura o contexto e a qualidade.** 137 demandas viram ~25 linhas no prompt do subagente. E `mencoes.json` é sinal **determinístico**: se ele acusou hit num trecho, o subagente **não pode** classificar aquele assunto como `nova`.

---

## Modelo de dados

### `/demandLotes/{loteId}` — novo
Doc ID: `` `${driveFileId}_r${revisao}` `` → `1kZq7Yb3nR9pW2xVfT0aDm4Lc_r1`

| campo | tipo | notas |
|---|---|---|
| `driveFileId` | string | áudio |
| `revisao` | number | 1, 2… — nova geração, nunca sobrescreve a anterior |
| `meetingId` | string | resolvido pelo servidor via `driveFileId` |
| `sectorReuniao` | string | de `/meetings`, nunca do payload |
| `sidecarFileId`, `sidecarNome`, `sidecarHash` | string | `sidecarHash` = sha256 dos bytes crus |
| `catalogoHash`, `catalogoGeradoEm`, `catalogoOrigem` | | proveniência |
| `gerador` | map | skill/versão/motor/modelo |
| `total`, `pendentes`, `aceitas`, `recusadas`, `obsoletas` | number | `FieldValue.increment` |
| `rejeitadasNoIngest` | `{indice, resumo, motivo}[]` | **guardadas e exibidas na tela**, nunca descartadas |
| `citacoesConferidas` / `citacoesTotal` | number | resultado da conferência agregada |
| `status` | `"pendente"\|"parcial"\|"resolvido"` | derivado dos contadores |
| `supersedidoPor` | string \| null | loteId da revisão seguinte |
| `ingeridoEm` | Timestamp | |

### `/demandPropostas/{propostaId}` — novo
Doc ID: `` `${driveFileId}_r${revisao}_${hashConteudo12}` ``, onde `hashConteudo = sha256(acao + "|" + (cardId ?? norm(title)) + "|" + norm(assunto))`.

**Nunca por posição.** Um ID posicional (`__01`, `__02`) troca o conteúdo de propostas pendentes entre si quando o LLM reordena numa segunda passada — falha silenciosa que corrompe o alvo do ajuste.

| campo | tipo | notas |
|---|---|---|
| `loteId`, `driveFileId`, `meetingId`, `revisao` | | |
| `sectorReuniao` | string | de `/meetings` |
| `sectorAlvo` | string | **`nova` → setor da reunião; `ajuste` → setor do CARD-ALVO** |
| `acao` | `"nova"\|"ajuste"` | |
| `assunto`, `resumo` | string | |
| `certezaLLM` | `"alta"\|"media"\|"baixa"` | teto |
| `confianca` | `"alta"\|"media"\|"baixa"` | **calculada no servidor** (fórmula abaixo) |
| `sinais` | map | `{ lexico: bool, citacoesConferidas: n, drift: bool, catalogoCache: bool }` |
| `evidencia` | `{citacao, marca, conferida}[]` | |
| `conferir` | string[] | |
| `proposta` | map \| null | só `nova` |
| `possivelDuplicataDe` | string[] | |
| `cardId`, `cardTituloVisto`, `refHash` | string \| null | só `ajuste` |
| `targetCardRev` | number \| null | **snapshot de `card.rev` no ingest — base do CAS** |
| `acrescimos` | map \| null | `{descricao, tags[], checklist[], observacao}` |
| `anexos` | `{kind, name, link}[]` | copiado de `meeting.driveOutputs` pelo app |
| `similarARecusada` | `{propostaId, em}` \| null | **sinaliza, nunca descarta** |
| `status` | `"pendente"\|"aceita"\|"recusada"\|"obsoleta"` | **único campo mutável** |
| `decisao` | map \| null | `{por, em, motivo, nota, cardIdResultante, camposEditados[], deltaAplicado}` |
| `origem` | `"cowork"` | literal |
| `criadoEm` | Timestamp | |

**Fórmula da confiança (`src/lib/server/demand-confianca.ts`):**
```ts
if (acao === "nova" && sinais.lexico) return "baixa";     // provável duplicata
if (sinais.drift) return "baixa";                          // título mudou desde o catálogo
if (sinais.catalogoCache) return "baixa";
const pts = (sinais.lexico ? 2 : 0) + (acao === "nova" ? 1 : 0);
const bruta = pts >= 3 ? "alta" : pts >= 1 ? "media" : "baixa";
return min(bruta, certezaLLM);        // certezaLLM é TETO, nunca piso
```
**Citação conferida vale zero ponto positivo.** Ela só *rebaixa*: se **nenhuma** citação do lote casar com a transcrição exportada, o lote inteiro é rejeitado (é o sintoma de "ata da conversa errada"). Conferência **agregada e normalizada** — `norm()` (NFD, sem diacríticos, minúsculas, não-alfanuméricos colapsados) com tolerância de ≥80% dos tokens em sequência, porque a própria skill manda o subagente **corrigir grafias** pelo `[[Conhecimento]]` ("orquestria" → "Orkestria") e um `includes` cru reprovaria justamente as propostas certas.

### `/cards` — aditivo
```ts
// src/lib/kanban.ts, type Card
rev?: number;                 // incrementa em TODA escrita, inclusive a do modal — base do CAS
updatedAt?: number;
updatedBy?: string;
origem?: "humano" | "cowork"; // ausente = humano (histórico compatível)
propostaId?: string;
meetingIds?: string[];        // arrayUnion
```
### `/cards/{cardId}/reunioes/{meetingId}` — subcoleção nova
`{ meetingId, title, date, sector, anexos: [{kind,name,link}], vinculadoPor, vinculadoEm, propostaId }`

Em subcoleção, e não em array no card, por dois motivos concretos: (a) `arrayUnion` de objeto com `at: Date.now()` duplica a cada aceite porque o timestamp difere; (b) um card citado em 20 reuniões acumularia dezenas de KB no doc, engordando a janela de last-write-wins e caminhando para o limite de 1 MiB, que congelaria **todas** as escritas no card.

### `/logs/{autoId}` — passa a ser escrita de verdade
`{ at, escopo:"demandas", acao, actor, sectorAlvo, loteId?, propostaId?, cardId?, meetingId?, antes, depois, detalhe }`
`acao ∈ { lote.ingerido, lote.rejeitado, proposta.criada, proposta.rejeitada, proposta.aceita, proposta.recusada, proposta.obsoleta, card.criado, card.ajustado, card.revertido }`. Escrita **exclusivamente** pelo Admin SDK, dentro da mesma transação.

### `/meetings` — três campos novos
`demandasIngest: { loteId, revisao, at, total, rejeitadas } | null` · `demandasSidecarAusenteEm: number | null` · `demandasTentativas: number`

### `firestore.indexes.json` (hoje vazio)
| coleção | campos |
|---|---|
| `demandPropostas` | `sectorAlvo` ASC, `status` ASC, `criadoEm` DESC |
| `demandPropostas` | `sectorReuniao` ASC, `status` ASC, `criadoEm` DESC |
| `demandPropostas` | `loteId` ASC, `criadoEm` ASC |
| `demandPropostas` | `cardId` ASC, `criadoEm` DESC |
| `demandLotes` | `sectorReuniao` ASC, `ingeridoEm` DESC |
| `logs` | `cardId` ASC, `at` DESC |

---

## As travas de segurança

| # | Trava | Qual risco ela mata |
|---|---|---|
| 1 | O Cowork não tem credencial do Firestore, e o único canal de entrega é depositar arquivo num Drive onde a conta é Colaborador (`canDelete: false`) | Cowork apagar ou alterar dado do banco — impossibilidade **estrutural**, não configurada. Vazar o `COWORK_TOKEN` vaza leitura, zero escrita |
| 2 | `COWORK_TOKEN` ≠ `CRON_SECRET`, `timingSafeEqual`, rota só exporta `GET` (e a de validar não escreve nada) | Escalada de leitura para escrita por reuso de segredo |
| 3 | Gramática sem `remover` e sem `substituir`; `acrescimos` só faz append/arrayUnion | Perda de informação por ajuste; e troca de prazo/prioridade/responsável derivada de erro de ASR |
| 4 | `sectorAlvo`, `meetingId`, `columnId`, `createdBy`, `order`, `enteredAt` são resolvidos pelo servidor; chave desconhecida no payload é descartada e logada | Cowork escolher escopo, destino ou autoria |
| 5 | Ingest escreve **só** em `/demandLotes`, `/demandPropostas`, `/logs` e em 3 campos de `/meetings`, sempre com `tx.create` de ID determinístico | Ingest tocar `/cards` direta ou acidentalmente; duplicata literal (`ALREADY_EXISTS`) |
| 6 | `scripts/check-demandas-boundary.mjs` no `prebuild`: falha o build se `demand-ingest.ts` contiver `"cards"`, `.delete(`, `deleteDoc` ou `FieldValue.delete` | Regressão futura que fure a trava 5 sem ninguém notar em code review |
| 7 | `confianca` calculada no servidor com `certezaLLM` como **teto**; citação conferida **só rebaixa** | O modelo desligar a própria fricção declarando "alta" em tudo; e a evidência circular (citação verdadeira de uma transcrição errada aumentando a confiança) |
| 8 | `refHash` recalculado no ingest; divergência → `drift: true` → `confianca: baixa` | O modelo pegar o `cardId` de uma linha e o título de outra; e o card ter mudado entre o catálogo e o ingest |
| 9 | `cardId` inexistente, fora do catálogo ou sem hit léxico em cross-setor **não é descartado**: vira `nova` com o motivo escrito, e a tela mostra "N rejeitadas no ingest — ver motivo" | Proposta sumir em silêncio; o Doc anexado no e-mail prometer 3 e a fila mostrar 2 |
| 10 | Conferência agregada: **zero** citações casando → lote inteiro rejeitado com log | Ata da conversa errada (colisão de nome sanitizado no `transcrever.py`) virar cards no setor errado |
| 11 | Motor aborta com exit 1 se a transcrição contiver `[⚠️ trecho não transcrito]` | Demandas da segunda metade da reunião não existirem, sem nenhum sintoma, por cota do Gemini estourada |
| 12 | `marcar-transcrito` exige o `.json` **quando o Doc `- Demandas` existir** (mas Demandas continua **fora** dos obrigatórios) | Falha parcial: Doc no e-mail sem payload; e travar para sempre reunião que legitimamente não gerou demanda |
| 13 | `demandasIngest` só é gravado quando o sidecar foi **baixado e parseado**; ausente grava `demandasSidecarAusenteEm` e mantém a reunião elegível por 14 dias / 20 tentativas | "Sidecar ausente" ser confundido com "sidecar não existe" e queimar o lote para sempre |
| 14 | Sidecar buscado por **query direta** no Drive (`name = '<base> - Demandas.json' and '<pasta>' in parents`), além do `listFolder` paginado | O `pageSize: 200` sem `nextPageToken` fazer o sidecar e as atas sumirem em silêncio a partir de ~35 reuniões por pasta |
| 15 | `card.rev` incrementa em **toda** escrita (inclusive a do modal); a proposta guarda `targetCardRev`; o aceite responde **409 "a demanda mudou — reveja o diff"** | O aceite escrever por cima de edição concorrente, ou ser apagado por ela |
| 16 | `updateCard` deixa de enviar o objeto inteiro: só campos sujos, e `tags`/`checklist` por `arrayUnion`/`arrayRemove` com match por `id` | O modal do Kanban aberto às 14h apagar, às 14h05, tudo o que o aceite escreveu — deixando o card carimbado "veio da reunião X" e sem uma linha dela |
| 17 | **Não existe undo automático.** Existe *reversão guiada*: mostra o delta e o valor anterior, aplica campo a campo só se o valor atual for idêntico ao gravado no aceite. **Nunca chama `delete` em `/cards`** | O botão de segurança virar o único vetor de exclusão de card, apagando trabalho que outra pessoa fez nos 10 minutos seguintes |
| 18 | Aceite em lote existe **só para `acao: "nova"`**, máximo 10, gate lendo a confiança **do servidor** | Multiplicar um ajuste alucinado por uma leva inteira sobre trabalho de terceiros |
| 19 | Transação de aceite lê `/columns` do `sectorAlvo` e **falha com mensagem** se estiver vazia; faixa no Kanban lista cards com `columnId` órfão | Card criado com `columnId` inexistente: existe no Firestore, `status: aceita`, e não aparece em coluna nenhuma |
| 20 | Todo ajuste aceito grava um `Comment` (`arrayUnion`, canal que a UI já renderiza) com o de/para e o link da ata, **e dispara e-mail ao `assignee`** | O dono da demanda descobrir a mudança por acaso, sem distinguir alucinação de decisão do gestor |
| 21 | Reprocessamento cria **revisão n+1**; pendentes da revisão anterior viram `obsoleta`; decididas são imutáveis | Sobrescrita de proposta pendente; e proposta gerada de transcrição truncada continuar aceitável depois da correção |
| 22 | `similarARecusada` sinaliza e recolhe na UI, mas **nunca descarta** | Colisão de fingerprint sobre título gerado por LLM sumir com uma proposta legítima |
| 23 | Bloqueio de `deleteMeetingById` enquanto houver proposta `pendente` do lote | Lote e propostas órfãos: a tela de validação perde título, data e links e o humano decide no escuro |
| 24 | Rules: `/demandPropostas` e `/demandLotes` `read: isAuthorized(); write: if false`; `/logs` `create: if false` | Cliente forjar proposta ou auditoria |
| 25 | Rules de `/cards` com escopo de setor, split create/update/delete, `sector`/`createdBy` imutáveis, campos de proveniência (`origem`, `propostaId`, `meetingIds`, `rev`) não graváveis pelo cliente, `delete: if isGestorOrAdmin()` | **O buraco de hoje:** qualquer operador ativo apaga todos os cards de todos os setores pelo console, sem log |
| 26 | `gcloud firestore export` diário para bucket com retenção de 30 dias | Não existir ponto de restauração para nenhum erro — nem do Cowork, nem humano, nem de script |
| 27 | Guarda no ramo `isAguardando` do sync: nunca gravar `driveOutputs` vazio por cima de não-vazio; e `status` sai do payload do modal de reunião | Bug atual: rollback de status pelo modal faz o sync apagar os links da ata, sem reenviar e-mail |
| 28 | Tetos: sidecar ≤ 200 KB, 5 propostas/lote (v1), 3 citações/proposta, 2000 chars de append, 5 tags, 5 itens de checklist, 3 revisões/reunião, `maxDuration = 300` na rota de sync, cota por lista no `targets` (round-robin, não concatenação) | Payload inflado; e `semDemandas` ser sempre a primeira a ser cortada pelo `BATCH_LIMIT = 60` |

---

## Reunião com vários projetos

É o caso normal, não a exceção.

- Um lote, **N propostas independentes**, cada uma com seu doc, seu `sectorAlvo`, seu `status` e sua transação. Aceitar 2, recusar 1 e deixar 2 pendentes é um estado válido; o lote fica `parcial` e só vira `resolvido` com `pendentes === 0`.
- Mistura livre de `nova` e `ajuste` — o exemplo Orkestria é literalmente 1 ajuste + 2 novas.
- **Cross-setor funciona.** `sectorAlvo` vem do **card-alvo**, não da reunião. No exemplo: a proposta 1 tem `sectorReuniao: "Infraestrutura"` e `sectorAlvo: "B.I."`. Ela aparece nas **duas** filas. Quem **decide** é do `sectorAlvo` (ou admin). Quem é do `sectorReuniao` vê em modo leitura, com dois botões ativos: **trocar alvo** e **recusar** — porque ele é quem tem o contexto do áudio.
- **Trava contra espalhar ruído por 8 setores:** o Cowork só pode emitir `ajuste` cross-setor quando o `varrer-mencoes` acusou hit léxico daquele card. Sem hit determinístico, cross-setor é rejeitado no ingest e degradado para `nova` + `possivelDuplicataDe`, com o motivo visível.
- Todas as propostas do lote recebem os mesmos `anexos` (ata, transcrição, pontos importantes). O card antigo do Guilherme e o card novo do antivírus ficam ambos ligados à mesma reunião, cada um pela sua entrada em `/cards/{id}/reunioes/{meetingId}`.
- Um card acumula reuniões: três reuniões sobre o Orkestria = três docs na subcoleção, três blocos datados na descrição, **um card só**.
- A UI agrupa por `assunto` (o bloco da ata, que é como a reunião foi falada) e ordena `ajuste` antes de `nova` — decidir "isto já existe" muda a decisão seguinte.

---

## O que muda no app

### Arquivos NOVOS

| Arquivo | O que fazer |
|---|---|
| `src/lib/drive-outputs.ts` | **Fonte única** de `DriveOutputKind` (com `"demandas"`), `DRIVE_OUTPUT_LABEL`, `DRIVE_OUTPUT_ORDER`, `OUTPUT_ICON`, `classifyOutput(suffix)` com o ramo `demanda` **antes** de `ponto\|importante\|resumo`. Hoje isso está duplicado em 5 arquivos |
| `src/lib/demandas-schema.ts` | `validarSidecar(raw)`, `CAMPOS_ACRESCIMO`, `norm()`, `hashConteudo()`, tipos. **Isomórfico** (sem import de servidor). Cópia única — o motor consome via `/api/cowork/validar` |
| `src/lib/demandas-schema.test.ts` | Vitest: enums fechados, tetos, chave desconhecida descartada, `truncada:true` rejeita, `schema` errado rejeita |
| `src/lib/server/demand-confianca.ts` | `calcularConfianca(sinais, certezaLLM)`, `conferirCitacoes(transcricaoTxt, citacoes)` |
| `src/lib/server/demand-confianca.test.ts` | Vitest: `certezaLLM` como teto, drift → baixa, `nova` + léxico → baixa |
| `src/lib/server/demand-ingest.ts` | `ingestDemandas(args)`, `acharSidecar()` (query direta + fallback na listagem), `resolverRevisao()`, `montarProposta()`. **Nenhum import de delete, nenhuma menção a `cards` fora de `.get()`** |
| `src/lib/server/demand-decide.ts` | `aceitar()`, `recusar()`, `trocarAlvo()`, `converterEmAjuste()`, `reverterGuiado()`. **Único módulo do servidor que escreve em `/cards`** |
| `src/lib/server/demand-decide.test.ts` | Vitest: CAS falha com 409, append nunca substitui, coluna vazia falha, dupla decisão falha |
| `src/lib/server/catalogo.ts` | `buildCatalogo(setores)`, `refHash()`, `apelidosDoCard()`, `norm()` |
| `src/lib/server/audit.ts` | `registrarLog(tx, entrada)` — `/logs` passa a ser escrita |
| `src/lib/demandas.ts` | Cliente, **somente leitura**: `subscribeDemandPropostas(setores, status)`, `subscribeDemandLote(loteId)`, `subscribePropostasDoCard(cardId)` |
| `src/app/api/cowork/catalogo/route.ts` | `GET`, `COWORK_TOKEN`, 503 sem env |
| `src/app/api/cowork/validar/route.ts` | `POST` dry-run, mesmo token, zero escrita |
| `src/app/api/demandas/decidir/route.ts` | `POST`, `requireUser` + `admin \|\| sectors.includes(sectorAlvo)` |
| `src/app/api/demandas/decidir-lote/route.ts` | `POST`, só `acao: "nova"`, máx 10, gate na confiança do servidor |
| `src/app/api/demandas/reverter/route.ts` | `POST`, reversão guiada campo a campo com CAS |
| `src/app/(app)/demandas/page.tsx` + `demandas.module.css` | Tela de validação: duas colunas sem modal, agrupada por `assunto`, evidência sticky à direita, diff **só em verde**, teclado `J/K/A/R/E` |
| `scripts/check-demandas-boundary.mjs` | Falha o build se `demand-ingest.ts` mencionar `cards`/`delete` |
| `scripts/firestore-export.sh` | `gcloud firestore export gs://smart-meet-backup/$(date +%F)` — no cron da Vercel ou no Cloud Scheduler |

### Arquivos ALTERADOS

| Arquivo | O que fazer |
|---|---|
| `src/lib/kanban.ts` | (a) `updateCard` recebe patch **parcial** e carimba `rev: increment(1)`, `updatedAt`, `updatedBy`; (b) novas `addTags`/`removeTags`/`upsertChecklistItem` com `arrayUnion`/`arrayRemove` por `id`; (c) `Card` ganha `rev`, `updatedAt`, `updatedBy`, `origem`, `propostaId`, `meetingIds`; (d) `deleteCardById` vira soft delete (`deletedAt`) e `subscribeCards` filtra |
| `src/app/(app)/kanban/page.tsx` | (a) `submit()` para de enviar os 12 campos inteiros — dirty tracking sobre os `useState`, só o que mudou; (b) checklist e tags por operação incremental; (c) bloco "Reuniões que citaram esta demanda" lendo a subcoleção; (d) badge "N sugestões" com link para `/demandas?card=<id>`; (e) faixa "N demandas em coluna inexistente — realocar" |
| `src/app/api/drive/sync/route.ts` | (a) importar `classifyOutput` do módulo único; (b) `if (f.mimeType === "application/json") continue;` no `collectOutputs`; (c) `MARKER` ancorado no fim: `/[\s\-–—]*transcrito\s*$/i`; (d) guarda de outputs vazio no ramo `isAguardando`; (e) **lista (4) `semDemandas`** vinda do mesmo `procSnap`; (f) `targets` com dedupe por `doc.id` e **cota por lista** em vez de concatenação; (g) chamada a `ingestDemandas` em `try/catch` isolado depois do e-mail; (h) `export const maxDuration = 300`; (i) `console.warn` ruidoso e campo no retorno quando `DEMANDAS_START_AT` estiver ausente ou inválido |
| `src/lib/server/drive-server.ts` | (a) **paginar `listFolder`** com `nextPageToken` e pedir `size` nos `fields` — P0, sem isso tudo falha mudo; (b) `downloadFile(token, fileId, maxBytes)` (`alt=media`), que hoje não existe; (c) `findInFolder(token, folderId, name)` para a query direta do sidecar |
| `src/lib/meetings.ts` | Reexportar `DriveOutputKind` do módulo único; `Meeting` ganha `demandasIngest`, `demandasSidecarAusenteEm`, `demandasTentativas`; `OutputKind` ganha `"demandas"` |
| `src/lib/server/notify.ts` | Importar `LABEL`/`ORDER` do módulo único (com `demandas` em `ORDER`, senão `indexOf` devolve `-1` e o anexo sobe para o topo); linha nova no e-mail: "3 demandas propostas — 1 ajuste, 2 novas [Revisar]"; **função nova** `notificarResponsavel()` para o e-mail ao `assignee` |
| `src/app/(app)/reunioes/page.tsx` | `OUTPUT_ICON` do módulo único; **tirar `status` do payload do `save()` (linha 1069)**; badge "3 demandas a validar"; aviso "sem arquivo de demandas" quando `demandasSidecarAusenteEm` |
| `src/app/(app)/relatorios/page.tsx` | `OUTPUT_ICON` do módulo único; trocar o placeholder "💡 Na Fase 4…" (linha ~206) pelo botão real |
| `src/lib/server/drive-server.ts` (rename) → `src/app/api/drive/rename/route.ts` | Tornar `sector` **obrigatório** — hoje, omitindo-o, qualquer usuário ativo renomeia qualquer arquivo alcançável pela SA, e rename é exatamente o que quebra o contrato de nomes do qual tudo isto depende |
| `src/app/api/dev-mail-test/route.ts` | **Apagar.** Em build não-production ela lê pasta arbitrária do Drive e dispara e-mail para destinatário arbitrário, sem autenticação |
| `src/lib/meetings.ts` (`deleteMeetingById`) | Bloquear quando houver proposta `pendente` do lote |
| `firestore.rules` | Blocos `/demandPropostas`, `/demandLotes` (`write: if false`); `/logs` `create: if false`; **`/cards` endurecido**; `match` que faltam para `/solicitantes` e `/solicitanteSetores` (hoje caem no catch-all `if false`) |
| `firestore.indexes.json` | Os 6 índices |
| `package.json` | `vitest` + `"test"`; `"prebuild": "node scripts/check-demandas-boundary.mjs"`; `"rules": "firebase deploy --only firestore:rules,firestore:indexes"` |
| Env (Vercel) | `COWORK_TOKEN`, `DEMANDAS_START_AT` |

**Rules de `/cards` — a mudança que precede tudo:**
```
function podeSetor(s) { return isAdmin() || (isActive() && s in profile().sectors); }
match /cards/{doc} {
  allow read:   if isAuthorized();
  allow create: if isAuthorized() && podeSetor(request.resource.data.sector)
                && request.resource.data.createdBy == userEmail()
                && !request.resource.data.keys()
                     .hasAny(['origem','propostaId','meetingIds','rev']);
  allow update: if isAuthorized() && podeSetor(resource.data.sector)
                && request.resource.data.sector == resource.data.sector
                && request.resource.data.createdBy == resource.data.createdBy
                && !request.resource.data.diff(resource.data).affectedKeys()
                     .hasAny(['origem','propostaId','meetingIds','createdAt']);
  allow delete: if isGestorOrAdmin() && podeSetor(resource.data.sector);
}
```

---

## O que muda no Cowork

### Motor `~/.gcp/sheetstool/smart-meet.mjs`

| Onde | O quê |
|---|---|
| `classifyApp()` (linha ~87) | Ramo `if (s.includes('demanda')) return 'demandas';` **antes** dos demais |
| `collectOutputsApp()` (linha ~104) | `if (f.mimeType === 'application/json') continue;` — o espelho tem que continuar errando igual ao app |
| `resolverGerar()` (linha ~180) | `demandas: gerarTudo \|\| tem('demandas')` |
| `marcarTranscrito()` (linha ~519) | `obrigatorios` **inalterado** (`Transcrição` + `Pontos importantes`). **Duas travas novas:** (a) se existe Doc `<base> - Demandas`, exigir `<base> - Demandas.json` ao lado; (b) se a transcrição contiver `[⚠️ trecho não transcrito]`, exit 1 |
| `listarPendentes()` | Campo novo `demandasNoDrive` (sidecar já subiu?) |
| **`catalogo-demandas [--forcar]`** | `GET /api/cowork/catalogo`, cache em `_catalogo-demandas.json`, regra de frescor 24h/7d |
| **`varrer-mencoes <cat> <transcr.md> --setor S`** | Casamento léxico exato de apelidos com fronteira de palavra, `norm()` **cópia literal** do app. Emite `mencoes.json` + `catalogo-reuniao.json` podado |
| **`conferir-transcricao <arq.md>`** | Grep de `[⚠️ trecho não transcrito]`; exit 1 se achar |
| **`validar-demandas <arq.json>`** | `POST /api/cowork/validar`; imprime `{ok, rejeitadas}`; exit 1 se `!ok` |
| **`demandas-doc <json> <saida.md>`** | Renderiza o Doc a partir do JSON. Determinístico, sem LLM |
| **`subir-json <pastaId> "<nome>.json" <arq>`** | Upsert: exige ` - ` no nome, exige `.json`, recusa se o existente não for `application/json`, sobe com `Content-Type: application/json` sem converter para Doc |
| Env | `SMART_MEET_COWORK_TOKEN` (junto de `SMART_MEET_APP_URL` / `SMART_MEET_CRON_SECRET`) |

### Skill `Cowork/Skills/processar-smart-meet.md`

- Tabela "Os arquivos a gerar" ganha `<base> - Demandas` e `<base> - Demandas.json`, ambos marcados **"só se houver proposta"**.
- **Passo 2.5** — `catalogo-demandas` + a regra de frescor.
- **Passo 2.7** — `conferir-transcricao` e `varrer-mencoes` **antes** do subagente.
- **Passo 4** — `validar-demandas` → `demandas-doc` → `subir-doc` → `subir-json`, nesta ordem.
- **Passo 6** — o relatório ganha "Demandas: N novas / N ajustes / 0 é resultado válido".
- **"O que NUNCA fazer"** ganha: ❌ propor `ajuste` com catálogo em cache velho · ❌ propor `ajuste` cross-setor sem hit em `mencoes.json` · ❌ inventar `cardId` ou `refHash` · ❌ incluir Demandas nos obrigatórios do `marcar-transcrito` · ❌ escrever o Doc à mão em vez de renderizar do JSON · ❌ dizer ao Ítalo que "a demanda foi criada" — ela foi **proposta**.

### `Cowork/Prompts/Demandas.md` (novo)

Espelho do `Pontos Importantes.md`. Contrato do JSON + regras duras:
- **Regra de ouro:** só vira proposta o bloco da ata que tem `✓ Decisão:` ou `→` encaminhamento. *Se não há decisão nem pedido explícito, não é demanda — é conversa.* **Zero propostas é resultado de sucesso.**
- Toda proposta precisa de ≥1 citação **literal** da transcrição.
- `cardId` e `refHash` só podem ser **copiados verbatim** de uma linha do catálogo que está na sua janela.
- Trecho com hit em `mencoes.json` **não pode** virar `nova` — ou é `ajuste`, ou você reporta em `possivelDuplicataDe`.
- Nunca inventar responsável, prazo ou prioridade. O que foi dito sobre isso vai como texto em `acrescimos.observacao` com `[CONFERIR]`.
- `certezaLLM: "alta"` só quando o assunto foi nomeado explicitamente e bate com o título do card.

### Prompt do subagente (linhas 171-220)

Recebe: caminho da transcrição, `mencoes.json`, `catalogo-reuniao.json`, setor, data, `[[Conhecimento]]`. Grava um 4º arquivo, `demandas.json`, em `<pastaTrabalho>`. O resumo devolvido ganha `nº novas | nº ajustes | cardIds citados`.

---

## Ordem de implementação

### Fase 0 — Fundação (nada de demandas; entrega valor sozinha)
1. `firestore.rules`: `/cards` escopado + split create/update/delete, `/meetings` idem, `/logs` `create: if false`, `match` de `/solicitantes` e `/solicitanteSetores`. Script `npm run rules`.
2. `gcloud firestore export` diário, retenção 30 dias.
3. `listFolder` paginado + `downloadFile` + `findInFolder`.
4. `updateCard` com patch parcial + `rev` + `arrayUnion/arrayRemove`; `submit()` do modal com dirty tracking; `deleteCardById` soft.
5. Guarda de `driveOutputs` vazio; `status` fora do payload do modal de reunião; `MARKER` ancorado.
6. `sector` obrigatório no `/api/drive/rename`; apagar `dev-mail-test`.
7. Vitest instalado; `src/lib/drive-outputs.ts` com fonte única.

**Por que primeiro:** hoje um operador apaga todos os cards de todos os setores pelo console, sem log e sem backup, e o modal do Kanban perde edição concorrente. Isso é maior que qualquer coisa que o Cowork possa causar. **Se só a Fase 0 for construída, o app já fica melhor.**

### Fase 1 — Ver e propor NOVAS (menor coisa útil e segura)
`GET /api/cowork/catalogo` · sidecar **só com `acao: "nova"`**, teto 5 · ingest pull na lista (4) · `/demandas` com fila simples, evidência e Aceitar/Recusar um a um · `decision.motivo` e `camposEditados` gravados **desde o primeiro lote**.

Sem `ajuste`, sem cross-setor, sem aceite em lote, sem varredor léxico. Zero risco sobre dado existente: o pior caso é um card novo que ninguém queria, e um card novo é ruído removível.

### Fase 2 — Vínculo (`ajuste` aditivo)
`varrer-mencoes` · `refHash` · `calcularConfianca()` no servidor · `acrescimos` append-only · cross-setor com evidência léxica obrigatória · CAS por `card.rev` · subcoleção `/cards/{id}/reunioes` · comentário automático + e-mail ao `assignee` · **trocar alvo** e **converter recusa "já existe" em ajuste**.

**Gate para entrar na Fase 2:** a taxa de recusa da Fase 1 medida. Se o Cowork estiver errando o suficiente para o humano recusar mais de ~40% das `nova`, `ajuste` não entra — o problema é o gerador, não a esteira.

### Fase 3 — Escala e ergonomia
Teclado `J/K/A/R/E` · aceite em lote **só de `nova`** com gate na confiança do servidor · reversão guiada · reprocessamento por revisão · expiração de pendentes com 60 dias · badge no card do Kanban.

**Gate para liberar o aceite em lote:** `camposEditados` mostrando taxa de troca de alvo abaixo de 25%.

---

## Decisões que dependem do Ítalo

1. **"Toda reunião deve gerar demandas" — uma reunião sem decisão nenhuma pode gerar zero propostas?**
   *Recomendo: sim.* O artefato sempre existe; o conteúdo pode ser vazio. Forçar produção transforma a fila em ruído, e a resposta humana ao ruído não é revisar melhor — é aceitar em bloco ou parar de abrir a tela. Aí a blindagem inteira vira teatro.

2. **Cross-setor: quem decide a proposta que ajusta um card de outro setor?**
   *Recomendo: quem é do setor do card-alvo, ou admin.* Quem é do setor da reunião vê tudo e pode **trocar alvo** ou **recusar** (ele tem o contexto do áudio), mas não aceita. O dado atravessa o setor; a permissão não.

3. **O Cowork pode sugerir prazo, prioridade e responsável?**
   *Recomendo: não na v1.* Vira texto num comentário `[CONFERIR]`. São os campos que o ASR mais erra e onde a citação verificada mais engana. Se depois de 2 meses a taxa de acerto justificar, reabrimos como `sugestao` com clique campo a campo.

4. **Teto de propostas por reunião.**
   *Recomendo: 5 na Fase 1, 12 a partir da Fase 2.* Uma reunião que gere 12 propostas custa 25-40 minutos de revisão — mais caro que criar os cards à mão a partir do `Pontos importantes`, que já chega pronto no e-mail. O excedente entra em `rejeitadasNoIngest` e aparece no Doc.

5. **Quem vê a fila de validação?**
   *Recomendo: admin (tudo) + gestor/operador do `sectorAlvo` (decide) + quem enviou o áudio (vê e pode trocar alvo/recusar).*

6. **Campo `card.apelidos` com curadoria manual?**
   *Recomendo: não criar.* Apelidos derivados de título + tags automaticamente. Um campo que depende de disciplina de preenchimento não vai ser preenchido, e o desenho passaria a depender de algo que não acontece.

7. **Backup do Firestore (bucket + retenção 30 dias).**
   *Recomendo: sim, e antes de tudo.* É uma linha de cron e é o único mecanismo que torna qualquer erro — do Cowork, humano ou de script — reversível.

8. **Aceite em lote (o botão "aceitar as N de confiança alta").**
   *Recomendo: só a partir da Fase 3, só para `acao: "nova"`, com o número calculado no servidor.* Três cards novos errados são ruído; três ajustes errados mexem no trabalho de outras pessoas.

9. **`/api/dev-mail-test`.**
   *Recomendo: apagar.* É uma rota sem `requireUser` que, em qualquer build não-production, lê pasta arbitrária do Drive e envia e-mail para destinatário arbitrário.

---

## O que este desenho NÃO resolve

- **O Cowork continua rodando à mão, na máquina do Ítalo, com token OAuth local.** Notebook desligado = nenhuma reunião processada. Não há serviço, fila nem retry. O único ganho aqui é que, uma vez que o sidecar suba ao Drive, o app se vira sozinho.
- **Latência.** Plano Hobby permite um cron por dia (6h). Sem ninguém com a aba Reuniões aberta, e sem `avisar-app`, a proposta pode levar até 24h para aparecer.
- **Custo e cota do Gemini.** ~R$ 3,50 por transcrição, ~30 requisições/dia no `gemini-2.5-pro`. O desenho detecta transcrição truncada e aborta, mas não a evita.
- **Sem diarização.** Participantes só entram se nomeados em voz alta — decisão anterior do Ítalo, mantida.
- **A qualidade do vínculo continua probabilística.** O varredor léxico só acha o que está no título ou nas tags. Um projeto chamado na reunião só por apelido não cadastrado ("o painel do reitor") não produz hit, e o subagente vai propor `nova`. A duplicata aparece na fila e o humano decide — mas duas reuniões sobre o mesmo assunto novo, com semanas de intervalo, geram duas propostas `nova` e nada além do olho humano as liga.
- **Duplicata entre setores distantes.** `possivelDuplicataDe` depende de o subagente ter visto o card no catálogo podado, e a poda usa o mesmo sinal léxico que pode ter falhado.
- **`/logs` é legível só por gestor e admin.** O dono de um card que teve a descrição alterada vê o comentário automático, mas não o histórico completo. Dar leitura de log ao dono do card fica para depois.
- **O formulário da fila é uma segunda implementação do formulário do card.** O modal do Kanban vive dentro de `src/app/(app)/kanban/page.tsx` (1379 linhas) e não é componente — "reaproveitar" é copiar. Extrair `CardForm` é dívida assumida, não paga nesta entrega.
- **O CAS transforma perda silenciosa em erro visível, não em ausência de conflito.** Se alguém salvar o card entre o ingest e o aceite, o validador recebe 409 e revisa o diff de novo. É o comportamento certo, mas é atrito real.
- **Toda a autorização de escrita em card passa a viver em TypeScript rodando com Admin SDK, que ignora as rules do Firestore.** Os testes de `demand-decide.ts` e `demandas-schema.ts` são a única coisa entre um `if` errado e o banco. Por isso vitest está na Fase 0, não na Fase 3.