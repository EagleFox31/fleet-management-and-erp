## Lot c7f565e, d12fdee - lignes de travail d'OT (WO3), demandes de renouvellement (DOC2)

**Quoi**
- `c7f565e` : `POST /api/work-orders/:id/items`, `PATCH` et `DELETE /api/work-order-items/:id`
  refusent l'écriture sur un OT terminé ou annulé (409) ; technicien ou poste inexistant : 400 lisible.
  La fiche OT masque l'édition des lignes sur OT terminé (annulé : déjà masqué).
- `d12fdee` : `PATCH /api/document-renewals/requests/:id/status` suit le cycle
  `pending -> in_progress -> completed`, rejet depuis `pending` ou `in_progress` ; terminée ou rejetée
  définitive (409) ; écriture conditionnelle sur le statut lu ; date d'échéance `AAAA-MM-JJ` réelle,
  sinon 400. Source : `shared/constants/document-renewal-statuses.ts`, `shared/constants/calendar-date.ts`.

**Pourquoi**
- Un OT clos ne se reprend que par le contrôle qualité : ses heures ne doivent plus bouger après coup.
  Un id inconnu finissait en 500 (clé étrangère).
- Une demande terminée pouvait repasser « en attente » ou être rejetée après coup ; une date illisible
  partait en erreur SQL.

**Preuve**
- Rouge sur l'ancien code : 2 contrat (201 au lieu de 409, 200 au lieu de 409).
- Vert : `work-order-items` 2/2, `document-renewal-status` 1/1, unitaire 837/837, `npm run check` 0 erreur.

**Reste**
- Pneus : stock usagé séparé du neuf (plan validé : `tires.used_stock_quantity`, `vehicle_tires.stock_source`).
- FUEL3 (kilométrage décroissant, volume > réservoir) : nouvelle règle d'anomalie, pas de capacité de
  réservoir en base. WO5, parcours P2/P3/P6, soft delete, DOC1/DOC3, ALR, DIR.

