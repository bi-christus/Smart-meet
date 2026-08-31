/**
 * "O que está na tela já é diferente do que está gravado?" — sem Firebase.
 *
 * Existe porque o modal da demanda fechava no clique fora e jogava fora tudo o
 * que tinha sido digitado, calado. A pergunta parece trivial e não é: a resposta
 * tem de concordar, campo a campo, com o que o botão Salvar de fato grava.
 *
 * Um teste de sujeira que discorda do salvamento erra dos dois lados, e os dois
 * são ruins. Se ele é mais sensível, pergunta "descartar alterações?" para quem
 * não alterou nada — e, na terceira vez, a pessoa aprende a clicar em "descartar"
 * sem ler, que é exatamente o hábito que faz a proteção não proteger. Se é menos
 * sensível, deixa passar em silêncio o campo que ele não considerou, que é o bug
 * original de volta e agora com uma tela dizendo que está tudo bem.
 *
 * Por isso `mesmoValor` mora aqui e é O MESMO que o `submit` usa para montar o
 * patch: a comparação que decide se há o que perder é, literalmente, a que
 * decide o que vai para o banco.
 */

/** O formulário reduzido ao que é gravado: nomes de campo para valores. */
export type Rascunho = Record<string, unknown>;

/**
 * Igualdade do ponto de vista do BANCO, não do JavaScript.
 *
 * `undefined`, `null` e `""` são a mesma coisa aqui — o formulário devolve `""`
 * onde o Firestore guarda `null`, e tratá-los como diferentes marcaria como
 * alterado todo campo opcional que ninguém tocou. Objetos e listas comparam por
 * JSON, o que é sensível à ORDEM: para `tags` e `checklist` isso é o certo, já
 * que reordenar é uma alteração de verdade e o banco guarda a ordem.
 */
export function mesmoValor(a: unknown, b: unknown): boolean {
  const vazio = (v: unknown) => v === undefined || v === null || v === "";
  if (vazio(a) && vazio(b)) return true;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return a === b;
}

/**
 * Os campos que diferem, na ordem em que aparecem em `atual`.
 *
 * A ordem importa: ela vira a frase que a pessoa lê ("título, prazo e mais 2"),
 * e a ordem das chaves do objeto do formulário é a ordem dos campos na tela.
 * Ordenar alfabeticamente daria uma lista que não corresponde a nada visível.
 */
export function camposMudados(base: Rascunho, atual: Rascunho): string[] {
  return Object.keys(atual).filter((k) => !mesmoValor(base[k], atual[k]));
}

export function houveMudanca(base: Rascunho, atual: Rascunho): boolean {
  return Object.keys(atual).some((k) => !mesmoValor(base[k], atual[k]));
}

/** Nome de tela de cada campo do formulário da demanda. */
export const CAMPO_LABEL: Record<string, string> = {
  title: "título",
  description: "descrição",
  columnId: "etapa",
  type: "tipo",
  priority: "prioridade",
  assignee: "responsável",
  requester: "solicitante",
  requesterSector: "setor solicitante",
  dimensaoId: "dimensão",
  subdimensaoId: "subdimensão",
  startDate: "início",
  due: "prazo",
  tags: "tags",
  tagRefs: "referências das tags",
  checklist: "checklist",
  links: "links",
};

/**
 * "título e prazo" · "título, prazo e mais 2" — o que se perde, por extenso.
 *
 * Até três nomes, e o resto vira contagem. A frase é o que sustenta a decisão:
 * "descartar alterações?" sozinho obriga a pessoa a lembrar no que mexeu, e
 * quem passou dez minutos num formulário já não lembra. Listar os quinze
 * campos, por outro lado, daria um parágrafo que ninguém lê — e a pergunta é
 * respondida no primeiro segundo ou não é respondida.
 *
 * Campo sem rótulo conhecido entra pelo próprio nome em vez de sumir: some é
 * como a contagem e a lista passariam a discordar caladas no dia em que alguém
 * acrescentar um campo ao formulário e esquecer o rótulo.
 */
export function resumoDosCampos(campos: string[]): string {
  const nomes = campos.map((c) => CAMPO_LABEL[c] ?? c);
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  if (nomes.length === 3) return `${nomes[0]}, ${nomes[1]} e ${nomes[2]}`;
  const restantes = nomes.length - 2;
  return `${nomes[0]}, ${nomes[1]} e mais ${restantes}`;
}
