// 삼역호전 스캐너 서비스 워커: 항상 인터넷에서 먼저 받고(최신 화면·시세), 안 되면 마지막으로 받은 것을 보여 줌
const C = 'samyeok-v1';
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(['./', './manifest.webmanifest', './icons/icon-192.png'])).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== C) await caches.delete(k); await self.clients.claim(); })());
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;   // GitHub API(기록 저장소)·글꼴은 건드리지 않음
  const key = u.origin + u.pathname;          // ?v= 같은 꼬리표는 빼고 하나만 보관
  e.respondWith((async () => {
    try {
      const res = await fetch(r);
      if (res.ok) { const c = await caches.open(C); c.put(key, res.clone()).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(key);
      if (hit) return hit;
      if (r.mode === 'navigate') { const idx = (await caches.match(u.origin + u.pathname.replace(/[^/]*$/, ''))) || (await caches.match(u.origin + u.pathname.replace(/[^/]*$/, '') + 'index.html')); if (idx) return idx; }
      throw err;
    }
  })());
});
