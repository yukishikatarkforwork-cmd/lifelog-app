import { describe, it, expect } from 'vitest';
import { normalizeReceipt, receiptSchema } from '../../supabase/functions/_shared/receipt';
import { itemsTotalDiff } from './receipt';

const CATS = ['食費', '日用品', 'その他'];

describe('normalizeReceipt', () => {
  it('数値が文字列でも整数に直し、候補に無いカテゴリは先頭に倒す', () => {
    const r = normalizeReceipt({
      store: ' セブンイレブン ', date: '2026-10-03', total: '1,721', payment_method: 'クレジット',
      items: [
        { name: '明治おいしい牛乳', amount: '339.1', category: '食費' },
        { name: 'レジ袋', amount: 5.4, category: '雑貨' },
      ],
      notes: '',
    }, CATS);
    expect(r.store).toBe('セブンイレブン');
    expect(r.total).toBe(1721);
    expect(r.payment_method).toBe('クレジット');
    expect(r.items).toEqual([
      { name: '明治おいしい牛乳', amount: 339, category: '食費' },
      { name: 'レジ袋', amount: 5, category: '食費' },
    ]);
    expect(r.notes).toBeNull();
  });

  it('品名が空・金額が読めない行は捨て、日付や支払方法が不正なら null', () => {
    const r = normalizeReceipt({
      date: '2026/10/03', payment_method: 'PayPay', total: null,
      items: [{ name: '', amount: 100, category: '食費' }, { name: 'x', amount: 'abc', category: '食費' }],
    }, CATS);
    expect(r.items).toEqual([]);
    expect(r.date).toBeNull();
    expect(r.payment_method).toBeNull();
    expect(r.total).toBeNull();
  });

  it('壊れた入力でも落ちない', () => {
    expect(normalizeReceipt(null, CATS).items).toEqual([]);
    expect(normalizeReceipt('x', CATS).store).toBeNull();
  });

  it('スキーマはカテゴリ候補を enum に埋め込み、全項目を required にする', () => {
    const s = receiptSchema(CATS) as { required: string[]; properties: { items: { items: { properties: { category: { enum: string[] } }; required: string[] } } } };
    expect(s.required).toEqual(['store', 'date', 'total', 'payment_method', 'items', 'notes']);
    expect(s.properties.items.items.properties.category.enum).toEqual(CATS);
    expect(s.properties.items.items.required).toEqual(['name', 'amount', 'category']);
  });
});

describe('itemsTotalDiff', () => {
  it('明細合計とレシート合計の差を返す。合計が無ければ null', () => {
    expect(itemsTotalDiff([{ amount: 100 }, { amount: 250 }], 350)).toBe(0);
    expect(itemsTotalDiff([{ amount: 100 }], 120)).toBe(-20);
    expect(itemsTotalDiff([{ amount: 100 }], null)).toBeNull();
  });
});
