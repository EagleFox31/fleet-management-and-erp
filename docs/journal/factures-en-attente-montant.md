# Factures en attente : montant par client

- `GET /api/billing/pending-invoices` renvoyait `amount` à 0 pour tous les clients alors que les missions portent `agreed_price`.
- Règle (révisable) : `amount` = somme des `agreed_price` des missions facturables du client (terminées ou livrées, sans facture non annulée). Un prix à 0 est un prix. Une mission sans prix (NULL) n'est jamais valorisée à 0 en silence : elle est comptée dans `missionsWithoutPrice`.
- Écran : le montant s'affiche avec la mention « N sans prix » ; « À chiffrer » seulement si aucune opération du client n'a de prix.
- Lecture seule, rôles et drapeau inchangés.
- Tests : `tests/contract/pending-invoices-content.contract.test.ts` (somme, NULL, zéro explicite, facture annulée réintégrée, facture active exclue), intégration et unitaire client alignés. Cinq mutations vues rouges (montant forcé à 0, NULL non compté, drapeau absent, filtre de facture annulée retiré, zéro compté sans prix).
