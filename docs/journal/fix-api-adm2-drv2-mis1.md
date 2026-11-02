## 2026-11-02T20:00:00+01:00 - Defauts serveur ADM2-3, MIS1-API-1, DRV2-1/2/3

- **Agent** : fleet-api · **Branche** : `fix/api-adm2-drv2-mis1` · **Commit** : voir `git log` de la branche
- **Statut** : fait ; branchement du bouton chauffeur laisse a fleet-fe
- **Quoi** : (1) `/api/purchase-orders` utilise `isAnyUser` (role relu en base) au lieu d'une copie du role de session ; (2) `PATCH /api/missions/:id` applique `getMissionEligibility` a l'affectation (400, message, `blockers`, `errors`) ; (3) cloison chauffeur sur `GET /api/missions`, toutes les routes `/api/missions/:id/...` et `GET /api/drivers/:id/missions` (`server/lib/driver-scope.ts`) ; (4) `POST /api/driver/breakdowns` (`server/api/driver-breakdowns.routes.ts`) : incident, OT `pending` lie, alerte atelier, evenements `incident_reported` et `work_order_created`.
- **Comment** : `router.param("id")` sur le routeur missions pour couvrir toutes les sous-routes d'un coup ; `createIncident` recoit l'option `openWorkOrder` (OT et incident dans une meme transaction), sans effet sur la route historique `/api/incidents`.
- **Pourquoi** : defauts figes par les e2e des PR #96 et #101 ; un role change par l'admin doit valoir immediatement, un chauffeur ne voit que ses missions, une panne doit atteindre l'atelier.
- **Comment tester (QA)** : `node ../lot-tools/db-lock.mjs <agent> -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/adm2-drv2-mis1-server-defects.contract.test.ts`
- **Preuve** : contrat 15 verts (11 rouges avant correctif) ; 7 contrats voisins (70 tests) verts ; unitaires 917 verts ; `tsc` global a zero.
