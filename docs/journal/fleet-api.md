# Journal — fleet-api (routes, services, temps réel)

Règles : `docs/journal/README.md`.

## 2026-11-02T14:35:00+01:00 — FUEL3 — Règles de détection, compteur, capacité au PATCH véhicule

- **Agent** : fleet-api · **Branche** : `lot/api/fuel3-regles` (depuis `lot/db/fuel3-capacite`) · **Commit** : voir `git log`
- **Statut** : fait (partie serveur ; écran à fleet-fe)
- **Quoi** :
  - deux règles d'anomalie carburant, `tank-overflow` (quantité > capacité x 1,05) et `odometer-regression` (kilométrage < plein précédent du véhicule), clé `<règle>:<id du plein>` ;
  - `GET /api/fuel-card/anomalies/summary` : `{ vehiclesWithoutTankCapacity }` ;
  - `PATCH /api/vehicles/:id` : `tankCapacityL` validé (0, négatif, texte, > 2 000 : 400 lisible) ;
  - diffusion temps réel à la création, modification et suppression d'un plein.
- **Comment** :
  - `server/services/fuel-anomaly-resolution-service.ts` : CTE SQL calculée à la lecture comme `consumption-gap`, `LAG` sur `(date, id)` pour le kilométrage précédent, comparaison en `numeric` (pas d'arrondi float4), tolérance `TANK_OVERFLOW_TOLERANCE_PERCENT = 5` ; pleins sans véhicule, sans date (odomètre) et électriques ignorés ; kilométrage nul ou 0 = absent ;
  - `shared/contracts/fuel-anomalies.ts` : énumération élargie, champs facultatifs `mileage`, `previousMileage`, `tankCapacityL`, schéma du compteur ;
  - `server/routes.ts` (gelé, retouche minimale) : validation par `vehicleTankCapacitySchema` avant `prepareColumnUpdate`, filet `23514`, 3 appels à `server/lib/fuel-record-realtime.ts` ; `console.error` des deux routes touchées migrés vers `moduleLogger` ;
  - `server/lib/fuel-record-realtime.ts` : réutilise l'événement existant `fuel_record_validated` (invalide `/api/fuel-card`, donc les anomalies).
- **Pourquoi** : cadrage FUEL3 ; compteur en route séparée pour ne pas casser les consommateurs du tableau renvoyé par la liste.
- **Comment tester (QA)** :
  - Prérequis : `.env` avec `DATABASE_URL_TEST`, sous `db-lock`.
  - Étapes : 1. donner 100 L à un véhicule ; 2. saisir un plein de 106 L puis de 105 L ; 3. saisir un plein à 900 km après un plein à 1 000 km ; 4. `GET /api/fuel-card/anomalies` ; 5. `PATCH /api/vehicles/:id` avec `{"tankCapacityL":0}`.
  - Attendu : seul le plein de 106 L est signalé ; la régression est signalée ; le PATCH renvoie 400 avec le message de capacité.
  - Preuve automatisée : `tests/integration/fuel-anomaly-rules.test.ts`, `tests/contract/fuel-anomaly-rules.contract.test.ts`.
- **RAIDER** : couvert : Durable (champs facultatifs, route existante inchangée), Idempotent (lecture seule), Reuse-first (événement existant), erreurs par `AppError`. Ne s'applique pas : migration (portée par `fleet-db`).
- **Reste / risques** :
  - `consumption-gap` ne tient pas compte de `full_tank` et exige `debit_amount > 0` : les pleins saisis par `POST /api/fuel-records` ne sont jamais couverts par lui ;
  - le PATCH véhicule reste réservé à `admin` et `workshop_manager` : la logistique ne peut pas renseigner la capacité (écart éventuel avec l'écran) ;
  - `storage.updateVehicle` avale les erreurs base : le filet `23514` ne se déclenche pas en pratique, la validation amont suffit ;
  - événement dédié `fuel_record_changed` à déclarer dans `shared/contracts/realtime-events.ts` et `useRealTimeSync.ts` (autre session) ;
  - agrégat candidat pour `fleet-db` : le compteur et les règles pourraient devenir une vue SQL.

## 2026-11-02T18:00:00+01:00 — FUEL3 — La logistique saisit la capacité des réservoirs

- **Quoi** : `PATCH /api/vehicles/:id` s'ouvre à `logistics`, pour `tankCapacityL` seul ; tout autre corps de la logistique renvoie 403 lisible. Le changement de capacité émet `fuel_record_validated` (rôles carburant) et le catalogue invalide aussi `/api/fuel-card/anomalies` et `/summary`. Le compteur `vehiclesWithoutTankCapacity` exclut les véhicules `electric`.
- **Comment** : constantes `VEHICLE_EDIT_ROLES` / `VEHICLE_PATCH_ROLES` (`shared/constants/roles.ts`), garde `isVehiclePatcher`, helper pur `vehiclePatchRefusal` (`server/lib/vehicle-patch-guard.ts`) appelé en tête du handler existant ; aucune route ajoutée. Admin et chef d'atelier : droits inchangés.
- **Pourquoi** : décision de l'utilisateur (la logistique gère le carburant) ; la règle tank-overflow et le compteur changent avec la capacité, les autres profils doivent se resynchroniser (AGENTS.md §2).
- **Comment tester (QA)** : connecté en logistique, `PATCH /api/vehicles/:id` `{"tankCapacityL":90}` renvoie 200 ; `{"tankCapacityL":90,"notes":"x"}` ou `{"notes":"x"}` renvoie 403.
- **Preuve** : `tests/unit/server/vehicle-patch-guard.test.ts`, `tests/contract/fuel-anomaly-rules.contract.test.ts`, `tests/integration/fuel-anomaly-rules.test.ts`.
- **RAIDER** : Durable (rôles existants inchangés, test de non-régression), Idempotent (valeur identique : aucune diffusion), Reuse-first (événement existant). Écart : aucun écran de `lot-screens.ts` ne porte ce PATCH, à rattacher côté front.

## 2026-11-02T22:47:00+01:00 — PRT1/CAT2 — Routes des spécifications, variantes et pièces de panne

- **Quoi** : `GET/POST /api/parts/:id/specifications|variants`, `PATCH/DELETE .../:specId|:variantId` (lecture `isStaff`, écriture `isPartsCatalogManager`) ; `GET/POST /api/fault-catalog/:id/parts`, `PATCH/DELETE .../:linkId` (lecture `isStaff`, écriture `isWorkshopManager`). Panne archivée figée (409).
- **Comment** : routeurs existants `parts-catalog.routes.ts` et `fault-catalog.routes.ts`, deux services, migration idempotente (cascade des clés étrangères, dédoublonnage, index uniques) répliquée dans `init-database.ts` avec test de dérive.
- **Pourquoi** : routes absentes alors que l'écran les appelait ; l'écran `parts-database.tsx` est aligné.
- **Comment tester (QA)** : fiche pièce, onglets spécifications et variantes : ajout, modification, suppression ; doublon de code variante : message 409 lisible.
- **Preuve** : contrats `parts-catalog-crud` et `fault-catalog-lifecycle`, test unitaire `parts-catalog-children-schema`.
- **Suites de relecture** : FK pièce de `fault_catalog_parts` en RESTRICT (la panne reste en CASCADE), `deletePart` répond 409 « Pièce utilisée dans le catalogue de pannes » ; dédoublonnage limité aux lignes identiques (panne, pièce, quantité, optionnel), sinon index non posé et WARNING ; `idParam` borné à 2147483647 et `makeFailWith` partagés dans `server/lib/route-helpers.ts` ; unité vide convertie en null ; contraintes nommées comme drizzle ; rôle client 403 testé.
- **RAIDER** : Idempotent (migration rejouable), Durable (cascade explicite), Retroactive (dédoublonnage sans reset). Écarts : `/api/fault-catalog` GET/POST/DELETE de la fiche restent dans `routes.ts` ; `/api/parts/categories` sans route ; fault-catalog non audité (liste gelée) ; aucun événement WebSocket (référentiel relu à l'ouverture de la fiche).

## 2026-11-02T22:15:00+01:00 — FUEL — Mineurs des relectures #97/#100

- **Quoi** : (1) `odometer-regression` marque le plein fautif : sur un pic isolé (1000, 99999, 1100), c'est le pic qui est marqué, plus le plein suivant ; le contrat gagne `nextMileage` (optionnel, additif) et l'écran affiche « Précédent : …, suivant : … ». (2) Tolérance `tank-overflow` décimale : plus de `Math.trunc`. (3) Événement dédié `fuel_record_changed` pour un plein créé, modifié ou supprimé ; `fuel_record_validated` reste celui de la validation d'un bon. (4) `storage.updateVehicle` remonte les violations CHECK (23514) au lieu de les avaler : le filet de la route renvoie 400.
- **Comment** : CTE `drops` (LAG 1 et 2) dans `fuel-anomaly-resolution-service.ts` ; `toleranceSqlLiteral()` ; entrée du catalogue `realtime-events.ts` + cas dans `useRealTimeSync.ts` ; `isCheckViolation` / `pgConstraintOf` (`server/lib/pg-errors.ts`) dans le stockage et la route ; `console.error` du stockage migré vers `storageLog`.
- **Pourquoi** : un pic de saisie faisait marquer le plein correct qui suivait ; une tolérance 2,5 % serait devenue 2 % ; le nom `fuel_record_validated` ne disait pas « modifié » ; le filet 23514 ne se déclenchait jamais.
- **Comment tester (QA)** : saisir trois pleins 1000, 99999, 1100 km sur un véhicule : `/fuel/anomalies` marque celui à 99 999 km.
- **Preuve** : `tests/integration/fuel-anomaly-rules.test.ts` (pic, chute, tolérance, 23514), `tests/unit/client/fuel-anomaly-display.test.ts`, `tests/contract/fuel-anomaly-rules.contract.test.ts` (`fuel_record_changed`).
- **RAIDER** : Durable (cas existants inchangés, contrat additif) ; Retroactive : une décision déjà prise sur `odometer-regression:<plein suivant>` d'un pic reste en base mais ne s'affiche plus, l'anomalie réapparaît sous la clé du pic.

## 2026-11-03T01:45:00+01:00 — Dédoublonnage des six routes dupliquées de `server/routes.ts`

- **Quoi** : suppression des huit déclarations mortes des six routes déclarées deux fois (`GET /api/maintenance-schedules`, `GET /api/parts/:id/usage-history`, `GET /api/statistics/fleet-history`, `POST /api/check-all-maintenance`, `GET /api/warehouse/top-consumed-parts` et `stock-value-history`, ces deux dernières servies par `warehouse.routes.ts`). 164 lignes supprimées, aucune ajoutée. Liste gelée de `routes-hygiene.test.ts` vidée : toute nouvelle entrée est une régression.
- **Comment** : pour chaque route, vérification que la déclaration gardée est la première servie (Express sert la première ; `server/api/index.ts:104` monte les routeurs avant `registerRoutes`), contrat écrit sur le code d'origine et passé avant la suppression, puis suppression et re-passage. Table des lignes dans `docs/plans/dedoublonnage-routes.md`.
- **Pourquoi** : code mort qui a l'air vivant, cause de l'incident `PATCH /api/maintenance-schedules/:id` (LESSONS_LEARNED, 29 octobre 2026) ; dette gelée depuis dans AGENTS.md §9.
- **Comment tester (QA)** : aucun changement visible ; dashboards magasin, historique de flotte, plans de maintenance et vérification globale répondent comme avant.
- **Preuve** : `tests/contract/fleet-history`, `part-usage-history`, `check-all-maintenance` (nouveaux) ; `npm run check` 0 erreur ; unitaires 1033/1033 ; contrats 1063/1063 ; CI #120 8/8.
- **RAIDER** : Durable (comportement servi figé par contrat avant suppression, liste gelée en égalité stricte), Idempotent (rejouable), Retroactive (aucune donnée touchée). Écarts : le garde-fou d'hygiène ne détecte pas un routeur de `server/api/` qui masque `routes.ts` (documenté AGENTS.md §9, test à ajouter) ; `check-all-maintenance` laisse en base de test les échéances avancées et statuts réconciliés (seuls les OT créés sont supprimés).

## 2026-11-03T09:00:00+01:00 — Échéances (P3-2, lot 1) : prévenir avant, bloquer à l'expiration

- **Quoi** : (1) le service préventif n'immobilise plus le véhicule à la génération de l'OT (bloc `declencheur` supprimé) ; le passage en `maintenance` reste à `in_progress` (`storage.updateWorkOrder`). (2) Plus d'OT atelier pour assurance, visite technique, plaque ; `alert-service` ajoute le lien vers la demande de renouvellement (`/vehicles/documents/renew?...`). (3) Lancement de mission : carte grise expirée refusée, et `getMissionEligibility` appelée comme à l'affectation. (5) Papier expiré pendant une mission `in_progress` : alerte critique au rôle `logistics` (chef de parc), mission non interrompue, nouvelle affectation/lancement refusés par l'éligibilité. Dépôt d'un document neuf : la colonne miroir `vehicles.*` suit (`server/lib/vehicle-document-mirror.ts`, appelé par `POST /api/vehicles/:id/documents`).
- **Comment** : aucun changement de schéma ; routes.ts non touché ; erreurs et logs inchangés (`AppError`, `moduleLogger`).
- **Pourquoi** : un papier n'est pas un travail d'atelier, un OT papier `in_progress` immobilisait à tort ; décision utilisateur du 2026-11-03 (`docs/plans/p3-2-echeances.md`).
- **Comment tester (QA)** : véhicule avec visite technique à J+10 : alerte, aucun OT, statut `operational`. Visite expirée : affectation et lancement refusés. Mission en cours + assurance expirée : le logisticien reçoit l'alerte, la mission continue.
- **Preuve** : `tests/contract/mission-document-expiry.contract.test.ts` (6), `vehicle-documents-upload` (miroir), `preventive-maintenance-lifecycle` (marqueur P3-2 devenu vert, MNT1/MNT2 réécrits), `preventive-maintenance-triggers`.
- **RAIDER** : Durable (contrats d'éligibilité inchangés), Idempotent (OT unique par échéance, alertes dédoublonnées), Retroactive (0 OT papier en base réelle, rien à reprendre). Hors lot : récépissé (colonne, lot 2), OT correctif.

## 2026-11-03T14:00:00+01:00 — Échéances (P3-2, lot 1) : corrections de relecture de #126

- **Quoi** : (1) lancement de mission : par type, le document à échéance la plus lointaine est retenu (une vieille carte grise échue ne masque plus la valide). (2) une seule règle de date : le jour J bloque, comme `getMissionEligibility`. (3) le miroir `vehicles.*` ne recule pas au dépôt (`GREATEST`) ; un renouvellement ou une correction de date écrit en direct (mode `set`). (4) `document-renewals.routes.ts` utilise la lib `vehicle-document-mirror` (copies supprimées) ; `routes.ts` intact, équivalence avec son PATCH figée par un test. (5) échec de synchro après création : la ligne document est retirée, le fichier aussi, 500 lisible. (6) dépôt : événements `vehicle_document_updated` et `vehicle_updated` (couche 2). (8) lien de renouvellement calculé seulement à l emission. Décision utilisateur : les alertes papier (30 jours, expiré) vont aussi à `logistics`, sans doublon multi-rôles.
- **Comment** : aucun changement de schéma ; `syncVehicleDocumentMirror(..., mode)` ; `documentAlertRecipients` dans `alert-service`.
- **Pourquoi** : réserves de la relecture de #126.
- **Comment tester (QA)** : carte grise périmée + nouvelle valide : le lancement ne cite plus la carte grise ; assurance expirant aujourd hui : lancement refusé ; dépôt d une assurance plus ancienne : date du véhicule inchangée ; un logisticien reçoit l alerte à 30 jours.
- **Preuve** : `mission-document-expiry` (10), `vehicle-documents-upload` (équivalence PATCH, pas de recul), test de renommage `vehicleInMaintenance`. Front à faire : `vehicle-documents.tsx` n invalide que la liste des documents au dépôt (la synchro temps réel `vehicle_updated` existe).
- **RAIDER** : Durable (contrats inchangés), Idempotent (deux passages = une alerte), Retroactive (aucune donnée touchée).

## 2026-11-03T09:02:00+01:00 — Correction de l'entrée de 14:00 (P3-2, lot 1)

- **Quoi** : l'entrée « Échéances (P3-2, lot 1) : corrections de relecture de #126 » (14:00, seconde) indique « Front à faire » pour `vehicle-documents.tsx`. C'est fait depuis le commit 87b8d3d.
- **Pourquoi** : une info devenue fausse se corrige par une nouvelle entrée, pas en effaçant l'ancienne.

## 2026-11-03T09:05:00+01:00 — Échéances (P3-2, lot 1) : réserves de sécurité R1 et R2 de #126

- **Quoi** : (R1) `vehicle_document_updated` et `vehicle_updated` du dépôt ne sont plus en `broadcast` : scope `roles` limité à `VEHICLE_DOCUMENT_EVENT_ROLES` (personnel hors chauffeur, `shared/constants/roles.ts`). (R2) `DELETE /api/documents/:id` déménage dans `server/api/vehicle-documents.routes.ts` (monté avant `routes.ts`, qui reste gelé et garde un handler masqué) et recale le miroir `vehicles.*` sur la plus lointaine échéance des documents restants du type (`recomputeVehicleDocumentMirror`) ; `vehicle_updated` en scope personnel. Mineurs : date d'échéance invalide au dépôt en 400 lisible (Zod), `AlertRecipientRole` dérivé d'un tableau `satisfies AppRole`.
- **Comment** : le dépôt garde GREATEST. Sans autre document daté du type, le miroir n'est pas touché (peut porter une saisie directe sur le véhicule, rien ne permet de savoir la bonne valeur). Le `PATCH /api/documents/:id` (routes.ts) écrit déjà la valeur patchée directement : non modifié.
- **Pourquoi** : le dépôt diffusait véhicule, type, échéance et acteur aux clients et chauffeurs (cloison §11) ; un document saisi en 2062 puis supprimé laissait le véhicule éligible.
- **Comment tester (QA)** : déposer une visite technique en 2062, la supprimer : l'échéance du véhicule revient à celle du document restant, l'affectation d'une mission est refusée si elle est échue.
- **Preuve** : `vehicle-documents-upload` et `mission-document-expiry` (rouges démontrés avant correctif).
- **RAIDER** : Durable (204/404 de la suppression inchangés), Idempotent (second dépôt à la même date : aucune écriture ni événement, testé), Retroactive (aucune donnée migrée).

## 2026-11-03T09:11:00+01:00 — Échéances (P3-2, lot 1) : réserves de relecture du delta R1/R2 de #126

- **Quoi** : (1) la suppression d'un document ne recale le miroir `vehicles.*` que si elle retire le document qui le fixait (colonne égale à sa date) ; une saisie directe ou un autre document plus lointain n'est plus écrasé. (2) Un échec du recalcul après la suppression est journalisé et la réponse reste 204 : la suppression a eu lieu, un 5xx générique la faisait passer pour ratée et un nouvel essai répondait 404. (3) L'ancien `DELETE /api/documents/:id` de `server/routes.ts` est retiré (code mort masqué ; on retire du fichier gelé, on n'y ajoute rien). (4) Plan P3-2 : limite connue et backlog du `PATCH /api/documents/:id`.
- **Comment** : la condition est portée par l'UPDATE (`colonne = date supprimée AND colonne <> nouvelle date`), ce qui ferme aussi la course avec un dépôt concurrent qui aurait déjà avancé la colonne.
- **Pourquoi** : réserves « avant fusion » de la relecture du delta c6d3c0c..092f983 ; retrait du code mort demandé par l'orchestrateur.
- **Preuve** : 2 tests de contrat ajoutés dans `vehicle-documents-upload`, rouges sur 092f983 ; contrats `vehicle-documents-upload`, `mission-document-expiry`, `former-storage-stubs`, `vehicle-documents-client-scope` 57/57 ; tsc 0 ; unitaires 1537/1537 (dont `routes-hygiene`).

## 2026-11-03T12:30:00+01:00 — Échéances (P3-2, lot 2b partie B) : jour J, UTC, PATCH documents, téléversement

- **Quoi** : (D1/D2) le jour J est expiré partout, `alert-service` dit « expire aujourd'hui, lancement de mission bloqué » à J. (D4) date du jour UTC unique : `shared/lib/utc-day.ts` + `shared/constants/expiry-day.ts`, utilisés par le service, l'éligibilité, les alertes et `isExpiredOnOrBeforeToday` (`missions.routes.ts`, corps seul, accord b7). (D3) `PATCH /api/documents/:id` dans `vehicle-documents.routes.ts`, miroir via `syncVehicleDocumentMirrorFromDocuments` ; événements en scope personnel (cloison §11) au lieu de broadcast. (M2) erreurs multer en `AppError(400)` générique avec `cause` et `moduleLogger` ; `EACCES|ENOSPC|EPERM` dans `looksTechnical`. (M3) extension confrontée au MIME (`isAllowedUpload`).
- **Comment** : `isDateExpiringSoon` devient strictement après aujourd'hui pour ne plus recouvrir « expiré » ; la clé de dédoublonnage de l'alerte passe de « échéance proche » à « expiré » au jour J.
- **Pourquoi** : une règle, une source ; décisions produit D2 et D4. Décalage accepté : 00:00-01:00 à Douala, le jour J est encore la veille.
- **Preuve** : rouges démontrés (7 unitaires D1/D2/D4, 16 unitaires et 4 contrats M2/M3/D3) ; `tsc` 0 ; unitaires 1629/1629 ; contrats voisins 83/83 sur fleet_test_p32c.
- **RAIDER** : Durable (chemin, rôles et réponse du PATCH inchangés), Idempotent (recalage du miroir rejouable), Retroactive (aucune donnée migrée).
## 2026-11-03 — P3-2 lot 2b (A) : récépissé provisoire
- **Agent** : fleet-api · **Branche** : `feat/p3-2-lot2b-recepisse` · **Commit** : voir l'historique de la branche
- **Statut** : fait côté serveur, branchement missions à faire (autre session)
- **Quoi** : `POST /api/document-renewals/requests/:id/receipt` ; `getMissionEligibility` accepte `receipts` ; `loadOpenRenewalReceipts` ; événement `document_renewal_receipt_uploaded` (personnel hors chauffeur) et invalidation client.
- **Comment** : multer sur dossier fixe `uploads/document-renewals/receipts`, ancien fichier retiré par `uploadedFileCandidates`, 23514 traduit en `AppError` 400, écriture conditionnelle sur statut ouvert, jour calendaire Africa/Douala.
- **Pourquoi** : décision 3 du plan P3-2 ; rôles = `DOCUMENT_RENEWAL_WRITER_ROLES`, ceux qui créent et suivent déjà les demandes du routeur.
- **Comment tester (QA)** : déposer un récépissé daté sur une demande ouverte d'un véhicule à assurance échue ; attendu : le véhicule n'est plus refusé jusqu'à la date incluse (une fois `missions.routes.ts` branché).
- **RAIDER** : couvert une règle une source, rétroactif (aucune migration), non-régression (`receipts` optionnel) ; sans objet : schéma.
- **Reste / risques** : `missions.routes.ts` et l'écran de création de mission ne lisent pas encore les récépissés.

## 2026-11-03 — P3-2 lot 2b (A) : durcissement après audit et relecture de #138
- **Agent** : fleet-api · **Branche** : `feat/p3-2-lot2b-recepisse`
- **Quoi** : `withoutDiskPaths` sur toutes les réponses et diffusions du routeur (le PATCH status renvoyait `receiptFilePath` et `proofFilePath` à tous les clients connectés) ; portée par défaut du routeur et de `document_renewal_receipt_uploaded` = `DOCUMENT_RENEWAL_VIEWER_ROLES` ; plafond de 90 jours (`RENEWAL_RECEIPT_MAX_VALIDITY_DAYS`) ; jour UTC unique (`shared/lib/utc-day.ts`) ; diffusion du dépôt au mieux ; extension tirée du MIME ; ancien chemin lu sous `SELECT … FOR UPDATE`.
- **Comment** : `tests/contract/document-renewal-receipt-hardening.contract.test.ts`, `tests/unit/shared/document-renewal-event-scope.test.ts`, `tests/unit/shared/vehicle-eligibility-receipt-utc.test.ts` ; chaque règle démontrée rouge par mutation.
- **Pourquoi** : fuite de chemins disque vers des rôles non autorisés (audit), deux calculs du jour qui divergeaient (Douala contre local), diffusion en échec qui supprimait un fichier référencé.
- **Reste / risques** : `GET /requests` ne renvoie plus `proofFilePath` (aucun consommateur client) ; branchement de `missions.routes.ts` à venir (b7).

## 2026-11-03 — Lot A3 : lectures GET ouvertes au client
- **Agent** : fleet-api · **Branche** : `fix/client-read-scope-fuel-invoices`
- **Quoi** : carburant cloisonné par propriétaire, données internes (stock, prix, factures, KPI) réservées au personnel, ids hors plage en 400, garde d'hygiène étendue aux GET portant une garde reconnue, avec liste gelée (limites et échec fermé au lot A4).
- **Comment** : voir `docs/qa/JOURNAL_COUVERTURE.md` et la leçon du 2026-11-03 de `docs/analysis/LESSONS_LEARNED.md`.
- **Pourquoi** : un client lisait les pleins, le stock, les prix et les factures fournisseur de toute la flotte.
- **Reste / risques** : 55 lectures dans la liste gelée (certaines masquées par un routeur monté avant `registerRoutes`, à vérifier une à une) ; `GET /api/suppliers/:id/invoices/payment` non gardée ici.

## 2026-11-03 — Lot A4 : lectures pneus, catalogue de pannes, garde en échec fermé
- **Agent** : fleet-api · **Branche** : `fix/client-read-scope-tires`
- **Quoi** : `GET /api/vehicle-tires` filtré sur les véhicules du client ; `/api/tires*`, inspections, dernière inspection, rotations (+ détails) et `/api/fault-catalog` réservés au personnel ; `GET /api/suppliers/:id/invoices/payment` limité à `PROCUREMENT_ROLES` ; `?vehicleId` hors plage en 400 sur les routes carburant ; `getLastInspection` et `getTireRotationDetails` (bouchons) implémentés ; garde d'hygiène réécrite en échec fermé, liste gelée 52 -> 22.
- **Comment** : `server/routes.ts` (handlers en place, logs migrés vers `moduleLogger`), `server/services/tires-service-simplified.ts`, `tests/support/route-guard-scan.ts`, `tests/unit/server/routes-hygiene.test.ts`, `tests/contract/client-read-scope-tires.contract.test.ts` (53 cas), balayage d'orphelins de `tests/support/cleanup.ts`.
- **Pourquoi** : un client lisait encore les pneus montés, inspections et rotations de toute la flotte ; la garde se laissait tromper par un nom de garde ou une garde locale.
- **Reste / risques** : alertes, workflows et les autres lectures gelées faute de contrat (22 entrées) ; `exports.routes.ts` `router.get(path, ...)` non analysable (gelé, justifié) ; le scan ne vérifie pas la valeur d'un contrôle de propriétaire. Décision par défaut : `workshop_manager`, `technician`, `driver` n'ont plus accès à la lecture de règlement fournisseur.

## 2026-11-03 — Lot 3 : portée des événements véhicule, client et facturation client
- **Agent** : fleet-api · **Branche** : `fix/lot3-broadcast-scope`
- **Quoi** : `client_*` au personnel (`STAFF_ROLES`) ; `client_invoice_*` et `client_invoices_overdue` aux rôles de facturation (`CLIENT_BILLING_EVENT_ROLES`) ; `vehicle_mileage_updated` et `vehicle_maintenance_position_updated` : fiche complète au personnel hors chauffeur, trame réduite (sans la fiche, donc sans prix d'achat) au chauffeur et au seul propriétaire `vehicles.ownerId`. Les émetteurs `vehicle_updated` des renouvellements et l'alerte étaient déjà cloisonnés sur main ; `server/routes.ts` non modifié.
- **Comment** : `tests/contract/lot3-broadcast-scope.contract.test.ts` (rouge 4/4 contre main, vert après) ; `tests/unit/server/broadcast-hygiene.test.ts` (liste gelée à égalité stricte, entrées OT marquées « lot B », entrepôt « #188 »).
- **Pourquoi** : tout socket connecté, comptes client d'autres clients compris, recevait fiches client, factures et véhicules de la flotte.
- **RAIDER** : couvert réutilisable (constantes de rôles partagées), non-régression (contrats voisins), garde-fou à égalité stricte ; sans objet : migration, nouvel événement ou queryKey.
- **Reste / risques** : lot B (OT, pont NOTIFY) ; chauffeur : trame réduite sur le kilométrage, son écran se resynchronise par requête.

## 2026-11-03 — Lot A5 : gardes de rôle (stock, tableau technicien, personnel, barème)
- **Agent** : fleet-api · **Branche** : `fix/a5-role-guards`
- **Quoi** : `POST /api/warehouse/stock-movement` réservé à `isPartsCatalogManager` (admin, warehouse), données validées, erreurs `AppError`, logs migrés ; `GET /api/dashboard/technician-stats` en `isTechnician` ; `GET /api/users/technicians` et `GET /labor-catalog` en `isStaff` (requêtes client désactivées dans `work-orders/[id].tsx` et `work-order-items-panel.tsx`) ; `assertValidDbId` sur `GET /api/vehicles/:id/tires` ; `GET /api/work-orders/:id` passe par `assertWorkOrderReadable` (règle du technicien conservée) ; handlers morts `GET /api/vehicles` et `/all` supprimés de `routes.ts`.
- **Comment** : `server/api/warehouse.routes.ts`, `server/services/stock-alerts-service.ts` (pièce inconnue en 404, logs migrés), `server/routes.ts` (handlers en place), `server/api/work-order-items.routes.ts`, `tests/contract/a5-role-guards.contract.test.ts` (45 cas, 19 rouges sur `main`), listes gelées réduites.
- **Pourquoi** : une écriture de stock jugée suffisante sous `isStaff` au montage ; un client lisait la flotte, le personnel et le barème. Voir la leçon du 2026-11-03 de `docs/analysis/LESSONS_LEARNED.md`.
- **Reste / risques** : une sortie de stock supérieure au stock ramène la quantité à 0 sans refus ; doublon masqué `POST /api/warehouse/stock-movement` et autres `/api/warehouse/*` de `routes.ts` encore présents ; lectures de `warehouse.routes.ts` ouvertes à tout le personnel (signalé).

## 2026-11-03 — Lot A5, suite de relecture sécurité
- **Quoi** : quantité du mouvement de stock entière (400 sur 1.5), `workOrderId` doit exister (404), retrait des 5 GET `/api/warehouse/*` et du POST `stock-movement` masqués de `routes.ts` (`GET /api/parts/:id/real-stock` conservé, chemin distinct), journal de debug sans `responsiblePerson`, contrôle `isNaN` redondant retiré sur les pneus.
- **Comment** : `warehouse.routes.ts`, `stock-alerts-service.ts`, `routes.ts`, contrat a5 (2 cas de plus).
- **Pourquoi** : retours de fleet-securite et du relecteur sur #184 ; les 6 chemins retirés sont servis plus tôt par le routeur monté avant `registerRoutes`.
- **Reste** : transaction et plancher `Math.max` du mouvement de stock au lot suivant.

## 2026-11-03 — Lot B : cloison temps réel des événements d'ordre de travail
- **Agent** : fleet-api · **Branche** : `fix/lotB-work-order-scope` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : les événements d'OT (créé, modifié, supprimé, statut, pièces, demandes de pièce, pont LISTEN/NOTIFY) ne partent plus en broadcast : personnel (`STAFF_ROLES`) ou, quand la trame porte l'OT ou une demande, personnel hors chauffeur (`WORK_ORDER_COST_READ_ROLES`). Un client n'en reçoit plus aucun.
- **Comment** : `server/lib/work-order-realtime-scope.ts` (deux portées), appliquées sur place dans 9 fichiers serveur et le pont de `server/index.ts` ; liste gelée de `broadcast-hygiene.test.ts` diminuée.
- **Pourquoi** : AGENTS.md §11, un client ne voit que ses véhicules ; aucun écran client n'écoute ces événements, donc pas de trame réduite au propriétaire.
- **Comment tester (QA)** : deux clients propriétaires, un chauffeur, un chef d'atelier ; créer, modifier, supprimer un OT, demander une pièce ; attendu : seul le personnel reçoit la trame.
- **Preuve automatisée** : `lotB-work-order-scope.contract.test.ts` rouge 5/5 sur main, vert 5/5 après ; unitaires 1854 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert non-régression, moindre privilège ; sans objet : migration.
- **Reste / risques** : le tableau de bord client perd la mise à jour live du statut véhicule issu d'un OT (`vehicle_status_changed`), il se rafraîchit à la navigation.

## 2026-11-03 — Lot B, réserves de relecture : pont, contrat, garde-fou
- **Agent** : fleet-api · **Branche** : `fix/lotB-work-order-scope` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : le pont LISTEN/NOTIFY passe dans `server/lib/db-event-relay.ts` : `work_order_*` en `workOrderCostScope()`, `vehicle_status_changed` au personnel plus une trame réduite `{ vehicleId, status }` sans acteur au seul propriétaire du véhicule (lu en une requête ; nul ou échec, rien, journalisé par `moduleLogger`). Corrige la phrase fausse de LESSONS_LEARNED (le client lit `/api/vehicles/:id`, donc la perte de mise à jour live signalée plus haut est levée) et ajoute la règle « objet OT, demande ou pièce utilisée = `workOrderCostScope()` ».
- **Comment** : contrat lotB réécrit avec le vrai `resolveRecipients`, étendu au pont, à incident-service, au préventif, aux lignes de travail, à awaiting-parts et à procurement ; `work-order-scope-hygiene.test.ts` (comptes gelés, trame porteuse d'OT hors portée coûts refusée) ; import de portée remis dans le bloc d'imports des 9 fichiers.
- **Pourquoi** : réserves du relecteur sur #196.
- **Reste / risques** : aucun.

## 2026-11-03 — Garde de rôle sur le débit de la carte carburant
- **Agent** : fleet-api · **Branche** : `fix/fuel-card-consumption-guard`
- **Statut** : fait
- **Quoi** : `POST /api/fuel-card/consumption` n'est plus ouvert à tout le personnel : `isFuelCardManager` (admin, logistics, secretary).
- **Comment** : garde sur la route ; contrat étendu (workshop_manager et technician 403 solde inchangé, logistics et secretary 201) ; entrée retirée de la liste gelée `write-route-guards.frozen.ts`.
- **Pourquoi** : écriture d'argent sous `isStaff` seul (leçon A5). Aucun écran n'appelle la route ; le chauffeur utilise `/api/missions/:id/fuel-records`.
- **Comment tester (QA)** : se connecter en technicien, POST /api/fuel-card/consumption ; attendu 403, solde inchangé.
- **Preuve automatisée** : contrat 44 tests, 2 rouges sur `main` puis verts ; voir PR.
- **RAIDER** : couvert non-régression et liste gelée réduite ; sans objet : migration.
- **Reste / risques** : `isFuelRecordWriter` (chef d'atelier) non retenu, aucun écran d'atelier n'appelle la route.

## 2026-11-03 - fix/fuel-record-soft-delete (etape 1, en pause)
Quoi : colonnes fuel_records.deleted_at / deleted_by (schema, init-database, migration 20261103_fuel_records_soft_delete.sql) et exclusion des lignes supprimees dans solde, listes et sommes des services (carte, fuel-service, dashboard direction, exports, anomalies, bons, kilometrage, rentabilite vehicule).
Pourquoi : la suppression d un plein qui a mouvemente la carte sera douce et reservee aux gestionnaires de la carte ; le solde ne doit plus compter ces lignes.
Reste : DELETE (garde deux familles de roles, verrou carte, suppression douce), PATCH 404, filtre GET /api/fuel-records dans routes.ts, trigger mission-fuel, contrat, listes gelees, LESSONS A5.
