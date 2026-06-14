import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { MealEntry } from '../lib/types';
import { MEAL_LABELS } from '../lib/types';
import { formatShort } from '../lib/date';
import { fmt, sumNutrition } from '../lib/nutrition';

export default function HistoryPage() {
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('meal_entries')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at');
      if (error) { setError(error.message); setLoading(false); return; }
      setEntries((data as MealEntry[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // 全タグを集計（出現順）
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) for (const t of e.tags ?? []) set.add(t);
    return [...set];
  }, [entries]);

  const toggleTag = (t: string) =>
    setSelectedTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const isFiltering = query.trim() !== '' || selectedTags.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      const matchQ =
        q === '' ||
        e.food_name.toLowerCase().includes(q) ||
        (e.memo ?? '').toLowerCase().includes(q);
      const matchTags = selectedTags.every((t) => (e.tags ?? []).includes(t));
      return matchQ && matchTags;
    });
  }, [entries, query, selectedTags]);

  // 日付ごとにまとめる（フィルタなし時の表示）
  const groups = useMemo(() => {
    const byDate = new Map<string, MealEntry[]>();
    for (const e of entries) {
      const arr = byDate.get(e.date) ?? [];
      arr.push(e);
      byDate.set(e.date, arr);
    }
    return [...byDate.entries()].map(([date, list]) => ({ date, entries: list }));
  }, [entries]);

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>記録履歴</h2>

      {/* 検索・絞り込み */}
      <div className="card">
        <input
          data-testid="history-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 食品名・メモで検索"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}
        />
        {allTags.length > 0 && (
          <div className="tag-input" style={{ marginTop: 10 }}>
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                className="tag"
                onClick={() => toggleTag(t)}
                style={{
                  cursor: 'pointer', border: '1px solid var(--border)',
                  background: selectedTags.includes(t) ? 'var(--primary)' : '#eef2f7',
                  color: selectedTags.includes(t) ? '#fff' : 'var(--muted)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : entries.length === 0 ? (
        <div className="empty">まだ記録がありません。<br />「今日」タブから食事を記録してみましょう。</div>
      ) : isFiltering ? (
        // --- 絞り込み中: 一致した記録をフラット表示 ---
        filtered.length === 0 ? (
          <div className="empty">一致する記録がありません。</div>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{filtered.length} 件ヒット</div>
            {filtered.map((e) => (
              <Link to={`/day/${e.date}`} key={e.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit', padding: 12 }}>
                <div className="row-between">
                  <span className="name" style={{ fontWeight: 600 }}>{e.food_name}</span>
                  <span className="kcal" style={{ fontWeight: 700 }}>{fmt(e.calories ?? 0)} kcal</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {formatShort(e.date)} ・ {MEAL_LABELS[e.meal_type]}
                  {e.tags?.length > 0 && <>　{e.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</>}
                </div>
              </Link>
            ))}
          </>
        )
      ) : (
        // --- 通常: 日付ごとのサマリ ---
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
