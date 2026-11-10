## V3 point 2 : historique d'un ordre de travail activé par défaut

**Quoi** : le drapeau `work-order-audit-trail` passe à actif par défaut. L'écran `/maintenance/work-orders/:id/history` (chronologie des actions de l'OT) est branché et un bouton « Historique » apparaît sur la fiche de l'OT pour les rôles autorisés (hors chauffeur).

**Comment** : composant `WorkOrderHistory` enregistré dans `lot-screen-components.ts` ; lecture par contrat `GET /api/work-orders/:id/audit-trail` ; chaque ligne montre qui, quand, l'action en français et, si présent, le statut en libellé (jamais le JSON brut). Activation par la valeur par défaut de `shared/feature-flags.ts`, sans `FEATURE_FLAGS` sur le VPS.

**Pourquoi** : recette V3 faite ; le chef d'atelier doit retrouver qui a fait quoi sur un OT.

**Preuve** : l'historique d'un OT est complet : un chef d'atelier crée l'OT, le technicien le démarre puis le termine, et la chronologie liste les 3 entrées (contrat `tests/contract/work-order-audit-lifecycle.contract.test.ts`, y compris avec le préfixe `/API` en majuscules, rouge avec l'ancien middleware puis vert ; unitaires `audit-config.test.ts`). Le chef d'atelier ouvre l'historique depuis la fiche (e2e `e2e/31-work-order-history.spec.ts`, tout passe par les vraies routes, aucune ligne d'audit insérée à la main) ; le chauffeur n'a ni écran ni données. `tsc -p .` et `npm run check:tests` : 0 erreur.

**Limite connue** : seuls les OT créés par `POST /api/work-orders` ont une ligne « Création ». Les OT créés par le serveur (`incident-service.ts:162`, `preventive-maintenance-service.ts:278` et `:390`, `tires-service-simplified.ts:828`) n'écrivent pas dans le journal d'audit : leur chronologie commence à la première modification.
