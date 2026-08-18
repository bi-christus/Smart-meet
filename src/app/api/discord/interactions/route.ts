/**
 * O bot: a porta por onde o Discord fala com o Smart Meet.
 *
 * ESTA ROTA É PÚBLICA POR OBRIGAÇÃO. O Discord a chama de fora, sem token
 * nosso, sem sessão, sem cookie. O que a protege é UMA COISA SÓ: a assinatura
 * Ed25519 de `src/lib/server/discord-assinatura.ts`, conferida antes de
 * qualquer leitura do corpo. Sem ela, qualquer pessoa na internet manda um POST
 * dizendo ser o Discord e liga a própria conta ao e-mail de quem quiser.
 *
 * Quem for mexer aqui: a conferência vem PRIMEIRO, sobre o corpo CRU, e o
 * `JSON.parse` só acontece depois. Ler o JSON antes para "decidir se precisa
 * verificar" é o jeito de abrir a porta sem perceber.
 *
 * POR QUE 401 E NÃO 403 na assinatura inválida: é o código que o Discord exige.
 * Ele testa a URL com uma assinatura propositalmente errada no momento em que
 * ela é salva no portal, e só aceita o endpoint se levar 401. Uma rota que
 * responde 200 para assinatura inválida passa nesse cadastro — e é aí que o
 * defeito passa despercebido, porque tudo parece configurado.
 *
 * TRÊS SEGUNDOS. É o prazo do Discord para a resposta inicial. Tudo aqui é uma
 * transação curta; nada de chamada externa, nada de varredura.
 */
import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { adminDb } from "@/lib/server/drive-server";
import { assinaturaConfere } from "@/lib/server/discord-assinatura";
import {
  TIPO_INTERACAO,
  codigoValido,
  expirado,
  lerComando,
  normalizarCodigo,
  respostaEfemera,
  respostaPong,
  type ComandoRecebido,
} from "@/lib/discord-vinculo-core";

export const runtime = "nodejs";

/** Onde os códigos de vínculo esperam. Só o servidor enxerga (ver as regras). */
const COL_CODIGOS = "discordCodigos";

async function vincular(
  db: Firestore,
  cmd: ComandoRecebido,
): Promise<string> {
  const codigo = normalizarCodigo(cmd.opcoes.codigo ?? "");
  if (!codigoValido(codigo)) {
    return "Esse código não tem a cara de um código do Smart Meet. Abra o seu Perfil no app, toque em **Conectar Discord** e use o código que aparece lá.";
  }

  const codRef = db.collection(COL_CODIGOS).doc(codigo);
  const usuarios = db.collection("users");

  let email = "";
  let desligou = 0;

  await db.runTransaction(async (tx) => {
    // Todas as leituras antes de qualquer escrita — exigência do Firestore.
    const cod = await tx.get(codRef);
    if (!cod.exists) throw new Error("nao-encontrado");

    const dados = cod.data() as { email?: string; criadoEm?: number };
    email = (dados.email ?? "").trim().toLowerCase();
    if (!email) throw new Error("nao-encontrado");
    if (expirado(dados.criadoEm ?? 0, Date.now())) throw new Error("expirado");

    const userRef = usuarios.doc(email);
    const user = await tx.get(userRef);
    if (!user.exists || user.data()?.active !== true) {
      throw new Error("sem-acesso");
    }

    // Uma conta do Discord responde por UMA pessoa do Smart Meet. Sem isto,
    // duas demandas de donos diferentes mencionariam o mesmo @, e não haveria
    // como saber qual das duas era para quem — a menção deixaria de ser
    // endereço e viraria enfeite.
    //
    // A escolha é MUDAR o vínculo, não recusar: quem digitou o comando provou
    // as duas pontas (o código veio da sessão do Smart Meet, o id veio do
    // Discord). Recusar mandaria a pessoa desvincular primeiro, e ela chegaria
    // aqui sem saber que existia um vínculo antigo.
    const anteriores = await tx.get(usuarios.where("discordId", "==", cmd.discordId));

    // ---- daqui para baixo, só escrita ----
    anteriores.forEach((d) => {
      if (d.id === email) return;
      desligou++;
      tx.update(d.ref, {
        discordId: FieldValue.delete(),
        discordUser: FieldValue.delete(),
      });
    });

    tx.update(userRef, {
      discordId: cmd.discordId,
      discordUser: cmd.discordNome,
    });
    // Uso único: o código morre no mesmo instante em que serve. Deixá-lo vivo
    // pelos dez minutos restantes daria uma segunda chance a quem tivesse visto
    // a tela por cima do ombro.
    tx.delete(codRef);

    tx.create(db.collection("logs").doc(), {
      tipo: "discord.vinculado",
      por: email,
      em: new Date(),
      discordId: cmd.discordId,
      discordUser: cmd.discordNome,
      substituiu: desligou,
    });
  });

  const aviso = desligou
    ? "\n\nEsta conta do Discord estava ligada a outro cadastro; a ligação anterior foi desfeita."
    : "";
  return `Pronto — **${cmd.discordNome}** agora responde por \`${email}\` no Smart Meet. Você vai ser mencionado nos avisos das demandas onde for o responsável.${aviso}`;
}

async function desvincular(
  db: Firestore,
  cmd: ComandoRecebido,
): Promise<string> {
  const achados = await db
    .collection("users")
    .where("discordId", "==", cmd.discordId)
    .get();

  if (achados.empty) {
    return "Esta conta do Discord não está ligada a nenhum cadastro do Smart Meet — nada a desfazer.";
  }

  const lote = db.batch();
  achados.forEach((d) => {
    lote.update(d.ref, {
      discordId: FieldValue.delete(),
      discordUser: FieldValue.delete(),
    });
    lote.create(db.collection("logs").doc(), {
      tipo: "discord.desvinculado",
      por: d.id,
      em: new Date(),
      discordId: cmd.discordId,
    });
  });
  await lote.commit();

  return "Desfeito. Você não será mais mencionado nos avisos das demandas. Para ligar de novo, gere um código novo no seu Perfil.";
}

export async function POST(req: Request) {
  // O corpo CRU, e é ele que a assinatura cobre. Um `req.json()` seguido de
  // `JSON.stringify` reordena chaves e reformata números — a assinatura deixa
  // de bater por um espaço, e o sintoma é "a aplicação não respondeu".
  const corpoCru = await req.text();

  if (
    !assinaturaConfere({
      chavePublicaHex: process.env.DISCORD_PUBLIC_KEY,
      assinaturaHex: req.headers.get("x-signature-ed25519"),
      timestamp: req.headers.get("x-signature-timestamp"),
      corpoCru,
    })
  ) {
    return new NextResponse("assinatura invalida", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(corpoCru);
  } catch {
    return new NextResponse("corpo invalido", { status: 400 });
  }

  // O aperto de mão. O Discord manda um PING ao salvar a URL no portal e a cada
  // tanto depois disso; responder qualquer outra coisa derruba o endpoint.
  if ((payload as { type?: number })?.type === TIPO_INTERACAO.PING) {
    return NextResponse.json(respostaPong());
  }

  const cmd = lerComando(payload);
  if (!cmd) {
    return NextResponse.json(
      respostaEfemera("Não entendi esse comando. Tente `/vincular` ou `/desvincular`."),
    );
  }

  try {
    const db = adminDb();
    if (cmd.nome === "vincular") {
      return NextResponse.json(respostaEfemera(await vincular(db, cmd)));
    }
    if (cmd.nome === "desvincular") {
      return NextResponse.json(respostaEfemera(await desvincular(db, cmd)));
    }
    return NextResponse.json(
      respostaEfemera("Esse comando não existe mais por aqui."),
    );
  } catch (e) {
    // A pessoa está esperando dentro do Discord: toda falha vira frase, nunca
    // um erro HTTP. Um 500 aqui aparece para ela como "a aplicação não
    // respondeu", que não diz o que fazer a seguir.
    const motivo = e instanceof Error ? e.message : "";
    const frase =
      motivo === "nao-encontrado"
        ? "Esse código não existe ou já foi usado. Gere um novo no seu Perfil, dentro do Smart Meet."
        : motivo === "expirado"
          ? "Esse código passou da validade. Gere um novo no seu Perfil — ele vale por 10 minutos."
          : motivo === "sem-acesso"
            ? "O cadastro ligado a esse código não está ativo no Smart Meet. Fale com o administrador."
            : "Deu erro aqui do nosso lado. Tente de novo em alguns segundos.";
    if (!["nao-encontrado", "expirado", "sem-acesso"].includes(motivo)) {
      console.error("discord/interactions:", e);
    }
    return NextResponse.json(respostaEfemera(frase));
  }
}
