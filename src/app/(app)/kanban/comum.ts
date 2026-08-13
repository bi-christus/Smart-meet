/**
 * O que o quadro e o modal da demanda usam em comum.
 *
 * Não é uma gaveta de utilidades: é o que sobrou quando `CardModal` saiu de
 * `page.tsx`. Cada coisa aqui tem chamador dos DOIS lados — a paleta de
 * prioridade pinta o filtro do quadro e o select do modal, `relTime` data o
 * evento do histórico e o comentário. Duplicar seria deixar duas verdades
 * livres para divergir, e deixar em `page.tsx` faria o modal importar a página
 * que o importa.
 */
// `import type` e não `import { type … }`: assim a declaração inteira some na
// compilação, e este módulo — que só formata texto — não passa a arrastar o SDK
// do Firestore junto com o tipo.
import type { Priority } from "@/lib/kanban";
import type { PessoaDoAvatar } from "@/components/avatar";
import { pickColor, type UserProfile } from "@/lib/users";

export const PRIORITY_COLOR: Record<Priority, string> = {
  alta: "#fb7185",
  media: "#f5b13d",
  baixa: "#78776f",
};
export const KNOWN_PRIORITIES: Priority[] = ["alta", "media", "baixa"];

export function parseDue(due: string): Date {
  const [y, m, dd] = due.split("-").map(Number);
  return new Date(y, m - 1, dd);
}
export function fmtShort(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

export function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `há ${d} dias`;
  return fmtShort(new Date(ts));
}

/**
 * O autor de um evento do histórico ou de um comentário, como avatar.
 *
 * Nem todo autor continua em `/users`: gente sai da empresa e o que ela
 * escreveu fica. Quando o perfil sumiu, o e-mail é tudo o que sobrou — e a cor
 * sai do mesmo `pickColor` que o perfil usaria, para o círculo da pessoa não
 * trocar de cor no dia em que ela for removida do sistema. O `#555` chumbado
 * que estava aqui pintava TODOS os ex-usuários do mesmo cinza.
 */
export function autorDoRegistro(
  email: string,
  nome: string,
  perfil: UserProfile | undefined,
): PessoaDoAvatar {
  return perfil ?? { name: nome, email, color: pickColor(email), photo: null };
}
