import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { HealthPlanetStatus } from '../lib/types';
import { useReload } from '../lib/useReload';
import {
  HEALTHPLANET_CALLBACK_PATH, callbackUrl, disconnectHealthPlanet,
  fetchHealthPlanetStatus, startHealthPlanetAuth, syncHealthPlanet,
} from '../lib/body';
import { IconScale } from './icons';

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * タニタ Health Planet との連携。
 *
 * 体重を毎日手で打つ人はまずいないので、体組成計に乗るだけで記録が増える導線を作る。
 * 連携の実体（トークンの保管・取得）は Edge Function 側。ここは状態表示と操作だけ。
 */
export default function HealthPlanetCard() {
  const { user } = useAuth();
  const [status, setStatus] = useState<HealthPlanetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const reload = useReload(async () => {
    try {
      setStatus(await fetchHealthPlanetStatus());
    } catch (e) {
      // 関数が未適用（schema.sql 未反映）のときはここに来る。カード自体は出しておく
      setErr(e instanceof Error ? e.message : '連携状態を取得できませんでした');
    }
  }, [user?.id]);

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      setMsg(await task());
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '処理に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const connect = () => run(async () => {
    await startHealthPlanetAuth();
    return 'Health Planet の認可画面に移動しています…';
  });

  const sync = (full: boolean) => run(async () => {
    const n = await syncHealthPlanet(full);
    return n === 0
      ? '新しい測定はありませんでした。'
      : `${n} 日分を取り込みました（手入力した日はそのままです）。`;
  });

  const disconnect = () => {
    if (!confirm('Health Planet との連携を解除しますか？\n取り込み済みの体重記録は残ります。')) return;
    void run(async () => {
      await disconnectHealthPlanet();
      return '連携を解除しました。';
    });
  };

  const connected = status?.connected ?? false;

  return (
    <div className="card">
      <h2><IconScale /> 体重の自動取得（タニタ Health Planet）</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        タニタの体組成計で測った体重・体脂肪率などを、公式アプリ Health Planet 経由で自動で取り込みます。
        1日に複数回測った日は、その日の最初の測定を使います。
      </p>

      {msg && <div className="info-box">{msg}</div>}
      {err && <div className="error-box">{err}</div>}

      {connected ? (
        <>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 10 }}>
            連携日時: {fmtDateTime(status!.connected_at)}<br />
            最終同期: {fmtDateTime(status!.last_synced_at)}
            {status!.last_error && (
              <div className="error-box" style={{ marginTop: 6 }}>前回の同期エラー: {status!.last_error}</div>
            )}
          </div>
          <div className="stack-sm">
            <button data-testid="hp-sync" className="btn full" onClick={() => void sync(false)} disabled={busy}>
              {busy ? '処理中…' : '今すぐ同期'}
            </button>
            <button className="btn outline full" onClick={() => void sync(true)} disabled={busy}>
              過去1年分を取り込み直す
            </button>
            <button className="btn danger outline full" onClick={disconnect} disabled={busy}>
              連携を解除
            </button>
          </div>
        </>
      ) : (
        <>
          <button data-testid="hp-connect" className="btn full" onClick={() => void connect()} disabled={busy}>
            {busy ? '処理中…' : 'Health Planet と連携する'}
          </button>
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
            Health Planet のログイン画面に移動し、許可すると
            <code>{HEALTHPLANET_CALLBACK_PATH}</code> に戻ってきます（戻り先: {callbackUrl()}）。
          </p>
        </>
      )}
    </div>
  );
}
