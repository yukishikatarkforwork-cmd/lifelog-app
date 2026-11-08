import { describe, it, expect } from 'vitest';
import { chargesFor, detectSubscriptions, monthlyEquivalent, nextChargeDate, subscriptionStatus } from './subscriptions';
import type { Expense, Subscription } from './types';

let seq = 0;
function exp(date: string, amount: number, merchant: string | null, memo: string | null = null): Expense {
  seq++;
  return {
    id: `e${seq}`, user_id: 'u', date, amount, category: 'その他', payment_method: 'クレジット', memo,
    merchant, source: 'card', card_name: '三井住友', import_key: `k${seq}`, subscription_id: null,
    created_at: '', updated_at: '',
  };
}

describe('detectSubscriptions', () => {
  it('毎月ほぼ同じ日に同額なら月額として検出する', () => {
    const es = [
      exp('2026-08-05', 1490, 'NETFLIX.COM'), exp('2026-09-05', 1490, 'NETFLIX.COM'), exp('2026-10-05', 1490, 'NETFLIX.COM'),
      exp('2026-08-11', 680, 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ'), exp('2026-08-20', 420, 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ'), exp('2026-09-02', 980, 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ'),
    ];
    const c = detectSubscriptions(es, []);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ name: 'NETFLIX.COM', cycle: 'monthly', amount: 1490, count: 3, lastDate: '2026-10-05', nextExpected: '2026-11-05' });
  });
  it('年に1回の同額は年額', () => {
    const es = [exp('2024-11-01', 4900, 'AMAZON PRIME'), exp('2025-11-01', 4900, 'AMAZON PRIME'), exp('2026-11-01', 5900, 'AMAZON PRIME')];
    const c = detectSubscriptions(es, []);
    expect(c[0]).toMatchObject({ cycle: 'yearly', count: 3 });
  });
  it('金額がばらばらなら定期請求とみなさないが、サブスクらしい店名なら候補に残す', () => {
    const es = [exp('2026-08-05', 1000, 'ANTHROPIC'), exp('2026-09-05', 3200, 'ANTHROPIC'), exp('2026-10-05', 500, 'ANTHROPIC')];
    const c = detectSubscriptions(es, []);
    expect(c).toHaveLength(1);
    expect(c[0].reason).toMatch(/不規則/);
    const d = detectSubscriptions([exp('2026-08-05', 1000, 'ヨドバシ'), exp('2026-09-05', 3200, 'ヨドバシ')], []);
    expect(d).toHaveLength(0);
  });
  it('既に台帳にある店（対象外を含む）は候補から外す', () => {
    const es = [exp('2026-09-05', 1490, 'NETFLIX.COM'), exp('2026-10-05', 1490, 'NETFLIX.COM')];
    expect(detectSubscriptions(es, [{ merchant_pattern: 'Netflix' }])).toHaveLength(0);
  });
  it('店名の無い手入力はメモで代用する', () => {
    const es = [exp('2026-09-01', 980, null, 'Spotify'), exp('2026-10-01', 980, null, 'Spotify')];
    expect(detectSubscriptions(es, [])[0]).toMatchObject({ name: 'Spotify', cycle: 'monthly' });
  });
});

describe('nextChargeDate / status', () => {
  it('月末を繰り越す', () => {
    expect(nextChargeDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextChargeDate('2026-11-05', 'monthly')).toBe('2026-12-05');
    expect(nextChargeDate('2026-02-28', 'yearly')).toBe('2027-02-28');
    expect(nextChargeDate('2026-02-28', 'other')).toBeNull();
  });
  it('予定日を過ぎた未請求と、解約後の請求を見つける', () => {
    const sub: Subscription = {
      id: 's', user_id: 'u', name: 'Netflix', merchant_pattern: 'netflix', amount: 1490, cycle: 'monthly', status: 'cancelled',
      category: null, started_on: null, cancelled_on: '2026-09-10', note: null, created_at: '', updated_at: '',
    };
    const es = [exp('2026-09-05', 1490, 'NETFLIX.COM'), exp('2026-10-05', 1490, 'NETFLIX.COM')];
    const charges = chargesFor(sub, es);
    const st = subscriptionStatus(sub, charges, '2026-11-09');
    expect(st.lastCharge?.date).toBe('2026-10-05');
    expect(st.nextExpected).toBe('2026-11-05');
    expect(st.overdueDays).toBe(4);
    expect(st.chargedAfterCancel?.date).toBe('2026-10-05');
  });
  it('月額換算', () => {
    expect(monthlyEquivalent(12000, 'yearly')).toBe(1000);
    expect(monthlyEquivalent(980, 'monthly')).toBe(980);
    expect(monthlyEquivalent(null, 'monthly')).toBe(0);
  });
});
