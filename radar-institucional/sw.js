/* Service worker: cache do casco da aplicacao para abrir offline.
   As chamadas de API (BCB, IBGE, provedores de IA) NUNCA sao cacheadas -
   dado financeiro velho e pior que dado ausente.

   v2: a v1 listava js/openrouter.js, que deixou de existir. Como cache.addAll()
   rejeita o lote inteiro quando um item falha, a instalacao morria calada e o
   app nunca ficava disponivel offline. Agora cada arquivo e tratado por conta
   propria, e a troca de nome do cache descarta o que a v1 tinha guardado -
   inclusive resposta salva com cabecalho errado.                            */
const CACHE = 'radar-institucional-v3';
const CASCO = [
  './', './index.html', './css/app.css', './manifest.json',
  './js/knowledge.js', './js/config.js', './js/data.js', './js/prompts.js',
  './js/catalogo.js', './js/ia.js', './js/teleprompter.js', './js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CASCO.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
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
  if (url.pathname.startsWith('/api/')) return;
  // A pagina usa esta query para medir o que a REDE devolve. Respondendo do
  // cache aqui, o diagnostico diria que esta tudo certo com o erro na tela.
  if (url.searchParams.has('diagnostico')) return;

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        // So guarda resposta boa: salvar um 404 ou um erro do servidor deixaria a
        // falha grudada no navegador mesmo depois de consertada na pasta.
        if (r && r.ok && r.type === 'basic') {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
