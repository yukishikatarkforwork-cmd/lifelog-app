export default function SetupNotice() {
  return (
    <div className="auth-wrap">
      <div className="logo">
        <div className="mark">🥗</div>
        <h1>Lifelog</h1>
        <p>セットアップが必要です</p>
      </div>
      <div className="card">
        <h2>Supabase の設定が未完了です</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          プロジェクト直下に <code>.env</code> を作成し、Supabase の接続情報を設定してください。
        </p>
        <pre style={{ background: 'var(--fill-2)', color: 'var(--text)', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto' }}>
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...`}
        </pre>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          詳しい手順は <code>README.md</code> を参照。設定後、開発サーバーを再起動してください。
        </p>
      </div>
    </div>
  );
}
