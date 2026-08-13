"use client";

import { useState } from "react";
import { avatarDe, type PessoaDoAvatar } from "@/lib/avatar-core";
import styles from "./avatar.module.css";

/**
 * O rosto de uma pessoa na interface — foto quando existe, inicial quando não.
 *
 * POR QUE ELE EXISTE: a mesma decisão estava escrita à mão em seis lugares
 * (topbar, tela de acesso pendente, lista do Admin, responsável no card,
 * autor no histórico, autor no comentário). Seis cópias de "se tem foto mostra
 * a foto, senão a primeira letra sobre a cor" — e cada uma errava algo
 * diferente: nenhuma tratava foto que falha ao carregar, três chumbavam
 * `#555` como cor de reserva, e o `alt` variava entre o nome e nada sem
 * critério. Cada avatar novo era a sétima chance de errar de um jeito inédito.
 *
 * A ESCOLHA NÃO MORA AQUI. Quem decide entre foto e inicial — e qual foto, e
 * qual letra, e qual cor — é `avatarDe`, em `avatar-core`, que é módulo puro e
 * tem teste no `prebuild`. Este arquivo é só a pintura daquela decisão.
 *
 * E É DE `avatar-core` QUE ELE IMPORTA, e não do `users.ts` que reexporta a
 * mesma função. O aviso de lá — "não faça a tela importar de dois módulos para
 * desenhar um elemento só" — é sobre as TELAS, e este componente existe
 * justamente para que nenhuma delas precise fazer isso. Vindo do módulo puro,
 * `<Avatar>` não arrasta `firebase/firestore` para dentro de todo lugar que
 * mostra o rosto de alguém.
 */

/** Reexportado para quem monta a pessoa na mão (autor de comentário, por ex.). */
export type { PessoaDoAvatar };

export function Avatar({
  pessoa,
  size = 32,
  fotoDoGoogle,
  alt = "",
  title,
  className,
}: {
  pessoa: PessoaDoAvatar;
  /** Diâmetro em px. A fonte da inicial acompanha, para a letra nunca vazar. */
  size?: number;
  /**
   * `user.photoURL` — só existe para o PRÓPRIO usuário logado. Das outras
   * pessoas o app só conhece o que está gravado em `/users`.
   */
  fotoDoGoogle?: string | null;
  /**
   * Vazio quando o nome já está escrito ao lado (avatar decorativo); o nome da
   * pessoa quando o avatar aparece sozinho e é ele quem a identifica.
   */
  alt?: string;
  title?: string;
  className?: string;
}) {
  // Guardamos a URL que falhou, e não um booleano: trocar de pessoa (ou de
  // foto) tem de dar uma chance nova à imagem, e um booleano deixaria o avatar
  // preso na inicial até o componente ser desmontado.
  const [srcQueFalhou, setSrcQueFalhou] = useState<string | null>(null);

  const escolha = avatarDe(pessoa, fotoDoGoogle ?? undefined);

  if (escolha.tipo === "foto" && escolha.src !== srcQueFalhou) {
    return (
      // O projeto inteiro usa <img> cru para avatar: `next/image` não serve
      // para data URI variável nem para host do Google, que muda de assinatura.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`${styles.raiz} ${styles.foto} ${className ?? ""}`}
        style={{ width: size, height: size }}
        src={escolha.src}
        alt={alt}
        title={title}
        // A foto do Google recusa o request quando o referer é outro domínio;
        // em data URI é inócuo, e uniformizar evita o quadrado quebrado.
        referrerPolicy="no-referrer"
        // URL do Google expira e data URI pode estar corrompido no banco. Sem
        // isto, o resultado é o ícone de imagem quebrada no lugar da pessoa.
        onError={() => setSrcQueFalhou(escolha.src)}
        draggable={false}
      />
    );
  }

  // Chegamos aqui ou porque não havia foto, ou porque a que havia não carregou.
  // No segundo caso a inicial de reserva vem da MESMA regra, pedida de novo sem
  // foto nenhuma — escrever aqui um "primeira letra em maiúscula sobre a cor"
  // seria fundar a segunda versão da decisão que este componente unifica.
  const semFoto =
    escolha.tipo === "inicial" ? escolha : avatarDe({ ...pessoa, photo: null });
  // `avatarDe` sem `photo` e sem foto do provedor só tem um caminho de saída; o
  // `null` existe para o TypeScript, não para a tela.
  const inicial = semFoto.tipo === "inicial" ? semFoto : null;

  return (
    <span
      className={`${styles.raiz} ${styles.inicial} ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        // 0,4 do diâmetro é a proporção que os seis avatares à mão já usavam
        // (30/12, 26/10, 38/14); centralizar isso mantém todos iguais.
        fontSize: Math.round(size * 0.4),
        background: inicial?.cor,
      }}
      title={title}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      // Sem nome para dar, a letra é ruído para quem usa leitor de tela: ela
      // não acrescenta nada ao nome que já está escrito ao lado.
      aria-hidden={alt ? undefined : true}
    >
      {inicial?.letra}
    </span>
  );
}
