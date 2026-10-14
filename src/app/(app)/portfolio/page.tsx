"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSetoresDaPessoa } from "@/lib/setores";
import {
  SUPER_ADMIN_EMAIL,
  subscribeUsers,
  type UserProfile,
} from "@/lib/users";
import {
  agruparPorCategoria,
  casaBusca,
  buscarIconeDoSite,
  renomearClassificacao,
  definirIconeDoLinkDoSetor,
  definirLogoDoLinkDoSetor,
  subscribeLinksDoSetor,
  type LinkDoSetor,
} from "@/lib/links-do-setor";
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
  RECORTE_TUDO,
  TrilhaDoPortfolio,
  aplicarRecorte,
  type Recorte,
} from "./organizacao";
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
const SEM_CARDS: Card[] = [];
const SEM_COLS: ColumnDoc[] = [];
const SEM_USERS: UserProfile[] = [];

export default function LinksPage() {
  const { profile } = useAuth();

  const sectors = useSetoresDaPessoa(profile);

  const chaveSetores = sectors.join("|");
  const fLinks = useAsyncData<LinkDoSetor>(chaveSetores, (onData, onErro) =>
    subscribeLinksDoSetor(sectors, onData, onErro),
  );
  const fUsers = useAsyncData<UserProfile>("todos", (onData, onErro) =>
    subscribeUsers(onData, onErro),
  );

  const links = fLinks.data ?? SEM_LINKS;
  const users = fUsers.data ?? SEM_USERS;
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
   * A categoria ou pasta escolhida na trilha (14/10/2026). Guardada JUNTO do
   * setor: trocar de portfólio volta para "Todos os produtos", em vez de abrir
   * o outro setor recortado por uma categoria que talvez nem exista nele.
   */
  const [recorteGuardado, setRecorte] = useState<{ setor: string; r: Recorte }>({
    setor: "",
    r: RECORTE_TUDO,
  });
  const recorte = recorteGuardado.setor === setorAtual ? recorteGuardado.r : RECORTE_TUDO;

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

  const usersMap = useMemo(() => {
    const m: Record<string, UserProfile> = {};
    users.forEach((u) => (m[u.email] = u));
    return m;
  }, [users]);
  const nomeDe = useCallback(
    (email: string | null | undefined) =>
      email ? (usersMap[email]?.name ?? email) : "—",
    [usersMap],
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

  /**
   * Uma fonte só decide o estado da tela.
   *
   * `fUsers` fica de fora de propósito: ela só troca e-mail por nome no rodapé
   * do card. Enquanto ela não chega, o rodapé mostra o e-mail e continua
   * funcionando; fazer a grade inteira esperar seria esperar por um dado que o
   * card sabe dispensar.
   */
  const tela = juntarFontes([fLinks]);

  /** Os produtos do portfólio aberto — a base da contagem e da busca. */
  const doSetor = useMemo(
    () => links.filter((l) => l.setor === setorAtual),
    [links, setorAtual],
  );

  const visiveis = useMemo(
    () => doSetor.filter((l) => casaBusca(l, busca)),
    [doSetor, busca],
  );

  /** O mapa da trilha: o portfólio inteiro, sem a busca. */
  const gruposDoSetor = useMemo(() => agruparPorCategoria(doSetor), [doSetor]);
  /** O que a grade desenha: a busca e o recorte da trilha, já agrupados. */
  const gruposVisiveis = useMemo(
    () => aplicarRecorte(agruparPorCategoria(visiveis), recorte),
    [visiveis, recorte],
  );
  const nVisiveis = gruposVisiveis.reduce((n, g) => n + g.total, 0);
  /** Com uma categoria só (ou nenhuma), os títulos de seção não dizem nada. */
  const temOrganizacao = gruposDoSetor.some((g) => g.categoria !== null);

  async function renomear(alvo: { categoria: string; pasta?: string }, novo: string) {
    await renomearClassificacao(doSetor, setorAtual, alvo, novo, autor);
    // O recorte que apontava para o nome antigo passaria a não achar nada.
    setRecorte({ setor: setorAtual, r: RECORTE_TUDO });
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

  const contagem =
    nVisiveis === doSetor.length
      ? `${doSetor.length} ${doSetor.length === 1 ? "produto" : "produtos"}`
      : `${nVisiveis} de ${doSetor.length} produtos`;

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Portfólio</h1>
            <p>O que o setor desenvolveu, com acesso rápido, num lugar só.</p>
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
          <p>
            O que o setor desenvolveu — painéis, aplicativos, planilhas e pastas
            —, com acesso rápido
            {tela.carregando || tela.erro ? "." : ` — ${contagem}.`}
          </p>
        </div>

        <div className={styles.headTools}>
          <div className={styles.searchwrap}>
            <Icon name="search" size={15} />
            <input
              className={styles.search}
              placeholder="Buscar por nome, categoria, pasta ou serviço…"
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
          <ErrorState error={tela.erro} onRetry={() => fLinks.tentarDeNovo()} />
        ) : tela.carregando ? (
          <SkeletonCard cards={6} texto="Carregando o portfólio…" />
        ) : doSetor.length === 0 ? (
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
            {temOrganizacao && (
              <TrilhaDoPortfolio
                grupos={gruposDoSetor}
                total={doSetor.length}
                recorte={recorte}
                onRecorte={(r) => setRecorte({ setor: setorAtual, r })}
                podeOrganizar={ehAdmin}
                onRenomear={renomear}
              />
            )}
            <div className={styles.conteudo}>
              {nVisiveis === 0 && (
                <EmptyState
                  size="compact"
                  icon="search"
                  title="Nenhum produto aqui com essa busca"
                  description={
                    <>
                      Os {doSetor.length} produtos deste portfólio continuam lá —
                      é a busca ou a categoria escolhida que está apertando a
                      peneira.
                    </>
                  }
                />
              )}
              {/* As seções ficam montadas mesmo com zero resultados: trocá-las
                  pelo painel de vazio a cada tecla reexecutaria a entrada. */}
              <div className={classeAparece}>
                {gruposVisiveis.map((g) => (
                  <section key={g.categoria ?? "__sem__"} className={styles.secaoCategoria}>
                    {temOrganizacao && (
                      <h2 className={styles.tituloCategoria}>
                        {g.categoria ?? "Sem categoria"}
                        <span>{g.total}</span>
                      </h2>
                    )}
                    {g.pastas.map((p) => (
                      <div key={p.pasta ?? "__solto__"} className={styles.blocoPasta}>
                        {p.pasta !== null && (
                          <h3 className={styles.tituloPasta}>
                            <Icon name="pasta" size={14} />
                            {p.pasta}
                            <span>{p.links.length}</span>
                          </h3>
                        )}
                        <div className={styles.grid}>
                          {p.links.map((link) => (
                            <LinkCard
                              key={link.id}
                              link={link}
                              nomeDe={nomeDe}
                              anoAtual={anoAtual}
                              salvando={salvando === link.id}
                              erro={erroIcone?.id === link.id ? erroIcone.texto : null}
                              podeAlterar={podeAlterar(link)}
                              andamento={andamentos.get(link.id)}
                              onAbrirAndamento={() => setGavetaDe(link.id)}
                              onEscolherIcone={(nome) => void escolherIcone(link, nome)}
                              onEditar={() => setAberto(link)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

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
          organizar={ehAdmin}
          classificacaoInicial={
            // Produto novo criado com uma categoria/pasta aberta na trilha
            // já nasce nela.
            recorte.tipo === "pasta"
              ? { categoria: recorte.categoria, pasta: recorte.pasta }
              : recorte.tipo === "categoria" && recorte.categoria
                ? { categoria: recorte.categoria, pasta: "" }
                : undefined
          }
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}
