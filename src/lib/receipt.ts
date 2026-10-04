import { callFunction } from './ai';
import { compressImage } from './image';
import type { ReceiptScan } from '../../supabase/functions/_shared/receipt';

export type { ReceiptItem, ReceiptScan } from '../../supabase/functions/_shared/receipt';

/**
 * レシート読み取りのクライアント側。
 * 画像は Edge Function `scan-receipt` に渡し、構造化された結果を受け取る。
 * 結果はそのまま登録せず、確認画面（ReceiptScanModal）で直してから保存する。
 */

/** 文字が潰れない程度に大きめ。写真の 1/2 くらいで、WebP なら 300〜500KB */
const RECEIPT_MAX_EDGE = 2000;
const RECEIPT_QUALITY = 0.85;

export class ReceiptError extends Error {}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ReceiptError('画像の読み込みに失敗しました'));
    reader.readAsDataURL(blob);
  });
}

export interface ScanResult {
  scan: ReceiptScan;
  /** 確認画面でサムネイル表示する用 */
  previewUrl: string;
  usage: string | null;
}

export async function scanReceipt(file: File, categories: string[], defaultDate: string): Promise<ScanResult> {
  const { blob } = await compressImage(file, { maxEdge: RECEIPT_MAX_EDGE, quality: RECEIPT_QUALITY });
  const image = await blobToDataUrl(blob);

  const res = await callFunction('scan-receipt', { image, categories, default_date: defaultDate });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ReceiptError(body?.error ?? `レシートの読み取りに失敗しました (${res.status})`);

  return { scan: body as ReceiptScan, previewUrl: URL.createObjectURL(blob), usage: res.headers.get('X-Ai-Usage') };
}

/** 明細の合計とレシートの合計の差。合わなければ確認画面で注意を出す */
export function itemsTotalDiff(items: Array<{ amount: number }>, total: number | null): number | null {
  if (total == null) return null;
  return items.reduce((s, i) => s + i.amount, 0) - total;
}
