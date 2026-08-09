import { describe, it, expect } from 'vitest';
import { toCSV, toMarkdown, toExpensesCSV, toDailyMarkdown } from './export';
import type { DailyRecord, DiaryEntry, Expense, MealEntry, MealType, Photo, WeatherRecord } from './types';

function entry(p: Partial<MealEntry>): MealEntry {
  return {
    id: p.id ?? 'id',
    user_id: 'u',
    date: p.date ?? '2026-06-08',
    meal_type: (p.meal_type ?? 'breakfast') as MealType,
    food_name: p.food_name ?? '納豆',
    amount: p.amount ?? null,
    calories: p.calories ?? null,
    protein: p.protein ?? null,
    fat: p.fat ?? null,
    carbohydrate: p.carbohydrate ?? null,
    memo: p.memo ?? null,
    tags: p.tags ?? [],
    created_at: '',
    updated_at: '',
  };
}

describe('toCSV', () => {
  it('ヘッダー行を含む', () => {
    expect(toCSV([]).split('\r\n')[0]).toBe(
      'date,meal_type,food_name,amount,calories,protein,fat,carbohydrate,memo,tags',
    );
  });

  it('値を出力し、null は空、tags は | 連結', () => {
    const csv = toCSV([entry({ food_name: '卵', calories: 78, protein: 6.7, tags: ['自炊', '高たんぱく'] })]);
    const line = csv.split('\r\n')[1];
    expect(line).toBe('2026-06-08,breakfast,卵,,78,6.7,,,,自炊|高たんぱく');
  });

  it('カンマ・引用符・改行を含む値はエスケープする', () => {
    const csv = toCSV([entry({ food_name: 'りんご, 半分', memo: '美味しい"よ"\n満足' })]);
    const line = csv.split('\r\n')[1];
    expect(line).toContain('"りんご, 半分"');
    expect(line).toContain('"美味しい""よ""\n満足"');
  });
});

describe('toMarkdown', () => {
  it('記録なしは見出しと（記録なし）', () => {
    const md = toMarkdown([]);
    expect(md).toContain('# 食事記録');
    expect(md).toContain('（記録なし）');
  });

  it('日付見出し・合計・表行を出力する', () => {
    const md = toMarkdown([
      entry({ meal_type: 'breakfast', food_name: '納豆', calories: 95, protein: 7, fat: 5, carbohydrate: 12 }),
      entry({ meal_type: 'lunch', food_name: 'ご飯', calories: 281, protein: 4, fat: 0, carbohydrate: 60 }),
    ]);
    expect(md).toContain('## 6/8(月) (2026-06-08)');
    expect(md).toContain('合計: 376 kcal / P 11 / F 5 / C 72 g');
    expect(md).toContain('| 朝食 | 納豆 |');
    expect(md).toContain('| 昼食 | ご飯 |');
  });

  it('複数日は日付昇順で並ぶ', () => {
    const md = toMarkdown([
      entry({ date: '2026-06-09', food_name: 'B' }),
      entry({ date: '2026-06-07', food_name: 'A' }),
    ]);
    expect(md.indexOf('2026-06-07')).toBeLessThan(md.indexOf('2026-06-09'));
  });
});

function expense(p: Partial<Expense>): Expense {
  return {
    id: p.id ?? 'e', user_id: 'u', date: p.date ?? '2026-06-08',
    amount: p.amount ?? 0, category: p.category ?? '食費',
    payment_method: p.payment_method ?? null, memo: p.memo ?? null,
    created_at: '', updated_at: '',
  };
}

describe('toExpensesCSV', () => {
  it('ヘッダーと行を出力する', () => {
    const csv = toExpensesCSV([expense({ amount: 1200, category: '食費', payment_method: '現金' })]);
    const [head, row] = csv.split('\r\n');
    expect(head).toBe('date,amount,category,payment_method,memo');
    expect(row).toBe('2026-06-08,1200,食費,現金,');
  });
});

describe('toDailyMarkdown', () => {
  const condition: DailyRecord = {
    user_id: 'u', date: '2026-06-08', condition_score: 4, mood_score: 3,
    sleep_hours: 7, headache: true, medication: false, memo: '低気圧ぎみ',
  };
  const weather: WeatherRecord = {
    user_id: 'u', date: '2026-06-08', weather: 'rainy',
    pressure_hpa: 1004, temperature: 21, humidity: 70, memo: null,
  };

  it('日別に体調・天気・食事・家計簿をまとめる', () => {
    const md = toDailyMarkdown({
      meals: [{
        id: 'm', user_id: 'u', date: '2026-06-08', meal_type: 'breakfast' as MealType,
        food_name: '納豆', amount: null, calories: 95, protein: 7, fat: 5, carbohydrate: 12,
        memo: null, tags: [], created_at: '', updated_at: '',
      }],
      conditions: [condition],
      weathers: [weather],
      expenses: [expense({ amount: 1200, category: '食費', payment_method: '現金' })],
    });
    expect(md).toContain('## 6/8(月) (2026-06-08)');
    expect(md).toContain('**体調**: 体調 4/5 / 気分 3/5 / 睡眠 7h / 頭痛あり');
    expect(md).toContain('**天気・気圧**: 雨 / 1004hPa / 21℃ / 湿度70%');
    expect(md).toContain('**食事**: 合計 95 kcal');
    expect(md).toContain('**家計簿**: 合計 ¥1,200');
    expect(md).toContain('- 食費 ¥1,200（現金）');
  });

  it('記録なしは（記録なし）', () => {
    expect(toDailyMarkdown({ meals: [], conditions: [], weathers: [], expenses: [] })).toContain('（記録なし）');
  });
});


function diary(p: Partial<DiaryEntry>): DiaryEntry {
  return {
    user_id: 'u',
    date: p.date ?? '2026-06-08',
    title: p.title ?? null,
    body: p.body ?? '',
    tags: p.tags ?? [],
  };
}

const emptyData = { meals: [], conditions: [] as DailyRecord[], weathers: [] as WeatherRecord[], expenses: [] as Expense[] };

describe('toDailyMarkdown - 日記', () => {
  it('日記の日付・タイトル・タグ・本文を出力する', () => {
    const md = toDailyMarkdown({
      ...emptyData,
      diaries: [diary({ date: '2026-06-08', title: '江ノ島に行った', body: '海がきれいだった', tags: ['おでかけ'] })],
    });
    expect(md).toContain('2026-06-08');
    expect(md).toContain('**日記**: 江ノ島に行った');
    expect(md).toContain('タグ: おでかけ');
    expect(md).toContain('> 海がきれいだった');
  });

  it('本文の複数行は各行を引用にして、日付見出しと混ざらないようにする', () => {
    const md = toDailyMarkdown({ ...emptyData, diaries: [diary({ body: '一行目\n## 見出しっぽい行' })] });
    expect(md).toContain('> 一行目');
    expect(md).toContain('> ## 見出しっぽい行');
  });

  it('本文もタイトルも空の日記は出力しない', () => {
    const md = toDailyMarkdown({ ...emptyData, diaries: [diary({ body: '   ' })] });
    expect(md).not.toContain('**日記**');
  });

  it('日記しかない日付も日別セクションに現れる', () => {
    const md = toDailyMarkdown({ ...emptyData, diaries: [diary({ date: '2026-07-01', body: 'メモ' })] });
    expect(md).toContain('(2026-07-01)');
    expect(md).not.toContain('（記録なし）');
  });

  it('diaries を渡さなくても従来どおり動く（後方互換）', () => {
    const md = toDailyMarkdown(emptyData);
    expect(md).toContain('（記録なし）');
  });
});


function photo(p: Partial<Photo>): Photo {
  return {
    id: p.id ?? crypto.randomUUID(),
    user_id: 'u',
    date: p.date ?? '2026-06-08',
    storage_path: p.storage_path ?? 'u/2026-06-08/a.webp',
    caption: p.caption ?? null,
    width: 1600, height: 1200, size_bytes: 200_000,
  };
}

describe('toDailyMarkdown - 写真', () => {
  it('枚数を出力する', () => {
    const md = toDailyMarkdown({ ...emptyData, photos: [photo({}), photo({ storage_path: 'u/2026-06-08/b.webp' })] });
    expect(md).toContain('**写真**: 2 枚');
  });

  it('キャプションがあれば併記する（AIの手がかりになるため）', () => {
    const md = toDailyMarkdown({ ...emptyData, photos: [photo({ caption: '江ノ島の夕日' })] });
    expect(md).toContain('江ノ島の夕日');
  });

  it('キャプションが空のものは括弧に含めない', () => {
    const md = toDailyMarkdown({
      ...emptyData,
      photos: [photo({ caption: '  ' }), photo({ storage_path: 'u/2026-06-08/b.webp', caption: 'ラーメン' })],
    });
    expect(md).toContain('**写真**: 2 枚（ラーメン）');
  });

  it('写真しかない日付も日別セクションに現れる', () => {
    const md = toDailyMarkdown({ ...emptyData, photos: [photo({ date: '2026-08-01' })] });
    expect(md).toContain('(2026-08-01)');
    expect(md).not.toContain('（記録なし）');
  });

  it('photos を渡さなくても従来どおり動く（後方互換）', () => {
    expect(toDailyMarkdown(emptyData)).toContain('（記録なし）');
  });
});
