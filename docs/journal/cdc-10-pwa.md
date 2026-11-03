# Journal — CDC-10 PWA hors ligne (`cdc-10-pwa`)

Worktree : `../fm-cdc-10-pwa`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T21:30:00+01:00 — CDC-10a (1/2) — Le service worker ne met plus aucune réponse /api/* en cache

- **Agent** : cdc-10-pwa · **Branche** : `lot/fe/CDC-10-pwa-cloison` · **Commit** : voir PR (commit autonome, extractible seul)
- **Statut** : fait
- **Quoi** : le service worker n'écrit plus aucune réponse `/api/*` dans Cache Storage. Ce cache est commun à tous les comptes du navigateur : un second compte sur le même téléphone relisait les données du premier (défaut D5 du cahier des charges). Ce commit suffit seul à fermer cette fuite ; le reste du lot (stockage IndexedDB par utilisateur, purge à la déconnexion) est dans le commit suivant.
- **Comment** :
  - `client/public/sw.js` : le cache est renommé `fleetos-static-v2` ; à l'activation, tout cache portant un autre nom est supprimé (donc les réponses API déjà stockées sur les téléphones installés, sous `fleetos-tech-v1.0.0` ou ailleurs), puis toute entrée `/api/` du cache courant. Un GET `/api/*` n'est plus intercepté : le navigateur le traite directement. Le cache des assets statiques (cache d'abord, rafraîchi en arrière-plan) est conservé.
  - La détection d'une requête API est insensible à la casse et aux barres multiples (`/API/...`, `/api//...`, `//api/...`) : le serveur Express sert ces variantes, elles ne doivent pas entrer dans le cache.
  - `tests/unit/client/offline-sw-cache.test.ts` (nouveau) : évalue le vrai `sw.js` dans un contexte simulé (`node:vm`).
- **Pourquoi** : préalable au mode hors ligne technicien (#10) ; correctif minimal de la fuite entre comptes si le reste du lot ne peut pas partir avant la recette.
- **Comment tester (QA)** :
  - Prérequis : navigateur de bureau ou téléphone ayant déjà utilisé l'application ; la mise à jour du service worker se fait au rechargement avec réseau.
  - Étapes : 1. Ouvrir l'application connecté, naviguer 3 secondes. 2. Outils de développement, Application, Cache Storage. 3. Constater un seul cache `fleetos-static-v2`, sans URL `/api/`.
  - Attendu : aucun cache `fleetos-tech-v*`, aucune réponse API dans Cache Storage.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/client/offline-sw-cache.test.ts` ; l'ancien `sw.js` fait échouer ces tests.
- **RAIDER** : D les assets statiques restent servis comme avant ; failure memory : test du vrai fichier `sw.js`, pas d'une copie ; retroactive : les anciens caches des téléphones installés sont supprimés à l'activation. Ne s'applique pas : base de données, serveur.
- **Reste / risques** : un téléphone garde l'ancien service worker (et son cache API) jusqu'à sa prochaine ouverture avec réseau. Hors ligne, `/api/auth/me` n'est plus servi par le cache : l'application ouvre l'écran de connexion (le démarrage hors ligne authentifié relève du lot #10).

## 2026-10-31T21:30:00+01:00 — CDC-10a (2/2) — Stockage hors ligne cloisonné par utilisateur, purge à la déconnexion

- **Agent** : cdc-10-pwa · **Branche** : `lot/fe/CDC-10-pwa-cloison` · **Commit** : voir PR
- **Statut** : fait, avec les correctifs de l'audit sécurité (E1, M3 et points mineurs)
- **Quoi** : deux comptes qui se succèdent sur le même navigateur ne partagent plus aucune donnée hors ligne. Les données hors ligne vont dans une base IndexedDB par utilisateur, limitée à « mes OT » et au détail, aux pièces et au véhicule de ces OT ; la déconnexion vide tout (magasin, file d'écritures, cache TanStack, brouillons de formulaire). Une déconnexion faite hors ligne est envoyée au serveur dès que possible.
- **Comment** :
  - `client/src/lib/offline-user-scope.ts` (nouveau, logique pure testée) : nom de base `fleetos-offline-u<id>`, utilisateur actif (état porté par `globalThis`), liste blanche `selectPersistableQueries`, magasin injectable `createOfflineScope` (enveloppe versionnée qui porte l'identifiant du propriétaire, expiration 7 jours, compteur de purge par base qui annule une écriture démarrée avant la purge), registre des bases `createDbRegistry`.
  - `client/src/lib/offline-storage.ts` : branche le magasin sur idb-keyval (`createStore` par utilisateur), `activateOfflineUser` (connexion), `purgeOfflineSession` (déconnexion), `expireOfflineSession` (401), file d'écritures par utilisateur, `console.*` migrés vers `clientLogger` (aucun log supprimé). Signature de `setupOfflinePersistence(queryClient)` inchangée (App.tsx est hors périmètre). Rejeu inchangé, sauf arrêt si la session change en cours de rejeu.
  - `client/src/lib/auth.ts` : `login` et `getCurrentUser` désignent l'utilisateur actif ; `logout` purge dans un `finally` (même si le serveur ne répond pas). `queryClient` importé par l'alias.
  - Choix reuse-first : Adapt de `idb-keyval` déjà installé (un `createStore` par utilisateur) ; `deleteDatabase` écarté (reste bloqué tant que la connexion idb-keyval est ouverte), les bases sont vidées, pas supprimées.
  - Correctifs de l'audit :
    - E1 : `client/src/lib/pending-logout.ts` (nouveau). Une déconnexion qui n'atteint pas le serveur (hors ligne, erreur serveur) laisse un repère local `fleetos-pending-server-logout` (une date, aucune donnée utilisateur). `getCurrentUser` l'envoie avant `/api/auth/me` (si l'envoi échoue, l'utilisateur reste déconnecté, `/me` n'est pas appelé) ; l'événement `online` l'envoie aussi. Une nouvelle connexion efface le repère. Sans cela, le cookie de 30 jours reconnectait le compte au retour du réseau.
    - M3 : sur 401 de `/api/auth/me`, `expireOfflineSession` vide le cache TanStack et l'utilisateur actif, sans détruire la file d'écritures du compte. Sans effet si un autre compte s'est connecté entre-temps.
    - `enqueueOfflineAction` relève le compteur de purge avant la lecture de la file et revérifie l'utilisateur actif : une déconnexion pendant l'ajout n'écrit rien et prévient l'utilisateur.
    - `purgeBrowserUserState` (`form-draft-storage.ts`) : à la déconnexion, les brouillons `fleetos-<formId>-v<n>-<userId>` de tous les comptes et la clé globale `currentVehicleRegistration` sont effacés du stockage local.
    - Registre des bases dans la clé fixe `fleetos-offline-db-registry` (noms seulement) : les navigateurs sans `indexedDB.databases()` peuvent vider les magasins des autres comptes.
    - `useAuth.tsx` : `console.*` migrés vers `clientLogger`, message de déconnexion locale précisé.
    - `e2e/13` est ignoré sans `E2E_BASE_URL`.
- **Pourquoi** : défaut D5 du cahier des charges (fuite entre comptes sur un téléphone partagé) ; préalable au mode hors ligne technicien (#10). `docs/analysis/LESSONS_LEARNED.md` : « Un seul QueryClient », cloison entre clients, erreurs techniques et logs.
- **Comment tester (QA)** :
  - Prérequis : un navigateur de bureau ou un téléphone avec l'application, deux comptes technicien (ou tout rôle ayant une liste d'OT).
  - Cloison : 1. Compte A : ouvrir le tableau de bord, attendre 3 secondes. 2. Outils de développement, Application : IndexedDB contient `fleetos-offline-u<id de A>`. 3. Se déconnecter. 4. `fleetos-offline-u<id de A>` est vide, `keyval-store` n'a plus de clé `fleetos-*`. 5. Compte B : se connecter, couper le réseau, naviguer vers la liste des OT : aucune donnée de A. Attendu : B ne voit aucun titre d'OT de A.
  - Déconnexion hors ligne : 1. Compte A connecté, couper le réseau. 2. Se déconnecter (message « Déconnexion locale appliquée »). 3. Rétablir le réseau. Attendu : après quelques secondes, `localStorage` n'a plus `fleetos-pending-server-logout` ; recharger l'application ne reconnecte pas A.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run` → 822 tests verts (70 fichiers) ; navigateur : serveur Vite seul puis `E2E_CHANNEL=msedge E2E_BASE_URL=http://127.0.0.1:<port> node node_modules/@playwright/test/cli.js test e2e/13-pwa-cache-cloison.spec.ts` → `5 passed` (API entièrement simulée par `context.route`, aucune base touchée). Contrôle par mutation : sans la purge à la déconnexion et avec l'ancien `sw.js`, 2 des 3 premiers scénarios échouent ; sans l'envoi de la déconnexion en attente, les 2 scénarios de déconnexion hors ligne échouent ; avec l'ancien calcul du compteur de purge, le test d'ajout pendant déconnexion échoue.
- **RAIDER** : R magasin et liste blanche génériques, stockage injecté ; A aucun identifiant ni rôle supposé, l'utilisateur vient de la session ; I purges et envoi de la déconnexion rejouables sans effet ; D contrats d'API inchangés, `setupOfflinePersistence` et `OfflineAction` conservés ; failure memory : l'ancien cache global est détruit à la connexion, tests de cloison et de déconnexion hors ligne en garde-fous ; retroactive : les téléphones déjà installés sont nettoyés par le nouveau service worker et par la purge du format global. Ne s'applique pas : base de données, serveur.
- **Reste / risques** :
  - Une déconnexion vide aussi la file d'écritures en attente de l'utilisateur et ses brouillons : le lot #10c devra avertir avant la déconnexion s'il reste des écritures non synchronisées.
  - Le registre des bases ne connaît que les comptes qui ont écrit après cette mise à jour ; sur un navigateur sans `indexedDB.databases()` (Firefox avant 126), un magasin plus ancien d'un autre compte n'est pas vidé par balayage (l'ancien format global, lui, l'est toujours).
  - Le `webServer` de `playwright.config.ts` reste déclaré quand `E2E_BASE_URL` est absent : lancer le spec avec cette variable, comme indiqué plus haut.
  - Une 401 reçue en cours de session par une autre requête que `/api/auth/me` ne passe pas par `expireOfflineSession` (seul `getCurrentUser` le fait).

## 2026-11-03T08:00:44+01:00 — CDC-10a — Amorçage rebranché après la fusion de main, file des autres comptes gardée

- Quoi : la fusion cc01c19 avait remplacé l'appel à `getCurrentUser` par `checkSession` dans `useAuth` (code de main 163a20a). Les garanties E1 (déconnexion différée avant `/me`), activation du magasin à la restauration et M3 (expiration sur 401) ne s'exécutaient plus. Les mentions de `getCurrentUser` plus haut décrivent l'état d'avant cette fusion.
- Comment : `client/src/lib/session-resume.ts` compose ces étapes autour de `checkSession` (dépendances injectées) ; `auth.ts` expose `resumeSession`, `useAuth` l'appelle dans sa boucle de nouvelle tentative ; `getCurrentUser` supprimé.
- Réserve de b7 : `purgeOthers` (connexion d'un autre compte sans déconnexion) ne supprime plus que le cache de lecture des autres comptes ; leur file d'écritures est gardée (illisible pour le compte connecté, `readQueue` exige le même userId). `purgeAll` renvoie et journalise le nombre d'écritures détruites à la déconnexion volontaire ; l'avertissement utilisateur reste au lot #10c (décision à prendre avant production).
- sw.js : les requêtes d'une autre origine ne sont plus mises en cache.
- Pourquoi : relecture NO-GO (fleet-relecteur, fleet-securite) ; leçon dans `docs/analysis/LESSONS_LEARNED.md`.
- Preuve : tsc 0 erreur, unitaires 1521/1521 (118 fichiers), dont `session-resume.test.ts` (6). e2e 13 non rejoué (la base du `.env` est la production).
