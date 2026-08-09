/*
 * Service Worker（PWA のオフライン起動用）
 *
 * 方針:
 *  - 画面遷移（navigate）はネットワーク優先。新しいデプロイをすぐ拾えるようにするため。
 *    オフライン時だけキャッシュした index.html を返す。
 *  - ビルド成果物（/assets/ 以下）はファイル名にハッシュが入るのでキャッシュ優先で安全。
 *  - 同一オリジン以外（Supabase の API・Storage・OpenAI など）は一切触らない。
 *    記録データをキャッシュすると古い内容が出たり、他人のデータが残る事故につながるため。
 *
 * CACHE_VERSION を上げると古いキャッシュを捨てて作り直す。
 */
const CACHE_VERSION = 'lifelog-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // 1つでも失敗するとインストールごと失敗するので、個別に入れて失敗は無視する
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 他オリジン（Supabase / 天気API など）はネットワークに任せる
  if (url.origin !== self.location.origin) return;

  // 画面遷移: ネットワーク優先 → 失敗したらキャッシュ
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  // ハッシュ付きの静的ファイル: キャッシュ優先
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(request, copy)).catch(() => undefined);
        }
        return res;
      });
    }),
  );
});
