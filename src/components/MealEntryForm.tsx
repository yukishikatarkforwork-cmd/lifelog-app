import { useState } from 'react';
import type { FoodTemplate, MealEntryInput, MealType } from '../lib/types';
import { MEAL_LABELS, MEAL_TYPES } from '../lib/types';
import TagEditor from './TagEditor';

interface Props {
  defaultMealType: MealType;
  initial?: MealEntryInput;
  foodTemplates: FoodTemplate[];
  title: string;
  onSave: (input: MealEntryInput) => Promise<void> | void;
  onClose: () => void;
}

const blank = (mealType: MealType): MealEntryInput => ({
  meal_type: mealType,
  food_name: '',
  amount: '',
  calories: '',
  protein: '',
  fat: '',
  carbohydrate: '',
  memo: '',
  tags: [],
});

export default function MealEntryForm({
  defaultMealType,
  initial,
  foodTemplates,
  title,
  onSave,
  onClose,
}: Props) {
  const [form, setForm] = useState<MealEntryInput>(initial ?? blank(defaultMealType));
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<MealEntryInput>) => setForm((f) => ({ ...f, ...patch }));

  const applyTemplate = (id: string) => {
    const t = foodTemplates.find((x) => x.id === id);
    if (!t) return;
    set({
      food_name: t.name,
      amount: t.amount ?? '',
      calories: t.calories?.toString() ?? '',
      protein: t.protein?.toString() ?? '',
      fat: t.fat?.toString() ?? '',
      carbohydrate: t.carbohydrate?.toString() ?? '',
    });
  };

  const submit = async () => {
    if (!form.food_name.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>

        {foodTemplates.length > 0 && (
          <div className="field">
            <label>食品テンプレートから入力</label>
            <select defaultValue="" onChange={(e) => { applyTemplate(e.target.value); e.target.value = ''; }}>
              <option value="" disabled>選択して値を反映…</option>
              {foodTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.calories != null ? `（${t.calories}kcal）` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>食事区分</label>
          <select value={form.meal_type} onChange={(e) => set({ meal_type: e.target.value as MealType })}>
            {MEAL_TYPES.map((m) => (
              <option key={m} value={m}>{MEAL_LABELS[m]}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>食品・料理名 *</label>
          <input value={form.food_name} onChange={(e) => set({ food_name: e.target.value })} placeholder="例: 鶏むね肉のソテー" autoFocus />
        </div>

        <div className="field">
          <label>量</label>
          <input value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="例: 150g / 1膳" />
        </div>

        <div className="grid-2">
          <div className="field">
            <label>カロリー (kcal)</label>
            <input type="number" inputMode="decimal" value={form.calories} onChange={(e) => set({ calories: e.target.value })} />
          </div>
          <div className="field">
            <label>たんぱく質 (g)</label>
            <input type="number" inputMode="decimal" value={form.protein} onChange={(e) => set({ protein: e.target.value })} />
          </div>
          <div className="field">
            <label>脂質 (g)</label>
            <input type="number" inputMode="decimal" value={form.fat} onChange={(e) => set({ fat: e.target.value })} />
          </div>
          <div className="field">
            <label>炭水化物 (g)</label>
            <input type="number" inputMode="decimal" value={form.carbohydrate} onChange={(e) => set({ carbohydrate: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label>タグ</label>
          <TagEditor tags={form.tags} onChange={(tags) => set({ tags })} />
        </div>

        <div className="field">
          <label>メモ</label>
          <textarea value={form.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="満足度、外食か自炊か、など" />
        </div>

        <div className="grid-2">
          <button className="btn outline" onClick={onClose}>キャンセル</button>
          <button className="btn" onClick={submit} disabled={saving || !form.food_name.trim()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
