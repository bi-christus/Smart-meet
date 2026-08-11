/**
 * Tags que apontam para algo — e continuam apontando depois do rename.
 *
 * Moradia em módulo puro, como `kanban-columns`: aqui não entra o SDK do
 * Firestore, então a regra pode ser testada por `scripts/test-tags-ref.mjs` sem
 * subir nada. Quem escreve no banco é `kanban.ts`.
 *
 * O PROBLEMA que isto resolve: a tag é texto. Marcar uma demanda com o nome de
 * outra ("Portal do aluno") guardava uma CÓPIA do nome. No dia em que alguém
 * renomeasse a demanda original, todas as cópias continuariam mostrando o nome
 * velho — a referência estava perdida e ninguém era avisado.
 *
 * A saída é guardar o `id` ao lado do texto. O texto continua sendo o que a
 * busca do quadro, o relatório e o catálogo do cowork leem (nenhum deles sabe
 * resolver id); o `id` é o que sobrevive ao rename.
 */

export type TagRef = {
  tipo: "demanda" | "setor";
  /** id do documento do alvo — é isto que não muda quando o nome muda */
  id: string;
  /** última cópia conhecida do nome; é o que sobra quando o alvo é apagado */
  texto: string;
};

/** O mínimo que `resolverTags` precisa enxergar de um card. */
export type ComTags = {
  tags?: string[];
  tagRefs?: TagRef[];
};

/**
 * Devolve o card com as tags de referência no nome ATUAL do alvo.
 *
 * `titulos` e `setores` são mapas de id para nome corrente. Referência sem alvo
 * (demanda apagada, setor removido do cadastro) mantém o texto guardado: é a
 * única coisa que sobrou, e apagar a tag seria perder também o registro de que
 * ela existiu.
 *
 * Devolve o MESMO objeto quando nada mudou — o resultado alimenta memos e
 * listas, e trocar a identidade à toa custa render.
 */
export function resolverTags<T extends ComTags>(
  card: T,
  titulos: Map<string, string>,
  setores: Map<string, string>,
): T {
  const refs = card.tagRefs;
  const antigas = card.tags;
  if (!refs?.length || !antigas?.length) return card;

  let mudou = false;
  const tags = antigas.map((t) => {
    const ref = refs.find((r) => r.texto === t);
    if (!ref) return t;
    const atual =
      ref.tipo === "demanda" ? titulos.get(ref.id) : setores.get(ref.id);
    if (!atual || atual === t) return t;
    mudou = true;
    return atual;
  });
  if (!mudou) return card;

  // O rename pode ter feito a referência bater com uma tag que o card já tinha
  // ("Portal do aluno" virou "Portal", e "Portal" já estava lá). Duas tags
  // iguais viram dois chips repetidos numa lista renderizada por texto — a
  // chave repetiria. Fica uma só.
  const unicas = tags.filter((t, i) => tags.indexOf(t) === i);

  const vistos = new Set<string>();
  const tagRefs = refs
    .map((r) => {
      const i = antigas.indexOf(r.texto);
      return i === -1 ? r : { ...r, texto: tags[i] };
    })
    // Pelo mesmo motivo: duas referências para o mesmo texto tornariam ambíguo
    // para quem a tag aponta. Vale a primeira.
    .filter((r) => {
      if (vistos.has(r.texto) || !unicas.includes(r.texto)) return false;
      vistos.add(r.texto);
      return true;
    });

  return { ...card, tags: unicas, tagRefs };
}
