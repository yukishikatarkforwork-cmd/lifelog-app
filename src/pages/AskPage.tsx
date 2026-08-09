import { useRef, useState } from 'react';
import { supabase, supabaseUrl } from '../lib/supabase';
import { addDays, todayStr } from '../lib/date';
import { IconAsk } from '../components/icons';

/**
 * 期間のプリセット。days=null は「全期間（AI検索）」で、
 * サーバー側がベクトル検索に切り替わる（期間を選ばずに聞ける）。
 */
const RANGES: Array<{ label: string; days: number | null }> = [
  { label: '7日', days: 7 },
  { label: '30日', days: 30 },
  { label: '90日', days: 90 },
  { label: '1年', days: 365 },
  { label: '全期間', days: null },
];

/**
 * プリセット質問。向いているモードを持たせ、押されたら期間も一緒に切り替える。
 * 「いつだっけ」系を30日モードのまま投げても見つからないため。
 */
const PRESET_QUESTIONS: Array<{ text: string; days: number | null }> = [
  { text: '海の近くに行ったのはいつ？', days: null },
  { text: '体調が一番悪かった日は何があった？', days: null },
  { text: '外食した日をまとめて教えて', days: null },
  { text: '最近の体調の傾向を教えて。良い日と悪い日で何が違う？', days: 30 },
  { text: '気圧や天気と体調の関係はある？', days: 90 },
  { text: '食事のPFCバランスの問題点と、改善案を3つ教えて。', days: 30 },
  { text: '支出で削れそうなところはどこ？', days: 30 },
  { text: '睡眠時間は足りている？体調とどう関係している？', days: 90 },
];

export default function AskPage() {
  const [days, setDays] = useState<number | null>(30);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState('');
  const [mode, setMode] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => abortRef.current?.abort();

  const ask = async (q: string, overrideDays?: number | null) => {
    const text = q.trim();
    if (!text || running) return;
    const range = overrideDays !== undefined ? overrideDays : days;

    setError('');
    setAnswer('');
    setRunning(true);
    setThinking(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('ログインが必要です。'); return; }

      // 全期間モードでは期間を送らない。サーバー側がベクトル検索に切り替わる
      const end = todayStr();
      const payload = range === null
        ? { question: text, scope: 'all' }
        : { question: text, start: addDays(end, -(range - 1)), end };

      const res = await fetch(`${supabaseUrl}/functions/v1/ask-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        // エラー時は JSON で返ってくる
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `リクエストに失敗しました (${res.status})`);
        return;
      }

      setUsage(res.headers.get('X-Ai-Usage') ?? '');
      setMode(res.headers.get('X-Ai-Mode') ?? '');

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
        自分の記録（体調・天気気圧・食事・家計簿・日記）をもとに回答します。
        数値は SQL で集計した確定値を使うので、平均や合計は正確です。
      </p>

      <div className="card">
        <div className="field">
          <label>対象期間</label>
          <div className="tabs">
            {RANGES.map((r) => (
              <button
                key={r.label}
                className={days === r.days ? 'active' : ''}
                onClick={() => setDays(r.days)}
                disabled={running}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {days === null
              ? '記録全体から質問に関係する日を検索して答えます。「いつだっけ？」のように時期が分からない質問に向いています。'
              : 'この期間の記録をすべて見て答えます。「傾向は？」のように網羅性が要る質問に向いています。'}
          </div>
        </div>

        <div className="field">
          <label>質問</label>
          <textarea
            data-testid="ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={days === null ? '例: 江ノ島に行ったのはいつ？' : '例: 最近の体調の傾向は？'}
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
            {mode === 'search' && '検索モード ・ '}本日の利用: {usage}
          </div>
        )}
      </div>

      <div className="card">
        <h2>よくある質問</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          🔍 は全期間の検索モードで実行します（期間は自動で切り替わります）。
        </p>
        <div className="tag-input">
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q.text}
              type="button"
              className="tag"
              style={{ cursor: 'pointer', border: '1px solid var(--border)', textAlign: 'left' }}
              disabled={running}
              // 質問に合う期間へ自動で切り替える（切り替えの反映を待たず引数でも渡す）
              onClick={() => { setQuestion(q.text); setDays(q.days); void ask(q.text, q.days); }}
            >
              {q.days === null && <span className="muted" style={{ marginRight: 4 }}>🔍</span>}
              {q.text}
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
