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
import {
  DEMAND_TYPE_LABEL,
  PRIORITY_LABEL,
  type DemandType,
  type Priority,
} from "@/lib/kanban";
import type { Rotulos } from "@/lib/historico-core";
import type { PessoaDaMoldura, PessoaDoAvatar } from "@/components/avatar";
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
 *
 * O RETORNO DIZ `& PessoaDaMoldura` DE PROPÓSITO, e o `moldura: null` do braço
 * de reserva é explícito pelo mesmo motivo. Hoje a moldura já chega às três
 * telas que passam por aqui — histórico, comentário e Cronograma — por ACIDENTE
 * DE TIPAGEM: `perfil ?? {...}` devolve o objeto do `usersMap` por referência,
 * com todos os campos dele. No dia em que alguém montar o objeto explícito, que
 * é a leitura natural daquele `??`, a moldura sumiria das três de uma vez e
 * nenhum portão deste projeto reclamaria. O tipo passa a dizer que ela faz parte
 * do contrato.
 */
export function autorDoRegistro(
  email: string,
  nome: string,
  perfil: UserProfile | undefined,
): PessoaDoAvatar & PessoaDaMoldura {
  return (
    perfil ?? {
      name: nome,
      email,
      color: pickColor(email),
      photo: null,
      moldura: null,
    }
  );
}

/**
 * Como o histórico transforma id em nome de gente, na hora de gravar.
 *
 * Mora aqui porque o quadro e o Cronograma gravam no MESMO histórico, e o
 * `de`/`para` de cada evento é texto congelado — o nome de quando aconteceu,
 * não um id para resolver depois (ver `historico-core.ts`). Duas definições
 * desta tradução não quebrariam nada de imediato: as duas telas continuariam
 * salvando. Só que uma passaria a escrever "Etapa: andamento" onde a outra
 * escreve "Etapa: Em andamento", e a timeline de uma demanda ficaria com duas
 * grafias do mesmo fato, sem ninguém saber de onde veio a diferença.
 *
 * `columns` é o recorte mínimo de propósito: `ColumnDoc` e `KanbanColumn` são
 * formatos diferentes do mesmo dado, e as duas telas têm um de cada.
 */
export function criarRotulos(
  usersMap: Record<string, UserProfile>,
  columns: { colId: string; title: string }[],
): Rotulos {
  return {
    pessoa: (email) => usersMap[email]?.name || email,
    coluna: (colId) => columns.find((c) => c.colId === colId)?.title || colId,
    prioridade: (p) => PRIORITY_LABEL[p as Priority] ?? p,
    tipo: (t) => DEMAND_TYPE_LABEL[t as DemandType] ?? t,
  };
}
