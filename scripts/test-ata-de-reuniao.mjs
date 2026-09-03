/**
 * A ata montada a partir do documento que o processamento da reunião gerou.
 *
 * Importa o `.ts` de verdade pelo strip de tipos nativo do Node — sem cópia,
 * sem build, como os outros testes da casa. Roda no `prebuild`, que é o portão
 * do deploy.
 *
 * AS DUAS AMOSTRAS SÃO REAIS, copiadas dos documentos que o Cowork produziu, e
 * é isso que dá valor a este arquivo. Um gabarito inventado por quem escreve o
 * parser concorda com o parser por construção; o que se quer saber é se ele
 * concorda com o que o Cowork de fato emite. Elas foram escolhidas para cobrir
 * o que varia entre documentos:
 *
 *   - CANTINAS: bullets dentro de blockquote (`> * `), que é o que sobra depois
 *     da viagem Markdown → Google Doc → export; duas decisões no mesmo bloco;
 *     "Responsável a definir:"; `[CONFERIR prazo]` no meio de um encaminhamento;
 *     "Outros pontos" e "⚠ Em aberto" sem cabeçalho `##` nem sentinela.
 *   - BOLETIM: `[CONFERIR data]` grudado na data; a segunda forma da linha de
 *     citados ("Participantes não identificados no áudio (citados na conversa:
 *     …)"); e a linha "Relacionados:" do vault do Cowork, que não é conteúdo.
 *
 * Quando o prompt do Cowork mudar, é aqui que se descobre.
 */
import {
  blocoParaItem,
  lerPontosImportantes,
  ligarCards,
  montarAtaDaReuniao,
} from "../src/lib/ata-de-reuniao-core.ts";
import { estadoNaAta, montarPauta, resumoDaAta } from "../src/lib/ata-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

/** A árvore das Cantinas, como `semear-cantinas.mjs` a criou. */
const DIMS = [
  {
    id: "d1",
    nome: "D1 · Cadeia de suprimentos",
    ordem: 0,
    subs: [
      { id: "1", nome: "Estoque" },
      { id: "2", nome: "Compras" },
      { id: "3", nome: "Transporte" },
      { id: "4", nome: "Patrimônio" },
    ],
  },
  {
    id: "d3",
    nome: "D3 · Cardápio, comunicação e eventos",
    ordem: 2,
    subs: [
      { id: "1", nome: "Engenharia de cardápio" },
      { id: "2", nome: "Comunicação" },
      { id: "3", nome: "Eventos" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Amostra 1 — "Dimensões cantinas", 26/08/2026. É a ata que originou esta tela.
// ---------------------------------------------------------------------------
const CANTINAS = `# Cantinas — Estruturação da reunião por dimensões
26/08/2026 · ~1h26 · Citados na conversa: Murilo Brasil, Adeline Freitas, Filipe Frota, Ítalo Araújo, José Ivan Brito, Nívea [CONFERIR grafia — nome não consta no dicionário]

## 1. Método da reunião e das atas
> * Percepção comum de que processos importantes não avançam e de que a reunião termina "sem nada para fazer amanhã"
> * Esta reunião foi tratada como exploratória — uma reunião sobre como conduzir as próximas

✓ Decisão: as atas passam a ser estruturadas por dimensão, orientadas a demandas, cada uma com responsável declarado
→ Ítalo Araújo monta a ata-base estruturada por dimensão até 27/08
→ Grupo se reúne para validar e ajustar a ata-base antes da próxima reunião

## 2. Estoque, recebimento e conferência
> * As três cantinas com sistema registram apenas entrada
> * Balanço não é diário no Parque Ecológico

✓ Decisão: as metas de D1 para estoque são regularizar balanços/inventários e a conferência entre o pedido e o recebido
→ Equipe de cantinas conclui o cruzamento dos dados do infantil e envia ao Ítalo Araújo [CONFERIR prazo]

## 3. Sistema Connect e totens
> * Totem custa cerca de **R$ 5.800** e o desconto obtido foi considerado insuficiente
> * Objetivo declarado: [[Connect]] em todos os colégios, ver [a proposta](https://exemplo)

✓ Decisão: separar sistema de totem — a proposta do Connect vai à próxima reunião
→ Responsável a definir: levantar por que a expansão do Connect não avançou

## 4. Engenharia de cardápio e precificação
> * A regra "dois pra um" foi adotada na ausência de dados produto a produto

✓ Decisão: o "dois pra um" deixa de ser regra obrigatória onde há sistema
✓ Decisão: aprovação de produto novo passa provisoriamente por Ítalo Araújo e Filipe Frota

## Outros pontos
> * Transporte: almoços chegam ao Parque Ecológico às 11h contra as 10h40 combinadas
> * Eventos: Filipe Frota cria modelo de relatório pós-evento

⚠ Em aberto

> * POPs de limpeza de freezer sem responsável técnico que os assine
> * Receita e despesa por cantina indisponíveis mês a mês
`;

// ---------------------------------------------------------------------------
// Amostra 2 — o mesmo formato com as variações do outro extremo do corpus.
// ---------------------------------------------------------------------------
const BOLETIM = `# Revisão da 1ª edição do Boletim do Colégio Christus
21/08/2026 [CONFERIR data — não dita no áudio; deduzida do nome do arquivo] · ~16 min · Participantes não identificados no áudio (citados na conversa: Kauã, Priscila, Simara)
Relacionados: boletim-colegio · Conhecimento BI · transcrição: 2026-08-24 - sexta-feira

## 1. Formato da 1ª edição
> * A edição foi montada reaproveitando o formato do boletim das faculdades
> * As imagens não são geradas por IA [CONFERIR]

✓ Decisão: manter o formato atual do boletim das faculdades também no boletim do colégio
→ Ideia registrada, sem decisão: diferenciar o boletim do colégio por cor de fundo

## 2. Recorte de período das matérias
> * A primeira edição puxou notícias de uma janela larga

✗ Sem decisão: o critério de escolha das imagens fica para a próxima edição
`;

const reuniao = {
  id: "z1ACDuvkF6ueyLvA7sDi",
  title: "Dimensões cantinas",
  date: "2026-08-26",
  participants: [],
  createdBy: "napa13@christus.com.br",
};

console.log("\n— ler o documento —");

const doc = lerPontosImportantes(CANTINAS);

checa("o H1 vira o título do documento", doc.titulo === "Cantinas — Estruturação da reunião por dimensões", doc.titulo);
checa("a data brasileira vira ISO", doc.data === "2026-08-26", doc.data);
checa(
  "todo bloco é encontrado, inclusive os dois sem numeração",
  doc.blocos.length === 6,
  doc.blocos.map((b) => b.assunto).join(" | "),
);
// A numeração do documento é da leitura em voz alta; a ata refaz a sua depois
// de ordenar por gravidade. Carregar as duas daria uma pauta numerada duas
// vezes, em ordens diferentes.
checa(
  "a numeração do cabeçalho sai do assunto",
  doc.blocos[0].assunto === "Método da reunião e das atas",
  doc.blocos[0].assunto,
);
checa(
  '"⚠ Em aberto" abre bloco mesmo sem ser cabeçalho',
  doc.blocos[5].assunto === "Em aberto" && doc.blocos[5].contexto.length === 2,
);
checa(
  "o bullet dentro de blockquote é reconhecido como contexto",
  doc.blocos[0].contexto.length === 2 &&
    doc.blocos[0].contexto[0].startsWith("Percepção comum"),
  JSON.stringify(doc.blocos[0].contexto),
);
checa(
  "duas decisões no mesmo bloco são duas",
  doc.blocos[3].decisoes.length === 2,
  JSON.stringify(doc.blocos[3].decisoes),
);
checa("cada → é um encaminhamento", doc.blocos[0].encaminhamentos.length === 2);

console.log("\n— os citados —");

checa(
  "a lista de citados sai da linha de metadados",
  doc.citados.length === 6 && doc.citados[0] === "Murilo Brasil",
  JSON.stringify(doc.citados),
);
// O "[CONFERIR grafia]" é recado para quem lê a ata, não parte do nome de
// ninguém — um avatar chamado "Nívea [CONFERIR grafia…]" seria ruído.
checa(
  "o [CONFERIR] grudado num nome não vira parte do nome",
  doc.citados[5] === "Nívea",
  doc.citados[5],
);

const docBoletim = lerPontosImportantes(BOLETIM);
checa(
  "a segunda forma da linha de citados também é lida",
  docBoletim.citados.join(",") === "Kauã,Priscila,Simara",
  JSON.stringify(docBoletim.citados),
);
checa(
  "o [CONFERIR data] não impede a leitura da data",
  docBoletim.data === "2026-08-21",
  docBoletim.data,
);
// "Relacionados:" é navegação do vault do Cowork. Se virasse contexto, toda ata
// abriria com um link interno no lugar do primeiro assunto.
checa(
  'a linha "Relacionados:" não vira conteúdo',
  docBoletim.blocos.length === 2 &&
    !JSON.stringify(docBoletim.blocos).includes("Relacionados"),
);

console.log("\n— do bloco para o item —");

const itemMetodo = blocoParaItem(doc.blocos[0], "1", DIMS);
checa("o assunto vira o assunto do item", itemMetodo.assunto === "Método da reunião e das atas");
checa("o item nasce sem card — a ata não cria demanda", itemMetodo.cardId === "");
// Esta é a única função do app que produz item `reuniao`, e o chip da tela sai
// daqui. Se ela parar de marcar, a pauta volta a desenhar igual o que o áudio
// trouxe e o que alguém digitou — e a mesclagem perde o único jeito que tem de
// saber qual texto tem autor humano e não pode ser sobrescrito.
checa(
  "e nasce marcado como vindo do áudio",
  itemMetodo.origem === "reuniao" && itemMetodo.origemAtaId === "",
  itemMetodo.origem,
);
checa("cada → virou uma tarefa pendente", itemMetodo.tarefas.length === 2 && itemMetodo.tarefas[0].status === "pendente");
// Prazo e responsável derivam de número e de nome próprio, que é o que a
// transcrição erra — e o erro chega com cara de acerto. O texto guarda os dois.
checa(
  "a tarefa NÃO ganha responsável nem prazo automáticos",
  itemMetodo.tarefas.every((t) => t.responsavel === "" && t.prazo === ""),
);
checa(
  "e o nome e a data ditos na reunião continuam legíveis no texto",
  itemMetodo.tarefas[0].texto.includes("Ítalo Araújo") &&
    itemMetodo.tarefas[0].texto.includes("27/08"),
  itemMetodo.tarefas[0].texto,
);

const itemEstoque = blocoParaItem(doc.blocos[1], "2", DIMS);
checa(
  "o [CONFERIR] do encaminhamento muda de coluna, e não some",
  itemEstoque.tarefas[0].observacao === "[CONFERIR prazo]" &&
    !itemEstoque.tarefas[0].texto.includes("CONFERIR"),
  `texto="${itemEstoque.tarefas[0].texto}" obs="${itemEstoque.tarefas[0].observacao}"`,
);

const itemConnect = blocoParaItem(doc.blocos[2], "3", DIMS);
// Os campos da ata são <textarea> e <td>: não interpretam Markdown. Sem a
// limpeza, cada decisão chega com asterisco no meio da frase.
checa(
  "negrito, link e wikilink do Markdown não vazam para o texto",
  itemConnect.contexto.includes("cerca de R$ 5.800") &&
    itemConnect.contexto.includes("Connect em todos") &&
    itemConnect.contexto.includes("ver a proposta") &&
    !/[*[\]]/.test(itemConnect.contexto),
  itemConnect.contexto,
);
// O campo vazio já diz "a definir"; repetir isso no texto seria ruído em toda
// tarefa que ninguém assumiu.
checa(
  '"Responsável a definir:" sai do texto da tarefa',
  itemConnect.tarefas[0].texto.startsWith("levantar por que"),
  itemConnect.tarefas[0].texto,
);

const itemCardapio = blocoParaItem(doc.blocos[3], "4", DIMS);
checa(
  "duas decisões viram uma só, separadas",
  itemCardapio.decisao.includes("dois pra um") && itemCardapio.decisao.includes(" · "),
  itemCardapio.decisao,
);

const itemSemDecisao = blocoParaItem(docBoletim.blocos[1], "2", DIMS);
// Gravar "sem decisão" em `decisao` faria a ata afirmar que decidiu não decidir,
// e o assunto desceria para o meio da pauta em vez de pedir atenção.
checa(
  "✗ Sem decisão vira OBJETIVO, e a decisão fica vazia",
  itemSemDecisao.decisao === "" && itemSemDecisao.objetivo.startsWith("o critério"),
  `decisao="${itemSemDecisao.decisao}" objetivo="${itemSemDecisao.objetivo}"`,
);
checa(
  "e por isso ele aparece como pendente de decisão",
  estadoNaAta(null, itemSemDecisao, {}, Date.now()) === "pendente",
);

console.log("\n— a classificação por dimensão —");

checa(
  "o nome da subdimensão dentro do assunto classifica",
  itemEstoque.dimensaoId === "d1" && itemEstoque.subdimensaoId === "1",
  `${itemEstoque.dimensaoId}/${itemEstoque.subdimensaoId}`,
);
checa(
  "o nome mais longo ganha do mais curto",
  itemCardapio.dimensaoId === "d3" && itemCardapio.subdimensaoId === "1",
  `${itemCardapio.dimensaoId}/${itemCardapio.subdimensaoId}`,
);
// Inventar uma dimensão para "Sistema Connect e totens" seria o app decidindo o
// que a reunião não decidiu. Sem classificação é a resposta honesta.
checa(
  "assunto que não casa com nada fica SEM classificação",
  itemConnect.dimensaoId === "" && itemConnect.subdimensaoId === "",
);
checa(
  "sem árvore nenhuma, nada quebra",
  blocoParaItem(doc.blocos[1], "1", []).dimensaoId === "",
);

console.log("\n— a ata inteira —");

const ata = montarAtaDaReuniao({ markdown: CANTINAS, reuniao, setor: "Cantinas", dimensoes: DIMS });

// O H1 é editorial e muda de safra do prompt; o título da reunião é o nome pelo
// qual a pessoa a procura em /reunioes e /relatorios.
checa("o título vem da REUNIÃO, não do H1 do documento", ata.titulo === "Dimensões cantinas", ata.titulo);
checa("a data vem da reunião", ata.data === "2026-08-26");
checa("o facilitador é quem enviou o áudio", ata.facilitador === "napa13@christus.com.br");
checa("a ata guarda de que reunião veio", ata.meetingId === reuniao.id);
checa("o setor é o de destino, não o da reunião", ata.setor === "Cantinas");
// Participante tem e-mail e pode receber tarefa; citado é um nome ouvido na
// gravação, que pode nem ter conta. Misturar os dois daria avatar sem dono.
checa("citados não viram participantes", ata.participantes.length === 0 && ata.citados.length === 6);
checa("todo bloco virou item", ata.itens.length === 6);
checa("todo item tem id único", new Set(ata.itens.map((i) => i.id)).size === 6);

const ataSemData = montarAtaDaReuniao({
  markdown: CANTINAS,
  reuniao: { ...reuniao, date: "" },
  setor: "Cantinas",
  dimensoes: DIMS,
});
checa(
  "sem data na reunião, a do documento entra no lugar",
  ataSemData.data === "2026-08-26",
  ataSemData.data,
);

console.log("\n— a pauta que sai daí —");

const pauta = montarPauta({
  cards: [],
  ata,
  dimensoes: DIMS,
  entregues: { Cantinas: new Set() },
  hoje: new Date(2026, 8, 1).getTime(),
});
const resumo = resumoDaAta(pauta);

// O setor Cantinas não tinha card nenhum quando esta ata nasceu. Sem item sem
// card, ela abriria vazia — e era exatamente esse o defeito a consertar.
checa("quadro vazio, e ainda assim há pauta", pauta.length === 6);
checa(
  "os quatro assuntos que pedem algo contam como em aberto; os de registro, não",
  resumo.emAberto === 4 && resumo.porEstado.registro === 2,
  JSON.stringify(resumo.porEstado),
);
checa(
  "os dois blocos-apêndice ficam no fim da pauta",
  pauta.slice(-2).every((l) => l.estado === "registro"),
  pauta.map((l) => `${l.titulo}:${l.estado}`).join(" | "),
);
checa("a numeração é contínua e começa em 01", pauta[0].numero === "01" && pauta[5].numero === "06");
checa("cada → do documento chegou na pauta como tarefa", resumo.tarefas === 4, String(resumo.tarefas));

console.log("\n— ligar no card que a mesma reunião gerou —");

// Card e bloco ou nomeiam a mesma coisa ou não: o `assunto` da proposta é, por
// contrato do sidecar, o cabeçalho do bloco. Sem heurística.
const ligados = ligarCards(ata.itens, [
  { id: "card-1", assunto: "2. Estoque, recebimento e conferência" },
  { id: "card-2", assunto: "Assunto que esta reunião não teve" },
]);
checa(
  "o assunto que virou card passa a apontar para ele",
  ligados.find((i) => i.assunto.startsWith("Estoque")).cardId === "card-1",
);
checa(
  "a numeração da proposta não impede o casamento",
  ligados.filter((i) => i.cardId).length === 1,
  JSON.stringify(ligados.map((i) => i.cardId)),
);
checa("o resto continua sem card", ligados.filter((i) => !i.cardId).length === 5);

console.log("\n— documento fora do gabarito não derruba nada —");

// A propriedade que faz valer a pena depender de um contrato que mora fora
// deste repositório: se o prompt mudar, a ata fica pobre — não fica errada.
checa("documento vazio devolve ata sem item", montarAtaDaReuniao({ markdown: "", reuniao, setor: "X" }).itens.length === 0);
checa("markdown nulo não explode", lerPontosImportantes(null).blocos.length === 0);
checa(
  "prosa sem sentinela vira item sem decisão e sem tarefa",
  (() => {
    const r = lerPontosImportantes("# T\n\n## 1. Só conversa\nnada de especial aqui");
    const i = blocoParaItem(r.blocos[0], "1", DIMS);
    return i.decisao === "" && i.tarefas.length === 0 && i.contexto.includes("nada de especial");
  })(),
);

console.log(
  falhas === 0 ? "\nata de reunião: ok" : `\nata de reunião: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
