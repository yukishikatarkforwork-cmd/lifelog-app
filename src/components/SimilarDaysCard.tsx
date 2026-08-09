import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSimilarDays, type SimilarDay } from '../lib/ai';
import { formatShort } from '../lib/date';
import { IconAsk } from './icons';

/**
 * 「この日と似た日」。
 * 日別の要約ベクトルどうしの近傍検索なので、体調・天気・食事・日記をまとめて見て似ている日が出る。
 * 押されたときだけ検索する（毎日の入力画面で常に走らせる必要はないため）。
 */
export default function SimilarDaysCard({ date }: { date: string }) {
  const [days, setDays] = useState<SimilarDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchSimilarDays(date, 5);
      setDays(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '検索に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="section-title">
        <h2><IconAsk /> 似た日を探す</h2>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        体調・天気・食事・日記をまとめて見て、この日と近い過去の日を探します。
      </p>

      <button data-testid="similar-search" className="btn outline full" onClick={search} disabled={loading}>
        {loading ? '検索中…' : 'この日と似た日を探す'}
      </button>

      {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}

      {days && days.length === 0 && (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          似た日が見つかりませんでした。記録が増えるか、設定画面で検索インデックスを作り直すと精度が上がります。
        </div>
      )}

      {days && days.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {days.map((d) => (
            <Link
              to={`/day/${d.date}`}
              key={d.date}
              style={{
                display: 'block', textDecoration: 'none', color: 'inherit',
                padding: '8px 0', borderTop: '1px solid var(--border)',
              }}
            >
              <div className="row-between">
                <strong style={{ fontSize: 14 }}>{formatShort(d.date)}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  類似度 {(d.similarity * 100).toFixed(0)}%
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {d.content.length > 90 ? `${d.content.slice(0, 90)}…` : d.content}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
