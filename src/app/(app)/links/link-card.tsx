"use client";

import { iconeDoLink } from "@/lib/icones-core";
import {
  seloDoLink,
  dominioDe,
  monogramaDe,
  normalizarUrl,
  servicoDe,
  SERVICO_ROTULO,
} from "@/lib/links-core";
import type { LinkDoSetor } from "@/lib/links-do-setor";
import { fmtDayMonth, toISO } from "@/lib/datas";
import { Icon } from "@/components/icons";
import { IconePicker } from "@/components/icone-picker";
import styles from "./links.module.css";

// ---------------------------------------------------------------------------
// O card do link
// ---------------------------------------------------------------------------

export function LinkCard({
  link,
  nomeDe,
  anoAtual,
  mostrarSetor,
  salvando,
  erro,
  onEscolherIcone,
  onEditar,
}: {
  link: LinkDoSetor;
  nomeDe: (e: string | null | undefined) => string;
  anoAtual: number;
  mostrarSetor: boolean;
  salvando: boolean;
  erro: string | null;
  onEscolherIcone: (nome: string | null) => void;
  onEditar: () => void;
}) {
  const servico = servicoDe(link.url);
  const selo = seloDoLink(link.url);
  // O desenho que o selo mostra AGORA: a escolha de alguém, ou a dedução.
  const icone = iconeDoLink(link);
  // E o que o "Automático" entregaria — a mesma dedução, sem a escolha por
  // cima. É o que deixa a pessoa comparar antes de voltar ao padrão.
  const padrao = iconeDoLink({ url: link.url });
  // O portão roda de novo sobre o que veio do banco. Quem grava passa por
  // `normalizarUrl`, mas o console do Firestore não — e o React não recusa um
  // `javascript:` em `href`, só avisa. Sem `href` o nome deixa de ser link: não
  // abre nada, que é a falha certa para um endereço em que não se pode confiar.
  const destino = normalizarUrl(link.url) || undefined;
  const dominio = dominioDe(link.url);

  const editadoPor =
    link.updatedBy && link.updatedAt
      ? `Editado por ${nomeDe(link.updatedBy)} em ${dataDe(link.updatedAt, anoAtual)}`
      : undefined;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        {/* Cor de dado entra inline, como o projeto já faz com `tagColor`.
            Fundo e tinta saem JUNTOS de `seloDoLink` porque um depende do
            outro: branco chapado some no amarelo do Drive. */}
        {link.logo ? (
          // Com logo, o selo é a MARCA e não um seletor: trocar o ícone ali não
          // mudaria nada na tela. Trocar ou tirar o logo é no lápis, ao lado.
          <span className={styles.logoSelo}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URI conferido na leitura; next/image não otimiza data URI */}
            <img src={link.logo} alt={`Logo de ${link.nome}`} />
          </span>
        ) : (
          <IconePicker
            valor={link.icone ?? null}
            deduzido={padrao}
            rotulo={link.nome}
            onEscolher={onEscolherIcone}
            disabled={salvando}
            className={styles.icone}
            style={{ background: selo.fundo, color: selo.tinta }}
          >
            {icone ? <Icon name={icone} size={19} /> : monogramaDe(link.url)}
          </IconePicker>
        )}

        <div className={styles.cardTitulo}>
          {/* O NOME É O ALVO, e não mais uma linha de baixo. No card antigo o
              destaque era o título da demanda, que não abria nada, e a URL ia
              miúda embaixo. Aqui o nome é o do próprio aplicativo: clicar
              nele e cair no aplicativo é o gesto que ninguém precisa aprender.

              `noopener` não é enfeite: sem ele a página aberta recebe
              `window.opener` e pode redirecionar a aba do Smart Meeting por
              baixo, com o usuário achando que voltou para o app. */}
          <a
            className={styles.nome}
            href={destino}
            target="_blank"
            rel="noopener noreferrer"
            title={link.url}
          >
            {link.nome}
          </a>
          <div className={styles.cardMeta}>
            <span className={styles.estado}>{SERVICO_ROTULO[servico]}</span>
            {/* Endereço que não passou no portão DIZ isso, em vez de exibir o
                texto cru: o nome não abre nada, e sem esta linha a pessoa
                clicaria nele sem entender por quê. O lápis ao lado conserta. */}
            {destino ? (
              <span className={styles.dominio} title={link.url}>
                {dominio}
              </span>
            ) : (
              <span className={styles.enderecoInvalido} title={link.url}>
                endereço inválido
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className={styles.editar}
          onClick={onEditar}
          title="Editar nome, endereço e descrição"
          aria-label={`Editar o link ${link.nome}`}
        >
          <Icon name="edit" size={14} />
        </button>
      </div>

      {link.descricao && <p className={styles.descricao}>{link.descricao}</p>}

      {/* O erro mora NO CARD em que o clique aconteceu, e não no topo da tela:
          numa grade de dezenas, uma faixa lá em cima obrigaria a pessoa a
          descobrir sozinha a qual link ela se refere. */}
      {erro && (
        <div className={styles.erroIcone} role="alert">
          {erro}
        </div>
      )}

      <div className={styles.cardPe}>
        {mostrarSetor && <span className={styles.setor}>{link.setor}</span>}
        <span className={styles.autoria} title={editadoPor}>
          {nomeDe(link.createdBy)}
          {link.createdAt ? ` · ${dataDe(link.createdAt, anoAtual)}` : ""}
        </span>
      </div>
    </div>
  );
}

/** "12 ago" — com o ano só quando não é o corrente, que é quando ele informa. */
function dataDe(ms: number, anoAtual: number): string {
  const d = new Date(ms);
  const dia = fmtDayMonth(toISO(d));
  return d.getFullYear() === anoAtual ? dia : `${dia} de ${d.getFullYear()}`;
}

