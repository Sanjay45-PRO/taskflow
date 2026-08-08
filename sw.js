const CACHE_NAME = 'taskflow-v2';
const ASSETS = ['./index.html', './app.js', './config.js', './manifest.json', './icon.svg'];
const NEVER_CACHE = ['config.js', 'app.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const isCritical = NEVER_CACHE.some((f) => event.request.url.includes(f));
  if (isCritical){
    // Always go to the network for these — never serve a stale cached copy.
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((c) => c || fetch(event.request).catch(() => c)));
});

self.addEventListener('push', (event) => {
  let data = { title: 'TaskFlow reminder', body: 'You have pending tasks.' };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: 'icon.svg' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});
