import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  onSnapshot,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";
import { conferirFoto, conferirNome, corDeAvatar } from "./avatar-core.ts";
import { normalizarMoldura } from "./molduras-core.ts";

// A regra do avatar mora em `avatar-core`, que é puro; aqui ela é reexportada
// para quem JÁ importa este módulo — o modal da foto, que precisa do `photo` e
// da escrita na mesma linha de import.
//
// Quem NÃO deve vir por aqui é componente de desenho: `<Avatar>` importa direto
// do módulo puro, e é assim que ele evita arrastar `firebase/firestore` para
// dentro de todo lugar que mostra o rosto de alguém. As duas portas são de
// propósito, e a diferença entre elas é quem já paga o SDK.
export {
  avatarDe,
  conferirFoto,
  conferirNome,
  corDeAvatar,
  inicialDe,
  LADO_FOTO_PX,
  LIMITE_FOTO_BYTES,
  LIMITE_NOME_CHARS,
  tamanhoDataUri,
  type Avatar,
  type NomeConferido,
  type PessoaDoAvatar,
} from "./avatar-core.ts";

/** E-mail super admin (bootstrap). Precisa bater com o valor em firestore.rules. */
export const SUPER_ADMIN_EMAIL = "setorbiunichristus@gmail.com";

// O papel e o rótulo dele moram em `perfil-core`, que é puro — este arquivo
// importa `firebase/firestore` na primeira linha, e um core que buscasse a
// tabela aqui deixaria de ser core. A porta continua sendo uma só para as
// telas: elas seguem perguntando a `users.ts`, como sempre fizeram.
export { ROLE_LABEL } from "./perfil-core.ts";
export type { Role } from "./perfil-core.ts";
import type { Role } from "./perfil-core.ts";

export type UserProfile = {
  email: string;
  name: string;
  role: Role;
  cargo: string;
  sectors: string[];
  active: boolean;
  color: string;
  uid?: string | null;
  /**
   * Foto de perfil como data URI, ou ausente/null para quem não escolheu uma.
   *
   * Vem junto no `subscribeUsers`, e é essa a razão de o tamanho ser trancado
   * em `avatar-core.ts`: este campo é baixado por todo cliente em toda tela.
   */
  photo?: string | null;
  /**
   * Id da pessoa no Discord, quando ela vinculou a conta.
   *
   * Quem grava é o SERVIDOR (`api/discord/interactions`, pelo Admin SDK), nunca
   * a tela — por isso ele fica fora do `hasOnly` do dono em `firestore.rules`.
   * Abrir aquela lista para mais um campo seria arriscar `role`, `active` e
   * `sectors` por causa de um id que nem é segredo.
   *
   * É o que transforma o aviso da demanda no Discord em notificação de verdade:
   * sem ele a mensagem chega no canal e depende de alguém estar olhando.
   */
  discordId?: string | null;
  /** Como a pessoa se chama no Discord, para a tela do Perfil mostrar. */
  discordUser?: string | null;
  /**
   * O id da moldura que a pessoa escolheu para o próprio avatar.
   *
   * ID CURTO, nunca a pintura — o mais longo do catálogo tem 7 caracteres.
   * É o mesmo raciocínio que trancou o tamanho da `photo` logo acima, e pelo
   * mesmo motivo: `subscribeUsers` assina esta coleção INTEIRA em sete telas,
   * então todo byte daqui é baixado por todo cliente em toda tela. O CSS da
   * moldura mora em `avatar.module.css` e sai de graça.
   *
   * Ausente ou `null` = sem moldura. Quem traduz isso — e quem neutraliza um
   * id que o catálogo não conhece — é `normalizarMoldura`, na LEITURA.
   */
  moldura?: string | null;
};

const DEFAULT_COLOR = "#ff6a2b";

/**
 * Carrega o perfil do usuário no Firestore.
 * - Se existir e estiver ativo, retorna o perfil (e atualiza uid/lastLogin).
 * - Se for o super admin sem perfil, cria o perfil admin (bootstrap).
 * - Caso contrário retorna null (usuário não autorizado).
 */
export async function ensureUserProfile(
  user: User,
): Promise<UserProfile | null> {
  const email = (user.email ?? "").toLowerCase();
  if (!email) return null;

  const ref = doc(db, "users", email);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data() as Omit<UserProfile, "email">;
    const isSuper = email === SUPER_ADMIN_EMAIL;
    if (!data.active && !isSuper) return null; // desativado → sem acesso
    // Campos de sessão (best-effort; não bloqueia o login se falhar).
    void updateDoc(ref, {
      uid: user.uid,
      lastLogin: serverTimestamp(),
    }).catch(() => {});
    // O super admin é sempre admin ativo (à prova de auto-bloqueio).
    return isSuper
      ? { email, ...data, role: "admin", active: true }
      : { email, ...data };
  }

  // Sem perfil: apenas o super admin é criado automaticamente.
  if (email === SUPER_ADMIN_EMAIL) {
    // O `displayName` do Google passa pela MESMA conferência do resto, e cai
    // para "Administrador" quando não passa. Não é preciosismo: desde que a
    // regra exige nome na criação, um `displayName` vazio — que o Firebase Auth
    // entrega como "" quando o provedor não manda nada, e o `??` deixava passar
    // — faria o bootstrap do PRIMEIRO ADMIN ser recusado, que é o pior jeito
    // conhecido de quebrar este app.
    const doGoogle = conferirNome(user.displayName);
    const profile: UserProfile = {
      email,
      name: doGoogle.ok ? doGoogle.nome : "Administrador",
      role: "admin",
      cargo: "Administrador",
      sectors: [],
      active: true,
      color: DEFAULT_COLOR,
      uid: user.uid,
    };
    await setDoc(ref, {
      ...profile,
      createdAt: serverTimestamp(),
      createdBy: "bootstrap",
      lastLogin: serverTimestamp(),
    });
    return profile;
  }

  return null; // não autorizado
}

// ---------------------------------------------------------------------------
// Gestão de usuários (aba Admin) — exige papel admin (garantido pelas regras).
// ---------------------------------------------------------------------------

/**
 * Os setores que EXECUTAM demanda neste app. Hoje, um só.
 *
 * ESTA LISTA JÁ TEVE OITO NOMES, E ENCOLHEU DE PROPÓSITO — se você chegou aqui
 * achando que faltam sete, não faltam. A conferência do banco feita antes da
 * mudança achou os 69 cards, as 17 reuniões e as 0 recorrências **todos** em
 * "B.I.", e todos os usuários cadastrados com `sectors: ["B.I."]` (menos o
 * admin, que tinha os oito por herança desta constante). Os outros sete só
 * existiam como abas que nunca abriam nada e como 35 colunas semeadas sem um
 * único card atrás. Nada ficou inalcançável ao encolher.
 *
 * O engano que os oito nomes carregavam é a confusão entre quem FAZ e quem
 * PEDE. Quem varia é quem pede — e isso já tem campo próprio no card
 * (`requesterSector`), alimentado pelo cadastro `/solicitanteSetores`, que tem
 * treze entradas e é editável na aba Admin. Setor de execução e setor
 * solicitante são coisas diferentes; esta constante é só a primeira.
 *
 * Ela decide o que o ADMIN enxerga (`role === "admin" ? DEFAULT_SECTORS :
 * profile.sectors`) em seis telas, e é a lista de setores que a aba Admin
 * oferece ao montar um usuário. Antes de "restaurar" os sete, confira no banco
 * se existe card, reunião ou recorrência fora de B.I.: quem manda neste valor é
 * o dado, não a expectativa.
 */
export const DEFAULT_SECTORS = ["B.I."];

/**
 * Cor de avatar estável a partir do e-mail.
 *
 * A paleta e o hash mudaram de casa para `avatar-core.ts` — é regra de avatar, e
 * regra tem de caber no módulo puro para ser testada. O nome antigo fica como
 * apelido porque é por ele que o resto do app pergunta.
 */
export const pickColor = corDeAvatar;

export type UserInput = {
  email: string;
  name: string;
  role: Role;
  cargo: string;
  sectors: string[];
  color?: string;
};

/** Assina a lista de usuários em tempo real (ordenada por nome). */
export function subscribeUsers(
  onData: (users: UserProfile[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "users"),
    (snap) => {
      const list = snap.docs.map((d) => ({
        email: d.id,
        ...(d.data() as Omit<UserProfile, "email">),
      }));
      list.sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email, "pt-BR"),
      );
      onData(list);
    },
    (e) => onError?.(e),
  );
}

/**
 * Cria ou atualiza um usuário. `isNew` controla os campos de criação.
 *
 * O nome passa pela MESMA `conferirNome` que o dono do cadastro usa — a régua é
 * do campo, não de quem escreve. Sem isto, o admin seria o único capaz de gravar
 * um nome que a regra do Firestore recusa, e a recusa chegaria à tela como "sem
 * permissão" (a aba Admin já barra o nome vazio, mas nada barrava o nome de 500
 * caracteres colado de uma planilha).
 */
export async function saveUser(
  input: UserInput,
  actorEmail: string,
  isNew: boolean,
): Promise<void> {
  const conferido = conferirNome(input.name);
  if (!conferido.ok) throw new Error(conferido.motivo);

  const email = input.email.trim().toLowerCase();
  const ref = doc(db, "users", email);
  const base = {
    email,
    name: conferido.nome,
    role: input.role,
    cargo: input.cargo.trim(),
    sectors: input.sectors,
    color: input.color || pickColor(email),
  };
  if (isNew) {
    await setDoc(ref, {
      ...base,
      active: true,
      uid: null,
      createdAt: serverTimestamp(),
      createdBy: actorEmail,
      lastLogin: null,
    });
  } else {
    await updateDoc(ref, base);
  }
}

export async function setUserActive(
  email: string,
  active: boolean,
): Promise<void> {
  await updateDoc(doc(db, "users", email.toLowerCase()), { active });
}

export async function deleteUser(email: string): Promise<void> {
  await deleteDoc(doc(db, "users", email.toLowerCase()));
}

// ---------------------------------------------------------------------------
// O próprio cadastro — as escritas em /users que NÃO são de admin.
//
// Quem grava é o dono do doc, pelo braço do `hasOnly(['uid','lastLogin',
// 'photo','name'])` em firestore.rules. As funções abaixo escrevem SÓ os campos
// dessa lista: mandar qualquer outro junto — `email`, `cargo`, `color`, ou o
// documento inteiro que veio do `subscribeUsers` — faz a regra negar a escrita
// inteira, e a pessoa lê "sem permissão" tendo permissão.
// ---------------------------------------------------------------------------

/**
 * O que o dono do cadastro pode mudar de si mesmo.
 *
 * `photo` é opcional em TRÊS estados, e a diferença importa: ausente é "não
 * mexa na foto", `null` é "tire a foto", string é "esta aqui". Sem o estado
 * ausente, uma tela que só edita o nome apagaria a foto de quem a escolheu.
 */
export type MeuCadastro = {
  name: string;
  photo?: string | null;
  /**
   * Mesma convenção da foto, e ela importa pelo mesmo motivo: ausente é "não
   * mexa na moldura", e `"nenhuma"` é "tire a moldura". Sem o estado ausente,
   * uma tela que só corrige o nome apagaria a escolha de quem a fez.
   */
  moldura?: string;
};

/**
 * Grava o próprio nome (e, se a tela quiser, a foto junto) NUMA ESCRITA SÓ.
 *
 * É uma escrita e não duas porque nome e foto são um formulário só, com um botão
 * só. Em duas, a segunda pode falhar depois de a primeira ter entrado, e a
 * pessoa fica com o cadastro pela metade sem nada na tela dizendo qual metade —
 * mesmo princípio do `writeBatch` de `historico.ts`.
 *
 * A conferência acontece AQUI, antes de ir ao banco, e a regra do Firestore é a
 * segunda barreira — não a primeira. A regra não sabe dizer "o nome precisa de
 * uma letra"; ela responde "sem permissão", que é a mensagem errada para quem
 * só digitou algo que não serve. A régua é a mesma nos dois lugares
 * (`conferirNome` e `nomeOk()`), e `test-avatar.mjs` reprova se uma andar sem a
 * outra.
 */
export async function saveOwnProfile(
  email: string,
  dados: MeuCadastro,
): Promise<void> {
  const nome = conferirNome(dados.name);
  if (!nome.ok) throw new Error(nome.motivo);

  const patch: {
    name: string;
    photo?: string | null;
    moldura?: string;
  } = { name: nome.nome };

  if (dados.photo !== undefined) {
    if (dados.photo === null) {
      // `null` gravado, e não `deleteField()`, pelo mesmo motivo da lixeira em
      // `kanban.ts`: a regra precisa de um VALOR para examinar, e `null` é o que
      // `fotoOk()` aceita explicitamente. Campo que some do documento é campo
      // que a regra não vê.
      patch.photo = null;
    } else {
      const foto = conferirFoto(dados.photo);
      if (!foto.ok) throw new Error(foto.motivo);
      patch.photo = dados.photo.trim();
    }
  }

  /**
   * `!== undefined` E NÃO UM `normalizarMoldura` INCONDICIONAL.
   *
   * `normalizarMoldura(undefined)` devolve `"nenhuma"`, que é um valor
   * perfeitamente válido — e gravá-lo sempre faria TODA correção de nome
   * apagar, em silêncio, a moldura de quem nunca abriu o seletor. É
   * exatamente a armadilha que o bloco da foto logo acima já documenta.
   *
   * A normalização acontece mesmo assim quando o campo veio: a tela só
   * oferece ids do catálogo, mas isto é a última parada antes do banco, e a
   * regra do Firestore de propósito não confere pertinência ao catálogo.
   */
  if (dados.moldura !== undefined) {
    patch.moldura = normalizarMoldura(dados.moldura);
  }

  await updateDoc(doc(db, "users", email.trim().toLowerCase()), patch);
}

