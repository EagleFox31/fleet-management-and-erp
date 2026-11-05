# Portée des diffusions temps réel resserrée aux rôles de lecture (lot A1)

## Quoi
Les trames des factures fournisseur, des commandes fournisseur et de la carte carburant partent aux rôles de lecture des écrans correspondants, plus à tous les profils connectés.

## Comment
- Factures : `INVOICE_READ_ROLES`. Commandes : `PROCUREMENT_ROLES`. Carte carburant : `STAFF_ROLES` (route `GET /balance` inchangée).
- `KNOWN_BROADCASTS` (tests/unit/server/broadcast-hygiene.test.ts) décrémenté de trois entrées.
- Contrat `tests/contract/money-realtime-scope.contract.test.ts` : une écriture réelle par famille, portée résolue comme `realtime-scope.ts`, destinataires comparés rôle par rôle.

## Pourquoi
Un événement n'a pas à atteindre un profil qui ne lit pas la ressource. Mutation vue rouge : remettre un broadcast sur la carte carburant fait échouer le contrat.

## Suite (relecture sécurité)

- La direction reçoit une trame réduite aux identifiants pour les événements de facture fournisseur (son tableau de bord en dépend) ; la facture et le règlement restent réservés aux rôles de lecture.
- Le contrat résout les destinataires avec le résolveur réel (`normalizeScope`, `resolveRecipients`).
- Les listes de rôles des factures et commandes dérivent de `PROCUREMENT_ROLES`.
