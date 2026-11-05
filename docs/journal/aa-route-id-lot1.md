# Journal aa-route-id-lot1

## 2026-11-05 03:34 — lot 1 de #360 : 16 lectures d'id passées à parseRouteId

- Quoi : 16 lectures `parseInt` / `Number` de `req.params` dans 9 routeurs de `server/api` passent à `parseRouteId` (document-renewals, vehicle-documents, work-order-items, work-order-labor-rate, missions, warehouse, fault-catalog, purchase-orders, supplier-invoices). Les messages d'erreur ne changent pas. Le cliquet `route-id-parse-hygiene` baisse en conséquence : 6 fichiers sortent de la liste, 3 sont abaissés.
- Comment : `parseRouteId(valeur, message)` lève une `AppError` 400. Les `assertValidDbId` devenus redondants sont retirés, ainsi que le `MAX_INTEGER_ID` local de work-order-labor-rate. Le `res.status(400).json` du rapprochement de règlement devient un throw, que le gestionnaire central normalise.
- Pourquoi : `parseInt("1abc")` et `Number("1e0")` valent 1. La route agissait alors sur l'objet 1 (catalogue de pannes, ligne de commande, règlement, document, stock) au lieu de refuser.
- Tester : `tests/contract/route-id-strict-lot1.contract.test.ts`, 9 routes en admin. Ancien code rejoué : 7 rouges, 2 refusaient déjà. Correctif en place : 9 verts.

## 2026-11-05 03:38 — lot 2 de #360 : fournisseurs

- Quoi : les 7 lectures `parseInt(req.params.id)` des routes de `suppliers.routes.ts` (lecture, performances, modification, évaluations, calcul des évaluations, désactivation, réactivation) passent à `parseRouteId`. FROZEN : suppliers passe de 8 à 1. Celle qui reste est dans le middleware `checkEvaluationPermission`, hors du périmètre de ce lot.
- Comment : le bloc `isNaN` + `res.status(400).json({ error })` est remplacé par une `AppError` 400 « ID invalide », normalisée en `{ message }` par le gestionnaire central. « de » a vérifié qu'aucun écran ne lit `.error`.
- Pourquoi : `parseInt("1abc")` vaut 1. La route lisait, modifiait ou désactivait le fournisseur 1.
- Tester : `tests/contract/route-id-strict-suppliers.contract.test.ts` (GET, PATCH, DELETE `/api/suppliers/1abc`). Ancien code rejoué : 3 rouges. Correctif en place : 3 verts.

## 2026-11-05 03:53 — lot 3 de #360 : garde d'évaluation fournisseur, CPC et compte chauffeur

- Quoi : `parseRouteId` remplace `parseInt` dans le middleware `checkEvaluationPermission` (suppliers:99), dans `drivers.routes.ts` (update-cpc, cpc-status) et dans `drivers-management.routes.ts` (create-user, qui n'avait aucune garde). FROZEN : suppliers, drivers et drivers-management sortent de la liste. Le contrat fournisseurs couvre maintenant les 7 routes, plus un test sur l'objet réel.
- Comment : les `catch` de ces trois routes enveloppaient toute erreur en 500. Ils laissent maintenant passer une `AppError`. Le service CPC ne lève que des `Error` simples : le reste de leur comportement ne change pas.
- Pourquoi : comportement relevé avant le correctif :
  - `PATCH /suppliers/1abc/rating` répondait 404 après avoir cherché le fournisseur 1 ;
  - `abc` répondait 500, et `99999999999` aussi, en 8,8 s ;
  - les routes CPC chauffeur répondaient 500 sur `1abc` ;
  - `create-user` sur `1abc` visait le chauffeur 1 ;
  - `DELETE /suppliers/<id>abc` répondait 200 et désactivait le fournisseur <id>.
- Tester :
  - `route-id-strict-lot3` : 8 cas. Ancien code 6 rouges ; les id valides inconnus gardent leur 404. Correctif 8 verts.
  - `route-id-strict-suppliers` : 8 cas, dont la non-désactivation. Code du lot 1 : 8 rouges. Correctif : 8 verts.
  - 15 contrats existants sur chauffeurs et fournisseurs : 467 verts.

## 2026-11-05 04:16 — lot 4 de #360 : parseurs locaux lâches, chauffeur absent en 404

- Correctif du lot 3 : « Code du lot 1 : 8 rouges » est faux pour `route-id-strict-suppliers`. Sur la tête de #366, il y a 2 rouges (rating et calculate-ratings) ; les 8 rouges ne valent que pour le code d'avant le lot 1.
- Quoi :
  - `parseDriverId` (supprimé), `parseClientId`, `parseAlertId`, `parseCenterId`, et `idParam` (`server/lib/route-helpers.ts`, 19 appels) délèguent à `parseRouteId`. `parseIdParam` (commandes fournisseur), déjà strict, délègue aussi pour n'avoir qu'une lecture. `parseCenterId` garde son 404 « Centre agréé introuvable. » : c'est le contrat existant.
  - Le service CPC lève `AppError(404, "Chauffeur introuvable")` au lieu d'une `Error`. Cela couvre GET `/api/drivers/:id`, `cpc-status` et `update-cpc` sur un id valide mais absent, qui répondaient 500.
  - Les catch des 5 routes chauffeur laissent passer une `AppError`.
- Comment : le cliquet `route-id-parse-hygiene` lit maintenant l'AST. Il compte chaque appel `f(req.params…)` quand `f` est un parseur local, ou importé par chemin relatif, qui fait `parseInt` ou `Number(…)` sans déléguer à `parseRouteId`. Les prédicats (`value is string`, `: boolean`) sont exclus, par exemple `isVehicleIdSegment`.
  - FROZEN : la liste provisoire comptait alerts, clients et document-renewal-centers (lus par le compteur AST) ; ils n'y entrent pas. Ils n'ont jamais figuré dans le FROZEN fusionné.
  - fault-catalog et fuel-records n'y entrent pas : `idParam` est corrigé à la source.
  - parts-catalog reste à 3.
- Pourquoi : `parseDriverId` lisait `"1abc"` comme 1 et contournait le cliquet textuel, qui ne voyait que `parseInt(req.params`. La route `DELETE /api/drivers/<id>abc` désactivait le chauffeur `<id>`.
- Tester :
  - mutation : avec l'ancien `idParam`, le cliquet passe au rouge (fault-catalog 6, fuel-records 1, parts-catalog 15) ; avec l'ancien `parseDriverId`, il passe aussi au rouge (drivers-management 5).
  - `route-id-strict-lot4` : 18 cas. Ancien code : 16 rouges ; restent verts le 404 du centre agréé (non-régression) et create-user (corrigé au lot 3). Correctif : 18 verts.
  - tsc : 0 erreur. Unitaires : 2438 verts. 32 contrats touchés : 445 verts.
- Hors périmètre : le filet contre les id au-delà de l'int4 (middleware `/api`) est confié à la session de.

## Lot 5 — `server/routes.ts` (en place) et statistiques carburant

- Quoi :
  - `routeIdOrNaN` (`server/lib/route-id.ts`) fait la même lecture que `parseRouteId`, mais rend `NaN` au lieu de lever. Il remplace `parseInt` en place dans `server/routes.ts`, qui est gelé et dont les handlers testent déjà `isNaN`.
  - Routes concernées : 9 DELETE (users, admin/users, vehicles, maintenance-schedules, work-orders, parts-used, fault-catalog, tires, workflows/documents), plus `GET /api/work-orders/vehicle/:vehicleId` et `/technician/:technicianId`.
  - `fuel-card.routes.ts` : stats et anomalies par véhicule passent par `parseRouteId`. Le catch laisse passer l'`AppError`.
- Comment : le cliquet compte les lectures lâches de `routes.ts` (`ROUTES_TS_FROZEN = 39`, contre 50 sur `origin/main`). fuel-card sort de FROZEN.
- Pourquoi : `DELETE /api/vehicles/<id>abc` visait le véhicule `<id>`.
- Correctif de méthode : les deux GET d'OT, d'abord notés comme masqués par `GET /api/work-orders/:id`, sont vivants (`:id` = un seul segment). Ils sont corrigés et non supprimés (voir LESSONS, 2026-11-05).
- Tester : `route-id-strict-lot5` compte 15 cas. Sur l'ancien code, 15 rouges. Le correctif les rend verts. `former-storage-stubs` reste vert.
- Réserves de relecture : DELETE users (suppression douce) et DELETE admin/users (définitive) vérifient `deletedAt` nul ; un test cantonne `routeIdOrNaN` à `server/routes.ts`.
- Hors périmètre : PATCH users (b7) et toggle admin-users (c7, #375).
