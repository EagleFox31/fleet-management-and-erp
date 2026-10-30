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

## 2026-10-30T14:10:00+01:00 — T-33a/T-35/T-52/T-54a/T-54b — Composants d'écran sur les contrats
- **Agent** : fe-2 · **Branche** : `lot/fe/T-54-ecrans` · **Commit** : voir PR
- **Statut** : fait côté composants ; branchement dans les pages de fe-1 à faire
- **Quoi** : sauvegardes admin, préférences de notification (sans e-mail), tuiles KPI (taux nul affiché "—"), déclaration et liste d'incidents, ligne de réception en stock, mouvements de pneus, grille de pointage, factures en attente, défi ALTCHA.
- **Comment** : `useContractQuery` (réponse validée par le schéma du contrat, clé `[path, params]`), `PremiumDataTable`, `useSingleFlightMutate`, `userMessageOf`, brouillon d'incident via `useFormDraft`. Pointage : un PUT par cellule modifiée (le contrat est un upsert par entrée).
- **Pourquoi** : écrans prêts sur les contrats et les mocks, sans toucher aux fichiers de fe-1.
- **Comment tester (QA)** :
  - Prérequis : `VITE_API_MOCKS=1`, composants montés dans les pages.
  - Attendu : KPI sans donnée affiche "—" ; pointage n'envoie que les cellules changées.
  - Preuve automatisée : `tsc` 0 erreur ; `tests/unit/client/screens-helpers.test.ts` 6 passed.
- **RAIDER** : couvert R, D, I (second enregistrement sans cellule changée = aucune requête). Pas de test navigateur ici.
- **Reste / risques** : preuve ALTCHA (événement `statechange`) non vérifiée contre le vrai serveur.
