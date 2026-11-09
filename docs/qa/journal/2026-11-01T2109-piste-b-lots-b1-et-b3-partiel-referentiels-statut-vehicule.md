## Piste B, lots B1 et B3 (partiel) - référentiels, statut véhicule, libellés de demande

**Quoi**
- CLI1, PRT1, SUP1, SUP2, CAT2 au contrat (`clients-crud`, `parts-catalog-crud`, `suppliers-crud-ratings`,
  `fault-catalog-lifecycle`), VEH4 en intégration (`vehicle-status-sync`), PRT5 en unitaire
  (`part-requirement-labels-hygiene`). Aide `tests/support/contract-actors.ts` (plusieurs comptes de rôles).

**Pourquoi**
- Plan `PLAN_COUVERTURE_MODULES.md` : ces cas étaient « à faire ». Les défauts trouvés sont figés en `it.fails`
  (le test devient rouge le jour du correctif, ce qui force à retirer `.fails`).

**Défauts figés (`it.fails`)**
- `POST /api/parts` : référence en doublon, 500 ; prix non numérique, 500 ; stock négatif accepté (201).
- `DELETE /api/parts/:id` : id inconnu ou second appel, 500 au lieu de 404.
- `POST /api/suppliers` : nom en doublon, 500 au lieu de 409.
- `POST /api/purchase-orders` : accepte un fournisseur désactivé.
- Le chef d'atelier est refusé sur tout `/api/suppliers` (montage `PROCUREMENT_ROLES`) : la règle de notation
  de `supplier-categories.ts` pour ce rôle est inatteignable.
- `PATCH /api/fault-catalog/:id` : id inconnu, 200 ; `validatedBy` forgeable par le corps et jamais renseigné par le serveur.
- Annulation du dernier OT ouvert : le véhicule reste en maintenance (`storage.ts`, mise à jour d'OT).

**Preuve**
- Contrat 74/74 (11 `it.fails`), intégration VEH4 8/8 (1 `it.fails`), unitaire 855/855, `tsc` 0 erreur.
- PRT5 rouge avec `issued: "Terminé"` ajouté à `requests.tsx` (restauré), vert sans.

**Limites**
- Variante, spécification, catégories de pièce et pièces associées d'un défaut : aucune route, non couvrables.
- VEH1, VEH3, MIS2 écrits mais jamais exécutés (consigne d'arrêt) : non livrés. MIS1, P2, ADM2, DRV2, WO1, WO7, T6, P5, P6 non commencés.

