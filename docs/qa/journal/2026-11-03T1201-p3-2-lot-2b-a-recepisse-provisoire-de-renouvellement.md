## 2026-11-03 — P3-2 lot 2b (A) : récépissé provisoire de renouvellement

- **Quoi** : dépôt du récépissé (`POST /api/document-renewals/requests/:id/receipt`) et prise en compte dans `getMissionEligibility` : papier échu éligible jusqu'à `receipt_valid_until` inclus, puis bloqué.
- **Comment** : `tests/contract/document-renewal-receipt.contract.test.ts` (8 cas : 201 et événement en rôles, 403 technicien/chauffeur/client, remplacement, 400 date passée/illisible/fichier absent/format, jour J, 404, 409 clôturée, chemin hors `uploads/`, CHECK 23514), `tests/contract/vehicle-renewal-receipt-eligibility.contract.test.ts` (6 cas, horloge injectée) et `tests/unit/shared/vehicle-eligibility-receipt.test.ts` (5 cas).
- **Pourquoi** : décision 3 du plan P3-2 ; une règle, une source (la date du récépissé entre dans `getMissionEligibility`).
- **Reste** : le branchement dans `missions.routes.ts` (autre session) ; sans lui, le récépissé n'est pas encore lu à l'affectation ni au lancement.

