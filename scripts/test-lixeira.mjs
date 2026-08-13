/**
 * Testes da lixeira das demandas.
 *
 * A regra testada aqui cabe em uma linha, e mesmo assim é a que mais custa
 * errar: ela é o ÚNICO ponto que decide se uma demanda excluída aparece no
 * quadro, no Dashboard, no Cronograma, na aba Links, nas Recorrências e no
 * relatório do gestor. Errar para um lado deixa demanda apagada circulando por
 * seis telas; errar para o outro faz sumir para sempre tudo que alguém
 * restaurou.
 *
 * O caso que este arquivo existe para travar: `restaurarDaLixeira` grava
 * `deletedAt: null`, e NÃO remove o campo. Quem trocar `!!c.deletedAt` por
 * `c.deletedAt === undefined` — que parece equivalente e é mais explícito —
 * apaga do quadro toda demanda que já voltou da lixeira, em silêncio.
 *
 * Roda com o strip de tipos nativo do Node sobre o .ts real — sem cópia.
 */
import {
  naLixeira,
  ordenarLixeira,
  viva,
} from "../src/lib/lixeira-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`,
  );
}

// --- as três formas de estar viva ----------------------------------------
checa(
  "card sem o campo (todos os que já estão no banco) está VIVO",
  viva({ title: "Relatório de consumo" }) && !naLixeira({}),
);
checa(
  "card restaurado, com deletedAt: null, está VIVO",
  viva({ deletedAt: null, deletedBy: null }) && !naLixeira({ deletedAt: null }),
);
checa(
  "deletedAt: 0 não é data de exclusão nenhuma — está VIVO",
  viva({ deletedAt: 0 }),
);

// --- e a única forma de estar na lixeira ----------------------------------
checa(
  "card com data de exclusão está NA LIXEIRA",
  naLixeira({ deletedAt: 1_770_000_000_000 }) &&
    !viva({ deletedAt: 1_770_000_000_000 }),
);
checa(
  "deletedBy sozinho não manda ninguém para a lixeira",
  viva({ deletedBy: "italo@px.com.br" }),
);
checa(
  "viva e naLixeira nunca concordam",
  [{}, { deletedAt: null }, { deletedAt: 0 }, { deletedAt: 1 }].every(
    (c) => viva(c) !== naLixeira(c),
  ),
);

// --- falhar escondendo, nunca mostrando ----------------------------------
// Se um dia alguém gravar `serverTimestamp()` aqui em vez de `Date.now()`, o
// campo chega como objeto. A resposta certa é continuar escondendo: demanda
// escondida a mais alguém reclama e se conserta; demanda apagada que reaparece
// no quadro do setor ninguém percebe que voltou por engano.
checa(
  "data em formato inesperado continua escondida, não volta ao quadro",
  naLixeira({ deletedAt: { seconds: 1_770_000_000 } }),
);

// --- ordem de leitura: a última que saiu do quadro vem primeiro -----------
const lixo = [
  { id: "antiga", deletedAt: 1_000 },
  { id: "recente", deletedAt: 3_000 },
  { id: "meio", deletedAt: 2_000 },
];
const ordenada = ordenarLixeira(lixo);
checa(
  "a exclusão mais recente aparece no topo",
  ordenada.map((c) => c.id).join(",") === "recente,meio,antiga",
  ordenada.map((c) => c.id).join(","),
);
checa(
  "ordenar não mexe na lista de quem chamou",
  lixo.map((c) => c.id).join(",") === "antiga,recente,meio",
  lixo.map((c) => c.id).join(","),
);
checa(
  "card sem data de exclusão vai para o fim, não quebra a ordem",
  ordenarLixeira([{ id: "sem" }, { id: "com", deletedAt: 5 }])
    .map((c) => c.id)
    .join(",") === "com,sem",
);
checa("lixeira vazia continua vazia", ordenarLixeira([]).length === 0);

console.log(
  falhas === 0
    ? "\nTodos os testes da lixeira passaram."
    : `\n${falhas} teste(s) falharam.`,
);
process.exit(falhas === 0 ? 0 : 1);
