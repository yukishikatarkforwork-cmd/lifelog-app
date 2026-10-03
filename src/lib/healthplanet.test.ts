import { describe, it, expect } from 'vitest';
import {
  HP_TAG_PARAM, formatHpDateTime, parseHpDate, parseInnerscan, splitWindows,
} from '../../supabase/functions/_shared/healthplanet-parse';
import { formatBodyLine } from './export';
import type { BodyRecord } from './types';

describe('parseHpDate', () => {
  it('yyyyMMddHHmm を日付と JST の ISO 文字列にする', () => {
    expect(parseHpDate('202604010712')).toEqual({ date: '2026-04-01', iso: '2026-04-01T07:12:00+09:00' });
  });
  it('秒付きも受け付ける', () => {
    expect(parseHpDate('20260401071230')?.iso).toBe('2026-04-01T07:12:30+09:00');
  });
  it('形式が違えば null', () => {
    expect(parseHpDate('2026-04-01')).toBeNull();
    expect(parseHpDate('')).toBeNull();
  });
});

describe('parseInnerscan', () => {
  it('同じ時刻の体重と体脂肪率を1回の測定に束ねる', () => {
    const out = parseInnerscan({
      data: [
        { date: '202604010712', keydata: '65.20', tag: '6021' },
        { date: '202604010712', keydata: '18.5', tag: '6022' },
        { date: '202604010712', keydata: '1480', tag: '6027' },
      ],
    });
    expect(out).toEqual([{
      date: '2026-04-01', measured_at: '2026-04-01T07:12:00+09:00',
      weight_kg: 65.2, body_fat_pct: 18.5, muscle_kg: null, visceral_fat_level: null,
      basal_metabolism_kcal: 1480, body_age: null, bone_kg: null,
    }]);
  });

  it('同じ日に複数回測ったら最初の測定を採用する', () => {
    const out = parseInnerscan({
      data: [
        { date: '202604012230', keydata: '66.00', tag: '6021' }, // 夜（食後）
        { date: '202604010712', keydata: '65.20', tag: '6021' }, // 朝
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].weight_kg).toBe(65.2);
    expect(out[0].measured_at).toBe('2026-04-01T07:12:00+09:00');
  });

  it('日付昇順に並び、知らないタグや壊れた値は無視する', () => {
    const out = parseInnerscan({
      data: [
        { date: '202604030700', keydata: '64.9', tag: '6021' },
        { date: '202604010700', keydata: '65.2', tag: '6021' },
        { date: '202604020700', keydata: 'abc', tag: '6021' },   // 数値でない
        { date: '202604020700', keydata: '50', tag: '6024' },    // 筋肉スコアは取り込まない
        { date: 'bad', keydata: '1', tag: '6021' },
      ],
    });
    expect(out.map((m) => m.date)).toEqual(['2026-04-01', '2026-04-03']);
  });

  it('data が無ければ空', () => {
    expect(parseInnerscan({})).toEqual([]);
  });

  it('tag パラメータは取り込む項目をすべて含む', () => {
    expect(HP_TAG_PARAM.split(',')).toEqual(expect.arrayContaining(['6021', '6022', '6023', '6026', '6027', '6028', '6029']));
  });
});

describe('formatHpDateTime', () => {
  it('UTC の時刻を日本時間の yyyyMMddHHmmss にする', () => {
    expect(formatHpDateTime(new Date('2026-03-31T23:30:05Z'))).toBe('20260401083005');
  });
});

describe('splitWindows', () => {
  const day = 24 * 60 * 60 * 1000;
  it('90日以内なら1つの窓', () => {
    const to = new Date('2026-04-01T00:00:00Z');
    const from = new Date(to.getTime() - 10 * day);
    expect(splitWindows(from, to)).toEqual([{ from, to }]);
  });
  it('長期間は新しい側から90日ごとに切り、隙間なくつながる', () => {
    const to = new Date('2026-04-01T00:00:00Z');
    const from = new Date(to.getTime() - 200 * day);
    const w = splitWindows(from, to);
    expect(w).toHaveLength(3);
    expect(w[0].to).toEqual(to);
    expect(w[w.length - 1].from).toEqual(from);
    for (let i = 1; i < w.length; i++) expect(w[i].to).toEqual(w[i - 1].from);
  });
  it('from が to 以降なら空', () => {
    const d = new Date('2026-04-01T00:00:00Z');
    expect(splitWindows(d, d)).toEqual([]);
  });
});

describe('formatBodyLine', () => {
  const base: BodyRecord = {
    user_id: 'u', date: '2026-04-01', weight_kg: null, body_fat_pct: null, muscle_kg: null,
    visceral_fat_level: null, basal_metabolism_kcal: null, body_age: null, bone_kg: null,
    measured_at: null, source: 'manual', memo: null,
  };
  it('ある項目だけを並べる', () => {
    expect(formatBodyLine({ ...base, weight_kg: 65.2, body_fat_pct: 18.5 })).toBe('体重 65.2kg / 体脂肪率 18.5%');
  });
  it('何も無ければ null', () => {
    expect(formatBodyLine(base)).toBeNull();
  });
});
