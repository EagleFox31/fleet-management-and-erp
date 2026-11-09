## Lot 4c5792e, 244f720, b916003 - défauts trouvés par les cas partiels

**Quoi**
- `4c5792e` : rapprochement 3 voies, la recommandation suit la borne de `hasDiscrepancy` : 5 % pile = `escalate`.
- `244f720` : `createSupplierInvoice` vérifie la commande liée ; inconnue = 404 « Commande fournisseur introuvable. »
  (route de création et import Excel).
- `b916003` : export d'inventaire, « Alerte CDE » = quantité <= seuil (règle de `stock-alerts-service`) ;
  `updateStock` tient `parts.reorder_alert` à jour.
- Les trois `it.fails` de la PR #61 redeviennent des `it`.

**Pourquoi**
- Défauts rapportés par l'agent des cas partiels (entrée précédente), gardés en `it.fails` jusqu'au correctif.

**Preuve**
- Rouge : les trois `it.fails` passaient sur l'ancien code (défaut présent).
- Vert : contrat 20/20 (`purchase-order-three-way`, `purchase-order-lifecycle`, `client-invoice-payments`),
  intégration 19/19 (avec `parts-stock-adjustment`, `supplier-settlement-idempotence`), unitaire 845/845, `tsc` 0.

**Limites**
- `reorder_alert` reste périmé pour les autres chemins qui modifient `parts.quantity` (réception, sortie) ;
  plus aucun lecteur serveur ne s'y fie pour décider.

**Reste**
- ALR1-3, DOC1/DOC3 ; FUEL2/3, VEH2, MNT1/2, DIR2/3.

