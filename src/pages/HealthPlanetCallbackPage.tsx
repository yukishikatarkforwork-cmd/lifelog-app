import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { completeHealthPlanetAuth } from '../lib/body';

type View = { state: 'working' | 'done' | 'error'; message: string };

/** URL のパラメータだけで決まる初期表示（code が無い・拒否された場合はここで確定） */
function initialView(params: URLSearchParams): View {
  const error = params.get('error');
  if (error) return { state: 'error', message: `Health Planet で許可されませんでした（${error}）。` };
  if (!params.get('code')) return { state: 'error', message: '認可コードが見つかりませんでした。' };
  return { state: 'working', message: 'Health Planet と接続しています…' };
}

/**
 * Health Planet の認可画面から戻ってくる先。
 * URL の code を Edge Function に渡してトークンに交換し、過去分を取り込む。
 * code は10分で失効し一度しか使えないので、この画面は再読み込みしても再試行しない。
 */
export default function HealthPlanetCallbackPage() {
  const [params] = useSearchParams();
  const [view, setView] = useState<View>(() => initialView(params));
  const started = useRef(false);

  useEffect(() => {
    const code = params.get('code');
    // StrictMode の二重実行で code を2回使わないようにする
    if (!code || params.get('error') || started.current) return;
    started.current = true;

    void completeHealthPlanetAuth(code, params.get('state')).then(
      (r) => setView({
        state: 'done',
        message: r.warning
          ? `連携しました。ただし取り込みに失敗しました: ${r.warning}`
          : r.synced === 0
            ? '連携しました。まだ測定データはありません。体組成計に乗ると自動で取り込まれます。'
            : `連携しました。過去 ${r.synced} 日分の測定を取り込みました。`,
      }),
      (e: unknown) => setView({ state: 'error', message: e instanceof Error ? e.message : '連携に失敗しました' }),
    );
  }, [params]);

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>Health Planet 連携</h2>
      <div className="card">
        {view.state === 'working' && <div className="empty">{view.message}</div>}
        {view.state === 'done' && <div className="info-box">{view.message}</div>}
        {view.state === 'error' && <div className="error-box">{view.message}</div>}
        {view.state !== 'working' && (
          <div className="stack-sm" style={{ marginTop: 10 }}>
            <Link to="/" className="btn full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>今日の記録を見る</Link>
            <Link to="/settings" className="btn outline full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>設定に戻る</Link>
          </div>
        )}
      </div>
    </div>
  );
}
