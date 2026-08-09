import { useEffect, useState } from 'react';
import { isIOS, isStandalone, onInstallAvailability, promptInstall } from '../lib/pwa';

/**
 * ホーム画面への追加を案内する。
 * すでにインストール済みなら何も出さない。
 */
export default function InstallCard() {
  const [available, setAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => onInstallAvailability(setAvailable), []);

  if (isStandalone() || installed) return null;

  // iOS は beforeinstallprompt がないので手順を案内する
  if (isIOS()) {
    return (
      <div className="card">
        <h2>ホーム画面に追加</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 0 }}>
          Safari の共有ボタン（□に↑のアイコン）から「ホーム画面に追加」を選ぶと、
          アプリのように起動できます。毎日の記録がぐっと楽になります。
        </p>
      </div>
    );
  }

  if (!available) return null;

  return (
    <div className="card">
      <h2>ホーム画面に追加</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        アプリとしてインストールすると、ホーム画面のアイコンから起動でき、オフラインでも開けます。
      </p>
      <button
        data-testid="install-app"
        className="btn full"
        onClick={async () => { if (await promptInstall()) setInstalled(true); }}
      >
        インストールする
      </button>
    </div>
  );
}
