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
 * TRÊS SEGUNDOS. É o prazo do Discord para a resposta inicial, e é ele que
 * limita o que cabe aqui dentro: transação curta, consulta por campo único, teto
 * baixo de documentos. Nada de chamada externa e nada de varredura. Os tetos das
 * consultas moram em `server/discord-consulta.ts`, com o motivo.
 */
import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { adminDb } from "@/lib/server/drive-server";
import { assinaturaConfere } from "@/lib/server/discord-assinatura";
import { ligarConta } from "@/lib/server/discord-vinculo";
import { appUrl } from "@/lib/server/discord-aviso";
import {
  cadastroDe,
  demandasDe,
  demandasDoSetor,
} from "@/lib/server/discord-consulta";
import { montarBusca, montarMinhasDemandas } from "@/lib/discord-consulta-core";
import { hojeNoFuso } from "@/lib/datas";
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

  // O CÓDIGO É CONSUMIDO NUMA TRANSAÇÃO PRÓPRIA, antes da escrita do vínculo.
  //
  // Antes as duas coisas moravam na mesma transação, e isso foi desfeito de
  // propósito quando o vínculo em um clique apareceu: a escrita passou a ser
  // compartilhada (`ligarConta`), e arrastar a leitura do código para dentro
  // dela obrigaria o outro caminho a fingir que tem um código.
  //
  // O preço é conhecido e aceito: se o cadastro estiver inativo, o código
  // morre junto com a recusa e a pessoa precisa gerar outro. A alternativa —
  // apagar só depois de o vínculo dar certo — deixaria o código VIVO durante a
  // escrita, e é justamente a janela em que o uso único deixa de ser único.
  // Entre "gerar outro código" e "o mesmo segredo servindo duas vezes", a
  // escolha não é difícil.
  let email = "";
  await db.runTransaction(async (tx) => {
    const cod = await tx.get(codRef);
    if (!cod.exists) throw new Error("nao-encontrado");

    const dados = cod.data() as { email?: string; criadoEm?: number };
    email = (dados.email ?? "").trim().toLowerCase();
    if (!email) throw new Error("nao-encontrado");
    if (expirado(dados.criadoEm ?? 0, Date.now())) throw new Error("expirado");

    tx.delete(codRef);
  });

  const { desligou } = await ligarConta(db, {
    email,
    discordId: cmd.discordId,
    discordNome: cmd.discordNome,
    origem: "comando",
  });

  const aviso = desligou
    ? "\n\nEsta conta do Discord estava ligada a outro cadastro; a ligação anterior foi desfeita."
    : "";
  return `Pronto — **${cmd.discordNome}** agora responde por \`${email}\` no Smart Meet. Você vai ser mencionado nos avisos das demandas onde for o responsável, e receber aqui no privado o que mexer nelas.${aviso}`;
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

/** A frase de quem ainda não ligou as contas. Uma só, para as duas consultas. */
const SEM_VINCULO =
  "Esta conta do Discord ainda não está ligada ao Smart Meet, então não sei quais demandas são suas. " +
  "Abra o seu Perfil no app e toque em **Conectar Discord** — leva um clique. " +
  "Se preferir, gere um código lá e use `/vincular <codigo>` aqui.";

async function minhasDemandas(
  db: Firestore,
  cmd: ComandoRecebido,
): Promise<string> {
  const quem = await cadastroDe(db, cmd.discordId);
  if (!quem) return SEM_VINCULO;

  return montarMinhasDemandas({
    cards: await demandasDe(db, quem.email),
    hoje: hojeNoFuso(),
    appUrl: appUrl(),
  });
}

async function buscarDemanda(
  db: Firestore,
  cmd: ComandoRecebido,
): Promise<string> {
  const quem = await cadastroDe(db, cmd.discordId);
  if (!quem) return SEM_VINCULO;

  // Os setores da PESSOA, e não o quadro inteiro: a busca não pode virar a
  // porta pela qual alguém lê a demanda de um setor onde não entra. É a mesma
  // fronteira que as telas respeitam (`permissoes.ts`), aplicada aqui.
  //
  // O corte em três é orçamento de tempo, não de permissão — ver a nota dos
  // três segundos em `server/discord-consulta.ts`. Hoje ninguém tem mais de um.
  const setores = quem.sectors.slice(0, 3);
  if (setores.length === 0) {
    return "O seu cadastro no Smart Meet ainda não está em nenhum setor. Fale com o administrador.";
  }

  const listas = await Promise.all(
    setores.map((s) => demandasDoSetor(db, s)),
  );

  return montarBusca({
    termo: cmd.opcoes.busca ?? "",
    cards: listas.flat(),
    hoje: hojeNoFuso(),
    appUrl: appUrl(),
  });
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
      respostaEfemera(
        "Não entendi esse comando. Os que existem são `/minhas-demandas`, `/demanda`, `/vincular` e `/desvincular`.",
      ),
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
    if (cmd.nome === "minhas-demandas") {
      return NextResponse.json(respostaEfemera(await minhasDemandas(db, cmd)));
    }
    if (cmd.nome === "demanda") {
      return NextResponse.json(respostaEfemera(await buscarDemanda(db, cmd)));
    }
    return NextResponse.json(
      respostaEfemera("Esse comando não existe mais por aqui."),
    );
  } catch (e) {
    // A pessoa está esperando dentro do Discord: toda falha vira frase, nunca
    // um erro HTTP. Um 500 aqui aparece para ela como "a aplicação não
    // respondeu", que não diz o que fazer a seguir.
    // `VinculoRecusado` (de `server/discord-vinculo.ts`) é subclasse de `Error`
    // e traz o motivo na mensagem, então cai aqui junto com os locais.
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
