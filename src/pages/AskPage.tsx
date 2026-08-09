import { useRef, useState } from 'react';
import { supabase, supabaseUrl } from '../lib/supabase';
import { addDays, todayStr } from '../lib/date';
import { IconAsk } from '../components/icons';

/** 期間のプリセット。日数で持ち、送信時に開始日へ変換する */
const RANGES = [
  { label: '直近7日', days: 7 },
  { label: '直近30日', days: 30 },
  { label: '直近90日', days: 90 },
  { label: '直近1年', days: 365 },
];

const PRESET_QUESTIONS = [
  '最近の体調の傾向を教えて。良い日と悪い日で何が違う？',
  '気圧や天気と体調の関係はある？',
  '食事のPFCバランスの問題点と、改善案を3つ教えて。',
  '支出で削れそうなところはどこ？',
  '睡眠時間は足りている？体調とどう関係している？',
  '日記から、この期間で印象に残っている出来事をまとめて。',
];

export default function AskPage() {
  const [days, setDays] = useState(30);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => abortRef.current?.abort();

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || running) return;

    setError('');
    setAnswer('');
    setRunning(true);
    setThinking(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('ログインが必要です。'); return; }

      const end = todayStr();
      const start = addDays(end, -(days - 1));

      const res = await fetch(`${supabaseUrl}/functions/v1/ask-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question: text, start, end }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // エラー時は JSON で返ってくる
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `リクエストに失敗しました (${res.status})`);
        return;
      }

      setUsage(res.headers.get('X-Ai-Usage') ?? '');

      const reader = res.body?.getReader();
      if (!reader) { setError('回答を受け取れませんでした。'); return; }
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setThinking(false);
        setAnswer((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // 中断は正常系
      } else {
        setError(e instanceof Error ? e.message : '不明なエラーが発生しました');
      }
    } finally {
      setRunning(false);
      setThinking(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}><IconAsk size={18} /> AI に聞く</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        選んだ期間の記録（体調・天気気圧・食事・家計簿・日記）をもとに回答します。
      </p>

      <div className="card">
        <div className="field">
          <label>対象期間</label>
          <div className="tabs">
            {RANGES.map((r) => (
              <button
                key={r.days}
                className={days === r.days ? 'active' : ''}
                onClick={() => setDays(r.days)}
                disabled={running}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>質問</label>
          <textarea
            data-testid="ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="例: 先月の平均体調は？ / 江ノ島に行ったのはいつ？"
            style={{ minHeight: 90 }}
          />
        </div>

        <div className="stack-sm">
          <button
            data-testid="ask-submit"
            className="btn full"
            onClick={() => ask(question)}
            disabled={running || question.trim() === ''}
          >
            {running ? '回答中…' : 'この内容で聞く'}
          </button>
          {running && (
            <button className="btn outline full" onClick={stop}>中断する</button>
          )}
        </div>
        {usage && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8, textAlign: 'right' }}>
            本日の利用: {usage}
          </div>
        )}
      </div>

      <div className="card">
        <h2>よくある質問</h2>
        <div className="tag-input">
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="tag"
              style={{ cursor: 'pointer', border: '1px solid var(--border)', textAlign: 'left' }}
              disabled={running}
              onClick={() => { setQuestion(q); void ask(q); }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {(thinking || answer) && (
        <div className="card">
          <h2>回答</h2>
          {thinking && !answer ? (
            <div className="muted" style={{ fontSize: 13 }}>記録を読んで考えています…</div>
          ) : (
            <div data-testid="ask-answer" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 14 }}>
              {answer}
              {running && <span className="muted">▌</span>}
            </div>
          )}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        回答は記録に基づく参考情報です。体調の不安がある場合は医療機関に相談してください。
      </p>
    </div>
  );
}
