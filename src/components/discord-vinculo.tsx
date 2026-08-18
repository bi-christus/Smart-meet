"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { Icon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { fraseDeFalha } from "@/lib/erro-ui-core";
import {
  desvincularDiscord,
  gerarCodigoDiscord,
  iniciarVinculoDiscord,
  type CodigoDeVinculo,
} from "@/lib/discord";
import {
  formatarCodigo,
  VALIDADE_CODIGO_MS,
} from "@/lib/discord-vinculo-core";

import styles from "./discord-vinculo.module.css";

/**
 * A seção Discord do Perfil — onde a pessoa liga as duas contas.
 *
 * POR QUE ELA ASSINA O PRÓPRIO CADASTRO em vez de ler o `pessoa` que o modal já
 * tem em mãos: o vínculo NÃO acontece nesta tela. Ele acontece no Discord, na
 * outra janela, segundos depois de o código aparecer aqui. O `pessoa` do modal
 * vem do perfil carregado no login e não muda até o próximo — quem confiasse
 * nele mostraria "não conectado" para sempre, e a pessoa ficaria olhando um
 * código morto sem saber que já deu certo.
 *
 * Com a assinatura, o momento em que ela aperta Enter no Discord é o momento em
 * que este quadro vira "Conectado". É a única confirmação que o fluxo tem — e
 * ela chega sozinha, sem pedir para ninguém atualizar a página.
 *
 * DOIS CAMINHOS, E UM DELES É O PADRÃO. O clique (`Conectar Discord`) resolve
 * em uma tela: a pessoa autoriza no Discord e volta. O código existe para quem
 * já está no Discord no celular e não quer abrir o app, e para quem tem popup
 * bloqueado — por isso ele fica visível como segunda opção, e não escondido
 * atrás de "problemas?". Escondê-lo faria a única saída de um popup bloqueado
 * ser invisível exatamente para quem precisa dela.
 *
 * MOTION (AGENTS.md §3): nenhum. Isto é FEEDBACK DE SISTEMA, não enfeite —
 * esqueleto enquanto não se sabe, estados separados para "ainda não respondeu"
 * e "respondeu e está solto", contagem regressiva porque o código morre. Um
 * quadro de código que aparece deslizando seria exatamente o que a skill chama
 * de AI-slop motion: atrapalha quem já está com o Discord aberto esperando para
 * digitar.
 */
export function DiscordVinculo({ email }: { email: string }) {
  /** `undefined` = ainda não respondeu. `null` = respondeu, e está solto. */
  const [ligado, setLigado] = useState<
    { id: string; nome: string } | null | undefined
  >(undefined);
  const [codigo, setCodigo] = useState<CodigoDeVinculo | null>(null);
  const [restam, setRestam] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  /**
   * Endereço da autorização, quando o navegador bloqueou a aba nova.
   *
   * Popup bloqueado é silencioso: `window.open` devolve `null` e mais nada
   * acontece. Sem este estado, a pessoa clicaria em Conectar e veria a tela
   * ficar igual — o modo de falha em que ela conclui que o botão está quebrado.
   */
  const [autorizacao, setAutorizacao] = useState<string | null>(null);

  // O código não é estado derivável do banco: ele nasce de um clique e some
  // sozinho. A ref guarda se havia um na tela quando o vínculo chegou, para
  // distinguir "já estava ligado ao abrir" de "acabou de ligar agora".
  const tinhaCodigo = useRef(false);
  const [acabouDeLigar, setAcabouDeLigar] = useState(false);

  useEffect(() => {
    if (!email) return;
    return onSnapshot(
      doc(db, "users", email),
      (snap) => {
        const d = snap.data() as
          | { discordId?: string; discordUser?: string }
          | undefined;
        const id = (d?.discordId ?? "").trim();
        if (id) {
          setLigado({ id, nome: (d?.discordUser ?? "").trim() || id });
          // O código serviu: sai da tela no mesmo instante, senão fica um
          // segredo válido exposto sem motivo nenhum.
          setCodigo(null);
          if (tinhaCodigo.current) setAcabouDeLigar(true);
          tinhaCodigo.current = false;
        } else {
          setLigado(null);
          setAcabouDeLigar(false);
        }
      },
      // Ler o próprio cadastro é sempre permitido; se falhar, é rede. O quadro
      // fica no estado solto em vez de travar no esqueleto para sempre.
      () => setLigado(null),
    );
  }, [email]);

  // A contagem regressiva. Existe porque o código morre, e um código morto na
  // tela é indistinguível de um vivo — a pessoa digita, leva "esse código
  // passou da validade" no Discord, e conclui que a integração não funciona.
  useEffect(() => {
    if (!codigo) return;
    const fim = Date.now() + codigo.expiraEmSegundos * 1000;
    const tique = () => setRestam(Math.max(0, Math.ceil((fim - Date.now()) / 1000)));
    tique();
    const t = setInterval(tique, 1000);
    return () => clearInterval(t);
  }, [codigo]);

  /**
   * Abre a autorização do Discord numa aba nova.
   *
   * A ABA É ABERTA ANTES DO `await`, e é o detalhe que faz isto funcionar:
   * `window.open` chamado depois da resposta do servidor já não conta como
   * resposta ao clique, e o navegador bloqueia. Então a aba abre vazia agora e
   * recebe o endereço quando ele chega.
   *
   * Nada muda nesta tela ao voltar — quem avisa é a assinatura de
   * `users/{email}`, que vira "Conectado" no instante em que o servidor grava.
   */
  async function conectar() {
    setErro(null);
    setAutorizacao(null);
    setOcupado(true);
    const janela = window.open("", "_blank", "noopener,noreferrer");
    try {
      const { url } = await iniciarVinculoDiscord();
      if (janela) {
        janela.location.replace(url);
      } else {
        // Sem aba, o endereço vira link na tela. É feio de propósito: é o
        // caminho de exceção, e ele precisa ser óbvio.
        setAutorizacao(url);
      }
    } catch (e) {
      janela?.close();
      console.error("[conectar discord]", e);
      setErro(fraseDeFalha("Não deu para abrir a autorização do Discord.", e));
    } finally {
      setOcupado(false);
    }
  }

  async function gerar() {
    setErro(null);
    setAutorizacao(null);
    setOcupado(true);
    setCopiado(false);
    try {
      const novo = await gerarCodigoDiscord();
      setCodigo(novo);
      tinhaCodigo.current = true;
    } catch (e) {
      console.error("[gerar codigo do discord]", e);
      setErro(fraseDeFalha("Não deu para gerar o código.", e));
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setErro(null);
    setOcupado(true);
    try {
      await desvincularDiscord();
      // O estado real chega pela assinatura; isto só evita o meio segundo de
      // botão parado depois do clique.
      setCodigo(null);
    } catch (e) {
      console.error("[desvincular discord]", e);
      setErro(fraseDeFalha("Não deu para desconectar.", e));
    } finally {
      setOcupado(false);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem área de transferência (http, permissão negada) o código continua
      // na tela para ser digitado. Não é caminho de erro.
    }
  }

  const expirado = codigo !== null && restam === 0;

  return (
    <section className={styles.bloco} aria-labelledby="discord-titulo">
      <div className={styles.cabeca}>
        <span className={styles.chip}>
          <Icon name="chat" size={12} /> Discord
        </span>
        <h3 id="discord-titulo" className={styles.titulo}>
          Ser avisado das suas demandas
        </h3>
      </div>

      {ligado === undefined ? (
        // "Ainda não respondeu" e "respondeu e está solto" são estados
        // diferentes (AGENTS.md §3), e a diferença importa aqui mais do que na
        // média: quem acabou de digitar `/vincular` no Discord e vê "não
        // conectado" por meio segundo conclui que não funcionou.
        <Skeleton lines={2} texto="Conferindo a sua conexão com o Discord…" />
      ) : ligado ? (
        <>
          <p className={`${styles.estado} ${styles.ok}`} role="status">
            <Icon name="check" size={14} />
            <span>
              Conectado como <strong>{ligado.nome}</strong>.
              {acabouDeLigar
                ? " Pronto — a partir de agora você é mencionado nos avisos das suas demandas e recebe no privado o que mexer nelas."
                : " Você é mencionado nos avisos das suas demandas e recebe no privado o que mexer nelas."}
            </span>
          </p>
          <div className={styles.acoes}>
            <button
              type="button"
              className={styles.btnVolta}
              onClick={() => void desligar()}
              disabled={ocupado}
            >
              <Icon name="x" size={15} />{" "}
              {ocupado ? "Desconectando…" : "Desconectar"}
            </button>
          </div>
        </>
      ) : codigo && !expirado ? (
        <>
          <p className={styles.instrucao}>
            No servidor do Discord, digite{" "}
            <code className={styles.comando}>/vincular</code> e cole este código:
          </p>
          <div className={styles.codigoLinha}>
            <output className={styles.codigo} aria-label="Código de vínculo">
              {formatarCodigo(codigo.codigo)}
            </output>
            <button
              type="button"
              className={styles.btnCopiar}
              onClick={() => void copiar(codigo.codigo)}
            >
              <Icon name={copiado ? "check" : "links"} size={15} />{" "}
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          {/* A contagem é `polite` e não `assertive`: ela muda a cada segundo, e
              um leitor de tela anunciando cada tique tornaria a seção
              impossível de usar. O que precisa ser anunciado é a virada para
              "expirou", que troca o texto inteiro. */}
          <p className={styles.contagem} role="status" aria-live="polite">
            <Icon name="clock" size={13} /> Vale por mais {restam}s. Ele some
            assim que for usado.
          </p>
        </>
      ) : (
        <>
          <p className={styles.estado} role="status">
            {expirado
              ? "Esse código passou da validade. Gere outro e digite-o no Discord dentro de 10 minutos."
              : "O aviso da demanda já chega no canal. Conecte a sua conta para ser mencionado nele e receber no privado o que mexer nas suas demandas — assim o Discord te notifica, em vez de você precisar estar olhando."}
          </p>
          <div className={styles.acoes}>
            <button
              type="button"
              className={styles.btnSave}
              onClick={() => void conectar()}
              disabled={ocupado}
            >
              <Icon name="link" size={15} />{" "}
              {ocupado ? "Abrindo o Discord…" : "Conectar Discord"}
            </button>
            <button
              type="button"
              className={styles.btnVolta}
              onClick={() => void gerar()}
              disabled={ocupado}
            >
              <Icon name="chat" size={15} />{" "}
              {expirado ? "Gerar outro código" : "Prefiro usar um código"}
            </button>
          </div>
          {autorizacao && (
            <p className={styles.estado} role="alert">
              O navegador bloqueou a aba nova.{" "}
              <a href={autorizacao} target="_blank" rel="noopener noreferrer">
                Abra a autorização do Discord por aqui
              </a>
              .
            </p>
          )}
          <p className={styles.legenda}>
            Conectar abre uma aba do Discord e pede só o seu nome de usuário e
            o e-mail — nada é publicado no seu nome. Pelo código, você digita{" "}
            <code>/vincular</code> no servidor; ele vale{" "}
            {VALIDADE_CODIGO_MS / 60000} minutos e serve uma vez só. Para
            desfazer depois, use <code>/desvincular</code> no Discord ou o botão
            que aparece aqui.
          </p>
        </>
      )}

      {erro && (
        <div className={styles.err} role="alert">
          {erro}
        </div>
      )}
    </section>
  );
}
