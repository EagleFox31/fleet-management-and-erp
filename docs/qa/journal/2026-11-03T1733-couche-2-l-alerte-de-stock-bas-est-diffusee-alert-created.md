## 2026-11-03 17:33 — Couche 2 : l'alerte de stock bas est diffusée (alert_created)

- **Quoi** : `storage.checkAndCreateStockAlerts` émet `alert_created` après le commit de l'alerte.
  - Hors transaction, la trame part tout de suite.
  - Dans une transaction, elle passe par `StockWriteOptions.afterCommit`. La route de sortie joue les effets une fois la transition validée.
- **Pourquoi** : l'alerte de stock bas était écrite sans trame, donc la cloche du magasin ne bougeait qu'au rafraîchissement suivant. Dans une transaction, l'alerte était aussi écrite hors de celle-ci et survivait à son annulation. Elle suit désormais l'exécuteur du mouvement.
- **Aussi** : retrait de l'appel mort `/api/invoices/monthly-stats` (`useBilling`, `api-calls`, `billingService`), qu'aucune route ne servait. Les deux listes gelées se réduisent d'autant.
- **Preuves** :
  - intégration `stock-alert-broadcast` : 4 cas, 3 rouges contre main ;
  - contrat `stock-issue-alert-broadcast` : rouge contre main ;
  - contrats de la sortie : 19/19 ;
  - unitaires : 1868/1868 ;
  - tsc : 0.

- Suite de relecture (#202) : l'alerte de stock bas ne s'écrit plus dans la transaction du mouvement mais après son commit, par `alertService.notifyLowStock`. Un échec de l'alerte (insert refusé) n'annulait pas seulement l'alerte : Postgres annulait toute la sortie. Destinataires : tous les admins et magasiniers (décision du 3 novembre 2026), une alerte et une trame nominatives chacun, anti-doublon par destinataire. Preuves : intégration 5/5 (4 rouges sur l'état précédent, dont l'échec d'insert forcé par déclencheur), contrat 1/1 rouge sur l'état précédent (magasinier tiers servi, technicien et client exclus).

- CI coupée sur les PR brouillons (décision du 3 novembre 2026). **Quoi** : `ci.yml` et `build-android-apk.yml` ne lancent rien sur un brouillon, et un run complet part au passage en ready (`ready_for_review`). **Comment** : `types` explicites, condition `draft` sur le job d'entrée, push sur `main` inchangé. **Pourquoi** : chaque poussée d'un brouillon payait la suite complète. La preuve se fait sur une PR de test (un brouillon, puis ready).

- Routes mortes de `routes.ts` supprimées (liste `SHADOWED_LEGACY_ROUTES_FROZEN` vidée). **Quoi** : 13 déclarations masquées par `server/api` (auth ×2, fuel-card ×7, suppliers/top, fault-catalog PATCH, workflows POST et PATCH), et le code qu'elles seules appelaient : `vehicle-auto-creation.ts`, `storage.updateFaultCatalog`, imports `isFuelCardManager`, `faultCatalog`, `vehicleAcquisitionWorkflows`. `PATCH /api/admin/users/:id/toggle` est conservée (garde chaînée). **Comment** : une famille, un contrat existant qui distingue la route servie de la morte (chauffeur désactivé, client en 403, valideur forcé et 404, statut ignoré et aucun véhicule créé par WFL1). **Pourquoi** : une route masquée dort avec ses gardes ; elle revient si l'ordre de montage change. Constat annexe : `GET /api/suppliers/summary` est capté par `/:id` (400), consigné par un contrat `it.fails`, correctif dans une autre PR.

