import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { FoodTemplate, MealEntry, MealEntryInput, MealTemplate, MealType, NutritionGoals } from '../lib/types';
import { EMPTY_GOALS, MEAL_LABELS, MEAL_TYPES } from '../lib/types';
import { addDays, formatDisplay, todayStr } from '../lib/date';
import { fmt, parseNum, sumNutrition } from '../lib/nutrition';
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
  const params = useParams();
  const [date, setDate] = useState(params.date ?? todayStr());

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

  useEffect(() => {
    if (params.date) setDate(params.date);
  }, [params.date]);

  const load = useCallback(async () => {
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
  }, [user, date]);

  useEffect(() => { void load(); }, [load]);

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
    await load();
  };

  const deleteEntry = async (id: string) => {
    if (!confirm('この記録を削除しますか？')) return;
    const { error } = await supabase.from('meal_entries').delete().eq('id', id);
    if (error) { setError(error.message); return; }
    await load();
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
    await load();
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
        <button onClick={() => setDate(addDays(date, -1))} aria-label="前日">‹</button>
        <div className="label">
          {formatDisplay(date)}
          {!isToday && (
            <div><button className="link-btn" style={{ fontSize: 12 }} onClick={() => setDate(todayStr())}>今日に戻る</button></div>
          )}
        </div>
        <button onClick={() => setDate(addDays(date, 1))} aria-label="翌日">›</button>
      </div>

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
                    <div className="main" onClick={() => openEdit(e)} style={{ cursor: 'pointer' }}>
                      <div className="name">{e.food_name}</div>
                      <div className="sub">
                        {e.amount ? `${e.amount}・` : ''}
                        P {fmt(e.protein ?? 0)} / F {fmt(e.fat ?? 0)} / C {fmt(e.carbohydrate ?? 0)} g
                      </div>
                      {e.memo && <div className="sub">📝 {e.memo}</div>}
                      {e.tags?.length > 0 && (
                        <div>{e.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                      )}
                    </div>
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
