import { describe, it, expect } from 'vitest';
import { guessMerchantCategory, looksLikeSubscription, merchantMatches, normalizeMerchant } from './merchant';

const CATS = ['食費', '日用品', '交通費', '医療費', '娯楽費', '固定費', 'その他'];

describe('normalizeMerchant / merchantMatches', () => {
  it('半角カナ・空白・数字・店舗名の差を吸収する', () => {
    expect(normalizeMerchant('ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 林寺店')).toBe('セブンイレブン林寺店');
    expect(normalizeMerchant('NETFLIX.COM')).toBe('netflixcom');
    expect(normalizeMerchant('(株)ローソン 12345')).toBe('ローソン');
    expect(normalizeMerchant(null)).toBe('');
  });
  it('パターンは正規化後の部分一致', () => {
    expect(merchantMatches('NETFLIX.COM 866-579-7172', 'Netflix')).toBe(true);
    expect(merchantMatches('ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 林寺店', 'セブンイレブン')).toBe(true);
    expect(merchantMatches('ローソン', 'セブン')).toBe(false);
    expect(merchantMatches('何か', '')).toBe(false);
  });
});

describe('guessMerchantCategory', () => {
  it('ユーザーの学習ルールを最優先する', () => {
    expect(guessMerchantCategory('AMAZON.CO.JP', [{ pattern: 'amazon', category: '娯楽費' }], CATS)).toBe('娯楽費');
  });
  it('既知の店名で当てる', () => {
    expect(guessMerchantCategory('ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ 林寺店', [], CATS)).toBe('食費');
    expect(guessMerchantCategory('NETFLIX.COM', [], CATS)).toBe('娯楽費');
    expect(guessMerchantCategory('ＮＴＴドコモ', [], CATS)).toBe('固定費');
    expect(guessMerchantCategory('ENEOS ｾﾙﾌ○○SS', [], CATS)).toBe('交通費');
    expect(guessMerchantCategory('ウエルシア薬局', [], CATS)).toBe('日用品');
    expect(guessMerchantCategory('○○歯科クリニック', [], CATS)).toBe('医療費');
    expect(guessMerchantCategory('APPLE.COM/BILL', [], CATS)).toBe('固定費');
  });
  it('分からない店はその他（食費に寄せない）', () => {
    expect(guessMerchantCategory('AMAZON.CO.JP', [], CATS)).toBe('その他');
    expect(guessMerchantCategory('ﾗｸﾃﾝｲﾁﾊﾞ', [], CATS)).toBe('その他');
  });
  it('候補に無いカテゴリは返さない', () => {
    expect(guessMerchantCategory('NETFLIX.COM', [], ['食費', 'その他'])).toBe('その他');
  });
});

describe('looksLikeSubscription', () => {
  it('サブスクでよくある店名を拾う', () => {
    expect(looksLikeSubscription('NETFLIX.COM')).toBe(true);
    expect(looksLikeSubscription('Spotify')).toBe(true);
    expect(looksLikeSubscription('チョコザップ')).toBe(true);
    expect(looksLikeSubscription('ANTHROPIC')).toBe(true);
    expect(looksLikeSubscription('ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ')).toBe(false);
    expect(looksLikeSubscription('')).toBe(false);
  });
});
