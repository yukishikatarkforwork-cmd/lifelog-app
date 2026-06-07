import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { MealEntry } from '../lib/types';
import { formatShort } from '../lib/date';
import { fmt, sumNutrition } from '../lib/nutrition';

interface DayGroup {
  date: string;
  entries: MealEntry[];
}

export default function HistoryPage() {
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('meal_entries')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at');
      if (error) { setError(error.message); setLoading(false); return; }
      const byDate = new Map<string, MealEntry[]>();
      for (const e of (data as MealEntry[]) ?? []) {
        const arr = byDate.get(e.date) ?? [];
        arr.push(e);
        byDate.set(e.date, arr);
      }
      setGroups([...byDate.entries()].map(([date, entries]) => ({ date, entries })));
      setLoading(false);
    })();
  }, []);

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>記録履歴</h2>
      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : groups.length === 0 ? (
        <div className="empty">まだ記録がありません。<br />「今日」タブから食事を記録してみましょう。</div>
      ) : (
        groups.map((g) => {
          const t = sumNutrition(g.entries);
          return (
            <Link to={`/day/${g.date}`} key={g.date} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <div className="row-between">
                <strong>{formatShort(g.date)}</strong>
                <span className="kcal" style={{ fontWeight: 700 }}>{fmt(t.calories)} kcal</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {g.entries.length} 件 ・ P {fmt(t.protein)} / F {fmt(t.fat)} / C {fmt(t.carbohydrate)} g
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
