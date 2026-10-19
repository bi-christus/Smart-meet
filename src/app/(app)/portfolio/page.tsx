"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import { SUPER_ADMIN_EMAIL } from "@/lib/users";
import {
  casaBusca,
  buscarIconeDoSite,
  definirIconeDoLinkDoSetor,
  definirLogoDoLinkDoSetor,
  moverProdutos,
  subscribeLinksDoSetor,
  type LinkDoSetor,
} from "@/lib/links-do-setor";
import {
  arvoreDoSetor,
  caminhoDe,
  caminhoEscrito,
  contagemPorPasta,
  converterOrganizacaoAntiga,
  criarPasta,
  definirIconeDaPasta,
  excluirPasta,
  filhasDe,
  idsDaSubarvore,
  moverPasta,
  nomeLivre,
  pastaCasaBusca,
  pastaDoProduto,
  planoDeExclusao,
  podeMoverPasta,
  renomearPasta,
  subscribePastasDoPortfolio,
  type PastaDoPortfolio,
} from "@/lib/portfolio-pastas";
import {
  columnsBySector,
  deliveredBySector,
  subscribeCards,
  subscribeColumns,
  type Card,
  type ColumnDoc,
} from "@/lib/kanban";
import { andamentoPorProduto } from "@/lib/produtos-core";
import { startOfDay } from "@/lib/datas";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonCard, classeAparece } from "@/components/skeleton";
import { LinkCard } from "./link-card";
import { LinkModal, fraseDoErro, prepararLogo } from "./link-modal";
import { ProdutoGaveta } from "./produto-gaveta";
import {
  ArvoreDePastas,
  BlocoDePasta,
  CaminhoDePastas,
  MenuDeContexto,
  PastaNova,
  abrirSeletorDeIcone,
  iniciarArraste,
  pontoDoMenu,
  type Arrastando,
  type ItemDeMenu,
} from "./explorador";
import { normalizarUrl } from "@/lib/links-core";
import styles from "./links.module.css";

/**
 * Portfólio — o que cada setor desenvolveu, com acesso rápido.
 *
 * ERA A ABA "LINKS", e virou Portfólio em 13/10/2026 (#208): um portfólio por
 * setor, em abas, e cada item é um PRODUTO. O acesso rápido continua sendo o
 * principal — muitos produtos são anteriores ao Smart Meeting e nunca tiveram
 * demanda, e para eles a tela é só isto: nome, logo e um clique. O id da aba
 * continua `links` no catálogo de permissões, e a coleção continua `/links`:
 * os quadros de permissão gravados leem esse id, e trocá-lo faria a aba sumir
 * para quem já tem acesso. `/links` redireciona para `/portfolio`.
 *
 * ESTA TELA TEM CADASTRO PRÓPRIO desde 06/10/2026 (`/links`, ver
 * `links-do-setor-core.ts`). Antes ela não guardava nada: lia o campo Links de
 * cada demanda e mostrava um card por link, com o TÍTULO DA DEMANDA em
 * destaque. Usada como catálogo das ferramentas do setor, isso obrigava a abrir
 * uma demanda só para hospedar um link, e punha no lugar do nome do aplicativo
 * a frase de um trabalho qualquer que um dia o usou.
 *
 * Agora quem cadastra dá o NOME e a DESCRIÇÃO, e a tela não lê demanda
 * nenhuma. O link colado dentro de uma demanda continua lá, no modal do card do
 * Kanban — ele responde "o que esta demanda usa", que é outra pergunta.
 *
 * Por isso a única fonte que segura a tela é `links`. A lista de pessoas entra
 * depois, sem travar nada: um card continua legível com o e-mail de quem o
 * cadastrou no lugar do nome.
 *
 * O card mora em `link-card.tsx` e o formulário em `link-modal.tsx`; aqui
 * ficam a assinatura, os filtros e quem pode o quê.
 */

/**
 * Listas vazias constantes, para os cálculos rodarem antes de os dados
 * chegarem. Fora do componente porque `?? []` no corpo cria um array novo a
 * cada render, e os `useMemo` que dependem dele recalculariam sempre.
 */
const SEM_LINKS: LinkDoSetor[] = [];
const SEM_PASTAS: PastaDoPortfolio[] = [];
const SEM_CARDS: Card[] = [];
const SEM_COLS: ColumnDoc[] = [];

export default function LinksPage() {
  const { profile } = useAuth();

  const sectors = useSetoresDaPessoa(profile);

  const chaveSetores = sectors.join("|");
  const fLinks = useAsyncData<LinkDoSetor>(chaveSetores, (onData, onErro) =>
    subscribeLinksDoSetor(sectors, onData, onErro),
  );
  const fPastas = useAsyncData<PastaDoPortfolio>(chaveSetores, (onData, onErro) =>
    subscribePastasDoPortfolio(sectors, onData, onErro),
  );

  const links = fLinks.data ?? SEM_LINKS;
  const pastas = fPastas.data ?? SEM_PASTAS;
  const autor = profile?.email ?? "";

  /**
   * O portfólio aberto — um por setor, como abas (#208).
   *
   * DERIVADO e não sincronizado por efeito: `useSetoresDaPessoa` começa no piso
   * e vira o cadastro quando ele responde, e a escolha guardada pode deixar de
   * existir no meio do caminho. Se deixou, a tela cai no primeiro setor DA
   * PESSOA — e não no primeiro da lista, que para o admin é o primeiro do
   * cadastro inteiro, um setor em que ele talvez nem trabalhe.
   */
  const [setorEscolhido, setSetorEscolhido] = useState("");
  const setorPadrao =
    (profile?.sectors ?? []).find((s) => sectors.includes(s)) || sectors[0] || "";
  const setorAtual = sectors.includes(setorEscolhido) ? setorEscolhido : setorPadrao;
  const [busca, setBusca] = useState("");
  /**
   * A pasta aberta no explorador (#229). Guardada JUNTO do setor: trocar de
   * portfólio abre o outro na raiz, e não numa pasta que nem existe nele.
   */
  const [abertaGuardada, setAberta] = useState<{ setor: string; id: string | null }>({
    setor: "",
    id: null,
  });

  /**
   * As demandas e as etapas do portfólio aberto — só para o andamento (#209).
   *
   * FORA de `juntarFontes`, de propósito: o Portfólio é acesso rápido antes de
   * tudo, e a grade não pode esperar pelo quadro, nem cair junto se ele falhar.
   * Sem elas, o card fica como sempre foi; o selo aparece quando chegam.
   *
   * Só o setor aberto, e não todos os da pessoa: o admin vê todos os setores, e
   * assinar o quadro inteiro de cada um para desenhar uma aba de cada vez seria
   * pagar leitura por selos que ninguém está olhando.
   */
  const fCards = useAsyncData<Card>(setorAtual, (onData, onErro) =>
    setorAtual ? subscribeCards(setorAtual, onData, onErro) : (onData([]), () => {}),
  );
  const fCols = useAsyncData<ColumnDoc>(setorAtual, (onData, onErro) =>
    setorAtual ? subscribeColumns(setorAtual, onData, onErro) : (onData([]), () => {}),
  );
  const cardsDoSetor = fCards.data ?? SEM_CARDS;
  const colsDoSetor = fCols.data ?? SEM_COLS;
  /** Lido uma vez: o andamento só precisa saber o DIA, e o render não pode chamar o relógio. */
  const agora = useMemo(() => startOfDay().getTime(), []);
  const andamentos = useMemo(() => {
    // As colunas do setor na ordem do quadro; sem nenhuma gravada, as padrão —
    // a mesma regra de `columnsBySector` que o Kanban e o Dashboard usam.
    const cols = columnsBySector(colsDoSetor, [setorAtual])[setorAtual] ?? [];
    return andamentoPorProduto({
      cards: cardsDoSetor,
      colunas: cols.map((c) => ({ colId: c.id, title: c.title })),
      entregues: deliveredBySector({ [setorAtual]: cols }),
      agora,
    });
  }, [cardsDoSetor, colsDoSetor, setorAtual, agora]);
  /** O produto com a gaveta de andamento aberta. */
  const [gavetaDe, setGavetaDe] = useState<string | null>(null);
  /** O formulário aberto: um link existente, um novo, ou nenhum. */
  const [aberto, setAberto] = useState<LinkDoSetor | "novo" | null>(null);

  /**
   * A gravação do ícone, CHAVEADA POR LINK — nunca um estado único.
   *
   * A grade mostra dezenas de links ao mesmo tempo. Um `erro: string | null`
   * global pintaria a falha de um link na borda de todos, e um `salvando:
   * boolean` desabilitaria os selos de toda a tela por causa de um clique.
   */
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erroIcone, setErroIcone] = useState<{ id: string; texto: string } | null>(
    null,
  );

  /**
   * Grava o ícone escolhido no selo, sem abrir o formulário.
   *
   * Escolher o que já estava lá é silêncio, e não escrita: não é erro, e uma
   * gravação que não muda nada ainda carimbaria "editado por" em quem só abriu
   * e fechou o seletor.
   */
  const escolherIcone = useCallback(
    async (link: LinkDoSetor, nome: string | null) => {
      if ((link.icone ?? null) === nome) return;
      setSalvando(link.id);
      setErroIcone(null);
      try {
        await definirIconeDoLinkDoSetor(link.id, nome, autor);
      } catch (e) {
        console.error("Erro ao trocar o ícone do link:", e);
        setErroIcone({
          id: link.id,
          texto: fraseDoErro("Não foi possível trocar o ícone.", e),
        });
      } finally {
        setSalvando(null);
      }
    },
    [autor],
  );

  /**
   * Quem pode ALTERAR e REMOVER um link — o espelho, na tela, do `update` e do
   * `delete` de `/links`: quem cadastrou, ou admin.
   *
   * A regra é a barreira; isto só decide se o lápis, o seletor de ícone e o
   * "Remover" aparecem. Mostrá-los a quem a regra vai negar ensinaria a pessoa
   * a clicar para ler "sem permissão", que é a pior forma de descobrir o que se
   * pode fazer.
   */
  /** Organizar (categoria e pasta) é só do admin — o espelho da regra de `/links`. */
  const ehAdmin =
    !!profile &&
    (profile.email.toLowerCase() === SUPER_ADMIN_EMAIL || profile.role === "admin");

  const podeAlterar = useCallback(
    (l: LinkDoSetor) => {
      if (!profile) return false;
      const eu = profile.email.toLowerCase();
      if (eu === SUPER_ADMIN_EMAIL || profile.role === "admin") return true;
      return l.createdBy.toLowerCase() === eu;
    },
    [profile],
  );

  // As pastas SEGURAM a tela junto com os produtos: sem elas, tudo o que está
  // dentro de uma pasta apareceria solto na raiz, e a tela afirmaria uma
  // organização que não é a gravada.
  const tela = juntarFontes([fLinks, fPastas]);

  /** Os produtos do portfólio aberto — a base da contagem e da busca. */
  const doSetor = useMemo(
    () => links.filter((l) => l.setor === setorAtual),
    [links, setorAtual],
  );

  /** A árvore do portfólio aberto, já sem ciclo e sem mãe de outro setor. */
  const arvore = useMemo(() => arvoreDoSetor(pastas, setorAtual), [pastas, setorAtual]);
  /** Pasta apagada por outra pessoa enquanto estava aberta: volta para a raiz. */
  const atual =
    abertaGuardada.setor === setorAtual && arvore.some((p) => p.id === abertaGuardada.id)
      ? abertaGuardada.id
      : null;
  const abrir = useCallback(
    (id: string | null) => setAberta({ setor: setorAtual, id }),
    [setorAtual],
  );
  const caminho = useMemo(() => caminhoDe(arvore, atual), [arvore, atual]);
  const contagem = useMemo(() => contagemPorPasta(arvore, doSetor), [arvore, doSetor]);

  /**
   * O que a grade mostra. SEM BUSCA, o conteúdo da pasta aberta: as subpastas
   * e os produtos que moram nela. COM BUSCA, o portfólio inteiro — como a
   * busca do Windows, que procura dentro das subpastas —, e cada resultado diz
   * onde está.
   */
  const buscando = busca.trim() !== "";
  const pastasNaGrade = useMemo(
    () => (buscando ? arvore.filter((p) => pastaCasaBusca(p, busca)) : filhasDe(arvore, atual)),
    [arvore, atual, busca, buscando],
  );
  const produtosNaGrade = useMemo(
    () =>
      buscando
        ? doSetor.filter((l) =>
            casaBusca(l, busca, caminhoEscrito(arvore, pastaDoProduto(arvore, l))),
          )
        : doSetor.filter((l) => pastaDoProduto(arvore, l) === atual),
    [doSetor, arvore, atual, busca, buscando],
  );
  const temPastas = arvore.length > 0;

  // ---- organizar: só o admin ----------------------------------------------

  const [arrastando, setArrastando] = useState<Arrastando | null>(null);
  const fimDoArraste = useCallback(() => setArrastando(null), []);
  /** A pasta com o nome sendo digitado. */
  const [renomeando, setRenomeando] = useState<string | null>(null);
  /** A pasta nova que está nascendo, no lugar em que vai nascer. */
  const [nascendo, setNascendo] = useState<{ setor: string; paiId: string | null } | null>(null);
  const nascendoAqui = nascendo?.setor === setorAtual && nascendo.paiId === atual && !buscando;
  const [menu, setMenu] = useState<{ x: number; y: number; itens: ItemDeMenu[] } | null>(null);
  const fecharMenu = useCallback(() => setMenu(null), []);
  /** O resultado de uma arrumação que falhou (ou da conversão). */
  const [aviso, setAviso] = useState<string | null>(null);

  /** O destino aceita o que está vindo? É o que acende (ou não) o alvo. */
  const aceita = useCallback(
    (destino: string | null, a: Arrastando) => {
      if (a.tipo === "pasta") return podeMoverPasta(arvore, a.id, destino);
      const produto = doSetor.find((l) => l.id === a.id);
      return !!produto && pastaDoProduto(arvore, produto) !== destino;
    },
    [arvore, doSetor],
  );

  async function soltar(destino: string | null, a: Arrastando) {
    setArrastando(null);
    if (!aceita(destino, a)) return;
    setAviso(null);
    try {
      if (a.tipo === "produto") await moverProdutos([a.id], destino, autor);
      else {
        const pasta = arvore.find((p) => p.id === a.id);
        if (pasta) await moverPasta(pasta, arvore, destino, autor);
      }
    } catch (e) {
      console.error("Erro ao mover no portfólio:", e);
      setAviso(fraseDoErro("Não foi possível mover.", e));
    }
  }

  async function criarPastaNova(nome: string) {
    await criarPasta(setorAtual, arvore, atual, nome, autor);
    setNascendo(null);
  }

  async function renomearPastaAberta(pasta: PastaDoPortfolio, nome: string) {
    await renomearPasta(pasta, arvore, nome, autor);
    setRenomeando(null);
  }

  async function trocarIcone(pasta: PastaDoPortfolio, icone: string | null) {
    setAviso(null);
    try {
      await definirIconeDaPasta(pasta, icone, autor);
    } catch (e) {
      console.error("Erro ao trocar o ícone da pasta:", e);
      setAviso(fraseDoErro("Não foi possível trocar o ícone.", e));
    }
  }

  async function excluir(pasta: PastaDoPortfolio) {
    const plano = planoDeExclusao(arvore, doSetor, pasta.id);
    if (!plano) return;
    const mae = pasta.paiId ? arvore.find((p) => p.id === pasta.paiId)?.nome : undefined;
    const onde = mae ? `para a pasta “${mae}”` : "para o início do portfólio";
    const dentro = [
      plano.produtos.length
        ? `${plano.produtos.length} ${plano.produtos.length === 1 ? "produto" : "produtos"}`
        : "",
      plano.pastas.length ? `${plano.pastas.length} ${plano.pastas.length === 1 ? "pasta" : "pastas"}` : "",
    ]
      .filter(Boolean)
      .join(" e ");
    if (
      !confirm(
        dentro
          ? `Excluir a pasta “${pasta.nome}”? O que está nela (${dentro}) vai ${onde}. Nenhum produto é apagado.`
          : `Excluir a pasta “${pasta.nome}”? Ela está vazia.`,
      )
    )
      return;
    setAviso(null);
    try {
      await excluirPasta(pasta, arvore, doSetor, autor);
      if (atual !== null && idsDaSubarvore(arvore, pasta.id).has(atual)) abrir(pasta.paiId);
    } catch (e) {
      console.error("Erro ao excluir a pasta:", e);
      setAviso(fraseDoErro("Não foi possível excluir a pasta.", e));
    }
  }

  /** Abrir pela grade limpa a busca: dentro da pasta, a busca já não diz nada. */
  function abrirPasta(id: string | null) {
    setBusca("");
    setRenomeando(null);
    abrir(id);
  }

  /**
   * Renomear e trocar o ícone acontecem NA PASTA DA GRADE. Pelo menu da
   * árvore a pasta pode estar em outro nível — então a grade abre a mãe dela
   * primeiro, e a pasta aparece no lugar.
   */
  function renomearNaGrade(pasta: PastaDoPortfolio) {
    if (buscando || pasta.paiId !== atual) abrirPasta(pasta.paiId);
    setNascendo(null);
    setRenomeando(pasta.id);
  }
  function trocarIconeNaGrade(pasta: PastaDoPortfolio) {
    if (buscando || pasta.paiId !== atual) abrirPasta(pasta.paiId);
    // O seletor mora no canto da pasta, que só existe depois do próximo
    // desenho quando a grade acabou de trocar de pasta.
    requestAnimationFrame(() => abrirSeletorDeIcone(pasta.id));
  }

  function menuDaPasta(pasta: PastaDoPortfolio, ponto: { x: number; y: number }) {
    setMenu({
      ...ponto,
      itens: [
        { rotulo: "Abrir", icone: "pasta", onEscolher: () => abrirPasta(pasta.id) },
        { rotulo: "Renomear", icone: "edit", atalho: "F2", onEscolher: () => renomearNaGrade(pasta) },
        { rotulo: "Trocar ícone", icone: "imagem", onEscolher: () => trocarIconeNaGrade(pasta) },
        {
          rotulo: "Excluir",
          icone: "trash",
          atalho: "Del",
          perigo: true,
          onEscolher: () => void excluir(pasta),
        },
      ],
    });
  }

  function novaPasta() {
    setBusca("");
    setRenomeando(null);
    setNascendo({ setor: setorAtual, paiId: atual });
  }

  /** O botão direito no VAZIO da grade: o menu do Windows, "Nova pasta". */
  function menuDoVazio(ponto: { x: number; y: number }) {
    setMenu({
      ...ponto,
      itens: [
        { rotulo: "Nova pasta", icone: "pasta", onEscolher: novaPasta },
        { rotulo: "Novo produto", icone: "plus", onEscolher: () => setAberto("novo") },
      ],
    });
  }

  /** Produtos com a organização antiga (#226), em texto, ainda por converter. */
  const comOrganizacaoAntiga = useMemo(
    () => doSetor.filter((l) => l.categoria && pastaDoProduto(arvore, l) === null).length,
    [doSetor, arvore],
  );
  const [convertendo, setConvertendo] = useState(false);
  async function converter() {
    setConvertendo(true);
    setAviso(null);
    try {
      const n = await converterOrganizacaoAntiga(setorAtual, arvore, doSetor, autor);
      setAviso(
        `Pronto: as categorias antigas viraram ${n} ${n === 1 ? "pasta" : "pastas"}. Agora é só arrastar para arrumar.`,
      );
    } catch (e) {
      console.error("Erro ao converter a organização antiga:", e);
      setAviso(fraseDoErro("Não foi possível converter a organização antiga.", e));
    } finally {
      setConvertendo(false);
    }
  }

  /**
   * Quantos produtos cada portfólio tem, para a aba dizer antes do clique.
   * Aba de setor vazio continua na barra: é nela que se cadastra o primeiro.
   */
  const porSetor = useMemo(() => {
    const m = new Map<string, number>();
    links.forEach((l) => m.set(l.setor, (m.get(l.setor) ?? 0) + 1));
    return m;
  }, [links]);

  /**
   * O produto novo nasce no portfólio aberto: quem está olhando o das Cantinas
   * e clica em "Novo produto" quer cadastrar nas Cantinas.
   */
  const setorInicial = setorAtual;

  const anoAtual = useMemo(() => new Date().getFullYear(), []);

  /**
   * O ícone do site para os links que ainda não têm logo — os cadastrados
   * antes de o logo existir, e os de site que não respondeu na hora.
   *
   * UM POR VEZ, e não em paralelo: são poucos links, e disparar vinte buscas
   * ao mesmo tempo contra a rota do servidor só trocaria uma espera que a
   * contagem explica por uma rajada de falhas por tempo-limite.
   *
   * Site sem ícone não é erro: ele fica com o ícone deduzido de sempre, e o
   * resumo do fim diz quantos foram assim. Só a gravação negada interrompe —
   * ela se repetiria em todos os outros.
   */
  // Só os que a pessoa pode alterar: o lote grava, e gravar o link alheio
  // seria negado pela regra um por um.
  const semLogo = useMemo(
    () => links.filter((l) => !l.logo && normalizarUrl(l.url) && podeAlterar(l)),
    [links, podeAlterar],
  );
  const [lote, setLote] = useState<{ feitos: number; total: number } | null>(null);
  const [resultadoLote, setResultadoLote] = useState<string | null>(null);

  async function buscarIconesEmLote() {
    const fila = semLogo;
    if (fila.length === 0) return;
    setResultadoLote(null);
    setLote({ feitos: 0, total: fila.length });
    let achados = 0;
    let semIcone = 0;
    try {
      for (let i = 0; i < fila.length; i++) {
        const l = fila[i];
        try {
          const blob = await buscarIconeDoSite(normalizarUrl(l.url));
          const r = await prepararLogo(blob);
          if (r.ok) {
            await definirLogoDoLinkDoSetor(l.id, r.uri, autor);
            achados++;
          } else semIcone++;
        } catch (e) {
          if ((e as { code?: unknown } | null)?.code) throw e;
          semIcone++;
        }
        setLote({ feitos: i + 1, total: fila.length });
      }
      setResultadoLote(
        `${achados} ${achados === 1 ? "ícone encontrado" : "ícones encontrados"}` +
          (semIcone
            ? `; ${semIcone} ${semIcone === 1 ? "site não tem" : "sites não têm"} ícone que dê para usar e ${semIcone === 1 ? "continua" : "continuam"} com o desenho de antes.`
            : "."),
      );
    } catch (e) {
      console.error("Erro ao gravar o ícone do site:", e);
      setResultadoLote(fraseDoErro("A busca parou: não foi possível gravar o ícone.", e));
    } finally {
      setLote(null);
    }
  }

  const contagemTexto = `${doSetor.length} ${doSetor.length === 1 ? "produto" : "produtos"}`;

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Portfólio</h1>
          </div>
        </div>
        <div className={styles.vazioTela}>
          Você ainda não participa de nenhum setor. Peça ao administrador para
          incluí-lo em um.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1>Portfólio</h1>
          {/* A contagem só entra depois da resposta: "0 produtos" antes de
              saber é a mesma afirmação falsa da mensagem de vazio, dita com a
              autoridade de um número. */}
          {!tela.carregando && !tela.erro && <p>{contagemTexto}</p>}
        </div>

        <div className={styles.headTools}>
          <div className={styles.searchwrap}>
            <Icon name="search" size={15} />
            <input
              className={styles.search}
              placeholder="Buscar em todas as pastas…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar no portfólio"
            />
          </div>
          {(semLogo.length > 0 || lote) && (
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => void buscarIconesEmLote()}
              disabled={!!lote}
              title="Busca o ícone que cada site mostra na aba do navegador, para os links que ainda não têm logo"
            >
              <Icon name="globo" size={14} />
              {lote
                ? `Buscando ícones… ${lote.feitos}/${lote.total}`
                : `Buscar ícones dos sites (${semLogo.length})`}
            </button>
          )}
          <button
            type="button"
            className={styles.btnPri}
            onClick={() => setAberto("novo")}
          >
            <Icon name="plus" size={14} /> Novo produto
          </button>
        </div>
      </div>

      {/* UM PORTFÓLIO POR SETOR, como abas (#208). Só aparece para quem vê mais
          de um: com um setor só, a barra repetiria o título. A leitura continua
          escopada pela regra de `/links` — cada pessoa só tem abas dos setores
          dela, e o admin, de todos. */}
      {sectors.length > 1 && (
        <div className={styles.abasSetor} role="tablist" aria-label="Portfólios">
          {sectors.map((s) => {
            const n = porSetor.get(s) ?? 0;
            const ativa = s === setorAtual;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={ativa}
                className={`${styles.abaSetor} ${ativa ? styles.abaSetorOn : ""}`}
                onClick={() => setSetorEscolhido(s)}
              >
                Portfólio {s}
                {!tela.carregando && <span className={styles.abaConta}>{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {resultadoLote && (
        <div className={styles.avisoLote} role="status">
          {resultadoLote}
          <button type="button" className={styles.editar} onClick={() => setResultadoLote(null)} aria-label="Fechar aviso">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className={styles.corpo} aria-busy={tela.carregando || undefined}>
        {tela.erro ? (
          <ErrorState
            error={tela.erro}
            onRetry={() => {
              fLinks.tentarDeNovo();
              fPastas.tentarDeNovo();
            }}
          />
        ) : tela.carregando ? (
          <SkeletonCard cards={6} texto="Carregando o portfólio…" />
        ) : doSetor.length === 0 && !temPastas ? (
          <EmptyState
            icon="links"
            title={`O portfólio ${setorAtual} ainda está vazio`}
            description={
              <>
                Cadastre aqui o que o setor desenvolveu — o painel do Power BI,
                a planilha de custos, a pasta no Drive —, cada um com um nome e
                uma descrição do que é. Quem participa do setor encontra tudo
                nesta aba, a um clique.
              </>
            }
            action={
              <button type="button" onClick={() => setAberto("novo")}>
                <Icon name="plus" size={14} /> Cadastrar o primeiro produto
              </button>
            }
          />
        ) : (
          <div className={styles.layout}>
            {/* A árvore aparece quando há pasta — ou para o admin, que é quem
                cria a primeira e precisa de onde soltar. Para os outros, um
                portfólio sem pasta nenhuma continua sendo só a grade. */}
            {(temPastas || ehAdmin) && (
              <ArvoreDePastas
                raiz={`Portfólio ${setorAtual}`}
                total={doSetor.length}
                arvore={arvore}
                contagem={contagem}
                atual={buscando ? null : atual}
                caminhoAtual={caminho}
                podeOrganizar={ehAdmin}
                arrastando={arrastando}
                aceita={aceita}
                onSoltar={(d, a) => void soltar(d, a)}
                onArrastar={setArrastando}
                onFimDoArraste={fimDoArraste}
                onAbrir={abrirPasta}
                onMenu={menuDaPasta}
              />
            )}
            <div
              className={styles.conteudo}
              onContextMenu={
                ehAdmin && !buscando
                  ? (e) => {
                      // Só o VAZIO: o menu da pasta e o do navegador sobre um
                      // produto (abrir link em nova aba…) continuam os deles.
                      if ((e.target as HTMLElement).closest("a, button, input, [data-produto]")) return;
                      e.preventDefault();
                      menuDoVazio(pontoDoMenu(e));
                    }
                  : undefined
              }
            >
              <div className={styles.barraExplorador}>
                {buscando ? (
                  <p className={styles.resultadoBusca} role="status">
                    {pastasNaGrade.length + produtosNaGrade.length === 0
                      ? "Nada encontrado"
                      : `${[
                          pastasNaGrade.length
                            ? `${pastasNaGrade.length} ${pastasNaGrade.length === 1 ? "pasta" : "pastas"}`
                            : "",
                          produtosNaGrade.length
                            ? `${produtosNaGrade.length} ${produtosNaGrade.length === 1 ? "produto" : "produtos"}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" e ")}`}{" "}
                    em todo o portfólio {setorAtual}
                  </p>
                ) : (
                  <CaminhoDePastas
                    raiz={`Portfólio ${setorAtual}`}
                    caminho={caminho}
                    arrastando={arrastando}
                    aceita={aceita}
                    onSoltar={(d, a) => void soltar(d, a)}
                    onAbrir={abrirPasta}
                  />
                )}
                {ehAdmin && !buscando && (
                  <button type="button" className={styles.btnGhost} onClick={novaPasta}>
                    <Icon name="pasta" size={14} /> Nova pasta
                  </button>
                )}
              </div>

              {aviso && (
                <div className={styles.avisoLote} role="status">
                  {aviso}
                  <button type="button" className={styles.editar} onClick={() => setAviso(null)} aria-label="Fechar aviso">
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )}

              {/* A organização antiga (#226) não some sozinha: o admin vê o
                  convite para transformá-la em pastas, e os produtos ficam no
                  início do portfólio até lá — nada se perde. */}
              {ehAdmin && comOrganizacaoAntiga > 0 && (
                <div className={styles.conversao}>
                  <Icon name="pasta" size={15} />
                  <span>
                    {comOrganizacaoAntiga}{" "}
                    {comOrganizacaoAntiga === 1 ? "produto ainda tem" : "produtos ainda têm"} a
                    categoria digitada no formulário antigo.
                  </span>
                  <button
                    type="button"
                    className={styles.btnGhost}
                    onClick={() => void converter()}
                    disabled={convertendo}
                  >
                    {convertendo ? "Convertendo…" : "Transformar em pastas"}
                  </button>
                </div>
              )}

              {(pastasNaGrade.length > 0 || nascendoAqui) && (
                <div className={styles.gradePastas}>
                  {nascendoAqui && (
                    <PastaNova
                      nome={nomeLivre(filhasDe(arvore, atual))}
                      onConfirmar={criarPastaNova}
                      onDesistir={() => setNascendo(null)}
                    />
                  )}
                  {pastasNaGrade.map((p) => (
                    <BlocoDePasta
                      key={p.id}
                      pasta={p}
                      conta={contagem.get(p.id) ?? 0}
                      local={
                        buscando
                          ? caminhoEscrito(arvore, p.paiId) || `Portfólio ${setorAtual}`
                          : undefined
                      }
                      podeOrganizar={ehAdmin}
                      renomeando={renomeando === p.id}
                      arrastando={arrastando}
                      aceita={(a) => aceita(p.id, a)}
                      onSoltar={(a) => void soltar(p.id, a)}
                      onArrastar={setArrastando}
                      onFimDoArraste={fimDoArraste}
                      onAbrir={() => abrirPasta(p.id)}
                      onMenu={(ponto) => menuDaPasta(p, ponto)}
                      onRenomear={() => renomearNaGrade(p)}
                      onConfirmarNome={(nome) => renomearPastaAberta(p, nome)}
                      onDesistirDoNome={() => setRenomeando(null)}
                      onExcluir={() => void excluir(p)}
                      onIcone={(icone) => void trocarIcone(p, icone)}
                    />
                  ))}
                </div>
              )}

              {produtosNaGrade.length > 0 ? (
                <div className={`${styles.grid} ${classeAparece}`}>
                  {produtosNaGrade.map((link) => {
                    const onde = buscando
                      ? caminhoEscrito(arvore, pastaDoProduto(arvore, link))
                      : "";
                    return (
                      <div
                        key={link.id}
                        data-produto
                        className={`${styles.produto} ${arrastando?.tipo === "produto" && arrastando.id === link.id ? styles.arrastado : ""}`}
                        draggable={ehAdmin}
                        onDragStart={
                          ehAdmin
                            ? (e) => iniciarArraste(e, { tipo: "produto", id: link.id }, setArrastando)
                            : undefined
                        }
                        onDragEnd={fimDoArraste}
                      >
                        {onde && (
                          <button
                            type="button"
                            className={styles.produtoLocal}
                            onClick={() => abrirPasta(pastaDoProduto(arvore, link))}
                            title="Abrir a pasta"
                          >
                            <Icon name="pasta" size={12} /> {onde}
                          </button>
                        )}
                        <LinkCard
                          link={link}
                          anoAtual={anoAtual}
                          salvando={salvando === link.id}
                          erro={erroIcone?.id === link.id ? erroIcone.texto : null}
                          podeAlterar={podeAlterar(link)}
                          andamento={andamentos.get(link.id)}
                          onAbrirAndamento={() => setGavetaDe(link.id)}
                          onEscolherIcone={(nome) => void escolherIcone(link, nome)}
                          onEditar={() => setAberto(link)}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : buscando ? (
                pastasNaGrade.length === 0 && (
                  <EmptyState
                    size="compact"
                    icon="search"
                    title="Nada com essa busca"
                    description={
                      <>
                        A busca procura em todas as pastas, pelo nome, pela
                        descrição, pelo endereço e pelo nome da pasta. Os{" "}
                        {doSetor.length} produtos continuam lá.
                      </>
                    }
                  />
                )
              ) : (
                pastasNaGrade.length === 0 &&
                !nascendoAqui && (
                  <EmptyState
                    size="compact"
                    icon="pasta"
                    title={atual === null ? "Nenhum produto por aqui" : "Esta pasta está vazia"}
                    description={
                      ehAdmin
                        ? "Para encher esta pasta, abra a pasta onde os produtos estão e arraste-os até ela na árvore à esquerda. O botão direito aqui cria uma subpasta."
                        : "Os produtos deste portfólio estão nas pastas ao lado."
                    }
                  />
                )
              )}
            </div>
          </div>
        )}
      </div>

      {menu && <MenuDeContexto x={menu.x} y={menu.y} itens={menu.itens} onFechar={fecharMenu} />}

      {(() => {
        // A gaveta só abre com o produto E o andamento em mãos: se a última
        // demanda aberta foi entregue com a gaveta aberta, ela fecha sozinha em
        // vez de mostrar um andamento que deixou de existir.
        const p = gavetaDe ? doSetor.find((l) => l.id === gavetaDe) : undefined;
        const a = gavetaDe ? andamentos.get(gavetaDe) : undefined;
        return p && a ? (
          <ProdutoGaveta produto={p} andamento={a} onFechar={() => setGavetaDe(null)} />
        ) : null;
      })()}

      {aberto && (
        <LinkModal
          link={aberto === "novo" ? null : aberto}
          setores={sectors}
          setorInicial={setorInicial}
          existentes={links}
          autor={autor}
          podeApagar={aberto !== "novo" && podeAlterar(aberto)}
          pastaDestino={
            // Produto novo criado com uma pasta aberta já nasce nela — só pelo
            // admin, que é quem a regra deixa gravar `pastaId`.
            ehAdmin && caminho.length
              ? { id: caminho[caminho.length - 1].id, nome: caminho[caminho.length - 1].nome }
              : undefined
          }
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}
