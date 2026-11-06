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

## 2026-11-05T20:47:49+01:00 — Listes et agrégats rattachés au véhicule : véhicule retiré exclu pour le client (L1c)

- **Quoi** : un client ne voit plus son véhicule retiré dans les listes et les agrégats. Le détail et les sous-ressources le cachaient déjà. Le personnel le voit toujours.
  - `/api/vehicles/all-with-status`, `expired-docs`, `expiring-docs` et `document-stats`, via `vehicle-documentation-service`.
  - `/api/vehicles/documents/all` : la réponse au client ne porte plus `filePath`. Le client télécharge par `/api/documents/:id/download`.
  - `/api/vehicle-tires`.
- **Comment** :
  - un seul prédicat, `server/lib/client-vehicle-scope.ts` : `ownedLiveVehicles(ownerId)` pour les services qui reçoivent déjà `ownerScopeOf`, `clientVehicleScope(req.user)` pour les routes ;
  - personnel : aucun filtre ; client : `owner_id` et `deleted_at IS NULL` ; sans session : 401 par `ownerScopeOf`.
- **Exception documentée** (AGENTS.md §11, décision 0a) : la liste des OT garde les OT d'un véhicule retiré, même règle que le détail. Un commentaire dans `storage.getWorkOrdersByOwner` le rappelle.
- **B7** : la garde véhicule de `/api/document-renewals/requests/:id/proof` est inerte, car `client` n'appartient pas à `DOCUMENT_RENEWAL_VIEWER_ROLES`. Le commentaire le dit. Le contrat vérifie que le client reçoit 403 et que le rôle n'est pas lecteur : il échoue si la liste s'ouvre, et il faudra alors écrire le contrat de cette garde.
- **Pourquoi** : ce sont les quatre listes que l'audit de L1b a laissées hors périmètre. La règle est la même partout : liste, détail et sous-ressource.
- **Preuve automatisée** :
  - `tests/contract/retired-vehicle-lists-client-scope.contract.test.ts` (17 tests). Il prend trois véhicules : actif et retiré du propriétaire, actif d'un autre client. Il couvre :
    - le balayage de 12 listes ouvertes au client, `check-alerts` compris : jamais le retiré, jamais le véhicule tiers, toujours l'actif quand il est semé ;
    - les agrégats exacts : `document-stats`, `statistics/fleet`, `statistics/maintenance-compliance` ;
    - `filePath` : absent pour le client, présent pour le personnel ;
    - le personnel, qui voit toujours le retiré ;
    - l'exception OT ;
    - B7.
  - Mutants : les 6 sont détectés.

    | Mutant | Rouges |
    |---|---|
    | `isNull` retiré du prédicat | 6 |
    | Service documentation sans le prédicat | 4 |
    | `documents/all` sans le prédicat | 1 |
    | `filePath` laissé au client | 1 |
    | `vehicle-tires` sans le prédicat | 1 |
    | `check-alerts` sans `deleted_at` | 1 |

  - `npm run check` : 0 erreur.
  - Contrats voisins (véhicules, documents, pneus, pleins, cloisons) : 64 fichiers, 884 tests verts. Unitaires : 2 984 verts.
- **Audit sécurité** : OK, rien de bloquant. Mineurs traités :
  - `check-alerts` et les deux statistiques étaient déjà filtrés, mais aucun test ne le figeait : ils sont ajoutés au contrat ;
  - la note B7 dit maintenant qu'il faudra aussi cloisonner `GET /requests` et `/centers` avant d'ouvrir le rôle au client.
  - Hors périmètre, dette existante : dans `GET /api/vehicle-tires` (`routes.ts`), le service avale ses erreurs. Pas joignable sans session, puisque `isAnyUser` passe avant.

## 2026-11-05T22:46:00+01:00 — Écritures rattachées à un véhicule retiré : refus 409 (L3)

- **Quoi** : sur un véhicule retiré, le personnel reçoit un 409 (`VEHICLE_RETIRED_EDIT_MESSAGE`) pour toute écriture rattachée : OT, plans d'entretien, pleins et bons carburant, kilométrage, documents, renouvellements, pneus, pièces, demandes de pièce, QHSE.
  - Décision 0a, option A, révisable et ajoutée aux questions client : pour une saisie tardive, on restaure le véhicule, on saisit, puis on le retire à nouveau.
  - Le démontage de pneu reste ouvert, par décision.
  - Un client ou un anonyme n'est pas concerné : la route répond elle-même 403 ou 401, comme avant.
- **Comment** :
  - Table déclarative `RETIRED_VEHICLE_WRITE_ROUTES` (`server/lib/retired-vehicle-write-routes.ts`, 44 entrées). Pour chaque route, elle dit où lire le véhicule : corps, paramètre, ou recherche par OT, plein, pneu, document, renouvellement, pièce ou demande.
  - Garde `retiredVehicleWriteGuard` (`server/middleware/retired-vehicle-write-guard.ts`). C'est un `Router` Express qui déclare chaque entrée avec sa méthode et son chemin. Elle est montée dans `server/api/index.ts` avant `registerRoutes`, donc elle couvre aussi `routes.ts` sans y ajouter de ligne.
  - Corps multipart (`quick-renew`) : la garde ne voit pas le véhicule, alors la poignée appelle `assertVehicleWritable` après le parsing.
  - `asVehicleRef` lit l'id au moins aussi largement que la route (`z.coerce.number`, `Number()`) et le borne à `MAX_DB_INTEGER_ID`.
- **Pourquoi** : L1 et L2 cachent le véhicule retiré aux lecteurs. Rien n'empêchait encore d'y rattacher de nouvelles écritures, qui faussaient l'historique et les agrégats d'un véhicule sorti du parc.
- **Preuve automatisée** :
  - `tests/contract/vehicle-retired-writes.contract.test.ts` (30 tests) :
    - 22 écritures refusées en 409, dont `quick-renew` en multipart ;
    - les rôles chef d'atelier et technicien ;
    - les contournements : casse du chemin, `%xx`, `" N"`, `[N]`, `"N.0"`, `+N` urlencodé ;
    - aucune ligne créée ou modifiée ;
    - contrôles : véhicule actif non bloqué, client 403, anonyme 401, id hors bornes jamais en 500, démontage de pneu ouvert.
  - `tests/unit/server/retired-vehicle-writes-hygiene.test.ts` :
    - balaie toutes les routes d'écriture de `routes.ts` et des routeurs de `server/api/`, poignées nommées comprises (`scanWriteRoutes`, `tests/support/route-guard-scan.ts`) ;
    - toute route qui nomme un véhicule doit être dans la table, appeler `assertVehicleWritable`, ou figurer dans la liste gelée `NOT_GUARDED` (8 entrées motivées). Cette liste est un cliquet : elle ne peut que rétrécir ;
    - la taille de la table est figée (`TABLE_FLOOR`) : retirer une entrée exige une revue.
  - `prefix-middleware-guardrail` : la garde est inscrite avec sa raison.
  - Mutants : les 14 sont détectés.

    | Mutant | Rouges |
    |---|---|
    | Client non exempté | 1 |
    | Recherche par OT vide | 6 |
    | Corps ignoré | 11 |
    | Paramètre ignoré | 17 |
    | Refus jamais levé | 25 |
    | `quick-renew` sans contrôle | 1 |
    | `asVehicleRef` strict (ancien) | 1 |
    | Borne entière retirée (contrat) | 1 |
    | Borne entière retirée (unitaire) | 1 |
    | Bon carburant hors table | 1 |
    | Plein supprimé lu | 1 |
    | Id zéro accepté | 1 |
    | `assertVehicleWritable` ignoré par l'hygiène | 1 |
    | Route retirée de la table | 1 |

    Les deux derniers mutants survivaient tant que le plancher valait 43, en `>=`, alors que la table comptait 44 entrées. Le plancher est maintenant égal à la taille de la table. Contrôle fait : hygiène verte sans mutant, rouge avec.
- **Audit sécurité** : premier verdict « OK sous réserve », réserves levées.
  - Bloquants, corrigés :
    - la garde utilisait une regex sensible à la casse, et ne décodait pas `%xx`, alors qu'Express fait les deux. Elle utilise maintenant le même moteur de correspondance que le routeur ;
    - les ids que Zod ou `Number()` convertissent (`" 7"`, `[7]`, `"7.0"`, `"+7"`, urlencodé) passaient la garde et atteignaient la route.
  - Mineurs, corrigés :
    - borne entière : un id au-delà de l'entier Postgres faisait un 500 en 22003, cas `qhse-inspections` ;
    - `POST /api/fuel-vouchers/:id/validate` n'était pas gardée ;
    - le balayage d'hygiène ne voyait pas les poignées nommées ;
    - champs du corps de `PATCH /api/part-requirements/:id`.
  - Acceptés :
    - un membre du personnel sans droit sur la route reçoit 409 au lieu de 403. Il n'apprend que l'état retiré, déjà visible pour le personnel ;
    - une session d'utilisateur désactivé reçoit 409 : négligeable ;
    - le rejeu idempotent d'un 409 n'a pas d'effet.
- **Leçon (near miss)** : une garde montée en amont doit utiliser le même moteur de correspondance que le routeur, et lire les ids au moins aussi largement que la route. Sinon, chaque écart d'analyse devient un contournement. Cette leçon est figée par les cas de contournement du contrat et par le test d'accord `asVehicleRef` / `z.coerce`.
- **CI rouge au premier passage** : `api-auth-guard` recense les routes de la pile Express et descend dans tout routeur imbriqué. Les 44 couches de la garde y apparaissaient comme des routes `/api` sans session. Ce sont des couches de passage, qui ne répondent pas. Le `Router` est désormais enveloppé dans une fonction : correspondance inchangée, recensement juste. Cause : la sélection locale des contrats « voisins » partait des domaines touchés et a manqué les contrats transversaux. Prévention : pour un middleware monté en préfixe, lancer toute la suite de contrats, pas une sélection.
- **Limites connues** :
  - une route qui n'atteint le véhicule que par `workOrderId`, ou qui passe le corps entier à Zod sans nommer le véhicule, échappe au marqueur d'hygiène. Le plancher de la table compense en partie ;
  - les sous-routeurs montés dans un routeur ne sont pas balayés.

## 2026-11-05T23:48:10+01:00 — L3 : le refus « véhicule retiré » n'est plus mis en cache par l'idempotence (réserve de relecture)

- **Quoi** :
  - le 409 de la garde L3 porte le code `VEHICLE_RETIRED` (`shared/errors.ts`) ;
  - la garde d'idempotence libère la clé sur ce code (`PRE_WRITE_REFUSAL_CODES`, `isPreWriteRefusal`) au lieu de mémoriser la réponse.
- **Pourquoi** :
  - `isReplayableStatus` mettait en cache tout statut de 200 à 499, sauf 401, 403, 408 et 429 ;
  - `PUT /vehicles/:id/mileage` est à la fois idempotent et dans la table L3 ;
  - après restauration du véhicule, le rejeu avec la même clé renvoyait donc le 409 gardé en cache, et la saisie ne passait jamais.
- **Comment** :
  - `errorHandler` fait maintenant suivre le `code` d'une `AppError`. Avant, il le perdait : la sortie recalculait `CONFLICT` à partir du statut. Les deux `AppError` qui passaient déjà un code (`RATE_LIMITED` en 429, `CONFLICT` en 409) avaient le code par défaut de leur statut, donc l'existant ne change pas ;
  - la garde de sortie accepte le code, qui figure dans `STATUS_MESSAGES` ;
  - côté client, `VEHICLE_RETIRED` est traité comme un conflit.
- **Preuve** :
  - un contrat dans `vehicle-retired-writes` : retirer le véhicule, saisir le kilométrage avec une clé (409 `VEHICLE_RETIRED`), restaurer, rejouer la même clé. On obtient 200 sans en-tête de rejeu, le kilométrage est écrit, et un troisième envoi est bien rejoué ;
  - des tests unitaires dans `idempotency-guard.test` : un 409 `CONFLICT` reste rejouable, un corps nul n'est pas un refus.
- **Ordre des refus** : pour le personnel, le 409 de la garde passe avant le 403 de la route. Il n'y a pas de fuite : le personnel voit tous les véhicules (§11). Un anonyme ou un client ne passe pas par la garde (`!user || role === "client"`) : il reçoit le 401 ou le 403 de la route, sans rien apprendre de l'état du véhicule.
- **À surveiller** : `prefix-middleware-guardrail` met 3,9 s pour une limite de 5 s. Il risque de devenir instable sous charge.

## 2026-11-06T00:55:58+01:00 — L4 : écran admin « Véhicules retirés » et fiche en consultation seule

- **Quoi** :
  - écran `/admin/retired-vehicles` (admin seul, menu Administration) : liste `GET /api/vehicles/archived` en `PremiumDataTable`, date de retrait, bouton Restaurer avec confirmation ;
  - la ligne ouvre la fiche véhicule, qui passe en consultation seule quand `deletedAt` est posé : bandeau « Véhicule retiré de la flotte le … », badge Retiré, formulaire désactivé, aucun bouton d'écriture (plein, document, renouvellement, échéance, OT, montage pneu, suppression), bouton Restaurer pour l'admin.
- **Pourquoi** : l'API de retrait et de restauration existait sans écran ; un véhicule retiré n'était récupérable que par appel direct.
- **Comment** :
  - `useRestoreVehicle` (`client/src/hooks/useVehicles.ts`) applique les 3 couches : retrait de la ligne du cache local, trame `vehicle_restored` émise par le serveur, `invalidateVehicleLifecycleQueries` (catalogue, fiche, satellites : statistiques flotte, KPI, tableau de bord) ;
  - envoi par `useSingleFlightMutate`, messages par `userMessageOf` ;
  - `/api/vehicles/archived` ajouté aux `invalidates` de `vehicle_deleted` et `vehicle_restored` : un autre admin voit la liste bouger. La clé est écrite en littéral dans l'écran, forme que relève `realtime-invalidation-keys.test.ts`.
- **Preuve** :
  - contrat `vehicle-lifecycle` : la liste suit retrait puis restauration, technicien 403 ;
  - e2e `29-retired-vehicles` (admin seul, le temps réel inter-profils est couvert par le contrat de la trame) : retirer, retrouver dans la liste, fiche en lecture seule, restaurer, ligne retirée, base à `deleted_at NULL`, fiche redevenue modifiable ;
  - `screen-route-roles` : route et menu réservés à l'admin.
- **Limites** : les onglets internes (OT, historique de statut) n'ont pas été audités bouton par bouton. Une écriture oubliée y reçoit le 409 `VEHICLE_RETIRED` de la garde L3, avec un message lisible.
## 2026-11-06T01:16:55+01:00 — prefix-middleware-guardrail sous la limite (suite du « À surveiller » de L3)

- **Quoi** : le recensement des montages de `server/` est fait une fois par fichier de test au lieu de cinq.
- **Pourquoi** : 3,8 s de tests pour une limite de 5 s. Cinq cas relançaient `scanFiles` (analyse TypeScript de chaque fichier serveur), à environ 700 ms par passe.
- **Comment** : `occurrences()` mémoïse le balayage et rend une copie à chaque appel, pour qu'aucun cas ne modifie le résultat d'un autre. Aucune règle ni limite changée.
- **Preuve** : deux mesures locales. Tests du fichier : 3,84 s, puis 1,46 s et 1,58 s. Le cas le plus long, qui porte le balayage, passe à 1,3 s ; avant, chacun des cinq cas prenait de 650 à 850 ms. 30 cas verts.

## 2026-11-06T01:56:00+01:00 — L3b : écritures atteintes par un OT, routeurs hors balayage

- **Quoi** :
  - `POST /api/warehouse/stock-movement` entre dans `RETIRED_VEHICLE_WRITE_ROUTES` (lookup `workOrder` sur `body.workOrderId`). Un mouvement imputé à l'OT d'un véhicule retiré recevait jusqu'ici un 201 et déplaçait du stock ; sans `workOrderId`, le mouvement magasin passe toujours ;
  - le garde-fou `retired-vehicle-writes-hygiene` détecte aussi `workOrderId` / `work_order_id` dans la poignée et les chemins d'objets d'OT (`/work-orders/:p`, `/work-order-items/:p`, `/parts-used/:p`, `/part-requirements/:p`). C'était le seul trou du cas (a) : toutes les autres écritures d'OT étaient déjà dans la table ;
  - cas (b) : aucun sous-routeur monté en cascade aujourd'hui. Deux tests l'empêchent d'apparaître sans être vu : aucun montage de routeur hors `server/api/index.ts` et `server/app.ts`, aucune écriture de `server/api/` hors d'un routeur monté. Les deux routes déclarées directement sur `apiRouter` (connexion) entrent dans le balayage.
- **Pourquoi** : la garde L3 ne voyait que les écritures qui nomment le véhicule. Une écriture qui l'atteint par un OT ou qui vit dans un routeur non monté par `index.ts` échappait au marqueur sans qu'aucun test ne le signale.
- **Comment** : `scanWriteRoutes` garde sa forme et sa sortie. Elle s'appuie sur `walkWriteRoutes`, qui rend aussi les écritures non atteintes (`scanUnreachedWriteRoutes`). `scanNestedRouterMounts` et le motif `ROUTER_MOUNT` sont exportés depuis `tests/support/route-guard-scan.ts`. `TABLE_FLOOR` passe à 45.
- **Preuve** :
  - le contrat `vehicle-retired-work-order-writes` rend 409 `VEHICLE_RETIRED` sans écriture sur `POST /work-orders/:id/parts` et sur `stock-movement`, plus deux variantes de chemin (barre finale, casse). L'empreinte contrôlée couvre les demandes, les pièces posées, les mouvements et la quantité. Des témoins sur OT actif et sans OT sont acceptés ;
  - mutant n° 1, l'entrée `stock-movement` retirée de la table : le garde-fou échoue (route non couverte, plancher) et le contrat aussi (deux 409 attendus) ;
  - mutant n° 2, un fichier `server/api` qui monte un sous-routeur et déclare une écriture non montée : les deux nouveaux tests échouent.
- **Leçon** : un garde-fou par balayage doit tester son propre périmètre, c'est-à-dire ce qu'il ne lit pas, et pas seulement les routes qu'il lit. Sinon un montage hors du chemin balayé le rend aveugle sans qu'aucun test ne passe au rouge.
- **Réserve sécurité, décision 0a (2026-11-06)** :
  - `PATCH /api/purchase-orders/:id/status` (livraison) fait passer à reçue les demandes rattachées à l'OT d'un véhicule retiré et crédite le stock. 0a la laisse passer : la marchandise arrive de toute façon, et la refuser fausserait le stock. Elle est dans `NOT_GUARDED` avec cette raison.
  - Le garde-fou voit désormais cette route. Il cherche `partRequirementId` dans la poignée et les appels `.updateOrderStatus(` (`WORK_ORDER_SERVICE_CALL`), parce que la poignée délègue au service sans nommer la demande.
  - La vérification d'abord, l'écriture ensuite, hors transaction (TOCTOU) : c'est le modèle L3, et 0a l'accepte, puisqu'un retrait exige des OT clos.
## 2026-11-06T01:41:09+01:00 — Tests contrat signalés instables : finance-withholdings, qhse-inspections

**Quoi.** Deux fichiers ont été signalés rouges, uniquement dans la suite contrat complète :
- finance-withholdings, cas « admin » et « management : 200 au contrat » ;
- qhse-inspections, cas « applique les rôles, la cloison chauffeur et la validation de la grille ».

Seul le résumé a été remonté, pas le message d'erreur.

**Constat.** L'échec n'est pas reproduit en local sur Postgres Docker :
- suite contrat complète : 245 fichiers, 2963 tests verts ;
- les deux fichiers seuls : 34 tests verts.

**Pistes écartées, preuve dans le code :**
- *Cache des drapeaux de fonctionnalité* : `getFeatureFlags` relit `FEATURE_FLAGS` à chaque appel.
- *Plafond d'échecs par IP* : relevé à 100 000 par `setup-contract.ts`. Les deux fichiers qui l'abaissent le restaurent.
- *Horloge figée, espions, TZ, fetch global* : tous restaurés. Aucun `stubGlobal` ni remplacement de `fetch` dans les tests contrat.
- *CHECK `category` des critères QHSE selon l'ordre des fichiers* : `initializeDatabase()` tourne une seule fois par processus, dans `setup-contract.ts`, avant le premier fichier. La réconciliation des contraintes (#122) précède donc toujours qhse, quel que soit l'ordre.
- *Timeout pour qhse* : le describe porte un timeout de 180 s, et le cas dure 3,7 s.

**Piste ouverte.** Les cas « 200 au contrat » de finance-withholdings gardent le timeout par défaut de 5 s.

**Comment.** Les assertions qui échouaient affichent désormais le corps de la réponse :
- la connexion de qhse et la lecture de la grille cabine ;
- le statut 200 de finance-withholdings.

Le prochain échec dira lui-même s'il s'agit d'un 401, d'un 403, d'un 404 (drapeau), d'un 500 ou d'une grille vide.

**Pourquoi** `testTimeout` n'est pas relevé : rien ne prouve qu'un timeout soit en cause. Le relever masquerait une lenteur réelle sans la nommer.

**Leçon.** Un test signalé instable se remonte avec le texte de l'assertion, pas en résumé. Toute assertion de statut sur un appel HTTP porte le corps de la réponse en message (`expect(r.status, JSON.stringify(r.body))`), sinon l'échec intermittent reste indiagnosticable.

## 2026-11-06 — Bouchons createStubRouter dans le balayage de la garde véhicule retiré

- **Quoi** :
  - les écritures déclarées en données par `createStubRouter([...])` entrent dans `scanWriteRoutes`. Un bouchon d'écriture non monté apparaît dans `scanUnreachedWriteRoutes` ;
  - `POST /api/part-requirements/:id/receive` (bouchon 501) entre dans `RETIRED_VEHICLE_WRITE_ROUTES` (lookup `partRequirement`). `TABLE_FLOOR` passe à 46.
- **Pourquoi** : un bouchon n'utilise pas `router.post(`, donc le balayage ne le voyait pas. Il aurait été remplacé par sa vraie logique sans garde L3. Il est plus sûr de poser la garde maintenant : l'implémentation en hérite sans y penser.
- **Comment** : on lit les objets `{ method, path }` du fichier de bouchon, et on prend le préfixe du montage unique de ce fichier dans `index.ts`. La règle n'est pas propre à ce bouchon : tout bouchon d'écriture dont le chemin correspond à `WORK_ORDER_PATH`, ou qui nomme un marqueur de véhicule, tombe sous la règle générale (table ou `NOT_GUARDED`).
- **Preuve** :
  - le garde-fou balaie 7 bouchons d'écriture ;
  - mutant : l'entrée `receive` retirée de la table fait échouer la couverture et le plancher ;
  - le contrat rend 409 `VEHICLE_RETIRED` sur `receive` pour l'OT d'un véhicule retiré, sans écriture, avant le 501 du bouchon.
- **Effet de bord accepté** : pour le personnel, sur véhicule retiré, le 409 passe avant le 404 du drapeau `part-requirement-receive`. C'est le même ordre que celui de la garde face aux 403 (§11 : le personnel voit tous les véhicules).
- **CI rouge sur #542 (contract shard 2/4)** : l'`afterAll` du contrat L3b supprimait les OT avant les `parts_stock_movements` acceptés par les témoins (clé étrangère sans cascade).
  - En local, l'erreur était affichée, mais mon filtre de sortie (`Error:`, `×`) ne la retenait pas : l'erreur pg commence par `error:` en minuscules, et un échec d'`afterAll` ne marque aucun test en `×`. 8 OT de test sont restés dans la base locale. Ils sont purgés.
  - **Correctif** : supprimer les mouvements par OT et par pièce avant les OT.
  - **Prévention** : filtrer la sortie de vitest sur `Errors|Test Files|Tests ` (sans tenir compte de la casse), qui compte les erreurs de hooks, et vérifier les restes de test en base après le premier lancement.

## 2026-11-06 — Assertion de statut partagée : `expectStatus`

- **Quoi** :
  - `tests/support/expect-status.ts` : `expectStatus(response, attendu, libellé?)` vérifie le statut avec le corps de la réponse en message (tronqué à 2 000 caractères, sans jamais lever) et rend la réponse ;
  - les contrats `finance-withholdings` (7 assertions) et `qhse-inspections` (47) l'utilisent ;
  - la connexion de `startContractSession` porte aussi le corps.
- **Pourquoi** : ce sont les deux contrats signalés instables. Une assertion `expect(r.status).toBe(200)` qui échoue ne dit ni le code d'erreur ni le message, donc l'échec intermittent reste impossible à diagnostiquer (voir l'entrée sur le contrat instable).
- **Comment** : remplacement mécanique par expression régulière des formes `expect((await …).status).toBe(N)`, `expect(r.status).toBe(N)` et `expect(r.status, JSON.stringify(r.body)).toBe(N)`. L'unique assertion sur plusieurs lignes est faite à la main.
- **Preuve** :
  - test unitaire `tests/unit/support/expect-status.test.ts` : le message porte le corps et le libellé, le corps cyclique ou long est géré ;
  - les deux contrats sont verts (34 tests), avec le même nombre d'assertions.
- **Suite possible** : 138 autres contrats écrivent `JSON.stringify(r.body)` à la main, et d'autres n'ont pas de message. Un cliquet sur `expect(x.status).toBe(` sans message reste à décider.
## 2026-11-06 — Rapprochement de règlement : une facture en litige ne passe plus à `paid`

- **Quoi** : `reconcileInvoiceSettlement` refuse en 409 le rapprochement d'un règlement sur une facture `disputed` (« Cette facture est en litige. Lever le litige avant de rapprocher un règlement. »). Rien n'est écrit : le règlement reste `recorded`, la facture reste en litige.
- **Pourquoi** : `syncInvoiceFromReconciledSettlements` écrivait le statut par un `UPDATE ... WHERE id = ?` sans condition, et sans verrou. Le déclencheur `recalc_supplier_invoice_financials` conservait bien `disputed`, mais la synchro TypeScript l'écrasait juste après par `paid`. Un litige posé entre la lecture et l'écriture était perdu de la même façon.
- **Comment** :
  - une seule transaction : la facture est verrouillée (`FOR UPDATE`) avant le règlement, dans le même ordre que la saisie (`recordInvoiceSettlement`). Le rejet ne verrouille que le règlement, donc il n'y a pas de cycle de verrous ;
  - la synchro relit la facture dans la transaction, puisque le déclencheur l'a déjà recalculée. Elle écrit ensuite par compare-and-set sur le statut relu, avec `status <> 'disputed'`, et rend un 409 si aucune ligne n'est touchée ;
  - la clôture automatique de la commande passe après la validation de la transaction, comme avant.
- **Preuve** : `tests/contract/supplier-settlement-disputed.contract.test.ts` couvre quatre cas :
  - un témoin soldé ;
  - un litige posé avant le rapprochement ;
  - un rejeu après mise en litige ;
  - un litige posé pendant le rapprochement : une transaction tient le verrou, le rapprochement l'attend puis échoue sans écrire.
  
  Sur l'ancien code, les trois cas de litige échouent et le témoin passe. Les 12 fichiers de contrat `supplier-settlement*` et `supplier-invoice*` sont verts.
- **Leçon** : avant d'écrire un compare-and-set sur une table, chercher ses déclencheurs (`pg_trigger`). Un déclencheur qui récrit la ligne dans la même transaction rend fausse la valeur lue avant lui. Il faut relire après l'écriture qui le déclenche.

## 2026-11-06 — Relecture sécurité de #545 : cycle de verrous entre le rejet et le rapprochement

- **Quoi** : `rejectInvoiceSettlement` verrouille la facture (`FOR UPDATE`) avant l'`UPDATE` du règlement.
- **Pourquoi** : sans ce verrou, le rejet prenait le règlement, puis la facture par le déclencheur `trg_supplier_invoice_settlements_recalc`. Le rapprochement, lui, prend la facture puis le règlement. Un rejet et un rapprochement simultanés finissaient en interblocage (40P01, puis un 409 générique). L'entrée précédente affirmait que « le rejet ne verrouille que le règlement » : c'est faux, le déclencheur verrouille aussi la facture.
- **Comment** :
  - même ordre partout : la facture, puis le règlement ;
  - la synchro ne reprend plus le verrou et ne refait plus le contrôle du litige : l'appelant les fait. Le compare-and-set reste le filet ;
  - le cas « litige pendant » attend dans `pg_stat_activity` une session bloquée sur un verrou de `supplier_invoices`, au lieu d'une minuterie.
- **Preuve** :
  - le contrat « rejet et rapprochement simultanés » fait 5 essais, chacun attendant un 200, un 409 métier et un état final cohérent ;
  - mutant (le verrou du rejet retiré) : 3 essais sur 5 échouent, sur deux lancements.
- **Leçon** : l'ordre des verrous d'une transaction compte aussi les verrous pris par les déclencheurs. Avant d'affirmer qu'il n'y a pas de cycle, lire les déclencheurs de chaque table écrite, pas seulement le code TypeScript.

## 2026-11-06 — Cliquet : pas de montant dans les journaux

- **Quoi** : `tests/unit/server/log-amounts-hygiene.test.ts` balaie les appels `log.*` et `console.*` de `server/` (hors `_archive`). Il échoue sur tout appel dont les arguments portent une valeur monétaire : une clé ou une interpolation nommée prix, coût, montant, solde, TTC ou TVA, ou un `${…} FCFA` / `XAF`.
- **Comment** :
  - seul le code des arguments compte (le texte des chaînes est retiré, les `${…}` restent) : le mot dans le message (« fuel balance error ») n'est pas un montant ;
  - noms exclus : suffixes `Error`, `Changed`, `Id`, `Count`, `Mode`, `Rate`… ;
  - un segment camelCase entier est exigé : `notValidated` ne contient pas « TVA » (premier essai trop large, 3 faux positifs dans `init-database.ts`) ;
  - dix cas d'exemple fixent le comportement du détecteur.
- **Corrigés** (signalés par la relecture sécurité) : `part-requirements-service.ts` (2 `log.debug`) et `stock-alerts-service.ts` (1). Les logs sont conservés, sans montant ; ils journalisent les identifiants.
- **Gelés** : 14 appels dans 8 fichiers. Ce sont des paiements, recharges et consommations carburant, le prix convenu de mission, des statistiques en `console.log`. Le compte par fichier ne fait que baisser.
- **Pourquoi** : les journaux sont lus bien au-delà des rôles finance. L'identifiant de l'objet suffit à retrouver le montant en base.
- **Reste** : décider si les journaux d'audit métier (paiement enregistré, prix convenu modifié) gardent le montant. C'est à trancher par 0a ; d'ici là, ils sont gelés.
## 2026-11-06 — `feature-flags.contract` rouge en suite complète : fuite de `FEATURE_FLAGS` entre fichiers

- **Symptôme** : le test est vert seul et rouge en suite complète avec « expected 200 to be 501 ».
- **Reproduction** : lancer `id-range-query-body.contract.test.ts` puis `feature-flags.contract.test.ts` dans la même commande.
- **Cause racine, en deux défauts cumulés** :
  1. **Fuite d'environnement.** Onze fichiers de contrat fixent `process.env.FEATURE_FLAGS` au chargement du module, sans le rendre. C'est le cas de `id-range-query-body` (`incidents=on`), mais aussi de `treasury`, `tariff-grid`, `fuel-anomalies`, etc. Avec `isolate: false`, la valeur reste pour les fichiers suivants : l'ordre d'exécution décide alors de l'état des drapeaux.
  2. **Test périmé.** Le test lisait le drapeau effectif puis attendait 501 (« squelette ») si `incidents` était actif. La route est désormais implémentée : avec le drapeau actif, elle répond 200. Le test était vert seulement parce que le défaut est `off`.
- **Correctif** :
  - `tests/support/env-restore.ts` : `FILE_SCOPED_ENV`, `snapshotEnv`, `restoreEnv`. `setup-contract.ts` capture ces variables avant le premier fichier et les restaure dans son `afterAll`, donc à la fin de chaque fichier.
  - `feature-flags.contract` force `incidents=off` (dans un `try/finally`) et vérifie que le drapeau est à `false` puis que la route répond 404. La branche 501 est supprimée.
- **Preuve** :
  - la paire de reproduction est verte avec le correctif complet ;
  - elle est aussi verte avec la seule restauration du setup et le test d'origine : le setup est bien rejoué à chaque fichier ;
  - la suite complète de contrats est verte : 251 fichiers, 3 080 tests.
- **Prévention** : `tests/unit/support/env-restore.test.ts` échoue si un contrat affecte une variable d'environnement absente de `FILE_SCOPED_ENV`.
- **Leçon** : en `isolate: false`, l'état du processus (env, singletons) passe d'un fichier à l'autre. Une variable que les tests modifient doit être restaurée par le setup commun, pas laissée à la discipline de chaque fichier.

## 2026-11-06 — Clôture automatique de commande : verrou et CAS, plus de note perdue

- **Contexte** : `autoCloseDeliveredOrderIfFinanceDone` (`three-way-matching-service.ts`) passe la commande de `delivered` à `completed` quand toutes ses factures sont soldées. C'était la dernière écriture de statut de ce fichier sans condition sur l'état lu, gelée dans `status-update-cas-hygiene`.
- **Défaut** : la commande était lue hors transaction puis réécrite en entier (statut et notes) par un `UPDATE … WHERE id`. Deux factures soldées en même temps, ou une modification des notes pendant la clôture, donnaient deux transitions et des notes réécrites à partir d'une lecture périmée : la note ajoutée entre-temps était effacée.
- **Correctif** : une transaction qui verrouille la commande (`FOR NO KEY UPDATE`), relit sous ce verrou son statut, ses notes et les factures liées, puis écrit `WHERE id AND status = 'delivered'` avec `returning`. La seconde clôture devient un no-op : pas de deuxième trace, pas de log en double. `no key update` reste compatible avec le `key share` des contrôles de clé étrangère des factures. Aucun déclencheur sur `purchase_orders`. La clôture s'exécute après le commit du rapprochement et ne prend que ce verrou, donc pas de cycle possible. Le `console.log` de la clôture passe par `moduleLogger("three-way-matching")`.
- **Preuve** :
  - `tests/integration/purchase-order-auto-close.test.ts` : témoin, une facture non soldée, commande déjà clôturée ou annulée. Cas concurrent : le test tient le verrou de la commande, modifie ses notes, attend dans `pg_stat_activity` deux clôtures bloquées, puis relâche le verrou. Résultat attendu : une transition, une trace, la note conservée ;
  - mutant (code d'origine) : le cas concurrent échoue, la note ajoutée est perdue. Avant l'ajout de cette note, le test passait aussi sur le code d'origine, parce que l'écrasement par la seconde clôture laissait une seule trace ;
  - contrats liés (`purchase-order-three-way`, `supplier-settlement*`, `supplier-invoice*`) : 13 fichiers, 125 tests verts. Suite unitaire verte.
- **Prévention** : l'entrée gelée est retirée de `status-update-cas-hygiene` : toute nouvelle écriture de statut non conditionnée dans ce fichier fait échouer le test.
- **Leçon** : pour tester un CAS, compter les traces ne suffit pas, car un écrasement en laisse une seule lui aussi. Il faut un observable que seule la mise à jour perdue détruit, par exemple une écriture concurrente qui doit survivre.

## 2026-11-06 — Transition de statut d'OT dédiée, lot 1 (work-order-parts)

- **Quoi** : `transitionWorkOrderStatus` (`server/services/work-order-status-transition.ts`) devient l'écriture dédiée du statut d'un OT. Les deux appels de `storage.updateWorkOrder` de `work-order-parts.routes.ts` passent par elle : la mise en attente de pièces (`awaiting_parts`) et la reprise après sortie de pièce (`in_progress`).
- **Comment** :
  - la fonction applique elle-même `checkWorkOrderTransition` : une transition interdite répond 409 lisible, même appelée directement ;
  - l'écriture est un compare-and-set (`WHERE id AND status = statut lu`) : une écriture concurrente gagnée répond 409, ou ne fait rien en mode `skip` ;
  - le mode `skip` sert la reprise après sortie : la pièce est déjà sortie, et un OT annulé entre-temps ne doit ni être rouvert ni faire échouer la sortie ;
  - les effets sur le parc (véhicule en maintenance ou en service, échéance préventive) sont extraits dans `work-order-status-effects.ts`, que `storage.updateWorkOrder` appelle aussi ;
  - les trames WebSocket restent chez l'appelant, inchangées.
- **Pourquoi** : la route lisait l'OT puis écrivait sous `eq(id)` seul. Un chef d'atelier qui annulait l'OT entre les deux voyait son annulation écrasée en « en attente de pièces ». Le contrat de course (verrou de ligne tenu, annulation, libération) répond 200 et écrase sur l'ancien code ; avec le correctif, 409 et l'annulation reste. Le cliquet T4 (`write-routes-frozen.ts`) perd deux routes.
- **Suite** : lot 2 (statut du technicien), lot 3 (PATCH générique : `updateWorkOrder` refuse `status`).

## 2026-11-06 — Sortie de pièce sur un OT annulé pendant la sortie (réserve sécurité #567)

- **Quoi** : la sortie de pièce (`POST /api/work-orders/:id/part-requirements/:id/issue`) verrouille l'OT et revérifie son statut dans la transaction de sortie. Un OT terminé ou annulé entre-temps répond 409 lisible, et rien ne quitte le stock.
- **Comment** :
  - dans `onTransition`, avant `addPartToWorkOrder`, `SELECT status FROM work_orders … FOR UPDATE`. Un statut `completed` ou `cancelled` lève une `AppError(409)` ;
  - l'erreur annule toute la transaction : la demande reste `received`, ni ligne `parts_used` ni mouvement ;
  - ordre des verrous : la demande (compare-and-set du service), puis l'OT, puis la pièce. La demande de pièce (`work-order-part-request.ts`) prend l'OT puis la pièce, et ne touche aucune demande existante : il n'y a donc pas de cycle.
- **Pourquoi** : le contrôle « OT terminé ou annulé » de la route lisait le statut sans verrou, et `addPartToWorkOrder` ne le recontrôle pas. Dans la fenêtre, une pièce pouvait donc sortir du stock sur un OT annulé. Le contrat de course (verrou de l'OT tenu, annulation, libération) répond 200 sur 6271754d : la pièce sort et la demande passe `issued`. Avec le correctif, il répond 409, le stock est intact et il n'y a aucun mouvement.

## 2026-11-06 — Journaux de statistiques migrés vers `moduleLogger`, sans montant (décision Q24)

- **Décision 0a (Q24)** : les journaux d'audit métier gardent le montant (paiement client, prix convenu, carburant, dépense de budget). Ils restent gelés dans `log-amounts-hygiene`. Les `console.log` de statistiques sont migrés sans montant.
- **Quoi** : 6 `console.log` migrés vers `moduleLogger`. Ils journalisent maintenant des comptes et des identifiants, plus de totaux FCFA :
  - `client-billing-service` : rapport, paiements d'une facture, statistiques ;
  - `excel-export-service` : export de l'inventaire ;
  - `procurement-service` : commande créée (avec la ligne « Order object » adjacente, fusionnée) ;
  - `vat-billing-service` : statistiques TVA mensuelles.
- **Cliquet** : les comptes gelés baissent. `client-billing-service` passe de 4 à 1, et `excel-export`, `procurement` et `vat-billing` sortent de la liste.
- **Hors lot** : les 40 autres `console.*` de ces quatre fichiers n'ont pas de montant. Ils seront migrés au fil des modifications (AGENTS.md §9).

## 2026-11-06 03:29 — Transition manuelle de commande fournisseur : verrou, relecture et CAS

- **Quoi** : `updateOrderStatus` (`procurement-service.ts`) lisait la commande, vérifiait la transition, puis écrivait sous `WHERE id` seul. Deux réceptions simultanées (double clic sur « livrée ») passaient toutes deux : deux entrées en stock, deux traces, et la seconde écriture écrasait les notes écrites entre-temps. La clôture manuelle lisait les factures liées sans verrou : un règlement annulé en cours n'était pas vu.
- **Comment** :
  - transaction ; commande lue `FOR NO KEY UPDATE`, factures liées `FOR SHARE` (même ordre que la clôture automatique : commande puis factures) ;
  - statut déjà atteint sous verrou : retour sans écriture ni effet ;
  - `UPDATE … WHERE id AND status = <statut relu> RETURNING`, 409 lisible si rien n'est écrit ;
  - effets (lignes livrées, entrée en stock, demandes de pièce, relais finance, notification) réservés à l'appel qui a écrit ;
  - deux `console.log` migrés vers `log.info`.
- **Garde-fou** : `status-update-cas-hygiene` résout désormais `.set(variable)` et `.set({ ...variable })` vers le littéral local. Il a révélé deux écritures de statut cachées (`technician-work-orders-service`, `work-order-items-service`), gelées dans `FROZEN`. Les contenus illisibles (paramètre, `req.body`, appel) sont gelés dans `FROZEN_OPAQUE` : 15 écritures, dont 6 dans `storage.ts`. Les deux listes sont à cliquet.
- **Preuve** : `tests/integration/purchase-order-status-cas.test.ts` (3 tests). Deux réceptions alignées derrière un verrou donnent une trace, un mouvement et un stock de 2. Une clôture pendant qu'une facture repasse non soldée attend, puis répond 409. Témoin et rejeu : une seule trace. Avec l'ancien service, les deux cas concurrents échouent. tsc 0 ; unitaires 3 093 ; contrats achats et factures 27 fichiers, 338 tests.
- **Pourquoi** : même motif que la clôture automatique (#557, #558). Un statut qui déclenche du stock ne s'écrit qu'une fois.

## 2026-11-06 03:40 — Réception de commande fournisseur : lignes verrouillées, stock dans la transaction

- **Quoi** :
  - (a) La livraison globale lisait les lignes sans verrou. Si une réception de ligne était en cours, la livraison calculait son crédit sur l'ancienne quantité reçue : pour 2 pièces commandées, le stock montait à 3.
  - (b) Le marquage des lignes, l'entrée en stock et la mise à jour des demandes de pièce s'exécutaient après le commit du statut. Une panne à ce moment laissait la commande « livrée » sans entrée en stock. Le rejeu tombait alors sur le no-op du statut déjà atteint, et la lecture de la commande « réparait » les lignes sans créditer le stock.
- **Comment** :
  - `updateOrderStatus` : lignes lues `FOR UPDATE` sous le verrou de la commande ; le marquage des lignes, `registerPartReception` et la mise à jour des demandes s'exécutent dans la transaction. Relais finance et notifications restent après le commit.
  - `updateOrderLine` : verrou de la commande, puis de la ligne relue ; le crédit de stock s'exécute dans la transaction. Le CAS sur la quantité reçue reste en filet.
  - `registerPartReception` et `markOrderLinesAsDelivered` reçoivent l'exécuteur (`DbExecutor`).
- **Preuve** : 4 nouveaux tests dans `purchase-order-status-cas.test.ts` :
  - livraison pendant une réception de ligne non validée : stock à 2 ;
  - ligne et livraison alignées derrière le verrou de la commande : stock à 2 ;
  - panne injectée sur la livraison : la commande reste « confirmée », sans mouvement, et un nouvel essai crédite 2 ;
  - panne injectée sur une ligne : la quantité reçue n'est pas enregistrée.

  Avec la version précédente, ces 4 cas échouent ; le deuxième n'échoue que par l'absence d'attente du verrou. tsc 0 ; unitaires 3 093 ; intégration achats et stock 10 fichiers, 54 tests ; contrats 36 fichiers, 445 tests.
- **Pourquoi** : un effet de stock fait partie de la transition. Validé à part, il peut manquer ou être compté deux fois.
- **Hors lot, constaté** : les écarts de stock possibles et la lecture de commande qui écrit sont détaillés dans la PR #560.

## 2026-11-06 03:48 — #560, relecture de sécurité : interblocage entre la livraison et le PATCH d'une demande

- **Quoi** : #560 avait placé la livraison dans une transaction qui verrouille, dans l'ordre, la commande, les lignes, la pièce (entrée en stock), puis les demandes liées. Le PATCH « reçue » d'une demande verrouille la demande, puis la pièce (`handlePartDelivery`). Les deux ordres étant inverses, l'exécution simultanée finissait en 40P01.
- **Cause racine** : l'ordre des verrous était documenté pour la commande, les factures et les lignes, mais n'avait pas été vérifié contre les autres écrivains de la pièce et des demandes.
- **Correctif** : la livraison met à jour les demandes avant la boucle de stock. L'ordre devient commande, lignes, demandes, pièce, compatible avec le PATCH (demande, puis pièce).
- **Preuve** : un test d'intégration rejoue le PATCH : il verrouille la demande, attend que la livraison s'y bloque, puis écrit la pièce. Sur 97807a0c, le test lève `deadlock detected` (40P01) ; avec le correctif, il est vert, avec stock 7 et demande reçue. tsc 0 ; unitaires 3 093 ; intégration 10 fichiers, 55 tests ; contrats 36 fichiers, 445 tests.
- **Leçon** : déplacer un effet dans une transaction change l'ordre de ses verrous. Il faut lister tous les écrivains des tables touchées et aligner l'ordre sur le leur, avec un test qui joue l'autre écrivain.

## 2026-11-06 03:56 — Réception globale : alignement des lignes sur le crédit, lecture sans écriture

- **Quoi** : la livraison d'une commande aligne et crédite les mêmes lignes, pour les mêmes quantités. `getPurchaseOrderById` n'écrit plus.
- **Comment** : une fonction pure, `deliveryReceipts` (`server/lib/purchase-order-delivery.ts`), calcule pour chaque ligne ouverte (`pending`, `partial`) la quantité reçue après alignement et l'entrée en stock. La transaction de livraison applique ce résultat, ligne par ligne, et `markOrderLinesAsDelivered` est supprimé. Une ligne close (`delivered`, `accepted`, `rejected`) n'est ni alignée ni créditée. La normalisation faite pendant la lecture est retirée.
- **Pourquoi** : une ligne close avec un reçu inférieur au commandé était créditée de l'écart sans changer son reçu, donc le stock et le reçu divergeaient. De son côté, la lecture alignait les lignes ouvertes d'une commande livrée sans créditer le stock, et elle écrivait pendant un GET.
- **Preuve** : deux tests d'intégration échouent sur 694555ea et passent avec le correctif.
  - Une ligne close à 1/2 recevait 1 en stock ; elle n'en reçoit plus.
  - Une lecture passait une ligne ouverte de 0 à 2 ; elle ne la modifie plus.
- **Vérifications** : 9 tests unitaires de `deliveryReceipts`, dont l'invariant « chaque hausse du reçu est créditée, et rien d'autre ». tsc 0 ; unitaires 3 102 ; intégration 10 fichiers, 57 tests ; contrats 36 fichiers, 445 tests.
- **Leçon** : quand deux effets doivent rester égaux (le marquage et le crédit), ils doivent sortir d'un même calcul. Deux requêtes écrites séparément finissent par diverger.

## 2026-11-06 04:06 — Q25 : une pièce commandée entre en stock une seule fois

- **Quoi** : si une demande est rattachée à une commande non annulée, son PATCH `received` ou `partially_received` renvoie 409 « Réceptionnez cette pièce depuis la commande fournisseur. ». Une demande sans commande, ou dont la commande est annulée, se réceptionne toujours directement.
- **Comment** :
  - Avant la transition, `updatePartRequirement` cherche une ligne de commande qui porte `partRequirementId` sur une commande dont le statut n'est pas `cancelled`. S'il en trouve une, il renvoie `status: 409`, et la route transmet ce code.
  - Côté écran (`inventory/requests.tsx`), une demande liée propose « Suivre commande » et plus « Entrée en stock ».
- **Pourquoi** : la réception directe créditait le stock, puis la livraison de la commande le créditait une seconde fois par la ligne. Cela faisait 2 pièces reçues pour 4 entrées en stock.
- **Preuve** : contrat `tests/contract/part-requirement-order-reception.contract.test.ts`, 5 tests. Sur l'ancien code, le parcours « réception directe puis livraison » finit à 9 pièces et 2 mouvements ; avec la règle, il finit à 7 et 1. tsc 0 ; unitaires 3 102 ; intégration 10 fichiers, 57 tests ; contrats 38 fichiers, 456 tests.
- **Leçon** : quand un même événement physique (l'arrivée de la pièce) peut être saisi par deux écrans, l'un des deux doit le refuser. Sinon, chacun applique son propre effet.

## 2026-11-06 04:08 — Commandes anciennes livrées avec des lignes restées ouvertes : comptage en lecture

- **Quoi** : il n'y a pas de migration (DÉCISION 0a). On ne crédite pas le stock en silence. Ce qui est livré :
  - une requête de comptage, en lecture seule ;
  - un libellé honnête pour ces lignes dans le détail de commande.
- **Pourquoi** : avant #561, la lecture d'une commande livrée alignait ses lignes ouvertes sans entrée en stock. Depuis #561, la lecture n'écrit plus et la réception globale n'aligne que ce qu'elle crédite. Une ligne `pending` ou `partial` sur une commande `delivered` ou `completed` ne peut donc venir que d'une commande ancienne. Son écart n'est jamais entré en stock.
- **Écran** : `client/src/pages/procurement/orders/[id].tsx` affichait « Reçue au magasin » et « Statut ligne aligné automatiquement ». Les deux étaient faux. Le libellé devient « Ligne restée ouverte », avec ce texte d'aide : à la réception globale, seules les lignes encore ouvertes sont alignées et entrées en stock ; cette ligne n'est pas entrée en stock.
- **Comptage** : la requête ci-dessous ne fait que lire. Elle a été validée sur le Postgres local de test (0 ligne). Elle n'a pas été jouée contre la production : c'est à 0a, ou à l'utilisatrice, de la lancer, puis de décider s'il faut un écran de régularisation.

```sql
SELECT count(DISTINCT po.id)                                    AS commandes,
       count(*)                                                 AS lignes_ouvertes,
       count(*) FILTER (WHERE l.part_id IS NOT NULL)            AS lignes_avec_piece,
       coalesce(sum(greatest(l.quantity_ordered - coalesce(l.quantity_received, 0), 0))
                FILTER (WHERE l.part_id IS NOT NULL), 0)        AS pieces_non_entrees
FROM purchase_orders po
JOIN purchase_order_lines l ON l.purchase_order_id = po.id
WHERE po.status IN ('delivered', 'completed')
  AND coalesce(l.delivery_status, 'pending') IN ('pending', 'partial');
```

## 2026-11-06 04:16 — Q25 complétée : lien demande-commande vérifié sous verrou, recommande refusée

- **Quoi** : la revue sécurité de #562 a relevé deux trous.
  1. Le lien était contrôlé hors de la transaction de la demande.
  2. `createPurchaseOrder` acceptait une demande dans n'importe quel statut et la repassait à `ordered`. Une demande déjà reçue pouvait donc être recommandée, et la livraison recréditait le stock.
- **Comment** :
  - Le contrôle du lien se fait maintenant dans la transaction, après le CAS de la demande, qui tient la ligne verrouillée. Une commande validée pendant l'attente du verrou est donc vue.
  - La création de commande refuse d'abord toute demande non approuvée (409 « Cette demande n'est plus à commander. Rechargez la liste des demandes. »).
  - Ensuite, une transaction écrit la commande, ses lignes, puis les demandes avec `UPDATE … WHERE status = 'approved' RETURNING`. Si le nombre de lignes renvoyé est inférieur au nombre de demandes, toute la création est annulée.
  - Les quatre `console.log` de la fonction passent à `moduleLogger`.
- **Preuve** : un test discriminant par trou. Les trois échouent sur 96f519b4 et passent avec le correctif.
  - Réception directe pendant le rattachement non validé : sur 96f519b4, `success: true`. Maintenant, 409 et stock intact.
  - Création pendant que la demande cesse d'être approuvée : sur 96f519b4, la commande est créée. Maintenant, 409 et aucune ligne.
  - POST d'une commande sur une demande reçue : sur 96f519b4, 201. Maintenant, 409.
- **Vérifications** : tsc 0 ; unitaires 3 102 ; intégration 11 fichiers, 59 tests ; contrats 38 fichiers, 457 tests.
- **Leçon** : une règle qui interdit un chemin doit fermer tous les chemins qui mènent au même effet. La réception directe et la recommande produisaient le même double crédit. Le contrôle doit aussi lire sous le même verrou que l'écriture qu'il protège.

## 2026-11-06 06:12 — CAS du statut technicien et des lignes de travail (#564)
- **Quoi** :
  - `updateWorkOrderStatus` (technicien) : l'UPDATE porte le statut lu ;
  - `updateItem` (lignes de travail) : la ligne est lue sous verrou dans une transaction, avec le statut en condition de l'UPDATE ;
  - deux entrées retirées de la liste gelée `status-update-cas-hygiene`.
- **Comment** :
  - transition concurrente sur l'OT : 409, ordre inchangé ;
  - deux mises à jour d'une ligne s'enchaînent : la seconde part de l'état de la première ;
  - le contrôle du technicien est fait hors transaction ; le poste est lu par `tx`, pour ne pas prendre une seconde connexion du pool en tenant le verrou.
- **Pourquoi** :
  - avant, une prise en charge lue « en attente » écrasait une clôture concurrente ;
  - une clôture de ligne réécrivait `startedAt`.
  Les deux tests de course échouent sur l'ancien code.
- **À savoir** :
  - `updateWorkOrderStatus`, `takeWorkOrder` et `completeWorkOrder` n'ont aucun appelant ;
  - `notes` et `completedDate` étaient passés au `set` sans être des colonnes : Drizzle les ignorait.
- **Suite, à la demande de 0a** :
  - `updateWorkOrderStatus`, `takeWorkOrder` et `completeWorkOrder` sont supprimés (aucun appelant, grep et tsc à l'appui), avec leur test de course et les entrées de `broadcast-hygiene` et `work-order-scope-hygiene` ;
  - `work_order_status_changed` reste émis par le déclencheur `server/db/triggers/work-orders-realtime-triggers.sql`. `realtime-satellites.test.ts` lit maintenant aussi ces fichiers, `event_type := CASE … THEN '…'` compris : sans ce scan, il voyait une entrée morte.
- **Contrat quality-check bloqué 94 min** :
  - aucun timeout de test n'est fixé, donc vitest applique son défaut de 5 s : une attente de verrou aurait échoué à 5 s ;
  - 94 min veulent dire que le minuteur du processus ne tournait pas, donc processus suspendu (veille probable, nuit de 04 h 25 à 06 h 05) ;
  - campagne rejouée avec un échantillon de `pg_stat_activity` toutes les 15 s : 18 fichiers, 170 tests verts en 65 s, aucune session `idle in transaction`, aucune attente de verrou.

## 2026-11-06 — Clôture automatique : factures liées lues `for share`

- **Contexte** : remarque de la relecture sécurité de #557. Sous le verrou de la commande, la clôture lisait les factures liées sans verrou.
- **Défaut** : une transaction en cours pouvait rendre une facture non soldée, par exemple en annulant un règlement (`paid -> approved`) ou en ouvrant un litige. La clôture lisait encore l'état soldé déjà commité et clôturait la commande. Elle restait alors `completed` avec une facture non soldée.
- **Correctif** : les factures liées sont lues `for share`, donc la clôture attend l'issue de la transaction puis relit la facture.
- **Ordre des verrous** : commande d'abord, factures ensuite. Aucun chemin ne verrouille une facture puis la commande :
  - aucun déclencheur ne touche `purchase_orders` (vérifié dans `pg_trigger` et dans le corps des fonctions de recalcul) ;
  - la clé de commande d'une facture ne prend que `key share`, qui reste compatible avec `no key update`.
- **Hors périmètre** : une facture créée pendant la clôture équivaut à une facture créée après. Ce cas relève d'une règle métier (peut-on facturer une commande clôturée ?), pas de la concurrence.
- **Test** : l'attente ne filtre plus sur `ILIKE '%purchase_orders%'`, que n'importe quelle autre suite pouvait fausser. Elle compte, par `pg_blocking_pids` récursif, les seules sessions bloquées derrière le pid qui tient le verrou.
- **Preuve** :
  - nouveau cas « facture repassée non soldée pendant la clôture » : la commande reste `delivered` ;
  - mutant (#557 sans `for share`) : la clôture n'attend pas et le cas échoue ;
  - suites liées vertes : 5 tests d'intégration, 16 fichiers et 147 tests de contrats, 293 fichiers unitaires.
- **Constat transmis à 0a** : la clôture manuelle (`procurement-service.ts`, `update(purchaseOrders).set(updateData)`) lit sans verrou et écrit sans condition sur le statut. Le garde-fou ne la voit pas, parce que `.set(variable)` est une limite connue de `status-update-cas-hygiene`.

## 2026-11-06 — Storage : correction de document lisible (FROZEN_OPAQUE)

- **Quoi** : `storage.updateVehicleDocument` n'écrit plus un objet générique `Partial<InsertVehicleDocument>` mais les seuls champs d'une correction (`name`, `description`, `expiryDate`, `updatedBy`), nommés un à un dans le `.set(…)`. Le `catch` qui avalait l'erreur SQL et renvoyait `undefined` (faux 404) est retiré. `server/services/documentStorage.ts`, sans aucun importeur, est supprimé.
- **Comment** : type `VehicleDocumentCorrection` (Pick des quatre champs) dans l'interface `IStorage`. L'appelant unique (`PATCH /api/documents/:id`) ne change pas. Nouveau contrat : un corps qui forge `vehicleId`, `filePath`, `type`, `uploadedBy` ou `updatedBy` n'écrit que le nom, et l'auteur reste l'utilisateur de la session.
- **Pourquoi** : écriture illisible statiquement sous `eq(id)` seul, comptée dans `FROZEN_OPAQUE` (storage.ts et documentStorage.ts). `vehicle_documents` n'a pas de colonne `status` : aucune transition n'est en jeu, il suffit de rendre le contenu écrit lisible. La liste `swallowed-write-catch-hygiene` perd trois entrées. `FROZEN_OPAQUE` n'existe pas encore sur `main` (arrive avec #559) : son abaissement se fera en fusionnant `main` après la pile.

## 2026-11-06 — Contrôle qualité : refus et validation par la transition d'OT commune

- **Quoi** : le refus du contrôle qualité remet l'OT en cours par `transitionWorkOrderStatus`, et non plus par un `UPDATE … WHERE id` direct. La validation écrit sous la même condition (`completed -> completed`). Le contrôle (`qcStatus`, `qcBy`, `qcAt`, `qcReason`) est écrit dans `onTransition`, donc dans la même transaction que le statut.
- **Comment** :
  - `checkWorkOrderTransition(from, to, role, via?)` reçoit une voie `quality_check`. C'est la seule voie qui rouvre un OT terminé, et seulement vers `in_progress` (D-17).
  - Sans cette voie, la règle reste fermée : la modale d'édition ne change pas.
  - Les effets sur le parc sont rejoués par le service. Ils sont idempotents avec `trg_work_orders_hold_vehicle`, qui immobilise déjà le véhicule : une seule ligne d'historique.
- **Pourquoi** : c'était l'une des deux dernières écritures de statut d'OT hors du compare-and-set, gelée dans `status-update-cas-hygiene`. Un OT modifié entre la lecture et l'écriture voyait son statut écrasé, et la validation pouvait s'écrire sur un OT qui n'était plus terminé. La liste gelée perd l'entrée `quality-check.routes.ts`.
- **Écart validé par 0a** : la validation pose désormais `updatedBy` et `updatedAt` sur l'OT, comme les autres transitions depuis #572.
- **Preuve** :
  - deux courses réelles (verrou de ligne, OT rouvert pendant la requête), pour le refus et pour la validation : 409, contrôle non écrit ;
  - une seule ligne d'historique de maintenance après un refus ;
  - mutants :
    - route d'origine : 2 échecs ;
    - voie qualité ouverte à toute transition : 1 échec ;
    - garde d'idempotence de `setVehicleToMaintenance` retirée : 1 échec (double trace) ;
  - suites complètes vertes : tsc 0, 3 127 tests unitaires, 3 128 tests de contrat.
## 2026-11-06 — Typecheck des tests : lot 1, `tests/unit` (87 → 53)

- **Quoi** : les 34 erreurs TypeScript figées de `tests/unit` (18 fichiers) sont corrigées, et `tests/typecheck-baseline.json` ne contient plus aucune entrée `tests/unit`. Un seul changement produit : dans `shared/errors.ts`, les champs `expected`, `received` et `validation` de `ZodIssueLike` passent en `unknown`.
- **Comment** : types réels plutôt que des contournements (aucun `any`, `@ts-ignore` ni `@ts-expect-error` ajouté). `describeIssue` ne fait que des comparaisons strictes sur ces trois champs, donc son comportement ne change pas. Il accepte désormais un `ZodIssue` réel, dont `validation` peut être un objet (`{ includes }`).
- **Pourquoi** : consigne de 0a, une PR par lot, et la base ne fait que baisser. Une erreur figée masque une dérive de type réelle ; ici, `ZodIssueLike` mentait sur la forme d'un `ZodIssue`.
- **Preuve** : `tsc` 0 ; `check:tests` à 53 figées, sans aucune erreur nouvelle ; unitaires 298 fichiers (3 126 tests verts).

## 2026-11-06 — Lignes d'OT : le technicien affecté suit la règle de l'OT

- **Quoi** : `POST /api/work-orders/:id/items` et `PATCH /api/work-order-items/:id` n'affectent plus une ligne de travail qu'à un technicien ou à un chef d'atelier actif. Un chauffeur, un compte supprimé ou un id inexistant reçoivent un 400, avec `fieldErrors` sur `technicianId`. La désaffectation (`null`) reste possible.
- **Comment** : `refusTechnicien`, qui ne vérifiait que l'existence de l'utilisateur, est remplacé par `assertWorkOrderAssignee`, la garde de l'OT et des rotations de pneus. L'`AppError` levée passe par le `next(error)` déjà présent dans les routes. Une ligne existante n'est pas revérifiée tant que sa modification ne touche pas `technicianId`.
- **Pourquoi** : backlog de 0a (`work-order-items-service.ts:271`). Le sélecteur de l'écran est `/api/users/technicians`, avec les mêmes critères que la garde : l'API acceptait ce que l'écran ne propose pas.
- **Preuve** :
  - contrat `work-order-items` : nouveau cas couvrant le chauffeur, le compte supprimé, le chef d'atelier accepté, le PATCH refusé (sans écriture) et la désaffectation ;
  - mutant (service d'origine) : le cas échoue (201 au lieu de 400).
