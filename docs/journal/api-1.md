# Journal — API 1 (`api-1`)

Worktree : `../fm-api-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T15:00:00+01:00 — T-11a/T-11b/T-62 — Garde de role des exports et isStaff au montage

- **Agent** : api-1 · **Branche** : `lot/api/T-11-exports-garde` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : un client, un chauffeur ou un technicien ne telecharge plus les exports (403) ; un client ne lit ni n'ecrit plus sur warehouse, fuel-card, drivers, missions, clients, operations, part-requirements (403).
- **Comment** : `server/middleware/exports-guard.ts` (coupe-circuit `exports` -> 404, `isAnyUser`, puis `canExport` sur `EXPORT_ROLE_MATRIX`, refus par defaut) ; `server/api/index.ts` : uniquement les lignes de montage des 8 prefixes (+ import). Test `tests/contract/lot-exports-roles.contract.test.ts`. Coupe-circuit local (`resolveFeatureFlags`) a remplacer par `requireFeature` de T-08. Adopt `isStaff`/`isAnyUser`, Build la garde.
- **Pourquoi** : P-01, AGENTS section 11, plan 05-api T-11a/b et T-62.
- **Comment tester (QA)** :
  - Prerequis : un compte par role.
  - Etapes : 1. GET /api/exports/inventory avec client puis admin. 2. GET /api/missions avec client puis driver.
  - Attendu : client 403 ; admin 200 ; driver 200.
  - Preuve automatisee : `node ../lot-tools/db-lock.mjs api-1 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/lot-exports-roles.contract.test.ts` -> ROUGE avant (65 failed | 52 passed), VERT apres (117 passed). tsc global : 0 erreur.
- **RAIDER** : R/A matrice et roles lus des contrats ; I sans ecriture ; D technician/driver non refuses sur les montages staff ; E AppError, refus par defaut. Failure memory : le test de garde de session ne prouve pas la garde de role.
- **Reste / risques** : les `res.status(500).json({error: error.message})` et `console.*` de exports.routes.ts restent (T-11a, a faire) ; routes.ts sert /api/exports/{vehicles,work-orders,fuel,users,complete} avec `authenticate` seul : elles tombent maintenant sous la garde et recoivent 403 pour tous (y compris admin) ; pages/reports/index.tsx et exportsService (`/exports/fuel`) en dependent.
