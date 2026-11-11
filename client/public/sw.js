// Yaro FleetOS - Service Worker PWA (Atelier & Technicien)
//
// Ce worker ne met en cache que la coquille statique de l'application (HTML, JS, CSS,
// polices, icones). Aucune reponse /api/* n'est jamais ecrite dans Cache Storage : ce
// cache est partage par tous les comptes du navigateur et ne connait pas l'utilisateur,
// donc un second compte sur le meme telephone relirait les donnees du premier.
// Les donnees metier hors ligne passent par IndexedDB, cloisonne par utilisateur
// (client/src/lib/offline-storage.ts). La deconnexion purge ces donnees, jamais la
// coquille, qui ne contient rien d'un utilisateur.
//
// Precache (V5b-3d) : au build, le plugin `swShellPlugin` (scripts/lib/sw-shell.ts) remplace
// SHELL_MANIFEST ci-dessous par { build, assets } : l'empreinte du build et la liste de tous
// les fichiers a empreinte (JS, CSS, polices, images) produits par Vite. A l'installation,
// le worker les telecharge TOUS, avec index.html, dans un cache nomme d'apres le build :
// des la premiere visite, une coupure reseau ne donne plus de page blanche, et l'index.html
// servi hors ligne correspond toujours aux assets en cache (meme build, meme cache).
// Sans plugin (serveur de developpement), SHELL_MANIFEST reste null : pas de liste, nom de
// cache fixe, comportement d'avant (mise en cache a la demande).
const SHELL_MANIFEST = /*SHELL_MANIFEST*/ null;

// Prefixe des caches de coquille de CE worker. Seuls les caches portant un de ces
// prefixes (anciens noms compris) sont supprimes a l'activation ; tout autre cache du
// navigateur est laisse intact.
const SHELL_CACHE_PREFIX = 'fleetos-shell-';
const LEGACY_CACHE_PREFIXES = ['fleetos-static-', 'fleetos-tech-'];
const CACHE_NAME = SHELL_CACHE_PREFIX + (SHELL_MANIFEST ? SHELL_MANIFEST.build : 'dev');

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.jpg',
  '/logo.jpg',
];

// Delai au-dela duquel une navigation en ligne mais sans reponse bascule sur la coquille
// en cache (reseau mobile degrade).
const NAVIGATION_TIMEOUT_MS = 4000;

// Insensible a la casse et aux barres multiples : le serveur (Express) sert
// aussi /API/... et /api//..., une telle URL ne doit pas entrer dans le cache.
function isApiRequest(url) {
  return /^\/api(\/|$)/.test(url.pathname.replace(/\/{2,}/g, '/').toLowerCase());
}

// Seule la coque statique non empreinte (STATIC_ASSETS : manifeste, icones) est revalidee
// en arriere-plan, une poignee de requetes quel que soit le nombre de modules charges.
// La navigation n'est PAS revalidee dans le cache : un index.html plus recent que les
// assets en cache les referencerait sans qu'ils y soient (page blanche hors ligne). La
// mise a jour de la coquille passe par un nouveau worker, donc un nouveau cache complet.
function shouldRevalidate(request, url) {
  return request.mode !== 'navigate' && STATIC_ASSETS.includes(url.pathname);
}

// Liste des URL a precacher a l'installation : coquille fixe + assets du build.
function shellUrls(manifest) {
  const urls = STATIC_ASSETS.slice();
  const assets = manifest && Array.isArray(manifest.assets) ? manifest.assets : [];
  for (const asset of assets) {
    if (!urls.includes(asset)) urls.push(asset);
  }
  return urls;
}

// Caches de coquille a supprimer : ceux de ce worker (prefixe courant ou ancien) qui
// portent un autre nom que le cache courant. Ne touche jamais un cache etranger.
function staleShellCaches(keys, currentName) {
  return keys.filter((key) => {
    if (key === currentName) return false;
    return key.startsWith(SHELL_CACHE_PREFIX) || LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
  });
}

// Telecharge chaque URL en contournant le cache HTTP (sinon une copie perimee du
// navigateur entrerait dans un cache censé correspondre au build) et l'ecrit. Echoue
// si une seule ressource manque : une coquille partielle donnerait une page blanche
// hors ligne, mieux vaut garder l'ancien worker et reessayer.
function precacheShell(cache, urls) {
  return Promise.all(
    urls.map((url) =>
      fetch(url, { cache: 'reload' }).then((response) => {
        if (!response || response.status !== 200) {
          throw new Error('precache impossible : ' + url);
        }
        return cache.put(url, response);
      })
    )
  );
}

// 1. Installation : precache de toute la coquille du build.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => precacheShell(cache, shellUrls(SHELL_MANIFEST)))
      .then(() => self.skipWaiting())
  );
});

// 2. Activation : suppression des seules coquilles d'une version precedente, puis de
//    toute entree /api/* qui aurait pu entrer dans le cache courant.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(staleShellCaches(keys, CACHE_NAME).map((key) => caches.delete(key)));
    }).then(() => caches.open(CACHE_NAME)).then((cache) => {
      return cache.keys().then((requests) => Promise.all(
        requests
          .filter((request) => isApiRequest(new URL(request.url)))
          .map((request) => cache.delete(request))
      ));
    }).then(() => self.clients.claim())
  );
});

// Navigation : reseau d'abord (index.html frais), puis coquille du cache courant si le
// reseau est coupe ou trop lent. Jamais d'ecriture : l'index.html du cache vient du
// precache, du meme build que les assets.
function handleNavigation(request) {
  const fromCache = () => caches.open(CACHE_NAME).then((cache) => cache.match('/index.html'));
  const network = fetch(request);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS));
  return Promise.race([network, timeout])
    .then((response) => {
      if (response) return response;
      // Delai ecoule : la coquille en cache, sinon on attend quand meme le reseau.
      // Reseau lent = coquille peut-etre perimee : on cherche une nouvelle version du worker
      // (un build neuf change sw.js, donc la coquille precachee), sans attendre ni echouer.
      return fromCache().then((cached) => {
        if (cached) {
          try {
            Promise.resolve(self.registration.update()).catch(() => {});
          } catch (err) {
            // registration indisponible : la navigation n'en depend pas
          }
          return cached;
        }
        return network;
      });
    })
    .catch(() => fromCache().then((cached) => cached || Response.error()));
}

// 3. Assets : cache d'abord, puis reseau (avec ecriture a la demande).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorer les requetes non-GET et les WebSockets (ws:// / wss://)
  if (event.request.method !== 'GET' || url.protocol.startsWith('ws')) {
    return;
  }

  // API : jamais interceptee, jamais mise en cache. Le navigateur la traite
  // directement ; hors ligne, la requete echoue et l'application lit sa copie
  // IndexedDB de l'utilisateur connecte.
  if (isApiRequest(url)) {
    return;
  }

  // Autres origines (CDN, polices, tuiles) : laissees au navigateur, jamais en cache ici.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(event.request)).then((cachedResponse) => {
      if (cachedResponse) {
        // Revalidation en arriere-plan de la seule coque non empreinte. Un module ou un
        // bundle ne se revalide pas : ses requetes (des centaines avec le serveur de
        // developpement Vite) occuperaient les 6 connexions du navigateur vers l'hote, et
        // les appels /api/* de la page resteraient en file d'attente derriere
        // (/api/auth/me > 10 s, ecran vide).
        if (shouldRevalidate(event.request, url)) {
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
        }
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      });
    })
  );
});
