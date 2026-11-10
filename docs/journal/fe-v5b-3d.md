# Journal fe-v5b-3d

## 2026-11-10 - V5b-3d : précache de la coquille par le service worker

**Quoi.** Le service worker (`client/public/sw.js`) télécharge toute la coquille de l'application à l'installation (index.html, manifeste, icônes et tous les fichiers à empreinte du build : JS, CSS, polices, images, soit 30 fichiers et environ 5,5 Mo). Dès la première visite, une coupure réseau ne donne plus de page blanche : toute navigation hors ligne vers une route de l'application sert l'`index.html` du cache. Prérequis pour activer le drapeau `driver-offline`.

**Comment.**
- `scripts/lib/sw-shell.ts` (`swShellPlugin`, branché dans `vite.config.ts`) : à `writeBundle`, remplace le marqueur `/*SHELL_MANIFEST*/ null` du `sw.js` copié dans `dist/public` par `{ build, assets }`. `build` est l'empreinte (10 caractères) des assets et de l'index.html. L'injection échoue si le marqueur manque.
- `sw.js` : cache `fleetos-shell-<build>`. À l'installation, chaque URL est téléchargée avec `cache: 'reload'` (jamais une copie HTTP périmée) et l'installation échoue si une seule manque (pas de coquille partielle). `skipWaiting` puis `clients.claim` à l'activation : le contrôle est acquis sans rechargement.
- Navigation : réseau d'abord avec délai de 4 s, puis `/index.html` du cache courant, puis erreur réseau. La réponse de navigation n'est jamais écrite : l'index.html du cache vient du précache, du même build que les assets en cache.
- Activation : suppression des seuls caches de coquille d'une version précédente (`fleetos-shell-*` d'un autre build, anciens `fleetos-static-*` et `fleetos-tech-*`). Les autres caches ne sont jamais touchés.
- Cloisonnement : aucune réponse `/api/*` dans Cache Storage (test dédié). La déconnexion purge IndexedDB (`offline-user-scope.ts`), jamais Cache Storage : elle ne dépend pas de ce cache, et la coquille ne contient rien d'un utilisateur.
- Choix reuse-first : ni vite-plugin-pwa ni workbox dans le dépôt, un plugin de 60 lignes suffit. Alternative écartée : faire envoyer au service worker les ressources déjà chargées par la page à la prise de contrôle (course entre chargement et envoi, contenu non déterministe).
- `e2e/21` : plus de rechargement en ligne avant la coupure, une seule attente du contrôle par le service worker.

**Pourquoi.** Sans précache, les ressources chargées avant la prise de contrôle du service worker n'étaient pas en cache : le spec 21 devait recharger une fois en ligne, et un chauffeur qui perd le réseau juste après sa première visite voyait une page blanche.

**Tester.**
- Unitaires : `node node_modules/vitest/vitest.mjs run tests/unit/client/offline-sw-cache.test.ts tests/unit/scripts/sw-shell.test.ts`.
- e2e de la coquille, sans base de données : `node node_modules/vite/bin/vite.js build`, puis `node scripts/e2e-static-shell.mjs 5051` (serveur statique, `/api/*` répond 401), puis `E2E_BASE_URL=http://127.0.0.1:5051 node node_modules/@playwright/test/cli.js test e2e/33-shell-precache-first-visit.spec.ts`.
- e2e 21 (base locale et serveur complet requis) : voir l'entrée V5b-3c de `fe-v5b-3c.md`.

**Limites.** Les polices Google (autre origine) ne sont pas en cache : repli sur la police système hors ligne. Le spec 21 modifié n'a pas pu être rejoué (aucune base locale disponible), il est seulement typé.

## Bruit indexedDB des tests

- Quoi : le faux indexedDB de `offline-resume-replay.test.ts` est factorisé dans `tests/support/fake-indexeddb.ts` et repris par `offline-session-subscription.test.ts` et `offline-storage-session.test.ts`. Le faux `createStore` d'idb-keyval renvoie une fonction, comme le vrai.
- Pourquoi : « indexedDB is not defined » et « store is not a function » polluaient stderr. Il ne reste que les avertissements attendus du `clientLogger`.
