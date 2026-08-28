# Plan Blocs Métiers Restants (BD -> Backend -> API -> Frontend)

## Objectif
Centraliser un plan d'implémentation des blocs métiers restants avec, pour chaque bloc:
- Schéma BD et relation avec l'existant
- Triggers, vues, fonctions fenêtre
- Services backend (logique métier)
- Bus d'événements (temps réel inter-profils)
- API
- Câblage frontend
- Profils impactés et droits

Decoupage execution PERT puis Sprint: `docs/planning/PERT_SPRINT_BLOCS_METIERS_RESTANTS.md`

---

## Principes d'implémentation (règle d'équipe)
1. **Source unique métier en BD** (état + traçabilité).
2. **Chaque changement d'état émet un événement métier** (WebSocket + log activité).
3. **Snapshots/KPI recalculés ou maintenus de façon déterministe** (trigger ou job).
4. **RBAC explicite par action** (pas seulement par page).
5. **Pas de logique métier critique dans le frontend**.

---

## Bloc A - Maintenance OT + Pièces en attente

### BD (relations)
- Tables existantes: `work_orders`, `work_order_parts`, `part_requirements`, `parts`.
- Ajouts recommandés:
  - `work_order_parts.state` (`used`, `awaiting_supply`, `cancelled`)
  - `work_order_parts.required_quantity`
  - `work_order_parts.fulfilled_quantity`
  - `part_requirements.source` (`work_order`, `stock_threshold`, `manual`)
  - `part_requirements.work_order_id` (FK)
- Relations:
  - `part_requirements.work_order_id -> work_orders.id`
  - `work_order_parts.part_id -> parts.id`

### Triggers / vues / fonctions fenêtre
- Trigger:
  - Sur création `awaiting_supply`, créer/lier `part_requirement` si absent.
  - Sur réception stock, marquer les lignes OT éligibles comme `ready_to_use` (non sortie auto).
- Vues:
  - `v_work_orders_blocked_by_parts` (OT bloqués + manquants).
  - `v_part_shortage_by_work_order` (agrégation des manques).
- Fenêtre:
  - Priorisation des demandes par ancienneté/urgence: `row_number() over (partition by part_id order by urgency desc, created_at asc)`.

### Service backend
- `work-order-parts-workflow.service.ts`
  - Créer demande depuis OT
  - Réconcilier demande <-> stock reçu
  - Action "ajout définitif" pièce en OT

### Event bus (obligatoire)
- Événements:
  - `work_order.awaiting_parts`
  - `part_requirement.created_from_work_order`
  - `stock.received_for_requirement`
  - `work_order_part.fulfillable`
- Consommateurs:
  - Dash chef d'atelier, magasinier, technicien, liste demandes.

### API
- `POST /api/work-orders/:id/awaiting-parts`
- `POST /api/work-orders/:id/parts/:lineId/confirm-use`
- `GET /api/work-orders/blocked-by-parts`
- `GET /api/part-requirements?source=work_order`

### Frontend
- OT détail: tableau pièces avec état humain (`En attente appro`, `Prête à utiliser`, `Utilisée`).
- Magasinier dashboard: bloc OT bloqués + CTA "Passer la commande".
- Rafraîchissement temps réel sans reload.

### Profils impactés
- Technicien, Chef d'atelier, Magasinier, Secrétaire (lecture), Admin.

---

## Bloc B - Réapprovisionnement / Commandes fournisseur

### BD (relations)
- Tables existantes: `part_requirements`, `purchase_orders`, `purchase_order_items`, `suppliers`.
- Ajouts recommandés:
  - `purchase_orders.source_requirement_id` (nullable FK)
  - `purchase_order_items.source_requirement_item_id`
  - `purchase_order_items.requested_qty`, `ordered_qty`, `received_qty`
  - `purchase_orders.sent_by`, `confirmed_by`, `received_by`, `closed_by`
- Relations:
  - `source_requirement_id -> part_requirements.id`
  - `supplier_id -> suppliers.id`

### Triggers / vues / fonctions fenêtre
- Trigger:
  - Lors passage commande -> status requirement `ordered`.
  - Lors réception complète -> status requirement `fulfilled`.
- Vues:
  - `v_procurement_pipeline` (attente/commandé/reçu/clos).
  - `v_supplier_last_part` (dernier fournisseur par pièce).
- Fenêtre:
  - `last_value(supplier_id) over (...)` ou `row_number()` pour préselection fournisseur historique.

### Service backend
- `procurement-order-workflow.service.ts`
  - Conversion demande -> commande
  - Préremplissage fournisseur historique + lignes article
  - Cohérence quantités demandées/commandées/reçues

### Event bus
- `requirement.approved`
- `purchase_order.created`
- `purchase_order.sent`
- `purchase_order.received`
- `purchase_order.closed`

### API
- `POST /api/purchase-orders/from-requirement/:id`
- `PATCH /api/purchase-orders/:id/status`
- `GET /api/purchase-orders/:id/traceability`
- `GET /api/suppliers/last-for-part/:partId`

### Frontend
- `/procurement/orders/new`: préremplissage requirement + part + fournisseur historique.
- Affichage explicite des étapes métier (pas de code brut type `awaiting_parts`).
- Boutons d'action contextuels et clairs.

### Profils impactés
- Magasinier (principal), Secrétaire, Admin, Logisticien (selon cas non-stock atelier).

---

## Bloc C - Facture fournisseur + règlement + rapprochement

### BD (relations)
- Tables existantes: `supplier_invoices`, `supplier_invoice_settlements`, `purchase_orders`.
- Ajouts recommandés:
  - `supplier_invoices.validated_by`, `approved_by`
  - `supplier_invoices.reconciliation_status` (`pending`, `matched`, `variance`, `blocked`)
  - `supplier_invoice_settlements.proof_document_id` (obligatoire)
  - `supplier_invoice_settlements.recorded_by`, `reconciled_by`
- Relations:
  - `supplier_invoices.purchase_order_id -> purchase_orders.id`
  - `proof_document_id -> documents.id` (ou table storage dédiée)

### Triggers / vues / fonctions fenêtre
- Trigger:
  - Après règlement: recalcul `paid_amount`, `balance_due`, `payment_status`.
  - Si `balance_due = 0` et rapproché -> facture `paid`.
- Vues:
  - `v_supplier_invoice_kpi` (dette fournisseur, payé, partiellement payé).
  - `v_3way_matching_detail` (PO vs réception vs facture).
- Fenêtre:
  - Aging dette fournisseur: `sum(balance_due) over (partition by supplier_id order by due_date)`.

### Service backend
- `supplier-invoice-workflow.service.ts`
  - Valider, approuver, enregistrer règlement (preuve obligatoire), rapprocher.
  - Verrouiller transitions invalides.

### Event bus
- `supplier_invoice.validated`
- `supplier_invoice.approved`
- `supplier_invoice.settlement_recorded`
- `supplier_invoice.reconciled`
- `supplier_invoice.paid`

### API
- `PATCH /api/supplier-invoices/:id/validate`
- `PATCH /api/supplier-invoices/:id/approve`
- `POST /api/supplier-invoices/:id/settlements`
- `PATCH /api/supplier-invoices/:id/reconcile`
- `GET /api/supplier-invoices/kpi`

### Frontend
- KPI: **Dette fournisseur** / **Montant payé** / **Reste à payer**.
- Timeline traçabilité (qui a validé, payé, rapproché).
- Libellés métier clairs (`En attente validation`, `Validée`, `Partiellement réglée`, `Réglée`).

### Profils impactés
- Secrétaire (principal), Admin (backup), Magasinier (validation réception documentaire selon processus), Comptable futur.

---

## Bloc D - Dashboard cohérence cross-profils

### BD (relations)
- Réutilisation tables métiers + table cache KPI si nécessaire.
- Ajout recommandé:
  - `dashboard_snapshots` par domaine (`maintenance`, `stock`, `procurement`, `finance`).

### Triggers / vues / fonctions fenêtre
- Vues consolidées:
  - `v_dashboard_secretary_documents_due`
  - `v_dashboard_warehouse_replenishment_budget`
  - `v_dashboard_workshop_work_orders_live`
- Stratégie:
  - Vue live pour exactitude
  - Snapshot pour performance (rebuild event-driven)

### Service backend
- `dashboard-aggregator.service.ts`
  - Projection des KPI par profil depuis vues/snapshots.

### Event bus
- Toute transition métier majeure déclenche refresh ciblé:
  - documents expirés/renouvelés
  - OT status changed
  - stock movement
  - invoice settlement

### API
- `GET /api/dashboard/:profile`
- `GET /api/dashboard/:profile/stream` (ou WS channel dédié)

### Frontend
- Uniformiser le mapping statuts/chiffres entre cartes, tableaux, alertes.
- Plus aucun chiffre contradictoire entre dashboard et pages détail.

### Profils impactés
- Admin, Secrétaire, Chef d'atelier, Magasinier, Technicien.

---

## Bloc E - Traces métier et audit transversal

### BD (relations)
- Table recommandée: `workflow_activity_log`
  - `entity_type`, `entity_id`, `action`, `from_state`, `to_state`, `actor_id`, `actor_role`, `payload_json`, `created_at`.

### Triggers / vues
- Trigger d'audit sur transitions critiques (OT, demande pièce, commande, facture).
- Vue:
  - `v_entity_timeline` (timeline normalisée).

### Service backend
- `activity-log.service.ts` centralisé (single writer).

### Event bus
- Événement standard:
  - `workflow.activity.created`

### API
- `GET /api/activity/:entityType/:entityId`
- `GET /api/activity/feed`

### Frontend
- Widget "Traçabilité" homogène (même composant pour OT/commande/facture).

### Profils impactés
- Tous (lecture selon rôle).

---

## RBAC cible (synthèse)
- **Technicien**: crée demande pièce depuis OT, met à jour OT.
- **Chef d'atelier**: valide besoin technique, pilote OT.
- **Magasinier**: commande/réception/sortie stock (pièces).
- **Secrétaire**: validation administrative + factures fournisseur + règlement.
- **Admin**: supervision + actions de secours.
- **Comptable (futur)**: validation financière, règlement, rapprochement, clôture finance.

---

## Ordre de livraison recommandé
1. **A (OT + pièces en attente)** - stabiliser vérité métier atelier.
2. **B (demande -> commande)** - fiabiliser chaîne appro.
3. **C (facture/règlement/rapprochement)** - fiabiliser finance fournisseur.
4. **D (dashboards)** - aligner lecture management.
5. **E (audit transversal)** - verrouiller traçabilité.

---

## Définition de "Done" par bloc
- Migrations BD appliquées + rollback testé.
- Tests API + tests d'intégration workflow OK.
- Événements WS reçus sans refresh manuel.
- KPI dashboard cohérents avec pages détail.
- Traçabilité complète (`createdBy`, `updatedBy`, `...By` métier).
- QA inter-profils validée sur scénario E2E.

---

## Notes de gouvernance technique
- Éviter d'alourdir `server/routes.ts`:
  - créer des route modules par domaine (`server/api/*.routes.ts`)
  - garder `routes.ts` en composition/registre.
- Toute nouvelle transition métier doit inclure:
  - update état
  - log activité
  - émission event bus
  - invalidation cache/query pertinente
