// MusicKey PRO Studio — service worker v2.0 (rede primeiro, cache como reserva)
const CACHE = 'musickey-v2.0';
const FILES = ['./', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/state.js', './js/music.js', './js/store.js', './js/detector.js', './js/chordcore.js', './js/audio.js',
  './js/band.js', './js/stage.js', './js/panels.js', './js/chordlib.js', './js/net.js', './js/qr.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('musickey-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname === '/ws') return;
  const sameOrigin = u.origin === location.origin, fonts = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!sameOrigin && !fonts) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then(m => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
