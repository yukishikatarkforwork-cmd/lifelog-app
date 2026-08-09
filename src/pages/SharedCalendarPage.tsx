import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useReload } from '../lib/useReload';
import { getAcceptedShare } from '../lib/shares';
import type {
  DailyRecord, DiaryEntry, Expense, MealEntry, Share, ShareScope, WeatherRecord,
} from '../lib/types';
import { MEAL_LABELS, SHARE_SCOPE_LABELS, WEATHER_LABELS } from '../lib/types';
import { formatDisplay, toDateStr, todayStr } from '../lib/date';
import { fmt, sumNutrition } from '../lib/nutrition';
import PhotoCard from '../components/PhotoCard';
import LinksCard from '../components/LinksCard';
import { IconShare } from '../components/icons';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const SCORE_BG: Record<number, string> = {
  1: '#fde2e1', 2: '#fdebd0', 3: '#fdf3c8', 4: '#e6f4d7', 5: '#d6f0dd',
};
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 共有されたカレンダーの読み取り専用ビュー。
 *
 * 表示するかどうかは share.scopes を見て決めるが、それは UI の都合であって
 * セキュリティ境界ではない。実際に読めるかどうかは DB の can_view() と
 * 各テーブルの SELECT ポリシーが決めており、許可のないカテゴリは
 * ここでクエリを投げても行が返ってこない。
 */
export default function SharedCalendarPage() {
  const { user } = useAuth();
  const { ownerId = '' } = useParams();

  const [share, setShare] = useState<Share | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string>(todayStr());

  const [conds, setConds] = useState<Map<string, DailyRecord>>(new Map());
  const [diaryDates, setDiaryDates] = useState<Set<string>>(new Set());
  const [mealDates, setMealDates] = useState<Set<string>>(new Set());

  // 選択日の詳細
  const [dayCond, setDayCond] = useState<DailyRecord | null>(null);
  const [dayWeather, setDayWeather] = useState<WeatherRecord | null>(null);
  const [dayMeals, setDayMeals] = useState<MealEntry[]>([]);
  const [dayExpenses, setDayExpenses] = useState<Expense[]>([]);
  const [dayDiary, setDayDiary] = useState<DiaryEntry | null>(null);

  const monthStart = toDateStr(new Date(year, month, 1));
  const monthEnd = toDateStr(new Date(year, month + 1, 0));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const can = (s: ShareScope) => share?.scopes.includes(s) ?? false;

  // 共有情報の取得
  useReload(async () => {
    if (!user || !ownerId) return;
    try {
      const s = await getAcceptedShare(ownerId, user.id);
      if (!s) { setNotFound(true); return; }
      setShare(s);
      setNotFound(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '共有情報の取得に失敗しました');
    }
  }, [user?.id, ownerId]);

  // 月のインジケータ
  useReload(async () => {
    if (!share) return;
    const [c, d, m] = await Promise.all([
      share.scopes.includes('condition')
        ? supabase.from('daily_records').select('*').eq('user_id', ownerId).gte('date', monthStart).lte('date', monthEnd)
        : Promise.resolve({ data: [] as DailyRecord[] }),
      share.scopes.includes('diary')
        ? supabase.from('diary_entries').select('date').eq('user_id', ownerId).gte('date', monthStart).lte('date', monthEnd)
        : Promise.resolve({ data: [] as Array<{ date: string }> }),
      share.scopes.includes('meal')
        ? supabase.from('meal_entries').select('date').eq('user_id', ownerId).gte('date', monthStart).lte('date', monthEnd)
        : Promise.resolve({ data: [] as Array<{ date: string }> }),
    ]);
    setConds(new Map(((c.data as DailyRecord[]) ?? []).map((r) => [r.date, r])));
    setDiaryDates(new Set(((d.data as Array<{ date: string }>) ?? []).map((r) => r.date)));
    setMealDates(new Set(((m.data as Array<{ date: string }>) ?? []).map((r) => r.date)));
  }, [share?.id, monthStart, monthEnd]);

  // 選択日の詳細
  useReload(async () => {
    if (!share) return;
    const [c, w, m, e, d] = await Promise.all([
      can('condition') ? supabase.from('daily_records').select('*').eq('user_id', ownerId).eq('date', selected).maybeSingle() : Promise.resolve({ data: null }),
      can('weather') ? supabase.from('weather_records').select('*').eq('user_id', ownerId).eq('date', selected).maybeSingle() : Promise.resolve({ data: null }),
      can('meal') ? supabase.from('meal_entries').select('*').eq('user_id', ownerId).eq('date', selected).order('created_at') : Promise.resolve({ data: [] }),
      can('expense') ? supabase.from('expenses').select('*').eq('user_id', ownerId).eq('date', selected).order('created_at') : Promise.resolve({ data: [] }),
      can('diary') ? supabase.from('diary_entries').select('*').eq('user_id', ownerId).eq('date', selected).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setDayCond((c.data as DailyRecord | null) ?? null);
    setDayWeather((w.data as WeatherRecord | null) ?? null);
    setDayMeals((m.data as MealEntry[]) ?? []);
    setDayExpenses((e.data as Expense[]) ?? []);
    setDayDiary((d.data as DiaryEntry | null) ?? null);
  }, [share?.id, selected]);

  const cells = useMemo(() => {
    const arr: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(`${year}-${pad(month + 1)}-${pad(d)}`);
    return arr;
  }, [firstWeekday, daysInMonth, year, month]);

  if (notFound) {
    return (
      <div className="page">
        <div className="empty">
          このカレンダーは表示できません。<br />
          共有が解除されたか、まだ承諾していない可能性があります。
        </div>
        <Link to="/share" className="btn outline full" style={{ textDecoration: 'none', textAlign: 'center' }}>
          共有一覧へ戻る
        </Link>
      </div>
    );
  }

  if (!share) {
    return <div className="page"><div className="empty">読み込み中…</div></div>;
  }

  const mealTotal = sumNutrition(dayMeals);
  const expenseTotal = dayExpenses.reduce((s, e) => s + e.amount, 0);
  const hasAnyDetail = dayCond || dayWeather || dayMeals.length > 0 || dayExpenses.length > 0 || dayDiary;

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}><IconShare size={18} /> {share.owner_email} のカレンダー</h2>
      <div className="info-box" style={{ fontSize: 13 }}>
        読み取り専用です。共有されている項目：{share.scopes.map((s) => SHARE_SCOPE_LABELS[s]).join('、')}
        {(share.start_date || share.end_date) && (
          <>（{share.start_date ?? '最初'} 〜 {share.end_date ?? '最新'}）</>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="date-nav" style={{ marginBottom: 10 }}>
          <button onClick={() => { const d = new Date(year, month - 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); }} aria-label="前の月">‹</button>
          <div className="label">{year}年{month + 1}月</div>
          <button onClick={() => { const d = new Date(year, month + 1, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); }} aria-label="次の月">›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, textAlign: 'center' }}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} style={{ fontSize: 11, color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--carb)' : 'var(--muted)', padding: '2px 0' }}>{w}</div>
          ))}
          {cells.map((ds, i) => {
            if (!ds) return <div key={`b${i}`} />;
            const day = Number(ds.slice(8));
            const score = conds.get(ds)?.condition_score ?? null;
            const isSelected = ds === selected;
            return (
              <button
                key={ds}
                onClick={() => setSelected(ds)}
                style={{
                  aspectRatio: '1 / 1',
                  border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: 8, background: score ? SCORE_BG[score] : '#fff',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
                  padding: '4px 2px', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 400 }}>{day}</span>
                <span style={{ fontSize: 9, lineHeight: 1 }}>{score ?? ''}</span>
                <span style={{ display: 'flex', gap: 2, height: 6 }}>
                  {mealDates.has(ds) && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--kcal)' }} />}
                  {diaryDates.has(ds) && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--primary)' }} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <h2 style={{ fontSize: 15 }}>{formatDisplay(selected)}</h2>

      {!hasAnyDetail && !can('photo') && (
        <div className="empty">この日の記録はありません。</div>
      )}

      {can('condition') && dayCond && (
        <div className="card">
          <h2>体調</h2>
          <div style={{ fontSize: 14 }}>
            {[
              dayCond.condition_score != null ? `体調 ${dayCond.condition_score}/5` : null,
              dayCond.mood_score != null ? `気分 ${dayCond.mood_score}/5` : null,
              dayCond.sleep_hours != null ? `睡眠 ${dayCond.sleep_hours}h` : null,
              dayCond.headache ? '頭痛あり' : null,
              dayCond.medication ? '服薬あり' : null,
            ].filter(Boolean).join(' / ') || '—'}
          </div>
          {dayCond.memo && <div className="muted" style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{dayCond.memo}</div>}
        </div>
      )}

      {can('weather') && dayWeather && (
        <div className="card">
          <h2>天気・気圧</h2>
          <div style={{ fontSize: 14 }}>
            {[
              dayWeather.weather ? WEATHER_LABELS[dayWeather.weather] : null,
              dayWeather.pressure_hpa != null ? `${dayWeather.pressure_hpa} hPa` : null,
              dayWeather.temperature != null ? `${dayWeather.temperature} ℃` : null,
            ].filter(Boolean).join(' / ')}
          </div>
        </div>
      )}

      {can('meal') && dayMeals.length > 0 && (
        <div className="card">
          <h2>食事 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{fmt(mealTotal.calories)} kcal</span></h2>
          {dayMeals.map((m) => (
            <div key={m.id} className="row-between" style={{ fontSize: 13, padding: '4px 0' }}>
              <span>{MEAL_LABELS[m.meal_type]} {m.food_name}</span>
              <span className="kcal">{fmt(m.calories ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      {can('expense') && dayExpenses.length > 0 && (
        <div className="card">
          <h2>家計簿 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>¥{expenseTotal.toLocaleString()}</span></h2>
          {dayExpenses.map((e) => (
            <div key={e.id} className="row-between" style={{ fontSize: 13, padding: '4px 0' }}>
              <span>{e.category}{e.memo ? ` ・ ${e.memo}` : ''}</span>
              <span>¥{e.amount.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {can('diary') && dayDiary && (
        <div className="card">
          <h2>日記{dayDiary.title ? `: ${dayDiary.title}` : ''}</h2>
          <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{dayDiary.body}</div>
          {dayDiary.tags?.length > 0 && (
            <div style={{ marginTop: 8 }}>{dayDiary.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
          )}
        </div>
      )}

      {can('photo') && <PhotoCard date={selected} ownerId={ownerId} readOnly />}
      {can('link') && <LinksCard date={selected} ownerId={ownerId} readOnly />}

      <Link to="/share" className="btn outline full" style={{ textDecoration: 'none', textAlign: 'center' }}>
        共有一覧へ戻る
      </Link>
    </div>
  );
}
