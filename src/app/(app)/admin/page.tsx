"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeUsers,
  saveUser,
  setUserActive,
  deleteUser,
  ROLE_LABEL,
  type UserProfile,
  type Role,
  type UserInput,
} from "@/lib/users";
import {
  subscribeSolicitantes,
  subscribeSolicitanteSetores,
  addSolicitante,
  deleteSolicitante,
  addSolicitanteSetor,
  deleteSolicitanteSetor,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import {
  addSetor,
  deleteSetor,
  useCadastroDeSetores,
  useSetoresDaPessoa,
  LIMITE_SETOR_CHARS,
  type Setor,
} from "@/lib/setores";
import { setoresOferecidos } from "@/lib/setores-core";
import {
  addDimensao,
  addSubdimensao,
  deleteDimensao,
  editarSubdimensao,
  removerSubdimensao,
  renomearDimensao,
  subscribeDimensoes,
  LIMITE_NOME_CHARS,
  TIPO_LABEL,
  corDaDimensao,
  type Dimensao,
  type TipoDeSub,
} from "@/lib/dimensoes";
import {
  salvarPermissoes,
  subscribePermissoes,
} from "@/lib/permissoes";
import { salvarEmblemas, subscribeEmblemas } from "@/lib/emblemas";
import {
  CONFIG_PADRAO,
  DEGRAUS_PADRAO,
  LIMITE_NOME_EMBLEMA,
  chaveDeSetor,
  motivoDosDegraus,
  nivelDe,
  type ConfigEmblemas,
  type Degraus,
} from "@/lib/emblemas-core";
import { entreguesPorSetor } from "@/lib/entregas-core";
import {
  columnsBySector,
  subscribeCardsForSectors,
  subscribeColumnsForSectors,
  type Card,
  type ColumnDoc,
} from "@/lib/kanban";
import {
  ABAS_CONFIGURAVEIS,
  PERMISSOES_ABERTAS,
  regraFechadaParaTodos,
  regraPadrao,
  type Permissoes,
  type RegraDaAba,
} from "@/lib/permissoes-core";
import { Icon } from "@/components/icons";
import { Avatar } from "@/components/avatar";
import { OverlayPortal } from "@/components/overlay-portal";
import { EmptyState } from "@/components/empty-state";
import { Select } from "@/components/select";
import { ErrorState } from "@/components/error-state";
import { SkeletonRow } from "@/components/skeleton";
import { useAsyncData } from "@/lib/use-async-data";
import { codigoDe, fraseDeFalha } from "@/lib/erro-ui-core";
import styles from "./admin.module.css";

/** Vazias constantes: `?? []` no corpo recria o array e invalida os `useMemo`. */
const SEM_SETORES: SolicitanteSetor[] = [];
const SEM_PESSOAS: Solicitante[] = [];
const SEM_CADASTRO: Setor[] = [];
const SEM_DIMENSOES: Dimensao[] = [];

const SUBTABS = [
  { id: "usuarios", label: "Usuários", enabled: true },
  { id: "setores", label: "Setores", enabled: true },
  { id: "dimensoes", label: "Dimensões", enabled: true },
  { id: "solicitantes", label: "Solicitantes", enabled: true },
  { id: "permissoes", label: "Permissões", enabled: true },
  { id: "emblemas", label: "Emblemas", enabled: true },
  { id: "logs", label: "Logs", enabled: false },
];

const ROLES: Role[] = ["admin", "gestor", "operador"];

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState("usuarios");
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<UserProfile | "new" | null>(null);

  /**
   * A aba de Usuários já era a única do app que distinguia carregando de
   * vazio, com `UserProfile[] | null`. Essa lógica fica exatamente como está —
   * o que muda é o que acontecia no erro.
   *
   * Antes, falhar virava `setUsers([])`: a falha se disfarçava de "nenhum
   * usuário cadastrado ainda", e o motivo real ia para o console. Agora o erro
   * tem estado próprio e o `null` continua significando só "ainda não sei".
   */
  const [erroUsers, setErroUsers] = useState<Error | null>(null);
  const [tentativaUsers, setTentativaUsers] = useState(0);

  // Esta página só abre para admin (`soAdmin` no catálogo de abas), então aqui
  // o gancho devolve o cadastro inteiro. Quem precisa dele é a prévia dos
  // Emblemas, que lê `/cards` de todos os setores.
  const setoresDoApp = useSetoresDaPessoa(profile);

  useEffect(() => {
    const unsub = subscribeUsers(
      (lista) => {
        setUsers(lista);
        // Snapshot novo limpa o erro: o Firestore reconecta sozinho, e a tela
        // tem de sair da falha sem ninguém recarregar a página.
        setErroUsers(null);
      },
      (e) => setErroUsers(e),
    );
    return () => unsub();
  }, [tentativaUsers]);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.cargo ?? "").toLowerCase().includes(q),
    );
  }, [users, search]);

  if (profile?.role !== "admin") {
    return (
      <div className={styles.noperm}>
        Esta área é exclusiva de administradores.
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>Admin</h1>
        <p>Gerencie usuários, setores e permissões do Smart Meeting.</p>
      </div>

      <div className={styles.subnav}>
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.subnavBtn} ${t.id === tab ? styles.on : ""}`}
            disabled={!t.enabled}
            onClick={() => t.enabled && setTab(t.id)}
          >
            {t.label}
            {!t.enabled && <span className={styles.soon}>em breve</span>}
          </button>
        ))}
      </div>

      {tab === "usuarios" && (
        <>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Icon name="search" size={15} />
          <input
            className={styles.search}
            placeholder="Buscar por nome, e-mail ou cargo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className={styles.btnPrimary} onClick={() => setEditing("new")}>
          <Icon name="plus" size={16} /> Adicionar usuário
        </button>
      </div>

      {erroUsers ? (
        <ErrorState
          error={erroUsers}
          onRetry={() => setTentativaUsers((n) => n + 1)}
        />
      ) : users === null ? (
        <SkeletonRow rows={5} texto="Carregando os usuários…" />
      ) : filtered.length === 0 ? (
        /* Com busca ativa isto é vazio DE VERDADE — a lista chegou e o filtro
           não achou ninguém. Continua aqui de propósito. */
        <div className={styles.empty}>
          {search
            ? "Nenhum usuário encontrado."
            : "Nenhum usuário cadastrado ainda."}
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((u) => (
            <UserRow
              key={u.email}
              user={u}
              isYou={u.email === profile.email}
              onEdit={() => setEditing(u)}
            />
          ))}
        </div>
      )}
        </>
      )}

      {tab === "setores" && <SetoresAdmin users={users} />}

      {tab === "dimensoes" && <DimensoesAdmin setores={setoresDoApp} />}

      {tab === "solicitantes" && <SolicitantesAdmin />}

      {tab === "emblemas" && (
        <EmblemasAdmin actorEmail={profile.email} setores={setoresDoApp} />
      )}

      {tab === "permissoes" && (
        <PermissoesAdmin
          actorEmail={profile.email}
          users={users}
          erroUsers={erroUsers}
        />
      )}

      {editing && (
        <UserModal
          user={editing === "new" ? null : editing}
          actorEmail={profile.email}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * O quadro de Permissões — quem enxerga qual aba.
 *
 * A DECISÃO DE FORMA: uma tela por ABA, e não uma por pessoa. As duas versões
 * guardam a mesma informação, mas respondem perguntas diferentes, e só uma
 * delas é a que se faz na prática. "Quem pode ver o Dashboard?" é a pergunta de
 * quem administra; "que abas o fulano vê?" é a de quem dá suporte a uma pessoa,
 * e essa se responde olhando para o cadastro dela — que já existe, na aba
 * Usuários. Uma tela por pessoa ainda espalharia a mesma decisão por N
 * formulários: liberar uma aba nova para o setor inteiro seria abrir um cadastro
 * por vez.
 *
 * NADA É SALVO A CADA CLIQUE. Uma aba tem modo, setores e pessoas, e as três
 * coisas são uma decisão só — gravar a cada toque publicaria estados
 * intermediários que ninguém quis, sendo o pior deles o instante entre "virei
 * para restrito" e "escolhi quem entra", que é a aba fechada para todo mundo.
 * Por isso há rascunho e um botão de salvar.
 */
function PermissoesAdmin({
  actorEmail,
  users,
  erroUsers,
}: {
  actorEmail: string;
  /** A mesma lista da aba Usuários — `null` enquanto ela não respondeu. */
  users: UserProfile[] | null;
  erroUsers: Error | null;
}) {
  const [servidor, setServidor] = useState<Permissoes | null>(null);
  const [erro, setErro] = useState<Error | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [rascunho, setRascunho] = useState<Permissoes | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  // O quadro oferece os setores do CADASTRO, e não mais uma constante de
  // código. Erro e espera não são tratados aqui de propósito: a lista só
  // alimenta as caixas de marcar, e `setoresOferecidos` já garante que o que
  // está gravado na regra continue aparecendo mesmo que a leitura falhe — que
  // é o único caso em que sumir do quadro faria estrago.
  const { setores: cadastroBruto } = useCadastroDeSetores();
  const cadastro = useMemo(
    () => (cadastroBruto ?? SEM_CADASTRO).map((x) => x.nome),
    [cadastroBruto],
  );

  useEffect(() => {
    const fechar = subscribePermissoes(
      (p) => {
        setServidor(p);
        setErro(null);
        // O rascunho só acompanha o servidor enquanto NÃO houver edição em
        // andamento — `(r) => r ?? p` faz exatamente isso na primeira resposta,
        // e o `sujo` abaixo o preserva depois. Sobrescrever o que o admin está
        // digitando porque um snapshot chegou seria perder trabalho sem nada na
        // tela dizendo por quê.
        setRascunho((r) => r ?? p);
      },
      (e) => setErro(e),
    );
    return () => fechar();
  }, [tentativa]);

  const atual = rascunho ?? PERMISSOES_ABERTAS;
  const sujo =
    !!servidor &&
    !!rascunho &&
    JSON.stringify(servidor.abas) !== JSON.stringify(rascunho.abas);

  /**
   * Quem pode ser escolhido individualmente.
   *
   * Administrador fica FORA da lista, e não desmarcado dentro dela: admin
   * enxerga toda aba por regra (`podeVerAba`), então uma caixa marcável ao lado
   * do nome dele prometeria um controle que não existe — desmarcar não tiraria
   * nada. E entram aqui os e-mails que já estão gravados na regra mas não têm
   * mais cadastro: sem isso, quem foi removido de `/users` ficaria preso na
   * configuração para sempre, sem nenhuma tela de onde tirá-lo.
   */
  const escolhiveis = useMemo(() => {
    const gravados = new Set<string>();
    Object.values(atual.abas).forEach((r) =>
      r.pessoas.forEach((e) => gravados.add(e)),
    );
    const lista = (users ?? [])
      .filter((u) => u.role !== "admin")
      .map((u) => ({ email: u.email, perfil: u as UserProfile | undefined }));
    const conhecidos = new Set(lista.map((p) => p.email));
    gravados.forEach((e) => {
      if (!conhecidos.has(e)) lista.push({ email: e, perfil: undefined });
    });
    return lista.sort((a, b) =>
      (a.perfil?.name ?? a.email).localeCompare(
        b.perfil?.name ?? b.email,
        "pt-BR",
      ),
    );
  }, [users, atual]);

  /** Os setores oferecidos, mais os que já estão gravados e saíram da lista. */
  const oferecidos = useMemo(() => {
    const gravados: string[] = [];
    Object.values(atual.abas).forEach((r) =>
      r.setores.forEach((x) => gravados.push(x)),
    );
    return setoresOferecidos(cadastro, gravados);
  }, [atual, cadastro]);

  function mexer(abaId: string, muda: (r: RegraDaAba) => RegraDaAba) {
    setErroSalvar(null);
    setRascunho((r) => {
      const base = r ?? PERMISSOES_ABERTAS;
      const antes = base.abas[abaId] ?? regraPadrao();
      return { abas: { ...base.abas, [abaId]: muda(antes) } };
    });
  }

  function alternar(lista: string[], valor: string): string[] {
    return lista.includes(valor)
      ? lista.filter((x) => x !== valor)
      : [...lista, valor];
  }

  async function salvar() {
    if (!rascunho || salvando) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      await salvarPermissoes(rascunho, actorEmail);
    } catch (e) {
      console.error("[salvar permissões]", codigoDe(e), e);
      setErroSalvar(
        fraseDeFalha(
          "Não foi possível salvar as permissões.",
          e,
          navigator.onLine,
        ),
      );
    } finally {
      setSalvando(false);
    }
  }

  if (erro)
    return (
      <ErrorState error={erro} onRetry={() => setTentativa((n) => n + 1)} />
    );
  if (!rascunho)
    return <SkeletonRow rows={4} texto="Carregando as permissões das abas…" />;

  return (
    <div className={styles.permWrap}>
      <p className={styles.permIntro}>
        Cada aba pode ficar aberta a todos ou restrita a setores e pessoas
        específicas. Quem não tiver acesso não vê a aba na barra do topo e recebe
        um aviso ao abrir o endereço direto.{" "}
        <strong>Administradores enxergam todas as abas</strong> — é assim que
        sempre existe um caminho de volta para esta tela.
      </p>

      {erroUsers && (
        <div className={styles.permAviso} role="status">
          <Icon name="warn" size={14} />
          <span>
            A lista de pessoas não carregou. Dá para configurar por setor
            normalmente; a escolha por pessoa volta quando a lista chegar.
          </span>
        </div>
      )}

      <div className={styles.permGrid}>
        {ABAS_CONFIGURAVEIS.map((aba) => {
          const regra = atual.abas[aba.id] ?? regraPadrao();
          const restrito = regra.modo === "restrito";
          const fechada = regraFechadaParaTodos(regra);
          return (
            <section key={aba.id} className={styles.permCard}>
              <div className={styles.permTop}>
                <span className={styles.permIcone}>
                  <Icon name={aba.id} size={16} />
                </span>
                <div className={styles.permNomeBloco}>
                  <div className={styles.permNome}>{aba.label}</div>
                  <div className={styles.permHref}>{aba.href}</div>
                </div>
                <div
                  className={styles.permModos}
                  role="group"
                  aria-label={`Acesso à aba ${aba.label}`}
                >
                  <button
                    type="button"
                    className={`${styles.permModo} ${!restrito ? styles.permModoOn : ""}`}
                    aria-pressed={!restrito}
                    onClick={() => mexer(aba.id, (r) => ({ ...r, modo: "todos" }))}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    className={`${styles.permModo} ${restrito ? styles.permModoOn : ""}`}
                    aria-pressed={restrito}
                    onClick={() =>
                      mexer(aba.id, (r) => ({ ...r, modo: "restrito" }))
                    }
                  >
                    Restrito
                  </button>
                </div>
              </div>

              {restrito && (
                <div className={styles.permCorpo}>
                  <div className={styles.permBloco}>
                    <div className={styles.permBlocoTitulo}>
                      Setores com acesso
                    </div>
                    <div className={styles.permChips}>
                      {oferecidos.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`${styles.permChip} ${regra.setores.includes(s) ? styles.permChipOn : ""}`}
                          aria-pressed={regra.setores.includes(s)}
                          onClick={() =>
                            mexer(aba.id, (r) => ({
                              ...r,
                              setores: alternar(r.setores, s),
                            }))
                          }
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.permBloco}>
                    <div className={styles.permBlocoTitulo}>
                      Pessoas com acesso
                    </div>
                    {escolhiveis.length === 0 ? (
                      <div className={styles.permNinguem}>
                        Não há usuários fora do papel de administrador para
                        escolher.
                      </div>
                    ) : (
                      <div className={styles.permChips}>
                        {escolhiveis.map(({ email, perfil }) => {
                          const marcado = regra.pessoas.includes(email);
                          return (
                            <button
                              key={email}
                              type="button"
                              className={`${styles.permChip} ${styles.permChipPessoa} ${marcado ? styles.permChipOn : ""}`}
                              aria-pressed={marcado}
                              title={email}
                              onClick={() =>
                                mexer(aba.id, (r) => ({
                                  ...r,
                                  pessoas: alternar(r.pessoas, email),
                                }))
                              }
                            >
                              {/* alt vazio: o nome está escrito no próprio chip. */}
                              <Avatar
                                pessoa={perfil ?? { name: "", email }}
                                size={18}
                                alt=""
                              />
                              {perfil?.name || email}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {fechada && (
                    <div className={styles.permFechada} role="status">
                      <Icon name="warn" size={14} />
                      <span>
                        Nenhum setor e nenhuma pessoa escolhidos: hoje só
                        administradores veem esta aba.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* A barra só existe quando há o que salvar. Um botão permanentemente
          clicável sem nada mudado convida ao clique que não faz nada — e, num
          quadro que decide acesso, "não sei se salvou" é a pior dúvida
          possível. */}
      {sujo && (
        <div className={styles.permBarra}>
          <span className={styles.permBarraTx}>
            Alterações ainda não salvas.
          </span>
          {erroSalvar && <span className={styles.err}>{erroSalvar}</span>}
          <button
            type="button"
            className={styles.btnGhost}
            disabled={salvando}
            onClick={() => {
              setErroSalvar(null);
              setRascunho(servidor);
            }}
          >
            Descartar
          </button>
          <button
            type="button"
            className={styles.btnSave}
            disabled={salvando}
            onClick={salvar}
          >
            {salvando ? "Salvando…" : "Salvar permissões"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * O cadastro de setores de EXECUÇÃO — a tela que faltava.
 *
 * Antes desta aba, setor de execução era a constante `DEFAULT_SECTORS` em
 * `users.ts`: pôr alguém num setor novo custava um deploy. A sub-aba já existia
 * no catálogo como `enabled: false`, de espera; agora ela é o primeiro
 * consumidor de `lib/setores`, e entra no mesmo PR que ele (AGENTS.md §4).
 *
 * A TELA MOSTRA QUANTA GENTE ESTÁ EM CADA SETOR, e é a parte que mais importa
 * dela. Remover um setor não apaga card, coluna nem o `sectors` de ninguém —
 * é só o cadastro que sai — mas quem remove precisa saber que há sete pessoas
 * ali antes de clicar, não depois. Uma lista de nomes soltos transformaria a
 * remoção num palpite.
 */
function SetoresAdmin({ users }: { users: UserProfile[] | null }) {
  const { setores: doBanco, erro, tentarDeNovo } = useCadastroDeSetores();
  const setores = doBanco ?? SEM_CADASTRO;

  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  /**
   * Quantas pessoas estão em cada setor, pela chave em minúsculas.
   *
   * Minúsculas porque o `sectors` de um usuário é texto livre gravado ao longo
   * de meses: "B.I." e "b.i." são a mesma coisa para quem lê a tela, e contar
   * separado faria o cadastro parecer vazio ao lado de um setor cheio.
   */
  const usoPorSetor = useMemo(() => {
    const m = new Map<string, number>();
    (users ?? []).forEach((u) => {
      (u.sectors ?? []).forEach((s) => {
        const k = s.trim().toLowerCase();
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      });
    });
    return m;
  }, [users]);

  async function adicionar() {
    const n = novo.trim();
    if (!n || salvando) return;
    setSalvando(true);
    setFalha(null);
    try {
      await addSetor(n, setores);
      setNovo("");
    } catch (e) {
      setFalha(fraseDeFalha(codigoDe(e), "cadastrar o setor"));
    } finally {
      setSalvando(false);
    }
  }

  async function remover(s: Setor) {
    const quantos = usoPorSetor.get(s.nome.trim().toLowerCase()) ?? 0;
    const aviso = quantos
      ? `\n\n${quantos} ${quantos === 1 ? "pessoa continua" : "pessoas continuam"} com este setor no cadastro, e ${quantos === 1 ? "ela continua enxergando" : "elas continuam enxergando"} o que é dele. O que muda é que o setor deixa de ser oferecido em novos cadastros.`
      : "";
    if (!confirm(`Remover o setor "${s.nome}" do cadastro?${aviso}`)) return;
    setFalha(null);
    try {
      await deleteSetor(s.id);
    } catch (e) {
      setFalha(fraseDeFalha(codigoDe(e), "remover o setor"));
    }
  }

  return (
    <div className={styles.permWrap}>
      <p className={styles.permIntro}>
        Setor de <strong>execução</strong> é quem <strong>faz</strong> a
        demanda: é o que aparece no seletor de setores do cadastro de usuários e
        o que divide os quadros do Kanban. Não confunda com{" "}
        <strong>setores solicitantes</strong>, na aba ao lado — aqueles são quem{" "}
        <strong>pede</strong>. Abrir o Kanban de um setor recém-criado já cria as
        cinco colunas padrão.
      </p>

      <div className={styles.solCol}>
        <div className={styles.solHead}>Setores de execução</div>
        <div className={styles.solAdd}>
          <input
            className={styles.input}
            placeholder="Ex.: Diretoria"
            maxLength={LIMITE_SETOR_CHARS}
            value={novo}
            onChange={(e) => {
              setNovo(e.target.value);
              setFalha(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") adicionar();
            }}
          />
          <button
            className={styles.btnPrimary}
            onClick={adicionar}
            disabled={salvando || !novo.trim()}
          >
            <Icon name="plus" size={15} />{" "}
            {salvando ? "Cadastrando…" : "Adicionar"}
          </button>
        </div>

        {falha && <div className={styles.err}>{falha}</div>}

        {erro ? (
          <ErrorState error={erro} size="compact" onRetry={tentarDeNovo} />
        ) : doBanco === undefined ? (
          <SkeletonRow rows={4} texto="Carregando os setores…" />
        ) : setores.length === 0 ? (
          <EmptyState
            size="compact"
            icon="users"
            title="Nenhum setor cadastrado ainda"
            description="Enquanto esta lista estiver vazia, o app continua oferecendo só B.I. Cadastre acima os setores que executam demanda."
          />
        ) : (
          <div className={styles.solList}>
            {setores.map((s) => {
              const quantos = usoPorSetor.get(s.nome.trim().toLowerCase()) ?? 0;
              return (
                <div key={s.id} className={styles.solItem}>
                  <span>{s.nome}</span>
                  <span className={styles.setUso}>
                    {/* `users === null` é "ainda não sei", e dizer "0 pessoas"
                        aí seria a mesma mentira que os esqueletos deste
                        projeto existem para tirar da tela. */}
                    {users === null
                      ? "—"
                      : quantos === 0
                        ? "ninguém"
                        : `${quantos} ${quantos === 1 ? "pessoa" : "pessoas"}`}
                    <button
                      className={styles.iconBtn}
                      title="Remover do cadastro"
                      onClick={() => remover(s)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * O cadastro da ÁRVORE de um setor — dimensões e, dentro delas, subdimensões.
 *
 * POR QUE ELE É CADASTRO, e não uma constante em código: a árvore da Infra tem
 * cinco dimensões e trinta e quatro subdimensões que mudam sozinhas, sem passar
 * por ninguém que saiba abrir um PR. O AGENTS.md §4 já registrou essa lição a
 * respeito de `DEFAULT_SECTORS` — "cadastro que só o build muda não é cadastro,
 * é código com nome de dado".
 *
 * ELE MORA NO ADMIN, MAS A REGRA DO FIRESTORE É DE GESTOR DO SETOR. A diferença
 * é de propósito e está escrita em `firestore.rules`: dimensão não é fronteira
 * de visibilidade como setor de execução é, então quem responde pelo setor pode
 * organizá-lo. A aba Admin é só onde a tela ficou; no dia em que um gestor
 * precisar dela, ela se move sem tocar na regra.
 */
function DimensoesAdmin({ setores }: { setores: string[] }) {
  /**
   * O setor em uso é DERIVADO da escolha da pessoa mais a lista, e não
   * sincronizado por efeito: `useSetoresDaPessoa` começa no piso e vira o
   * cadastro quando ele responde, e um `setSetor` dentro de efeito custaria um
   * render a mais a cada resposta.
   */
  const [escolhido, setEscolhido] = useState("");
  const setor =
    escolhido && setores.includes(escolhido) ? escolhido : (setores[0] ?? "");

  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  /**
   * `useAsyncData` e não um `useState` + efeito: ele já distingue os três
   * estados que esta tela precisa separar — "ainda não respondeu" (esqueleto),
   * "respondeu e está vazio" (o setor não tem árvore) e "falhou" (com o botão
   * de tentar de novo). A chave é o setor, então trocar de setor volta ao
   * esqueleto sem nenhum `setState` dentro de efeito para zerar a lista.
   */
  const fDims = useAsyncData<Dimensao>(setor, (onData, onErro) => {
    if (!setor) {
      onData([]);
      return () => {};
    }
    return subscribeDimensoes(setor, onData, onErro);
  });
  const dims = fDims.data;
  const erro = fDims.erro;
  const lista = dims ?? SEM_DIMENSOES;

  async function tentar(oQue: string, acao: () => Promise<unknown>) {
    setFalha(null);
    try {
      await acao();
    } catch (e) {
      setFalha(fraseDeFalha(codigoDe(e), oQue));
    }
  }

  async function adicionar() {
    const n = novo.trim();
    if (!n || salvando || !setor) return;
    setSalvando(true);
    await tentar("cadastrar a dimensão", async () => {
      await addDimensao(setor, n, lista);
      setNovo("");
    });
    setSalvando(false);
  }

  return (
    <div className={styles.permWrap}>
      <p className={styles.permIntro}>
        <strong>Dimensão</strong> é o antigo &ldquo;pilar&rdquo;: a divisão do
        trabalho de um setor. Dentro dela vêm as <strong>subdimensões</strong>,
        que podem ser um <strong>projeto</strong> (tem fim, e por isso tem
        porcentagem de conclusão) ou uma <strong>rotina</strong> (não termina — é
        uma caixa que abriga trabalhos ao longo do tempo). É esta árvore que a aba{" "}
        <strong>Dimensões</strong> desenha.
      </p>
      <p className={styles.permIntro}>
        Remover daqui <strong>não apaga demanda nenhuma</strong>: as que
        apontavam para a gaveta removida voltam a aparecer na árvore, em
        &ldquo;Sem classificação&rdquo;.
      </p>

      <div className={styles.dimSetor}>
        <label className={styles.dimSetorLbl}>Setor de execução</label>
        <Select
          value={setor}
          options={setores.map((s) => ({ value: s, label: s }))}
          onChange={setEscolhido}
          ariaLabel="Setor de execução"
        />
      </div>

      <div className={styles.solCol}>
        <div className={styles.solHead}>Dimensões de {setor || "—"}</div>
        <div className={styles.solAdd}>
          <input
            className={styles.input}
            placeholder="Ex.: Manutenção e Oficina"
            maxLength={LIMITE_NOME_CHARS}
            value={novo}
            onChange={(e) => {
              setNovo(e.target.value);
              setFalha(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") adicionar();
            }}
          />
          <button
            className={styles.btnPrimary}
            onClick={adicionar}
            disabled={salvando || !novo.trim() || !setor}
          >
            <Icon name="plus" size={15} />{" "}
            {salvando ? "Cadastrando…" : "Adicionar"}
          </button>
        </div>

        {falha && <div className={styles.err}>{falha}</div>}

        {erro ? (
          <ErrorState
            error={erro}
            size="compact"
            onRetry={fDims.tentarDeNovo}
          />
        ) : dims === undefined ? (
          <SkeletonRow rows={4} texto="Carregando a árvore…" />
        ) : lista.length === 0 ? (
          <EmptyState
            size="compact"
            icon="pasta"
            title="Este setor ainda não tem árvore"
            description="Cadastre acima a primeira dimensão. Enquanto não houver nenhuma, a aba Dimensões mostra todas as demandas do setor em “Sem classificação”, e o formulário da demanda não pergunta nada."
          />
        ) : (
          <div className={styles.dimLista}>
            {lista.map((d, i) => (
              <DimensaoItem
                key={d.id}
                dim={d}
                cor={corDaDimensao(d.ordem || i)}
                aberta={aberta === d.id}
                onAbrir={() => setAberta(aberta === d.id ? null : d.id)}
                onErro={setFalha}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DimensaoItem({
  dim,
  cor,
  aberta,
  onAbrir,
  onErro,
}: {
  dim: Dimensao;
  cor: string;
  aberta: boolean;
  onAbrir: () => void;
  onErro: (f: string | null) => void;
}) {
  const [nova, setNova] = useState("");
  const [tipo, setTipo] = useState<TipoDeSub>("rotina");
  const [salvando, setSalvando] = useState(false);

  async function tentar(oQue: string, acao: () => Promise<unknown>) {
    onErro(null);
    try {
      await acao();
    } catch (e) {
      onErro(fraseDeFalha(codigoDe(e), oQue));
    }
  }

  async function addSub() {
    const n = nova.trim();
    if (!n || salvando) return;
    setSalvando(true);
    await tentar("cadastrar a subdimensão", async () => {
      await addSubdimensao(dim, n, tipo);
      setNova("");
    });
    setSalvando(false);
  }

  return (
    <div className={styles.dimItem} style={{ borderLeftColor: cor }}>
      <div className={styles.dimHead}>
        <button
          className={`${styles.dimNome} ${aberta ? styles.dimAberta : ""}`}
          onClick={onAbrir}
          aria-expanded={aberta}
        >
          <Icon name="chevronRight" size={13} />
          <strong>{dim.nome}</strong>
          <span className={styles.dimQtd}>
            {dim.subs.length === 0
              ? "sem subdimensões"
              : `${dim.subs.length} ${dim.subs.length === 1 ? "subdimensão" : "subdimensões"}`}
          </span>
        </button>
        <button
          className={styles.iconBtn}
          title="Renomear a dimensão"
          onClick={() => {
            // `prompt`, como o `confirm` das outras remoções desta tela: é ação
            // rara, de administrador, e um formulário embutido em cada linha
            // encheria a tela de campos que quase nunca são usados.
            const n = prompt("Novo nome da dimensão:", dim.nome);
            if (n && n.trim() && n.trim() !== dim.nome) {
              tentar("renomear a dimensão", () => renomearDimensao(dim.id, n));
            }
          }}
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          className={styles.iconBtn}
          title="Remover do cadastro"
          onClick={() => {
            const quantas = dim.subs.length;
            const comSubs = quantas
              ? ` e as ${quantas} subdimensões dela`
              : "";
            if (
              !confirm(
                `Remover a dimensão "${dim.nome}"${comSubs}?\n\nNenhuma demanda é apagada: as que estavam aqui voltam a aparecer em "Sem classificação", na aba Dimensões.`,
              )
            ) {
              return;
            }
            tentar("remover a dimensão", () => deleteDimensao(dim.id));
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      {aberta && (
        <div className={styles.subWrap}>
          {dim.subs.map((sub) => (
            <div key={sub.id} className={styles.subItem}>
              <span className={styles.subNome}>{sub.nome}</span>
              {/* O tipo troca no clique, sem menu: são dois valores, e um
                  seletor de duas opções por linha custaria mais tela do que o
                  próprio nome da subdimensão. */}
              <button
                className={`${styles.subTipo} ${sub.tipo === "projeto" ? styles.subProjeto : ""}`}
                title="Alternar entre projeto e rotina"
                onClick={() =>
                  tentar("mudar o tipo da subdimensão", () =>
                    editarSubdimensao(dim, sub.id, {
                      tipo: sub.tipo === "projeto" ? "rotina" : "projeto",
                    }),
                  )
                }
              >
                {TIPO_LABEL[sub.tipo]}
              </button>
              <button
                className={styles.iconBtn}
                title="Renomear a subdimensão"
                onClick={() => {
                  const n = prompt("Novo nome da subdimensão:", sub.nome);
                  if (n && n.trim() && n.trim() !== sub.nome) {
                    tentar("renomear a subdimensão", () =>
                      editarSubdimensao(dim, sub.id, { nome: n }),
                    );
                  }
                }}
              >
                <Icon name="edit" size={13} />
              </button>
              <button
                className={styles.iconBtn}
                title="Remover a subdimensão"
                onClick={() => {
                  if (!confirm(`Remover a subdimensão "${sub.nome}"?`)) return;
                  tentar("remover a subdimensão", () =>
                    removerSubdimensao(dim, sub.id),
                  );
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}

          <div className={styles.subAdd}>
            <input
              className={styles.input}
              placeholder="Nova subdimensão"
              maxLength={LIMITE_NOME_CHARS}
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSub();
              }}
            />
            <button
              className={`${styles.subTipo} ${tipo === "projeto" ? styles.subProjeto : ""}`}
              title="A nova subdimensão entra como projeto ou como rotina"
              onClick={() => setTipo(tipo === "projeto" ? "rotina" : "projeto")}
            >
              {TIPO_LABEL[tipo]}
            </button>
            <button
              className={styles.btnPrimary}
              onClick={addSub}
              disabled={salvando || !nova.trim()}
            >
              <Icon name="plus" size={14} /> Incluir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SolicitantesAdmin() {
  /**
   * Duas colunas, duas assinaturas, dois estados independentes — de propósito.
   *
   * São coleções separadas: a de setores pode responder antes da de pessoas, e
   * segurar as duas juntas seria inventar uma espera. Antes, as duas jogavam o
   * erro fora e as duas colunas afirmavam "ainda não tem nenhum" desde o
   * primeiro quadro.
   */
  const fSetores = useAsyncData<SolicitanteSetor>("todos", (onData, onErro) =>
    subscribeSolicitanteSetores(onData, onErro),
  );
  const fPessoas = useAsyncData<Solicitante>("todos", (onData, onErro) =>
    subscribeSolicitantes(onData, onErro),
  );
  const setores = fSetores.data ?? SEM_SETORES;
  const pessoas = fPessoas.data ?? SEM_PESSOAS;

  const [newSetor, setNewSetor] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function addSetor() {
    const n = newSetor.trim();
    if (!n || busy) return;
    if (setores.some((s) => s.name.toLowerCase() === n.toLowerCase())) {
      setNewSetor("");
      return;
    }
    setBusy(true);
    try {
      await addSolicitanteSetor(n);
      setNewSetor("");
    } catch (e) {
      console.error(e);
      alert("Não foi possível adicionar o setor.");
    } finally {
      setBusy(false);
    }
  }
  async function removeSetor(id: string, name: string) {
    if (!confirm(`Remover o setor solicitante "${name}"?`)) return;
    try {
      await deleteSolicitanteSetor(id);
    } catch (e) {
      console.error(e);
      alert("Não foi possível remover.");
    }
  }
  async function addPessoa() {
    const n = newName.trim();
    if (!n || busy) return;
    if (pessoas.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      setNewName("");
      return;
    }
    setBusy(true);
    try {
      await addSolicitante(n);
      setNewName("");
    } catch (e) {
      console.error(e);
      alert("Não foi possível adicionar o solicitante.");
    } finally {
      setBusy(false);
    }
  }
  async function removePessoa(id: string, name: string) {
    if (!confirm(`Remover o solicitante "${name}"?`)) return;
    try {
      await deleteSolicitante(id);
    } catch (e) {
      console.error(e);
      alert("Não foi possível remover.");
    }
  }

  return (
    <div className={styles.solGrid}>
      <div className={styles.solCol}>
        <div className={styles.solHead}>Setores solicitantes</div>
        <div className={styles.solAdd}>
          <input
            className={styles.input}
            placeholder="Ex.: Comercial"
            value={newSetor}
            onChange={(e) => setNewSetor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSetor();
            }}
          />
          <button
            className={styles.btnPrimary}
            onClick={addSetor}
            disabled={busy || !newSetor.trim()}
          >
            <Icon name="plus" size={15} /> Adicionar
          </button>
        </div>
        {fSetores.erro ? (
          <ErrorState
            error={fSetores.erro}
            size="compact"
            onRetry={fSetores.tentarDeNovo}
          />
        ) : fSetores.data === undefined ? (
          <SkeletonRow rows={3} texto="Carregando os setores solicitantes…" />
        ) : setores.length === 0 ? (
          <EmptyState
            size="compact"
            icon="users"
            title="Nenhum setor solicitante ainda"
            description="Cadastre acima os setores que costumam pedir demandas — eles viram opção no formulário do Kanban."
          />
        ) : (
          <div className={styles.solList}>
            {setores.map((s) => (
              <div key={s.id} className={styles.solItem}>
                <span>{s.name}</span>
                <button
                  className={styles.iconBtn}
                  title="Remover"
                  onClick={() => removeSetor(s.id, s.name)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.solCol}>
        <div className={styles.solHead}>Solicitantes</div>
        <div className={styles.solAdd}>
          <input
            className={styles.input}
            placeholder="Nome do solicitante"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPessoa();
            }}
          />
          <button
            className={styles.btnPrimary}
            onClick={addPessoa}
            disabled={busy || !newName.trim()}
          >
            <Icon name="plus" size={15} /> Adicionar
          </button>
        </div>
        {fPessoas.erro ? (
          <ErrorState
            error={fPessoas.erro}
            size="compact"
            onRetry={fPessoas.tentarDeNovo}
          />
        ) : fPessoas.data === undefined ? (
          <SkeletonRow rows={3} texto="Carregando os solicitantes…" />
        ) : pessoas.length === 0 ? (
          <EmptyState
            size="compact"
            icon="users"
            title="Nenhum solicitante ainda"
            description="Cadastre acima quem costuma pedir demandas — os nomes viram opção no formulário do Kanban."
          />
        ) : (
          <div className={styles.solList}>
            {pessoas.map((p) => (
              <div key={p.id} className={styles.solItem}>
                <span>{p.name}</span>
                <button
                  className={styles.iconBtn}
                  title="Remover"
                  onClick={() => removePessoa(p.id, p.name)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserRow({
  user,
  isYou,
  onEdit,
}: {
  user: UserProfile;
  isYou: boolean;
  onEdit: () => void;
}) {
  const roleClass =
    user.role === "admin"
      ? styles.roleadmin
      : user.role === "gestor"
        ? styles.rolegestor
        : styles.roleoperador;

  async function toggleActive() {
    try {
      await setUserActive(user.email, !user.active);
    } catch (e) {
      console.error(e);
      alert("Não foi possível alterar o status.");
    }
  }

  async function remove() {
    if (
      !confirm(
        `Remover ${user.name || user.email}? Esta ação não pode ser desfeita.`,
      )
    )
      return;
    try {
      await deleteUser(user.email);
    } catch (e) {
      console.error(e);
      alert("Não foi possível remover.");
    }
  }

  return (
    <div className={`${styles.row} ${!user.active ? styles.rowInactive : ""}`}>
      {/* alt vazio: o nome da pessoa está escrito na linha, ao lado. */}
      <Avatar pessoa={user} size={38} alt="" />

      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={styles.rowName}>{user.name || "(sem nome)"}</span>
          {user.cargo && <span className={styles.rowCargo}>· {user.cargo}</span>}
          {isYou && <span className={styles.you}>você</span>}
          {!user.active && <span className={styles.you}>inativo</span>}
        </div>
        <div className={styles.rowEmail}>{user.email}</div>
        {(user.sectors?.length ?? 0) > 0 && (
          <div className={styles.rowSectors}>
            {user.sectors.map((s) => (
              <span key={s} className={styles.secChip}>
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <span className={`${styles.roleBadge} ${roleClass}`}>
        {ROLE_LABEL[user.role]}
      </span>

      <div className={styles.actions}>
        {!isYou && (
          <button
            className={styles.iconBtn}
            title={user.active ? "Desativar" : "Ativar"}
            onClick={toggleActive}
          >
            <Icon name={user.active ? "check" : "x"} size={15} />
          </button>
        )}
        <button className={styles.iconBtn} title="Editar" onClick={onEdit}>
          <Icon name="edit" size={15} />
        </button>
        {!isYou && (
          <button className={styles.iconBtn} title="Remover" onClick={remove}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function UserModal({
  user,
  actorEmail,
  onClose,
}: {
  user: UserProfile | null;
  actorEmail: string;
  onClose: () => void;
}) {
  const isNew = user === null;
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [cargo, setCargo] = useState(user?.cargo ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "operador");
  const [sectors, setSectors] = useState<string[]>(user?.sectors ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * O que o formulário oferece: o cadastro, MAIS o que esta pessoa já tem.
   *
   * A segunda metade é a que importa. Sem ela, abrir o cadastro de alguém que
   * está num setor apagado do cadastro mostraria o vínculo como inexistente, e
   * o primeiro "Salvar" — mesmo que só corrigisse o cargo — gravaria `sectors`
   * sem aquele setor. Perder o acesso de alguém por causa de uma edição de
   * cargo é o tipo de estrago que não deixa rastro nenhum na tela.
   */
  const { setores: cadastroBruto } = useCadastroDeSetores();
  const opcoes = useMemo(
    () =>
      setoresOferecidos(
        (cadastroBruto ?? SEM_CADASTRO).map((x) => x.nome),
        user?.sectors ?? [],
      ),
    [cadastroBruto, user],
  );

  function toggleSector(s: string) {
    setSectors((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    );
  }

  async function submit() {
    setErr(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErr("Informe um e-mail válido.");
      return;
    }
    if (!name.trim()) {
      setErr("Informe o nome.");
      return;
    }
    setSaving(true);
    try {
      const input: UserInput = { email: cleanEmail, name, cargo, role, sectors };
      await saveUser(input, actorEmail, isNew);
      onClose();
    } catch (e) {
      console.error("[salvar usuário]", codigoDe(e), e);
      // `saveUser` valida o nome antes de escrever e lança o motivo já em
      // português (ver `conferirNome`). Engolir tudo em "verifique suas
      // permissões" faria um admin colando um nome de 90 caracteres ler que o
      // problema é acesso — e ele tem acesso. Erro do Firestore continua
      // passando por `fraseDeFalha`, que é quem sabe traduzi-lo.
      setErr(
        e instanceof Error && !codigoDe(e)
          ? e.message
          : fraseDeFalha(
              "Não foi possível salvar o usuário.",
              e,
              navigator.onLine,
            ),
      );
      setSaving(false);
    }
  }

  return (
    <OverlayPortal>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalTitle}>
            {isNew ? "Adicionar usuário" : "Editar usuário"}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>E-mail (login Google)</label>
            <input
              className={styles.input}
              type="email"
              placeholder="pessoa@christus.edu.br"
              value={email}
              disabled={!isNew}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Nome</label>
            <input
              className={styles.input}
              placeholder="Nome completo"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Cargo</label>
            <input
              className={styles.input}
              placeholder="Ex.: Analista de B.I."
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Papel</label>
            <select
              className={styles.select}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Setores</label>
            <div className={styles.secGrid}>
              {opcoes.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.secToggle} ${sectors.includes(s) ? styles.sel : ""}`}
                  onClick={() => toggleSector(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {err && <div className={styles.err}>{err}</div>}

          <div className={styles.modalActions}>
            <button
              className={styles.btnGhost}
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              className={styles.btnSave}
              onClick={submit}
              disabled={saving}
            >
              {saving ? "Salvando…" : isNew ? "Adicionar" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}

/**
 * O quadro de Emblemas — o nome de cada setor solicitante e os três degraus.
 *
 * MESMO MOLDE MECÂNICO DO QUADRO DE PERMISSÕES, e de propósito: rascunho local,
 * nada salvo a cada clique, uma barra que só aparece quando há o que salvar. As
 * duas telas configuram documentos irmãos em `/config`, e um admin que aprendeu
 * uma tem de reconhecer a outra.
 *
 * ELE MOSTRA O IMPACTO ANTES DE SALVAR, e essa é a parte que não existe no
 * quadro de Permissões. A razão é concreta: uma escada de degraus é um número
 * abstrato até alguém ver quantas pessoas ela alcança. Medido no banco em
 * 2026-08-18, 20/50/100 entregava ZERO emblema no app inteiro — o recurso
 * nasceria desligado por constante, e quem escolhesse esses números não teria
 * como saber disso antes de publicar. A prévia responde "quantos emblemas esta
 * escada dá hoje?" enquanto se digita.
 *
 * OS SETORES OFERECIDOS SAEM DAS DEMANDAS, e não do cadastro
 * `/solicitanteSetores` inteiro. É o mesmo raciocínio dos filtros da aba Links:
 * são treze setores cadastrados e dez com alguma entrega — oferecer para
 * nomear os que nunca receberam nada é ruído com cara de escolha. Setor que
 * aparecer depois entra sozinho na lista.
 */
function EmblemasAdmin({
  actorEmail,
  setores,
}: {
  actorEmail: string;
  /** O cadastro inteiro — a prévia varre os cards de todos os setores. */
  setores: string[];
}) {
  const [servidor, setServidor] = useState<ConfigEmblemas | null>(null);
  const [erro, setErro] = useState<Error | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [rascunho, setRascunho] = useState<ConfigEmblemas | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  useEffect(() => {
    const fechar = subscribeEmblemas(
      (c) => {
        setServidor(c);
        setErro(null);
        // O rascunho só acompanha o servidor enquanto não houver edição em
        // andamento — mesma linha do quadro de Permissões, e pelo mesmo motivo:
        // sobrescrever o que o admin está digitando porque um snapshot chegou é
        // perder trabalho sem nada na tela dizendo por quê.
        setRascunho((r) => r ?? c);
      },
      (e) => setErro(e),
    );
    return () => fechar();
  }, [tentativa]);

  /**
   * O quadro inteiro, para a prévia de impacto. É a única tela do Admin que lê
   * `/cards` — e ela paga isso para não pedir ao admin que escolha três números
   * às cegas.
   */
  const chave = setores.join("|");
  const fCards = useAsyncData<Card>(chave, (onData, onErro) =>
    subscribeCardsForSectors(setores, onData, onErro),
  );
  const fCols = useAsyncData<ColumnDoc>(chave, (onData, onErro) =>
    subscribeColumnsForSectors(setores, onData, onErro),
  );

  /** Pares (pessoa × setor solicitante) com entrega, e os setores que apareceram. */
  const { pares, setoresVistos, prontoParaPrevia } = useMemo(() => {
    const cards = fCards.data;
    const cols = fCols.data;
    if (!cards || !cols) {
      return { pares: [] as number[], setoresVistos: new Map<string, string>(), prontoParaPrevia: false };
    }
    const ent = entreguesPorSetor(columnsBySector(cols, setores));
    const conta = new Map<string, number>();
    const vistos = new Map<string, string>();
    cards.forEach((c) => {
      if (!ent[c.sector]?.has(c.columnId)) return;
      const quem = (c.assignee ?? "").trim();
      const setor = (c.requesterSector ?? "").trim();
      if (!quem || !setor) return;
      const k = chaveDeSetor(setor);
      // A MENOR grafia por pt-BR, e não a primeira que apareceu: a ordem do
      // snapshot não é contrato, e o rótulo mudaria entre dois carregamentos.
      const atual = vistos.get(k);
      if (!atual || setor.localeCompare(atual, "pt-BR") < 0) vistos.set(k, setor);
      conta.set(`${quem}|${k}`, (conta.get(`${quem}|${k}`) ?? 0) + 1);
    });
    return {
      pares: [...conta.values()],
      setoresVistos: vistos,
      prontoParaPrevia: true,
    };
  }, [fCards.data, fCols.data, setores]);

  const atual = rascunho ?? CONFIG_PADRAO;

  /** Os setores a nomear: os que têm entrega, mais os que já foram nomeados. */
  const setoresParaNomear = useMemo(() => {
    const m = new Map(setoresVistos);
    Object.entries(atual.setores).forEach(([k, v]) => {
      if (!m.has(k)) m.set(k, v.setor);
    });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [setoresVistos, atual.setores]);

  const sujo =
    !!servidor && !!rascunho && JSON.stringify(servidor) !== JSON.stringify(rascunho);

  const motivo = motivoDosDegraus(atual.degraus[0], atual.degraus[1], atual.degraus[2]);

  /** Quantos emblemas cada nível entrega com a escada que está na tela agora. */
  const impacto = useMemo(() => {
    if (!prontoParaPrevia || motivo) return null;
    const n = [0, 0, 0];
    pares.forEach((q) => {
      const nivel = nivelDe(q, atual.degraus);
      if (nivel >= 1) n[0]++;
      if (nivel >= 2) n[1]++;
      if (nivel >= 3) n[2]++;
    });
    return { n1: n[0], n2: n[1], n3: n[2], total: pares.length };
  }, [prontoParaPrevia, motivo, pares, atual.degraus]);

  function mexerDegrau(i: 0 | 1 | 2, valor: string) {
    const n = Number(valor);
    setRascunho((r) => {
      const base = r ?? CONFIG_PADRAO;
      const d: [number, number, number] = [
        base.degraus[0],
        base.degraus[1],
        base.degraus[2],
      ];
      // `NaN` guardado como 0 e não recusado na digitação: apagar o campo para
      // digitar outro número passa por vazio, e recusar ali travaria o teclado.
      // Quem reprova é `motivoDosDegraus`, na hora de salvar.
      d[i] = Number.isFinite(n) ? Math.trunc(n) : 0;
      return { ...base, degraus: d as Degraus };
    });
  }

  function mexerNome(chaveSetor: string, grafia: string, nome: string) {
    setRascunho((r) => {
      const base = r ?? CONFIG_PADRAO;
      return {
        ...base,
        setores: { ...base.setores, [chaveSetor]: { setor: grafia, nome } },
      };
    });
  }

  async function salvar() {
    if (!rascunho || salvando || motivo) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      await salvarEmblemas(rascunho, actorEmail);
    } catch (e) {
      console.error("[salvar emblemas]", codigoDe(e), e);
      setErroSalvar(
        fraseDeFalha("Não foi possível salvar os emblemas.", e, navigator.onLine),
      );
    } finally {
      setSalvando(false);
    }
  }

  if (erro)
    return <ErrorState error={erro} onRetry={() => setTentativa((n) => n + 1)} />;
  if (!rascunho)
    return <SkeletonRow rows={4} texto="Carregando a configuração dos emblemas…" />;

  return (
    <div className={styles.permWrap}>
      <p className={styles.permIntro}>
        Cada setor solicitante rende um emblema a quem entrega demandas para ele.
        São <strong>três degraus</strong>, iguais para todos os setores — o que
        muda por setor é só o nome. Quem entrega passa a exibir o emblema no
        próprio perfil.
      </p>

      <div className={styles.embDegraus}>
        <div className={styles.embDegrausCampos}>
          {([0, 1, 2] as const).map((i) => (
            <label key={i} className={styles.embDegrau}>
              <span className={styles.embDegrauRotulo}>
                {["Nível I", "Nível II", "Nível III"][i]}
              </span>
              <input
                className={styles.embInputNum}
                type="number"
                min={1}
                value={atual.degraus[i] || ""}
                onChange={(e) => mexerDegrau(i, e.target.value)}
                aria-label={`Entregas para o nível ${i + 1}`}
              />
              <span className={styles.embDegrauSufixo}>entregas</span>
            </label>
          ))}
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() =>
              setRascunho((r) => ({ ...(r ?? CONFIG_PADRAO), degraus: DEGRAUS_PADRAO }))
            }
          >
            Padrão ({DEGRAUS_PADRAO.join(" / ")})
          </button>
          {/* O botão existe porque 20/50/100 foi o número pedido, e porque a
              prévia ao lado mostra o preço dele sem ninguém precisar publicar
              para descobrir. */}
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() =>
              setRascunho((r) => ({ ...(r ?? CONFIG_PADRAO), degraus: [20, 50, 100] }))
            }
          >
            20 / 50 / 100
          </button>
        </div>

        {motivo ? (
          <p className={styles.embErro} role="alert">
            {motivo}
          </p>
        ) : impacto ? (
          <p className={styles.embImpacto} role="status">
            Com esta escada, <strong>{impacto.n1}</strong> dos {impacto.total}{" "}
            pares de pessoa e setor alcançam o nível I hoje —{" "}
            <strong>{impacto.n2}</strong> chegam ao II e{" "}
            <strong>{impacto.n3}</strong> ao III.
            {impacto.n1 === 0 && (
              <>
                {" "}
                <strong>Ninguém receberia emblema nenhum</strong> com estes
                números.
              </>
            )}
          </p>
        ) : (
          <p className={styles.embImpacto}>
            Contando as entregas do quadro para mostrar o alcance desta escada…
          </p>
        )}
      </div>

      <div className={styles.embLista}>
        {setoresParaNomear.length === 0 ? (
          <p className={styles.embVazio}>
            Nenhum setor solicitante recebeu entrega ainda. Assim que uma demanda
            for concluída com o campo <b>Setor solicitante</b> preenchido, ele
            aparece aqui para ser nomeado.
          </p>
        ) : (
          setoresParaNomear.map(([chaveSetor, grafia]) => (
            <div key={chaveSetor} className={styles.embLinha}>
              <span className={styles.embSetor}>{grafia}</span>
              <input
                className={styles.embInputNome}
                value={atual.setores[chaveSetor]?.nome ?? ""}
                maxLength={LIMITE_NOME_EMBLEMA}
                placeholder={`sem nome — o emblema aparece como “${grafia}”`}
                onChange={(e) => mexerNome(chaveSetor, grafia, e.target.value)}
                aria-label={`Nome do emblema de ${grafia}`}
              />
            </div>
          ))
        )}
      </div>

      {sujo && (
        <div className={styles.permBarra}>
          <span className={styles.permBarraTx}>Alterações ainda não salvas.</span>
          {erroSalvar && <span className={styles.err}>{erroSalvar}</span>}
          <button
            type="button"
            className={styles.btnGhost}
            disabled={salvando}
            onClick={() => {
              setErroSalvar(null);
              setRascunho(servidor);
            }}
          >
            Descartar
          </button>
          <button
            type="button"
            className={styles.btnSave}
            disabled={salvando || !!motivo}
            title={motivo ?? undefined}
            onClick={salvar}
          >
            {salvando ? "Salvando…" : "Salvar emblemas"}
          </button>
        </div>
      )}
    </div>
  );
}
