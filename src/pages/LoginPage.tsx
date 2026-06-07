import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // 成功時は AuthContext が画面を切り替える
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          // メール確認オフの場合はそのままログイン状態になる
        } else {
          setInfo('確認メールを送信しました。メール内のリンクを開いてからログインしてください。');
          setMode('login');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="logo">
        <div className="mark">🥗</div>
        <h1>Lifelog</h1>
        <p>食事・栄養をまとめて記録</p>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setInfo(''); }}>ログイン</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); setInfo(''); }}>新規登録</button>
        </div>

        {error && <div className="error-box">{error}</div>}
        {info && <div className="info-box">{info}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label>メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label>パスワード</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>
          <button type="submit" className="btn full" disabled={loading}>
            {loading ? '処理中…' : mode === 'login' ? 'ログイン' : '登録する'}
          </button>
        </form>
      </div>
      <p className="center muted" style={{ fontSize: 12 }}>
        記録データは本人のみが閲覧・編集できます（RLS による分離）。
      </p>
    </div>
  );
}
