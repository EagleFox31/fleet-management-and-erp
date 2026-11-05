# Journal aa-route-id-lot1

## 2026-11-05 03:34 — lot 1 de #360 : 16 lectures d'id passées à parseRouteId

- Quoi : 16 lectures `parseInt` / `Number` de `req.params` dans 9 routeurs de `server/api` passent à `parseRouteId` (document-renewals, vehicle-documents, work-order-items, work-order-labor-rate, missions, warehouse, fault-catalog, purchase-orders, supplier-invoices). Les messages d'erreur ne changent pas. Le cliquet `route-id-parse-hygiene` baisse en conséquence : 6 fichiers sortent de la liste, 3 sont abaissés.
- Comment : `parseRouteId(valeur, message)` lève une `AppError` 400. Les `assertValidDbId` devenus redondants sont retirés, ainsi que le `MAX_INTEGER_ID` local de work-order-labor-rate. Le `res.status(400).json` du rapprochement de règlement devient un throw, que le gestionnaire central normalise.
- Pourquoi : `parseInt("1abc")` et `Number("1e0")` valent 1. La route agissait alors sur l'objet 1 (catalogue de pannes, ligne de commande, règlement, document, stock) au lieu de refuser.
- Tester : `tests/contract/route-id-strict-lot1.contract.test.ts`, 9 routes en admin. Ancien code rejoué : 7 rouges, 2 refusaient déjà. Correctif en place : 9 verts.
