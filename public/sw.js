// iPOS service worker: keeps the app shell available offline.
// Only same-origin GET requests are handled. Supabase (store data) is never
// cached here; the app keeps its own offline copies and sales queue.
const SHELL = 'ipos-shell-v1';
const ASSETS = 'ipos-assets-v1';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/ipos-logo.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
// Filled in at build time with every file of this release (see vite.config.js).
// The list changes with each release, so phones detect and install updates.
const BUILD_ASSETS = self.__BUILD_ASSETS__ || [];

async function assetsIn(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    const html = await (await shell.match('/index.html')).text();
    const assets = await caches.open(ASSETS);
    // Files the first screen needs must all be saved; on-demand parts are saved best-effort.
    const needed = await assetsIn(html);
    await assets.addAll(needed);
    await Promise.allSettled(BUILD_ASSETS.filter(a => !needed.includes(a)).map(async a => {
      if (!(await assets.match(a))) await assets.add(a);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, ASSETS].includes(key)) await caches.delete(key);
    // Drop hashed files from older builds, keeping only what the current page uses.
    const shell = await caches.open(SHELL);
    const page = await shell.match('/index.html');
    if (page) {
      const keep = new Set([...BUILD_ASSETS, ...(await assetsIn(await page.text()))]);
      const assets = await caches.open(ASSETS);
      for (const req of await assets.keys()) {
        const path = new URL(req.url).pathname;
        if (!keep.has(path) && /\.(js|css)$/.test(path)) await assets.delete(req);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first so updates arrive immediately; offline falls back to the saved app.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(SHELL)).put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Built files have unique names per version, so the saved copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh.ok) (await caches.open(ASSETS)).put(req, fresh.clone());
      return fresh;
    })());
    return;
  }

  // Icons, logo and manifest: serve saved copy, refresh in the background.
  if (CORE.includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      const update = fetch(req).then(async r => { if (r.ok) (await caches.open(SHELL)).put(url.pathname, r.clone()); return r; }).catch(() => cached);
      return cached || update;
    })());
  }
});
