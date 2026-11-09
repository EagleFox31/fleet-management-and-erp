## 2026-11-09T15:04:00+01:00 — Rapport des coûts : OT répétés ou sautés entre deux pages (réserve de relecture #599)

- **Statut** : fait (PR brouillon #599)
- **Quoi** :
  - `getWorkOrders` et `getWorkOrdersForTechnician` triaient par `createdAt` seul. À date de création égale (import en masse), un OT pouvait revenir sur deux pages et un autre être sauté, sans que le compte change. Départage par `id` décroissant ;
  - `fetchAllWorkOrders` dédoublonne par id, refuse si le nombre d'OT distincts ≠ total ou si le total change d'une page à l'autre, et formate le total en fr-FR ;
  - `useWarehouse` : l'échec de l'agrégat `/api/warehouse/reorder-alerts` (403 selon le rôle) n'affiche plus « Indisponible » pendant le chargement des deux sources.
- **Comment tester (QA)** :
  - `tests/integration/work-orders-pagination-tiebreak.test.ts` : 6 OT de même date lus page par page. Rouge avant : `[755, 755, 755, 755, 755, 760]` ; vert après ;
  - `tests/unit/client/fetch-all-work-orders.test.ts` : +3 cas (doublon entre pages, total qui change, format fr-FR), rouges puis verts ;
  - campagnes : tsc 0, check:tests 0, unitaires 319 fichiers / 3329 tests, contrats OT 20 fichiers / 255 tests sur Postgres local.
- **RAIDER** : D : contrat de `GET /api/work-orders` inchangé, l'ordre à date égale était indéterminé ; aucune donnée touchée.
- **Reste / risques** : `getWorkOrdersByOwner` et les autres listes paginées ne sont pas revues.

