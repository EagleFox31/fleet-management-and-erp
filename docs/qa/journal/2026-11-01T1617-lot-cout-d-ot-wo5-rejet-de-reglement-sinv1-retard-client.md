## Lot 5ef2af6, 5437147, 0d5db1d - coût d'OT (WO5), rejet de règlement (SINV1), retard client (CINV2)

**Quoi**
- `5ef2af6` : formule unique `computeWorkOrderCost` (`shared/work-order-cost.ts`) pour l'écran de
  détail et le PDF de l'OT ; KPI de coût moyen par intervention : rotations de pneus ajoutées.
- `5437147` : `PATCH /api/supplier-invoices/:id/settlements/:settlementId/reject`, motif obligatoire,
  colonnes `rejected_by`, `rejected_at`, `rejection_reason` (init + `20261101_supplier_settlement_rejection.sql`),
  événement `supplier_invoice_settlement_rejected`, bouton « Rejeter » et dialogue de motif.
- `0d5db1d` : `markOverdueInvoices` dans le cycle de fond ; un paiement partiel garde le retard ;
  événement `client_invoices_overdue`. Échéance par défaut des factures de test : 2099.
- SINV2 : déjà couvert par T7, statut mis à jour sans nouveau test.

**Pourquoi**
- WO5 : une pièce sans prix donnait « NaN » à l'écran et 0 dans le PDF ; le KPI ignorait les pneus.
- SINV1 : `rejected` existait sans route ; une saisie erronée bloquait le vrai règlement en 409.
- CINV2 : rien ne posait `overdue`, le compteur « en retard » restait à 0.

**Preuve**
- Rouge sur l'ancien code : `supplier-settlement-reject` 6/6, `client-invoice-overdue` 2/2,
  `kpi-service` coût moyen 1/1, unitaires `work-order-cost` et schéma de rejet.
- Vert : intégration 22/22 (avec `client-payment-idempotence`, `supplier-settlement-idempotence`),
  contrat 12/12 (avec les deux suites de règlement existantes), unitaire 845/845, `tsc` 0 erreur.

**Limites**
- Retard calculé à la date de Douala, au plus tard au cycle suivant (5 min).
- Le rejet n'est pas annulable ; une nouvelle saisie remplace le règlement rejeté.
- Pas d'e2e : écran de rejet vérifié par `tsc` seulement.

**Reste**
- ALR1-3, DOC1/DOC3 ; FUEL3 = nouvelle règle d'anomalie à cadrer.

---

