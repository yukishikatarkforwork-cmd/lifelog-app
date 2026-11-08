// =====================================================================
// サブスクの検出と集計。
// 支出の店名ごとに請求日を並べ、ほぼ毎月（または毎年）ほぼ同額なら「定期的な請求」とみなす。
// 検出結果はそのまま台帳に入れず、画面で「登録」「対象外」を選んでもらう。
// =====================================================================
import { addDays } from './date';
import { displayMerchant, looksLikeSubscription, merchantMatches, normalizeMerchant } from './merchant';
import type { Expense, Subscription, SubscriptionCycle } from './types';

export interface SubscriptionCandidate {
  key: string;
  name: string;
  /** 台帳の merchant_pattern に入れる元の店名 */
  pattern: string;
  cycle: SubscriptionCycle;
  amount: number;
  count: number;
  firstDate: string;
  lastDate: string;
  nextExpected: string | null;
  /** 検出の根拠（画面で説明する） */
  reason: string;
  charges: Expense[];
}

type ExpenseLike = Pick<Expense, 'id' | 'date' | 'amount' | 'merchant' | 'memo'>;

function merchantOf(e: ExpenseLike): string {
  return (e.merchant && e.merchant.trim() !== '' ? e.merchant : e.memo ?? '').trim();
}

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 同じ月の請求（分割された明細など）は1回とみなすため、月ごとに最後の1件に丸める */
function oneChargePerMonth<T extends ExpenseLike>(sorted: T[]): T[] {
  const byMonth = new Map<string, T>();
  for (const e of sorted) byMonth.set(e.date.slice(0, 7), e);
  return [...byMonth.values()];
}

export function nextChargeDate(lastDate: string, cycle: SubscriptionCycle): string | null {
  if (cycle === 'other') return null;
  const [y, m, d] = lastDate.split('-').map(Number);
  const dt = cycle === 'monthly' ? new Date(y, m, d) : new Date(y + 1, m - 1, d);
  // 月末の繰り越し（1/31 → 2/28）を吸収する
  if (dt.getDate() !== d) dt.setDate(0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * 支出一覧から定期的な請求を見つける。
 *  - 同じ店（正規化後）で 2 回以上、間隔の中央値が 25〜37 日 → 月額、350〜380 日 → 年額
 *  - 金額のばらつきが ±20% 以内（為替やプラン変更の揺れは許す）
 *  - 1 回しか無くてもサブスクらしい店名（Netflix・Spotify・○○ジム など）なら候補に入れる
 * 既に台帳にある（対象外を含む）店は除く。
 */
export function detectSubscriptions(expenses: Expense[], existing: Pick<Subscription, 'merchant_pattern'>[]): SubscriptionCandidate[] {
  const groups = new Map<string, Expense[]>();
  for (const e of expenses) {
    const m = merchantOf(e);
    const key = normalizeMerchant(m);
    if (key === '' || key.length < 2) continue;
    if (e.amount <= 0) continue;
    if (existing.some((s) => merchantMatches(m, s.merchant_pattern))) continue;
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }

  const out: SubscriptionCandidate[] = [];
  for (const [key, g] of groups) {
    const sorted = [...g].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const name = displayMerchant(merchantOf(latest));
    const base = { key, name, pattern: merchantOf(latest), charges: sorted, firstDate: sorted[0].date, lastDate: latest.date };

    const monthly = oneChargePerMonth(sorted);
    let hintCycle: SubscriptionCycle = 'monthly';
    if (monthly.length >= 2) {
      const gaps = monthly.slice(1).map((e, i) => daysBetween(monthly[i].date, e.date));
      const med = median(gaps);
      const amounts = monthly.map((e) => e.amount);
      const amt = median(amounts);
      // 値上げ（Prime 4900→5900 など）は許す。前回比 25% 以内なら同じ契約の請求とみなす
      const stable = amounts.every((a, i) => i === 0 || Math.abs(a - amounts[i - 1]) <= Math.max(amounts[i - 1] * 0.25, 50));
      let cycle: SubscriptionCycle | null = null;
      if (med >= 25 && med <= 37) cycle = 'monthly';
      else if (med >= 350 && med <= 380) cycle = 'yearly';
      if (cycle) hintCycle = cycle;
      if (cycle && stable) {
        out.push({
          ...base, cycle, amount: Math.round(latest.amount), count: monthly.length,
          nextExpected: nextChargeDate(latest.date, cycle),
          reason: `${monthly.length}回、約${Math.round(med)}日おきにほぼ同額（¥${Math.round(amt).toLocaleString()}）`,
        });
        continue;
      }
    }
    if (looksLikeSubscription(merchantOf(latest))) {
      out.push({
        ...base, cycle: hintCycle, amount: Math.round(latest.amount), count: sorted.length,
        nextExpected: nextChargeDate(latest.date, hintCycle),
        reason: sorted.length === 1 ? 'サブスクでよくある店名（まだ1回だけ）' : 'サブスクでよくある店名（間隔は不規則）',
      });
    }
  }
  // 金額の大きい順。月額換算で揃える
  return out.sort((a, b) => monthlyEquivalent(b.amount, b.cycle) - monthlyEquivalent(a.amount, a.cycle));
}

export function monthlyEquivalent(amount: number | null, cycle: SubscriptionCycle): number {
  if (amount == null) return 0;
  if (cycle === 'monthly') return amount;
  if (cycle === 'yearly') return amount / 12;
  return 0;
}

/** 台帳の各サブスクに、該当する請求（店名パターンに一致する支出）を結びつける */
export function chargesFor(sub: Pick<Subscription, 'merchant_pattern'>, expenses: Expense[]): Expense[] {
  return expenses
    .filter((e) => e.amount > 0 && merchantMatches(merchantOf(e), sub.merchant_pattern))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface SubscriptionStatusInfo {
  lastCharge: Expense | null;
  nextExpected: string | null;
  /** 予定日を過ぎても請求が無い（解約できているか、カードが変わったか） */
  overdueDays: number | null;
  /** 解約済みなのに請求がある */
  chargedAfterCancel: Expense | null;
}

export function subscriptionStatus(sub: Subscription, charges: Expense[], today: string): SubscriptionStatusInfo {
  const last = charges[0] ?? null;
  const next = last ? nextChargeDate(last.date, sub.cycle) : null;
  const overdue = next && next < today ? daysBetween(next, today) : null;
  const afterCancel = sub.status === 'cancelled' && sub.cancelled_on
    ? charges.find((c) => c.date > addDays(sub.cancelled_on!, 0)) ?? null
    : null;
  return { lastCharge: last, nextExpected: next, overdueDays: overdue, chargedAfterCancel: afterCancel };
}

/** 月ごとのサブスク合計（その月に実際に請求された分） */
export function subscriptionTotalInMonth(subs: Subscription[], expenses: Expense[], month: string): number {
  let total = 0;
  for (const s of subs) {
    if (s.status === 'ignored') continue;
    for (const c of chargesFor(s, expenses)) if (c.date.startsWith(month)) total += c.amount;
  }
  return total;
}
