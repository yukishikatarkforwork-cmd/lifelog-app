import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { buildImportKeys, decodeStatement, parseStatement, type StatementRow } from '../../lib/statement';
import { displayMerchant, guessMerchantCategory, looksLikeSubscription, merchantMatches, normalizeMerchant } from '../../lib/merchant';
import { formatShort } from '../../lib/date';
import type { MoneyData } from '../../pages/MoneyPage';

const CARD_NAME_KEY = 'lifelog.cardName';

interface PreviewRow extends StatementRow {
  key: string;
  include: boolean;
  category: string;
  guessed: string;
  /** 取込キーが既に登録済み（同じ明細を前にも取り込んだ） */
  dupKey: boolean;
  /** 同じ日に同額の手入力・レシートがある（二重計上かもしれない） */
  softDup: boolean;
  /** 台帳のサブスクに一致 */
  subscriptionId: string | null;
  subscriptionName: string | null;
  subscriptionLike: boolean;
}

/**
 * カード明細の取り込み。CSV ファイルか、明細ページをコピーした文字列を受け取り、
 * 列を自動判定 → プレビューでカテゴリと対象行を直す → 家計簿（expenses）に登録する。
 * 取り込んだ行には店名・カード名・取込キーが付き、同じ明細を二度取り込んでも重複しない。
 */
export default function StatementImport({ data, userId, onImported }: { data: MoneyData; userId: string; onImported: () => void }) {
  const toast = useToast();
  const [cardName, setCardName] = useState(() => {
    try { return localStorage.getItem(CARD_NAME_KEY) ?? '三井住友カード'; } catch { return '三井住友カード'; }
  });
  const [text, setText] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [parseInfo, setParseInfo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(CARD_NAME_KEY, cardName); } catch { /* 保存できなくても動作に支障なし */ }
  }, [cardName]);

  const knownCards = useMemo(() => {
    const names = new Set<string>();
    for (const e of data.expenses) if (e.card_name) names.add(e.card_name);
    return [...names];
  }, [data.expenses]);

  const existingKeys = useMemo(() => new Set(data.expenses.map((e) => e.import_key).filter((k): k is string => !!k)), [data.expenses]);

  const analyze = (source: string) => {
    setErr('');
    const parsed = parseStatement(source);
    if (parsed.rows.length === 0) {
      setRows(null);
      setErr('明細として読める行がありませんでした。日付・店名・金額が1行に並んだ CSV かコピーした表を貼り付けてください。');
      return;
    }
    const keys = buildImportKeys(cardName, parsed.rows);
    const subs = data.subscriptions.filter((s) => s.status !== 'ignored');
    const preview: PreviewRow[] = parsed.rows.map((r, i) => {
      const guessed = guessMerchantCategory(r.merchant, data.rules, data.categories);
      const dupKey = existingKeys.has(keys[i]);
      const softDup = data.expenses.some((e) => e.date === r.date && e.source !== 'card' && Math.round(e.amount) === r.amount);
      const sub = subs.find((s) => merchantMatches(r.merchant, s.merchant_pattern)) ?? null;
      return {
        ...r, key: keys[i], category: sub?.category && data.categories.includes(sub.category) ? sub.category : guessed, guessed,
        dupKey, softDup, subscriptionId: sub?.id ?? null, subscriptionName: sub?.name ?? null,
        subscriptionLike: !sub && looksLikeSubscription(r.merchant),
        include: r.amount > 0 && !dupKey && !softDup,
      };
    });
    setRows(preview);
    const notes = [`${preview.length} 行を読み取りました`];
    const dups = preview.filter((p) => p.dupKey).length;
    if (dups > 0) notes.push(`${dups} 行は取り込み済み`);
    const soft = preview.filter((p) => p.softDup && !p.dupKey).length;
    if (soft > 0) notes.push(`${soft} 行は同日同額の手入力あり（チェックを外しています）`);
    const refunds = preview.filter((p) => p.amount <= 0).length;
    if (refunds > 0) notes.push(`${refunds} 行は返金・調整（対象外）`);
    if (parsed.unparsed > 0) notes.push(`${parsed.unparsed} 行は読めずスキップ`);
    setParseInfo(notes.join(' / '));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const decoded = decodeStatement(await file.arrayBuffer());
    setText(decoded);
    analyze(decoded);
    if (fileRef.current) fileRef.current.value = '';
  };

  const update = (key: string, patch: Partial<PreviewRow>) =>
    setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);

  const selected = rows?.filter((r) => r.include) ?? [];
  const selectedTotal = selected.reduce((s, r) => s + r.amount, 0);

  const save = async () => {
    if (!rows || selected.length === 0) return;
    if (cardName.trim() === '') { setErr('カード名を入力してください（取り込み元の区別に使います）。'); return; }
    setBusy(true);
    setErr('');
    const payload = selected.map((r) => ({
      user_id: userId, date: r.date, amount: r.amount, category: r.category, payment_method: 'クレジット',
      memo: displayMerchant(r.merchant) || null, merchant: displayMerchant(r.merchant) || null,
      source: 'card', card_name: cardName.trim(), import_key: r.key, subscription_id: r.subscriptionId,
    }));
    // 取込キーが既にある行は黙って飛ばす（ignoreDuplicates）。同じ CSV をもう一度流しても二重にならない
    const { error } = await supabase.from('expenses').upsert(payload, { onConflict: 'user_id,import_key', ignoreDuplicates: true });
    if (error) { setBusy(false); setErr(error.message); return; }

    // カテゴリを直した店名は覚える（次回から自動で当たる）
    const learned = new Map<string, string>();
    for (const r of selected) {
      if (r.category !== r.guessed && r.merchant.trim() !== '') learned.set(normalizeMerchant(r.merchant), r.category);
    }
    if (learned.size > 0) {
      const inserts: Array<{ user_id: string; pattern: string; category: string }> = [];
      const updates: Array<{ id: string; category: string }> = [];
      for (const r of selected) {
        const norm = normalizeMerchant(r.merchant);
        const cat = learned.get(norm);
        if (!cat) continue;
        learned.delete(norm);
        const existing = data.rules.find((x) => normalizeMerchant(x.pattern) === norm);
        if (existing) { if (existing.category !== cat) updates.push({ id: existing.id, category: cat }); }
        else inserts.push({ user_id: userId, pattern: displayMerchant(r.merchant), category: cat });
      }
      if (inserts.length > 0) await supabase.from('merchant_rules').insert(inserts);
      for (const u of updates) await supabase.from('merchant_rules').update({ category: u.category }).eq('id', u.id);
    }

    await data.reload();
    setBusy(false);
    setRows(null);
    setText('');
    toast(`${payload.length} 件を家計簿に登録しました`);
    onImported();
  };

  return (
    <>
      <div className="card">
        <h2>明細を読み込む</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          カード会社のサイト（三井住友カードなら Vpass の「ご利用明細」）から CSV をダウンロードして選ぶか、
          明細の表を範囲選択してコピーし、下の欄に貼り付けてください。日付・店名・金額の列は自動で見つけます。
          Shift_JIS の CSV もそのまま読めます。
        </p>
        <div className="field">
          <label>カード名</label>
          <input list="card-names" value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="例: 三井住友カード" data-testid="import-card-name" />
          <datalist id="card-names">{knownCards.map((n) => <option key={n} value={n} />)}</datalist>
        </div>
        <div className="field">
          <label>明細（CSV の中身、またはコピーした表）</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'2026/11/01,ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ,680\n2026/11/02,NETFLIX.COM,1490'} style={{ minHeight: 110, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} data-testid="import-text" />
        </div>
        <div className="grid-2">
          <button className="btn outline" onClick={() => fileRef.current?.click()} disabled={busy}>CSV ファイルを選ぶ</button>
          <button className="btn" onClick={() => analyze(text)} disabled={busy || text.trim() === ''} data-testid="import-analyze">読み取る</button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }} onChange={(e) => void onFile(e.target.files?.[0])} />
        {err && <div className="error-box" style={{ marginTop: 12 }}>{err}</div>}
      </div>

      {rows && (
        <div className="card">
          <div className="section-title">
            <h2>確認して登録</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn ghost small" onClick={() => setRows((rs) => rs?.map((r) => ({ ...r, include: r.amount > 0 && !r.dupKey })) ?? null)}>全て選択</button>
              <button className="btn ghost small" onClick={() => setRows((rs) => rs?.map((r) => ({ ...r, include: false })) ?? null)}>全て解除</button>
            </div>
          </div>
          <div className="info-box" style={{ fontSize: 12 }}>{parseInfo}</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            カテゴリは店名から推定しています。直したものは次回から自動で同じカテゴリになります。
          </p>

          {rows.map((r) => (
            <div className="entry" key={r.key} style={{ opacity: r.include ? 1 : 0.55, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={r.include} disabled={r.amount <= 0 || r.dupKey}
                onChange={(e) => update(r.key, { include: e.target.checked })} style={{ marginTop: 4, marginRight: 8 }} aria-label="登録する" />
              <div className="main" style={{ minWidth: 0 }}>
                <div className="name" style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{formatShort(r.date)}</span>
                  <span style={{ overflowWrap: 'anywhere' }}>{displayMerchant(r.merchant) || '(店名なし)'}</span>
                </div>
                <div className="sub" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={r.category} onChange={(e) => update(r.key, { category: e.target.value })} style={{ fontSize: 12, padding: '2px 6px' }} aria-label="カテゴリ">
                    {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {r.dupKey && <span className="chip" style={{ fontSize: 10 }}>取り込み済み</span>}
                  {!r.dupKey && r.softDup && <span className="chip" style={{ fontSize: 10, background: 'var(--danger-soft)', color: 'var(--danger)' }}>同日同額の記録あり</span>}
                  {r.amount <= 0 && <span className="chip" style={{ fontSize: 10 }}>返金・調整</span>}
                  {r.subscriptionName && <span className="chip" style={{ fontSize: 10, background: 'var(--accent-soft)', color: 'var(--primary-strong)' }}>サブスク: {r.subscriptionName}</span>}
                  {r.subscriptionLike && <span className="chip" style={{ fontSize: 10 }}>サブスクかも</span>}
                </div>
              </div>
              <div className="kcal" style={{ color: r.amount < 0 ? 'var(--danger)' : 'var(--text)' }}>¥{r.amount.toLocaleString()}</div>
            </div>
          ))}

          <div className="row-between" style={{ marginTop: 14 }}>
            <div><strong>{selected.length} 件</strong> <span className="muted">合計 ¥{selectedTotal.toLocaleString()}</span></div>
            <button className="btn" onClick={() => void save()} disabled={busy || selected.length === 0} data-testid="import-save">
              {busy ? '登録中…' : '家計簿に登録'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
