# Journal api-3

Agent API 3, worktree `fm-api-3`, branche `lot/api/R-03b-cloison-suite` (suite de la PR #53).

## 2026-10-31T21:35:00+01:00 — R-03b cloison suite
- **Agent** : api-3 · **Branche** : `lot/api/R-03b-cloison-suite` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : fin des fuites de donnees personnelles de chauffeur (WebSocket, jointure mission) et fermeture des routes vehicule de `routes.ts` aux autres clients ; garde chauffeur sur toute route `/missions/:id`.
- **Comment** : `server/lib/driver-realtime.ts` (charge = id seul) ; `router.param("id")` et `staffOnly` dans `missions.routes.ts` ; `redactDriverPersonalData` sur `GET /missions/:id` ; `isDriverManager` sur `update-cpc` et `sync-cpc-statuses` ; routeur de cloison `vehicles-client-scope.routes.ts` etendu (monte avant `registerRoutes`, personnel via `next()`) ; repli `/me` limite aux fiches libres et non ambigues ; 400 sur id invalide et sur filtre hors enum ; `error.message` et `console.*` migres en `AppError` / `moduleLogger`. Build : Adapt.
- **Pourquoi** : audit securite de #53, recette client du 2 novembre.
- **Comment tester (QA)** :
  - Prerequis : un compte chauffeur A, une mission d'un chauffeur B, un client A.
  - Etapes : 1. Chauffeur A ouvre `/api/missions/<B>` et ses sous-routes. 2. Client A ouvre `/api/vehicles/<autre>/mileage`.
  - Attendu : 403 ; permis non visible pour l'atelier sur la mission.
  - Preuve automatisee : unitaire `driver-realtime.test.ts`, contrat `fleet-read-scope.contract.test.ts`.
- **RAIDER** : couvert non-regressif (personnel inchange), idempotence du lien `/me`, moindre privilege ; sans objet : migration.
- **Reste / risques** : PATCH et POST mission refuses au chauffeur (ecart de role a valider) ; client refuse sur `check-alerts`, `mileage/sync`, `/fuel-records` sans `vehicleId`, `statistics`, `consumption-history` ; `routes.ts:6192`, rapports et preuves de renouvellement non revus ; `getAllVehicleTires` filtre en TypeScript (tache fleet-db possible : vue/requete filtree par proprietaire).

## 2026-11-01T12:40:00+01:00 — R-03b réserves de relecture
- **Agent** : api-3 · **Branche** : `lot/api/R-03b-cloison-suite` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : statistique carburant servie au client sur SES véhicules (agrégat SQL `fuelStatisticsForOwner`), au lieu du 403 qui mettait le KPI « litres du mois » à 0 ; édition et budget mission masqués au chauffeur avec la même liste que le serveur (`canWriteMission`, `shared/constants/roles.ts`) ; `console.error` de `missions.routes.ts` migrés en `moduleLogger`.
- **Comment tester (QA)** : client A ouvre son tableau de bord : litres du mois = ses seuls véhicules ; chauffeur ouvre une mission : pas de bouton Modifier.
- **Dette notée** : `GET /api/vehicles/check-alerts` (routes.ts:4174) est masquée par `/api/vehicles/:id` (routes.ts:1026) et répond 404 au personnel. Le contrat fige ce comportement (200 ou 404, jamais 403) ; à corriger quand routes.ts sera dégelé.
