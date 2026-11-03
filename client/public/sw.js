// Yaro FleetOS - Service Worker PWA (Atelier & Technicien)
//
// Ce worker ne met en cache que les ressources statiques de l'application.
// Aucune réponse /api/* n'est jamais écrite dans Cache Storage : ce cache est
// partagé par tous les comptes du navigateur et ne connaît pas l'utilisateur,
// donc un second compte sur le même téléphone relirait les données du premier.
// Les données métier hors ligne passent par IndexedDB, cloisonné par utilisateur
// (client/src/lib/offline-storage.ts).
//
// Changer CACHE_NAME à chaque modification de cette règle : l'activation supprime
// tout cache portant un autre nom, y compris les réponses API déjà stockées par
// les versions précédentes sur les appareils installés.
const CACHE_NAME = 'fleetos-static-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.jpg',
  '/logo.jpg',
];

// Insensible à la casse et aux barres multiples : le serveur (Express) sert
// aussi /API/... et /api//..., une telle URL ne doit pas entrer dans le cache.
function isApiRequest(url) {
  return /^\/api(\/|$)/.test(url.pathname.replace(/\/{2,}/g, '/').toLowerCase());
}

// 1. Installation du Service Worker et mise en cache des assets statiques
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. Activation : suppression de tout cache d'une version précédente, puis de
//    toute entrée /api/* qui aurait pu entrer dans le cache courant.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => caches.open(CACHE_NAME)).then((cache) => {
      return cache.keys().then((requests) => Promise.all(
        requests
          .filter((request) => isApiRequest(new URL(request.url)))
          .map((request) => cache.delete(request))
      ));
    }).then(() => self.clients.claim())
  );
});

// 3. Assets statiques et navigation : Cache First avec Network Fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes non-GET et les WebSockets (ws:// / wss://)
  if (event.request.method !== 'GET' || url.protocol.startsWith('ws')) {
    return;
  }

  // API : jamais interceptée, jamais mise en cache. Le navigateur la traite
  // directement ; hors ligne, la requête échoue et l'application lit sa copie
  // IndexedDB de l'utilisateur connecté.
  if (isApiRequest(url)) {
    return;
  }

  // Autres origines (CDN, polices, tuiles) : laissées au navigateur, jamais en cache ici.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // En arrière-plan, rafraîchir le cache
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // Fallback page principale
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
