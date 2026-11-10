## V3 point 2 : historique d'un ordre de travail activé par défaut

**Quoi** : le drapeau `work-order-audit-trail` passe à actif par défaut. L'écran `/maintenance/work-orders/:id/history` (chronologie des actions de l'OT) est branché et un bouton « Historique » apparaît sur la fiche de l'OT pour les rôles autorisés (hors chauffeur).

**Comment** : composant `WorkOrderHistory` enregistré dans `lot-screen-components.ts` ; lecture par contrat `GET /api/work-orders/:id/audit-trail` ; chaque ligne montre qui, quand, l'action en français et, si présent, le statut en libellé (jamais le JSON brut). Activation par la valeur par défaut de `shared/feature-flags.ts`, sans `FEATURE_FLAGS` sur le VPS.

**Pourquoi** : recette V3 faite ; le chef d'atelier doit retrouver qui a fait quoi sur un OT.

**Preuve** : e2e `e2e/31-work-order-history.spec.ts` (2 passés, Postgres local) : le chef d'atelier ouvre l'historique depuis la fiche et voit deux entrées dans l'ordre, le chauffeur n'a ni écran ni données ; tests unitaires client et shared : 1498 passés ; `tsc -p .` et `npm run check:tests` : 0 erreur.
