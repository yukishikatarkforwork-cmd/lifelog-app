/**
 * PWA まわり。
 *
 * 毎日スマホで使う前提のアプリなのに、毎回ブラウザを開いてブックマークから辿るのは
 * 継続の障害になる。ホーム画面から起動できるようにする。
 */

/** インストール可能になったときにブラウザが投げるイベント（型定義がまだ標準にない） */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function notify() {
  for (const fn of listeners) fn(deferredPrompt !== null);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // 既定のミニバナーを止めて、こちらのタイミングで出す
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

/** インストール可能かどうかの変化を購読する */
export function onInstallAvailability(fn: (available: boolean) => void): () => void {
  listeners.add(fn);
  fn(deferredPrompt !== null);
  return () => { listeners.delete(fn); };
}

/** インストールを促す。true ならインストールされた */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome === 'accepted';
}

/** すでにホーム画面から起動しているか */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    // iOS Safari は標準の display-mode を返さないので独自プロパティを見る
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** iOS は beforeinstallprompt を実装していないので、手順を案内するしかない */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS 13+ はデスクトップ版 Safari を名乗る
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Service Worker を登録する。
 * 開発中は登録しない（キャッシュが効いて変更が反映されず、原因調査で時間を溶かすため）。
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[lifelog] Service Worker の登録に失敗しました:', e);
    });
  });
}
