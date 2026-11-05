# Journal — c7, cycle de vie du véhicule (retrait, remise en service)

Entrées ajoutées en bas, une par commit (règles : `docs/journal/README.md`).

## 2026-11-05T17:16:44+01:00 — Suppression d'un véhicule : physique sans action, douce sinon

- **Agent** : c7 · **Branche** : `c7-vehicle-soft-delete` · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** :
  - `DELETE /api/vehicles/:id` supprime physiquement un véhicule qui n'a **aucune action** enregistrée.
  - Dès qu'il en a une (OT, plein, document, plan de maintenance, mission, pneu, incident, QHSE, traite, changement de statut...), la suppression est **douce** (`deletedAt`) et aucune donnée saisie n'est perdue.
  - Tant qu'un OT ou une mission reste ouvert : **409**, avec la liste (`openWorkOrders`, `openMissions`).
  - La suppression douce désactive les plans de maintenance actifs et rejette les renouvellements de documents ouverts. Les pneus restent montés (décision du 5 novembre).
  - `POST /api/vehicles/:id/restore` remet le véhicule dans la flotte et ne réactive que ce que la suppression a désactivé, si la valeur n'a pas bougé depuis.
- **Comment** :
  - Le critère d'action est une liste explicite : `server/services/vehicle-lifecycle-sources.ts`. Il remplace l'ancien repli implicite sur l'erreur de clé étrangère 23503.
  - Chaque désactivation est journalisée ligne par ligne dans `vehicle_deletion_effects` (valeur précédente, valeur posée). La restauration rejoue ce journal puis le vide.
  - Le tout tient dans une transaction, avec le véhicule verrouillé (`FOR UPDATE`).
  - Les deux routes quittent `server/routes.ts` pour `server/api/vehicle-lifecycle.routes.ts`. Les handlers d'origine sont retirés, pas masqués.
  - Les trois couches :
    - client : `invalidateVehicleLifecycleQueries` ;
    - temps réel : `vehicle_deleted` et `vehicle_restored`, réservés au personnel ;
    - satellites : véhicules, opérations, documents, missions.
- **Pourquoi** :
  - Des clés étrangères `ON DELETE CASCADE` (documents, renouvellements, historique de statut) faisaient que la suppression physique effaçait en silence des documents saisis.
  - L'ancienne restauration appelait une table `vehicle_archived` qui n'existe dans aucune migration.
  - Le garde a aussi trouvé une référence non classée : `payment_instruments.vehicle_id` (traites).
- **Comment tester** : en admin,
  1. supprimer un véhicule neuf : il disparaît ;
  2. supprimer un véhicule avec un document : il disparaît des listes mais reste en base ;
  3. sur un véhicule avec un OT en cours : message demandant de clôturer l'OT.
- **Preuve automatisée** :
  - `tests/unit/server/vehicle-activity-sources.test.ts` : toute clé étrangère vers `vehicles.id` (Drizzle, init-database, migrations SQL) doit être classée ;
  - `tests/contract/vehicle-lifecycle.contract.test.ts` : 10 cas ;
  - contrats VEH2, vehicles-crud et route-id-strict inchangés et verts ;
  - mutant (garde de restauration retirée) : 1 rouge.
- **RAIDER** :
  - R : critère et désactivations déclaratifs, un ajout = une ligne ;
  - I : second DELETE → 404, restauration d'un véhicule actif → `restored: false` sans écriture, journal `ON CONFLICT DO NOTHING` ;
  - D : réponses 400 / 403 / 404 et libellés conservés ;
  - failure memory : le garde FK rend l'oubli impossible ;
  - E : `AppError`, `moduleLogger`, transaction ;
  - R (rétroactif) : véhicules déjà retirés inchangés, aucune ligne existante réécrite ;
  - non applicable : pas d'écran de restauration côté client (aucun n'existait).
