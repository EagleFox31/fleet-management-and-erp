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

## Lot 6 — écritures de `server/routes.ts` (en place)

- Quoi : `routeIdOrNaN` remplace `parseInt` / `Number` sur 11 écritures.
  - Véhicules : PATCH, restore, mileage/sync, POST tires.
  - Planifications : generate-work-order, PATCH.
  - PATCH work-orders, fuel-records et tires.
  - PATCH vehicle-tires et vehicle-tires/remove.
- Détails :
  - `mileage/sync` n'avait aucun contrôle : il reçoit le 400 « ID de véhicule invalide ».
  - `generate-work-order` (`Number`) acceptait `1e0` et `" 7 "`.
- Comment : `ROUTES_TS_FROZEN = 28` (39 au lot 5). `POST /api/parts/:id/update-stock` est déjà strict : la route est `:id([0-9]+)` dans `parts-catalog.routes.ts`, donc hors lot.
- Pourquoi : `PATCH /api/vehicles/<id>abc` modifiait le véhicule `<id>`, et `restore` le restaurait.
- Tester : `route-id-strict-lot6` couvre 14 cas, dont 3 vérifient que l'objet reste intact (véhicule modifié, véhicule restauré, plein modifié).
  - Ancien code : 14 rouges. Correctif : 14 verts.
  - tsc : 0 erreur. Unitaires : 2440 verts. 45 contrats touchés : 559 verts.
- Effet de bord assumé : un id `0` répondait 404 (objet absent), il répond désormais 400 (id invalide).
- Hors périmètre : PATCH users (#379) et toggle admin-users (#375).

## Lot 7 — lectures de `server/routes.ts` (en place)

- Quoi : `routeIdOrNaN` remplace `parseInt` / `Number` sur les 26 lectures restantes.
  - 11 d'entre elles passent par `canAccessOwned` : documents de véhicule, téléchargement de document, planifications, OT, carburant, kilométrage et son historique, historique de statut, pneus du véhicule, documents de workflow.
  - `GET /api/work-orders/:id` (`Number`) acceptait `1e0`.
- Comment :
  - `ROUTES_TS_FROZEN = 2` : les deux lectures de la forme `parseInt(req.params…)` qui restent sont PATCH users (#379) et toggle admin-users (#375).
  - Le cliquet ne voit pas les lectures qui passent par une variable : `GET /api/vehicles/:id` (`parseInt(idOrRegistration)`, id ou immatriculation) lit encore de façon lâche. Elle est confiée au lot 9, avec `GET /api/users/:id`, monté avec `authenticate` seul.
  - `generate-work-order` était déjà couvert au lot 6.
- Pourquoi : un client propriétaire du véhicule `<id>` qui demandait `<id>abc` recevait les données du véhicule `<id>` au lieu d'un 400.
- Tester :
  - `route-id-strict-lot7` : 26 cas. Un témoin (le client lit son véhicule avec un id valide), 8 cas côté client et 17 côté personnel.
  - Ancien code : 25 rouges, le témoin reste vert. Correctif : 26 verts.
  - tsc : 0 erreur. Unitaires : 2440 verts. 97 contrats du périmètre : 1115 verts.

## Lot 8 — écritures de `server/api` (factures fournisseur, pièces d'OT, demandes de pièce)

- Quoi : `parseRouteId` (AppError 400) remplace `parseInt` sur 9 lectures d'écriture.
  - `supplier-invoices` : `PATCH /:id/validate`, `PATCH /:id/approve`, `POST /:id/payment`.
  - `work-order-parts` : `POST /:workOrderId/awaiting-parts`, `POST /:workOrderId/parts`, `POST /:workOrderId/part-requirements/:requirementId/issue` (2 ids).
  - `part-requirements` : `PATCH /:id`, `DELETE /:id`.
- Comment :
  - `work-order-parts` et `part-requirements` gardent leur message de 400. `supplier-invoices` n'avait aucun 400 sur ces trois routes : « Identifiant de facture invalide. » est un message nouveau, aligné sur celui du fichier.
  - Les contrôles `isNaN` devenus morts sont retirés.
  - `issue`, `PATCH` et `DELETE` de demande renvoyaient 500 pour toute erreur : leur catch relaie désormais les AppError (`next(error)`), le reste garde son log et son 500.
  - FROZEN : `supplier-invoices` 5 → 2, `work-order-parts` 5 → 1, `part-requirements` 3 → 1. Le reste (lectures) est confié au lot 9.
- Pourquoi : un appel sur `<id>abc` agissait sur l'objet `<id>`.
- Tester : `route-id-strict-lot8`, 9 cas. Chacun vise `<id>abc` avec `<id>` existant et vérifie le 400, le message, puis que l'objet `<id>` est intact (statut de facture et aucun règlement ; quantité en stock, statut de demande, aucun mouvement ni pièce utilisée ; aucune demande créée ; statut d'OT ; demande ni modifiée ni supprimée).
  - Ancien code : 9 rouges (200, 201 ou 204 ; `payment` répondait 400 sur un autre motif). Correctif : 9 verts.
  - tsc : 0 erreur. Unitaires : 2441 verts. 24 contrats du périmètre : 418 verts.
  - Ménage : sur l'ancien code, les routes écrivent (mouvement lié à l'OT, demande créée) et le mouvement bloquait la suppression de l'OT. Le `afterAll` retrouve désormais les OT par préfixe de titre (`TEST lot 8`) et les demandes par motif, puis supprime des enfants vers les parents. Rejoué : 0 résidu après le vert et après le rouge.

## Lot 9 — fin de `server/api`, `GET /api/vehicles/:id` et `GET /api/users/:id`

- Quoi : `parseRouteId` remplace les 14 lectures lâches qui restaient dans `server/api`.
  - `document-renewals` : `PATCH /requests/:id/status`.
  - `part-requirements` : `GET /by-part/:partId`.
  - `parts-catalog` : `DELETE`, `PATCH /parts/:id`, `POST /parts/:id/update-stock`.
  - `supplier-invoices` : `GET /:id`, `GET /:id/settlements`.
  - `vehicles` : `PUT /:id/mileage`, `PUT /:id/maintenance-position`.
  - `work-order-items` : `GET` et `POST /:workOrderId/items`, `PATCH` et `DELETE /work-order-items/:id`.
  - `work-order-parts` : `GET /:workOrderId/pending-part-requirements`.
  - `admin-users-guard` reste à 1 : il est traité par #375.
- Dans `server/routes.ts`, modifié en place :
  - `GET /api/vehicles/:id` : seuls des chiffres valent un id (400 hors de l'int4). Le reste est cherché comme immatriculation, donc `12abc` ne lit plus le véhicule 12.
  - `GET /api/users/:id` passe d'`authenticate` à `isAnyUser`. `authenticate` ne charge pas `req.user`, donc la route répondait 401 à tout compte. Hors admin, chacun ne lit que son profil.
- Comment :
  - Les messages existants sont gardés. `supplier-invoices GET /:id` n'avait pas de 400 : il prend « Identifiant de facture invalide. ».
  - `parts-catalog` était déjà filtré par `([0-9]+)`. Le gain porte sur `0` et sur un id hors de l'int4 (500 avant, 400 maintenant).
  - Les catch de `by-part`, `POST`, `PATCH` et `DELETE` de ligne d'OT relaient les AppError. Les 3 `console.error` de `work-order-items` sont migrés vers `log.error`, aucun n'est supprimé.
  - Le FROZEN ne garde que `admin-users-guard.routes.ts: 1`.
  - `supplier-invoice-error-details` provoquait sa 500 avec `pas-un-id`, qui répond désormais 400 : la 500 est maintenant provoquée par `vi.spyOn` sur le service.
- Tester : `route-id-strict-lot9`, 12 cas.
  - Véhicule : kilométrage et position inchangés.
  - Ligne d'OT : aucune créée, ni modifiée, ni supprimée.
  - `parts-catalog` : 0 et id hors de l'int4.
  - 7 lectures à 400.
  - Le client lit son véhicule par son id (témoin), et reçoit 404 sur `<id>abc`.
  - Profil : le sien à 200, celui d'un autre à 403, l'admin lit tout le monde.
  - Ancien code : 12 rouges (200, 201, 404, 500 ; `GET /api/users/:id` à 401). Correctif : 12 verts.
  - Ménage par préfixe de titre (`TEST lot 9`) : 0 résidu.
  - tsc : 0 erreur. Unitaires : 2441 verts. 50 contrats du périmètre : 793 verts.
- Réserves de relecture :
  - contrat : un client lit son véhicule par son immatriculation, et reçoit 403 sur celle d'un autre client ;
  - le profil `GET /api/users/:id` ne porte que ses 8 champs (garde-fou contre un futur mot de passe ou PIN) ;
  - les `console.error` des deux catch touchés dans `server/routes.ts` sont migrés vers `log.error`.
  - Contrat : 14 verts, 0 résidu.
