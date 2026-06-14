import { describe, it, expect } from 'vitest';
import { mean, pearson, correlationLabel } from './analysis';

describe('mean', () => {
  it('平均を返す / 空は null', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(mean([])).toBeNull();
  });
});

describe('pearson', () => {
  it('完全な正の相関は 1', () => {
    expect(pearson([[1, 2], [2, 4], [3, 6]])).toBeCloseTo(1, 5);
  });
  it('完全な負の相関は -1', () => {
    expect(pearson([[1, 6], [2, 4], [3, 2]])).toBeCloseTo(-1, 5);
  });
  it('データ点が3未満は null', () => {
    expect(pearson([[1, 2], [2, 4]])).toBeNull();
  });
  it('分散0（定数）は null', () => {
    expect(pearson([[1, 5], [2, 5], [3, 5]])).toBeNull();
  });
});

describe('correlationLabel', () => {
  it('強さと符号をラベル化する', () => {
    expect(correlationLabel(0.1)).toBe('ほぼ相関なし');
    expect(correlationLabel(-0.5)).toBe('中程度の負の相関');
    expect(correlationLabel(0.8)).toBe('強い正の相関');
    expect(correlationLabel(-0.3)).toBe('弱い負の相関');
  });
});
