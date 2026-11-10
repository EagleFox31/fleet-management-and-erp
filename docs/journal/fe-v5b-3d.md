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

## e2e 21 : aucune requête d'écriture hors ligne (mineur 5 de la relecture de #682)

- Quoi : dans le premier cas du spec 21, un écouteur `page.on('request')` posé après `setOffline(true)` relève toute requête dont la méthode n'est ni GET, ni HEAD, ni OPTIONS, et le cas exige une liste vide, en plus de l'absence de boutons d'écriture.
- Pourquoi : l'absence de boutons ne prouve pas qu'aucune écriture ne part (rejeu de file, minuterie).
- Tester : spec 21 (base locale et serveur complet requis). Non rejoué ici faute de base ; typé seulement.

## Audit de #682, mineur 1 : énumération des magasins impossible, on conclut « inconnu »

- Quoi : `kv.listDbs` (`offline-kv.ts`) ne rend plus une liste partielle quand `indexedDB.databases()` échoue : il relève l'erreur. `cacheOwnership` renvoie alors `"unknown"` (et plus `"ok"`) et `resumeOfflineRead` refuse la reprise sans rien rouvrir. `purgeAll` vide le compte sortant et l'ancien format, puis lève : `purgeOfflineSession` renvoie `false` (purge incomplète, le repère de déconnexion est gardé).
- Pourquoi : avec une liste vide faute de pouvoir énumérer, la copie de lecture d'un autre compte restait invisible : reprise accordée sur un appareil partagé, purge déclarée complète.
- Preuve du rouge : 2 des 3 nouveaux cas échouaient avant le correctif (« expected { userId: 7 ... } to be null », « expected true to be false »), puis vert.
- Tester : `node node_modules/vitest/vitest.mjs run tests/unit/client/offline-resume-storage.test.ts` (bloc « énumération des magasins impossible »).
- Non traité : `purgeOthers` garde `?? []` (changement de compte en ligne, hors du périmètre du mineur).

## Audit de #682, mineur 2 : 404 sur /api/auth/me, compte supprimé

- Quoi : `checkSession` traite un 404 comme un 401 (`anonymous`) : `resumeSession` efface le marqueur et expire le compte actif, `auth-bootstrap` retire la reprise hors ligne et affiche la connexion.
- Pourquoi : `GET /api/auth/me` répond 404 quand le compte de la session n'existe plus. C'était classé « serveur injoignable avec code HTTP » : ni purge, ni arrêt de la lecture hors ligne d'un compte supprimé.
- Preuve du rouge : 2 échecs avant le correctif (`session-check.test.ts` : 404 attendu `anonymous`, reçu `unreachable`; `auth-bootstrap.test.ts` : grant non effacé après le 404), puis vert.
- Tester : `node node_modules/vitest/vitest.mjs run tests/unit/client/session-check.test.ts tests/unit/client/auth-bootstrap.test.ts`.
