## 2026-11-03 15:00 — Lot A3 : lectures GET ouvertes au client (carburant, stock, factures, KPI)

- **Quoi** : `GET /api/fuel-records` (liste et `?vehicleId=`), `/statistics`, `/consumption-history` et `/api/statistics/fleet` passent à `isAnyUser` et se limitent aux véhicules du client (`canAccessOwned`, `ownerScopeOf`) ; `parts-used`, `parts` (liste, statistiques, stock bas, mouvements, détail, historique de stock, stock réel), `invoices` (par famille, TVA mensuelle, pièces d'une facture), `statistics/fleet-kpi`, `fleet-history`, `scheduled-maintenance` passent à `isStaff`. `GET /api/work-orders/:id` et `/api/parts/:id/*` : id hors plage en 400.
- **Comment** : `tests/contract/client-read-scope.contract.test.ts` (deux clients A et B avec véhicule et pleins, un compte atelier, un chauffeur). Garde d'hygiène étendue aux GET portant une garde reconnue (`tests/support/route-guard-scan.ts` ; gardes locales ou nommées autrement non jugées, échec fermé au lot A4), liste gelée de 55 lectures restantes.
- **Pourquoi** : AGENTS.md §11 ; récidive après #157 et #163 (voir LESSONS_LEARNED, 2026-11-03).
- **Preuves** : contrat 40/40 ; rouge sur les handlers de main : 25 échecs, 15 verts ; unitaire de garde 15 cas dont un négatif par contournement.

