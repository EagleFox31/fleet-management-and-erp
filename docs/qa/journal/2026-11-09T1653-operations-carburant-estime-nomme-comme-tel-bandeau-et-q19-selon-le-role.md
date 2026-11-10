## Opérations : carburant estimé nommé comme tel, bandeau sans faux CA, Q19 masqué selon le rôle

Remplace l'entrée du 2026-11-09 16:27 écrite dans l'ancien fichier unique (non fusionnée).

**Quoi** :
- serveur : `/api/operations/stats/by-client` et `/stats/by-destination` servent l'alias exact
  `estimatedFuelCost` (somme des carburants estimés). `totalRevenue`, `margin`,
  `marginPercentage` restent servis une version, dépréciés. Masqué hors lecteurs du budget (Q19).
  Le carburant réel (`actualFuelCost` des missions) est servi sous `totalFuelCost` : nom exact à
  fixer au lot T3 ;
- bandeau des opérations : le « CA » (carburant estimé) et la marge (toujours 100 %) sont
  retirés. Tuiles « Carburant estimé (missions) » et « Carburant réel (missions) » lues par
  `clientTotals` (somme de `estimatedFuelCost`) et `statDisplay` : « Indisponible » en échec,
  jamais 0 ; encart `kpi-unavailable` avec relance ;
- Q19 à l'affichage : la tuile du bandeau et la ligne « Carburant estimé » de l'onglet Clients
  sont masquées selon le rôle (`canReadMissionBudget(user?.role)`), plus selon la présence de la
  donnée (une liste vide aurait montré « 0 F » à un non-lecteur) ;
- secrétariat : le carburant estimé par client est lu sous `estimatedFuelCost`, plus sous
  l'alias déprécié ;
- onglet Destinations réécrit sur la liste servie ; onglet Clients via `listQueryView`.

**Comment** :
- `tests/unit/client/operations-fuel-estimate-guard.test.ts` (10 cas) : ni CA ni marge sur
  3 écrans, bandeau sans repli à zéro (3 tuiles par `statDisplay`), Q19 selon le rôle (bandeau,
  clients-panel) ;
- `tests/unit/client/secretary-dashboard-error-states.test.ts` : lecture de `estimatedFuelCost` ;
- `tests/unit/client/secretary-dashboard-stats.test.ts` : `clientTotals` ignore `totalRevenue`,
  null → null (Q19) ;
- `tests/unit/client/destinations-chart-render.test.ts` (6 cas, rendu) ;
- `tests/contract/operations-budget-scope.contract.test.ts` : alias null pour le technicien ;
- cliquet de palette : operations/dashboard 19 → 10, clients-panel 43 → 41.
- Rouge d'abord : les gardes Q19 et secrétariat échouent sur les fichiers d'avant (motifs absents
  ou alias déprécié lu), vertes après.

**Pourquoi** : décision du 2026-11-09, le carburant estimé n'est pas un chiffre d'affaires ; une
marge qui en est tirée donne une rentabilité fausse, un zéro pendant une panne passe pour une
vraie valeur, et un masquage sur la donnée laisse voir un chiffre à un rôle non autorisé.

**Preuve** : `npx tsc --noEmit -p .` 0 erreur ; `npx vitest run --project unit` sur les gardes,
le cliquet et `tests/unit/docs` : 38/38. Le vrai CA (factures HT) arrive par la PR #620.
