import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Expense, ExpenseCategory } from '../lib/types';
import { DEFAULT_EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../lib/types';
import { parseNum } from '../lib/nutrition';
import { useReload } from '../lib/useReload';
import { useToast } from '../context/ToastContext';
import { IconWallet, IconTrash, IconCamera } from './icons';
import { scanReceipt, type ScanResult } from '../lib/receipt';
import { formatDisplay } from '../lib/date';
import ReceiptScanModal from './ReceiptScanModal';

export default function ExpensesCard({ date }: { date: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [customCats, setCustomCats] = useState<ExpenseCategory[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  // レシート読み取り
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const categories = useMemo(() => {
    const names = [...DEFAULT_EXPENSE_CATEGORIES];
    for (const c of customCats) if (!names.includes(c.name)) names.push(c.name);
    return names;
  }, [customCats]);

  const reload = useReload(async () => {
    const [exp, cats] = await Promise.all([
      supabase.from('expenses').select('*').eq('date', date).order('created_at'),
      supabase.from('expense_categories').select('*').order('created_at'),
    ]);
    if (exp.error) setErr(exp.error.message);
    setExpenses((exp.data as Expense[]) ?? []);
    setCustomCats((cats.data as ExpenseCategory[]) ?? []);
  }, [date]);

  const total = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);

  const onPickReceipt = async (file: File | undefined) => {
    if (!file) return;
    setScanning(true);
    setErr('');
    try {
      setScanResult(await scanReceipt(file, categories, date));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'レシートの読み取りに失敗しました');
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const closeScan = () => {
    if (scanResult) URL.revokeObjectURL(scanResult.previewUrl);
    setScanResult(null);
  };

  const del = async (id: string) => {
    if (!confirm('この支出を削除しますか？')) return;
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    await reload();
    toast('支出を削除しました');
  };

  return (
    <div className="card">
      <div className="section-title">
        <h2><IconWallet /> 家計簿 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>合計 ¥{total.toLocaleString()}</span></h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn small outline" data-testid="scan-receipt" onClick={() => fileRef.current?.click()} disabled={scanning}>
            <IconCamera size={14} /> {scanning ? '読み取り中…' : 'レシート'}
          </button>
          <button className="btn small outline" data-testid="add-expense" onClick={() => { setEditing(null); setFormOpen(true); }}>＋ 追加</button>
        </div>
        {/* スマホでは capture でカメラが直接開く。PC では通常のファイル選択になる */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void onPickReceipt(e.target.files?.[0])} />
      </div>
      {err && <div className="error-box">{err}</div>}

      {expenses.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>記録なし</div>
      ) : (
        expenses.map((e) => (
          <div className="entry" key={e.id}>
            <button type="button" className="main entry-main" onClick={() => { setEditing(e); setFormOpen(true); }}>
              <div className="name">{e.category} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{e.payment_method ?? ''}</span></div>
              {e.memo && <div className="sub">{e.memo}</div>}
            </button>
            <div style={{ textAlign: 'right' }}>
              <div className="kcal" style={{ color: 'var(--text)' }}>¥{e.amount.toLocaleString()}</div>
              <button className="btn ghost small" onClick={() => del(e.id)} aria-label="削除"><IconTrash /></button>
            </div>
          </div>
        ))
      )}

      {scanResult && user && (
        <ReceiptScanModal
          scan={scanResult.scan}
          previewUrl={scanResult.previewUrl}
          userId={user.id}
          categories={categories}
          pageDate={date}
          onClose={closeScan}
          onSaved={async (savedDate, count) => {
            closeScan();
            if (savedDate === date) {
              await reload();
              toast(`レシートから ${count} 件を登録しました`);
            } else {
              toast(`${formatDisplay(savedDate)} に ${count} 件を登録しました`);
              navigate(`/day/${savedDate}`);
            }
          }}
        />
      )}

      {formOpen && user && (
        <ExpenseForm
          date={date}
          userId={user.id}
          categories={categories}
          initial={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={async () => { setFormOpen(false); setEditing(null); await reload(); toast('支出を保存しました'); }}
        />
      )}
    </div>
  );
}

function ExpenseForm({
  date, userId, categories, initial, onClose, onSaved,
}: {
  date: string; userId: string; categories: string[];
  initial: Expense | null; onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? '');
  const [category, setCategory] = useState(initial?.category ?? categories[0] ?? '食費');
  const [payment, setPayment] = useState(initial?.payment_method ?? PAYMENT_METHODS[0]);
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    const amt = parseNum(amount);
    if (amt == null) { setErr('金額を入力してください。'); return; }
    setBusy(true);
    setErr('');
    const payload = { user_id: userId, date, amount: amt, category, payment_method: payment, memo: memo.trim() || null };
    const res = initial
      ? await supabase.from('expenses').update(payload).eq('id', initial.id)
      : await supabase.from('expenses').insert(payload);
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    onSaved();
  };

  const del = async () => {
    if (!initial) return;
    if (!confirm('この支出を削除しますか？')) return;
    const { error } = await supabase.from('expenses').delete().eq('id', initial.id);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? '支出を編集' : '支出を追加'}</h2>
        {err && <div className="error-box">{err}</div>}
        <div className="field">
          <label>金額 (円) *</label>
          <input data-testid="expense-amount" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例: 1200" autoFocus />
        </div>
        <div className="field">
          <label>カテゴリ</label>
          <select data-testid="expense-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>支払い方法</label>
          <select value={payment} onChange={(e) => setPayment(e.target.value)}>
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="field">
          <label>メモ</label>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="店名・内容など" />
        </div>
        <div className="grid-2">
          <button className="btn outline" onClick={onClose}>キャンセル</button>
          <button data-testid="expense-save" className="btn" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
        {initial && <button className="btn danger outline full" style={{ marginTop: 10 }} onClick={del}>削除</button>}
      </div>
    </div>
  );
}
