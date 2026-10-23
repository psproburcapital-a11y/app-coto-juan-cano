/* Service worker mínimo (Fase 1): permite instalar la app.
   El funcionamiento sin cobertura se añade en la Fase 5. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
