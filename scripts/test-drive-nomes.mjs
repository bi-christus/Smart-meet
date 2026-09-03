/**
 * O contrato de nomes combinado com o Cowork (`lib/drive-nomes-core.ts`).
 *
 * Importa o `.ts` de verdade pelo strip de tipos nativo do Node — sem cópia, sem
 * build, como os outros testes da casa. Roda no `prebuild`, que é o portão do
 * deploy.
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que nenhum outro portão protege: uma
 * classificação errada aqui NÃO quebra nada. Não lança, não vira erro 500, não
 * some da tela. O efeito é um documento linkado no lugar de outro — a aba Ata
 * lendo a ata didática achando que é a pauta —, e a única forma de descobrir é
 * alguém abrir o link e estranhar.
 *
 * A ORDEM DOS `if` É A REGRA, e ordem de `if` é o que se estraga num refactor
 * sem nada ficar vermelho. Metade dos casos abaixo existe só para travar a
 * ordem.
 */
import {
  classificarSaida,
  jaTranscrito,
  nomeBase,
  saidaDoArquivo,
  semExtensao,
  TIPOS_DE_SAIDA,
} from "../src/lib/drive-nomes-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— o que cada sufixo diz que o arquivo é —");

// Os cinco nomes que o Cowork de fato escreve, conferidos contra a tabela de
// saídas de `processar-smart-meet.md`.
const REAIS = [
  [" - Transcrição", "transcricao"],
  [" - Pontos importantes", "resumo"],
  [" - Pauta da reunião", "pauta"],
  [" - Ata detalhada", "detalhada"],
  [" - Ata didática", "didatica"],
];
for (const [sufixo, esperado] of REAIS) {
  checa(
    `"${sufixo.trim()}" → ${esperado}`,
    classificarSaida(sufixo) === esperado,
    String(classificarSaida(sufixo)),
  );
}

// A ORDEM, travada caso a caso. Cada um destes passaria pelo ramo errado se
// alguém reordenasse os `if`.
checa(
  "a pauta ganha do ramo de 'ponto', mesmo se um dia o nome contiver a palavra",
  classificarSaida(" - Pauta de pontos da reunião") === "pauta",
  String(classificarSaida(" - Pauta de pontos da reunião")),
);
checa(
  "'Ata detalhada' não cai em 'ata didática'",
  classificarSaida(" - Ata detalhada") === "detalhada",
);
checa(
  "didática sem acento também casa — o Drive devolve as duas grafias",
  classificarSaida(" - Ata didatica") === "didatica",
);
checa(
  "'Transcrito' (o marcador do áudio) cai em transcrição, e não em outra coisa",
  classificarSaida(" - Transcrito") === "transcricao",
);
checa(
  "'Resumo' das safras antigas do prompt continua sendo a ata principal",
  classificarSaida(" - Resumo") === "resumo",
);

// `null` e não um coringa: a pasta tem o áudio, o Demandas.json e o que mais
// alguém largar ali. Chutar um tipo faria o app linkar um PDF como se fosse ata.
checa("sufixo desconhecido não vira tipo nenhum", classificarSaida(" - Anexos") === null);
checa("sufixo vazio não vira tipo nenhum", classificarSaida("") === null);

checa(
  "todo tipo declarado é alcançável por algum nome real",
  TIPOS_DE_SAIDA.every((t) => REAIS.some(([, esp]) => esp === t)),
  TIPOS_DE_SAIDA.filter((t) => !REAIS.some(([, esp]) => esp === t)).join(","),
);

console.log("\n— o marcador de 'o Cowork terminou' —");

checa("o áudio renomeado é reconhecido", jaTranscrito("Reunião - Transcrito.m4a"));
checa("com colchetes também", jaTranscrito("Reunião [Transcrito].m4a"));
checa("e com travessão", jaTranscrito("Reunião — Transcrito.m4a"));
checa("o áudio ainda não processado, não", jaTranscrito("Reunião.m4a") === false);
/**
 * ANCORADO NO FIM, e é a razão de o marcador ser uma âncora e não um `includes`.
 * Um áudio chamado "Transcrito do dia 5" seria dado como pronto no instante em
 * que aparecesse: a reunião viraria "processado" com zero links, e como o status
 * só é gravado uma vez, ela nunca mais seria reavaliada.
 */
checa(
  "a palavra no MEIO do nome não conta",
  jaTranscrito("Transcrito do dia 5.m4a") === false,
);

console.log("\n— o nome-base —");

checa(
  "tira a extensão e o marcador",
  nomeBase("Reunião de compras - Transcrito.m4a") === "Reunião de compras",
  nomeBase("Reunião de compras - Transcrito.m4a"),
);
checa(
  "do áudio ainda não processado, tira só a extensão",
  nomeBase("Reunião de compras.m4a") === "Reunião de compras",
);
/**
 * O PONTO DENTRO DO NOME É PARTE DO NOME. "Reunião 29.07" perderia o "07" se
 * alguém tratasse tudo depois do último ponto como extensão — e aí nenhum
 * documento casaria, deixando a reunião processada e vazia.
 */
checa(
  "o ponto do meio do nome sobrevive",
  nomeBase("Reunião 29.07 - Transcrito.m4a") === "Reunião 29.07",
  nomeBase("Reunião 29.07 - Transcrito.m4a"),
);
checa("nome sem ponto nenhum não é cortado", semExtensao("Reunião") === "Reunião");

console.log("\n— o arquivo é DESTE áudio? —");

const BASE = "Reunião de compras";
checa(
  "o documento do áudio casa",
  saidaDoArquivo({ base: BASE, nomeDoArquivo: `${BASE} - Pauta da reunião` }) === "pauta",
);
/**
 * O SEPARADOR É A CONFERÊNCIA QUE EVITA O FALSO POSITIVO CARO. Sem ele,
 * "Reunião" casaria com "Reunião de compras - Pontos importantes" — o documento
 * de OUTRA reunião entraria nesta, e as duas passariam a mostrar a mesma ata. É
 * o mesmo cuidado que o `marcar-transcrito` do Cowork chama de "conferência
 * estrita".
 */
checa(
  "o documento de outra reunião com nome parecido NÃO casa",
  saidaDoArquivo({
    base: "Reunião",
    nomeDoArquivo: "Reunião de compras - Pontos importantes",
  }) === null,
);
checa(
  "sem o separador não casa",
  saidaDoArquivo({ base: BASE, nomeDoArquivo: `${BASE} Pauta da reunião` }) === null,
);
checa(
  "travessão serve de separador — o Docs troca o hífen sozinho",
  saidaDoArquivo({ base: BASE, nomeDoArquivo: `${BASE} — Pauta da reunião` }) === "pauta",
);
checa(
  "o casamento não é sensível à caixa",
  saidaDoArquivo({
    base: BASE,
    nomeDoArquivo: `${BASE.toUpperCase()} - Pauta da reunião`,
  }) === "pauta",
);
checa(
  "arquivo de outra reunião não casa",
  saidaDoArquivo({ base: BASE, nomeDoArquivo: "Outra reunião - Pauta da reunião" }) === null,
);
checa(
  "base vazia não casa com nada — senão TODO arquivo da pasta viraria documento",
  saidaDoArquivo({ base: "", nomeDoArquivo: " - Pauta da reunião" }) === null,
);

console.log(
  falhas === 0 ? "\ncontrato de nomes: ok" : `\ncontrato de nomes: ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
