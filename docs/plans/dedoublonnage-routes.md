# Plan : suppression des routes dupliquées de `server/routes.ts`

Statut : exécuté le 3 novembre 2026 (branche `chore/routes-dedup`). Source : AGENTS.md §9, liste gelée `tests/unit/server/routes-hygiene.test.ts` (6 doublons, 8 déclarations mortes), désormais vide.
Numéros de ligne : ceux de la base `8c35d1b` (avant suppression). Après suppression, voir la table du commit `d196739`.

## Règle

Express sert la **première** déclaration. On supprime la seconde (code mort), sauf pour `/api/warehouse/*` :
`server/api/index.ts:104` monte `warehouse.routes.ts` avant `registerRoutes` (`server/app.ts:109`), donc les
deux déclarations de `routes.ts` sont mortes.

## Qui sert, qui est mort

| Route | Sert | Mort |
|---|---|---|
| `GET /api/maintenance-schedules` | `routes.ts:1576` (cloison client via `getVehiclesByOwner`) | `:1692` (filtres `vehicleId`/`active`, aucune cloison) |
| `GET /api/statistics/fleet-history` | `:4420` (`vehicleStatusService`, défaut `week`) | `:4540` (`fleetStatisticsService`, défaut `month`) |
| `GET /api/warehouse/top-consumed-parts` | `warehouse.routes.ts:172` | `routes.ts:406` et `:3264` (ont divergé) |
| `GET /api/warehouse/stock-value-history` | `warehouse.routes.ts:187` | `routes.ts:421` et `:3286` |
| `GET /api/parts/:id/usage-history` | `:3098` (`partsService.getUsageHistory`) | `:3145` (`storage.getPartUsageHistory`) |
| `POST /api/check-all-maintenance` | `:4995` (km + dates + réconciliation) | `:5329` (dates seules, forme `totalWorkOrdersGenerated`) |

## Ordre, du moins risqué au plus risqué

1. warehouse x2 (4 blocs, aucun effet attendu).
2. `parts/:id/usage-history` et `fleet-history` (lectures pures).
3. `check-all-maintenance` (écrit des OT, mais la déclaration servie reste intacte).
4. `maintenance-schedules` (la plus consommée côté client, cloison client en jeu).

## Preuve par suppression

- Mettre à jour `KNOWN_DUPLICATE_ROUTES` (égalité stricte : le test échoue si on oublie).
- Test de contrat qui fige le comportement actuel **avant** de supprimer (statut, forme JSON, défaut `period=week`,
  rôle `isWorkshopManager` pour check-all). Existant : `maintenance-schedules.contract.test.ts:158-167` (cloison client).
  Absent : `fleet-history`, `usage-history`, `check-all-maintenance`.
- `npm run check`, `npm test`, `npm run test:contract` sur tout le projet.

## Pièges

- Ne pas supprimer la mauvaise déclaration : relire le numéro de ligne après chaque suppression.
- Retirer les imports devenus inutiles (`maintenanceSchedules`, `fleetStatisticsService`).
- Vérifier que `fleetStatisticsService.getFleetStatusHistory` n'est pas appelé ailleurs avant de l'orpheliner.
- `write-routes-frozen.ts:81` ne liste que `post /api/maintenance-schedules` : non impacté.
- Branche `fix/ws-role-from-db` (autre session, PR à venir) : `tests/unit/server/session-role-guard.test.ts` gèle
  `routes.ts` et `api/warehouse.routes.ts` comme exceptions (`req.session?.role` lu comme étiquette d'acteur) et
  échoue si une exception n'est plus utilisée. Si une suppression retire la dernière lecture `session?.role`
  d'un de ces fichiers, retirer aussi son entrée de `FROZEN_EXCEPTIONS`.

## Coordination (2 novembre 2026)

Sessions `-b7`, `-c7`, `-de` : pas dans leur plan. `-b7` fusionne #100 (FUEL3), qui modifie `server/routes.ts`
(imports l.23-39, blocs ~l.1193-1222 et ~l.3395-3516) : relire les numéros de ligne après cette fusion.

## Répartition proposée

`fleet-testeur` (tests de contrat d'abord) puis `fleet-api` (suppressions), relecture `fleet-relecteur`.
