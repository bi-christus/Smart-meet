/**
 * Testes das regras da rota que monta a ata (`lib/ata-gerar-core.ts`).
 *
 * O QUE ESTE ARQUIVO PROTEGE, e que nenhum outro portão protege:
 *
 * 1. A IDEMPOTÊNCIA. O id da ata é derivado de `meetingId + setor`, e é ele que
 *    transforma "conferir se já existe" em "tentar criar e deixar o banco
 *    recusar". Um id que deixe de ser determinístico — alguém acrescenta um
 *    timestamp, alguém troca a ordem dos campos — devolve o check-then-add que
 *    fazia dois cliques simultâneos criarem duas atas da mesma reunião. Isso
 *    passa em tipo, em lint e na tela; só aparece quando acontece.
 *
 * 2. QUE O ERRO DO GOOGLE NÃO CHEGA AO MODAL. `driveFetch` lança
 *    `Drive API 404: {json}` com id de arquivo dentro. Esse texto ia cru para a
 *    resposta. O teste fixa a fronteira: mensagem da casa passa inteira,
 *    mensagem do Drive vira frase em português.
 */
import { ehJaExiste, idDaAta, paraQuemPediu } from "../src/lib/ata-gerar-core.ts";

let falhas = 0;
function checa(rotulo, condicao, detalhe = "") {
  if (!condicao) falhas++;
  console.log(
    `${condicao ? "✅" : "❌"} ${rotulo}${detalhe && !condicao ? ` — ${detalhe}` : ""}`,
  );
}

console.log("\n— o id que fecha a corrida —");

const a = idDaAta("reuniao1", "Cantinas");
checa("o mesmo par dá sempre o mesmo id", a === idDaAta("reuniao1", "Cantinas"));
checa("setor diferente, id diferente", a !== idDaAta("reuniao1", "B.I."));
checa("reunião diferente, id diferente", a !== idDaAta("reuniao2", "Cantinas"));
checa("cabe num id de documento", /^[0-9a-f]{32}$/.test(a), a);

// O setor é texto livre do cadastro: "B.I." tem ponto, e nada impede alguém de
// cadastrar um com barra — que o Firestore recusa em id de documento.
checa(
  "setor com ponto e com barra não vazam para o id",
  /^[0-9a-f]{32}$/.test(idDaAta("r", "Nutrição / Cantinas (B.I.)")),
);

// A separação tem de ser inambígua: sem o "|", ("ab","c") e ("a","bc") dariam o
// mesmo id, e uma ata apareceria como se já existisse para outra reunião.
checa(
  "a fronteira entre os dois campos não some",
  idDaAta("ab", "c") !== idDaAta("a", "bc"),
);

console.log("\n— o outro pedido chegou primeiro —");

checa("código 6 do gRPC", ehJaExiste({ code: 6 }));
checa("nome em kebab", ehJaExiste({ code: "already-exists" }));
checa("pela mensagem", ehJaExiste(new Error("Document already exists: atas/abc")));
checa("erro qualquer NÃO é isso", !ehJaExiste(new Error("deu ruim")));
checa("nem indefinido", !ehJaExiste(undefined));
// Um erro de permissão passar por "já existe" seria o pior desfecho: a rota
// devolveria 200 com um id de ata que não foi criada.
checa("nem permission-denied", !ehJaExiste({ code: 7, message: "PERMISSION_DENIED" }));

console.log("\n— o que a pessoa lê —");

checa(
  "mensagem da casa passa inteira",
  paraQuemPediu({ status: 409, message: "Esta reunião ainda não foi processada." }) ===
    "Esta reunião ainda não foi processada.",
);
const doDrive = paraQuemPediu({
  status: 404,
  message: 'Drive API 404: {"error":{"code":404,"message":"File not found: 1AbC_dEf"}}',
});
checa("o JSON do Google não chega ao modal", !/Drive API|File not found|1AbC_dEf/.test(doDrive));
checa("e a frase é em português e diz o que houve", /Drive/.test(doDrive) && /lixeira|compartilhad/.test(doDrive), doDrive);
const outroDoDrive = paraQuemPediu({ status: 500, message: "Drive API 500: {…}" });
checa("erro do Drive que não é 404 tem a própria frase", outroDoDrive !== doDrive);
checa("e também não vaza o corpo", !/Drive API/.test(outroDoDrive));
checa(
  "erro sem forma conhecida vira frase genérica",
  paraQuemPediu(null) === "Não foi possível gerar a ata.",
);

console.log(
  falhas === 0 ? "\n✅ rota da ata: ok" : `\n❌ ${falhas} falha(s)`,
);
process.exit(falhas === 0 ? 0 : 1);
