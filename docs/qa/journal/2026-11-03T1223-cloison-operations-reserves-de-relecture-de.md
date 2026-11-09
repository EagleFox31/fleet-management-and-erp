## 2026-11-03 12:23 — Cloison operations : réserves de relecture de #149

- **Quoi** : R1, un compte chauffeur sans fiche `drivers` reçoit des listes vides et un 403 sur les coûts et les agrégats (contrat). R3, le refus des coûts lit `OPERATIONS_COST_READ_ROLES` (`shared/constants/roles.ts`, même forme que `WORK_ORDER_COST_READ_ROLES`) au lieu d'un `"driver"` en dur. R2, traité plutôt que reporté : pour un chauffeur, la jointure `assignments` ne retient que ses propres affectations (`assignmentsJoin`), donc une mission réaffectée ne lui renvoie plus le nom ni le véhicule de l'autre chauffeur. `purchasePrice` est masqué dans le véhicule de ses lignes.
- **Décision (utilisateur, 3 novembre 2026)** : `/missions/:id/costs` reste refusé au chauffeur, même pour sa propre mission. L'amortissement est tiré du prix d'achat du véhicule, et les agrégats couvrent toute la flotte. D'où le masquage de `purchasePrice` dans les listes.
- **Preuves** : contrat `operations-driver-scope` 9/9 sur fleet_test ; mutation (service remis à la version précédente) : « mission réaffectée » rouge, 8/9. Erreurs contrôlées par `apiErrorProblems` (`tests/support/api-error.ts`, #146). tsc 0, unit 1633/1633.

