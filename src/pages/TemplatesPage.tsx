import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { FoodTemplate, MealTemplate, MealTemplateItem, MealType } from '../lib/types';
import { MEAL_LABELS, MEAL_TYPES } from '../lib/types';
import { fmt, parseNum } from '../lib/nutrition';
import { useReload } from '../lib/useReload';

type Tab = 'food' | 'meal';

export default function TemplatesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('food');
  const [foods, setFoods] = useState<FoodTemplate[]>([]);
  const [meals, setMeals] = useState<MealTemplate[]>([]);
  const [error, setError] = useState('');

  const [foodForm, setFoodForm] = useState<FoodTemplate | null>(null);
  const [mealForm, setMealForm] = useState<MealTemplate | null>(null);

  const reload = useReload(async () => {
    const [f, m] = await Promise.all([
      supabase.from('food_templates').select('*').order('name'),
      supabase.from('meal_templates').select('*').order('name'),
    ]);
    if (f.error) setError(f.error.message);
    setFoods((f.data as FoodTemplate[]) ?? []);
    setMeals((m.data as MealTemplate[]) ?? []);
  }, []);

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>テンプレート</h2>
      <div className="tabs">
        <button className={tab === 'food' ? 'active' : ''} onClick={() => setTab('food')}>食品</button>
        <button className={tab === 'meal' ? 'active' : ''} onClick={() => setTab('meal')}>食事セット</button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {tab === 'food' ? (
        <>
          <button className="btn full" onClick={() => setFoodForm(emptyFood())} style={{ marginBottom: 14 }}>＋ 食品テンプレートを追加</button>
          {foods.length === 0 ? (
            <div className="empty">よく食べる単品を登録すると、記録時にすぐ呼び出せます。</div>
          ) : (
            foods.map((f) => (
              <div className="card" key={f.id}>
                <div className="row-between">
                  <div>
                    <div className="name" style={{ fontWeight: 600 }}>{f.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {f.amount ? `${f.amount}・` : ''}{fmt(f.calories ?? 0)}kcal ・ P{fmt(f.protein ?? 0)}/F{fmt(f.fat ?? 0)}/C{fmt(f.carbohydrate ?? 0)}
                    </div>
                  </div>
                  <div className="stack-sm" style={{ textAlign: 'right' }}>
                    <button className="btn ghost small" onClick={() => setFoodForm(f)}>編集</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </>
      ) : (
        <>
          <button className="btn full" onClick={() => setMealForm(emptyMeal())} style={{ marginBottom: 14 }}>＋ 食事セットを追加</button>
          {meals.length === 0 ? (
            <div className="empty">朝食セットなど複数食品をまとめて登録できます。<br />「自動セット」をオンにすると今日の記録に呼び出せます。</div>
          ) : (
            meals.map((m) => (
              <div className="card" key={m.id}>
                <div className="row-between">
                  <div>
                    <div className="name" style={{ fontWeight: 600 }}>
                      {m.name} {m.auto_apply && <span className="tag" style={{ background: '#e8f5ee', color: 'var(--primary-strong)' }}>自動セット</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {m.meal_type ? `${MEAL_LABELS[m.meal_type]}・` : ''}{m.items.length} 品
                    </div>
                  </div>
                  <button className="btn ghost small" onClick={() => setMealForm(m)}>編集</button>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {foodForm && user && (
        <FoodForm
          userId={user.id}
          value={foodForm}
          onClose={() => setFoodForm(null)}
          onSaved={async () => { setFoodForm(null); await reload(); }}
        />
      )}
      {mealForm && user && (
        <MealForm
          userId={user.id}
          value={mealForm}
          onClose={() => setMealForm(null)}
          onSaved={async () => { setMealForm(null); await reload(); }}
        />
      )}
    </div>
  );
}

// ---------- 食品テンプレートフォーム ----------
function emptyFood(): FoodTemplate {
  return { id: '', user_id: '', name: '', amount: null, calories: null, protein: null, fat: null, carbohydrate: null, created_at: '', updated_at: '' };
}

function FoodForm({ userId, value, onClose, onSaved }: {
  userId: string; value: FoodTemplate; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(value.name);
  const [amount, setAmount] = useState(value.amount ?? '');
  const [calories, setCalories] = useState(value.calories?.toString() ?? '');
  const [protein, setProtein] = useState(value.protein?.toString() ?? '');
  const [fat, setFat] = useState(value.fat?.toString() ?? '');
  const [carb, setCarb] = useState(value.carbohydrate?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const payload = {
      user_id: userId, name: name.trim(), amount: amount.trim() || null,
      calories: parseNum(calories), protein: parseNum(protein), fat: parseNum(fat), carbohydrate: parseNum(carb),
    };
    const res = value.id
      ? await supabase.from('food_templates').update(payload).eq('id', value.id)
      : await supabase.from('food_templates').insert(payload);
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    onSaved();
  };

  const remove = async () => {
    if (!confirm('この食品テンプレートを削除しますか？')) return;
    const { error } = await supabase.from('food_templates').delete().eq('id', value.id);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{value.id ? '食品テンプレートを編集' : '食品テンプレートを追加'}</h2>
        {err && <div className="error-box">{err}</div>}
        <div className="field"><label>食品名 *</label><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="field"><label>量</label><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例: 150g" /></div>
        <div className="grid-2">
          <div className="field"><label>カロリー</label><input type="number" inputMode="decimal" value={calories} onChange={(e) => setCalories(e.target.value)} /></div>
          <div className="field"><label>たんぱく質</label><input type="number" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></div>
          <div className="field"><label>脂質</label><input type="number" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></div>
          <div className="field"><label>炭水化物</label><input type="number" inputMode="decimal" value={carb} onChange={(e) => setCarb(e.target.value)} /></div>
        </div>
        <div className="grid-2">
          <button className="btn outline" onClick={onClose}>キャンセル</button>
          <button className="btn" onClick={save} disabled={busy || !name.trim()}>{busy ? '保存中…' : '保存'}</button>
        </div>
        {value.id && <button className="btn danger outline full" style={{ marginTop: 10 }} onClick={remove}>削除</button>}
      </div>
    </div>
  );
}

// ---------- 食事セットテンプレートフォーム ----------
function emptyMeal(): MealTemplate {
  return { id: '', user_id: '', name: '', meal_type: 'breakfast', auto_apply: false, items: [], created_at: '', updated_at: '' };
}

function MealForm({ userId, value, onClose, onSaved }: {
  userId: string; value: MealTemplate; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(value.name);
  const [mealType, setMealType] = useState<MealType>(value.meal_type ?? 'breakfast');
  const [autoApply, setAutoApply] = useState(value.auto_apply);
  const [items, setItems] = useState<MealTemplateItem[]>(value.items.length ? value.items : [blankItem()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const setItem = (i: number, patch: Partial<MealTemplateItem>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, blankItem()]);
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim()) return;
    const cleanItems = items
      .filter((it) => it.food_name.trim())
      .map((it) => ({
        food_name: it.food_name.trim(),
        amount: it.amount?.toString().trim() || null,
        calories: it.calories, protein: it.protein, fat: it.fat, carbohydrate: it.carbohydrate,
      }));
    setBusy(true);
    const payload = { user_id: userId, name: name.trim(), meal_type: mealType, auto_apply: autoApply, items: cleanItems };
    const res = value.id
      ? await supabase.from('meal_templates').update(payload).eq('id', value.id)
      : await supabase.from('meal_templates').insert(payload);
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    onSaved();
  };

  const remove = async () => {
    if (!confirm('この食事セットを削除しますか？')) return;
    const { error } = await supabase.from('meal_templates').delete().eq('id', value.id);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{value.id ? '食事セットを編集' : '食事セットを追加'}</h2>
        {err && <div className="error-box">{err}</div>}
        <div className="field"><label>セット名 *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: いつもの朝食" autoFocus /></div>
        <div className="field">
          <label>食事区分</label>
          <select value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>
            {MEAL_TYPES.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="row-between" style={{ cursor: 'pointer' }}>
            <span>毎日「今日の記録」に自動セット</span>
            <input type="checkbox" style={{ width: 'auto' }} checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
          </label>
        </div>

        <label className="muted" style={{ fontSize: 13 }}>含める食品</label>
        {items.map((it, i) => (
          <div className="card" key={i} style={{ padding: 10, background: '#f8fafc', boxShadow: 'none' }}>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>食品 {i + 1}</strong>
              {items.length > 1 && <button className="btn ghost small" onClick={() => removeItem(i)}>削除</button>}
            </div>
            <div className="field" style={{ marginBottom: 8 }}><input value={it.food_name} onChange={(e) => setItem(i, { food_name: e.target.value })} placeholder="食品名" /></div>
            <div className="grid-4">
              <input type="number" inputMode="decimal" value={it.calories ?? ''} onChange={(e) => setItem(i, { calories: parseNum(e.target.value) })} placeholder="kcal" />
              <input type="number" inputMode="decimal" value={it.protein ?? ''} onChange={(e) => setItem(i, { protein: parseNum(e.target.value) })} placeholder="P" />
              <input type="number" inputMode="decimal" value={it.fat ?? ''} onChange={(e) => setItem(i, { fat: parseNum(e.target.value) })} placeholder="F" />
              <input type="number" inputMode="decimal" value={it.carbohydrate ?? ''} onChange={(e) => setItem(i, { carbohydrate: parseNum(e.target.value) })} placeholder="C" />
            </div>
          </div>
        ))}
        <button className="btn outline small full" onClick={addItem} style={{ marginBottom: 14 }}>＋ 食品を追加</button>

        <div className="grid-2">
          <button className="btn outline" onClick={onClose}>キャンセル</button>
          <button className="btn" onClick={save} disabled={busy || !name.trim()}>{busy ? '保存中…' : '保存'}</button>
        </div>
        {value.id && <button className="btn danger outline full" style={{ marginTop: 10 }} onClick={remove}>削除</button>}
      </div>
    </div>
  );
}

function blankItem(): MealTemplateItem {
  return { food_name: '', amount: null, calories: null, protein: null, fat: null, carbohydrate: null };
}
