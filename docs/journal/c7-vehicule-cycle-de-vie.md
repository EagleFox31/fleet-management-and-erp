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

## 2026-11-05T17:49:58+01:00 — Journal de suppression : auteur en ON DELETE SET NULL (feaa632e)

- **Agent** : c7 · **Branche** : `c7-vehicle-soft-delete` · **Commit** : feaa632e
- **Statut** : fait
- **Quoi** : `vehicle_deletion_effects.created_by` passe en `ON DELETE SET NULL` ; le `CREATE TABLE` sort de `QHSE_INSPECTIONS_SQL`.
- **Pourquoi** :
  - `tests/integration/cleanup-users-fk-coverage.test.ts` refuse toute nouvelle clé vers `users` en NO ACTION non traitée par le nettoyage (CI 42063355295 rouge, 37 contre 36) ;
  - supprimer un utilisateur ne doit pas être bloqué par le journal d'un retrait de véhicule qu'il a fait ;
  - le SQL QHSE doit rester identique à sa migration jumelle.
- **Preuve** : CI 42064192865 verte, 8 jobs sur 8.

## 2026-11-05T17:49:58+01:00 — Réserves de relecture #476 : auteur du retrait, repli d'archive, verrous, DDL borné

- **Agent** : c7 · **Branche** : `c7-vehicle-soft-delete` · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** :
  - `vehicles.deleted_by` (FK `users`, `ON DELETE SET NULL`) : renseigné par la suppression douce, remis à NULL par la restauration, omis du schéma d'insertion (le client ne l'écrit pas).
  - Restauration d'un id absent de `vehicles` :
    - si la table `vehicle_archived` existe (`to_regclass`), la fiche archivée est restaurée **sous son identifiant d'origine** ;
    - colonnes absentes de l'archive : valeurs par défaut de `vehicles` ; statut `operational` ; archive vidée ;
    - immatriculation déjà reprise : 409 ;
    - table absente ou fiche absente : 404 (comportement actuel).
  - Contrôle des OT et missions ouverts : **toutes** les lignes du véhicule sont verrouillées (`FOR UPDATE`), ouvertes ou non (OT, affectations, opérations de remorque, missions).
  - DDL (`vehicle_deletion_effects`, `vehicles.deleted_by`) : `VEHICLE_LIFECYCLE_SQL` dans `init-database.ts`, jumelle de `server/db/migrations/20261105_vehicle_lifecycle.sql`. Verrou consultatif des migrations, `lock_timeout` 5 s, `lock_not_available` → WARNING.
- **Pourquoi** : réserves 1, 2, 4, 6 et 7 de la relecture de #476.
- **Limites assumées** :
  - mission `delivered` non comptée ouverte : le camion est libéré, la facturation lit l'historique (réserve 3, acceptée) ;
  - un OT ou une mission rouvert **après** la suppression passe : le verrou sérialise le contrôle, mais les écrivains ne relisent pas `deleted_at` ;
  - restauration à valeur égale (réserve 5) : un élément remis à la main, pendant le retrait, dans la valeur que la suppression avait posée (renouvellement rejeté, plan désactivé) est rouvert par la restauration. Le suivi M3 le distingue par `updated_at` pour les renouvellements ; `maintenance_schedules` n'a pas d'horodatage.
- **Preuve automatisée** :
  - `tests/unit/server/vehicle-lifecycle-schema.test.ts` : init-database = migration, DDL bornés et en WARNING, colonnes du schéma créées, `deletedBy` hors schéma d'insertion ;
  - `tests/contract/vehicle-lifecycle.contract.test.ts` : 13 cas, dont `deletedBy` posé puis effacé et le repli `vehicle_archived` (fiche absente 404, conflit 409, restauration sous l'id d'origine puis appel idempotent) ;
  - contrats véhicule et route-id : 34 fichiers, 484 tests verts ; unitaires 2885 verts ; `npm run check` sans erreur.
- **RAIDER** :
  - I : DDL `IF NOT EXISTS`, un second démarrage n'écrit rien ;
  - D : réponses 404 inchangées sans archive ;
  - R (rétroactif) : véhicules déjà retirés intacts (`deleted_by` NULL) ;
  - E : DDL borné, aucun blocage du démarrage.

## 2026-11-05T18:06:54+01:00 — Suivi de #476 : véhicule retiré en lecture, en écriture et à l'import (M1, M2, M3)

- **Agent** : c7 · **Branche** : `c7-vehicle-lifecycle-followups` · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** :
  - **M1, détail** `GET /api/vehicles/:id` (id ou immatriculation) :
    - le personnel lit un véhicule retiré, avec `deletedAt` renseigné ;
    - un client reçoit 403, même message qu'un véhicule absent, même s'il en est propriétaire.
  - **M1, modification** `PATCH /api/vehicles/:id` sur un véhicule retiré : 409 « Véhicule retiré : le restaurer avant de le modifier. ». `deletedAt` et `deletedBy` du corps sont ignorés : retrait et restauration passent uniquement par DELETE et `/restore`.
  - **M1, immatriculation** : `/api/vehicles/check/:reg` renvoie `retired`. Une immatriculation retirée reste réservée.
  - **M1, import** : une ligne visant un véhicule retiré est refusée avec un message lisible.
    - Une écriture refusée par le serveur compte désormais en erreur, avec le message du serveur.
    - Avant, l'import comptait un succès sans lire la réponse.
  - **M2** : un client, propriétaire ou tiers, ne retire ni ne restaure un véhicule. Il reçoit 403, rien ne change et aucune trame n'est diffusée.
  - **M3** : la suppression horodate chaque renouvellement qu'elle rejette (`updated_at`, copié dans `vehicle_deletion_effects.applied_stamp`).
    - La restauration ne rouvre que les renouvellements dont l'horodatage n'a pas bougé.
    - Un rejet confirmé à la main pendant le retrait reste donc rejeté.
- **Comment** :
  - `server/lib/vehicle-retired.ts` (`vehicleReadableBy`, `vehicleEditRefusal`, `isRetiredVehicle`), appelé depuis `server/routes.ts`. C'est le seul ajout dans ce fichier gelé.
  - La route n'est pas extraite vers `server/api` : `/:id` y masquerait toute route littérale `/api/vehicles/<mot>` de `routes.ts`, puisqu'un `:id` accepte aussi une immatriculation.
  - Le filtre n'est pas dans `storage.getVehicle` : la cloison des OT d'un client (`work-order-scope.ts`) et les contrôles de doublon d'immatriculation doivent voir les véhicules retirés.
  - M3 : `stampColumn` déclaratif dans `VEHICLE_DEACTIVATIONS`. Comparaison faite en SQL : la microseconde de Postgres ne survit pas à un aller-retour JS. Colonne `applied_stamp` dans `VEHICLE_LIFECYCLE_SQL` et sa jumelle.
- **Pourquoi** :
  - suivi M1 à M3 de la relecture sécurité de #476 ;
  - décision de 0a : personnel en 200 avec `deletedAt`, client en 403.
- **Limite assumée** : `maintenance_schedules` n'a pas d'horodatage. Un plan désactivé à la main pendant le retrait est réactivé par la restauration.
- **Preuve automatisée** :
  - `tests/contract/vehicle-retired-access.contract.test.ts` : 8 cas (détail personnel et client, PATCH 409, champs de retrait ignorés, `check` avec `retired`, témoins actifs) ;
  - `tests/contract/vehicle-lifecycle.contract.test.ts` : cloison client sur 2 acteurs, plus le cas M3. Mutant « horodatage ignoré » : 1 rouge ;
  - contrats véhicule et route-id : 35 fichiers, 495 tests verts ; unitaires verts ; `npm run check` sans erreur.
- **RAIDER** :
  - R : refus et lecture dans un module pur ; horodatage déclaratif par table ;
  - D : réponses inchangées pour un véhicule actif ; le 403 client garde le même message ;
  - I : DDL `IF NOT EXISTS` ;
  - R (rétroactif) : effets journalisés avant M3 (`applied_stamp` NULL) restaurés comme avant, sur la valeur seule ;
  - non applicable : pas de trame temps réel, aucune transition nouvelle.
