import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useReload } from '../lib/useReload';
import { createTrip, listTrips, tripLengthLabel } from '../lib/trips';
import type { Trip } from '../lib/types';
import { formatShort, todayStr } from '../lib/date';
import { IconTrip } from '../components/icons';

export default function TripsPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [budget, setBudget] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useReload(async () => {
    setLoading(true);
    try {
      setTrips(await listTrips());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const submit = async () => {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      await createTrip(user.id, { title, destination, start_date: start, end_date: end, budget });
      setTitle(''); setDestination(''); setStart(''); setEnd(''); setBudget('');
      setOpen(false);
      await reload();
      toast('しおりを作成しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const today = todayStr();
  const upcoming = trips.filter((t) => t.end_date >= today);
  const past = trips.filter((t) => t.end_date < today);

  const card = (t: Trip) => (
    <Link
      to={`/trips/${t.id}`}
      key={t.id}
      className="card"
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div className="row-between">
        <strong>{t.title}</strong>
        <span className="muted" style={{ fontSize: 12 }}>{tripLengthLabel(t)}</span>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        {formatShort(t.start_date)} 〜 {formatShort(t.end_date)}
        {t.destination && ` ・ ${t.destination}`}
      </div>
    </Link>
  );

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}><IconTrip size={18} /> 旅のしおり</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        旅行の予定をまとめます。旅行が終わると、その期間の日記・写真・支出が自動でここに集まり、旅の記録になります。
      </p>

      {error && <div className="error-box">{error}</div>}

      {!open ? (
        <button data-testid="trip-new" className="btn full" onClick={() => setOpen(true)}>＋ しおりを作る</button>
      ) : (
        <div className="card">
          <h2>新しいしおり</h2>
          <div className="field">
            <label>タイトル</label>
            <input data-testid="trip-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 京都旅行" />
          </div>
          <div className="field">
            <label>行き先（任意）</label>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="例: 京都" />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>出発日</label>
              {/* 未来の日付を入れる画面。記録用の入力と違い max を付けない */}
              <input data-testid="trip-start" type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>帰着日</label>
              <input data-testid="trip-end" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>予算（任意・円）</label>
            <input type="number" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="例: 50000" />
          </div>
          <div className="stack-sm">
            <button data-testid="trip-create" className="btn full" onClick={submit} disabled={saving || title.trim() === '' || !start || !end}>
              {saving ? '作成中…' : '作成する'}
            </button>
            <button className="btn outline full" onClick={() => setOpen(false)}>キャンセル</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : trips.length === 0 ? (
        <div className="empty">まだしおりがありません。<br />旅行の予定を作ってみましょう。</div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <h2 style={{ fontSize: 15 }}>これからの旅</h2>
              {upcoming.map(card)}
            </>
          )}
          {past.length > 0 && (
            <>
              <h2 style={{ fontSize: 15 }}>これまでの旅</h2>
              {past.map(card)}
            </>
          )}
        </>
      )}
    </div>
  );
}
