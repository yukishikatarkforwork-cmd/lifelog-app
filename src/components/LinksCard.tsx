import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { LinkEntry } from '../lib/types';
import { useReload } from '../lib/useReload';
import { callFunction, reindexInBackground } from '../lib/ai';
import { IconLink, IconTrash } from './icons';

/** URL からドメインだけ取り出す（タイトルが取れなかったときの表示に使う） */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * その日に関係する URL を残す。
 * タイトルは Edge Function 経由で取得し、AI 検索の対象にもなる。
 *
 * readOnly は共有された他人のカレンダーを見るとき用。
 */
export default function LinksCard({
  date,
  ownerId,
  readOnly = false,
}: {
  date: string;
  ownerId?: string;
  readOnly?: boolean;
}) {
  const { user } = useAuth();
  const [links, setLinks] = useState<LinkEntry[]>([]);
  const [url, setUrl] = useState('');
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const reload = useReload(async () => {
    setLoading(true);
    let query = supabase.from('links').select('*').eq('date', date).order('created_at');
    // 共有で他人の行も見える RLS なので、自分の分は自分の id で絞る
    query = query.eq('user_id', ownerId ?? user?.id ?? '');
    const { data, error: e } = await query;
    if (e) setError(e.message);
    setLinks((data as LinkEntry[]) ?? []);
    setLoading(false);
  }, [date, ownerId]);

  const add = async () => {
    if (!user) return;
    const raw = url.trim();
    if (raw === '') return;

    // スキーム省略を許す（https:// を打つのは面倒なので）
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      new URL(normalized);
    } catch {
      setError('URL の形式が正しくありません。');
      return;
    }

    setAdding(true);
    setError('');

    // タイトルは取れなくても登録は進める（取得失敗で入力を捨てない）
    let title: string | null = null;
    try {
      const res = await callFunction('fetch-link-title', { url: normalized });
      if (res.ok) title = ((await res.json()) as { title: string | null }).title;
    } catch {
      // 取得できなくても致命的ではない
    }

    const { error: e } = await supabase.from('links').insert({
      user_id: user.id, date, url: normalized, title, memo: memo.trim() || null,
    });
    setAdding(false);
    if (e) { setError(e.message); return; }

    setUrl('');
    setMemo('');
    await reload();
    // タイトルは検索の手がかりになるので索引に反映する
    reindexInBackground([date]);
  };

  const remove = async (id: string) => {
    if (!confirm('このリンクを削除しますか？')) return;
    const { error: e } = await supabase.from('links').delete().eq('id', id);
    if (e) { setError(e.message); return; }
    await reload();
    reindexInBackground([date]);
  };

  if (readOnly && !loading && links.length === 0) return null;

  return (
    <div className="card">
      <div className="section-title"><h2><IconLink /> リンク</h2></div>

      {error && <div className="error-box">{error}</div>}

      {!readOnly && (
        <>
          <div className="field">
            <label>URL</label>
            <input
              data-testid="link-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/..."
            />
          </div>
          <div className="field">
            <label>メモ（任意）</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="予約したお店、など" />
          </div>
          <button data-testid="link-add" className="btn full" onClick={add} disabled={adding || url.trim() === ''}>
            {adding ? '追加中…' : 'リンクを追加'}
          </button>
        </>
      )}

      {loading ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>読み込み中…</div>
      ) : links.length === 0 ? (
        !readOnly && <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>まだリンクがありません。</div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {links.map((l) => (
            <div key={l.id} className="row-between" style={{ borderTop: '1px solid var(--border)', padding: '8px 0', gap: 8 }}>
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {l.title ?? hostOf(l.url)}
                </div>
                <div className="muted" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{hostOf(l.url)}</div>
                {l.memo && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{l.memo}</div>}
              </a>
              {!readOnly && (
                <button className="btn ghost small" onClick={() => void remove(l.id)} aria-label="リンクを削除">
                  <IconTrash />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
