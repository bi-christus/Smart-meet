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
  casaBusca,
  buscarIconeDoSite,
  definirIconeDoLinkDoSetor,
  definirLogoDoLinkDoSetor,
  subscribeLinksDoSetor,
  type LinkDoSetor,
} from "@/lib/links-do-setor";
import { juntarFontes } from "@/lib/async-data-core";
import { useAsyncData } from "@/lib/use-async-data";
import { Icon } from "@/components/icons";
import { Select, type SelectOption } from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { SkeletonCard, classeAparece } from "@/components/skeleton";
import { LinkCard } from "./link-card";
import { LinkModal, fraseDoErro, prepararLogo } from "./link-modal";
import { normalizarUrl } from "@/lib/links-core";
import styles from "./links.module.css";

/**
 * Links — os aplicativos, painéis e pastas que o setor usa, num lugar só.
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

  const [filtroSetor, setFiltroSetor] = useState("");
  const [busca, setBusca] = useState("");
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

  /**
   * O setor só aparece no rodapé do card para quem participa de mais de um.
   * Para os outros todo card diria a mesma palavra.
   */
  const variosSetores = sectors.length > 1;

  const visiveis = useMemo(
    () =>
      links.filter(
        (l) => (!filtroSetor || l.setor === filtroSetor) && casaBusca(l, busca),
      ),
    [links, filtroSetor, busca],
  );

  /**
   * Só entram no filtro os setores QUE TÊM LINK, pelo mesmo motivo do antigo
   * filtro de responsável: opção que devolve zero em qualquer combinação é
   * ruído. A base é `links`, e não `visiveis`, senão a busca esvaziaria este
   * select e apagaria a opção escolhida.
   */
  const setorOptions = useMemo<SelectOption[]>(() => {
    const comLink = new Set(links.map((l) => l.setor));
    const opts: SelectOption[] = [{ value: "", label: "Todos os setores" }];
    [...comLink]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .forEach((s) => opts.push({ value: s, label: s }));
    return opts;
  }, [links]);

  /**
   * O filtro só existe quando os links cobrem DOIS setores ou mais — com um só,
   * escolhê-lo devolve exatamente o mesmo que "Todos". O `filtroSetor` na conta
   * é a saída de emergência: se os links de um setor somem com o filtro
   * escolhido, o seletor fica na tela para a pessoa poder desfazê-lo, em vez de
   * sumir e deixá-la presa numa grade vazia.
   */
  const mostrarFiltroSetor = setorOptions.length > 2 || filtroSetor !== "";

  /**
   * O setor em que um link novo nasce, quando a pessoa participa de vários.
   *
   * O do filtro vem primeiro: quem está olhando o catálogo das Cantinas e clica
   * em "Novo link" quer cadastrar nas Cantinas. Sem filtro, o primeiro setor da
   * própria pessoa — e não o primeiro da lista, que para o admin é o primeiro
   * do cadastro inteiro, um setor em que ele talvez nem trabalhe.
   */
  const setorInicial =
    filtroSetor ||
    (profile?.sectors ?? []).find((s) => sectors.includes(s)) ||
    sectors[0] ||
    "";

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
    visiveis.length === links.length
      ? `${links.length} ${links.length === 1 ? "link" : "links"}`
      : `${visiveis.length} de ${links.length} links`;

  if (!profile) return null;

  if (sectors.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <h1>Links</h1>
            <p>Os aplicativos, painéis e pastas que o setor usa, num lugar só.</p>
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
          <h1>Links</h1>
          {/* A contagem só entra depois da resposta: "0 links" antes de saber é
              a mesma afirmação falsa da mensagem de vazio, dita com a
              autoridade de um número. */}
          <p>
            Os aplicativos, painéis e pastas que o setor usa, cada um com nome e
            descrição
            {tela.carregando || tela.erro ? "." : ` — ${contagem}.`} O link
            colado numa demanda continua dentro dela, no Kanban.
          </p>
        </div>

        <div className={styles.headTools}>
          {mostrarFiltroSetor && (
            <div className={styles.filtroSetor}>
              <Select
                value={filtroSetor}
                options={setorOptions}
                onChange={setFiltroSetor}
                placeholder="Todos os setores"
                ariaLabel="Filtrar por setor"
              />
            </div>
          )}
          <div className={styles.searchwrap}>
            <Icon name="search" size={15} />
            <input
              className={styles.search}
              placeholder="Buscar por nome, descrição ou serviço…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar links"
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
            <Icon name="plus" size={14} /> Novo link
          </button>
        </div>
      </div>

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
          <SkeletonCard cards={6} texto="Carregando os links do setor…" />
        ) : links.length === 0 ? (
          <EmptyState
            icon="links"
            title="Nenhum link cadastrado"
            description={
              <>
                Cadastre aqui os aplicativos que o setor usa — o painel do Power
                BI, a planilha de custos, a pasta no Drive —, cada um com um
                nome e uma descrição do que é. Quem participa do setor encontra
                tudo nesta aba.
              </>
            }
            action={
              <button type="button" onClick={() => setAberto("novo")}>
                <Icon name="plus" size={14} /> Cadastrar o primeiro link
              </button>
            }
          />
        ) : (
          <>
            {visiveis.length === 0 && (
              <EmptyState
                size="compact"
                icon="search"
                title="Nenhum link com esse filtro"
                description={
                  <>
                    Nenhum dos {links.length} links cadastrados casa com o setor
                    e a busca escolhidos — eles continuam lá, é a peneira que
                    está apertada.
                  </>
                }
              />
            )}
            {/* A grade fica montada assim que os dados chegam, mesmo com zero
                resultados na peneira. Trocá-la pelo painel de vazio a cada
                filtro reexecutaria o crossfade de entrada a cada tecla
                digitada — e animar interação de alta frequência é lentidão
                percebida, que é o oposto do que a animação serve aqui. */}
            <div className={`${styles.grid} ${classeAparece}`}>
              {visiveis.map((link) => (
                <LinkCard
                  key={link.id}
                  link={link}
                  nomeDe={nomeDe}
                  anoAtual={anoAtual}
                  mostrarSetor={variosSetores}
                  salvando={salvando === link.id}
                  erro={erroIcone?.id === link.id ? erroIcone.texto : null}
                  podeAlterar={podeAlterar(link)}
                  onEscolherIcone={(nome) => void escolherIcone(link, nome)}
                  onEditar={() => setAberto(link)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {aberto && (
        <LinkModal
          link={aberto === "novo" ? null : aberto}
          setores={sectors}
          setorInicial={setorInicial}
          existentes={links}
          autor={autor}
          podeApagar={aberto !== "novo" && podeAlterar(aberto)}
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}
