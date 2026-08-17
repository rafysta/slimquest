/* SlimQuest Service Worker
 *
 * 方針(ConfQuestと同じ): アプリ本体は必ずサーバーに問い合わせ、HTTPキャッシュを
 * 迂回する(cache:'no-store')。GitHub Pages が返す Cache-Control で古いファイルが
 * 使われ続けるのを防ぐため。オフラインのときだけ Cache Storage を使う。
 */
const CACHE_VERSION = 'sq-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/version.js',
  './js/db.js',
  './js/foods.js',
  './js/calc.js',
  './js/menus.js',
  './js/meals.js',
  './js/weight.js',
  './js/exercise.js',
  './js/streak.js',
  './js/app.js',
  './manifest.json',
  './version.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.allSettled(APP_SHELL.map((u) =>
        fetch(new Request(u, { cache: 'no-store' }))
          .then((res) => res.ok && cache.put(u, res))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // AIのAPIとオンラインの食品DBはSWを通さない
  if (url.hostname === 'api.anthropic.com' ||
      url.hostname === 'api.openai.com' ||
      url.hostname.endsWith('openfoodfacts.org')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(new Request(event.request.url, { cache: 'no-store', credentials: 'same-origin' }))
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true })
          .then((c) => c || Response.error()))
    );
  } else {
    event.respondWith(caches.match(event.request).then((c) => c || fetch(event.request)));
  }
});
