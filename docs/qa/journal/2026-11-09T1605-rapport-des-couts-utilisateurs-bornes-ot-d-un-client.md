## 2026-11-09T16:05:00+01:00 — Rapport des coûts : utilisateurs bornés ; OT d'un client départagés par id

- **Statut** : fait (PR brouillon empilée sur #606)
- **Quoi** :
  - `/api/users` ne pagine pas (`getAllUsers` sans limite) : la liste est complète, mais son volume n'est pas borné. `fetchAllUsers` (sur `fetchUnpaginatedList`, qui sert aussi `fetchFuelRecords`) refuse une lecture en échec et tout volume au-delà de 10 000, avec un message lisible ; le statut HTTP reste dans `detail`, pour les logs ;
  - `getWorkOrdersByOwner` triait par `createdAt` seul : à date égale, la liste d'un client pouvait répéter un OT d'une page à l'autre et en sauter un autre. Départage par `id` décroissant, comme `getWorkOrders` (#599). Aucun repli silencieux : la méthode n'a pas de catch.
- **Comment tester (QA)** :
  - `tests/integration/work-orders-pagination-tiebreak.test.ts`, cas « liste d'un client » : 6 OT de même date, lus un par page. Rouge avant : `[938, 938, 936, 935, 934, 933]` (937 sauté) ; vert après ;
  - `tests/unit/client/fetch-all-pages.test.ts` : 10 000 utilisateurs acceptés, 10 001 refusés (message exact), échec et non-liste refusés, statut 403 dans `detail` ;
  - branchement : `const usersList = await fetchAllUsers()`, plus de `fetch('/api/users')` dans `pdf-export.ts` ;
  - campagnes : unitaires 323 fichiers / 3369 tests ; tsc 0 ; check:tests 0 ; contrats `work-order` + `client-scope` 25 fichiers verts ; intégration verte (Postgres local).
- **RAIDER** : D : contrats d'API inchangés, `routes.ts` non touché ; dans `storage.ts`, seul l'`orderBy` change.
- **Reste / risques** : `/api/users` reste non paginé côté serveur. Les 7 lectures plafonnées gelées par `capped-list-reads-hygiene` sont à résorber écran par écran.

