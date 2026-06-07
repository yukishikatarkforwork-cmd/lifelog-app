import { describe, it, expect } from 'vitest';
import { sumNutrition, pfcKcal, fmt, parseNum, EMPTY_NUTRITION } from './nutrition';

describe('sumNutrition', () => {
  it('空配列はすべて 0', () => {
    expect(sumNutrition([])).toEqual(EMPTY_NUTRITION);
  });

  it('null/undefined を 0 として扱う', () => {
    const result = sumNutrition([
      { calories: 100, protein: 10, fat: null, carbohydrate: undefined },
      null,
      undefined,
      { calories: 50, protein: null, fat: 5, carbohydrate: 20 },
    ]);
    expect(result).toEqual({ calories: 150, protein: 10, fat: 5, carbohydrate: 20 });
  });

  it('複数食品の栄養素を合算する', () => {
    const result = sumNutrition([
      { calories: 200, protein: 20, fat: 5, carbohydrate: 30 },
      { calories: 300, protein: 15, fat: 10, carbohydrate: 40 },
    ]);
    expect(result).toEqual({ calories: 500, protein: 35, fat: 15, carbohydrate: 70 });
  });
});

describe('pfcKcal', () => {
  it('P×4 / F×9 / C×4 で kcal 換算する', () => {
    expect(pfcKcal({ calories: 0, protein: 10, fat: 10, carbohydrate: 10 })).toEqual({
      protein: 40,
      fat: 90,
      carbohydrate: 40,
    });
  });
});

describe('fmt', () => {
  it('整数は小数点なし', () => {
    expect(fmt(150)).toBe('150');
  });
  it('小数は1桁に丸める', () => {
    expect(fmt(12.345)).toBe('12.3');
    expect(fmt(12.0)).toBe('12');
  });
});

describe('parseNum', () => {
  it('空文字は null', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum('   ')).toBeNull();
  });
  it('前後の空白を無視して数値に変換', () => {
    expect(parseNum(' 12.5 ')).toBe(12.5);
    expect(parseNum('0')).toBe(0);
  });
  it('数値でない文字列は null', () => {
    expect(parseNum('abc')).toBeNull();
  });
});
