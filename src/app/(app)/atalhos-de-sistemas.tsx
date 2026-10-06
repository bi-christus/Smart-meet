"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSetoresDaPessoa } from "@/lib/setores";
import { usePermissoes } from "@/lib/permissoes";
import { podeVerAba } from "@/lib/permissoes-core";
import { normalizarUrl } from "@/lib/links-core";
import { subscribeLinksDoSetor, type LinkDoSetor } from "@/lib/links-do-setor";
import { useAsyncData } from "@/lib/use-async-data";
import type { UserProfile } from "@/lib/users";
import { Icon } from "@/components/icons";
import { SeloDoLink } from "./links/selo";
import styles from "./inicio.module.css";

/**
 * Os sistemas do setor, na PRIMEIRA tela depois do login.
 *
 * Pedido de 06/10/2026: o diretor precisa chegar aos links "de forma fácil,
 * rápida e intuitiva". Ele já tinha acesso — o problema era o caminho: a aba
 * Links morava no fim da barra, escondida na rolagem em telas comuns, e o
 * Início não mostrava link nenhum. Aqui, logo e nome; um clique abre o
 * sistema numa aba nova, sem passar pela aba Links.
 *
 * Respeita o MESMO portão da aba: quem não enxerga Links pelo quadro de
 * Permissões não vê esta faixa, e a leitura no banco já vem escopada por setor.
 * Enquanto carrega ou quando não há link, a faixa não aparece — a tela de
 * entrada não pode ganhar um esqueleto por causa de um atalho.
 */
const SEM_LINKS: LinkDoSetor[] = [];

export function AtalhosDeSistemas({ profile }: { profile: UserProfile }) {
  const { permissoes, carregando } = usePermissoes();
  const pode = !carregando && podeVerAba("links", profile, permissoes);
  const setores = useSetoresDaPessoa(profile);
  const chave = pode ? setores.join("|") : "__fechado__";
  const f = useAsyncData<LinkDoSetor>(chave, (onData, onErro) =>
    pode ? subscribeLinksDoSetor(setores, onData, onErro) : (onData([]), () => {}),
  );
  const links = useMemo(
    () => (f.data ?? SEM_LINKS).filter((l) => normalizarUrl(l.url)),
    [f.data],
  );

  if (!pode || links.length === 0) return null;

  return (
    <section className={styles.sistemas} aria-labelledby="sistemas-titulo">
      <div className={styles.sistemasHead}>
        <h2 id="sistemas-titulo">Sistemas</h2>
        <Link href="/links" className={styles.verTodos}>
          Ver todos <Icon name="links" size={13} />
        </Link>
      </div>
      <div className={styles.sistemasGrid}>
        {links.map((l) => (
          <a
            key={l.id}
            href={normalizarUrl(l.url)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.sistema}
            title={l.descricao || l.url}
          >
            <SeloDoLink link={l} />
            <span className={styles.sistemaNome}>{l.nome}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
