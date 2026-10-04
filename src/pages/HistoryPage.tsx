import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { DiaryEntry, MealEntry } from '../lib/types';
import { MEAL_LABELS } from '../lib/types';
import { formatShort } from '../lib/date';
import { fmt, sumNutrition } from '../lib/nutrition';
import CalendarView from '../components/CalendarView';
import { IconSearch } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { fetchAllRows } from '../lib/fetchAll';

export default function HistoryPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [view, setView] = useState<'list' | 'calendar' | 'diary'>('list');
  const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
  const [diaryQuery, setDiaryQuery] = useState('');

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      setError('');
      // 全件を引く画面なので 1000 行で切れないようページングする。共有相手の行は混ぜない
      const page = (table: string) => (from: number, to: number) =>
        supabase.from(table).select('*').eq('user_id', user.id)
          .order('date', { ascending: false }).order('created_at').range(from, to);
      try {
        const [meals, diaryRows] = await Promise.all([
          fetchAllRows<MealEntry>(page('meal_entries')),
          fetchAllRows<DiaryEntry>(page('diary_entries')),
        ]);
        setEntries(meals);
        setDiaries(diaryRows);
      } catch (e) {
        setError(e instanceof Error ? e.message : '記録の取得に失敗しました');
      }
      setLoading(false);
    })();
  }, [user]);

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

  // 日記の検索（タイトル・本文・タグを対象）
  const filteredDiaries = useMemo(() => {
    const q = diaryQuery.trim().toLowerCase();
    if (q === '') return diaries;
    return diaries.filter((d) =>
      (d.title ?? '').toLowerCase().includes(q) ||
      d.body.toLowerCase().includes(q) ||
      (d.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [diaries, diaryQuery]);

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

      <div className="tabs">
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>リスト</button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>カレンダー</button>
        <button className={view === 'diary' ? 'active' : ''} data-testid="tab-diary" onClick={() => setView('diary')}>日記</button>
      </div>

      {view === 'calendar' && <CalendarView />}

      {view === 'diary' && (<>
        <div className="card">
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', display: 'flex', pointerEvents: 'none' }}>
              <IconSearch />
            </span>
            <input
              data-testid="diary-search"
              value={diaryQuery}
              onChange={(e) => setDiaryQuery(e.target.value)}
              placeholder="タイトル・本文・タグで検索"
              style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--input-bg)', color: 'var(--text)' }}
            />
          </div>
        </div>

        {loading ? (
          <div className="empty">読み込み中…</div>
        ) : diaries.length === 0 ? (
          <div className="empty">まだ日記がありません。<br />「今日」タブから書いてみましょう。</div>
        ) : filteredDiaries.length === 0 ? (
          <div className="empty">一致する日記がありません。</div>
        ) : (<>
          {diaryQuery.trim() !== '' && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{filteredDiaries.length} 件ヒット</div>
          )}
          {filteredDiaries.map((d) => (
            <Link to={`/day/${d.date}`} key={d.date} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <div className="row-between">
                <strong>{d.title || formatShort(d.date)}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{formatShort(d.date)}</span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                {d.body.length > 120 ? `${d.body.slice(0, 120)}…` : d.body}
              </div>
              {d.tags?.length > 0 && (
                <div style={{ marginTop: 6 }}>{d.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
              )}
            </Link>
          ))}
        </>)}
      </>)}

      {view === 'list' && (<>
      {/* 検索・絞り込み */}
      <div className="card">
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', display: 'flex', pointerEvents: 'none' }}>
            <IconSearch />
          </span>
          <input
            data-testid="history-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="食品名・メモで検索"
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--input-bg)', color: 'var(--text)' }}
          />
        </div>
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
                  background: selectedTags.includes(t) ? 'var(--primary)' : 'var(--fill-2)',
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
                  {e.tags?.length > 0 && (
                    <span style={{ marginLeft: 8 }}>{e.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</span>
                  )}
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
      </>)}
    </div>
  );
}
