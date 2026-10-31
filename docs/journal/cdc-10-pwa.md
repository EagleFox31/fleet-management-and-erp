# Journal — CDC-10 PWA hors ligne (`cdc-10-pwa`)

Worktree : `../fm-cdc-10-pwa`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T19:34:00+01:00 — CDC-10a — Cloison du cache hors ligne de la PWA par utilisateur

- **Agent** : cdc-10-pwa · **Branche** : `lot/fe/CDC-10-pwa-cloison` · **Commit** : voir PR
- **Statut** : fait
- **Quoi** : deux comptes qui se succèdent sur le même navigateur ne partagent plus aucune donnée hors ligne. Le service worker n'écrit plus aucune réponse `/api/*` dans Cache Storage ; les données hors ligne vont dans une base IndexedDB par utilisateur, limitée à « mes OT » et au détail, aux pièces et au véhicule de ces OT ; la déconnexion vide tout (magasin, file d'écritures, cache TanStack).
- **Comment** :
  - `client/public/sw.js` : GET `/api/*` n'est plus intercepté ni mis en cache ; cache renommé `fleetos-static-v2` (l'activation supprime tout autre cache, donc les réponses API déjà stockées sur les téléphones, et toute entrée `/api/` du cache courant).
  - `client/src/lib/offline-user-scope.ts` (nouveau, logique pure testée) : nom de base `fleetos-offline-u<id>`, utilisateur actif (état porté par `globalThis`), liste blanche `selectPersistableQueries`, magasin injectable `createOfflineScope` (enveloppe versionnée qui porte l'identifiant du propriétaire, expiration 7 jours, compteur de purge par base qui annule une écriture démarrée avant la purge).
  - `client/src/lib/offline-storage.ts` : branche le magasin sur idb-keyval (`createStore` par utilisateur), `activateOfflineUser` (connexion), `purgeOfflineSession` (déconnexion), file d'écritures par utilisateur, `console.*` migrés vers `clientLogger` (aucun log supprimé). Signature de `setupOfflinePersistence(queryClient)` inchangée (App.tsx est hors périmètre) : l'utilisateur actif est abonné, pas passé en paramètre. Comportement de rejeu inchangé, sauf arrêt si la session change en cours de rejeu.
  - `client/src/lib/auth.ts` : `login` et `getCurrentUser` désignent l'utilisateur actif ; `logout` purge dans un `finally` (même si le serveur ne répond pas). `queryClient` importé par l'alias `@/lib/queryClient` (l'import relatif d'`apiRequest` est remplacé).
  - Choix reuse-first : Adapt de `idb-keyval` déjà installé (un `createStore` par utilisateur) ; `deleteDatabase` écarté (reste bloqué tant que la connexion idb-keyval est ouverte), les bases sont vidées, pas supprimées.
- **Pourquoi** : défaut D5 du cahier des charges (fuite entre comptes sur un téléphone partagé) ; préalable au mode hors ligne technicien (#10). `docs/analysis/LESSONS_LEARNED.md` : « Un seul QueryClient », cloison entre clients, erreurs techniques et logs.
- **Comment tester (QA)** :
  - Prérequis : un navigateur de bureau ou un téléphone avec l'application, deux comptes technicien (ou tout rôle ayant une liste d'OT) ; sur un appareil déjà installé, la mise à jour du service worker se fait au rechargement.
  - Étapes : 1. Compte A : ouvrir le tableau de bord, attendre 3 secondes. 2. Outils de développement, Application : Cache Storage ne contient qu'un cache `fleetos-static-v2` sans URL `/api/` ; IndexedDB contient `fleetos-offline-u<id de A>`. 3. Se déconnecter. 4. IndexedDB : `fleetos-offline-u<id de A>` est vide, `keyval-store` n'a plus de clé `fleetos-*`. 5. Compte B : se connecter, couper le réseau, naviguer vers la liste des OT : aucune donnée de A.
  - Attendu : B ne voit aucun titre d'OT de A ; Cache Storage ne contient aucune réponse API ; les magasins de A sont vides.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/client/offline-storage-scope.test.ts` → `18 passed` ; navigateur : serveur Vite seul puis `E2E_CHANNEL=msedge E2E_BASE_URL=http://127.0.0.1:<port> node node_modules/@playwright/test/cli.js test e2e/13-pwa-cache-cloison.spec.ts` → `3 passed` (API entièrement simulée par `context.route`, aucune base touchée). Contrôle par mutation : sans la purge à la déconnexion et avec l'ancien `sw.js`, 2 des 3 scénarios échouent.
- **RAIDER** : R magasin et liste blanche génériques, stockage injecté ; A aucun identifiant ni rôle supposé, l'utilisateur vient de la session ; I purges rejouables sans effet ; D contrats d'API inchangés, `setupOfflinePersistence` et `OfflineAction` conservés ; failure memory : l'ancien cache global est détruit à la connexion, test de cloison en garde-fou ; retroactive : les téléphones déjà installés sont nettoyés par le nouveau service worker et par la purge du format global. Ne s'applique pas : base de données, serveur.
- **Reste / risques** :
  - Hors ligne, `getCurrentUser` échoue (réseau) donc l'application ouvre l'écran de connexion : l'ancien cache `/api/auth/me` du service worker masquait ce point (et exposait la session d'un autre compte). Le démarrage hors ligne authentifié relève du lot #10.
  - Une déconnexion vide aussi la file d'écritures en attente de l'utilisateur : le lot #10c devra avertir avant la déconnexion s'il reste des écritures non synchronisées.
  - Navigateurs sans `indexedDB.databases()` (Firefox avant 126) : la purge du magasin de l'utilisateur actif fonctionne, pas le balayage des magasins d'autres comptes.
  - Les téléphones gardent l'ancien service worker (et son cache API) jusqu'à la prochaine ouverture avec réseau.
