# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T16:08:35+01:00 — T-43 — Routes d'incidents

- **Agent** : api-2 · **Branche** : `lot/api/T-43-incidents-routes` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `POST` et `GET /api/incidents` (déclaration de panne) derrière le drapeau `incidents`.
- **Comment** : `server/api/incidents.routes.ts` appelle `createIncident` / `listIncidents` de be-2 (PR #29, branche fusionnée ici avec T-08). Gardes : drapeau, `authenticate`, `isAnyUser` ; le périmètre (client 403, chauffeur limité à ses véhicules en affectation active, personnel libre) est tranché par le service. POST répond 201.
- **Pourquoi** : P-22.
- **Comment tester (QA)** :
  - Prérequis : `FEATURE_FLAGS=incidents=on`, comptes chauffeur (avec affectation active), chef d'atelier, client.
  - Étapes : 1. Chauffeur déclare une panne sur son véhicule puis sur un autre. 2. Chef d'atelier déclare sur n'importe quel véhicule. 3. Client et anonyme appellent la route. 4. GET par chauffeur puis par chef d'atelier.
  - Attendu : 201 puis 403 ; 201 ; 403 et 401 ; le chauffeur ne voit que les siennes. Drapeau coupé : 404.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/incidents.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert moindre privilège, drapeau, nettoyage des données de test ; sans objet : migration.
- **Reste / risques** : dépend de la PR #29 (service). Les lancements de test ont souffert de coupures réseau vers Neon (relancés).
