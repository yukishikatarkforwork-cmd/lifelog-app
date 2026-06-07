import { describe, it, expect } from 'vitest';
import { toDateStr, addDays, formatShort, formatDisplay } from './date';

describe('toDateStr', () => {
  it('ローカル日付を YYYY-MM-DD で返す（月は2桁ゼロ埋め）', () => {
    expect(toDateStr(new Date(2026, 5, 8))).toBe('2026-06-08'); // 月は0始まり=6月
    expect(toDateStr(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

describe('addDays', () => {
  it('翌日・前日を返す', () => {
    expect(addDays('2026-06-08', 1)).toBe('2026-06-09');
    expect(addDays('2026-06-08', -1)).toBe('2026-06-07');
  });
  it('月またぎを正しく処理する', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });
  it('年またぎを正しく処理する', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('formatShort / formatDisplay', () => {
  it('曜日付きの表示文字列を返す（2026-06-08 は月曜）', () => {
    expect(formatShort('2026-06-08')).toBe('6/8(月)');
    expect(formatDisplay('2026-06-08')).toBe('2026年6月8日(月)');
  });
});
