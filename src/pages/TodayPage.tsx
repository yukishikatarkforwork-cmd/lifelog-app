import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { FoodTemplate, MealEntry, MealEntryInput, MealTemplate, MealType, NutritionGoals } from '../lib/types';
import { EMPTY_GOALS, MEAL_LABELS, MEAL_TYPES } from '../lib/types';
import { addDays, formatDisplay, todayStr } from '../lib/date';
import { fmt, parseNum, sumNutrition } from '../lib/nutrition';
import { useReload } from '../lib/useReload';
import DayTotals from '../components/DayTotals';
import MealEntryForm from '../components/MealEntryForm';
import ConditionCard from '../components/ConditionCard';
import WeatherCard from '../components/WeatherCard';
import ExpensesCard from '../components/ExpensesCard';

const entryToInput = (e: MealEntry): MealEntryInput => ({
  meal_type: e.meal_type,
  food_name: e.food_name,
  amount: e.amount ?? '',
  calories: e.calories?.toString() ?? '',
  protein: e.protein?.toString() ?? '',
  fat: e.fat?.toString() ?? '',
  carbohydrate: e.carbohydrate?.toString() ?? '',
  memo: e.memo ?? '',
  tags: e.tags ?? [],
});

export default function TodayPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const params = useParams();
  // URL を日付の単一の真実とし、ローカル state には持たない（戻る/進む・URL 共有が効く）
  const date = params.date ?? todayStr();
  const goToDate = (d: string) => navigate(`/day/${d}`);

  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [foodTemplates, setFoodTemplates] = useState<FoodTemplate[]>([]);
  const [autoTemplates, setAutoTemplates] = useState<MealTemplate[]>([]);
  const [goals, setGoals] = useState<NutritionGoals>(EMPTY_GOALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // モーダル状態
  const [formOpen, setFormOpen] = useState(false);
  const [formMealType, setFormMealType] = useState<MealType>('breakfast');
  const [editing, setEditing] = useState<MealEntry | null>(null);

  const reload = useReload(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    const [entriesRes, foodRes, autoRes, settingsRes] = await Promise.all([
      supabase.from('meal_entries').select('*').eq('date', date).order('created_at'),
      supabase.from('food_templates').select('*').order('name'),
      supabase.from('meal_templates').select('*').eq('auto_apply', true),
      supabase.from('user_settings').select('*').maybeSingle(),
    ]);
    if (entriesRes.error) setError(entriesRes.error.message);
    setEntries((entriesRes.data as MealEntry[]) ?? []);
    setFoodTemplates((foodRes.data as FoodTemplate[]) ?? []);
    setAutoTemplates((autoRes.data as MealTemplate[]) ?? []);
    setGoals((settingsRes.data as NutritionGoals) ?? EMPTY_GOALS);
    setLoading(false);
  }, [user?.id, date]);

  const total = useMemo(() => sumNutrition(entries), [entries]);

  const buildPayload = (input: MealEntryInput) => ({
    user_id: user!.id,
    date,
    meal_type: input.meal_type,
    food_name: input.food_name.trim(),
    amount: input.amount.trim() || null,
    calories: parseNum(input.calories),
    protein: parseNum(input.protein),
    fat: parseNum(input.fat),
    carbohydrate: parseNum(input.carbohydrate),
    memo: input.memo.trim() || null,
    tags: input.tags,
  });

  const saveEntry = async (input: MealEntryInput) => {
    const payload = buildPayload(input);
    if (editing) {
      const { error } = await supabase.from('meal_entries').update(payload).eq('id', editing.id);
      if (error) { setError(error.message); return; }
    } else {
      const { error } = await supabase.from('meal_entries').insert(payload);
      if (error) { setError(error.message); return; }
    }
    setFormOpen(false);
    setEditing(null);
    await reload();
    toast(editing ? '記録を更新しました' : '食事を記録しました');
  };

  const deleteEntry = async (id: string) => {
    if (!confirm('この記録を削除しますか？')) return;
    const { error } = await supabase.from('meal_entries').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    await reload();
    toast('記録を削除しました');
  };

  const applyAutoTemplates = async () => {
    if (!user) return;
    const rows = autoTemplates.flatMap((t) =>
      t.items.map((it) => ({
        user_id: user.id,
        date,
        meal_type: t.meal_type ?? 'breakfast',
        food_name: it.food_name,
        amount: it.amount,
        calories: it.calories,
        protein: it.protein,
        fat: it.fat,
        carbohydrate: it.carbohydrate,
        memo: null,
        tags: [],
      })),
    );
    if (rows.length === 0) return;
    const { error } = await supabase.from('meal_entries').insert(rows);
    if (error) { setError(error.message); return; }
    await reload();
    toast('自動セットを反映しました');
  };

  const openAdd = (mealType: MealType) => {
    setEditing(null);
    setFormMealType(mealType);
    setFormOpen(true);
  };
  const openEdit = (e: MealEntry) => {
    setEditing(e);
    setFormMealType(e.meal_type);
    setFormOpen(true);
  };

  const isToday = date === todayStr();
  const autoItemCount = autoTemplates.reduce((s, t) => s + t.items.length, 0);

  return (
    <div className="page">
      <div className="date-nav">
        <button onClick={() => goToDate(addDays(date, -1))} aria-label="前日">‹</button>
        <label className="date-jump" title="タップで日付を選択">
          <span className="label">📅 {formatDisplay(date)}</span>
          <input
            type="date"
            aria-label="日付を選択"
            value={date}
            max={todayStr()}
            onChange={(e) => { if (e.target.value) goToDate(e.target.value); }}
          />
        </label>
        <button onClick={() => goToDate(addDays(date, 1))} aria-label="翌日">›</button>
      </div>
      {!isToday && (
        <div className="center" style={{ marginTop: -6, marginBottom: 12 }}>
          <button className="link-btn" onClick={() => navigate('/')}>今日に戻る</button>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      <ConditionCard date={date} />
      <WeatherCard date={date} />

      <div className="section-title" style={{ marginTop: 4 }}><h2>🍽️ 食事</h2></div>
      <DayTotals total={total} goals={goals} />

      {!loading && entries.length === 0 && autoItemCount > 0 && (
        <div className="info-box row-between">
          <span>自動セット対象のテンプレートが {autoItemCount} 件あります</span>
          <button className="btn small" onClick={applyAutoTemplates}>自動セット</button>
        </div>
      )}

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : (
        MEAL_TYPES.map((mt) => {
          const list = entries.filter((e) => e.meal_type === mt);
          const sub = sumNutrition(list);
          return (
            <div className="card" key={mt}>
              <div className="section-title">
                <h2>{MEAL_LABELS[mt]} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{fmt(sub.calories)} kcal</span></h2>
                <button className="btn small outline" data-testid={`add-${mt}`} onClick={() => openAdd(mt)}>＋ 追加</button>
              </div>
              {list.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>記録なし</div>
              ) : (
                list.map((e) => (
                  <div className="entry" key={e.id}>
                    <button type="button" className="main entry-main" onClick={() => openEdit(e)}>
                      <div className="name">{e.food_name}</div>
                      <div className="sub">
                        {e.amount ? `${e.amount}・` : ''}
                        P {fmt(e.protein ?? 0)} / F {fmt(e.fat ?? 0)} / C {fmt(e.carbohydrate ?? 0)} g
                      </div>
                      {e.memo && <div className="sub">📝 {e.memo}</div>}
                      {e.tags?.length > 0 && (
                        <div>{e.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                      )}
                    </button>
                    <div style={{ textAlign: 'right' }}>
                      <div className="kcal">{fmt(e.calories ?? 0)}</div>
                      <button className="btn ghost small" onClick={() => deleteEntry(e.id)} aria-label="削除">🗑</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })
      )}

      <ExpensesCard date={date} />

      {formOpen && (
        <MealEntryForm
          defaultMealType={formMealType}
          initial={editing ? entryToInput(editing) : undefined}
          foodTemplates={foodTemplates}
          title={editing ? '記録を編集' : '食事を追加'}
          onSave={saveEntry}
          onClose={() => { setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
