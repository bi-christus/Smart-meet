/**
 * O cadastro de dimensões e subdimensões — o modelo, sem o banco.
 *
 * Módulo puro (AGENTS.md §4): nada de `firebase/firestore` aqui dentro. Quem
 * fala com o banco é `dimensoes.ts`, o irmão, e é isto que permite
 * `scripts/test-dimensoes.mjs` conferir a régua do cadastro em Node puro.
 *
 * PARA QUE ISTO SERVE HOJE. A dimensão é a CLASSIFICAÇÃO da demanda: o
 * formulário do card pergunta onde ela entra, a Ata exige uma antes de abrir
 * demanda, e a pauta mostra o nome ao lado de cada linha. O cadastro é mantido
 * em Admin › Dimensões.
 *
 * A ABA DIMENSÕES, que desenhava a árvore `setor → dimensão → subdimensão →
 * demanda` com métricas por galho, foi removida em 06/10/2026, e com ela a
 * montagem da árvore que morava neste arquivo. A classificação gravada nos
 * cards não mudou; a versão anterior está na tag `v1.0`.
 *
 * É CADASTRO, não constante em código, pelo motivo que o AGENTS.md §4 já
 * registrou sobre `DEFAULT_SECTORS`: árvore que só o deploy muda não é
 * cadastro, é código com nome de dado — e a Infra tem 34 subdimensões que
 * mudam sozinhas, sem passar por ninguém que saiba abrir um PR.
 *
 * AS SUBDIMENSÕES MORAM DENTRO DO DOCUMENTO DA DIMENSÃO, num array, e não em
 * subcoleção. São poucas (a maior dimensão da Infra tem onze), são SEMPRE lidas
 * junto com a mãe — não existe tela que queira uma subdimensão sem saber de
 * quem ela é — e subcoleção custaria uma consulta por dimensão a cada abertura
 * do formulário, mais uma regra própria em `firestore.rules`. É a mesma
 * decisão, pelo mesmo motivo, que `links` dentro do card (ver o comentário do
 * campo em `kanban.ts`).
 */

/**
 * Uma subdimensão é PROJETO ou ROTINA, e a diferença não é decorativa.
 *
 * A ata registra o pedido nestas palavras: um item de subdimensão "pode virar
 * projeto ou ficar estático, como uma caixa que abriga vários trabalhos".
 * Projeto tem fim, então tem porcentagem de conclusão. Rotina não termina —
 * medir "40% da limpeza de banheiros" é inventar um fim que não existe. Quem
 * fazia essa conta era a árvore da aba Dimensões, removida; o tipo continua no
 * cadastro porque é parte do que o Admin registra sobre a subdimensão.
 */
export type TipoDeSub = "projeto" | "rotina";

export const TIPO_LABEL: Record<TipoDeSub, string> = {
  projeto: "Projeto",
  rotina: "Rotina",
};

export type Subdimensao = {
  /** Único dentro da dimensão, e NUNCA reaproveitado — ver `proximoIdDeSub`. */
  id: string;
  nome: string;
  tipo: TipoDeSub;
};

export type Dimensao = {
  /** id do documento. */
  id: string;
  /** Setor de execução dono desta dimensão. */
  setor: string;
  nome: string;
  /** Posição na árvore. Empate desempata pelo nome — ver `ordenarDimensoes`. */
  ordem: number;
  subs: Subdimensao[];
};

/** Quanto cabe no nome de uma dimensão ou subdimensão. Espelhado nas regras. */
export const LIMITE_NOME_CHARS = 70;

/**
 * A cor de uma dimensão sai da POSIÇÃO dela, não de um campo escolhido à mão.
 *
 * São os mesmos oito passos da paleta categórica do Dashboard, que foram
 * validados para daltonismo nas duas superfícies do app (o comentário longo
 * está em `dashboard.module.css`). Deixar o gestor escolher a cor produziria,
 * na terceira dimensão cadastrada, duas faixas que ninguém separa — e a cor
 * aqui não é enfeite: é o que identifica a dimensão no Admin e na pauta da Ata.
 */
export const PALETA_DIMENSAO = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#9085e9",
  "#c98500",
  "#d55181",
  "#008300",
  "#e66767",
] as const;

export function corDaDimensao(ordem: number): string {
  // `%` de número negativo é negativo em JS, e ordem negativa é o que um
  // documento editado à mão no console pode ter.
  const i = ((Math.trunc(ordem) % PALETA_DIMENSAO.length) + PALETA_DIMENSAO.length) %
    PALETA_DIMENSAO.length;
  return PALETA_DIMENSAO[i];
}

// ---------------------------------------------------------------------------
// Conferência de nome
// ---------------------------------------------------------------------------

export type NomeConferido =
  | { ok: true; nome: string }
  | { ok: false; motivo: string };

/**
 * A régua do campo, aplicada ANTES do banco.
 *
 * Mesmo motivo de `conferirNomeDeSetor` em `setores-core.ts`: a regra do
 * Firestore é a segunda barreira e só sabe responder "sem permissão", que é a
 * mensagem errada para quem digitou um espaço. O teto é o mesmo dos dois lados,
 * e `test-dimensoes.mjs` reprova se um andar sem o outro.
 */
export function conferirNome(bruto: unknown, oQue: string): NomeConferido {
  if (typeof bruto !== "string") return { ok: false, motivo: `Informe o nome ${oQue}.` };
  const nome = bruto.trim();
  if (!nome) return { ok: false, motivo: `Informe o nome ${oQue}.` };
  if (nome.length > LIMITE_NOME_CHARS) {
    return { ok: false, motivo: `O nome passa de ${LIMITE_NOME_CHARS} caracteres.` };
  }
  return { ok: true, nome };
}

/**
 * Este nome já está na lista? Devolve o que está gravado, se estiver.
 *
 * Compara sem diferenciar caixa nem acento sobrando, pelo mesmo motivo de
 * `setorExistente`: "Brigada" e "brigada" cadastradas em semanas diferentes
 * viram duas caixas, e cada uma leva metade das demandas.
 */
export function nomeExistente<T extends { nome: string }>(
  nome: string,
  lista: readonly T[],
): T | undefined {
  const alvo = nome.trim().toLowerCase();
  return lista.find((x) => x.nome.trim().toLowerCase() === alvo);
}

/**
 * O próximo id de subdimensão, que NUNCA repete um já usado.
 *
 * Não é o índice do array, e essa é a decisão inteira deste helper: a demanda
 * guarda o id da subdimensão, e apagar a segunda de cinco faria a terceira
 * virar índice 2 — todas as demandas da terceira passariam a apontar para o
 * lugar da que foi apagada, em silêncio. Contar do maior número já emitido
 * resolve isso mesmo depois de exclusões, porque o maior não diminui quando
 * alguém sai do meio.
 */
export function proximoIdDeSub(subs: readonly Subdimensao[]): string {
  let maior = 0;
  for (const s of subs) {
    const n = Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0);
    if (Number.isFinite(n) && n > maior) maior = n;
  }
  return `s${maior + 1}`;
}

// ---------------------------------------------------------------------------
// Leitura do banco
// ---------------------------------------------------------------------------

function texto(v: unknown, padrao = ""): string {
  return typeof v === "string" ? v.trim() : padrao;
}

/**
 * Lê o documento como se ele pudesse estar em qualquer estado — porque pode.
 *
 * É um documento que um gestor edita, que o console do Firebase permite alterar
 * à mão e que uma versão futura deste app pode ter escrito com outro formato. A
 * escolha aqui é a OPOSTA à de `normalizarPermissoes`: lá, dado ilegível vira o
 * padrão ABERTO, porque trancar o app inteiro é pior do que uma aba a mais na
 * tela. Aqui, dado ilegível é DESCARTADO — uma subdimensão sem nome não é
 * mostrada, e é isso mesmo que se quer: ela não tem como ser lida, clicada nem
 * explicada, e desenhá-la em branco no meio da árvore só faria alguém procurar
 * o defeito na tela em vez de no cadastro.
 *
 * O que NÃO é descartado é a dimensão inteira por causa de uma subdimensão
 * torta: as outras dez continuam desenhando.
 */
export function normalizarDimensao(id: string, bruto: unknown): Dimensao | null {
  if (!bruto || typeof bruto !== "object") return null;
  const d = bruto as Record<string, unknown>;
  const nome = texto(d.nome);
  const setor = texto(d.setor);
  if (!nome || !setor) return null;

  const vistos = new Set<string>();
  const subs: Subdimensao[] = [];
  if (Array.isArray(d.subs)) {
    for (const bs of d.subs) {
      if (!bs || typeof bs !== "object") continue;
      const s = bs as Record<string, unknown>;
      const sid = texto(s.id);
      const snome = texto(s.nome);
      // Id repetido é pior do que id ausente: as duas subdimensões passariam a
      // receber as mesmas demandas, e a segunda apareceria sempre vazia.
      if (!sid || !snome || vistos.has(sid)) continue;
      vistos.add(sid);
      subs.push({
        id: sid,
        nome: snome,
        tipo: s.tipo === "projeto" ? "projeto" : "rotina",
      });
    }
  }

  const ordem = typeof d.ordem === "number" && Number.isFinite(d.ordem) ? d.ordem : 0;
  return { id, setor, nome, ordem, subs };
}

/** A ordem da árvore. Empate no número desempata pelo nome, nunca pelo acaso. */
export function ordenarDimensoes(dims: readonly Dimensao[]): Dimensao[] {
  return [...dims].sort(
    (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"),
  );
}
