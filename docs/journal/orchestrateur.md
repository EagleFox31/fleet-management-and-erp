# Journal — orchestrateur

## 2026-10-30T13:08:32+01:00 — T-01 — Conventions du lot, RAIDER et journaux

- **Agent** : orchestrateur · **Branche** : `main` (non commité) · **Commit** : à venir (PR-01)
- **Statut** : fait
- **Quoi** : ADR 0001 complété par le standard RAIDER (§12) et le journal de travail par agent
  (§13) ; création de `docs/journal/` avec la convention et le modèle d'entrée.
- **Comment** : `docs/adr/0001-lot-recette-2026-11-02.md`, `docs/journal/README.md`,
  `docs/journal/orchestrateur.md`. Un fichier par agent pour éviter les conflits de fusion
  (Build : simple fichier Markdown, aucune brique existante ne couvrait le besoin).
- **Pourquoi** : RAIDER n'était cité que dans la checklist de PR ; il faut une trace par agent de
  qui a fait quoi, quand, et comment le tester.
- **Comment tester (QA)** :
  - Prérequis : aucun.
  - Étapes : ouvrir l'ADR §12 et §13, puis `docs/journal/README.md`.
  - Attendu : les 9 points RAIDER, la Definition of Done, le modèle d'entrée avec « Comment tester ».
  - Preuve automatisée : `grep -n "### 1[23]" docs/adr/0001-lot-recette-2026-11-02.md` → 2 lignes.
- **RAIDER** : documentation seule ; I, D, R (rétroactif) sans objet (aucun code ni donnée touchés).
- **Reste / risques** : republier la page des règles du lot pour le manager.

## 2026-10-30T13:22:00+01:00 — T-02, T-03 — Contrats d'interface, drapeaux, dépendances

- **Agent** : orchestrateur (à la place de SOL et API, voir Pourquoi) · **Branche** : `lot/sol/T-02-contrats` · **Commit** : celui de cette entrée
- **Statut** : fait, en attente de relecture (T-06, PR-01)
- **Quoi** : contrats zod de toutes les routes MUST et SHOULD du lot, drapeaux de fonctionnalité,
  catalogue des événements temps réel, dépendances `docx`, `altcha-lib`, `altcha`, `msw`.
- **Comment** :
  - `shared/feature-flags.ts` : clés, niveaux, défauts, lecture de `FEATURE_FLAGS` (`parseFeatureOverrides`, `resolveFeatureFlags`) ;
  - `shared/contracts/` : `common.ts` (dates, période, pagination), un fichier par ressource
    (exports, vehicle-document-types, auth-lockout, audit-logs, backups, work-order-export,
    notification-settings, work-order-booking, kpi, work-order-audit-trail, vehicle-cost-summary,
    tire-movements, part-requirement-receive, fuel-vouchers, fuel-anomalies, fuel-prices,
    time-tracking, pending-invoices, incidents, quality-check, auth-captcha, realtime-events) ;
  - `EXPORT_ROLE_MATRIX` typé sur `AppRole` : le serveur et le test de contrat le consomment ;
  - dépendances posées par `npm install --package-lock-only` : `node_modules` partagé non touché ;
  - choix : Adopt `altcha-lib` / `altcha` (captcha auto-hébergé), Adopt `docx`, Adopt `msw` 2.x ;
    Build pour les contrats (aucune brique existante, zod déjà installé).
- **Pourquoi** : M0 du plan (D1) ; les agents BE, API et FE développent sur ces contrats sans
  s'attendre. Fait par l'orchestrateur plutôt que par 2 agents : contrats cohérents entre eux,
  moins de jetons. Écarts au plan consignés dans l'ADR (« Contrats, écarts au plan »).
- **Comment tester (QA)** :
  - Prérequis : worktree `../fm-sol`, `node_modules` présent.
  - Étapes : lancer les commandes ci-dessous.
  - Attendu : 0 `error TS` ; 20 tests verts dans le fichier du lot, suite unitaire entière verte.
  - Preuve automatisée :
    - `node node_modules/typescript/bin/tsc --noEmit -p .` → 0 erreur ;
    - `node node_modules/vitest/vitest.mjs run tests/unit/shared/lot-recette-contracts.test.ts` → `20 passed` ;
    - `node node_modules/vitest/vitest.mjs run` → `32 files, 494 passed`.
- **RAIDER** :
  - R : briques communes (`common.ts`, matrice unique) ; A : aucun chemin ni hôte en dur hors chemins d'API ;
  - D : aucun fichier existant modifié hors `package.json` / lockfile, suites existantes vertes ;
  - E : refus par défaut des exports, test qui interdit tout import serveur ou client depuis `shared/contracts` ;
  - I, R (rétroactif) : sans objet, aucune écriture en base ;
  - gates : intégration et contrat HTTP non lancés, aucune route ni service touché.
- **Reste / risques** :
  - `npm install` à faire dans chaque worktree pour `docx`, `altcha`, `msw` (le `node_modules` du dépôt a été installé sous Linux) ;
  - T-08 : `AppError` avec `details` (pour `lockedUntil` et `conflicts`) ;
  - client : valider la durée de validité de l'ACF et de l'agrément PD.

## 2026-10-30T15:40:00+01:00 — ADR §6, noms de drapeaux

- **Quoi** : table des clés de l'ADR §6 alignée sur `shared/feature-flags.ts` (`work-order-audit-trail`, `vehicle-cost-summary`, `part-requirement-receive`, `oil-change-prefill`, `captcha`).
- **Comment** : correction du seul tableau de l'ADR ; le contrat fait foi, il n'est pas modifié.
- **Pourquoi** : écart relevé par pe (T-05) ; un agent qui lit l'ADR aurait appelé `requireFeature` avec une clé inexistante.
- **Comment tester (QA)** : chaque clé du tableau §6 existe dans `FEATURE_REGISTRY` : `grep -oE '\`[a-z-]+\` \(P-' docs/adr/0001-lot-recette-2026-11-02.md` puis rechercher chaque clé dans `shared/feature-flags.ts`.
- **RAIDER** : D (aucun contrat touché) ; les autres principes ne s'appliquent pas (documentation).
- **Reste/risques** : aucun.
