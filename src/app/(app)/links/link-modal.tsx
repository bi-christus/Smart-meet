"use client";

import { useId, useMemo, useRef, useState } from "react";
import { iconeDoLink } from "@/lib/icones-core";
import { monogramaDe, seloDoLink } from "@/lib/links-core";
import {
  LADO_LOGO_PX,
  LIMITE_DESCRICAO_LINK,
  LIMITE_NOME_LINK,
  conferirLink,
  conferirLogo,
  conflitoDeLink,
  criarLink,
  editarLink,
  excluirLink,
  type CampoDoLink,
  type LinkDoSetor,
} from "@/lib/links-do-setor";
import { fraseDeFalha } from "@/lib/erro-ui-core";
import { Icon } from "@/components/icons";
import { IconePicker } from "@/components/icone-picker";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import styles from "./links.module.css";

/** O documento sumiu entre o snapshot e o clique — alguém o apagou. */
function ehNaoEncontrado(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "not-found";
}

/**
 * A frase de uma gravação que falhou.
 *
 * Erro do Firestore tem `code`, e quem sabe redigi-lo é `fraseDeFalha`. Erro
 * SEM código é a régua do cadastro recusando antes do banco (`conferido`, em
 * `links-do-setor.ts`), e a mensagem dele já é a frase certa — passá-la por
 * `fraseDeFalha` a trocaria por um genérico "tente de novo", que não é o que
 * resolve um nome repetido.
 */
export function fraseDoErro(acao: string, e: unknown): string {
  if (ehNaoEncontrado(e)) {
    return "Este link foi removido por outra pessoa enquanto esta tela estava aberta.";
  }
  if (typeof (e as { code?: unknown } | null)?.code !== "string" && e instanceof Error) {
    return e.message;
  }
  return fraseDeFalha(acao, e, navigator.onLine);
}

// ---------------------------------------------------------------------------
// O logo — arquivo escolhido → data URI pequeno, conferido
// ---------------------------------------------------------------------------

const LOGO_NAO_ABRE =
  "Este arquivo não é uma imagem que o navegador consiga abrir. Escolha um PNG, JPG, WebP ou SVG.";
const LOGO_SEM_CANVAS =
  "Este navegador não conseguiu preparar a imagem. Tente por outro navegador, ou por um computador.";

/**
 * Decodifica o arquivo. `createImageBitmap` primeiro (decodifica fora da thread
 * principal); o `<img>` é a reserva — e é o único caminho que abre SVG.
 */
async function decodificarLogo(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // SVG cai aqui no Chrome; segue para o `<img>`.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolver, rejeitar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rejeitar(new Error("nao decodificou"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Arquivo → data URI pronto para gravar, ou o motivo da recusa.
 *
 * DIFERENTE DA FOTO DE PERFIL EM DUAS COISAS, as duas por ser logo:
 *
 * 1. NÃO CORTA. A foto vira círculo e é recortada no centro; um logo recortado
 *    perde a ponta da marca, que é justamente o que se reconhece. Aqui a imagem
 *    cabe INTEIRA num quadrado de `LADO_LOGO_PX`, mantendo a proporção.
 * 2. PNG PRIMEIRO. Logo costuma ter fundo transparente, e JPEG pintaria o
 *    vazado. O JPEG (sobre branco) é só a reserva para a imagem que, mesmo
 *    reduzida, estoura o teto em PNG — foto de fachada usada como logo, por
 *    exemplo.
 *
 * SVG entra pelo `<img>` e SAI COMO PNG: o que vai para o banco é sempre o
 * desenho rasterizado, nunca o SVG — que carrega script.
 */
async function prepararLogo(
  file: File,
): Promise<{ ok: true; uri: string } | { ok: false; motivo: string }> {
  let fonte: ImageBitmap | HTMLImageElement;
  try {
    fonte = await decodificarLogo(file);
  } catch {
    return { ok: false, motivo: LOGO_NAO_ABRE };
  }
  try {
    const largura = "naturalWidth" in fonte ? fonte.naturalWidth : fonte.width;
    const altura = "naturalHeight" in fonte ? fonte.naturalHeight : fonte.height;
    if (!largura || !altura) return { ok: false, motivo: LOGO_NAO_ABRE };

    // Nunca ampliar: um ícone de 32 px esticado não ganha detalhe, só bytes.
    const escala = Math.min(1, LADO_LOGO_PX / Math.max(largura, altura));
    const w = Math.max(1, Math.round(largura * escala));
    const h = Math.max(1, Math.round(altura * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, motivo: LOGO_SEM_CANVAS };
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(fonte, 0, 0, w, h);

    const png = canvas.toDataURL("image/png");
    const r = conferirLogo(png);
    if (r.ok) return { ok: true, uri: png };

    let motivo = r.motivo;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    for (const q of [0.85, 0.7, 0.55]) {
      const jpg = canvas.toDataURL("image/jpeg", q);
      if (!jpg.startsWith("data:image/jpeg")) break;
      const rj = conferirLogo(jpg);
      if (rj.ok) return { ok: true, uri: jpg };
      motivo = rj.motivo;
    }
    return { ok: false, motivo };
  } catch {
    return { ok: false, motivo: LOGO_SEM_CANVAS };
  } finally {
    if ("close" in fonte) fonte.close();
  }
}

// ---------------------------------------------------------------------------
// O formulário — criar e editar são o mesmo
// ---------------------------------------------------------------------------

export function LinkModal({
  link,
  setores,
  setorInicial,
  existentes,
  autor,
  podeApagar,
  onClose,
}: {
  /** `null` = link novo. */
  link: LinkDoSetor | null;
  setores: string[];
  setorInicial: string;
  existentes: readonly LinkDoSetor[];
  autor: string;
  podeApagar: boolean;
  onClose: () => void;
}) {
  const novo = link === null;
  const formId = useId();

  // O que havia na abertura — é contra isto que se mede "tem alteração".
  const inicial = useMemo(
    () => ({
      nome: link?.nome ?? "",
      url: link?.url ?? "",
      descricao: link?.descricao ?? "",
      icone: link?.icone ?? null,
      logo: link?.logo ?? null,
    }),
    [link],
  );

  const [nome, setNome] = useState(inicial.nome);
  const [url, setUrl] = useState(inicial.url);
  const [descricao, setDescricao] = useState(inicial.descricao);
  const [icone, setIcone] = useState<string | null>(inicial.icone);
  const [logo, setLogo] = useState<string | null>(inicial.logo);
  const [preparandoLogo, setPreparandoLogo] = useState(false);
  const [erroLogo, setErroLogo] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [setor, setSetor] = useState(link?.setor ?? setorInicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<{ campo: CampoDoLink | null; texto: string } | null>(
    null,
  );
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);

  const nomeRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const descricaoRef = useRef<HTMLTextAreaElement>(null);

  const temMudanca =
    nome !== inicial.nome ||
    url !== inicial.url ||
    descricao !== inicial.descricao ||
    icone !== inicial.icone ||
    logo !== inicial.logo ||
    (novo && setor !== setorInicial);

  /**
   * O veto do `<Modal>`, no mesmo desenho do modal da demanda: com alteração
   * por salvar, o clique fora e o Escape NÃO fecham — abrem a pergunta. Quem
   * já viu a pergunta e insiste está dizendo "some", e a partir daí o veto sai
   * do caminho. A descrição é texto corrido; perder um parágrafo por um clique
   * que escorregou para fora do diálogo é o que este veto existe para evitar.
   */
  function podeFechar(): boolean {
    if (salvando) return false;
    if (!temMudanca || confirmandoSaida) return true;
    setErro(null);
    setConfirmandoSaida(true);
    return false;
  }

  /** Leva o campo recusado até os olhos de quem clicou. */
  function cobrar(campo: CampoDoLink, texto: string) {
    setErro({ campo, texto });
    const el =
      campo === "nome" ? nomeRef.current : campo === "url" ? urlRef.current : descricaoRef.current;
    el?.focus();
  }

  async function salvar() {
    if (salvando) return;
    setConfirmandoSaida(false);
    // A régua roda AQUI, antes do banco, para apontar o campo. As funções de
    // `links-do-setor.ts` rodam a mesma de novo — é a defesa de quem chamar
    // aquelas funções por outro caminho, não uma segunda opinião.
    const r = conferirLink({ nome, url, descricao });
    if (!r.ok) {
      cobrar(r.campo, r.motivo);
      return;
    }
    const conflito = conflitoDeLink(r.dados, setor, existentes, link?.id);
    if (conflito) {
      cobrar(conflito.campo, conflito.motivo);
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      if (link) await editarLink(link, r.dados, icone, logo, autor, existentes);
      else await criarLink(setor, r.dados, icone, logo, autor, existentes);
      onClose();
    } catch (e) {
      console.error("Erro ao salvar o link:", e);
      setErro({ campo: null, texto: fraseDoErro("Não foi possível salvar o link.", e) });
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!link || salvando) return;
    // O setor vai no MEIO da frase, e não no fim: "B.I." já termina em ponto,
    // e a frase que fechava nele saía com dois.
    if (
      !confirm(
        `Remover o link "${link.nome}" do setor ${link.setor}? Ele some desta aba para todo mundo do setor.`,
      )
    )
      return;
    setSalvando(true);
    try {
      await excluirLink(link.id);
      onClose();
    } catch (e) {
      console.error("Erro ao remover o link:", e);
      setErro({ campo: null, texto: fraseDoErro("Não foi possível remover o link.", e) });
      setSalvando(false);
    }
  }

  async function escolherLogo(file: File | undefined) {
    if (!file) return;
    setErroLogo(null);
    setPreparandoLogo(true);
    try {
      const r = await prepararLogo(file);
      if (r.ok) setLogo(r.uri);
      else setErroLogo(r.motivo);
    } finally {
      setPreparandoLogo(false);
      // Zera o campo: escolher o MESMO arquivo de novo (depois de remover) não
      // dispararia `change`, e o clique pareceria não fazer nada.
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  // O selo do formulário é o MESMO do card, desenhado a partir do que está
  // sendo digitado: quem cola o endereço já vê o desenho e a cor com que o link
  // vai aparecer na grade, e pode trocar o ícone antes de salvar.
  const selo = seloDoLink(url);
  const iconeAgora = iconeDoLink({ url, icone: icone ?? undefined });
  const deduzido = iconeDoLink({ url });
  const setorOptions = setores.map((s) => ({ value: s, label: s }));
  const invalido = (c: CampoDoLink) => erro?.campo === c;

  return (
    <Modal
      onClose={onClose}
      podeFechar={podeFechar}
      ariaLabel={novo ? "Novo link" : `Editar o link ${link.nome}`}
      overlayClassName={styles.overlay}
      className={styles.modal}
    >
      <div className={styles.modalHead}>
        <span className={styles.modalTitulo}>{novo ? "Novo link" : "Editar link"}</span>
        {/* Na edição o setor é fato, não escolha: ele é imutável nas regras,
            porque trocá-lo seria escrever no catálogo de outro setor. */}
        {!novo && <span className={styles.tagNeutra}>{link.setor}</span>}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className={styles.fechar}
          onClick={() => {
            if (podeFechar()) onClose();
          }}
          aria-label="Fechar"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <form
        id={formId}
        className={styles.modalBody}
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
        noValidate
      >
        <div className={styles.linhaNome}>
          {logo ? (
            <span className={styles.logoSelo}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URI conferido; next/image não otimiza data URI */}
              <img src={logo} alt={`Logo de ${nome.trim() || "o link novo"}`} />
            </span>
          ) : (
          <IconePicker
            valor={icone}
            deduzido={deduzido}
            rotulo={nome.trim() || "o link novo"}
            onEscolher={setIcone}
            disabled={salvando}
            className={styles.icone}
            style={{ background: selo.fundo, color: selo.tinta }}
          >
            {iconeAgora ? <Icon name={iconeAgora} size={19} /> : monogramaDe(url)}
          </IconePicker>
          )}
          <label className={styles.field}>
            <span>Nome</span>
            <input
              ref={nomeRef}
              className={`${styles.input} ${invalido("nome") ? styles.inputErro : ""}`}
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                if (invalido("nome")) setErro(null);
              }}
              placeholder="Ex.: Painel de vendas por unidade"
              maxLength={LIMITE_NOME_LINK}
              aria-invalid={invalido("nome")}
              autoFocus
              disabled={salvando}
            />
          </label>
        </div>

        <label className={styles.field}>
          <span>Endereço</span>
          <input
            ref={urlRef}
            className={`${styles.input} ${invalido("url") ? styles.inputErro : ""}`}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (invalido("url")) setErro(null);
            }}
            placeholder="https://app.powerbi.com/…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalido("url")}
            disabled={salvando}
          />
        </label>

        <label className={styles.field}>
          <span>
            Descrição <em className={styles.opcional}>opcional</em>
          </span>
          <textarea
            ref={descricaoRef}
            className={`${styles.textarea} ${invalido("descricao") ? styles.inputErro : ""}`}
            value={descricao}
            onChange={(e) => {
              setDescricao(e.target.value);
              if (invalido("descricao")) setErro(null);
            }}
            placeholder="Para que serve, quem atualiza, o que se encontra lá…"
            maxLength={LIMITE_DESCRICAO_LINK}
            aria-invalid={invalido("descricao")}
            disabled={salvando}
          />
          {/* O contador só aparece perto do teto: o tempo todo na tela, ele
              transformaria uma descrição de duas linhas numa contagem. */}
          {descricao.length > LIMITE_DESCRICAO_LINK * 0.8 && (
            <small className={styles.contador}>
              {descricao.length}/{LIMITE_DESCRICAO_LINK}
            </small>
          )}
        </label>

        {/* O logo é opcional: sem ele o selo segue mostrando o ícone, como
            sempre. O `<input type="file">` fica escondido atrás de um botão do
            app — o controle nativo muda de cara em cada navegador e diz
            "Nenhum arquivo escolhido" mesmo quando há um logo gravado. */}
        <div className={styles.field}>
          <span>
            Logo <em className={styles.opcional}>opcional</em>
          </span>
          <div className={styles.logoLinha}>
            <input
              ref={arquivoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className={styles.arquivoEscondido}
              onChange={(e) => void escolherLogo(e.target.files?.[0])}
              tabIndex={-1}
              aria-hidden="true"
            />
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => arquivoRef.current?.click()}
              disabled={salvando || preparandoLogo}
            >
              <Icon name="upload" size={14} />
              {preparandoLogo ? "Preparando…" : logo ? "Trocar imagem" : "Enviar imagem"}
            </button>
            {logo && (
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => {
                  setLogo(null);
                  setErroLogo(null);
                }}
                disabled={salvando || preparandoLogo}
              >
                <Icon name="trash" size={14} /> Remover logo
              </button>
            )}
          </div>
          <small className={styles.dica}>
            PNG, JPG, WebP ou SVG. A imagem é reduzida para {LADO_LOGO_PX} px, sem
            cortar, e aparece no lugar do ícone.
          </small>
          {erroLogo && (
            <p className={styles.erro} role="alert">
              {erroLogo}
            </p>
          )}
        </div>

        {/* O setor só é escolha na CRIAÇÃO e para quem participa de mais de
            um. `<Select>` não é um controle de formulário nativo, por isso o
            rótulo vai no `ariaLabel` e não num `<label>` em volta. */}
        {novo && setores.length > 1 && (
          <div className={styles.field}>
            <span>Setor</span>
            <Select
              value={setor}
              options={setorOptions}
              onChange={setSetor}
              ariaLabel="Setor do link"
            />
          </div>
        )}

        {erro && (
          <p className={styles.erro} role="alert">
            {erro.texto}
          </p>
        )}

        {confirmandoSaida && (
          <div className={styles.confirmaSaida} role="alertdialog" aria-live="assertive">
            <span>
              <strong>Fechar sem salvar?</strong> O que você escreveu neste link é
              perdido.
            </span>
            <div className={styles.confirmaAcoes}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setConfirmandoSaida(false)}
                autoFocus
              >
                Continuar editando
              </button>
              <button type="button" className={styles.btnPerigo} onClick={onClose}>
                Descartar
              </button>
            </div>
          </div>
        )}
      </form>

      <div className={styles.modalPe}>
        {podeApagar && (
          <button
            type="button"
            className={styles.btnPerigo}
            onClick={() => void apagar()}
            disabled={salvando}
          >
            <Icon name="trash" size={14} /> Remover
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => {
            if (podeFechar()) onClose();
          }}
          disabled={salvando}
        >
          Cancelar
        </button>
        <button type="submit" form={formId} className={styles.btnPri} disabled={salvando}>
          {salvando ? "Salvando…" : novo ? "Cadastrar link" : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
