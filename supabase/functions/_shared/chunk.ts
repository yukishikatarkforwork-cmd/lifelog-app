// 文字列分割だけを切り出したモジュール。
// Deno 固有の API を一切使わないので、アプリ側の Vitest からそのままテストできる。

/**
 * 長い日記を分割する。改行か句点を優先して切り、意味が途切れないよう少し重ねる。
 * 短い日記（ほとんどはこれ）は分割せず1件のまま返す。
 */
export function chunkText(text: string, size = 400, overlap = 60): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (trimmed.length <= size) return [trimmed];

  // 重なりが幅以上だと切り出し位置が前に戻り、永久に終わらなくなる
  const step = Math.max(1, size - Math.min(overlap, size - 1));

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + size, trimmed.length);

    if (end < trimmed.length) {
      // 直近の改行か句点で切る。前半で切れてしまう位置は使わない
      const window = trimmed.slice(start, end);
      const br = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'));
      if (br > size * 0.5) end = start + br + 1;
    }

    const piece = trimmed.slice(start, end).trim();
    if (piece !== '') chunks.push(piece);

    if (end >= trimmed.length) break;
    // 句読点で手前に切った場合も必ず前進させる
    start = Math.max(start + step, end - overlap);
  }
  return chunks;
}
