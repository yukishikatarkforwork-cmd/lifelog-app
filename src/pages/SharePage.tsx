import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useReload } from '../lib/useReload';
import {
  acceptShare, createShare, listIncoming, listOutgoing, revokeShare,
} from '../lib/shares';
import type { Share, ShareScope } from '../lib/types';
import { SHARE_SCOPE_LABELS, SHARE_SCOPE_OPTIONS } from '../lib/types';
import { IconShare, IconTrash } from '../components/icons';

/** 既定は日記と写真だけ。体調・家計簿は明示的に選ばないと共有されない */
const DEFAULT_SCOPES: ShareScope[] = ['diary', 'photo'];

function ScopeBadges({ scopes }: { scopes: ShareScope[] }) {
  return (
    <div style={{ marginTop: 4 }}>
      {scopes.map((s) => <span className="tag" key={s}>{SHARE_SCOPE_LABELS[s] ?? s}</span>)}
    </div>
  );
}

function periodLabel(s: Share): string {
  if (!s.start_date && !s.end_date) return '全期間';
  return `${s.start_date ?? '最初'} 〜 ${s.end_date ?? '最新'}`;
}

export default function SharePage() {
  const { user } = useAuth();
  const toast = useToast();
  const email = user?.email ?? '';

  const [outgoing, setOutgoing] = useState<Share[]>([]);
  const [incoming, setIncoming] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 新規共有フォーム
  const [invitee, setInvitee] = useState('');
  const [scopes, setScopes] = useState<ShareScope[]>(DEFAULT_SCOPES);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useReload(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [out, inc] = await Promise.all([listOutgoing(user.id), listIncoming(user.id, email)]);
      setOutgoing(out);
      setIncoming(inc);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [user?.id, email]);

  const toggleScope = (s: ShareScope) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const submit = async () => {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      await createShare({
        ownerId: user.id,
        ownerEmail: email,
        inviteeEmail: invitee,
        scopes,
        startDate: start || null,
        endDate: end || null,
      });
      setInvitee('');
      setScopes(DEFAULT_SCOPES);
      setStart('');
      setEnd('');
      await reload();
      toast('共有を作成しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '共有の作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const onRevoke = async (s: Share) => {
    if (!confirm(`${s.invitee_email} との共有を解除しますか？\n相手からはすぐに見えなくなります。`)) return;
    try {
      await revokeShare(s.id);
      await reload();
      toast('共有を解除しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '解除に失敗しました');
    }
  };

  const onAccept = async (s: Share) => {
    try {
      await acceptShare(s.id);
      await reload();
      toast('共有を承諾しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '承諾に失敗しました');
    }
  };

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}><IconShare size={18} /> カレンダー共有</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        自分の記録を相手に<strong>読み取り専用</strong>で見せます。相手が書き換えることはできません。
        共有する項目と期間を選べるので、日記だけ見せて体調や家計簿は隠す、といった使い方ができます。
      </p>

      {error && <div className="error-box">{error}</div>}

      {/* --- 新規共有 --- */}
      <div className="card">
        <h2>共有を作成する</h2>
        <div className="field">
          <label>相手のメールアドレス</label>
          <input
            data-testid="share-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={invitee}
            onChange={(e) => setInvitee(e.target.value)}
            placeholder="partner@example.com"
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            相手もこのアプリに登録している必要があります。同じメールアドレスでログインすると招待が表示されます。
          </div>
        </div>

        <div className="field">
          <label>共有する項目</label>
          <div className="tag-input">
            {SHARE_SCOPE_OPTIONS.map((o) => {
              const on = scopes.includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  className="tag"
                  data-testid={`scope-${o.key}`}
                  onClick={() => toggleScope(o.key)}
                  style={{
                    cursor: 'pointer',
                    border: `1px solid ${o.note && !on ? 'var(--danger)' : 'var(--border)'}`,
                    background: on ? 'var(--primary)' : 'var(--fill-2)',
                    color: on ? '#fff' : 'var(--muted)',
                  }}
                >
                  {o.label}{o.note && !on ? ' ⚠' : ''}
                </button>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            ⚠ の項目（体調・服薬・家計簿）はとくに機微な情報です。本当に見せてよいか確認してください。
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>開始日（空欄で制限なし）</label>
            <input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label>終了日（空欄で制限なし）</label>
            <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <button
          data-testid="share-create"
          className="btn full"
          onClick={submit}
          disabled={saving || invitee.trim() === '' || scopes.length === 0}
        >
          {saving ? '作成中…' : '共有を作成'}
        </button>
      </div>

      {/* --- 自分が共有しているもの --- */}
      <div className="card">
        <h2>共有中（自分 → 相手）</h2>
        {loading ? (
          <div className="muted" style={{ fontSize: 13 }}>読み込み中…</div>
        ) : outgoing.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>まだ誰にも共有していません。</div>
        ) : (
          outgoing.map((s) => (
            <div key={s.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div className="row-between">
                <strong style={{ fontSize: 14 }}>{s.invitee_email}</strong>
                <button className="btn ghost small" onClick={() => void onRevoke(s)} aria-label="共有を解除">
                  <IconTrash />
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {s.status === 'accepted' ? '承諾済み' : '承諾待ち'} ・ {periodLabel(s)}
              </div>
              <ScopeBadges scopes={s.scopes} />
            </div>
          ))
        )}
      </div>

      {/* --- 自分に共有されているもの --- */}
      <div className="card">
        <h2>共有されている（相手 → 自分）</h2>
        {loading ? (
          <div className="muted" style={{ fontSize: 13 }}>読み込み中…</div>
        ) : incoming.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>共有されているカレンダーはありません。</div>
        ) : (
          incoming.map((s) => (
            <div key={s.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div className="row-between">
                <strong style={{ fontSize: 14 }}>{s.owner_email}</strong>
                {s.status === 'accepted' ? (
                  <Link to={`/shared/${s.owner_id}`} className="btn small outline" style={{ textDecoration: 'none' }}>
                    見る
                  </Link>
                ) : (
                  <button
                    data-testid="share-accept"
                    className="btn small"
                    onClick={() => void onAccept(s)}
                  >
                    承諾する
                  </button>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{periodLabel(s)}</div>
              <ScopeBadges scopes={s.scopes} />
            </div>
          ))
        )}
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        共有は読み取り専用です。解除するとその時点で相手からは一切見えなくなります。
      </p>
    </div>
  );
}
