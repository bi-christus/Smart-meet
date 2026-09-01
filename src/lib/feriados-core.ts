/**
 * Feriados nacionais — calculados, nunca listados.
 *
 * A tentação aqui é uma tabela: escrever as datas dos próximos anos e seguir a
 * vida. Ela falha de um jeito específico e cruel — em silêncio. No dia em que a
 * tabela acaba, o calendário não quebra, não avisa, não fica vermelho: ele passa
 * a desenhar dezembro sem o Natal, e um mês sem feriado é indistinguível de um
 * mês em que ninguém atualizou a lista. Quem olha não tem como saber. Por isso
 * este módulo CALCULA: os fixos saem do dia e do mês, e os móveis saem da
 * Páscoa, que tem fórmula fechada e vale para qualquer ano.
 *
 * Só o âmbito NACIONAL mora aqui. O Ceará tem data magna própria (25 de março) e
 * cada município pode declarar até quatro feriados religiosos mais o aniversário
 * da cidade (Lei 9.093/1995) — nada disso está neste arquivo, e a ausência é
 * escolha: uma tabela municipal sem o dado de qual unidade da Rede está em qual
 * cidade afirmaria sobre Fortaleza o que vale para Sobral.
 *
 * Sem dependência de Firebase nem de React — roda igual no navegador e no
 * `node scripts/test-feriados.mjs`. Toda data entra e sai como ISO curto
 * (aaaa-mm-dd), o formato que o resto do app já usa; nada aqui chama
 * `new Date(iso)`, pela razão explicada no cabeçalho de `datas.ts`.
 *
 * DUAS AUSÊNCIAS DELIBERADAS, que o revisor deve cobrar se aparecerem:
 *
 * 1. Nenhuma função recebe `Date`. Quem tem um `Date` na mão passa por `toISO`
 *    primeiro. Aceitar os dois convidaria alguém a escrever `new Date(iso)` no
 *    meio do caminho, que é o dia perdido que `datas.ts` existe para evitar.
 * 2. Nenhum `ehDiaUtil` aqui. `datas.ts` é quem responde "é fim de semana?", e é
 *    ele que governa o prazo do formulário e o gerador de recorrências. Fazer
 *    aquelas funções consultarem feriado muda QUAIS PRAZOS o formulário aceita e
 *    para que dia a recorrência empurra — é decisão de produto com efeito em
 *    escrita de dado, e merece Issue própria. Até lá, feriado é informação de
 *    leitura na tela, e só.
 */

/**
 * A natureza jurídica do dia — e a razão de os dois conviverem na mesma lista.
 *
 * `feriado` tem lei declarando. `facultativo` é o Carnaval e o Corpus Christi,
 * que NÃO têm lei federal nenhuma: são ponto facultativo por portaria reeditada
 * todo ano, e feriado civil só onde houver lei municipal.
 *
 * Os dois entram porque a pergunta que o Cronograma faz é "vai ter alguém aqui?",
 * e a Rede fecha no Carnaval como fecha no Natal. Uma lista só com os nove
 * feriados de lei desenharia célula normal em dias de escola vazia — o erro mais
 * caro possível nesta tela. Mas a distinção sobrevive no tipo porque quem um dia
 * contar prazo trabalhista ou dia útil bancário precisa do recorte, e vai
 * encontrá-lo pronto em vez de reconstruí-lo errado.
 */
export type TipoFeriado = "feriado" | "facultativo";

/**
 * Se sobra trabalho no dia — e é este campo que salva a tela de mentir.
 *
 * Quarta-feira de Cinzas é facultativa só ATÉ as 14h; as vésperas de Natal e de
 * Ano-Novo, só A PARTIR das 13h. Nos três, meio setor está na mesa. Tratá-los
 * como dia inteiro parado está errado nos dois calendários — o civil e o
 * bancário, onde os bancos abrem na Cinzas por volta do meio-dia.
 *
 * É por causa deste campo que a célula do Cronograma chama `diaSemExpediente` e
 * não `feriadoDe`: desenhar um pato de férias num dia em que se trabalha de
 * manhã seria afirmação falsa, e as três datas continuam no módulo para quem
 * precisar delas.
 */
export type Expediente = "nenhum" | "meio";

export type Feriado = {
  /** aaaa-mm-dd, no calendário civil — não é `Date`, de propósito. */
  iso: string;
  /** O nome oficial. Vai para o `title` e para o leitor de tela. */
  nome: string;
  /**
   * O que cabe numa célula de um quinto de tela.
   *
   * Os dois campos existem porque, sem este, o dia mais visível de outubro fica
   * escrito "Nossa Senhora Apar…" — e um rótulo que termina em reticências no
   * meio de um nome próprio não informa, só ocupa.
   */
  curto: string;
  tipo: TipoFeriado;
  expediente: Expediente;
  /**
   * A lei ou a portaria, em uma linha.
   *
   * Não é enfeite: os nove fixos não vêm de um diploma só — Lei 662/1949 (com a
   * redação da Lei 10.607/2002) para sete deles, Lei 6.802/1980 para o 12 de
   * outubro e Lei 14.759/2023 para o 20 de novembro. Citar só a primeira
   * deixaria três feriados sem base, e no dia em que alguém contestar uma data o
   * campo responde sozinho.
   */
  base: string;
};

type Fixo = Omit<Feriado, "iso"> & {
  mes: number;
  dia: number;
  /**
   * Primeiro ano em que a data JÁ ERA feriado nacional.
   *
   * Existe por causa do 20 de novembro, que só virou feriado nacional com a Lei
   * 14.759, publicada em 22 de dezembro de 2023 e em vigor na data da
   * publicação — 2024 é o primeiro ano valendo. O Cronograma navega para trás
   * sem limite: dois cliques na seta e alguém está em 2022. Sem este campo, a
   * tela afirmaria que o país tinha um feriado que o país não tinha, e o faria
   * com a mesma cara de certeza com que acerta o resto.
   */
  desde: number;
};

/**
 * A Lei 662 original declarou CINCO datas: 1º de janeiro, 1º de maio, 7 de
 * setembro, 15 de novembro e 25 de dezembro. Tiradentes e Finados entraram
 * depois, por leis próprias, e por isso não usam esta string nem o `desde` dela
 * — ver os comentários de cada um.
 */
const LEI_662 = "Lei 662/1949 (redação da Lei 10.607/2002)";
const SEM_LEI_FEDERAL = "sem lei federal — ponto facultativo por portaria anual";

const FIXOS: Fixo[] = [
  {
    mes: 1,
    dia: 1,
    nome: "Confraternização Universal",
    curto: "Ano-Novo",
    tipo: "feriado",
    expediente: "nenhum",
    base: LEI_662,
    desde: 1949,
  },
  {
    mes: 4,
    dia: 21,
    nome: "Tiradentes",
    curto: "Tiradentes",
    tipo: "feriado",
    expediente: "nenhum",
    // NÃO é a Lei 662: o 21 de abril não estava nas cinco datas dela. Entrou
    // pelo art. 3º da Lei 1.266, de dezembro de 1950 — o primeiro Tiradentes
    // nacional é o de 1951.
    base: "Lei 1.266/1950",
    desde: 1951,
  },
  {
    mes: 5,
    dia: 1,
    nome: "Dia do Trabalho",
    curto: "Trabalho",
    tipo: "feriado",
    expediente: "nenhum",
    base: LEI_662,
    desde: 1949,
  },
  {
    mes: 9,
    dia: 7,
    nome: "Independência do Brasil",
    curto: "Independência",
    tipo: "feriado",
    expediente: "nenhum",
    base: LEI_662,
    desde: 1949,
  },
  {
    mes: 10,
    dia: 12,
    nome: "Nossa Senhora Aparecida, Padroeira do Brasil",
    curto: "Aparecida",
    tipo: "feriado",
    expediente: "nenhum",
    base: "Lei 6.802/1980",
    desde: 1980,
  },
  // O 28 de outubro (Dia do Servidor Público) NÃO está aqui, e a ausência é
  // decisão. Ele é dispensa INTEGRAL, mas só na administração pública federal —
  // e a Rede é privada. Marcá-lo `expediente: "meio"` esconderia o adesivo pelo
  // motivo certo com o fato errado: diria que se trabalha meio dia num dia em
  // que o órgão público fecha inteiro, e este campo responde "sobra trabalho no
  // dia?", não "convém desenhar?". Usar um campo de fato como chave de desenho é
  // como a tabela começa a mentir. Se um dia alguém precisar do calendário do
  // serviço público, ele entra com um eixo próprio de âmbito.
  {
    mes: 11,
    dia: 2,
    nome: "Finados",
    curto: "Finados",
    tipo: "feriado",
    expediente: "nenhum",
    // Também não é a Lei 662 original: o 2 de novembro só entrou com a Lei
    // 10.607, de 19 de dezembro de 2002 — DEPOIS do 2 de novembro daquele ano,
    // então o primeiro Finados nacional é o de 2003.
    base: "Lei 10.607/2002",
    desde: 2003,
  },
  {
    mes: 11,
    dia: 15,
    nome: "Proclamação da República",
    curto: "República",
    tipo: "feriado",
    expediente: "nenhum",
    base: LEI_662,
    desde: 1949,
  },
  {
    mes: 11,
    dia: 20,
    nome: "Dia Nacional de Zumbi e da Consciência Negra",
    curto: "Consciência Negra",
    tipo: "feriado",
    expediente: "nenhum",
    base: "Lei 14.759/2023",
    desde: 2024,
  },
  {
    mes: 12,
    dia: 24,
    nome: "Véspera de Natal",
    curto: "Véspera",
    tipo: "facultativo",
    expediente: "meio",
    base: SEM_LEI_FEDERAL,
    desde: 1949,
  },
  {
    mes: 12,
    dia: 25,
    nome: "Natal",
    curto: "Natal",
    tipo: "feriado",
    expediente: "nenhum",
    base: LEI_662,
    desde: 1949,
  },
  {
    mes: 12,
    dia: 31,
    nome: "Véspera de Ano-Novo",
    curto: "Véspera",
    tipo: "facultativo",
    expediente: "meio",
    base: SEM_LEI_FEDERAL,
    desde: 1949,
  },
];

type Movel = Omit<Feriado, "iso"> & {
  /** Dias somados ao domingo de Páscoa. Negativo é antes dele. */
  offset: number;
};

/**
 * Os móveis, todos ancorados no domingo de Páscoa.
 *
 * A âncora é a Páscoa e não o Carnaval porque é a Páscoa que tem fórmula: o
 * Carnaval é "47 dias antes da Páscoa", e não o contrário. E TODOS os offsets
 * partem dela, inclusive o do Corpus Christi. Os dois jeitos clássicos de errar
 * o Corpus Christi são contá-lo a partir da Sexta-feira Santa (erra por dois
 * dias) ou como "a quinta depois de Pentecostes" implementada de cabeça (erra
 * por sete). Uma âncora só, cinco constantes, nenhuma conta encadeada.
 */
const MOVEIS: Movel[] = [
  {
    offset: -48,
    nome: "Segunda-feira de Carnaval",
    curto: "Carnaval",
    tipo: "facultativo",
    expediente: "nenhum",
    base: SEM_LEI_FEDERAL,
  },
  {
    offset: -47,
    nome: "Terça-feira de Carnaval",
    curto: "Carnaval",
    tipo: "facultativo",
    expediente: "nenhum",
    base: SEM_LEI_FEDERAL,
  },
  {
    offset: -46,
    nome: "Quarta-feira de Cinzas (até as 14h)",
    curto: "Cinzas",
    tipo: "facultativo",
    expediente: "meio",
    base: SEM_LEI_FEDERAL,
  },
  {
    offset: -2,
    nome: "Sexta-feira Santa",
    curto: "Paixão",
    // O caso mais escorregadio da lista. Não existe lei federal declarando-a
    // feriado nacional: ela é o feriado religioso nominado no art. 2º da Lei
    // 9.093/1995, de declaração municipal. Na prática vale como nacional — a
    // portaria do Executivo e o calendário bancário a listam assim, e todo
    // município a adota. Fica como `feriado`, e a base conta a história para
    // quem for usar este módulo em conta trabalhista.
    tipo: "feriado",
    expediente: "nenhum",
    base: "Lei 9.093/1995, art. 2º — adotada nacionalmente",
  },
  {
    offset: 60,
    nome: "Corpus Christi",
    curto: "Corpus Christi",
    tipo: "facultativo",
    expediente: "nenhum",
    base: SEM_LEI_FEDERAL,
  },
];

/**
 * Domingo de Páscoa do ano, em ISO — computus GREGORIANO, pelo algoritmo
 * anônimo (Meeus/Jones/Butcher).
 *
 * As variáveis têm nome de letra porque é assim que o algoritmo é publicado, e
 * rebatizá-las para nomes "mais legíveis" quebraria a única coisa que torna este
 * bloco conferível: dá para pôr a fórmula ao lado da referência e comparar linha
 * a linha. Ninguém deriva este cálculo lendo o código — confere-se pelo teste,
 * que crava as datas de 2024 a 2033.
 *
 * É público, e não um detalhe interno, porque é a única aritmética não óbvia do
 * módulo e portanto a que o teste precisa atacar de frente. É também o que
 * protege contra a troca silenciosa pelo computus juliano, que em 2026 devolve
 * 12 de abril — uma semana depois, com os cinco móveis arrastados junto e nenhum
 * sintoma na tela.
 *
 * Vale de 1583 em diante (o calendário gregoriano começa em 1582) e não tem
 * limite superior — que é exatamente o motivo de ele estar aqui em vez de uma
 * tabela de anos.
 */
export function domingoDePascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDe(ano, mes, dia);
}

function isoDe(ano: number, mes: number, dia: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${p(mes)}-${p(dia)}`;
}

/**
 * Soma dias a uma data ISO sem passar por fuso nenhum.
 *
 * `Date.UTC` e `getUTC*` dos dois lados: a conta é de calendário — "47 dias
 * antes de 5 de abril" — e não de instante no tempo. Fazê-la em horário local
 * colocaria uma virada de horário de verão no meio de um intervalo de 60 dias, e
 * o Corpus Christi cairia numa quarta-feira em alguns anos. Aqui o UTC não é
 * fuso: é a ausência dele.
 */
function somaDias(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoDe(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Data + descrição viram um registro.
 *
 * Escrito campo a campo, e não com espalhamento do resto: `Fixo` carrega `mes`,
 * `dia` e `desde`, que são a REGRA de quando o feriado acontece e não têm nada
 * que fazer no objeto que a tela recebe. Espalhar levaria os três junto sem
 * ninguém notar, e o dia em que alguém serializasse um `Feriado` apareceria um
 * `desde: 1949` inexplicável do outro lado.
 */
function registro(iso: string, f: Omit<Feriado, "iso">): Feriado {
  return {
    iso,
    nome: f.nome,
    curto: f.curto,
    tipo: f.tipo,
    expediente: f.expediente,
    base: f.base,
  };
}

/**
 * Todos os feriados e pontos facultativos do ano, em ordem de data.
 *
 * NÃO rola para a segunda seguinte o que cai em fim de semana: não existe
 * "observed day" no Brasil, e a Proclamação da República de 2026, que cai num
 * domingo, simplesmente se perde. Fingir o contrário criaria um feriado que
 * nenhum calendário do país tem.
 *
 * A segunda e a terça de Carnaval saem daqui como duas entradas, e não como uma
 * faixa de dois dias: quem consome isto é uma célula de calendário, que pergunta
 * por UM dia de cada vez.
 */
export function feriadosDoAno(ano: number): Feriado[] {
  const pascoa = domingoDePascoa(ano);
  const out: Feriado[] = [
    ...FIXOS.filter((f) => ano >= f.desde).map((f) => registro(isoDe(ano, f.mes, f.dia), f)),
    ...MOVEIS.map((f) => registro(somaDias(pascoa, f.offset), f)),
  ];
  // Um móvel pode vazar para outro ano? Não: o mais distante é o Corpus Christi,
  // 60 dias depois de uma Páscoa que nunca passa de 25 de abril. A ordenação é
  // por string porque em ISO curto ela é a ordem cronológica — a mesma
  // propriedade de que o resto do app depende para comparar prazos.
  return out.sort((x, y) => x.iso.localeCompare(y.iso));
}

/**
 * Cache por ano, com o índice por dia montado junto.
 *
 * A grade do Cronograma pergunta uma vez por célula — trinta e cinco perguntas a
 * cada render, todas do mesmo ano. Sem isto, cada uma refaria a Páscoa e
 * remontaria dezessete objetos, durante o arraste de um card, sessenta vezes por
 * segundo. É memória de função pura: mesma entrada, mesma saída, então guardar
 * não muda resposta nenhuma — só não repete a conta.
 */
const porAno = new Map<number, Map<string, Feriado>>();

/**
 * Quando duas entradas caem no mesmo dia, qual delas a tela mostra.
 *
 * A colisão é rara mas real: a Sexta-feira Santa varre de 20 de março a 23 de
 * abril e atravessa o 21 de abril, então Tiradentes e Paixão coincidem sempre
 * que a Páscoa cai em 23 de abril. Sem uma regra explícita, quem ganharia seria
 * "a última que o `Map` recebeu" — determinístico por acidente, e o acidente
 * muda no dia em que alguém reordena a tabela. Lei antes de costume; empate
 * resolvido pela ordem da lista, que é estável.
 */
function precede(a: Feriado, b: Feriado): boolean {
  if (a.tipo !== b.tipo) return a.tipo === "feriado";
  return a.expediente !== b.expediente ? a.expediente === "nenhum" : false;
}

function indiceDoAno(ano: number): Map<string, Feriado> {
  const guardado = porAno.get(ano);
  if (guardado) return guardado;
  const m = new Map<string, Feriado>();
  for (const f of feriadosDoAno(ano)) {
    const atual = m.get(f.iso);
    if (!atual || precede(f, atual)) m.set(f.iso, f);
  }
  porAno.set(ano, m);
  return m;
}

/**
 * O que há naquele dia, ou `null` — inclusive o meio expediente.
 *
 * O ano sai do próprio texto ISO e não de um `Date`: `"2026-09-07".slice(0, 4)`
 * responde a mesma coisa sem abrir a porta do fuso.
 */
export function feriadoDe(iso: string): Feriado | null {
  const ano = Number(iso.slice(0, 4));
  if (!Number.isInteger(ano) || iso.length !== 10) return null;
  return indiceDoAno(ano).get(iso) ?? null;
}

/**
 * Tudo o que há numa janela, ordenado — intervalo FECHADO nas duas pontas, como
 * a janela do Cronograma (`janela.ini`/`janela.fim`) já é.
 *
 * Atravessa a virada de ano sem cuidado especial porque junta os anos das duas
 * pontas antes de filtrar. É o par de intervalo de `feriadoDe`, na mesma
 * simetria "uma função por sabor" que `datas.ts` adotou em
 * `ehFimDeSemana`/`ehFimDeSemanaISO`.
 */
export function feriadosEntre(iniISO: string, fimISO: string): Feriado[] {
  const de = Number(iniISO.slice(0, 4));
  const ate = Number(fimISO.slice(0, 4));
  if (!Number.isInteger(de) || !Number.isInteger(ate) || ate < de) return [];
  const out: Feriado[] = [];
  for (let ano = de; ano <= ate; ano++) {
    for (const f of feriadosDoAno(ano)) {
      if (f.iso >= iniISO && f.iso <= fimISO) out.push(f);
    }
  }
  return out;
}

/**
 * A PERGUNTA QUE O CRONOGRAMA FAZ: neste dia ninguém trabalha?
 *
 * Devolve o registro só quando não sobra expediente — feriado de lei e ponto
 * facultativo integral (Carnaval, Corpus Christi), mas nunca a Quarta-feira de
 * Cinzas nem as vésperas de 24 e 31 de dezembro.
 *
 * Existe como função própria, e não como um filtro escrito na tela, porque é
 * regra de calendário — e regra de calendário copiada em três telas diverge na
 * primeira exceção, sem ninguém descobrir, porque cada tela continua mostrando
 * um número plausível. É a lição que o comentário de `datas.ts` sobre a semana
 * útil já pagou uma vez.
 */
export function diaSemExpediente(iso: string): Feriado | null {
  const f = feriadoDe(iso);
  return f && f.expediente === "nenhum" ? f : null;
}

/** O par de intervalo de `diaSemExpediente`, ordenado por data. */
export function diasSemExpediente(iniISO: string, fimISO: string): Feriado[] {
  return feriadosEntre(iniISO, fimISO).filter((f) => f.expediente === "nenhum");
}

/**
 * A frase inteira — para o `title` da célula e para quem usa leitor de tela.
 *
 * O tipo entra escrito porque a figura não o distingue: o mesmo adesivo aparece
 * no 7 de Setembro e no Carnaval, e só o texto conta que um é lei e o outro é
 * costume. Chamar o Carnaval de feriado nacional seria dizer algo que o Diário
 * Oficial não diz.
 */
export function rotuloDoFeriado(f: Feriado): string {
  return f.tipo === "feriado"
    ? `Feriado nacional — ${f.nome}`
    : `Ponto facultativo — ${f.nome}`;
}
