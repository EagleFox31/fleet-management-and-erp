## T8 : pagination, filtres et recherche des listes principales

**Quoi**
- `tests/contract/lists-pagination-filters.contract.test.ts` (55 cas, 17 `it.fails`) : véhicules, ordres de travail, pièces, fournisseurs. Pages de 2 sans doublon ni trou avec total cohérent, tri explicite ascendant puis descendant, filtres statut / priorité / `isActive` / catégorie, véhicule supprimé exclu, liste vide, bornes (`limit` et `offset` non numériques, négatifs, démesurés), apostrophe littérale, injection classique, ordres de travail d'un client limités à ses véhicules.

**Comment**
- Lignes créées par le test et repérées par un jeton unique dans le champ cherché ; nettoyage par id en `afterAll` (`finally`), ordres de travail supprimés avant les véhicules. Les `it.fails` ne contiennent que l'appel visé et l'assertion métier, la mise en place est en `beforeAll`.
- Missions (`GET /api/missions`) et documents (liste par véhicule) n'ont ni pagination ni filtre côté serveur : rien à tester au contrat.

**Pourquoi**
- Défauts constatés, non corrigés ici :
  - `%` et `_` agissent comme jokers dans le `ILIKE` (véhicules `storage.ts:753`, ordres de travail `storage.ts:1333`, pièces `parts-service.ts:27`, fournisseurs `supplier-management-service.ts:36` et `:42`).
  - Véhicules : `offset` négatif ou `limit` démesuré font échouer le SQL, `getVehicles` avale l'erreur (`storage.ts:844`) et la route répond 200 `{ vehicles: [], total: 0 }` (`routes.ts:963`).
  - Pièces : `offset` négatif ou `limit` démesuré répondent 500 (`routes.ts:2604`, page non bornée) ; un octet nul dans la recherche répond 500, comme sur les fournisseurs.
  - Fournisseurs : `isActive=maybe` est lu comme `false` (`suppliers.routes.ts:173`).
  - `GET /api/vehicles` ne filtre pas sur `ownerScopeOf` : un client voit les véhicules des autres (`routes.ts:958`, AGENTS.md §11).
  - Observé sans test figé : véhicules, `limit` non numérique ou négatif renvoie tous les véhicules, sans plafond.

**Preuve**
- Contrat 55/55 (17 `it.fails`) ; les 17 rejoués en `it` : 17 rouges, 38 verts. Hygiène `it-fails-hygiene` 7/7, liste gelée inchangée. `tsc --noEmit` global : 0 erreur ; fichier de test vérifié par un tsconfig temporaire : 0 erreur.


