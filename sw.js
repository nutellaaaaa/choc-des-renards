/**
 * sw.js — Service Worker du Choc des Renards
 *
 * Stratégies :
 *   - API (/api/*)      → Network First  (données toujours fraîches)
 *   - Fonts Google      → Cache First    (immuables, ne changent jamais)
 *   - Tout le reste     → Cache First    (assets statiques : index.html, images, …)
 *
 * ⚠️  Incrémenter CACHE_VERSION à chaque déploiement Vercel pour invalider
 *     le cache et forcer le rechargement des assets mis à jour.
 */

const CACHE_VERSION = 'v2'
const CACHE_STATIC  = `cdr-static-${CACHE_VERSION}`
const CACHE_FONTS   = 'cdr-fonts'   // cache permanent, version non incrémentée

// Assets mis en cache immédiatement à l'installation du SW.
// Tout ce qui est listé ici sera disponible hors-ligne.
const PRECACHE_ASSETS = [
  '/',
  '/cdr-logo-blanc.png',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

// ─────────────────────────────────────────
// INSTALL — précache des assets statiques
// ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => {
        console.log(`[SW] Cache "${CACHE_STATIC}" prêt.`)
        // Prendre le contrôle immédiatement sans attendre un rechargement
        return self.skipWaiting()
      })
      .catch(err => console.warn('[SW] Précache partiel :', err))
  )
})

// ─────────────────────────────────────────
// ACTIVATE — suppression des vieux caches
// ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('cdr-static-') && key !== CACHE_STATIC)
          .map(key => {
            console.log(`[SW] Suppression ancien cache : "${key}"`)
            return caches.delete(key)
          })
      ))
      .then(() => {
        console.log(`[SW] Activation "${CACHE_STATIC}" — prise de contrôle.`)
        return self.clients.claim()
      })
  )
})

// ─────────────────────────────────────────
// FETCH — interception des requêtes
// ─────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Ne gérer que GET (on laisse passer POST/PUT/DELETE sans interférer)
  if (request.method !== 'GET') return

  // ── 1. Appels API → Network First ──────────────────────────────────────────
  // On ne cache jamais les données dynamiques. Si le réseau est indisponible,
  // on renvoie une réponse JSON 503 lisible côté client.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .catch(() => new Response(
          JSON.stringify({ error: 'Hors ligne. Vérifiez votre connexion.' }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'X-CDR-Offline': '1',
            },
          }
        ))
    )
    return
  }

  // ── 2. Polices Google Fonts (fonts.gstatic.com) → Cache First permanent ───
  // Les fichiers de police sont immuables (URL contient un hash).
  // On les met en cache définitivement dans un cache dédié.
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_FONTS).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached
          return fetch(request).then(response => {
            if (response && response.status === 200) {
              cache.put(request, response.clone())
            }
            return response
          })
        })
      )
    )
    return
  }

  // ── 3. Assets statiques → Cache First, mise en cache dynamique ─────────────
  // On sert d'abord depuis le cache (démarrage quasi-instantané).
  // Si l'asset n'est pas encore en cache, on le récupère sur le réseau
  // et on le met en cache pour la prochaine fois.
  event.respondWith(
    caches.open(CACHE_STATIC).then(cache =>
      cache.match(request).then(cached => {
        if (cached) return cached

        return fetch(request)
          .then(response => {
            // Ne mettre en cache que les réponses valides de la même origine
            if (
              response &&
              response.status === 200 &&
              url.origin === self.location.origin
            ) {
              cache.put(request, response.clone())
            }
            return response
          })
          .catch(() => {
            // Pour les navigations (HTML), on renvoie la page principale en fallback
            if (request.destination === 'document') {
              return cache.match('/')
            }
          })
      })
    )
  )
})

// ─────────────────────────────────────────
// MESSAGE — communication depuis la page
// ─────────────────────────────────────────
// Permet à la page d'envoyer un message 'SKIP_WAITING' pour activer
// immédiatement un nouveau SW sans attendre la fermeture de tous les onglets.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// ─────────────────────────────────────────
// PUSH — réception d'une notification push
// ─────────────────────────────────────────
// Payload JSON attendu : { title, body, tab }
// « tab » correspond à un onglet CDR (ex : 'notifications', 'convocations', …)
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch {}

  const {
    title = 'Le Choc des Renards 🏸',
    body  = '',
    tab   = '',
    icon  = '/icons/icon-192.png',
  } = data

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge:     '/icons/icon-192.png',
      tag:       tab || 'cdr-push',   // même tag = remplace la précédente (pas d'empilement)
      renotify:  true,                // vibre même si même tag
      data:      { tab },             // transmis à notificationclick
    })
  )
})

// ─────────────────────────────────────────
// NOTIFICATIONCLICK — navigation à l'onglet cible
// ─────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const tab = event.notification.data?.tab || ''

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Fenêtre CDR déjà ouverte → focus + signal OPEN_TAB
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            if (tab) client.postMessage({ type: 'OPEN_TAB', tab })
            return client.focus()
          }
        }
        // Pas de fenêtre ouverte → en ouvrir une
        return clients.openWindow(tab ? `/?tab=${tab}` : '/')
      })
  )
})
