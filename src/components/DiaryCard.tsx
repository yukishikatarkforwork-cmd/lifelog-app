import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { DiaryEntry } from '../lib/types';
import { DIARY_TAG_SUGGESTIONS } from '../lib/types';
import { useReload } from '../lib/useReload';
import { reindexInBackground } from '../lib/ai';
import TagEditor from './TagEditor';
import { IconDiary, IconTrash } from './icons';

export default function DiaryCard({ date }: { date: string }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const reload = useReload(async () => {
    const { data } = await supabase.from('diary_entries').select('*').eq('date', date).maybeSingle();
    const d = data as DiaryEntry | null;
    setTitle(d?.title ?? '');
    setBody(d?.body ?? '');
    setTags(d?.tags ?? []);
    setExists(Boolean(d));
    setSaved(false);
    setErr('');
  }, [date]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setErr('');
    const { error } = await supabase.from('diary_entries').upsert(
      {
        user_id: user.id, date,
        title: title.trim() || null,
        body: body.trim(),
        tags,
      },
      { onConflict: 'user_id,date' },
    );
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setExists(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    // 検索インデックスを追従させる（失敗しても日記自体は保存済みなので待たない）
    reindexInBackground([date]);
  };

  const remove = async () => {
    if (!confirm('この日の日記を削除しますか？')) return;
    const { error } = await supabase.from('diary_entries').delete().eq('date', date);
    if (error) { setErr(error.message); return; }
    await reload();
    reindexInBackground([date]);
  };

  // タイトルだけ・タグだけの保存は実質空の日記になるので本文を必須にする
  const canSave = body.trim() !== '';

  return (
    <div className="card">
      <div className="section-title">
        <h2><IconDiary /> 日記</h2>
        {exists && (
          <button className="btn ghost small" onClick={remove} aria-label="日記を削除"><IconTrash /></button>
        )}
      </div>
      {err && <div className="error-box">{err}</div>}

      <div className="field">
        <label>タイトル（任意）</label>
        <input
          data-testid="diary-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 江ノ島に行った"
        />
      </div>
      <div className="field">
        <label>本文</label>
        <textarea
          data-testid="diary-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="今日あったこと、行った場所、感じたことなど"
          style={{ minHeight: 140 }}
        />
      </div>
      <div className="field">
        <label>タグ</label>
        <TagEditor tags={tags} onChange={setTags} suggested={DIARY_TAG_SUGGESTIONS} />
      </div>
      <button data-testid="diary-save" className="btn full" onClick={save} disabled={saving || !canSave}>
        {saving ? '保存中…' : saved ? '保存しました ✓' : '日記を保存'}
      </button>
    </div>
  );
}
