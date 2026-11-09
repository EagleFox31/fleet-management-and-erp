# Journal argent-routes-request-id

## 2026-11-09 — deux lectures « argent » sorties de routes.ts

- Quoi : `GET /api/parts/stock-movements` et `GET /api/statistics/maintenance-cost/:period` passent dans `server/api/money-reads.routes.ts` (monté dans `server/api/index.ts`, avant `registerRoutes`). Leurs `catch` locaux (`res.status(500)`, `console.error`) deviennent `next(error)`. La garde pass-through du coût de maintenance dans `statistics-cost-guard.routes.ts` disparaît (la route porte sa propre garde `MAINTENANCE_COST_READ_ROLES`).
- Comment : mêmes gardes (`isStaff`, admin et chef d'atelier), mêmes filtres, même forme 200. `queryIdOrNaN` devient `parseQueryId` (400 « ID de pièce invalide » inchangé). Cliquets mis à jour : ligne de maintenance-cost retirée de `CHAINED_GUARD_ROUTES` et de la table de balayage de cloison (la route n'est plus ouverte à un client).
- Pourquoi : un `catch` local figeait toute erreur en 500, y compris une `AppError` (409, 400) levée par la lecture. Le corps d'un 500 portait déjà `code` et `requestId` (intercepteur `res.json`), mais le log `console.error` de maintenance-cost n'avait pas de `requestId`.
- Tester : `tests/contract/money-reads-request-id.contract.test.ts` (12 tests). Sur main : 2 rouges (500 au lieu de 409 pour une `AppError`). Corrigé : 12 verts.
