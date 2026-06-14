/** 平均（空配列は null） */
export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * ピアソンの相関係数。
 * データ点が3未満、またはどちらかの分散が0のときは信頼できないので null。
 */
export function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = mean(pairs.map((p) => p[0]))!;
  const my = mean(pairs.map((p) => p[1]))!;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) {
    const a = x - mx, b = y - my;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

/** 相関係数を日本語ラベルにする */
export function correlationLabel(r: number): string {
  const a = Math.abs(r);
  if (a < 0.2) return 'ほぼ相関なし';
  const strength = a < 0.4 ? '弱い' : a < 0.7 ? '中程度の' : '強い';
  return `${strength}${r > 0 ? '正' : '負'}の相関`;
}
