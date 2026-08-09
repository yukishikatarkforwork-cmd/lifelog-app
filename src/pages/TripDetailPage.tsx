import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useReload } from '../lib/useReload';
import { callFunction } from '../lib/ai';
import {
  addChecklistItems, addItem, deleteChecklistItem, deleteItem, deleteTrip,
  fetchActualCost, getTrip, listChecklist, listItems, tripDates, tripLengthLabel,
} from '../lib/trips';
import type { Trip, TripChecklistItem, TripItem, TripItemKind } from '../lib/types';
import { TRIP_ITEM_KINDS } from '../lib/types';
import { addDays, formatShort } from '../lib/date';
import { IconTrash, IconTrip } from '../components/icons';

const KIND_ICON: Record<TripItemKind, string> = Object.fromEntries(
  TRIP_ITEM_KINDS.map((k) => [k.key, k.icon]),
) as Record<TripItemKind, string>;

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

interface DraftResponse {
  items: Array<{ day: number; start_time: string; kind: string; title: string; place: string; memo: string }>;
  checklist: string[];
}

export default function TripDetailPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { tripId = '' } = useParams();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<TripItem[]>([]);
  const [checklist, setChecklist] = useState<TripChecklistItem[]>([]);
  const [actual, setActual] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 予定の追加フォーム
  const [formDate, setFormDate] = useState('');
  const [time, setTime] = useState('');
  const [kind, setKind] = useState<TripItemKind>('see');
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [url, setUrl] = useState('');
  const [cost, setCost] = useState('');
  const [adding, setAdding] = useState(false);

  // 持ち物
  const [newCheck, setNewCheck] = useState('');

  // AI 下書き
  const [style, setStyle] = useState('');
  const [drafting, setDrafting] = useState(false);

  const reload = useReload(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const t = await getTrip(tripId);
      setTrip(t);
      if (t) {
        const [i, c, a] = await Promise.all([
          listItems(tripId), listChecklist(tripId), fetchActualCost(tripId),
        ]);
        setItems(i);
        setChecklist(c);
        setActual(a);
        setFormDate((prev) => prev || t.start_date);
      }
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  const submitItem = async () => {
    if (!user || !trip) return;
    setAdding(true);
    setError('');
    try {
      await addItem(user.id, trip.id, {
        date: formDate, start_time: time, kind, title, place, url, memo: '', cost,
      });
      setTitle(''); setPlace(''); setUrl(''); setCost(''); setTime('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setAdding(false);
    }
  };

  const addCheck = async () => {
    if (!user || !trip || newCheck.trim() === '') return;
    try {
      await addChecklistItems(user.id, trip.id, [newCheck]);
      setNewCheck('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました');
    }
  };

  const toggleCheck = async (item: TripChecklistItem) => {
    // 先に画面を更新して待たせない（失敗したら次の再読込で戻る）
    setChecklist((prev) => prev.map((c) => (c.id === item.id ? { ...c, checked: !c.checked } : c)));
    const { error: e } = await supabase
      .from('trip_checklist').update({ checked: !item.checked }).eq('id', item.id);
    if (e) { setError(e.message); await reload(); }
  };

  /** AI に下書きを作らせる。既存の予定は消さず追記する */
  const draft = async () => {
    if (!user || !trip) return;
    const days = tripDates(trip).length;
    setDrafting(true);
    setError('');
    try {
      const res = await callFunction('draft-trip', {
        destination: trip.destination || trip.title,
        days,
        start_date: trip.start_date,
        style,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `下書きの生成に失敗しました (${res.status})`);
      }
      const data = await res.json() as DraftResponse;

      const rows = data.items.map((it, i) => ({
        user_id: user.id,
        trip_id: trip.id,
        date: addDays(trip.start_date, Math.max(0, it.day - 1)),
        start_time: /^\d{1,2}:\d{2}$/.test(it.start_time) ? it.start_time : null,
        kind: (TRIP_ITEM_KINDS.some((k) => k.key === it.kind) ? it.kind : 'other') as TripItemKind,
        title: it.title,
        place: it.place || null,
        url: null,
        memo: it.memo || null,
        cost: null,
        sort_order: i,
      }));

      if (rows.length > 0) {
        const { error: e } = await supabase.from('trip_items').insert(rows);
        if (e) throw new Error(e.message);
      }
      await addChecklistItems(user.id, trip.id, data.checklist);
      await reload();
      toast(`下書きを ${rows.length} 件追加しました`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '下書きの生成に失敗しました');
    } finally {
      setDrafting(false);
    }
  };

  const removeTrip = async () => {
    if (!trip) return;
    if (!confirm(`「${trip.title}」を削除しますか？\n予定と持ち物もまとめて消えます（日記・写真・支出は残ります）。`)) return;
    try {
      await deleteTrip(trip.id);
      toast('しおりを削除しました');
      navigate('/trips');
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  if (loading) return <div className="page"><div className="empty">読み込み中…</div></div>;
  if (!trip) {
    return (
      <div className="page">
        <div className="empty">このしおりは見つかりませんでした。</div>
        <Link to="/trips" className="btn outline full" style={{ textDecoration: 'none', textAlign: 'center' }}>一覧へ戻る</Link>
      </div>
    );
  }

  const dates = tripDates(trip);
  const estimate = items.reduce((s, i) => s + (i.cost ?? 0), 0);
  const checkedCount = checklist.filter((c) => c.checked).length;

  return (
    <div className="page">
      <div className="section-title">
        <h2 style={{ marginTop: 0 }}><IconTrip size={18} /> {trip.title}</h2>
        <button className="btn ghost small" onClick={removeTrip} aria-label="しおりを削除"><IconTrash /></button>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        {formatShort(trip.start_date)} 〜 {formatShort(trip.end_date)} ・ {tripLengthLabel(trip)}
        {trip.destination && ` ・ ${trip.destination}`}
      </div>

      {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}

      {/* --- 予算と実績 --- */}
      <div className="card">
        <h2>費用</h2>
        <div className="row-between" style={{ fontSize: 14, padding: '3px 0' }}>
          <span className="muted">予算</span><span>{trip.budget != null ? yen(trip.budget) : '—'}</span>
        </div>
        <div className="row-between" style={{ fontSize: 14, padding: '3px 0' }}>
          <span className="muted">予定の合計（見積もり）</span><span>{yen(estimate)}</span>
        </div>
        <div className="row-between" style={{ fontSize: 14, padding: '3px 0' }}>
          <span className="muted">実際の支出（家計簿より）</span><span>{yen(actual)}</span>
        </div>
        {trip.budget != null && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {actual > trip.budget
              ? `予算を ${yen(actual - trip.budget)} 超えています。`
              : `予算まであと ${yen(trip.budget - actual)} です。`}
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
          実際の支出は、旅行期間中に家計簿へ記録した金額の合計です。
        </p>
      </div>

      {/* --- AI 下書き --- */}
      <div className="card">
        <h2>AI に下書きを作らせる</h2>
        <div className="field">
          <label>希望（任意）</label>
          <input
            data-testid="trip-style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="例: 寺と食べ歩き中心、移動は少なめ"
          />
        </div>
        <button data-testid="trip-draft" className="btn outline full" onClick={draft} disabled={drafting}>
          {drafting ? '作成中…' : 'たたき台を作る'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
          既存の予定は消さずに追加します。営業時間や料金は含まれません（変わりやすいため）。
          実際に行く前に必ず公式サイトで確認してください。
        </p>
      </div>

      {/* --- 日程 --- */}
      {dates.map((d, i) => {
        const dayItems = items.filter((it) => it.date === d);
        return (
          <div className="card" key={d}>
            <div className="section-title">
              <h2>{i + 1}日目 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{formatShort(d)}</span></h2>
              <Link to={`/day/${d}`} className="btn small outline" style={{ textDecoration: 'none' }}>この日の記録</Link>
            </div>
            {dayItems.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>予定はまだありません。</div>
            ) : (
              dayItems.map((it) => (
                <div key={it.id} className="row-between" style={{ borderTop: '1px solid var(--border)', padding: '8px 0', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>
                      <span style={{ marginRight: 6 }}>{KIND_ICON[it.kind]}</span>
                      {it.start_time && <span className="muted" style={{ marginRight: 6 }}>{it.start_time.slice(0, 5)}</span>}
                      <strong>{it.title}</strong>
                    </div>
                    {(it.place || it.cost != null) && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {[it.place, it.cost != null ? yen(it.cost) : null].filter(Boolean).join(' ・ ')}
                      </div>
                    )}
                    {it.memo && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{it.memo}</div>}
                    {it.url && (
                      <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>リンクを開く</a>
                    )}
                  </div>
                  <button
                    className="btn ghost small"
                    onClick={async () => { await deleteItem(it.id); await reload(); }}
                    aria-label="予定を削除"
                  >
                    <IconTrash />
                  </button>
                </div>
              ))
            )}
          </div>
        );
      })}

      {/* --- 予定の追加 --- */}
      <div className="card">
        <h2>予定を追加</h2>
        <div className="grid-2">
          <div className="field">
            <label>日</label>
            <select value={formDate} onChange={(e) => setFormDate(e.target.value)}>
              {dates.map((d, i) => <option key={d} value={d}>{i + 1}日目（{formatShort(d)}）</option>)}
            </select>
          </div>
          <div className="field">
            <label>時刻（任意）</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>種類</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {TRIP_ITEM_KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                title={k.label}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 18,
                  border: '1px solid var(--border)',
                  background: kind === k.key ? 'var(--primary)' : 'var(--input-bg)',
                }}
              >
                {k.icon}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>内容</label>
          <input data-testid="trip-item-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 清水寺を見る" />
        </div>
        <div className="field">
          <label>場所（任意）</label>
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例: 京都市東山区" />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>リンク（任意）</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="field">
            <label>費用の目安（任意）</label>
            <input type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="例: 400" />
          </div>
        </div>
        <button data-testid="trip-item-add" className="btn full" onClick={submitItem} disabled={adding || title.trim() === ''}>
          {adding ? '追加中…' : '予定を追加'}
        </button>
      </div>

      {/* --- 持ち物 --- */}
      <div className="card">
        <div className="section-title">
          <h2>持ち物</h2>
          {checklist.length > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>{checkedCount} / {checklist.length}</span>
          )}
        </div>
        {checklist.map((c) => (
          <div key={c.id} className="row-between" style={{ padding: '5px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, margin: 0 }}>
              <input
                type="checkbox"
                checked={c.checked}
                onChange={() => void toggleCheck(c)}
                style={{ width: 'auto' }}
              />
              <span style={{ fontSize: 14, textDecoration: c.checked ? 'line-through' : 'none', opacity: c.checked ? 0.6 : 1 }}>
                {c.text}
              </span>
            </label>
            <button
              className="btn ghost small"
              onClick={async () => { await deleteChecklistItem(c.id); await reload(); }}
              aria-label="持ち物を削除"
            >
              <IconTrash />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            data-testid="trip-check-text"
            value={newCheck}
            onChange={(e) => setNewCheck(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCheck(); } }}
            placeholder="例: 充電器"
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={addCheck} disabled={newCheck.trim() === ''}>追加</button>
        </div>
      </div>

      <Link to="/trips" className="btn outline full" style={{ textDecoration: 'none', textAlign: 'center' }}>
        しおり一覧へ戻る
      </Link>
    </div>
  );
}
