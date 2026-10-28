/* Service worker v2: la app se abre aunque no haya cobertura.
   Siempre intenta la red primero (así las actualizaciones llegan al momento)
   y, si no hay señal, usa la última copia guardada en el móvil. */
const CACHE_APP = 'coto-app-v2', CACHE_MAPA = 'coto-mapa-v1', MAX_TESELAS = 3000;
const BASICOS = [
  'app.html', 'app.css', 'comun-v3.js', 'companeros.js', 'cazador-v4.js', 'app.webmanifest', 'icono-192.png', 'icono-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_APP).then(c => Promise.all(BASICOS.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE_APP && k !== CACHE_MAPA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname.endsWith('supabase.co')) return;                 // los datos los gestiona la app
  const esTesela = u.hostname.endsWith('ign.es');
  const esPropio = u.origin === self.location.origin || /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(u.hostname);
  if (!esTesela && !esPropio) return;
  const cacheName = esTesela ? CACHE_MAPA : CACHE_APP;
  e.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone());
        if (esTesela) recortar(cache);
      }
      return res;
    } catch (err) {
      const copia = await cache.match(req, { ignoreSearch: !esTesela });
      if (copia) return copia;
      throw err;
    }
  })());
});
let recortando = false;
async function recortar(cache) {
  if (recortando) return; recortando = true;
  try { const ks = await cache.keys(); for (let i = 0; i < ks.length - MAX_TESELAS; i++) await cache.delete(ks[i]); } finally { recortando = false; }
}
