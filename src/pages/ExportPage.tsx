import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { BodyRecord, DailyRecord, DiaryEntry, Expense, LinkEntry, MealEntry, Photo, WeatherRecord } from '../lib/types';
import { addDays, todayStr } from '../lib/date';
import { toBodyCSV, toCSV, toExpensesCSV, toDailyMarkdown } from '../lib/export';
import { useReload } from '../lib/useReload';
import { useAuth } from '../context/AuthContext';
import { fetchAllRows } from '../lib/fetchAll';

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
  const { user } = useAuth();
  const [start, setStart] = useState(addDays(todayStr(), -29));
  const [end, setEnd] = useState(todayStr());
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [conditions, setConditions] = useState<DailyRecord[]>([]);
  const [weathers, setWeathers] = useState<WeatherRecord[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [links, setLinks] = useState<LinkEntry[]>([]);
  const [bodies, setBodies] = useState<BodyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useReload(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    // 1年分だと食事・支出が 1000 行を超えるのでページングする。共有相手の行は混ぜない
    const page = (table: string) => (from: number, to: number) =>
      supabase.from(table).select('*').eq('user_id', user.id).gte('date', start).lte('date', end)
        .order('date').order('created_at').range(from, to);
    try {
      const [m, c, w, e, d, p, l, b] = await Promise.all([
        fetchAllRows<MealEntry>(page('meal_entries')),
        fetchAllRows<DailyRecord>(page('daily_records')),
        fetchAllRows<WeatherRecord>(page('weather_records')),
        fetchAllRows<Expense>(page('expenses')),
        fetchAllRows<DiaryEntry>(page('diary_entries')),
        fetchAllRows<Photo>(page('photos')),
        fetchAllRows<LinkEntry>(page('links')),
        fetchAllRows<BodyRecord>(page('body_records')),
      ]);
      setMeals(m); setConditions(c); setWeathers(w); setExpenses(e);
      setDiaries(d); setPhotos(p); setLinks(l); setBodies(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : '記録の取得に失敗しました');
    }
    setLoading(false);
  }, [start, end, user?.id]);

  const title = `生活記録 ${start} 〜 ${end}`;
  const md = useMemo(
    () => toDailyMarkdown({ meals, conditions, weathers, expenses, diaries, photos, links, bodies }, title),
    [meals, conditions, weathers, expenses, diaries, photos, links, bodies, title],
  );

  const hasAny = meals.length + conditions.length + weathers.length + expenses.length + diaries.length + photos.length + links.length + bodies.length > 0;

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
          {loading ? '読み込み中…' : `食事 ${meals.length} / 体調 ${conditions.length} / 体重 ${bodies.length} / 天気 ${weathers.length} / 支出 ${expenses.length} / 日記 ${diaries.length} / 写真 ${photos.length} / リンク ${links.length} 件`}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h2>統合 Markdown（AI 分析向け）</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>体調・体重・天気気圧・食事・家計簿・日記・写真のキャプション・リンクを日別にまとめます。</p>
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
          <button className="btn outline full" disabled={bodies.length === 0} onClick={() => download(`lifelog-body-${start}_${end}.csv`, toBodyCSV(bodies), 'text/csv;charset=utf-8', true)}>
            体重・体組成 CSV
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
