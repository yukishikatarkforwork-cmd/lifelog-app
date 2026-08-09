import { describe, it, expect } from 'vitest';
import { tripDates, tripLengthLabel } from './trips';

describe('tripDates', () => {
  it('開始日と終了日を含む連続した日付を返す', () => {
    expect(tripDates({ start_date: '2026-06-08', end_date: '2026-06-10' }))
      .toEqual(['2026-06-08', '2026-06-09', '2026-06-10']);
  });

  it('日帰りは1日だけ', () => {
    expect(tripDates({ start_date: '2026-06-08', end_date: '2026-06-08' })).toEqual(['2026-06-08']);
  });

  it('月をまたいでも正しく数える', () => {
    expect(tripDates({ start_date: '2026-01-30', end_date: '2026-02-02' }))
      .toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  });

  it('うるう年の2月をまたげる', () => {
    expect(tripDates({ start_date: '2028-02-28', end_date: '2028-03-01' }))
      .toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('終了日が開始日より前でも無限ループしない', () => {
    expect(tripDates({ start_date: '2026-06-10', end_date: '2026-06-08' })).toEqual([]);
  });

  it('極端に長い期間でも打ち切られる（暴走しない）', () => {
    const dates = tripDates({ start_date: '2026-01-01', end_date: '2030-01-01' });
    expect(dates.length).toBeLessThanOrEqual(61);
  });
});

describe('tripLengthLabel', () => {
  it('日帰り', () => {
    expect(tripLengthLabel({ start_date: '2026-06-08', end_date: '2026-06-08' })).toBe('日帰り');
  });

  it('2泊3日', () => {
    expect(tripLengthLabel({ start_date: '2026-06-08', end_date: '2026-06-10' })).toBe('2泊3日');
  });

  it('1泊2日', () => {
    expect(tripLengthLabel({ start_date: '2026-06-08', end_date: '2026-06-09' })).toBe('1泊2日');
  });
});
