# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T14:18:37+01:00 — T-47 contrôle qualité d'un OT
- **Statut** : fait
- **Quoi** : `POST /api/work-orders/:id/quality-check` (drapeau `quality-check`, chef d'atelier et admin). Validation : l'OT reste terminé ; rejet : retour en cours avec motif obligatoire (jamais `pending`, D-17). L'auteur et l'heure viennent de la session.
- **Comment** : `server/api/quality-check.routes.ts` remplace le squelette ; colonnes `qc_*` via `workOrderQuality` ; transaction ; événement `work_order_updated` avec `scope` par rôles (admin, chef d'atelier, technicien) ; violation d'exclusion 23P01 convertie en 409. Build (pas de service existant à adopter, machine d'états hors périmètre).
- **Pourquoi** : P-25, contrat `shared/contracts/quality-check.ts`.
- **Comment tester (QA)** : activer `FEATURE_FLAGS=quality-check=on`, terminer un OT, POST `{"result":"failed","reason":"..."}` en chef d'atelier : statut `in_progress`. Technicien : 403 ; OT non terminé : 409 ; rejet sans motif : 400. Preuve : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/work-order-quality-check.contract.test.ts` (7 passés).
