## Lot b4f1cc9, 6696d11 - pneus : stock usagé séparé du neuf (TIR7), nettoyage des tests

**Quoi**
- `b4f1cc9` : `tires.used_stock_quantity` et `vehicle_tires.stock_source` (`new` | `used`), créés dans
  `init-database.ts` et `20261101_tires_used_stock.sql`. Démontage vers le stock : usagé +1, neuf
  inchangé. Montage : neuf par défaut, usagé sur choix explicite (`stockSource`), décrément atomique
  gardé ; source vide : 409 lisible. Création de fiche : usagé forcé à 0 ; PATCH usagé négatif : 400.
  Statistiques : valeur et stock bas sur le neuf seul, `usedQuantity` exposé. Écrans : tableau pneus,
  dialogues de montage et de démontage, tableau de bord magasin. Source : `shared/constants/tire-stock.ts`.
- `6696d11` : le nettoyage de test supprime les factures d'un fournisseur de test avant lui.

**Pourquoi**
- Un pneu qui a roulé revenait compté et valorisé comme neuf : stock, valeur d'inventaire et alertes
  de stock bas faussés.
- Une facture importée (numéro sans préfixe `TEST-`) bloquait la suppression de son fournisseur et
  faisait échouer le nettoyage global de toutes les suites de contrat.

**Preuve**
- Rouge sur l'ancien code : `tires-used-stock` 10/10, unitaire `tires-used-stock-schema` 2/2.
- Vert : `tires-used-stock`, `tires-rbac`, `supplier-invoice-import` 41/41 ; unitaire 839/839 ;
  `npm run check` 0 erreur ; `e2e/11` 1/1 (démontage → usagé, trame temps réel).

**Limites**
- Le stock existant reste compté neuf (aucun backfill : l'origine n'a pas été conservée).
- Pneu sérialisé et rechapage non modélisés.

**Reste**
- WO5, DOC1/DOC3 ; FUEL3 = nouvelle règle d'anomalie à cadrer.

