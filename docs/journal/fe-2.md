# Journal — Frontend 2 (`fe-2`)

Worktree : `../fm-fe-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T13:55:18+01:00 — T-09b — Socle de mocks msw
- **Agent** : fe-2 · **Branche** : `lot/fe/T-09b-mocks` · **Commit** : voir PR
- **Statut** : fait
- **Quoi** : `client/src/mocks/` simule 30 routes des contrats (sauvegardes, notifications, KPI, incidents, pneus, pointage, factures, verrouillage, captcha, audit, carburant, contrôle qualité, types de document). Scénario liste vide par `?mockScenario=empty`.
- **Comment** : table pure `routes.ts` (sans msw) + `handlers.ts` (msw 2.x, valide chaque succès par le schéma du contrat) + `browser.ts` + `enable-mocks.ts`. `main.tsx` : import dynamique gardé par `import.meta.env.DEV && VITE_API_MOCKS=1`, PWA non enregistrée en mode mock. `client/public/mockServiceWorker.js` généré par `msw init`. Choix Adopt (msw).
- **Pourquoi** : le FE n'attend pas l'API (D1) ; un mock validé par zod ne peut pas dériver du contrat.
- **Comment tester (QA)** :
  - Prérequis : `VITE_API_MOCKS=1` dans l'environnement du serveur de développement.
  - Étapes : 1. lancer le client en développement ; 2. ouvrir la console réseau ; 3. appeler `/api/kpi/preventive-compliance`.
  - Attendu : réponse servie par le service worker (planned 24, rate 0.875). Sans la variable : aucun mock.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/client/mocks-contracts.test.ts` → 59 passed ; `vite build` : aucun code mock dans `dist`.
- **RAIDER** : couvert R (table réutilisée par tests et navigateur), D (aucun contrat touché), I (store recréé à chaque démarrage). Exports binaires non simulés.
- **Reste / risques** : `mockServiceWorker.js` est copié dans `dist` (inerte, jamais enregistré hors mode mock).
