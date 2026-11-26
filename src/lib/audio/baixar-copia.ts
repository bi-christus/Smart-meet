import { assembleBlob, type RecordingRecord } from "./recording-db";

/**
 * Entrega ao navegador a cópia local de um áudio que não chegou ao Drive.
 *
 * Mora aqui, e não dentro da faixa de recuperação, porque agora há duas telas
 * com o mesmo botão — a faixa e o painel do envio (#250). Duas cópias deste
 * trecho divergiriam no detalhe que importa: o nome do arquivo baixado, que é
 * por onde a pessoa reconhece a reunião na pasta de downloads.
 *
 * O `revokeObjectURL` espera 30 s, e não o próximo quadro: num áudio de
 * centenas de MB, o navegador ainda está copiando quando o clique volta, e
 * revogar antes corta o download no meio.
 */
export async function baixarCopiaLocal(rec: RecordingRecord): Promise<void> {
  const blob = await assembleBlob(rec);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = rec.driveName || `${rec.title}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
