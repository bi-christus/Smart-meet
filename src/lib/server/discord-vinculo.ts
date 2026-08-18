/**
 * Ligar uma conta do Discord a um cadastro do Smart Meet — a escrita, num lugar
 * só.
 *
 * POR QUE ISTO SAIU DE DENTRO DA ROTA. A regra nasceu dentro de
 * `api/discord/interactions`, quando `/vincular <codigo>` era o único caminho.
 * O vínculo em um clique abriu um segundo, e copiar a transação para lá criaria
 * duas versões de "o que acontece ao vincular" — que envelheceriam separadas.
 * A cara do defeito seria feia e silenciosa: um dos caminhos deixaria de
 * desligar o vínculo anterior, e duas pessoas passariam a receber a menção uma
 * da outra sem nada ficar vermelho.
 *
 * O que cada caminho ainda faz sozinho é PROVAR quem é quem — o comando prova
 * pelo código, o clique prova pela sessão mais a troca de token com o Discord.
 * Daqui para baixo as duas provas já valem o mesmo, e o que sobra é escrever.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

/** De onde veio o vínculo. Vai para o log, e só para o log. */
export type OrigemDoVinculo = "comando" | "clique";

export class VinculoRecusado extends Error {}

export type ResultadoDoVinculo = {
  /** Quantos cadastros perderam esta conta do Discord no caminho. */
  desligou: number;
};

/**
 * Grava o vínculo. Lança `VinculoRecusado("sem-acesso")` para cadastro inativo.
 *
 * UMA CONTA DO DISCORD RESPONDE POR UMA PESSOA. Sem isso, duas demandas de
 * donos diferentes mencionariam o mesmo `@`, e não haveria como saber qual era
 * para quem — a menção deixaria de ser endereço e viraria enfeite.
 *
 * E a escolha é MUDAR o vínculo, não recusar: quem chegou até aqui provou as
 * duas pontas. Recusar mandaria a pessoa desvincular primeiro, e ela chegaria
 * lá sem saber que existia um vínculo antigo.
 */
export async function ligarConta(
  db: Firestore,
  args: {
    email: string;
    discordId: string;
    discordNome: string;
    origem: OrigemDoVinculo;
  },
): Promise<ResultadoDoVinculo> {
  const email = args.email.trim().toLowerCase();
  const usuarios = db.collection("users");
  let desligou = 0;

  await db.runTransaction(async (tx) => {
    // Todas as leituras antes de qualquer escrita — exigência do Firestore.
    const userRef = usuarios.doc(email);
    const user = await tx.get(userRef);
    if (!user.exists || user.data()?.active !== true) {
      throw new VinculoRecusado("sem-acesso");
    }

    const anteriores = await tx.get(
      usuarios.where("discordId", "==", args.discordId),
    );

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
      discordId: args.discordId,
      discordUser: args.discordNome,
    });

    tx.create(db.collection("logs").doc(), {
      tipo: "discord.vinculado",
      por: email,
      em: new Date(),
      discordId: args.discordId,
      discordUser: args.discordNome,
      substituiu: desligou,
      origem: args.origem,
    });
  });

  return { desligou };
}
