/* Service worker Kzann Tech — app shell offline + atualização em segundo plano.
   Requisições /api e /uploads NUNCA são servidas do cache (dados sempre atuais). */
const CACHE = 'kzann-shell-v1';
const SCOPE = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([SCOPE, `${SCOPE}manifest.webmanifest`, `${SCOPE}icons/icon-192.png`]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/uploads/')) return;

  // Navegação: rede primeiro, cache como fallback (SPA offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SCOPE, copy));
          return res;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }

  // Assets com hash: cache primeiro.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/icons/'))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Clique na notificação de novo pedido abre o painel.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const win = list.find((w) => w.url.includes('/admin'));
      return win ? win.focus() : self.clients.openWindow(`${SCOPE}admin`);
    }),
  );
});
