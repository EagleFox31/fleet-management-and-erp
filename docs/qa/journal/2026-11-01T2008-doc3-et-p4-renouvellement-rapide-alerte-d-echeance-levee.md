## DOC3 et P4 - renouvellement rapide : alerte d'échéance levée

**Quoi**
- `POST /api/document-renewals/quick-renew` lève désormais les alertes `doc_expiry` (due et expired)
  du document renouvelé, pour tous les destinataires, via `alertInboxService.clearDocumentExpiryAlerts`.
- Le client invalide les queries d'alertes sur `document_renewal_quick_completed`.

**Pourquoi**
- Test DOC3 rouge sur main : après renouvellement, l'échéance était à jour mais l'alerte restait,
  le tableau de bord annonçait encore un document renouvelé.
- La suppression passe par le service d'alertes, seul autorisé par le garde-fou `alerts-write-hygiene`.

**Preuve**
- Contrat `document-quick-renew-alerts` 2/2 (DOC3, P4) et `document-renewal-status` 1/1,
  unitaire 848/848, `tsc` 0 erreur.

**Reste**
- DOC1 (différé) ; FUEL3 à cadrer.

