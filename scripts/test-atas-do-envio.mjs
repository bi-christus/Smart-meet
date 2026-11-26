/**
 * Testes da escolha de documentos do envio (`lib/atas-do-envio-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que nenhum outro portão protege:
 *
 * 1. O PADRÃO COM A ATA DETALHADA MARCADA. É a correção inteira da Issue #248:
 *    as pessoas esqueciam de marcar, e o motor da nuvem, recebendo só
 *    "resumo", não gerava a detalhada. Alguém que "simplifique" o padrão de
 *    volta para ["resumo"] passa em tipo, em lint e na tela — a tela só fica
 *    com uma caixa desmarcada a mais. O dano aparece semanas depois, no banco.
 *
 * 2. O `smGerar` EXATO. O motor (vigia-smart-meet, `resolverGerar`) procura as
 *    palavras "detalhada" e "didatica" na etiqueta. Um valor fora da lista,
 *    repetido ou sem "resumo" não quebra nada visível: ele só deixa de gerar o
 *    que a pessoa pediu. Por isso o teste fixa o texto, não só "tem itens".
 *
 * 3. O CADEADO. "resumo" não sai da escolha por nenhum caminho — nem
 *    alternando, nem mandando lista vazia ou lixo para o servidor.
 */
import {
  ATAS_CONHECIDAS,
  ATAS_PADRAO,
  alternarAta,
  ehAtaConhecida,
  normalizarEscolha,
  paraSmGerar,
} from "../src/lib/atas-do-envio-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n— o padrão —");

checa(
  "o padrão é Pontos importantes + Ata detalhada",
  igual([...ATAS_PADRAO], ["resumo", "detalhada"]),
  JSON.stringify(ATAS_PADRAO),
);
checa("o padrão vira smGerar=resumo,detalhada", paraSmGerar(ATAS_PADRAO) === "resumo,detalhada");
checa("o padrão é congelado (estado de tela não o altera por engano)", Object.isFrozen(ATAS_PADRAO));
checa(
  "normalizar o padrão devolve CÓPIA (dá para usar como estado)",
  normalizarEscolha(ATAS_PADRAO) !== ATAS_PADRAO &&
    igual(normalizarEscolha(ATAS_PADRAO), ["resumo", "detalhada"]),
);

console.log("\n— a lista fechada —");

checa(
  "a lista conhecida é exatamente resumo, detalhada, didatica",
  igual([...ATAS_CONHECIDAS], ["resumo", "detalhada", "didatica"]),
);
checa("'pauta' não é escolha (a nuvem nunca a gerou — #251)", !ehAtaConhecida("pauta"));
checa("'transcricao' não é escolha (sai sempre)", !ehAtaConhecida("transcricao"));
checa("valor com maiúscula não passa por conhecido", !ehAtaConhecida("Detalhada"));
checa("não-texto não passa", !ehAtaConhecida(1) && !ehAtaConhecida(null));

console.log("\n— normalizar —");

checa("lista vazia vira só resumo", igual(normalizarEscolha([]), ["resumo"]));
checa("lista ausente vira só resumo", igual(normalizarEscolha(undefined), ["resumo"]));
checa("texto solto (não lista) vira só resumo", igual(normalizarEscolha("detalhada"), ["resumo"]));
checa(
  "resumo entra mesmo quando não veio",
  igual(normalizarEscolha(["didatica"]), ["resumo", "didatica"]),
);
checa(
  "repetição some",
  igual(normalizarEscolha(["detalhada", "detalhada", "resumo", "resumo"]), ["resumo", "detalhada"]),
);
checa(
  "valor desconhecido é descartado, o resto fica",
  igual(normalizarEscolha(["pauta", "detalhada", "<script>", 7, null]), ["resumo", "detalhada"]),
);
checa(
  "ordem da lista, não a do clique: resumo primeiro, depois detalhada, depois didatica",
  igual(normalizarEscolha(["didatica", "detalhada", "resumo"]), ["resumo", "detalhada", "didatica"]),
);
checa(
  "smGerar de tudo marcado",
  paraSmGerar(["didatica", "detalhada"]) === "resumo,detalhada,didatica",
);
checa("smGerar do lixo é só resumo", paraSmGerar({ smGerar: "detalhada" }) === "resumo");

console.log("\n— alternar —");

const padrao = normalizarEscolha(ATAS_PADRAO);
checa(
  "desmarcar a detalhada deixa só resumo",
  igual(alternarAta(padrao, "detalhada"), ["resumo"]),
);
checa(
  "marcar a didática no padrão",
  igual(alternarAta(padrao, "didatica"), ["resumo", "detalhada", "didatica"]),
);
checa(
  "alternar duas vezes volta ao começo",
  igual(alternarAta(alternarAta(padrao, "didatica"), "didatica"), padrao),
);
checa("resumo tem cadeado: alternar não o tira", igual(alternarAta(padrao, "resumo"), padrao));
// Desmarcar e remarcar a detalhada depois da didática: sem a normalização no
// alternar, a lista sairia na ordem do clique (didatica antes de detalhada),
// e é ela que vai para `meeting.output`.
checa(
  "alternar devolve a ordem da lista, não a do clique",
  igual(
    alternarAta(alternarAta(alternarAta(padrao, "detalhada"), "didatica"), "detalhada"),
    ["resumo", "detalhada", "didatica"],
  ),
);
checa(
  "alternar não muta a lista recebida",
  igual(padrao, ["resumo", "detalhada"]),
  JSON.stringify(padrao),
);

console.log(
  falhas === 0 ? "\n✅ atas do envio: ok" : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
