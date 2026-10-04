// =====================================================================
// Azure AI Document Intelligence の prebuilt-receipt でレシートを読む。
//
// 無料枠（F0）が月 500 ページあり、日本語レシートに対応しているので、
// LLM を使わずにゼロ円で店名・日付・明細・合計が取れる。
// ただし品名の半角カナ・値引・税込換算・カテゴリは返ってこないので、
// receipt-rules.ts の規則で後処理する。
//
// REST: POST {endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30
//       → 202 + Operation-Location をポーリング → analyzeResult
// =====================================================================
import type { ReceiptScan } from './receipt.ts';
import { guessCategory, guessPayment, normalizeName, reconcileItems, type RawItem } from './receipt-rules.ts';

const API_VERSION = '2024-11-30';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 40_000;

export class AzureReceiptError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

interface Field {
  type?: string;
  content?: string;
  valueString?: string;
  valueDate?: string;
  valueNumber?: number;
  valueCurrency?: { amount?: number; currencyCode?: string };
  valueArray?: Field[];
  valueObject?: Record<string, Field>;
}

interface AnalyzeResult {
  status?: string;
  error?: { message?: string };
  analyzeResult?: {
    content?: string;
    documents?: Array<{ fields?: Record<string, Field> }>;
  };
}

const money = (f: Field | undefined): number | null => {
  const v = f?.valueCurrency?.amount ?? f?.valueNumber;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

async function startAnalyze(endpoint: string, key: string, dataUrl: string): Promise<string> {
  const base64 = dataUrl.replace(/^data:[^,]+,/, '');
  const url = `${endpoint.replace(/\/+$/, '')}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${API_VERSION}&locale=ja-JP`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Source: base64 }),
  });
  if (res.status !== 202) {
    const detail = await res.text().catch(() => '');
    if (res.status === 429) throw new AzureReceiptError('レシート読み取りの無料枠を使い切りました。しばらく待ってからお試しください。', 429);
    throw new AzureReceiptError(`Azure の読み取り開始に失敗しました (${res.status}): ${detail.slice(0, 200)}`);
  }
  await res.body?.cancel();
  const op = res.headers.get('operation-location');
  if (!op) throw new AzureReceiptError('Azure から処理の参照先が返りませんでした');
  return op;
}

async function waitResult(opUrl: string, key: string): Promise<AnalyzeResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(opUrl, { headers: { 'Ocp-Apim-Subscription-Key': key } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AzureReceiptError(`Azure の結果取得に失敗しました (${res.status}): ${detail.slice(0, 200)}`);
    }
    const body = await res.json() as AnalyzeResult;
    if (body.status === 'succeeded') return body;
    if (body.status === 'failed') throw new AzureReceiptError(`Azure の読み取りに失敗しました: ${body.error?.message ?? ''}`);
  }
  throw new AzureReceiptError('Azure の読み取りがタイムアウトしました', 504);
}

/** Azure の結果を家計簿向けに整える（export しているのはテストのため） */
export function mapAzureResult(result: AnalyzeResult, categories: string[]): ReceiptScan {
  const doc = result.analyzeResult?.documents?.[0];
  const fields = doc?.fields ?? {};
  const content = result.analyzeResult?.content ?? '';

  const store = fields.MerchantName?.valueString ? normalizeName(fields.MerchantName.valueString) : null;
  const date = fields.TransactionDate?.valueDate && /^\d{4}-\d{2}-\d{2}$/.test(fields.TransactionDate.valueDate)
    ? fields.TransactionDate.valueDate : null;
  const total = money(fields.Total);
  const totalTax = money(fields.TotalTax);

  const raw: RawItem[] = [];
  for (const it of fields.Items?.valueArray ?? []) {
    const o = it.valueObject ?? {};
    const name = o.Description?.valueString ?? o.Description?.content ?? '';
    // 単価×数量が取れていて TotalPrice が無い行は掛け算で補う
    const amount = money(o.TotalPrice) ?? (
      money(o.Price) != null && typeof o.Quantity?.valueNumber === 'number'
        ? money(o.Price)! * o.Quantity.valueNumber
        : money(o.Price)
    );
    if (amount == null) continue;
    raw.push({ name, amount, line: it.content ?? `${o.Description?.content ?? ''} ${o.TotalPrice?.content ?? ''}` });
  }

  const { items, note } = reconcileItems(raw, total == null ? null : Math.round(total), totalTax == null ? null : Math.round(totalTax));

  return {
    store,
    date,
    total: total == null ? null : Math.round(total),
    payment_method: guessPayment(content),
    items: items.map((i) => ({ ...i, category: guessCategory(i.name, store, categories) })),
    notes: note,
  };
}

export async function scanWithAzure(endpoint: string, key: string, dataUrl: string, categories: string[]): Promise<ReceiptScan> {
  const op = await startAnalyze(endpoint, key, dataUrl);
  const result = await waitResult(op, key);
  return mapAzureResult(result, categories);
}
