## 2026-11-09T16:18:17+01:00 — Secrétariat : une lecture en échec n'est plus un zéro ; le carburant estimé n'est plus présenté comme chiffre d'affaires

- **Statut** : fait (PR brouillon #611)
- **Quoi** :
  - les 7 lectures du tableau de bord secrétaire (véhicules, documents, CPC, chauffeurs, statistiques par client, factures, alertes) passent par `queryView` / `listQueryView`. En échec, chaque tuile affiche « Indisponible », jamais 0 ;
  - un total n'est jamais partiel : il vaut null si un terme est inconnu (`clientTotals`, `documentRenewals`, `client/src/lib/secretary-dashboard-stats.ts`) ;
  - la tuile « Coûts » lisait `totalCost`, que `/api/operations/stats/by-client` ne sert pas : elle affichait toujours 0 F. Elle lit maintenant `totalFuelCost` ;
  - **décision 0a du 2026-11-09** : `totalRevenue` de `stats/by-client` est la somme des carburants estimés des missions, pas un chiffre d'affaires. La tuile « Chiffre d'affaires » devient « Coût carburant estimé (missions) ». Par client, les colonnes deviennent « Carburant estimé » et « Carburant réel ». La marge, tirée de ce faux CA, est retirée ;
  - le `data-testid` `secretary-kpi-missions` était porté par deux tuiles (Vue d'ensemble et Opérations) : la seconde devient `secretary-ops-kpi-missions`.
- **Comment tester (QA)** :
  - `tests/unit/client/secretary-dashboard-error-states.test.ts` (garde de source, 13 cas) :
    - aucun libellé « Chiffre d'affaires », « CA », « Marge », « Bénéfice », ni lecture de `marginPercentage` ou `profit` : rouge sur 67b67730, vert sur la branche ;
    - plus jamais `totalCost` ;
    - chaque tuile chiffrée passe par `statDisplay` ;
    - chaque `data-testid` est unique : rouge sur eda0942b (`secretary-kpi-missions` en double), vert après ;
  - `tests/unit/client/secretary-dashboard-stats.test.ts` (14 cas) : totaux null dès qu'un terme manque, chaînes décimales acceptées, `revenue` n'est plus une clé ;
  - `no-tailwind-palette-in-ui.test.ts` : cliquet du tableau de bord secrétaire abaissé de 47 à 46 ;
  - campagnes : tsc 0, check:tests 0, unitaires verts (hors `db-pool-options`, échec local connu). Aucun fichier serveur modifié.
- **Pourquoi** : un 0 affiché pendant une panne ou pour un champ jamais servi est lu comme un vrai chiffre. Présenter le carburant estimé comme chiffre d'affaires et en tirer une marge donnait une rentabilité fausse.
- **RAIDER** : R : helpers de vue partagés avec #607 ; D : routes et contrats d'API inchangés, un seul `data-testid` renommé (aucun consommateur e2e). Ne s'appliquent pas : A, I, Retroactive (client seul, lecture seule).
- **Reste / risques** : le vrai chiffre d'affaires (factures HT, hors annulées, par période) arrive avec le lot « CA réel » ; `operations/clients-panel` et `destinations-chart` traités dans la PR T2 (`c7-ops-fuel-estimate`), qui ajoute l'alias serveur `estimatedFuelCost`.

