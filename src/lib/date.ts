/** ローカルタイムの YYYY-MM-DD を返す（UTC ずれを避けるため toISOString は使わない） */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toDateStr(dt);
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "6月7日(土)" のような表示用文字列 */
export function formatDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${y}年${m}月${d}日(${WEEKDAYS[dt.getDay()]})`;
}

/** "6/7(土)" の短縮表示 */
export function formatShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}/${d}(${WEEKDAYS[dt.getDay()]})`;
}
