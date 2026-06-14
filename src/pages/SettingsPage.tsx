import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { parseNum } from '../lib/nutrition';
import type { ExpenseCategory, UserSettings } from '../lib/types';
import { DEFAULT_EXPENSE_CATEGORIES } from '../lib/types';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // 栄養目標
  const [cal, setCal] = useState('');
  const [pro, setPro] = useState('');
  const [fat, setFat] = useState('');
  const [carb, setCarb] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  // 支出カテゴリ（ユーザー追加分）
  const [customCats, setCustomCats] = useState<ExpenseCategory[]>([]);
  const [newCat, setNewCat] = useState('');

  const loadCats = async () => {
    const { data } = await supabase.from('expense_categories').select('*').order('created_at');
    setCustomCats((data as ExpenseCategory[]) ?? []);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('user_settings').select('*').maybeSingle();
      const s = data as UserSettings | null;
      if (s) {
        setCal(s.target_calories?.toString() ?? '');
        setPro(s.target_protein?.toString() ?? '');
        setFat(s.target_fat?.toString() ?? '');
        setCarb(s.target_carbohydrate?.toString() ?? '');
      }
      await loadCats();
    })();
  }, []);

  const addCat = async () => {
    const name = newCat.trim();
    if (!user || name === '') return;
    if ([...DEFAULT_EXPENSE_CATEGORIES, ...customCats.map((c) => c.name)].includes(name)) {
      setErr('同名のカテゴリが既にあります。');
      return;
    }
    setErr('');
    const { error } = await supabase.from('expense_categories').insert({ user_id: user.id, name });
    if (error) { setErr(error.message); return; }
    setNewCat('');
    await loadCats();
  };

  const delCat = async (id: string) => {
    const { error } = await supabase.from('expense_categories').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    await loadCats();
  };

  const saveGoals = async () => {
    if (!user) return;
    setErr('');
    setMsg('');
    setSavingGoal(true);
    const { error } = await supabase.from('user_settings').upsert(
      {
        user_id: user.id,
        target_calories: parseNum(cal),
        target_protein: parseNum(pro),
        target_fat: parseNum(fat),
        target_carbohydrate: parseNum(carb),
      },
      { onConflict: 'user_id' },
    );
    setSavingGoal(false);
    if (error) { setErr(error.message); return; }
    setMsg('栄養目標を保存しました。');
  };

  const deleteAllData = async () => {
    if (!user) return;
    if (!confirm('すべての食事記録・テンプレートを削除します。元に戻せません。よろしいですか？')) return;
    setErr('');
    setMsg('');
    const r1 = await supabase.from('meal_entries').delete().eq('user_id', user.id);
    const r2 = await supabase.from('meal_templates').delete().eq('user_id', user.id);
    const r3 = await supabase.from('food_templates').delete().eq('user_id', user.id);
    const e = r1.error || r2.error || r3.error;
    if (e) { setErr(e.message); return; }
    setMsg('すべてのデータを削除しました。');
  };

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>設定</h2>

      {msg && <div className="info-box">{msg}</div>}
      {err && <div className="error-box">{err}</div>}

      <div className="card">
        <h2>栄養目標（1日あたり）</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          設定すると「今日の記録」に目標との比較バーが表示されます。空欄の項目は非表示になります。
        </p>
        <div className="grid-2">
          <div className="field">
            <label>カロリー (kcal)</label>
            <input data-testid="goal-calories" type="number" inputMode="decimal" value={cal} onChange={(e) => setCal(e.target.value)} placeholder="例: 2000" />
          </div>
          <div className="field">
            <label>たんぱく質 (g)</label>
            <input type="number" inputMode="decimal" value={pro} onChange={(e) => setPro(e.target.value)} placeholder="例: 100" />
          </div>
          <div className="field">
            <label>脂質 (g)</label>
            <input type="number" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} placeholder="例: 60" />
          </div>
          <div className="field">
            <label>炭水化物 (g)</label>
            <input type="number" inputMode="decimal" value={carb} onChange={(e) => setCarb(e.target.value)} placeholder="例: 250" />
          </div>
        </div>
        <button data-testid="goal-save" className="btn full" onClick={saveGoals} disabled={savingGoal}>
          {savingGoal ? '保存中…' : '目標を保存'}
        </button>
      </div>

      <div className="card">
        <h2>データ出力</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>食事記録を CSV / Markdown で書き出します（AI 分析・表計算向け）。</p>
        <Link to="/export" className="btn outline full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>出力画面を開く</Link>
      </div>

      <div className="card">
        <h2>支出カテゴリ</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>既定カテゴリに加えて、独自のカテゴリを追加できます。</p>
        <div className="tag-input" style={{ marginBottom: 10 }}>
          {DEFAULT_EXPENSE_CATEGORIES.map((c) => (
            <span key={c} className="chip" style={{ opacity: 0.7 }}>{c}</span>
          ))}
          {customCats.map((c) => (
            <span key={c.id} className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--primary-strong)' }}>
              {c.name}
              <button type="button" onClick={() => delCat(c.id)} aria-label="削除">×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCat(); } }}
            placeholder="新しいカテゴリ名"
            style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--input-bg)', color: 'var(--text)' }}
          />
          <button className="btn" onClick={addCat} disabled={!newCat.trim()}>追加</button>
        </div>
      </div>

      <div className="card">
        <h2>テンプレート管理</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>よく食べる食品・食事セットの登録と自動セット設定。</p>
        <Link to="/templates" className="btn outline full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>テンプレートを開く</Link>
      </div>

      <div className="card">
        <h2>アカウント</h2>
        <div className="muted" style={{ fontSize: 13 }}>ログイン中のメールアドレス</div>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{user?.email}</div>
        <button data-testid="logout" className="btn outline full" onClick={() => void signOut()}>ログアウト</button>
      </div>

      <div className="card">
        <h2>データ削除</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          記録・テンプレートをすべて削除します。アカウント自体の削除はサポートへの依頼が必要です（後続フェーズで対応予定）。
        </p>
        <button className="btn danger outline full" onClick={deleteAllData}>すべてのデータを削除</button>
      </div>

      <p className="center muted" style={{ fontSize: 11 }}>Lifelog — 自己管理統合アプリ</p>
    </div>
  );
}
