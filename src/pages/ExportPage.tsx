import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { MealEntry } from '../lib/types';
import { addDays, todayStr } from '../lib/date';
import { toCSV, toMarkdown } from '../lib/export';

// Excel が UTF-8 の日本語を正しく開けるよう先頭に付ける BOM マーカー
const BOM = String.fromCharCode(0xfeff);

function download(filename: string, content: string, mime: string, bom = false) {
  const blob = new Blob([bom ? BOM + content : content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ExportPage() {
  const [start, setStart] = useState(addDays(todayStr(), -29));
  const [end, setEnd] = useState(todayStr());
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error } = await supabase
      .from('meal_entries')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date')
      .order('created_at');
    if (error) setError(error.message);
    setEntries((data as MealEntry[]) ?? []);
    setLoading(false);
  }, [start, end]);

  useEffect(() => { void load(); }, [load]);

  const title = `食事記録 ${start} 〜 ${end}`;
  const md = useMemo(() => toMarkdown(entries, title), [entries, title]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('クリップボードへのコピーに失敗しました。');
    }
  };

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>データ出力</h2>

      <div className="card">
        <div className="grid-2">
          <div className="field">
            <label>開始日</label>
            <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label>終了日</label>
            <input type="date" value={end} min={start} max={todayStr()} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {loading ? '読み込み中…' : `対象: ${entries.length} 件`}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h2>ダウンロード</h2>
        <div className="stack-sm">
          <button
            className="btn full"
            disabled={entries.length === 0}
            onClick={() => download(`lifelog-meals-${start}_${end}.csv`, toCSV(entries), 'text/csv;charset=utf-8', true)}
          >
            CSV をダウンロード
          </button>
          <button
            className="btn outline full"
            disabled={entries.length === 0}
            onClick={() => download(`lifelog-meals-${start}_${end}.md`, md, 'text/markdown;charset=utf-8')}
          >
            Markdown をダウンロード
          </button>
          <button className="btn outline full" disabled={entries.length === 0} onClick={onCopy}>
            {copied ? 'コピーしました ✓' : 'Markdown をコピー（AI に貼り付け用）'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Markdown プレビュー</h2>
        <textarea
          readOnly
          value={md}
          style={{ width: '100%', minHeight: 240, fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>
    </div>
  );
}
