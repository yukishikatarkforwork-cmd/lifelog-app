// =====================================================================
// カード利用明細のパーサ。
// カード会社サイトの CSV（Shift_JIS が多い）や、明細ページを範囲選択してコピーした
// タブ区切りテキストを受け取り、「日付・店名・金額」の列を自動で見つけて行にする。
// 会社ごとのフォーマット定義は持たず、列の中身（日付らしさ・数値らしさ）とヘッダー名で判定する。
// 三井住友カード（Vpass）の CSV はヘッダー無し・Shift_JIS・「利用日,店名,金額,支払区分,…」の並びだが、
// この方式ならヘッダーが無くても列を特定できる。
// =====================================================================

export interface StatementRow {
  date: string;        // YYYY-MM-DD
  merchant: string;
  amount: number;      // 円。返金・調整は負
  raw: string;         // 元の行（デバッグ・表示用）
}

export interface ParsedStatement {
  rows: StatementRow[];
  /** 明細として読めなかった行数（ヘッダー・合計行・空行は含まない） */
  unparsed: number;
  columns: { date: number; merchant: number; amount: number } | null;
  delimiter: ',' | '\t';
}

/** ファイルのバイト列を文字列にする。UTF-8 で壊れるなら Shift_JIS として読む */
export function decodeStatement(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

const DATE_RE = /^\s*(\d{4}|\d{2})[/\-.年]\s*(\d{1,2})[/\-.月]\s*(\d{1,2})日?(?:[\sT(（].*)?$/;

/** 「2026/11/09」「2026-11-09」「2026年11月9日」「26/11/09」「2026/11/09 12:34」を YYYY-MM-DD にする */
export function parseDateCell(cell: string): string | null {
  const m = DATE_RE.exec(toHalfWidth(cell));
  if (!m) return null;
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 「¥1,234」「1,234円」「△1,234」「-1234」「１，２３４」を数値にする。数値でなければ null */
export function parseAmountCell(cell: string): number | null {
  let s = toHalfWidth(cell).replace(/[\s¥￥円,]/g, '');
  if (s === '') return null;
  let neg = false;
  if (/^[△▲-]/.test(s)) { neg = true; s = s.slice(1); }
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  return neg ? -n : n;
}

function toHalfWidth(s: string): string {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',').replace(/／/g, '/').replace(/－/g, '-');
}

/** CSV 1行を引用符を考慮して分割する */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const HEADER_DATE = /利用日|ご利用日|利用年月日|取引日|決済日|日付|date/i;
const HEADER_MERCHANT = /利用店名|ご利用店名|利用先|加盟店|摘要|利用内容|お取引内容|内容|店名|description|merchant|name/i;
// 支払総額・今回請求額より「利用金額」を優先する（分割・リボの手数料込み額を拾わない）
const HEADER_AMOUNT_STRONG = /利用金額|ご利用金額|取引金額|決済金額|amount/i;
const HEADER_AMOUNT_WEAK = /金額|請求額|支払額/i;
/** 合計・小計・案内行は明細ではない */
const SUMMARY_ROW = /^(合計|小計|お支払|ご請求|今回|累計|前回|総額|計$)/;

export function parseStatement(text: string): ParsedStatement {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\u00a0/g, ' ')).filter((l) => l.trim() !== '');
  const delimiter: ',' | '\t' = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  const table = lines.map((l) => splitCsvLine(l, delimiter));

  // データ行＝日付セルを持つ行。ヘッダー候補＝日付セルを持たず文字が多い行
  const dateHits = table.map((cells) => cells.map((c) => parseDateCell(c) != null));
  const dataIdx = table.map((_, i) => i).filter((i) => dateHits[i].some(Boolean));
  if (dataIdx.length === 0) return { rows: [], unparsed: lines.length, columns: null, delimiter };

  const width = Math.max(...dataIdx.map((i) => table[i].length));
  const header = table.find((cells, i) => !dateHits[i].some(Boolean) && cells.filter((c) => c !== '').length >= 2
    && cells.some((c) => HEADER_DATE.test(c) || HEADER_AMOUNT_WEAK.test(c) || HEADER_MERCHANT.test(c))) ?? null;

  // 列ごとの統計
  const dateCount = Array(width).fill(0) as number[];
  const amountCount = Array(width).fill(0) as number[];
  const textLen = Array(width).fill(0) as number[];
  for (const i of dataIdx) {
    table[i].forEach((c, col) => {
      if (parseDateCell(c) != null) dateCount[col]++;
      else if (parseAmountCell(c) != null) amountCount[col]++;
      else if (c !== '') textLen[col] += c.length;
    });
  }
  const argmax = (xs: number[], ok: (col: number) => boolean = () => true) => {
    let best = -1;
    for (let col = 0; col < xs.length; col++) if (ok(col) && xs[col] > 0 && (best < 0 || xs[col] > xs[best])) best = col;
    return best;
  };
  const headerCol = (re: RegExp, ok: (col: number) => boolean = () => true) =>
    header ? header.findIndex((h, col) => re.test(h) && ok(col)) : -1;

  let dateCol = headerCol(HEADER_DATE, (c) => dateCount[c] > 0);
  if (dateCol < 0) dateCol = argmax(dateCount);

  let amountCol = headerCol(HEADER_AMOUNT_STRONG, (c) => amountCount[c] > 0);
  if (amountCol < 0) amountCol = headerCol(HEADER_AMOUNT_WEAK, (c) => amountCount[c] > 0);
  if (amountCol < 0) {
    // ヘッダーが無ければ「数値が最も多く入っている列」のうち最初のもの（利用金額は手数料・回数より左にあることが多い）
    const max = Math.max(...amountCount);
    amountCol = amountCount.findIndex((n) => n === max && n > 0);
  }

  let merchantCol = headerCol(HEADER_MERCHANT, (c) => c !== dateCol && c !== amountCol && textLen[c] > 0);
  if (merchantCol < 0) merchantCol = argmax(textLen, (c) => c !== dateCol && c !== amountCol);

  if (dateCol < 0 || amountCol < 0) return { rows: [], unparsed: dataIdx.length, columns: null, delimiter };

  const rows: StatementRow[] = [];
  let unparsed = 0;
  for (const i of dataIdx) {
    const cells = table[i];
    const date = parseDateCell(cells[dateCol] ?? '');
    const amount = parseAmountCell(cells[amountCol] ?? '');
    const merchant = (merchantCol >= 0 ? cells[merchantCol] ?? '' : '').trim();
    if (date == null || amount == null) { unparsed++; continue; }
    if (SUMMARY_ROW.test(merchant)) continue;
    if (amount === 0 && merchant === '') continue;
    rows.push({ date, merchant, amount, raw: lines[i] });
  }
  return { rows, unparsed, columns: { date: dateCol, merchant: merchantCol, amount: amountCol }, delimiter };
}

/**
 * 重複取り込みを防ぐキー。同じ日に同じ店で同じ金額が複数回あっても別の行として扱えるよう、
 * 取り込み1回分の中での出現順を付ける。
 */
export function buildImportKeys(cardName: string, rows: StatementRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `card:${cardName.trim()}:${r.date}:${r.merchant.replace(/\s+/g, ' ').trim()}:${r.amount}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}
