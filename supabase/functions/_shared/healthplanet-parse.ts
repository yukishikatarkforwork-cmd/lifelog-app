// =====================================================================
// Health Planet（タニタ）の応答を体重記録に変換する純粋関数。
// Deno 固有の API を使わないので、アプリ側の Vitest からそのままテストできる。
//
// API 仕様: https://www.healthplanet.jp/apis/api.html
//   GET /status/innerscan.json?access_token=..&date=1&from=yyyyMMddHHmmss&to=..&tag=6021,6022
//   応答: { birth_date, height, sex, data: [{ date: "yyyyMMddHHmm", keydata: "65.20", model, tag: "6021" }] }
//   date=1 は「測定日時」で絞る指定（0 は登録日時）。from〜to は最大3か月。
// =====================================================================

/** 取り込む項目と Health Planet のタグ番号 */
export const HP_TAGS = {
  weight_kg: '6021',             // 体重 (kg)
  body_fat_pct: '6022',          // 体脂肪率 (%)
  muscle_kg: '6023',             // 筋肉量 (kg)
  visceral_fat_level: '6026',    // 内臓脂肪レベル
  basal_metabolism_kcal: '6027', // 基礎代謝量 (kcal)
  body_age: '6028',              // 体内年齢 (歳)
  bone_kg: '6029',               // 推定骨量 (kg)
} as const;

export type BodyField = keyof typeof HP_TAGS;

const TAG_TO_FIELD: Record<string, BodyField> = Object.fromEntries(
  (Object.entries(HP_TAGS) as Array<[BodyField, string]>).map(([k, v]) => [v, k]),
) as Record<string, BodyField>;

/** innerscan.json の tag パラメータに渡す値 */
export const HP_TAG_PARAM = Object.values(HP_TAGS).join(',');

export interface InnerscanResponse {
  birth_date?: string;
  height?: string;
  sex?: string;
  data?: Array<{ date: string; keydata: string; model?: string; tag: string }>;
}

/** 1日ぶんの測定値。body_records の列名に揃えてある */
export interface BodyMeasurement {
  date: string;        // YYYY-MM-DD
  measured_at: string; // ISO 8601（JST）
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_kg: number | null;
  visceral_fat_level: number | null;
  basal_metabolism_kcal: number | null;
  body_age: number | null;
  bone_kg: number | null;
}

const emptyMeasurement = (date: string, measuredAt: string): BodyMeasurement => ({
  date, measured_at: measuredAt,
  weight_kg: null, body_fat_pct: null, muscle_kg: null, visceral_fat_level: null,
  basal_metabolism_kcal: null, body_age: null, bone_kg: null,
});

/** "202604010712" → { date: "2026-04-01", iso: "2026-04-01T07:12:00+09:00" }。形式が違えば null */
export function parseHpDate(s: string): { date: string; iso: string } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const date = `${y}-${mo}-${d}`;
  // Health Planet は日本のサービスで、時刻は日本時間で返る
  return { date, iso: `${date}T${h}:${mi}:${sec ?? '00'}+09:00` };
}

/**
 * 応答を日ごとの測定値にまとめる。
 * 同じ日に複数回測っていれば最初（いちばん早い時刻）の測定を採用する。
 * 同じ時刻の複数タグ（体重と体脂肪率など）は1回の測定として束ねる。
 */
export function parseInnerscan(res: InnerscanResponse): BodyMeasurement[] {
  // 測定時刻ごとに束ねる
  const byTime = new Map<string, BodyMeasurement>();
  for (const row of res.data ?? []) {
    const field = TAG_TO_FIELD[row.tag];
    if (!field) continue;
    const parsed = parseHpDate(row.date);
    if (!parsed) continue;
    const value = Number(row.keydata);
    if (!Number.isFinite(value)) continue;

    const m = byTime.get(parsed.iso) ?? emptyMeasurement(parsed.date, parsed.iso);
    m[field] = value;
    byTime.set(parsed.iso, m);
  }

  // 日ごとに最も早い測定を選ぶ（ISO 文字列は同一タイムゾーンなので辞書順＝時刻順）
  const byDate = new Map<string, BodyMeasurement>();
  for (const m of byTime.values()) {
    const cur = byDate.get(m.date);
    if (!cur || m.measured_at < cur.measured_at) byDate.set(m.date, m);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Date → Health Planet の from/to 形式（yyyyMMddHHmmss、日本時間） */
export function formatHpDateTime(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(jst.getUTCFullYear(), 4)}${p(jst.getUTCMonth() + 1)}${p(jst.getUTCDate())}` +
    `${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}${p(jst.getUTCSeconds())}`
  );
}

/** 1回の問い合わせで遡れる上限（API 仕様の3か月を日数で近似） */
export const HP_WINDOW_DAYS = 90;

/**
 * 取得期間を 90 日ごとの窓に分ける（新しい側から）。
 * from〜to が3か月を超えると直近3か月に丸められてしまうので、長期間は分割して引く。
 */
export function splitWindows(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  const span = HP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let end = to.getTime();
  while (end > from.getTime()) {
    const start = Math.max(from.getTime(), end - span);
    out.push({ from: new Date(start), to: new Date(end) });
    end = start;
  }
  return out;
}
