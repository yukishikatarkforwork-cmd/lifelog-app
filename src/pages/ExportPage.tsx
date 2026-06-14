import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { DailyRecord, Expense, MealEntry, WeatherRecord } from '../lib/types';
import { addDays, todayStr } from '../lib/date';
import { toCSV, toExpensesCSV, toDailyMarkdown } from '../lib/export';

// Excel が UTF-8 の日本語を正しく開けるよう先頭に付ける BOM マーカー
const BOM = String.fromCharCode(0xfeff);

function download(filename: string, content: string, mime: string, bom = false) {
  const blob = new Blob([bom ? BOM + content : content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportPage() {
  const [start, setStart] = useState(addDays(todayStr(), -29));
  const [end, setEnd] = useState(todayStr());
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [conditions, setConditions] = useState<DailyRecord[]>([]);
  const [weathers, setWeathers] = useState<WeatherRecord[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [m, c, w, e] = await Promise.all([
      supabase.from('meal_entries').select('*').gte('date', start).lte('date', end).order('date').order('created_at'),
      supabase.from('daily_records').select('*').gte('date', start).lte('date', end),
      supabase.from('weather_records').select('*').gte('date', start).lte('date', end),
      supabase.from('expenses').select('*').gte('date', start).lte('date', end).order('date').order('created_at'),
    ]);
    const err = m.error || c.error || w.error || e.error;
    if (err) setError(err.message);
    setMeals((m.data as MealEntry[]) ?? []);
    setConditions((c.data as DailyRecord[]) ?? []);
    setWeathers((w.data as WeatherRecord[]) ?? []);
    setExpenses((e.data as Expense[]) ?? []);
    setLoading(false);
  }, [start, end]);

  useEffect(() => { void load(); }, [load]);

  const title = `生活記録 ${start} 〜 ${end}`;
  const md = useMemo(
    () => toDailyMarkdown({ meals, conditions, weathers, expenses }, title),
    [meals, conditions, weathers, expenses, title],
  );

  const hasAny = meals.length + conditions.length + weathers.length + expenses.length > 0;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('クリップボードへのコピーに失敗しました。');
    }
  };

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>データ出力</h2>

      <div className="card">
        <div className="grid-2">
          <div className="field">
            <label>開始日</label>
            <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label>終了日</label>
            <input type="date" value={end} min={start} max={todayStr()} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {loading ? '読み込み中…' : `食事 ${meals.length} / 体調 ${conditions.length} / 天気 ${weathers.length} / 支出 ${expenses.length} 件`}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h2>統合 Markdown（AI 分析向け）</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>体調・天気気圧・食事・家計簿を日別にまとめます。</p>
        <div className="stack-sm">
          <button className="btn full" disabled={!hasAny} onClick={() => download(`lifelog-${start}_${end}.md`, md, 'text/markdown;charset=utf-8')}>
            Markdown をダウンロード
          </button>
          <button className="btn outline full" disabled={!hasAny} onClick={onCopy}>
            {copied ? 'コピーしました ✓' : 'Markdown をコピー'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>CSV ダウンロード</h2>
        <div className="stack-sm">
          <button className="btn outline full" disabled={meals.length === 0} onClick={() => download(`lifelog-meals-${start}_${end}.csv`, toCSV(meals), 'text/csv;charset=utf-8', true)}>
            食事 CSV
          </button>
          <button className="btn outline full" disabled={expenses.length === 0} onClick={() => download(`lifelog-expenses-${start}_${end}.csv`, toExpensesCSV(expenses), 'text/csv;charset=utf-8', true)}>
            家計簿 CSV
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Markdown プレビュー</h2>
        <textarea readOnly value={md} style={{ width: '100%', minHeight: 240, fontFamily: 'monospace', fontSize: 12 }} />
      </div>
    </div>
  );
}
