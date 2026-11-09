## 2026-11-09T15:19:00+01:00 — Rapports PDF : véhicules lus en entier, carburant sans repli à 0, logs migrés

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `fetch-all-pages.ts` : lecture paginée générique extraite de `fetchAllWorkOrders` (dédoublonnage par id, refus si total qui change, page vide avant le total, élément sans id, borne de 20 pages). `fetchAllWorkOrders` délègue, mêmes exports et messages ;
  - `fetchAllVehicles` (pages de 1000) remplace les trois `fetch('/api/vehicles?limit=1000')` des rapports d'utilisation, de coûts et de carburant : au-delà de 1000 véhicules, les suivants étaient omis sans le dire ;
  - `fetchFuelRecords` : une lecture de `/api/fuel-records` en échec refuse le rapport (`ReportRefusedError`) au lieu de produire un rapport de carburant à 0 ; les `catch` des rapports d'utilisation et de carburant transmettent ce refus ;
  - `pdf-export.ts` : les 18 `console.*` migrés vers `clientLogger` (13 appels ; regroupements listés dans la PR).
- **Comment tester (QA)** :
  - `tests/unit/client/fetch-all-pages.test.ts` (10 cas : 2 500 véhicules en 3 pages, échec en page 2, doublon, total qui change, page vide, borne 20 001, carburant en échec ou non-liste, chemin avec paramètres, élément sans id) ;
  - `tests/unit/client/money-stock-reads-error-states.test.ts` : branchement de pdf-export (aucun `console.`, 3 `fetchAllVehicles`, 2 `fetchFuelRecords`, refus transmis), rouges avant, verts après ;
  - `fetch-all-work-orders.test.ts` : 11 tests inchangés, verts ;
  - campagnes : tsc 0, check:tests 0, unitaires 322 fichiers / 3361 tests. Aucun code serveur touché.
- **RAIDER** : R : lecture paginée unique pour OT et véhicules ; D : contrats d'API inchangés, messages des OT inchangés.
- **Reste / risques** : `/api/users` du rapport des coûts lu en un appel (non paginé côté serveur) ; `getWorkOrdersByOwner` non revu.

