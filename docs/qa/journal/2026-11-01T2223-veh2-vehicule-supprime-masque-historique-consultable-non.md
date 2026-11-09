## VEH2 - véhicule supprimé : masqué, historique consultable, non assignable

**Quoi**
- Contrat `vehicle-soft-delete` (9 cas) : un véhicule supprimé (`deletedAt`) est masqué de la liste et de la
  recherche, ses OT et missions passés restent consultables ; `DELETE /api/vehicles/:id` refusé aux non-admin
  (403), id invalide 400, inconnu 404, véhicule sans historique supprimé et masqué.
- Témoin : un véhicule actif avec un chauffeur formé s'assigne à une mission (201).

**Pourquoi**
- Le plan donnait VEH2 « À faire ». La colonne `vehicles.deletedAt` existe et les listes la filtrent, mais
  aucune route ne la pose : la suppression est physique.

**Preuve**
- Trois défauts en `it.fails`, chacun rejoué en `it` pour vérifier le rouge (cf. PR) :
  1. `DELETE` d'un véhicule portant un OT : 500 (clé étrangère `work_orders_vehicle_id_vehicles_id_fk`),
     au lieu de 200 avec `deletedAt` posé (server/routes.ts:1222, vehicle-deletion-service-trigger.ts:43).
  2. `POST /api/work-orders` sur un véhicule supprimé : 201 (server/routes.ts:2130 ne contrôle que l'existence).
  3. `POST /api/missions` avec un véhicule supprimé : 201 (server/api/missions.routes.ts:1736 sans filtre `deletedAt`).
- Relecture : les `it.fails` ne contiennent plus que l'appel visé et l'assertion métier ; la mise en place
  (véhicule supprimé, OT historique) est dans un `beforeAll` : une erreur de préparation fait échouer le hook
  au lieu de rendre le cas vert. Rouge rejoué sans `.fails`, erreurs exactes : `expected 201 to be 400`
  (mission), `expected 201 to be greater than or equal to 400` (OT), `expected 500 to be 200` (DELETE).
  Contrat 9/9 verts.
- Garde-fou d'hygiène (`it-fails-hygiene`) : le DELETE de la route est joué dans le `beforeAll` (il
  faisait deux requêtes dans le `it.fails`), le cas assert son statut puis la lecture de l'OT. Rouge rejoué :
  `expected 500 to be 200`. Hygiène 7/7.
- `tsc` 0 erreur, unitaire 838/838, contrat 9/9 cas verts.

**Limites**
- `GET /api/vehicles/:id` renvoie encore un véhicule supprimé (`storage.getVehicle`, server/storage.ts:699) : non figé.

**Reste**
- Correctif produit (fleet-api / fleet-db) : suppression logique, puis passer les trois `it.fails` en `it`.

