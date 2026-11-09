## 2026-11-01 : cas partiels PO1, PO2, PRT3, CINV1

**Quoi**
- Contrats : `purchase-order-lifecycle` (chaîne draft à delivered, rôles, étape sautée 409, rejeu de livraison sans doublon de facture, stock reçu partiel puis complet), `purchase-order-three-way` (écart 0, 2 %, 10 %, facture sans commande, technicien refusé), `client-invoice-payments` (statuts pending/partial/paid, centimes en série, paiement sur facture soldée 409, synthèse client).
- Intégration : `stock-alert-lifecycle` (sous le seuil, pile au seuil, réappro partielle ou complète, retrait).

**Pourquoi**
- Lignes du plan en « Partiel » : seuls des e2e ou des services isolés les couvraient, sans rôle refusé ni rejeu.

**Preuve**
- Vert : PO1 et CINV1 (run du 1er novembre), PO2 8/8, PRT3 5/5 ; unitaire 839/839 ; `npm run check` 0 erreur.
- Rouge au premier passage, retenu comme défauts produit (tests en `it.fails`, à retirer à la correction) : voir Défauts.

**Défauts rapportés (non corrigés, à fleet-api / fleet-db)**
1. `server/services/three-way-matching-service.ts:286-295` : à exactement 5 % l'écart est marqué (`>=`) mais la recommandation reste `manual_review` (`<=`). Test : `exactement 5 % d'écart`.
2. `POST /api/supplier-invoices` avec un `purchaseOrderId` inexistant : 500 au lieu d'un 4xx lisible (`server/api/supplier-invoices.routes.ts`, création). Test : `commande inconnue`.
3. `server/services/parts-service.ts` (~250-300, `updateStock`) ne recalcule pas `parts.reorder_alert` ; l'export d'inventaire (`excel-export-service.ts` ~83) garde « Alerte CDE » = NON après une sortie sous le seuil. Test : `export d'inventaire`.

**Limites**
- Ces tests couvrent un comportement existant : pas de « rouge avant correctif », sauf les trois défauts ci-dessus (rouges constatés, gardés en `it.fails`).
- `POST /auto-approve` volontairement non appelé (il agirait sur toutes les factures reçues de la base).

**Reste**
- FUEL2/3, VEH2, MNT1/2, DIR2/3.

