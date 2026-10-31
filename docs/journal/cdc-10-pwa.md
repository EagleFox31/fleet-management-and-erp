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
