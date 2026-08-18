/**
 * Testes do card do perfil — o cabeçalho e o que o botão de salvar promete.
 *
 * O PRÓPRIO ARQUIVO É A PROVA DE PUREZA. Ele importa `perfil-core.ts` sob Node
 * puro, sem bundler: um `firebase/firestore` que apareça lá dentro faz este
 * teste falhar no `import`, e o `prebuild` fica vermelho antes de o deploy sair.
 * É a mesma garantia que `test-permissoes.mjs` dá para `permissoes-core`.
 *
 * As duas frentes que ele guarda erram de jeitos opostos:
 *
 *  - O CABEÇALHO erra devolvendo `undefined`, que o React desenha como NADA. Um
 *    perfil sem nome nenhum na tela é indistinguível de um perfil que não
 *    carregou — e o dado que produz isso (nome em branco, `sectors` ausente,
 *    papel fora da tabela) está no banco hoje.
 *  - O RÓTULO DO BOTÃO erra prometendo o contrário do que o clique faz. O caso
 *    que ninguém enumera à mão é "remover a foto E trocar a moldura": uma tabela
 *    literal cai no braço da moldura, o botão diz "Salvar moldura", e o que
 *    acontece é uma remoção de foto.
 */
import {
  ROLE_LABEL,
  cabecalhoDe,
  mudancasPendentes,
} from "../src/lib/perfil-core.ts";

let falhas = 0;

function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— `cabecalhoDe`: nada devolve undefined —");

const cheio = cabecalhoDe({
  email: "ana@px.com.br",
  name: "Ana Souza",
  role: "gestor",
  cargo: "Coordenadora",
  sectors: ["B.I.", "RH"],
});
checa("nome, cargo e papel completos", cheio.nome === "Ana Souza" && cheio.cargo === "Coordenadora");
checa("o papel vira rótulo", cheio.papel === ROLE_LABEL.gestor, cheio.papel);
checa("os setores vêm na ordem", cheio.setores.join("|") === "B.I.|RH");

const vazio = cabecalhoDe({ email: "b@px.com.br" });
checa("nome em branco cai para o e-mail", vazio.nome === "b@px.com.br");
checa("cargo ausente devolve null, não um texto", vazio.cargo === null);
checa("papel ausente devolve o traço, nunca undefined", vazio.papel === "—");
checa("sectors ausente devolve [] e não undefined", Array.isArray(vazio.setores) && vazio.setores.length === 0);

const espacos = cabecalhoDe({
  email: "  c@px.com.br  ",
  name: "   ",
  cargo: "   ",
  role: "  ",
  sectors: ["  B.I.  ", "", "   ", "RH"],
});
checa("nome só de espaços cai para o e-mail", espacos.nome === "c@px.com.br");
checa("o e-mail sai sem espaço em volta", espacos.email === "c@px.com.br");
checa("cargo só de espaços vira null", espacos.cargo === null);
checa("setor em branco não vira chip", espacos.setores.join("|") === "B.I.|RH");

const estranho = cabecalhoDe({ email: "d@px.com.br", role: "supervisor" });
// Papel de uma versão futura: mostrar o valor cru informa mais do que apagar a
// linha e afirmar, em silêncio, que a pessoa não tem papel nenhum.
checa("papel fora da tabela sai cru, não some", estranho.papel === "supervisor");
checa(
  "papel fora da tabela não devolve undefined",
  estranho.papel !== undefined && estranho.papel !== "undefined",
);
checa(
  "nulls explícitos não estouram",
  cabecalhoDe({ email: "e@px.com.br", name: null, cargo: null, role: null, sectors: null })
    .nome === "e@px.com.br",
);

console.log("\n— `mudancasPendentes`: o que está pendente —");

const base = {
  nome: "Ana",
  nomeSalvo: "Ana",
  fotoPendente: undefined,
  molduraPendente: undefined,
  molduraSalva: "nenhuma",
  gravando: false,
};

const parado = mudancasPendentes(base);
checa("nada mexido: `alguma` é false", parado.alguma === false);
checa("nada mexido: o rótulo é o genérico", parado.rotulo === "Salvar", parado.rotulo);
checa("nada mexido: foto é null (e não a string 'null')", parado.foto === null);

checa(
  "digitar o nome acende a pendência",
  mudancasPendentes({ ...base, nome: "Ana Souza" }).nome === true,
);
// Sem a comparação por `trim`, digitar um espaço e apagá-lo deixaria o botão
// aceso prometendo salvar uma diferença que não existe.
checa(
  "espaço em volta do nome NÃO é mudança",
  mudancasPendentes({ ...base, nome: "  Ana  " }).alguma === false,
);
checa(
  "espaço só do lado salvo também não é mudança",
  mudancasPendentes({ ...base, nome: "Ana", nomeSalvo: "  Ana " }).alguma === false,
);

checa(
  "foto escolhida é 'nova'",
  mudancasPendentes({ ...base, fotoPendente: "data:image/jpeg;base64,xx" }).foto === "nova",
);
checa(
  "foto marcada para sair é 'remover'",
  mudancasPendentes({ ...base, fotoPendente: null }).foto === "remover",
);
checa(
  "foto intocada é null",
  mudancasPendentes({ ...base, fotoPendente: undefined }).foto === null,
);

checa(
  "trocar a moldura acende a pendência",
  mudancasPendentes({ ...base, molduraPendente: "aurora" }).moldura === true,
);
// Sem isto, abrir o seletor e clicar na opção que já está gravada acenderia o
// botão de salvar prometendo gravar o que já está lá.
checa(
  "escolher a moldura que JÁ está salva não é mudança",
  mudancasPendentes({ ...base, molduraPendente: "nenhuma" }).alguma === false,
);
checa(
  "voltar para 'nenhuma' vindo de outra É mudança",
  mudancasPendentes({ ...base, molduraPendente: "nenhuma", molduraSalva: "aurora" })
    .moldura === true,
);

console.log("\n— o rótulo do botão: todas as combinações —");

/** Os três eixos, com o da foto valendo dois estados. */
const EIXOS = [];
for (const nome of [false, true]) {
  for (const foto of [undefined, "data:image/jpeg;base64,xx", null]) {
    for (const moldura of [false, true]) {
      EIXOS.push({ nome, foto, moldura });
    }
  }
}

const vistos = new Map();
let combosAtivos = 0;

for (const e of EIXOS) {
  for (const gravando of [false, true]) {
    const p = mudancasPendentes({
      ...base,
      nome: e.nome ? "Ana Souza" : "Ana",
      fotoPendente: e.foto,
      molduraPendente: e.moldura ? "aurora" : undefined,
      gravando,
    });
    const ativo = e.nome || e.foto !== undefined || e.moldura;
    checa(
      `alguma === ${ativo} para nome=${e.nome} foto=${String(e.foto).slice(0, 4)} moldura=${e.moldura}`,
      p.alguma === ativo,
    );
    if (!ativo) continue;
    if (!gravando) combosAtivos++;
    const chave = `${gravando ? "gravando" : "ocioso"}|${p.rotulo}`;
    vistos.set(chave, [...(vistos.get(chave) ?? []), JSON.stringify(e)]);
  }
}

checa("existem 11 combinações com algo pendente", combosAtivos === 11, String(combosAtivos));

// A asserção que a tabela literal falharia: duas combinações DIFERENTES não
// podem produzir a mesma frase. Se produzissem, o botão mentiria em uma delas.
const colididos = [...vistos.entries()].filter(([, v]) => v.length > 1);
checa(
  "nenhuma combinação diferente produz o mesmo rótulo",
  colididos.length === 0,
  colididos.map(([k, v]) => `${k} ← ${v.join(" e ")}`).join(" · "),
);
checa("são 22 rótulos distintos (11 combinações × 2 estados)", vistos.size === 22, String(vistos.size));

const rot = (e, gravando = false) =>
  mudancasPendentes({
    ...base,
    nome: e.nome ? "Ana Souza" : "Ana",
    fotoPendente: e.foto,
    molduraPendente: e.moldura ? "aurora" : undefined,
    gravando,
  }).rotulo;

console.log("\n— as frases que importam —");

checa("só o nome", rot({ nome: true }) === "Salvar nome", rot({ nome: true }));
checa(
  "só a moldura",
  rot({ moldura: true }) === "Salvar moldura",
  rot({ moldura: true }),
);
checa(
  "só a foto nova",
  rot({ foto: "data:image/jpeg;base64,xx" }) === "Salvar foto",
  rot({ foto: "data:image/jpeg;base64,xx" }),
);

// O acerto do ternário antigo que uma reescrita perderia calada: quem pediu
// para TIRAR a foto não pode ler "Salvar foto" no botão que a remove.
checa("só a remoção diz REMOVER", rot({ foto: null }) === "Remover foto", rot({ foto: null }));
checa(
  "a remoção nunca vira 'Salvar foto'",
  EIXOS.filter((e) => e.foto === null).every(
    (e) => !rot(e).startsWith("Salvar foto"),
  ),
);
checa(
  "a remoção governa a frase em todas as combinações em que aparece",
  EIXOS.filter((e) => e.foto === null).every((e) => rot(e).startsWith("Remover foto")),
);

// O par que ninguém enumera à mão.
checa(
  "remover a foto E trocar a moldura tem frase própria",
  rot({ foto: null, moldura: true }) === "Remover foto e salvar moldura",
  rot({ foto: null, moldura: true }),
);
checa(
  "remover a foto E trocar o nome tem frase própria",
  rot({ foto: null, nome: true }) === "Remover foto e salvar nome",
  rot({ foto: null, nome: true }),
);
checa(
  "os três com remoção não enumeram os dois restantes",
  rot({ foto: null, nome: true, moldura: true }) === "Remover foto e salvar o resto",
  rot({ foto: null, nome: true, moldura: true }),
);
checa(
  "os três com foto nova enumeram os três",
  rot({ foto: "data:image/jpeg;base64,xx", nome: true, moldura: true }) ===
    "Salvar nome, foto e moldura",
  rot({ foto: "data:image/jpeg;base64,xx", nome: true, moldura: true }),
);

console.log("\n— gravando: nenhum 'Salvando…' seco —");

// Mesma proibição do "Carregando…" do AGENTS.md §3: anunciar que algo acontece
// sem dizer o quê. A única exceção é o caso inalcançável (nada pendente), que a
// tela desabilita pelo `alguma === false`.
const gerundios = EIXOS.filter((e) => e.nome || e.foto !== undefined || e.moldura).map(
  (e) => rot(e, true),
);
checa("todo rótulo de gravação termina em reticências", gerundios.every((g) => g.endsWith("…")));
checa("nenhum é o genérico 'Salvando…'", !gerundios.includes("Salvando…"));
checa(
  "cada um nomeia o que está sendo gravado",
  gerundios.every((g) => /nome|foto|moldura|resto/.test(g)),
  gerundios.filter((g) => !/nome|foto|moldura|resto/.test(g)).join(" · "),
);
checa(
  "removendo a foto sozinha",
  rot({ foto: null }, true) === "Removendo a foto…",
  rot({ foto: null }, true),
);
checa(
  "removendo a foto e salvando a moldura",
  rot({ foto: null, moldura: true }, true) === "Removendo a foto e salvando a moldura…",
  rot({ foto: null, moldura: true }, true),
);

console.log(falhas === 0 ? "\ncard do perfil: ok" : `\ncard do perfil: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
