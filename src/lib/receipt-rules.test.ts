import { describe, it, expect } from 'vitest';
import {
  defaultCategoryForStore, guessCategory, guessPayment, normalizeName, reconcileItems,
} from '../../supabase/functions/_shared/receipt-rules';

const CATS = ['食費', '日用品', '交通費', '医療費', '娯楽費', '固定費', 'その他'];

describe('normalizeName', () => {
  it('半角カナを全角にし、濁点・半濁点を合成する', () => {
    expect(normalizeName('ｲｪﾏｯﾄ ｶﾝｺｸﾃﾞﾝﾄｳﾉﾘ')).toBe('イェマット カンコクデントウノリ');
    expect(normalizeName('7P 国産米ｺﾞﾊﾝ 5ｺｲﾘ')).toBe('7P 国産米ゴハン 5コイリ');
    expect(normalizeName('ﾊﾟﾝ')).toBe('パン');
  });
  it('全角英数は半角にし、空白を詰める', () => {
    expect(normalizeName('エピオス錠　２０００錠')).toBe('エピオス錠 2000錠');
  });
});

describe('guessCategory', () => {
  it('キーワードで医療費・日用品・交通費を当てる', () => {
    expect(guessCategory('エビオス錠 2000錠', null, CATS)).toBe('医療費');
    expect(guessCategory('7PL薬用シェービングフォーム', null, CATS)).toBe('日用品');
    expect(guessCategory('レジ袋', null, CATS)).toBe('日用品');
    expect(guessCategory('ICOCAチャージ', null, CATS)).toBe('交通費');
  });
  it('それ以外は店の種類で既定を決める', () => {
    expect(guessCategory('明治おいしい牛乳', 'スギ薬局 林寺店', CATS)).toBe('食費');
    expect(guessCategory('謎の商品', 'スギ薬局 林寺店', CATS)).toBe('日用品');
    expect(guessCategory('謎の商品', 'セブン-イレブン', CATS)).toBe('食費');
    expect(defaultCategoryForStore('ダイソー', ['食費', 'その他'])).toBe('その他');
  });
});

describe('guessPayment', () => {
  it('レシート全文から支払方法を推定する', () => {
    expect(guessPayment('合計 ¥1,721\nクレジット支払 ¥1,721\nクレジット売上票')).toBe('クレジット');
    expect(guessPayment('iD支払 ********')).toBe('電子マネー');
    expect(guessPayment('電子金券② ¥8,253')).toBe('電子マネー');
    expect(guessPayment('お預り ¥2,000 お釣り ¥279')).toBe('現金');
    expect(guessPayment('合計 ¥500')).toBeNull();
  });
});

describe('reconcileItems', () => {
  it('明細合計が合計と一致すればそのまま', () => {
    const r = reconcileItems([{ name: 'A', amount: 100 }, { name: 'B', amount: 200 }], 300, null);
    expect(r.items.map((i) => i.amount)).toEqual([100, 200]);
    expect(r.note).toBeNull();
  });

  it('値引行は直前の品目から引く', () => {
    const r = reconcileItems([{ name: '五目あんかけ焼そば', amount: 550 }, { name: '値引額', amount: -50 }], 500, null);
    expect(r.items).toEqual([{ name: '五目あんかけ焼そば', amount: 500 }]);
  });

  it('税抜表示は * 印で 8% / 10% を掛け、端数を最後の品目で合わせる（セブンのレシート）', () => {
    const r = reconcileItems([
      { name: '明治おいしい牛乳900ml', amount: 314, line: '明治おいしい牛乳900ml *314' },
      { name: 'ｶﾝｺｸﾃﾞﾝﾄｳﾉﾘ', amount: 118, line: 'ｶﾝｺｸﾃﾞﾝﾄｳﾉﾘ *118' },
      { name: '薬用シェービングフォーム', amount: 400, line: '7PL薬用シェービングフォーム220 400' },
      { name: '国産米ゴハン 5コイリ', amount: 750, line: '7P 国産米ｺﾞﾊﾝ 5ｺｲﾘ *750' },
      { name: 'レジ袋', amount: 5, line: 'バイオ30レジ袋特大1枚 5' },
    ], 1721, 134);
    expect(r.items.map((i) => i.amount)).toEqual([339, 127, 440, 810, 5]);
    expect(r.items.reduce((s, i) => s + i.amount, 0)).toBe(1721);
    expect(r.note).toMatch(/8%/);
  });

  it('税率の印が無ければ合計との比で按分する', () => {
    const r = reconcileItems([{ name: 'A', amount: 500 }, { name: 'B', amount: 500 }], 1080, 80);
    expect(r.items.reduce((s, i) => s + i.amount, 0)).toBe(1080);
    expect(r.note).toMatch(/按分/);
  });

  it('説明がつかないずれは触らず note に書く', () => {
    const r = reconcileItems([{ name: 'A', amount: 100 }], 1000, null);
    expect(r.items[0].amount).toBe(100);
    expect(r.note).toMatch(/一致しません/);
  });
});

describe('mapAzureResult', () => {
  it('Azure の結果を家計簿向けに整える（値引・税込換算・カテゴリ・支払方法）', async () => {
    const { mapAzureResult } = await import('../../supabase/functions/_shared/azure-receipt');
    const cur = (amount: number, content = String(amount)) => ({ type: 'currency', content, valueCurrency: { amount, currencyCode: 'JPY' } });
    const item = (desc: string, price: number, line: string) => ({
      type: 'object', content: line,
      valueObject: { Description: { type: 'string', valueString: desc, content: desc }, TotalPrice: cur(price) },
    });
    const r = mapAzureResult({
      status: 'succeeded',
      analyzeResult: {
        content: 'セブン-イレブン ... 合計 ¥957 クレジット支払 ¥957 クレジット売上票',
        documents: [{
          fields: {
            MerchantName: { type: 'string', valueString: 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 大阪林寺2丁目店' },
            TransactionDate: { type: 'date', valueDate: '2026-09-28' },
            Total: cur(957),
            TotalTax: cur(70),
            Items: {
              type: 'array',
              valueArray: [
                item('五目あんかけ焼そば', 550, '五目あんかけ焼そば *550'),
                item('値引額', -50, '値引額 -50'),
                item('ﾓﾁﾓﾁ食感ﾄﾞｰﾅﾂ ｷﾅｺ', 128, 'ﾓﾁﾓﾁ食感ﾄﾞｰﾅﾂ ｷﾅｺ *128'),
                item('ｻﾞﾊﾞｽのむYGﾍﾞﾘｰﾐｯｸｽ250', 259, 'ｻﾞﾊﾞｽのむYGﾍﾞﾘｰﾐｯｸｽ250 *259'),
              ],
            },
          },
        }],
      },
    }, CATS);
    expect(r.store).toBe('セブン-イレブン 大阪林寺2丁目店');
    expect(r.date).toBe('2026-09-28');
    expect(r.total).toBe(957);
    expect(r.payment_method).toBe('クレジット');
    expect(r.items.map((i) => i.name)).toEqual(['五目あんかけ焼そば', 'モチモチ食感ドーナツ キナコ', 'ザバスのむYGベリーミックス250']);
    expect(r.items.reduce((s, i) => s + i.amount, 0)).toBe(957);
    expect(r.items.every((i) => i.category === '食費')).toBe(true);
    expect(r.notes).toMatch(/8%/);
  });
});
