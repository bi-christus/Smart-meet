"use client";

/**
 * Preferências do relatório, por usuário.
 *
 * Vivem numa SUBCOLEÇÃO (`/users/{email}/prefs/relatorioGestor`), não num campo
 * do doc de `/users`. Duas razões:
 *
 * 1. Hoje o dono do próprio doc só pode escrever `['uid','lastLogin']`, e
 *    ampliar aquele `hasOnly` seria mexer na mesma regra que protege `role`,
 *    `active` e `sectors` — arriscar isso por uma preferência de e-mail não vale.
 * 2. `subscribeUsers` assina `/users` inteira e roda em várias telas. Uma
 *    configuração gorda no doc principal viajaria em todas elas.
 */
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizarPrefs, type PrefsRelatorio } from "./config";

function ref(email: string) {
  return doc(db, "users", email.toLowerCase(), "prefs", "relatorioGestor");
}

export function subscribePrefsRelatorio(
  email: string,
  onData: (p: PrefsRelatorio) => void,
): () => void {
  return onSnapshot(
    ref(email),
    (snap) => onData(normalizarPrefs(snap.exists() ? snap.data() : null)),
    // Falha de leitura cai no padrão: preferência não é caminho crítico, e
    // impedir alguém de abrir a tela por causa dela seria desproporcional.
    () => onData(normalizarPrefs(null)),
  );
}

export async function salvarPrefsRelatorio(
  email: string,
  p: PrefsRelatorio,
): Promise<void> {
  // `setDoc` sem merge: a regra do Firestore usa `hasOnly` na FORMA do
  // documento, e um merge parcial deixaria campos antigos de uma versão
  // anterior sobrevivendo fora do schema.
  await setDoc(ref(email), {
    v: p.v,
    tema: p.tema,
    acento: p.acento,
    densidade: p.densidade,
    setores: p.setores,
    recorte: p.recorte,
    agrupamento: p.agrupamento,
    ordenacao: p.ordenacao,
    colunas: p.colunas,
    blocos: p.blocos,
    destinatariosPadrao: p.destinatariosPadrao,
    atualizadoEm: serverTimestamp(),
  });
}
