import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../context/ToastContext';
import { formatShort, todayStr } from '../../lib/date';
import { parseNum } from '../../lib/nutrition';
import { chargesFor, detectSubscriptions, monthlyEquivalent, subscriptionStatus, type SubscriptionCandidate } from '../../lib/subscriptions';
import type { Subscription, SubscriptionCycle, SubscriptionStatus } from '../../lib/types';
import { SUBSCRIPTION_CYCLE_LABELS, SUBSCRIPTION_STATUS_LABELS } from '../../lib/types';
import type { MoneyData } from '../../pages/MoneyPage';

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

/**
 * サブスクの画面。
 *  上: 支出から自動で見つけた「定期的な請求」の候補 → 登録 or 対象外
 *  下: 台帳。月額換算の合計、最後の請求日、次回の予定、解約候補・解約済みの管理
 */
export default function SubscriptionsPanel({ data, userId }: { data: MoneyData; userId: string }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const today = todayStr();

  const candidates = useMemo(() => detectSubscriptions(data.expenses, data.subscriptions), [data.expenses, data.subscriptions]);

  const rows = useMemo(() => data.subscriptions
    .filter((s) => s.status !== 'ignored')
    .map((s) => {
      const charges = chargesFor(s, data.expenses);
      return { sub: s, charges, info: subscriptionStatus(s, charges, today) };
    })
    .sort((a, b) => {
      const order: Record<SubscriptionStatus, number> = { review: 0, active: 1, cancelled: 2, ignored: 3 };
      if (order[a.sub.status] !== order[b.sub.status]) return order[a.sub.status] - order[b.sub.status];
      return monthlyEquivalent(b.sub.amount, b.sub.cycle) - monthlyEquivalent(a.sub.amount, a.sub.cycle);
    }), [data.subscriptions, data.expenses, today]);

  const ignored = data.subscriptions.filter((s) => s.status === 'ignored');
  const monthlyTotal = rows.filter((r) => r.sub.status === 'active' || r.sub.status === 'review')
    .reduce((s, r) => s + monthlyEquivalent(r.sub.amount, r.sub.cycle), 0);
  const reviewTotal = rows.filter((r) => r.sub.status === 'review')
    .reduce((s, r) => s + monthlyEquivalent(r.sub.amount, r.sub.cycle), 0);

  const register = async (c: SubscriptionCandidate, status: SubscriptionStatus) => {
    setBusyKey(c.key);
    setErr('');
    const { data: inserted, error } = await supabase.from('subscriptions').insert({
      user_id: userId, name: c.name, merchant_pattern: c.pattern, amount: status === 'ignored' ? null : c.amount,
      cycle: c.cycle, status, category: c.charges[0]?.category ?? null, started_on: c.firstDate,
    }).select('id').single();
    if (error) { setBusyKey(''); setErr(error.message); return; }
    if (status !== 'ignored' && inserted) {
      // 該当する過去の請求を台帳に結びつける（振り返りで「サブスク合計」に数えるため）
      await supabase.from('expenses').update({ subscription_id: inserted.id }).in('id', c.charges.map((e) => e.id));
    }
    await data.reload();
    setBusyKey('');
    toast(status === 'ignored' ? `${c.name} を対象外にしました` : `${c.name} を台帳に登録しました`);
  };

  const setStatus = async (s: Subscription, status: SubscriptionStatus) => {
    setErr('');
    const patch: Partial<Subscription> = { status };
    if (status === 'cancelled' && !s.cancelled_on) patch.cancelled_on = today;
    if (status !== 'cancelled') patch.cancelled_on = null;
    const { error } = await supabase.from('subscriptions').update(patch).eq('id', s.id);
    if (error) { setErr(error.message); return; }
    await data.reload();
  };

  const restore = async (s: Subscription) => {
    const { error } = await supabase.from('subscriptions').update({ status: 'active' }).eq('id', s.id);
    if (error) { setErr(error.message); return; }
    await data.reload();
  };

  return (
    <>
      <div className="card">
        <h2>サブスクの合計</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { label: '月額換算', value: yen(monthlyTotal) },
            { label: '年間', value: yen(monthlyTotal * 12) },
            { label: '解約候補を切れば', value: reviewTotal > 0 ? `月 ${yen(reviewTotal)} 浮く` : '—' },
          ].map((s) => (
            <div key={s.label} style={{ background: 'var(--fill-2)', borderRadius: 10, padding: '10px 12px' }}>
              <div className="muted" style={{ fontSize: 11 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          継続中と解約候補の合計。年額のものは 12 で割って月額に直しています。
        </p>
      </div>

      {err && <div className="error-box">{err}</div>}

      {candidates.length > 0 && (
        <div className="card">
          <h2>見つかった定期的な請求 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{candidates.length} 件</span></h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            支出の店名と間隔から推定しました。サブスクなら「登録」、違えば「対象外」を押してください（対象外は次から出ません）。
          </p>
          {candidates.map((c) => (
            <div className="entry" key={c.key} style={{ alignItems: 'flex-start' }}>
              <div className="main" style={{ minWidth: 0 }}>
                <div className="name" style={{ overflowWrap: 'anywhere' }}>{c.name}</div>
                <div className="sub">{yen(c.amount)} / {SUBSCRIPTION_CYCLE_LABELS[c.cycle]} ・ 最終 {formatShort(c.lastDate)}{c.nextExpected ? ` ・ 次回 ${formatShort(c.nextExpected)} 頃` : ''}</div>
                <div className="sub">{c.reason}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                <button className="btn small" disabled={busyKey === c.key} onClick={() => void register(c, 'active')}>登録</button>
                <button className="btn ghost small" disabled={busyKey === c.key} onClick={() => void register(c, 'ignored')}>対象外</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="section-title">
          <h2>台帳 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{rows.length} 件</span></h2>
          <button className="btn small outline" onClick={() => setCreating(true)}>＋ 手で追加</button>
        </div>
        {rows.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            まだ登録がありません。「取り込み」でカード明細を入れると、定期的な請求が上に候補として出ます。
          </div>
        )}
        {rows.map(({ sub, charges, info }) => (
          <div className="entry" key={sub.id} style={{ alignItems: 'flex-start', opacity: sub.status === 'cancelled' ? 0.6 : 1 }}>
            <button type="button" className="main entry-main" onClick={() => setEditing(sub)} style={{ minWidth: 0 }}>
              <div className="name" style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ overflowWrap: 'anywhere' }}>{sub.name}</span>
                <span className="chip" style={{
                  fontSize: 10, padding: '1px 6px',
                  background: sub.status === 'review' ? 'var(--danger-soft)' : undefined,
                  color: sub.status === 'review' ? 'var(--danger)' : undefined,
                }}>{SUBSCRIPTION_STATUS_LABELS[sub.status]}</span>
              </div>
              <div className="sub">
                {sub.amount != null ? `${yen(sub.amount)} / ${SUBSCRIPTION_CYCLE_LABELS[sub.cycle]}` : '金額未設定'}
                {sub.cycle === 'yearly' && sub.amount != null && ` (月 ${yen(sub.amount / 12)})`}
                {sub.category && ` ・ ${sub.category}`}
              </div>
              <div className="sub">
                {info.lastCharge ? `最終請求 ${formatShort(info.lastCharge.date)}（${charges.length} 回）` : '請求の記録なし'}
                {sub.status !== 'cancelled' && info.nextExpected && ` ・ 次回 ${formatShort(info.nextExpected)} 頃`}
              </div>
              {sub.status !== 'cancelled' && info.overdueDays != null && info.overdueDays > 7 && (
                <div className="sub" style={{ color: 'var(--primary-strong)' }}>予定日から {info.overdueDays} 日たっても請求がありません。解約済みなら「解約済み」に変えてください</div>
              )}
              {info.chargedAfterCancel && (
                <div className="sub" style={{ color: 'var(--danger)' }}>解約後（{formatShort(sub.cancelled_on!)}）の {formatShort(info.chargedAfterCancel.date)} に請求があります</div>
              )}
              {sub.note && <div className="sub">{sub.note}</div>}
            </button>
            <select value={sub.status} onChange={(e) => void setStatus(sub, e.target.value as SubscriptionStatus)} style={{ fontSize: 12, padding: '4px 6px', flexShrink: 0 }} aria-label="状態">
              <option value="active">継続中</option>
              <option value="review">解約候補</option>
              <option value="cancelled">解約済み</option>
            </select>
          </div>
        ))}
        {ignored.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>対象外にした店 {ignored.length} 件</summary>
            {ignored.map((s) => (
              <div className="entry" key={s.id}>
                <div className="main"><div className="sub">{s.name}</div></div>
                <button className="btn ghost small" onClick={() => void restore(s)}>戻す</button>
              </div>
            ))}
          </details>
        )}
      </div>

      {(editing || creating) && (
        <SubscriptionForm
          userId={userId}
          categories={data.categories}
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await data.reload(); toast('サブスクを保存しました'); }}
        />
      )}
    </>
  );
}

function SubscriptionForm({ userId, categories, initial, onClose, onSaved }: {
  userId: string; categories: string[]; initial: Subscription | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [pattern, setPattern] = useState(initial?.merchant_pattern ?? '');
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? '');
  const [cycle, setCycle] = useState<SubscriptionCycle>(initial?.cycle ?? 'monthly');
  const [status, setStatus] = useState<SubscriptionStatus>(initial?.status ?? 'active');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [cancelledOn, setCancelledOn] = useState(initial?.cancelled_on ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (name.trim() === '') { setErr('名前を入力してください。'); return; }
    const pat = pattern.trim() || name.trim();
    const amt = amount.trim() === '' ? null : parseNum(amount);
    if (amount.trim() !== '' && amt == null) { setErr('金額が数値ではありません。'); return; }
    setBusy(true);
    setErr('');
    const payload = {
      user_id: userId, name: name.trim(), merchant_pattern: pat, amount: amt, cycle, status,
      category: category || null, cancelled_on: status === 'cancelled' ? (cancelledOn || todayStr()) : null, note: note.trim() || null,
    };
    const res = initial
      ? await supabase.from('subscriptions').update(payload).eq('id', initial.id)
      : await supabase.from('subscriptions').insert(payload);
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    onSaved();
  };

  const del = async () => {
    if (!initial) return;
    if (!confirm('この登録を削除しますか？（支出は消えません）')) return;
    const { error } = await supabase.from('subscriptions').delete().eq('id', initial.id);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? 'サブスクを編集' : 'サブスクを追加'}</h2>
        {err && <div className="error-box">{err}</div>}
        <div className="field">
          <label>名前 *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: Netflix" autoFocus />
        </div>
        <div className="field">
          <label>明細の店名に含まれる文字（この文字を含む支出をこのサブスクの請求とみなす）</label>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="例: NETFLIX（空なら名前と同じ）" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>金額 (円)</label>
            <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例: 1490" />
          </div>
          <div className="field">
            <label>周期</label>
            <select value={cycle} onChange={(e) => setCycle(e.target.value as SubscriptionCycle)}>
              {(Object.keys(SUBSCRIPTION_CYCLE_LABELS) as SubscriptionCycle[]).map((c) => <option key={c} value={c}>{SUBSCRIPTION_CYCLE_LABELS[c]}</option>)}
            </select>
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>状態</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
              <option value="active">継続中</option>
              <option value="review">解約候補</option>
              <option value="cancelled">解約済み</option>
            </select>
          </div>
          <div className="field">
            <label>カテゴリ</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">（未設定）</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {status === 'cancelled' && (
          <div className="field">
            <label>解約日</label>
            <input type="date" value={cancelledOn} onChange={(e) => setCancelledOn(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label>メモ</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 年末に見直す / 家族で使っている" />
        </div>
        <div className="grid-2">
          <button className="btn outline" onClick={onClose}>キャンセル</button>
          <button className="btn" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
        {initial && <button className="btn danger outline full" style={{ marginTop: 10 }} onClick={() => void del()}>削除</button>}
      </div>
    </div>
  );
}
