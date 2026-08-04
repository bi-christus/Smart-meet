"use client";

/**
 * Os dois campos de solicitante, com criação no lugar.
 *
 * Vive num componente próprio porque aparece em duas telas — no modal de
 * demanda do Kanban e na validação de propostas em Relatórios IA — e manter
 * duas cópias garantiria que uma ficasse para trás.
 *
 * Quem descobre que falta um solicitante é quem está preenchendo a demanda. Sem
 * criar aqui, a alternativa real não é "pedir ao admin e voltar depois": é
 * salvar a demanda sem solicitante e nunca mais voltar. Por isso criar é de
 * qualquer usuário — mas APAGAR continua só no Admin, porque remover um
 * solicitante em uso deixa cards apontando para um nome que sumiu.
 */
import { useMemo, useState } from "react";
import {
  garantirSetorSolicitante,
  garantirSolicitante,
  type Solicitante,
  type SolicitanteSetor,
} from "@/lib/solicitantes";
import { Icon } from "@/components/icons";
import styles from "./solicitante-picker.module.css";

export function SolicitantePicker({
  setores,
  solicitantes,
  setorValue,
  requesterValue,
  onSetor,
  onRequester,
  /** Classes do formulário anfitrião, para o campo não destoar da tela. */
  classes,
}: {
  setores: SolicitanteSetor[];
  solicitantes: Solicitante[];
  setorValue: string;
  requesterValue: string;
  onSetor: (v: string) => void;
  onRequester: (v: string) => void;
  classes?: { label?: string; select?: string; input?: string };
}) {
  const [criando, setCriando] = useState<null | "setor" | "pessoa">(null);
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const doSetor = useMemo(
    () =>
      setorValue
        ? solicitantes.filter((s) => s.setor === setorValue)
        : solicitantes,
    [solicitantes, setorValue],
  );

  async function criar() {
    const n = nome.trim();
    if (!n) return;
    setErro(null);
    setSalvando(true);
    try {
      if (criando === "setor") {
        const nomeFinal = await garantirSetorSolicitante(n, setores);
        // Seleciona o que acabou de criar: o próximo passo é sempre usá-lo.
        onSetor(nomeFinal);
        onRequester("");
      } else {
        const nomeFinal = await garantirSolicitante(n, setorValue, solicitantes);
        onRequester(nomeFinal);
      }
      setNome("");
      setCriando(null);
    } catch (e) {
      setErro(
        e instanceof Error
          ? "Não foi possível cadastrar. " + e.message
          : "Não foi possível cadastrar.",
      );
    } finally {
      setSalvando(false);
    }
  }

  const lbl = classes?.label ?? styles.label;
  const sel = classes?.select ?? styles.select;
  const inp = classes?.input ?? styles.input;

  return (
    <>
      <div>
        <label className={lbl}>
          Setor solicitante
          <button
            type="button"
            className={styles.novo}
            onClick={() => {
              setCriando(criando === "setor" ? null : "setor");
              setNome("");
              setErro(null);
            }}
          >
            {criando === "setor" ? "cancelar" : "+ novo"}
          </button>
        </label>
        {criando === "setor" ? (
          <div className={styles.linhaNovo}>
            <input
              className={inp}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void criar();
                }
              }}
              placeholder="Nome do setor…"
              maxLength={60}
              autoFocus
            />
            <button
              type="button"
              className={styles.salvar}
              onClick={() => void criar()}
              disabled={salvando || !nome.trim()}
            >
              <Icon name="check" size={13} />
            </button>
          </div>
        ) : (
          <select
            className={sel}
            value={setorValue}
            onChange={(e) => {
              onSetor(e.target.value);
              onRequester("");
            }}
          >
            <option value="">—</option>
            {setores.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className={lbl}>
          Solicitante
          <button
            type="button"
            className={styles.novo}
            onClick={() => {
              setCriando(criando === "pessoa" ? null : "pessoa");
              setNome("");
              setErro(null);
            }}
          >
            {criando === "pessoa" ? "cancelar" : "+ novo"}
          </button>
        </label>
        {criando === "pessoa" ? (
          <div className={styles.linhaNovo}>
            <input
              className={inp}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void criar();
                }
              }}
              placeholder={
                setorValue ? `Nome — ${setorValue}` : "Escolha o setor antes…"
              }
              maxLength={80}
              autoFocus
            />
            <button
              type="button"
              className={styles.salvar}
              onClick={() => void criar()}
              disabled={salvando || !nome.trim() || !setorValue}
            >
              <Icon name="check" size={13} />
            </button>
          </div>
        ) : (
          <select
            className={sel}
            value={requesterValue}
            onChange={(e) => onRequester(e.target.value)}
          >
            <option value="">—</option>
            {doSetor.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {erro && <p className={styles.erro}>{erro}</p>}
    </>
  );
}
