// ── Gestão Aquário Municipal — Service Worker ─────────────────────────────────
// Atualize CACHE_VERSION sempre que fizer um deploy com mudanças visuais
const CACHE_VERSION = 'v1';
const CACHE_STATIC  = `aquario-static-${CACHE_VERSION}`;
const CACHE_FONTS   = `aquario-fonts-${CACHE_VERSION}`;

// Assets que vão pro cache estático no install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Rotas que NUNCA devem ir pro cache (sempre network-first)
const API_PATTERNS = [
  /^\/api\//,
  /^\/timers\//,
  /^\/ping/,
  /^\/manager\//,
  /^\/logs\//,
];

// ── INSTALL: pré-carrega assets estáticos ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── ACTIVATE: remove caches antigos ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_FONTS)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: estratégia por tipo de recurso ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET e outros domínios (exceto fonts)
  if (request.method !== 'GET') return;

  // Google Fonts — cache-first (raramente mudam)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, CACHE_FONTS));
    return;
  }

  // Ignora outros domínios externos
  if (url.hostname !== self.location.hostname) return;

  // API e dados dinâmicos — network-first, fallback pro cache se offline
  if (API_PATTERNS.some(p => p.test(url.pathname))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Assets estáticos — cache-first, fallback pra rede
  event.respondWith(cacheFirst(request, CACHE_STATIC));
});

// ── Estratégias ───────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Se for navegação e não tiver cache → página offline
    if (request.mode === 'navigate') {
      return caches.match('/offline.html');
    }
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Armazena resposta bem-sucedida no cache estático como fallback
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sem rede → tenta cache
    const cached = await caches.match(request);
    if (cached) return cached;
    // API sem cache → JSON de erro legível pelo app
    return new Response(
      JSON.stringify({ erro: 'Sem conexão com a internet', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
