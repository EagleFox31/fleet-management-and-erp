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
  - **M1, immatriculation** : `/api/vehicles/check/:reg` renvoie `retired` au personnel, pour qui une immatriculation retirée reste réservée. Un client reçoit `exists: false`, comme pour une plaque inconnue (réserve R1 de #484).
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
- **Limites assumées** :
  - le refus client porte sur le détail et le contrôle d'immatriculation seulement, pour l'instant. Les sous-ressources d'un véhicule retiré (documents, kilométrage, historique de statut, pneus) répondent encore 200 à son client propriétaire : elles vivent dans `server/routes.ts`, gelé, et seront filtrées à leur extraction vers `server/api` ;
  - `maintenance_schedules` n'a pas d'horodatage. Un plan désactivé à la main pendant le retrait est réactivé par la restauration ;
  - M3 : `updated_at` bouge sur toute écriture du renouvellement, pas seulement sur un changement de statut. Un renouvellement rejeté par la suppression puis simplement commenté pendant le retrait reste rejeté à la restauration. Le choix va dans le sens prudent : rouvrir à tort un dossier qu'un humain a touché serait pire que de le laisser rejeté.
- **Preuve automatisée** :
  - `tests/contract/vehicle-retired-access.contract.test.ts` : 10 cas (détail personnel et client, PATCH 409, champs de retrait ignorés, `check` : `retired` pour le personnel et `exists: false` pour le client, témoins actifs) ;
  - `tests/contract/vehicle-lifecycle.contract.test.ts` : cloison client sur 2 acteurs, plus le cas M3. Mutant « horodatage ignoré » : 1 rouge ;
  - contrats véhicule et route-id : 35 fichiers, 495 tests verts ; unitaires verts ; `npm run check` sans erreur.
- **RAIDER** :
  - R : refus et lecture dans un module pur ; horodatage déclaratif par table ;
  - D : réponses inchangées pour un véhicule actif ; le 403 client garde le même message ;
  - I : DDL `IF NOT EXISTS` ;
  - R (rétroactif) : effets journalisés avant M3 (`applied_stamp` NULL) restaurés comme avant, sur la valeur seule ;
  - non applicable : pas de trame temps réel, aucune transition nouvelle.

## 2026-11-05T18:16:34+01:00 — Réserves de relecture #484 (R1 à R4)

- **Agent** : c7 · **Branche** : `c7-vehicle-lifecycle-followups`
- **Quoi** :
  - R1 : `check/:reg` passe par `vehicleReadableBy` ; un client sur son véhicule retiré reçoit `exists: false`.
  - R2 : sous-ressources client inscrites en limite assumée ci-dessus, sans toucher `routes.ts`.
  - R3 : test unitaire du schéma, recherche indentée rétablie pour les colonnes du `CREATE TABLE`, recherche ciblée de l'`ALTER` pour `applied_stamp`.
  - R4 : effet de l'horodatage sur toute écriture documenté en limite.
- **Pourquoi** : cohérence avec le détail (« un client ne le voit plus ») ; un client ne crée pas de véhicule, la réservation de l'immatriculation ne vaut que pour le personnel.

## 2026-11-05T18:37:41+01:00 — Sous-ressources d'un véhicule retiré : extraction de routes.ts et cloison client

- **Agent** : c7 · **Branche** : `c7-vehicle-subresources`
- **Statut** : fait, en relecture. Lève la première limite assumée de l'entrée « Suivi de #476 ».
- **Quoi** :
  - 6 lectures sont extraites de `server/routes.ts` vers `server/api/vehicle-subresources.routes.ts` : documents, documents par type, kilométrage, historique kilométrique, historique de statut, pneus.
  - Elles sont supprimées de `routes.ts` (130 lignes en moins, rien d'ajouté).
  - Un client ne lit ces 6 routes que sur son véhicule, et plus du tout une fois le véhicule retiré. Les autres lectures rattachées au véhicule ne sont pas encore toutes cloisonnées : voir la limite de l'entrée L1 ci-dessous.
  - La réponse est 403 avec le même message que pour un tiers : le retrait ne se devine pas.
  - Le personnel lit tout, véhicule retiré compris.
- **Comment** :
  - décision pure `canReadVehicleSubresources` (`server/lib/vehicle-retired.ts`), qui ne lit le véhicule que pour un client ;
  - garde qui lève `assertVehicleSubresourcesReadable` dans le routeur ;
  - `tests/support/route-guard-scan.ts` la reconnaît comme cloison, comme `assertWorkOrderReadable` (garde qui lève, valable en instruction seule) ;
  - montage sur `/vehicles` après `vehicleLifecycleRoutes`. Chaque chemin a deux segments, donc `/check/:reg` et `/documents/all` ne sont pas masqués (témoins au contrat).
- **Contrat de réponse** : corps 200 inchangés. Les 400 et 403 passent par `AppError` : même `message`, plus `code` et `requestId`. Les 500 suivent le gestionnaire central.
- **Pourquoi** : réserve R2 de la relecture de #484 ; `routes.ts` est gelé, d'où l'extraction plutôt qu'un filtre en place.
- **Preuve automatisée** :
  - `tests/contract/vehicle-subresources-client-scope.contract.test.ts` : 9 cas (6 routes × propriétaire actif, propriétaire retiré, tiers, personnel, anonyme ; id et type invalides ; témoins `/check/:reg` et `/documents/all`) ;
  - mutants « garde du retrait retirée » et « garde tiers retirée » : 6 rouges chacun ;
  - `tests/unit/server/vehicle-subresources-guard.test.ts`, plus un cas du scan dans `routes-hygiene` ;
  - unitaires 2919 verts, contrats liés (véhicule, cloison, gardes, route-id, pneus, kilométrage) 45 fichiers / 670 verts, `npm run check` sans erreur.
- **RAIDER** :
  - R : décision pure réutilisable, garde unique pour les 6 routes ;
  - D : réponses 200 inchangées, routes voisines prouvées intactes ;
  - E : `routes.ts` allégé, erreurs par `AppError`, logs par le gestionnaire central ;
  - non applicable : pas de schéma, pas de temps réel, pas d'écriture.

## 2026-11-05T18:50:35+01:00 — Audit sécurité #490 : réserves levées

- **Quoi** :
  - Scan de cloison : une garde qui lève (`assertWorkOrderReadable`, `assertVehicleSubresourcesReadable`) ne compte que si elle est attendue (`await` ou `return`). Une promesse flottante rejette après l'envoi de la donnée.
  - `/api/vehicles/check/<mot>` : le routeur renvoie `/check/*` au contrôle d'immatriculation (`next("router")`). Avant ce renvoi, `/check/documents` ou `/check/tires` répondaient 400.
  - Historique kilométrique : `limit` ramené dans [1, 500]. Une valeur négative donnait un 500, une valeur énorme lisait tout l'historique.
- **Preuve automatisée** :
  - `routes-hygiene` : « sans await ne vaut pas contrôle », sur les deux gardes ;
  - contrat : `/check/{documents,tires,mileage,status-history}` en 200, `limit` -5, 0 et 999999 en 200 ;
  - `prefix-middleware-guardrail` : le renvoi `/check` est inscrit, de type sans base.
- **Leçon** : une garde async reconnue par son nom doit être exigée attendue. Le test le vérifie désormais.

## 2026-11-05T19:20:11+01:00 — Plans de maintenance : restauration fidèle par updated_at (L2)

- **Quoi** :
  - `maintenance_schedules.updated_at` est ajoutée sans défaut, puis `SET DEFAULT now()` : les plans existants restent à NULL, aucune ligne n'est réécrite ;
  - déclencheur `trg_maintenance_schedules_touch` (BEFORE UPDATE) : tout écrivain renouvelle l'horodatage ;
  - `stampColumn: "updated_at"` dans `VEHICLE_DEACTIVATIONS` : un plan désactivé à la main pendant le retrait n'est plus réactivé par la restauration (la limite assumée disparaît) ;
  - SQL dans `VEHICLE_LIFECYCLE_SQL` et sa jumelle `20261105_vehicle_lifecycle.sql`, avec deux blocs DO bornés.
- **Idempotence** :
  - colonne posée sous garde `information_schema` ;
  - `CREATE OR REPLACE TRIGGER` (garde-fou `init-database-concurrency`), seulement s'il est absent de `pg_trigger`, au lieu d'un DROP/CREATE à chaque démarrage : une base convergée ne reprend aucun verrou de table. Seule la fonction `fn_maintenance_schedules_touch` est redéfinie à chaque démarrage (`CREATE OR REPLACE FUNCTION`, écriture de catalogue, ni ligne ni verrou de table), comme les autres fonctions de l'init ;
  - déclencheur posé seulement si la colonne existe : sinon, tout UPDATE de plan échouerait.
- **Preuve automatisée** :
  - `vehicle-lifecycle.contract` :
    - « plan désactivé à la main pendant le retrait » : reste désactivé ;
    - « SQL rejoué deux fois » : plan antérieur toujours à NULL, un seul déclencheur ;
  - mutants :
    - `stampColumn` retiré : 1 rouge ;
    - corps du déclencheur vidé : 1 rouge ;
  - `vehicle-lifecycle-schema` (unitaire) : jumeaux identiques, 5 blocs DO, pas d'`ADD COLUMN ... DEFAULT`, pas d'`UPDATE`, pas de `DROP TRIGGER`.
- **Near miss (mutant)** : un premier mutant du déclencheur avait survécu, pour deux raisons :
  - l'écriture Drizzle du test renouvelait déjà `updated_at` ;
  - la migration jumelle, rejouée au démarrage, restaurait la fonction.
  - Correctif : le cas écrit en SQL brut, et le mutant porte sur les deux jumeaux.
  - Leçon : un mutant de SQL d'init doit viser l'init et sa migration jumelle, sinon le rejeu des migrations le neutralise.
- **Régression rattrapée par la CI (19:33)** :
  - `PATCH /api/maintenance-schedules/:id` répondait 500 sur la fiche entière renvoyée par le formulaire : `updatedAt` revenait en chaîne et Drizzle attend une date (`value.toISOString is not a function`).
  - Cause : la nouvelle colonne apparaît dans les lectures, donc dans le corps renvoyé tel quel. La route n'ignorait que `id` et `createdAt`.
  - Correctif : `updatedAt` est ignoré comme `createdAt` (ligne modifiée en place dans `routes.ts`, aucune ajoutée). Le déclencheur reste seul à poser l'horodatage.
  - Preuve : `secondary-routes-validation.contract` envoie un `updatedAt` périmé en chaîne ; le PATCH répond 200 et l'horodatage est renouvelé.
  - Leçon : seuls les contrats « liés » avaient tourné en local. Une colonne ajoutée à une table modifiable par fiche entière impose la suite de contrats complète avant de livrer, pas un filtre.
- **Dérogation `server/storage.ts`** : une ligne ajoutée (`updatedAt: maintenanceSchedules.updatedAt` dans la sélection des plans avec véhicule). Elle est imposée par le type `MaintenanceScheduleWithVehicle`, dérivé de la table : sans elle, `npm run check` échoue. Aucune méthode nouvelle, aucun bouchon touché.
- **Réserves de relecture de #497 (R1 à R4)** :
  - le WARNING du bloc `updated_at` décrit l'effet réel d'un verrou indisponible : lecture et écriture des plans, suppression douce et restauration en échec jusqu'au démarrage suivant ;
  - la phrase « une base convergée n'écrit rien » est nuancée (fonction redéfinie à chaque démarrage) ;
  - la leçon des mutants jumeaux est reportée dans `docs/analysis/LESSONS_LEARNED.md`.
## 2026-11-05T18:57:43+01:00 — Pleins d'un véhicule : même cloison que les sous-ressources (L1, suite de #490)

- **Quoi** :
  - `GET /api/fuel-records/vehicle/:vehicleId` sort de `server/routes.ts` vers `server/api/fuel-records.routes.ts` ;
  - la garde `assertVehicleSubresourcesReadable` passe dans `server/lib/vehicle-subresource-guard.ts`, partagée par les deux routeurs ;
  - un client propriétaire d'un véhicule retiré reçoit 403 (`canAccessOwned` seul le laissait lire) ;
  - un client tiers reçoit 403, avec le même message.
- **Contrat de réponse** : corps 200 inchangé (`pricePerLiter`, `totalCost`). Les 400 et 403 passent par `AppError`.
- **Pourquoi** : les pleins sont une lecture rattachée au véhicule, comme les documents ou les pneus. Le retrait doit y valoir aussi.
- **Preuve automatisée** :
  - `tests/contract/fuel-records-vehicle-client-scope.contract.test.ts`, 8 cas :
    - propriétaire actif et retiré, tiers, personnel sur le retiré, anonyme, id illisible ;
    - témoins `/api/fuel-records`, `/statistics`, `/consumption-history` ;
  - mutant « garde retirée » : 2 rouges au contrat, 1 rouge dans `routes-hygiene` ;
  - contrats liés (`vehicle-subresources`, `vehicle-reads-client-scope`, `fuel-card-routes`) verts.
- **Limite connue** : les pleins d'un véhicule retiré restent lisibles par son client propriétaire par le filtre de requête, `GET /api/fuel-records?vehicleId=` et `GET /api/fuel-records/consumption-history?vehicleId=`. Cette route en chemin ne ferme donc pas l'accès à elle seule ; les deux routes par requête relèvent de L1b.
- **Hors périmètre** : les autres lectures en `canAccessOwned` + `getVehicleOwnerId` ont été recensées pour l'orchestrateur. Elles ne sont pas élargies sans son accord.

## 2026-11-05T20:25:21+01:00 — Lectures rattachées au véhicule : filtres, historique, fichiers (L1b)

- **Quoi** :
  - Ces routes sortent de `server/routes.ts` (gelé) avec la garde `assertVehicleSubresourcesReadable` :
    - `GET /api/work-orders/vehicle/:vehicleId` et `GET /api/maintenance-schedules/vehicle/:vehicleId`, vers `server/api/vehicle-history.routes.ts` ;
    - `GET /api/fuel-records` et `GET /api/fuel-records/consumption-history`, vers `server/api/fuel-records.routes.ts`, avec la garde quand `?vehicleId=` est présent.
  - B5 : `GET /api/documents/:id/download` répond 403 au client propriétaire si le véhicule est retiré.
  - B7 : la preuve d'une demande de renouvellement ajoute la condition « véhicule non retiré » à `canAccessOwned`. Ce contrôle est sans effet aujourd'hui, puisque `VIEW_ROLES` refuse le client avant. Aucun contrat ne peut donc le distinguer pour un client.
  - B6 : `/api/fuel-records/statistics` excluait déjà les véhicules retirés de l'agrégat client, car `getVehiclesByOwner` filtre `deleted_at`. Un cas de contrat le fige désormais.
  - C : `assertWorkOrderReadable` est inchangé, le détail d'un OT reste lisible.
- **Contrat de réponse** : les corps 200 sont inchangés. Une période inconnue de l'historique retombe sur le mois. Les 400 et 403 passent par `AppError`.
- **Pourquoi** : c'est le near miss de L1. La route en chemin était fermée, mais le filtre de requête restait ouvert. Voir `docs/analysis/LESSONS_LEARNED.md`.
- **Correction de mon hypothèse précédente** : `/api/work-orders/vehicle/:id` n'était pas masquée par `/:id`. Le contrat l'a montré : elle répondait 200 au propriétaire sur le véhicule retiré.
- **Preuve automatisée** :
  - `tests/contract/vehicle-history-retired-scope.contract.test.ts`, écrit d'abord. Il échouait avec 6 rouges sur le code d'origine. Il couvre :
    - par lecture : propriétaire actif et retiré, tiers, personnel sur le retiré, anonyme, id illisible ;
    - le balayage « toutes les entrées d'un plein » : chemin, filtre, liste, statistiques, historique, et les périodes `constructor`, `__proto__`, etc. ;
    - B5.
  - Mutants « garde retirée » : les 6 sont détectés.

    | Mutant | Rouges |
    |---|---|
    | OT | 1 |
    | Plans | 1 |
    | Filtre des pleins | 2 |
    | Filtre de l'historique | 2 |
    | Téléchargement | 1 |
    | Cloison de la liste sans filtre | 1 |

  - `routes-hygiene` : 30/30. La liste gelée n'a pas été modifiée.
- **Audit sécurité** : rien de bloquant.
  - Mineur corrigé : `?period=constructor` répondait 500, parce qu'une clé héritée d'`Object.prototype` était lue. Les périodes passent désormais par une `Map`.
  - Hors périmètre : quatre listes restent ouvertes au propriétaire d'un véhicule retiré. Elles sont détaillées dans la leçon et proposées en L1c.
