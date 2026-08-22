// ============================================================================
// Animato PWA Service Worker
// ============================================================================
// Strategie:
//   - Navigaties (HTML)     → network-first, offline-page fallback
//   - Statische assets      → stale-while-revalidate (snel + up-to-date op de
//                             achtergrond)
//   - /api/*, /admin/*, /r2 → NOOIT cachen (dynamische data + betaal-flows)
//   - /leden/*              → NOOIT cachen (private + sessie-gebonden)
//   - POST/PUT/DELETE       → altijd pass-through
//
// Bij een nieuwe versie (bump CACHE_VERSION): oude caches worden opgeruimd,
// nieuwe assets worden lazy-in gehaald bij het eerste bezoek.
// ============================================================================

const CACHE_VERSION = 'v1'
const STATIC_CACHE = `animato-static-${CACHE_VERSION}`
const RUNTIME_CACHE = `animato-runtime-${CACHE_VERSION}`

// Minimale precache: alleen echt statische bestanden die we sowieso nodig hebben.
// We cachen bewust NIET de homepage — die is dynamisch en moet altijd vers zijn.
const PRECACHE_URLS = [
  '/offline',
  '/static/images/pwa/icon-192.png',
  '/static/images/pwa/icon-512.png',
  '/manifest.webmanifest'
]

// Paden die NOOIT gecached mogen worden (dynamisch, sessie, of privacy-gevoelig)
const NEVER_CACHE_PATTERNS = [
  /^\/api\//,
  /^\/admin/,
  /^\/leden/,        // sessie-gebonden
  /^\/webhooks/,
  /^\/r2\//,         // R2 heeft eigen long-cache headers via Response
  /^\/login/,
  /^\/logout/,
  /^\/register/,
  /^\/reset-wachtwoord/,
  /^\/account\/setup/,
  /^\/tickets\/bevestiging/,  // ticket-QR mag niet stale zijn
]

function shouldSkipCache(url) {
  const path = new URL(url).pathname
  return NEVER_CACHE_PATTERNS.some(re => re.test(path))
}

// ============================================================================
// INSTALL — precache offline-page + iconen
// ============================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(err => {
        // Precache mag niet de hele installatie blokkeren
        console.warn('[SW] precache warning:', err)
      }))
      .then(() => self.skipWaiting())
  )
})

// ============================================================================
// ACTIVATE — verwijder oude cache-versies
// ============================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('animato-') && !k.endsWith(CACHE_VERSION))
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// ============================================================================
// FETCH — routing logica per request
// ============================================================================
self.addEventListener('fetch', (event) => {
  const req = event.request

  // 1. Alleen GET wordt gecached — alles anders is een pass-through
  if (req.method !== 'GET') return

  // 2. Alleen same-origin — cross-origin (CDN, Mollie, Resend) niet aanraken
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 3. Skip privé / dynamische paden — laat de browser normaal doen
  if (shouldSkipCache(req.url)) return

  // 4. Navigatie-verzoeken (HTML documenten) → network-first met offline fallback
  const isNavigation = req.mode === 'navigate' ||
                       (req.headers.get('accept') || '').includes('text/html')
  if (isNavigation) {
    event.respondWith(networkFirstThenOffline(req))
    return
  }

  // 5. Statische assets (CSS, JS, images, fonts) → stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req))
})

// ============================================================================
// STRATEGIES
// ============================================================================

/**
 * Network-first voor navigaties: probeer eerst netwerk (verse data), val terug
 * op /offline pagina wanneer er niks te bereiken is.
 */
async function networkFirstThenOffline(request) {
  try {
    const netResp = await fetch(request)
    // Als de response OK is, cachen we ze NIET — anders krijgt de gebruiker
    // straks stale content. Enkel de offline-page ligt in de cache.
    return netResp
  } catch (err) {
    // Netwerk faalt (offline) — serveer offline-page
    const cache = await caches.open(STATIC_CACHE)
    const cached = await cache.match('/offline')
    if (cached) return cached
    // Ultimate fallback als zelfs /offline niet in de cache staat
    return new Response(
      '<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;text-align:center"><h1>Offline</h1><p>Geen internetverbinding.</p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    )
  }
}

/**
 * Stale-while-revalidate: geef onmiddellijk uit cache (snel), maar update de
 * cache op de achtergrond met een netwerk-fetch.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)

  const networkPromise = fetch(request).then(response => {
    // Alleen succesvolle same-origin responses cachen
    if (response && response.ok && response.status === 200) {
      // Clone want je kunt een response maar één keer lezen
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  }).catch(() => null)

  // Cached versie eerst — of wachten op netwerk als er niets in cache staat
  return cached || (await networkPromise) || new Response('Offline', { status: 503 })
}

// ============================================================================
// MESSAGES — toestaan dat de pagina de SW forceert te updaten
// ============================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
