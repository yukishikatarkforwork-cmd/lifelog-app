import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PAYMENT_METHODS } from '../lib/types';
import { itemsTotalDiff, type ReceiptItem, type ReceiptScan } from '../lib/receipt';
import { formatDisplay } from '../lib/date';

interface Row extends ReceiptItem {
  id: number;
  include: boolean;
}

/**
 * レシート読み取り結果の確認画面。
 * AI の読み取りは値引・税込換算・カテゴリで迷うことがあるので、ここで必ず人が直してから登録する。
 * 「明細ごと」か「1件にまとめる」かを選べる（細かく分けたい人と、合計だけでいい人がいる）。
 */
export default function ReceiptScanModal({
  scan, previewUrl, userId, categories, pageDate, onClose, onSaved,
}: {
  scan: ReceiptScan; previewUrl: string; userId: string; categories: string[]; pageDate: string;
  onClose: () => void; onSaved: (date: string, count: number) => void;
}) {
  const [date, setDate] = useState(scan.date ?? pageDate);
  const [store, setStore] = useState(scan.store ?? '');
  const [payment, setPayment] = useState<string>(scan.payment_method ?? PAYMENT_METHODS[0]);
  const [mode, setMode] = useState<'items' | 'single'>(scan.items.length > 1 ? 'items' : 'single');
  const [rows, setRows] = useState<Row[]>(() => scan.items.map((it, i) => ({ ...it, id: i, include: true })));
  const [total, setTotal] = useState(scan.total?.toString() ?? '');
  const [singleCategory, setSingleCategory] = useState(() => majorityCategory(scan.items) ?? categories[0] ?? '食費');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 背景タップで閉じる前に、直した内容を捨ててよいか聞く（スクロール中の誤タップ対策）
  const [dirty, setDirty] = useState(false);
  const [done, setDone] = useState(false);
  const requestClose = () => {
    if (busy || done) return;
    if (!dirty || confirm('読み取り結果を破棄して閉じますか？')) onClose();
  };

  const included = useMemo(() => rows.filter((r) => r.include), [rows]);
  const itemsSum = included.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const totalNum = total.trim() === '' ? null : Number(total);
  const diff = itemsTotalDiff(included, Number.isFinite(totalNum as number) ? totalNum : null);

  const update = (id: number, patch: Partial<Row>) => {
    setDirty(true);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const addRow = () =>
    setRows((rs) => [...rs, { id: Date.now(), name: '', amount: 0, category: categories[0] ?? '食費', include: true }]);

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr('日付を入力してください。'); return; }
    const memoPrefix = store.trim();
    let payload: Array<{ user_id: string; date: string; amount: number; category: string; payment_method: string; memo: string | null }>;

    if (mode === 'single') {
      if (totalNum == null || !Number.isFinite(totalNum) || totalNum < 0) { setErr('合計金額を入力してください。'); return; }
      const names = included.map((r) => r.name).filter(Boolean);
      payload = [{
        user_id: userId, date, amount: Math.round(totalNum), category: singleCategory, payment_method: payment,
        memo: [memoPrefix, names.length > 0 ? names.join('、') : null].filter(Boolean).join(': ') || null,
      }];
    } else {
      const bad = included.find((r) => r.name.trim() === '' || !Number.isFinite(r.amount) || r.amount < 0);
      if (bad) { setErr('品名が空、または金額が不正な行があります。'); return; }
      if (included.length === 0) { setErr('登録する行がありません。'); return; }
      payload = included.map((r) => ({
        user_id: userId, date, amount: Math.round(r.amount), category: r.category, payment_method: payment,
        memo: memoPrefix ? `${memoPrefix}: ${r.name.trim()}` : r.name.trim(),
      }));
    }

    setBusy(true);
    setErr('');
    const { error } = await supabase.from('expenses').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    onSaved(date, payload.length);
  };

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2>レシートの読み取り結果</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          内容を確認して直してから登録してください。割引や税込換算は間違うことがあります。
        </p>
        {scan.notes && <div className="info-box" style={{ fontSize: 12 }}>読み取りメモ: {scan.notes}</div>}
        {err && <div className="error-box">{err}</div>}

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <img src={previewUrl} alt="レシート" style={{ width: 72, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="field">
              <label>店名</label>
              <input value={store} onChange={(e) => { setDirty(true); setStore(e.target.value); }} placeholder="例: セブンイレブン" />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>日付</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="field">
                <label>支払い方法</label>
                <select value={payment} onChange={(e) => setPayment(e.target.value)}>
                  {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
        {date !== pageDate && (
          <div className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 8 }}>
            レシートの日付（{formatDisplay(date)}）に登録します。
          </div>
        )}

        <div className="tabs" style={{ marginBottom: 10 }}>
          <button className={mode === 'items' ? 'active' : ''} onClick={() => setMode('items')}>明細ごとに登録</button>
          <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>1件にまとめる</button>
        </div>

        {mode === 'items' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map((r) => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr 76px', gap: 6, alignItems: 'center', opacity: r.include ? 1 : 0.45 }}>
                  <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={r.include} onChange={(e) => update(r.id, { include: e.target.checked })} aria-label="登録する" />
                  <div style={{ minWidth: 0 }}>
                    <input value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} placeholder="品名" style={{ marginBottom: 4 }} />
                    <select value={r.category} onChange={(e) => update(r.id, { category: e.target.value })} style={{ fontSize: 12, padding: '4px 8px' }}>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <input type="number" inputMode="numeric" value={Number.isFinite(r.amount) ? r.amount : ''} onChange={(e) => update(r.id, { amount: Number(e.target.value) })} style={{ textAlign: 'right' }} aria-label="金額" />
                </div>
              ))}
            </div>
            <button className="link-btn" style={{ fontSize: 12, marginTop: 8 }} onClick={addRow}>＋ 行を追加</button>

            <div className="row-between" style={{ marginTop: 10, fontSize: 13 }}>
              <span>明細の合計 <strong>¥{itemsSum.toLocaleString()}</strong>{included.length !== rows.length && <span className="muted">（{included.length}/{rows.length} 件）</span>}</span>
              <span className="muted">レシート合計 ¥{totalNum != null && Number.isFinite(totalNum) ? totalNum.toLocaleString() : '—'}</span>
            </div>
            {diff != null && diff !== 0 && (
              <div className="error-box" style={{ fontSize: 12 }}>
                明細の合計がレシートの合計と {diff > 0 ? '+' : ''}{diff.toLocaleString()} 円ずれています。税込換算や割引の読み違いの可能性があります。
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid-2">
              <div className="field">
                <label>合計金額 (円)</label>
                <input type="number" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} />
              </div>
              <div className="field">
                <label>カテゴリ</label>
                <select value={singleCategory} onChange={(e) => setSingleCategory(e.target.value)}>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {included.length > 0 && (
              <div className="muted" style={{ fontSize: 12 }}>メモに品名を入れます: {included.map((r) => r.name).filter(Boolean).join('、')}</div>
            )}
          </>
        )}

        <div className="grid-2" style={{ marginTop: 12 }}>
          <button className="btn outline" onClick={requestClose} disabled={busy}>キャンセル</button>
          <button data-testid="receipt-save" className="btn" onClick={() => void save()} disabled={busy || done}>
            {busy ? '登録中…' : done ? '登録しました' : mode === 'items' ? `${included.length} 件を登録` : '登録'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 1件にまとめるときの既定カテゴリ: 明細の金額が最も大きいカテゴリ */
function majorityCategory(items: ReceiptItem[]): string | null {
  const sum = new Map<string, number>();
  for (const it of items) sum.set(it.category, (sum.get(it.category) ?? 0) + it.amount);
  let best: string | null = null;
  let bestV = -Infinity;
  for (const [k, v] of sum) if (v > bestV) { best = k; bestV = v; }
  return best;
}
