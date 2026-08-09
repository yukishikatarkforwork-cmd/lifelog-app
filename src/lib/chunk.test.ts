import { describe, it, expect } from 'vitest';
import { chunkText } from '../../supabase/functions/_shared/chunk';
import { sampleDates } from './sampleData';

describe('chunkText', () => {
  it('空文字は0件', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('短い文章は分割せず1件のまま返す', () => {
    const text = '今日は江ノ島に行った。海がきれいだった。';
    expect(chunkText(text)).toEqual([text]);
  });

  it('前後の空白を落とす', () => {
    expect(chunkText('  本文  ')).toEqual(['本文']);
  });

  it('長い文章を分割し、全チャンクが上限以内に収まる', () => {
    const text = 'あ'.repeat(1000);
    const chunks = chunkText(text, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });

  it('分割しても内容が失われない（連結すると元の文字をすべて含む）', () => {
    const text = 'あいうえお'.repeat(200);
    const chunks = chunkText(text, 100, 20);
    // 重なりがあるぶん長くなるが、元より短くなってはいけない
    expect(chunks.join('').length).toBeGreaterThanOrEqual(text.length);
  });

  it('句点で切れる位置があればそこで切る', () => {
    const head = 'あ'.repeat(70);
    const chunks = chunkText(`${head}。${'い'.repeat(200)}`, 100, 20);
    expect(chunks[0]).toBe(`${head}。`);
  });

  it('改行でも切れる', () => {
    const head = 'あ'.repeat(70);
    const chunks = chunkText(`${head}\n${'い'.repeat(200)}`, 100, 20);
    expect(chunks[0]).toBe(head);
  });

  it('重なりが幅以上でも無限ループしない', () => {
    // overlap >= size は設定ミスだが、返ってこなくなるのが最悪なので前進を保証する
    const chunks = chunkText('あ'.repeat(500), 50, 999);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(500);
  });

  it('句点が前半にしかない場合はそこでは切らない（細切れを避ける）', () => {
    const chunks = chunkText(`あ。${'い'.repeat(300)}`, 100, 20);
    expect(chunks[0].length).toBe(100);
  });
});

describe('sampleDates', () => {
  it('YYYY-MM-DD 形式で重複なく返る', () => {
    const dates = sampleDates();
    expect(dates.length).toBeGreaterThan(0);
    expect(new Set(dates).size).toBe(dates.length);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('すべて過去の日付（未来の記録を作らない）', () => {
    const today = new Date();
    for (const d of sampleDates()) {
      expect(new Date(`${d}T00:00:00`).getTime()).toBeLessThan(today.getTime());
    }
  });
});
