## 2026-11-03 15:31 — Couche 3 : réserves de relecture sur #179

- **Quoi** : NOT_YET_IN_TABLE et UNCOVERED_SATELLITES sont figées par égalité stricte. Le groupe fuel couvre aussi `["/api/fuel-card/vehicle", id, …]` et le préfixe `/api/fuel-records/vehicle/` (fiche véhicule). La JSDoc de `invalidateCatalogEvent` est revenue au-dessus de sa fonction.
- **Pourquoi** : réserve du relecteur. Les deux listes pouvaient grandir sans que le test échoue, ce qui contredisait leur nature de liste gelée.
- **Preuves** : rouge si on ajoute une entrée à l'une ou l'autre liste (2 échecs). tsc 0, unitaires 142/142 fichiers.

