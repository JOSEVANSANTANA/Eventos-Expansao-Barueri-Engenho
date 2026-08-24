/* Service worker: cache do casco da aplicacao para abrir offline.
   As chamadas de API (BCB, IBGE, OpenRouter) NUNCA sao cacheadas -
   dado financeiro velho e pior que dado ausente.                      */
const CACHE = 'radar-institucional-v1';
const CASCO = [
  './', './index.html', './css/app.css', './manifest.json',
  './js/knowledge.js', './js/config.js', './js/data.js',
  './js/prompts.js', './js/openrouter.js', './js/teleprompter.js', './js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCO)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Rede sempre para API e para qualquer origem externa. Sem cache de dado de mercado.
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
