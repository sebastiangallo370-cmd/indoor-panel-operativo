/* Service worker mínimo del panel: permite instalarlo como app. No guarda datos ni páginas en caché: todo se pide siempre al VPS. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
