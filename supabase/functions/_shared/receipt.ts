// =====================================================================
// レシート読み取り結果の型と整形（Deno 非依存。アプリ側の Vitest からも使う）
//
// モデルの出力は JSON Schema で縛っているが、数値が文字列で来る・空の品名が混じる・
// カテゴリが候補に無い、といった揺れは起こりうるので、ここで必ず正規化してから使う。
// =====================================================================

export const PAYMENT_METHODS = ['現金', 'クレジット', '電子マネー', '口座引落', 'その他'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export interface ReceiptItem {
  name: string;
  /** 税込・値引後の金額（円） */
  amount: number;
  category: string;
}

export interface ReceiptScan {
  store: string | null;
  date: string | null;           // YYYY-MM-DD
  total: number | null;          // レシートの支払合計（税込）
  payment_method: PaymentMethod | null;
  items: ReceiptItem[];
  /** 読み取りに自信がない点（画面に注意書きとして出す） */
  notes: string | null;
}

/** モデルに渡す出力スキーマ（strict）。categories は呼び出しごとに差し替える */
export function receiptSchema(categories: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      store: { type: ['string', 'null'], description: '店名（支店名まで）。読めなければ null' },
      date: { type: ['string', 'null'], description: '購入日 YYYY-MM-DD。読めなければ null' },
      total: { type: ['number', 'null'], description: '支払った合計金額（税込）。読めなければ null' },
      payment_method: { type: ['string', 'null'], enum: [...PAYMENT_METHODS, null] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: '品名。半角カナや略称は読みやすい日本語に直す' },
            amount: { type: 'number', description: '税込・値引後の金額（円）' },
            category: { type: 'string', enum: categories },
          },
          required: ['name', 'amount', 'category'],
        },
      },
      notes: { type: ['string', 'null'], description: '読み取りに自信がない点。無ければ null' },
    },
    required: ['store', 'date', 'total', 'payment_method', 'items', 'notes'],
  };
}

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[¥,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** モデルの出力を安全な形に整える */
export function normalizeReceipt(raw: unknown, categories: string[]): ReceiptScan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fallbackCategory = categories[0] ?? 'その他';

  const items: ReceiptItem[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const amount = toNum(o.amount);
    if (name === '' || amount == null) continue;
    const category = typeof o.category === 'string' && categories.includes(o.category) ? o.category : fallbackCategory;
    items.push({ name, amount: Math.round(amount), category });
  }

  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  const payment = typeof r.payment_method === 'string' && (PAYMENT_METHODS as readonly string[]).includes(r.payment_method)
    ? (r.payment_method as PaymentMethod)
    : null;
  const total = toNum(r.total);

  return {
    store: typeof r.store === 'string' && r.store.trim() !== '' ? r.store.trim() : null,
    date,
    total: total == null ? null : Math.round(total),
    payment_method: payment,
    items,
    notes: typeof r.notes === 'string' && r.notes.trim() !== '' ? r.notes.trim() : null,
  };
}
