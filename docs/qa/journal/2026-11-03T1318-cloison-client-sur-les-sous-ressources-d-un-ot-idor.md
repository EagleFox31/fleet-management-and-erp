## 2026-11-03 13:18 — Cloison client sur les sous-ressources d'un OT (IDOR)

- **Quoi** : `GET /api/work-orders/:id/parts`, `/:id/items` et `/:id/pending-part-requirements` n'exigeaient qu'une session. Un client énumérait les ids et lisait prix unitaires et heures des OT d'un autre client. Elles passent à `isAnyUser` puis à `assertWorkOrderReadable` : 404 si l'OT n'existe pas (avant la cloison), 403 si le véhicule n'est pas au client. Le personnel est inchangé ; un client lit toujours le coût de son propre OT (décision du commanditaire).
- **Comment** : helper `server/lib/work-order-scope.ts`, qui réutilise `storage.getWorkOrder`, `storage.getVehicle` et `canAccessOwned` (même lecture du propriétaire que `GET /api/work-orders/:id`). Les `catch` des trois handlers relaient une `AppError` au gestionnaire central. Seuls les GET sont touchés ; `server/routes.ts` : le handler existant, sans nouvelle route.
- **Pourquoi** : AGENTS.md §11. Un OT dont le véhicule n'a pas de propriétaire n'est lisible que par le personnel.
- **Preuves** : `tests/contract/work-order-detail-client-scope.contract.test.ts`, 15 cas (3 routes x 5). Rouge sur main : 9 échecs / 6 verts (les 6 verts sont personnel et propriétaire). Vert après : 15/15 sur fleet_test. Contrats voisins (work-order*, vehicle-documents-client-scope, part-requirements-chain, api-role-guard) 104/104. tsc 0, unit 1658/1658.

