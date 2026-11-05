# Portée des diffusions temps réel resserrée aux rôles de lecture (lot A1)

## Quoi
Les trames des factures fournisseur, des commandes fournisseur et de la carte carburant partent aux rôles de lecture des écrans correspondants, plus à tous les profils connectés.

## Comment
- Factures : `INVOICE_READ_ROLES`. Commandes : `PROCUREMENT_ROLES`. Carte carburant : `STAFF_ROLES` (route `GET /balance` inchangée).
- `KNOWN_BROADCASTS` (tests/unit/server/broadcast-hygiene.test.ts) décrémenté de trois entrées.
- Contrat `tests/contract/money-realtime-scope.contract.test.ts` : une écriture réelle par famille, portée résolue comme `realtime-scope.ts`, destinataires comparés rôle par rôle.

## Pourquoi
Un événement n'a pas à atteindre un profil qui ne lit pas la ressource. Mutation vue rouge : remettre un broadcast sur la carte carburant fait échouer le contrat.
