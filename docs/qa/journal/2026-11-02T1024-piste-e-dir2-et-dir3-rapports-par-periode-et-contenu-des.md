## Piste E : DIR2 et DIR3, rapports par période et contenu des exports

**Quoi**
- `tests/contract/reports-inventory-period.contract.test.ts` (5 cas + 3 `it.fails`) : fenêtre mai 2019, mouvements avant, aux deux bornes et 1 ms après ; sortie comptée en valeur absolue ; statistiques cohérentes avec les lignes ; fenêtre vide ; début après fin ; 401.
- `tests/contract/reports-technician-period.contract.test.ts` (5 cas + 3 `it.fails`) : fenêtre juin 2019, deux techniciens créés, OT aux bornes et hors fenêtre ; totaux, taux arrondi, totaux globaux, fenêtre vide (taux 0), fenêtre étroite.
- `tests/contract/exports-inventory-content.contract.test.ts` (4 cas) : cellules exactes de l'export inventaire (alerte OUI/NON, valeur = stock réel x prix, N/A) et ligne TOTAL.
- `tests/contract/exports-invoices-content.contract.test.ts` (6 cas) : factures fournisseurs (paiements = TTC - solde, IMPAYÉ/PAYÉ, date fr-FR) et clients (échéance, filtre par client sans fuite d'un autre client, nom inconnu, nom trop long en 400).
- Plan : DIR2 fait en C, DIR3 élargi.

**Comment**
- Branche Neon `tests-piste-c`, sous `db-lock`. Données au jeton `TEST-`, fenêtres de dates propres (2019) pour que les totaux ne dépendent pas des autres suites, nettoyage en `afterAll` (mouvements, OT, pièces, comptes). Les `it.fails` ne contiennent que l'appel visé.

**Pourquoi**
- DIR2 ne couvrait que le carburant ; DIR3 notait « contenu des autres exports non vérifié ».

**Preuve**
- Vert : 26/26 (4 fichiers). Rouge par mutation temporaire, puis restaurée : `<=` en `<` sur la borne haute du rapport inventaire (`server/routes.ts`), borne haute des OT décalée de 1 ms (`reports-service.ts`), valeur du stock calculée sur `quantity` au lieu de `realStock` et Paiements = solde (`excel-export-service.ts`) : les 4 fichiers passent au rouge. Après restauration, `git diff server` vide, vert de nouveau (second passage).
- Défauts (it.fails, correctif à fleet-api) : `server/routes.ts:2840` et `:2894` `authenticate` seul, client et chauffeur lisent stock, prix, charge des techniciens alors que l'écran les masque (`reports/index.tsx:524`) ; `server/routes.ts:2842` date invalide : 200 vide ; `:2896` : date invalide, pas de 400.
- Observation, sans test : l'export inventaire valorise au stock réel, le rapport inventaire à la quantité théorique : deux valeurs du stock pour une même pièce.

