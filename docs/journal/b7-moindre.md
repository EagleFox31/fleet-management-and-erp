# Journal b7 — moindre donnée chauffeur et technicien

Modèle et règles : `docs/journal/README.md`.

## 2026-11-10T22:21:31+01:00 — Chauffeur et technicien hors des annuaires, fiches client et missions (#673)

- **Agent** : b7 · **Branche** : `feat/moindre-donnee-chauffeur-b7`
- **Statut** : fait, fusionné
- **Quoi** : le chauffeur ne lit plus que sa propre fiche et ses missions. Le technicien, qui n'a ni écran mission ni écran client, ne lit plus l'annuaire chauffeurs, les fiches client, les missions, leurs preuves de livraison ni le contact client des missions d'exploitation, et ne reçoit plus les trames `mission_*`, `driver_*` et `client_*`.
- **Comment** :
  - `shared/constants/roles.ts` : groupes dérivés de `STAFF_ROLES` : `DRIVER_DIRECTORY_READ_ROLES`, `CLIENT_DIRECTORY_READ_ROLES` (renomme `STAFF_EXCEPT_DRIVER_ROLES`, le technicien en sort aussi), `MISSION_READ_ROLES`, `MISSION_EVENT_ROLES` sans technicien.
  - `server/middleware/auth.ts` : `isDriverDirectoryReader`, `isClientDirectoryReader`.
  - `drivers.routes.ts`, `drivers-management.routes.ts` (`driverSelfOrDirectory`), `missions.routes.ts` (`GET /` et `/:id`), `mission-pod.routes.ts`, `clients.routes.ts` via le montage.
  - `operations.routes.ts` : la trame `mission_created_from_fuel` passe par `emitMissionEvent`, charge réduite à `{ missionId, fuelRecordId }`.
  - Contrats : `least-data-driver-technician` (nouveau), `driver-least-data` et sept contrats existants passés en 403 technicien.
- **Pourquoi** : principe de moindre donnée (R-03, R-13). Les routes protégées par `isStaff` seul laissaient passer chauffeur et technicien vers des données sans écran consommateur.
- **Comment tester (QA)** :
  - Prérequis : Postgres local (`npm run test:db:up`).
  - Étapes : `npm run test:contract -- tests/contract/least-data-driver-technician.contract.test.ts tests/contract/driver-least-data.contract.test.ts`.
  - Attendu : tous verts ; technicien en 403 sur `/api/clients`, `/api/missions`, `/api/drivers`.
- **RAIDER** :
  - couvert : R (groupes dérivés, middlewares réutilisables), D (personnel hors chauffeur et technicien inchangé, campagne complète de contrats rejouée), E (403 sans donnée dans le refus), failure memory (contrats de cloison) ;
  - ne s'applique pas : I et R (rétroactif), aucune donnée ni migration.
- **Reste / risques** : d'autres routes servaient encore des données mission au technicien (`launch-readiness`, `document-renewal-requests`, listes `/api/operations/missions*`). Elles sont traitées par l'entrée suivante.

## 2026-11-10T22:21:31+01:00 — Technicien hors des autres lectures de mission et d'exploitation

- **Agent** : b7 · **Branche** : `feat/moindre-donnee-technicien-b7`
- **Statut** : fait, en relecture
- **Quoi** : le technicien ne lit plus le contrôle de lancement d'une mission, ses demandes de renouvellement, ni aucune route de `/api/operations` (listes de missions, missions par client, statistiques, coûts).
- **Comment** :
  - Inventaire préalable de toutes les routes qui servent des données mission ou client (routeurs `server/api/`, services appelés, `server/routes.ts` par grep).
  - `missions.routes.ts` : `MISSION_READ_ROLES` sur `GET /:id/launch-readiness` et `GET /:id/document-renewal-requests`.
  - `operations.routes.ts` : `MISSION_READ_ROLES` sur `/missions`, `/missions/upcoming` et `/missions/active`. `refuseDriver` devient `operationsCostReader`, son commentaire dit ce qui est appliqué.
  - `shared/constants/roles.ts` : `OPERATIONS_COST_READ_ROLES` dérive de `MISSION_READ_ROLES`, sans le chauffeur.
  - Contrats : un 403 technicien par route dans `least-data-driver-technician`. Les contrats de masquage (budget, prix convenu, prix d'achat) prennent le magasinier comme personnel non lecteur.
- **Pourquoi** : #673 fermait `GET /api/missions` et `/:id`, mais les mêmes données restaient lisibles par ces routes. Leçon de #667 : inventorier toutes les routes qui servent une donnée avant de la fermer.
- **Comment tester (QA)** :
  - Prérequis : Postgres local (`npm run test:db:up`).
  - Étapes : `npm run test:contract -- tests/contract/least-data-driver-technician.contract.test.ts`.
  - Attendu : tous verts ; technicien en 403 sur les 9 routes, logistique ouverte, chauffeur lit sa mission.
- **RAIDER** :
  - couvert : R (groupe dérivé, aucune liste locale), D (campagne complète de contrats, écrans du personnel inchangés : `/api/operations` n'a aucun écran technicien), E (403 sans donnée), failure memory (inventaire avant fermeture) ;
  - ne s'applique pas : I et R (rétroactif), aucune donnée ni migration.
- **Reste / risques** : `GET /api/fuel-records` et `/vehicle/:id` copient encore `orderNumber`, `clientName` et la destination de la mission pour tout le personnel. Le périmètre carburant relève de #675 : signalé à l'orchestrateur.

## 2026-11-11T00:10:00+01:00 — Liaison d'une fiche chauffeur refusée hors lecteurs des missions

- **Agent** : b7 · **Branche** : `fix/driver-link-role-b7`
- **Statut** : fait, PR brouillon
- **Quoi** : `POST` et `PATCH /api/drivers` refusent en 400 de lier une fiche à un compte technicien ou client (hors `MISSION_READ_ROLES`) ou à un compte inconnu. Les lectures de missions, d'exploitation et de fiches chauffeur doivent porter un garde de rôle propre.
- **Comment** :
  - `server/lib/driver-link.ts` : `assertDriverLinkableUser` (400 `AppError`), `driversLinkedOutsideMissionReaders` (lecture seule).
  - `drivers-management.routes.ts` : contrôle appelé à la création et quand le `PATCH` porte `userId`.
  - `scripts/audit-driver-links.ts` : recense les liaisons antérieures, n'écrit rien. Pas de script npm (le `.env` racine pointe la production).
  - Garde-fou `tests/unit/server/mission-read-routes-guard.test.ts`, contrat `driver-link-role`, intégration `driver-link-audit`, `least-data-driver-technician` en un cas par chemin avec des sentinelles uniques.
- **Pourquoi** : cause racine de la fuite de `/api/drivers/me` (#688) ; récidive « routes sœurs », d'où le garde-fou (leçon du 2026-11-11).
- **Comment tester (QA)** :
  - Prérequis : Postgres local (`npm run test:db:up`).
  - Étapes : `npm run test:contract -- tests/contract/driver-link-role.contract.test.ts` puis `npm test -- tests/unit/server/mission-read-routes-guard.test.ts`.
  - Attendu : 400 lisible pour technicien, client et compte inconnu ; chauffeur, magasinier et `userId` null acceptés.
- **RAIDER** :
  - couvert : R (règle dérivée de `MISSION_READ_ROLES`), D (contrats chauffeur existants rejoués), I et R rétroactif (liaisons existantes conservées, audit en lecture seule), E (400 lisible, aucune donnée dans le refus), failure memory (leçon et garde-fou).
  - ne s'applique pas : aucune migration.
- **Reste / risques** : lancer l'audit sur la production (lecture seule) seulement sur GO, puis décider du sort des liaisons trouvées.
