## 9f9ca09 - Encaissement client idempotent (T7 paiement, T3)

**Quoi**
- Un paiement de facture client saisi deux fois n'est enregistré et déduit qu'une fois.
- Deux paiements simultanés sont tous deux déduits (plus de paiement perdu).
- Paiement au-delà du solde ou sur facture annulée : 409 lisible.
- Corps invalide (montant non numérique, négatif, mode inconnu) : 400 lisible, solde intact.

**Comment**
- Test d'intégration d'abord (`tests/integration/client-payment-idempotence.test.ts`) : 8 rouges.
  Le cas des deux paiements partiels simultanés est vert seul et rouge dans la suite
  sur l'ancien code : c'est une vraie course, sa détection dépend du timing.
- Service (`server/services/client-billing-service.ts`, `recordPayment`) : même motif que
  676de75 : transaction, `FOR UPDATE` sur la facture, clé d'idempotence = référence
  de paiement, plafond vérifié sous verrou, `AppError` 404/409. `console.log` migrés vers
  `moduleLogger("client-billing")`.
- Route (`server/api/billing.routes.ts`) : schéma Zod avec messages en français, mode de
  paiement dérivé de l'énumération de la colonne (`clientPayments.paymentMethod.enumValues`),
  erreurs -> `next(error)`, pas de diffusion WebSocket sur un rejeu.
- Écran (`client/src/pages/operations/invoices/[id].tsx`) : toast d'erreur via
  `userMessageOf` au lieu de `error.message` (AGENTS.md §10). Le cache dédoublonnait déjà
  le paiement par `id`, et le bouton est désactivé pendant l'envoi.
- Test de contrat (`tests/contract/client-payment-idempotence.contract.test.ts`, 7 cas)
  rejoué sans le correctif (`git stash`) : 5 rouges.

**Pourquoi**
- Le lost update fausse la comptabilité sans erreur visible : paiement présent dans
  l'historique, solde non baissé, relance du client à tort.
- Un `NaN` dans `balance` casse la facture et tous les agrégats qui la lisent (tableau de bord).
- Pour un paiement sans référence (espèces), seule la protection de plafond s'applique :
  deux paiements identiques sans référence restent deux paiements, car rien ne permet
  de distinguer un rejeu d'un second versement réel. Choix volontaire, plutôt qu'une
  fenêtre de temps heuristique qui fusionnerait de vrais paiements.
- Changement de comportement assumé : un trop-perçu est maintenant refusé (409) au lieu
  de rendre le solde négatif, comme côté fournisseur.
- Incident : LESSONS_LEARNED « Encaissement client : paiement perdu, trop-perçu et solde NaN ».

**Preuve**
- `npm run check` 0 erreur ; `npm test` 386/386 ; `npm run test:integration` 38/38 ;
  `npm run test:contract` 53/53 ; 0 ligne `TEST-` orpheline.
- Plus aucune route de paiement sans protection : `billing.routes.ts` (encaissement),
  `supplier-invoices.routes.ts` (règlement, rapprochement, legacy `/payment`). T7 passe à « Fait ».

