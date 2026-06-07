import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const deleteAllData = async () => {
    if (!user) return;
    if (!confirm('すべての食事記録・テンプレートを削除します。元に戻せません。よろしいですか？')) return;
    setErr('');
    setMsg('');
    const r1 = await supabase.from('meal_entries').delete().eq('user_id', user.id);
    const r2 = await supabase.from('meal_templates').delete().eq('user_id', user.id);
    const r3 = await supabase.from('food_templates').delete().eq('user_id', user.id);
    const e = r1.error || r2.error || r3.error;
    if (e) { setErr(e.message); return; }
    setMsg('すべてのデータを削除しました。');
  };

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>設定</h2>

      {msg && <div className="info-box">{msg}</div>}
      {err && <div className="error-box">{err}</div>}

      <div className="card">
        <h2>アカウント</h2>
        <div className="muted" style={{ fontSize: 13 }}>ログイン中のメールアドレス</div>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{user?.email}</div>
        <button className="btn outline full" onClick={() => void signOut()}>ログアウト</button>
      </div>

      <div className="card">
        <h2>テンプレート管理</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>よく食べる食品・食事セットの登録と自動セット設定。</p>
        <Link to="/templates" className="btn outline full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>テンプレートを開く</Link>
      </div>

      <div className="card">
        <h2>データ削除</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          記録・テンプレートをすべて削除します。アカウント自体の削除はサポートへの依頼が必要です（後続フェーズで対応予定）。
        </p>
        <button className="btn danger outline full" onClick={deleteAllData}>すべてのデータを削除</button>
      </div>

      <p className="center muted" style={{ fontSize: 11 }}>Lifelog 食事管理 MVP (Phase 1)</p>
    </div>
  );
}
