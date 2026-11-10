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

## 2026-11-03 — Prix d'achat du véhicule réservé à admin, logistique et secrétariat
- **Agent** : fleet-api · **Branche** : `fix/vehicle-purchase-price-scope`
- **Quoi** : `vehicles.purchasePrice` n'est plus servi qu'à admin, logistics, secretary (`VEHICLE_PURCHASE_PRICE_READ_ROLES`) ; tout autre rôle le reçoit à `null` (clé conservée) en réponse comme en trame WebSocket. Colonne « Prix d'achat » retirée de l'export XLSX pour les autres rôles ; champ du formulaire véhicule masqué.
- **Comment** : `shared/constants/roles.ts` (constante + `canReadVehiclePurchasePrice`), `server/lib/vehicle-price-scope.ts` (`redactVehiclePrice`, `redactVehiclePriceDeep`, remplace le masquage chauffeur de `operations-service`), application explicite sur `vehicles.routes.ts` (liste, all, expiring/expired, stats, all-with-status, PUT kilométrage et position, trame temps réel scindée par rôle), `operations.routes.ts` (4 lectures de missions), `routes.ts` en place (GET/POST/PATCH véhicule, activate-from-workflow, export en `isAnyUser`), `vehicle-form.tsx`. Contrat `vehicle-purchase-price-scope` (50 cas), unitaire du helper, entrée retirée de `vehicle-routes-guard` (export désormais gardé).
- **Pourquoi** : décision métier du 3 novembre 2026. Pas de middleware global sur `res.json` : `authenticate` ne charge pas `req.user` et les fiches pneu portent aussi un `purchasePrice`.
- **Reste / risques** : KPI direction `acquisitionHT` (contrat partagé figé) non expurgé, décision à prendre ; toute nouvelle sortie qui joint `vehicles` doit passer par le helper.

## 2026-11-03 — Prix d'achat du véhicule, passe de correction (relecture et sécurité)
- **Quoi** : l'inventaire précédent n'était pas complet. Fuites fermées : `GET /api/vehicles/:vehicleId/tires` (véhicule joint), `GET /api/operations/missions/:id/costs` (`vehicleCost` = prix / 1000, désormais `null`, `totalCost` sans ce terme), `POST /api/vehicles/:id/mileage/sync`, `GET /api/vehicles/:id` (rôle normalisé). Écriture : `VEHICLE_PURCHASE_PRICE_WRITE_ROLES` = admin, logistics, secretary ; tout autre rôle qui envoie `purchasePrice` (PATCH, POST, activation) reçoit un 403 lisible. La direction reste en lecture seule et garde `acquisitionHT` (voulu).
- **Comment** : `vehicle-price-scope.ts`, `vehicle-patch-guard.ts` (`vehiclePriceWriteRefusal`), `operations-service.ts`, `routes.ts` (en place), formulaire véhicule, test d'hygiène `vehicle-select-hygiene.test.ts` (liste gelée de 31 lectures justifiées), cas de contrat pneus, coûts, `acquisitionHT`, écriture.
- **Pourquoi** : retours du relecteur et de fleet-securite sur la première livraison.
- **Reste** : contrats et preuve RED sur 3fbf86e à rejouer ; fusion de origin/main et corps de la PR #214 à mettre à jour ; secretary n'atteint ni le PATCH ni le POST véhicule, donc « secretary 200 » non testable par route ; l'assistant d'acquisition (`vehicle-acquisition.tsx:411`) peut envoyer un prix depuis un rôle sans droit.


## 2026-11-03 - PR 214 : PATCH véhicule ouvert à secretary et logistics sur le prix (partiel)

- Quoi : le PATCH véhicule accepte secretary (purchasePrice seul) et logistics (tankCapacityL et purchasePrice) ; tout autre champ en 403. workshop_manager : purchasePrice non nul en 403, vide ou 0 retiré (PATCH, POST, activate-from-workflow). PATCH sans champ restant : 200 sans écriture.
- Comment : `VEHICLE_RESTRICTED_PATCH_FIELDS` dans roles.ts, `withoutEmptyPurchasePrice` et `vehiclePatchRefusal` dans vehicle-patch-guard.ts, handlers existants de routes.ts uniquement.
- Reste : côté client, l assistant d acquisition n envoie plus purchasePrice sans droit d écriture ; preuve rouge contre origin/main ; échec préexistant du contrat GET /api/vehicles/:id/tires (10 cas, déjà rouge sur ccc1156) à diagnostiquer ; fusion d origin/main ; corps de PR.
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
## 2026-11-03 — Carte carburant, lot 2 : garde du plein de mission et corps de /consumption validé
- **Agent** : fleet-api · **Branche** : `fix/fuel-card-lot2` (empilée sur `fix/fuel-card-consumption-guard`, #207)
- **Statut** : fait
- **Quoi** : `POST /api/missions/:id/fuel-records` réservé aux gestionnaires de mission (admin, logistics, secretary) et au chauffeur affecté ; `POST /api/fuel-card/consumption` valide son corps (Zod) : 400 avec `errors` par champ et les messages d'avant (le code d'avant répondait déjà 400 lisible, sans NaN ni 500). Contrôle du chauffeur affecté avant la comparaison des véhicules.
- **Comment** : `authorize([...MISSION_FUEL_MANAGERS, "driver"])` sur la route, contrôle du chauffeur affecté conservé ; schéma `consumptionBodySchema` + `AppError(400, ..., { fieldErrors })` ; entrée retirée de `write-route-guards.frozen.ts`.
- **Pourquoi** : le plein de mission débite la carte de l'entreprise et n'avait que `isStaff` au montage (leçon A5, récurrence ajoutée).
- **Appelants vérifiés** : `client/src/pages/missions/[id].tsx` (bouton visible aux seuls `MISSION_MANAGER_ROLES`), `client/src/pages/driver/dashboard.tsx` (chauffeur), `e2e/21-mission-fuel-double-debit.spec.ts` (chauffeur), contrats existants (logistics) ; aucun écran technicien, magasin ou atelier.
- **Comment tester (QA)** : en technicien, POST /api/missions/:id/fuel-records, attendu 403 ; POST /api/fuel-card/consumption avec quantity "abc", attendu 400.
- **Preuve automatisée** : `fuel-card-write-guards.contract.test.ts` 22 tests, 9 rouges sur la base d'avant (rôles et corps) ; passe de correction : 8 rouges sur la version précédente (dont l'ordre des contrôles), 22 verts. Le contrôle de chauffeur est déjà doublé en amont par `router.param("id")` ; seul le cas d'une seconde affectation distingue l'ordre.
- **RAIDER** : couvert non-régression, liste gelée réduite, failure memory ; sans objet : migration.
- **Reste / risques** : `/regularize` et `/declare-no-refuel` gardés dans le handler, pas en garde de route ; DELETE /fuel-records/:id et idempotence de /consumption hors périmètre.

## 2026-11-03 — Déploiement VPS (Docker Compose + Caddy)

- **Agent** : fleet-api · **Branche** : `worktree-agent-a6e486e04d1abd7b9` · **Commit** : voir `git log`
- **Quoi** : `Dockerfile` multi-étapes (node:20-slim, non root), `deploy/docker-compose.yml` (app-recette, app-prod, Caddy), `deploy/Caddyfile`, `deploy/.env.example`, `docs/deploiement/vps.md`, workflow `deploy-recette.yml` (SSH, no-op sans secrets).
- **Pourquoi** : cible VPS OVH Europe, base Neon externe. Piste Render abandonnée avant commit.
- **Constats** : uploads écrits sous `<cwd>/uploads` (volume nommé monté sur `/app/uploads`) ; `SESSION_SECRET` retombe sur une valeur publique si absent ; sauvegarde applicative coupée (`pg_dump` absent de l'image) ; santé = `GET /api/health` existante.
- **Tester** : `docker compose -f deploy/docker-compose.yml config` avec les `.env*` renseignés ; `docker build .` ; `npm run check`, `npm test` verts.

## 2026-11-03 — Plusieurs chauffeurs par mission : autorisation et saisie carburant (#227)

- **Quoi** : une mission peut avoir plusieurs affectations (un chauffeur chacune). `POST /api/missions/:id/fuel-records` accepte tout chauffeur ayant une affectation active (`ACTIVE_ASSIGNMENT_STATUSES`) et contrôle le véhicule de SA ligne ; une affectation annulée ou refusée ne donne aucun droit. `/regularize` accepte le véhicule de n'importe quelle affectation vivante. `GET /api/missions` et `/:id` gardent `assignment` (celle du chauffeur lecteur, sinon la plus ancienne vivante) et ajoutent `assignments` (un chauffeur ne voit que les siennes). Les listes d'opérations ne dupliquent plus une mission, l'alerte de retard au départ et le CA par véhicule tiennent compte de toutes les affectations.
- **Comment** : règle factorisée dans `server/lib/driver-scope.ts` (`activeDriverAssignmentsOnMission`, `missionVehicleIdsForStaff`, `pickMissionAssignment`) ; lectures `limit(1)` restantes rendues déterministes (`orderBy assignments.id`) ; les listes d'opérations gardent une ligne par mission choisie par `pickMissionAssignment` (même affectation que le détail) ; statuts exclus partagés (`VOID_ASSIGNMENT_STATUSES`, `shared/constants/assignments.ts`).
- **Pourquoi** : la table n'a aucune unicité sur `mission_id`, le code supposait une seule ligne (`limit(1)` sans ordre) : un chauffeur sur la seconde affectation recevait 403, et la mission figurait deux fois dans les listes.
- **Preuve automatisée** : `fuel-card-write-guards.contract.test.ts` 30 tests ; contre l'état d'origine, 6 rouges (second chauffeur refusé, B avec le véhicule de A, personnel sur le 2e véhicule, lecture du détail, doublon des listes d'opérations) ; contre le correctif, 30 verts. 25 fichiers de contrat voisins (missions, opérations, direction, alertes, carburant) : 330 verts.
- **Décision (3 novembre 2026)** : le CA d'une mission à plusieurs affectations est réparti à parts égales entre ses véhicules distincts (`management-dashboard-service`), au lieu d'être crédité en entier à chacun. Les affectations annulées ou refusées (`VOID_ASSIGNMENT_STATUSES`) ne reçoivent aucune part ; une affectation terminée est comptée.
- **Nouveaux contrats** : `fuel-card-write-guards.contract.test.ts` (plusieurs chauffeurs par mission : saisie, lecture, listes d'opérations, relais sur le même camion) ; `management-dashboard-kpis.contract.test.ts`, « partage du CA » (relais = une part, terminée comptée, annulée et refusée exclues), rouge quand l'exclusion est retirée. 16 fichiers de contrat voisins : 203 verts ; unitaires : 156 fichiers verts.
- **RAIDER** : couvert non-régression (contrats voisins verts), réutilisation (`driver-scope.ts`, `ACTIVE_ASSIGNMENT_STATUSES`), failure memory (leçon ajoutée) ; sans objet : migration, aucune colonne.
- **Reste** : voir le commentaire de suivi sur #227 (édition des affectations, contrôles de départ, documents véhicule, coût de mission, écrans client).

## 2026-11-03 — SESSION_SECRET : refus de démarrer en production sans secret propre (#243)
- **Agent** : fleet-api · **Branche** : `fix/session-secret-production`
- **Statut** : fait, en relecture
- **Quoi** : le serveur refuse de démarrer hors `development`/`test` si `SESSION_SECRET` est absent, fait moins de 32 caractères ou vaut une valeur publique du dépôt.
- **Comment** : `resolveSessionSecret(env, warn)` dans `server/lib/session-secret.ts`, appelé par `server/middleware/session.ts`. Liste d'autorisation `SESSION_SECRET_FALLBACK_ENVS` ; la signature utilise la valeur brute (le rognage sert seulement à mesurer, pour ne pas invalider les sessions d'un secret actuel entouré d'espaces).
- **Pourquoi** : le repli `"YaroFleetOSSecretKey"` est public ; un déploiement sans secret permettait de forger un cookie de session.
- **Comment tester (QA)** : `NODE_ENV=production` sans `SESSION_SECRET` → le serveur s'arrête avec un message qui dit comment générer un secret ; avec 48 octets aléatoires en base64 → démarrage normal.
- **Preuve automatisée** : `tests/unit/server/session-secret.test.ts`, 17 tests dont la garde statique sur `session.ts`.
- **RAIDER** : couvert durable (dev et test inchangés), failure memory (LESSONS_LEARNED), erreur actionnable sans secret journalisé ; sans objet : migration.
- **Reste / risques** : la démo Replit (`npm run start`) doit avoir `SESSION_SECRET` dans ses Secrets avant le déploiement. `sameSite: "none"` en production (APK Capacitor) suivi à part.

## 2026-11-03 19:35 — Plusieurs chauffeurs par mission : écriture (suite de #227, empilée sur #233)

- **Quoi** : `POST /api/missions/:id/assignments` (ajout d'un chauffeur et de son véhicule) et `DELETE /api/missions/:id/assignments/:assignmentId` (annulation : statut `cancelled`, ligne conservée) dans `server/api/missions.routes.ts`.
- **Comment** : rôles `MISSION_MANAGER_ROLES` comme le PATCH ; `assertValidDbId` sur chaque id ; transaction avec `SELECT ... FOR UPDATE` sur la ligne mission (doublon du même chauffeur actif : 409, ajouts concurrents sérialisés, aucun index) ; contrôles du PATCH repris (éligibilité véhicule, chauffeur actif, CPC, tonnage) plus conflit de planning par chauffeur et par véhicule (409) ; `mission_updated` émis après commit par `emitMissionEvent` (personnel hors chauffeur + trame réduite nominative aux chauffeurs de la mission), aucune nouvelle clé de requête. PATCH `{ assignment }` inchangé.
- **Pourquoi** : le PATCH ne remplace ou supprime qu'une affectation, il n'existait aucun moyen d'ajouter un second chauffeur.
- **Preuve** : `mission-multi-assignments.contract.test.ts` 26 tests.
- **Reste** : écran (fleet-fe), voir le corps de PR.

## 2026-11-03 — Plusieurs chauffeurs par mission : NO-GO sécurité levé (#240)
- **Agent** : fleet-api · **Branche** : `feat/mission-multi-assignments`
- **Statut** : fait, en re-audit
- **Quoi** : statut, annulation et modification n'écrivent plus que sur les affectations vivantes ; un chauffeur annulé perd l'accès à la mission.
- **Comment** : `PUT /:id/status` cible les lignes actives du chauffeur (403 sinon) ou toutes pour le personnel, contrôles de lancement par ligne (motifs préfixés par l'immatriculation) ; écritures `where id and status` ; DELETE sous `FOR UPDATE`, no-op sur `cancelled`/`rejected` ; PATCH 409 au-delà d'une affectation vivante, `catch` passé à `next` (il rendait 500) ; `loadOpenRenewalReceipts(vehicleId, tx)` lu dans la transaction de POST /assignments.
- **Pourquoi** : une affectation annulée était ressuscitée par le lancement (part du CA, saisie carburant), et un chauffeur annulé lançait encore la mission.
- **Preuve automatisée** : `mission-multi-assignments.contract.test.ts` 34 tests, 7 rouges sur le code d'avant ; garde `assignment-write-hygiene.test.ts`, rouge sur le code d'avant (4 écritures).
- **3 couches** : pas d'écran pour l'instant ; instantané local et resync ciblé à livrer avec l'écran (fleet-fe). Trames déjà émises par POST/DELETE.
- **RAIDER** : couvert non-régression (contrats voisins), failure memory (LESSONS « passage 1→N »), garde-fou automatique ; sans objet : migration.
- **Reste / risques** : le contrôle de conflit de planning au lancement compte encore les affectations nulles des autres missions (faux blocage possible, pas une faille).

## 2026-11-04 00:10 — Plusieurs chauffeurs par mission : listes chauffeur et rattrapage de main (#240)
- **Agent** : fleet-api · **Branche** : `feat/mission-multi-assignments`
- **Statut** : fait, en relecture
- **Quoi** : fusion de `main` (base #233 fusionnée). La boucle de lancement par affectation passe sur `isDriverLicenseExpired` / `isPaperExpired` (#224, valable le jour J). `POST /:id/assignments` valide par `validateBody`. Les listes chauffeur (`GET /api/missions`, `/api/operations/missions`, `/upcoming`, `/active`) et la jointure des affectations écartent les affectations annulées ou refusées.
- **Comment** : un filtre unique `driverLiveAssignmentFilter` / `missionsOfDriversFilter` dans `server/lib/driver-scope.ts`, repris par `canAccessMissionAsDriver`, la liste des missions et `operations-service`. Le garde-fou `assignment-write-hygiene` refuse tout `inArray(assignments.driverId` hors de `driver-scope.ts`.
- **Pourquoi** : un chauffeur retiré de la mission recevait 403 sur le détail mais la voyait encore dans ses trois listes (preuve rouge sur l'ancien code). Une cloison doit être la même pour le détail et pour la liste.
- **Reste tracé, non corrigé ici** :
  - un ajout de chauffeur sur une mission `in_progress` crée une ligne `pending` sans contrôle des papiers ;
  - au passage à `delivered`, la ligne `in_progress` d'un co-chauffeur reste active ;
  - le PATCH lit les affectations sans verrou sur la mission.

  Ces trois cas demandent une règle métier (ajout en cours de route, clôture par chauffeur). Ils sont à trancher avant d'être codés.
- **Preuves** : 0 `error TS` ; 163 fichiers / 2033 tests unitaires ; 14 fichiers / 230 contrats (mission*, operations, fuel-card-write-guards).

## 2026-11-04 00:17 — Plusieurs chauffeurs par mission : fiche chauffeur et trames (#240, re-audit)
- **Agent** : fleet-api · **Branche** : `feat/mission-multi-assignments`
- **Statut** : fait, en relecture
- **Quoi** :
  - `GET /api/drivers/me` et `GET /api/drivers/:id/missions` filtrent par `driverLiveAssignmentFilter` : le tableau de bord d'un chauffeur retiré ne liste plus la mission (client, adresses, consignes).
  - `assignedDriverUserIds` n'envoie plus de trame au chauffeur retiré.
  - Les deux contrôles de conflit de planning au lancement ne comptent plus une affectation annulée ou refusée.
- **Comment** : le garde-fou `assignment-write-hygiene` exige qu'un `eq`/`inArray(assignments.driverId, …)` vive dans un `.where` qui filtre aussi `assignments.status`. Seules exceptions : la jointure `= drivers.id` et le helper lui-même. Il remplace l'interdiction limitée à `inArray`.
- **Pourquoi** : 96b680b n'avait couvert que les `inArray` ; les `eq` de la fiche chauffeur fuyaient encore. Le contrôle porte maintenant sur la classe de défaut, pas sur une forme d'écriture.
- **Preuves** :
  - preuve rouge sur l'ancien code : le garde-fou trouve 2 lectures dans `drivers-management.routes.ts` et 2 dans `missions.routes.ts` ; le contrat voit encore la mission sur `/api/drivers/me` et `/api/drivers/:id/missions` ;
  - 0 `error TS` ;
  - unitaires : 163 fichiers, 2034 tests ;
  - contrats : 20 fichiers, 279 tests (mission*, operations*, driver*, fuel-card-write-guards).

## 2026-11-04 — Suppression douce des pleins carburant : DELETE gardé (fix/fuel-record-soft-delete, étape 2)
- **Agent** : fleet-api · **Branche** : `fix/fuel-record-soft-delete`
- **Quoi** :
  - `DELETE /api/fuel-records/:id` : garde de route `authorize([...FUEL_CARD_MANAGER_ROLES, "workshop_manager"])`, décision dans `FuelService.deleteFuelRecord(id, actor)` sous `lockFuelCard`. Plein qui a mouvementé la carte : admin, logistics, secretary (403 sinon), suppression douce (`deleted_at`, `deleted_by`). Plein physique : garde historique (admin, chef d'atelier), suppression définitive. Absent ou déjà supprimé : 404. Événement `broadcastFuelRecordChanged` conservé, log `moduleLogger("fuel-records")`.
  - Lectures filtrées sur `deleted_at` : statistiques par véhicule, par station, par client et bilan mensuel de `fuel-card-service`, triggers `mission-fuel-triggers.sql` et `fuel-alerts-triggers.sql`, `GET /api/fuel-records` (lecture par `FuelService` au lieu de `storage.ts`, gelé), `updateFuelRecord` (WHERE sur ligne vivante).
  - Rejeu par `request_key` (`findReplayedFuelSubmission`) : une ligne supprimée donne 409 (la clé reste portée par l'index unique), pas un faux rejeu.
  - `FUEL_CARD_MANAGER_ROLES` ajouté à `shared/constants/roles.ts`, repris par `isFuelCardManager`.
- **Pourquoi** : décision métier tranchée (suppression d'un plein ayant mouvementé la carte réservée aux gestionnaires, douce et tracée, solde exclu des lignes supprimées).
- **Preuves** : voir le rapport de PR (check, unitaires, contrats) ; contrat 10 cas, 7 rouges sur `origin/main`.
- **Écarts / ouvert** : `export-service.ts` (sauvegarde JSON complète) exporte toujours les lignes supprimées avec leur `deleted_at`, voulu pour une sauvegarde ; `server/storage.ts` (interdit) lit encore `fuel_records` sans filtre dans `getFuelRecordsByVehicleId`, plus appelée par `routes.ts`.

## 2026-11-04 — Suppression douce des pleins carburant : réserves de l'audit et de la relecture (#263)
- **Agent** : fleet-api · **Branche** : `fix/fuel-record-soft-delete`
- **Quoi** :
  - Correction d'une entrée précédente : `storage.getFuelRecordsByVehicleId` reste appelée (`/statistics`, `/consumption-history`, `alert-service`) ; elle filtre `deleted_at` depuis ef19904. Contrat sur ces deux routes (rouge sans le filtre, vert avec).
  - Test d'hygiène `fuel-records-deleted-at-hygiene.test.ts` (lecteurs de `fuel_records`, exceptions gelées justifiées).
  - PATCH : `AppError(404)` quand l'update ne touche aucune ligne vivante (suppression concurrente) au lieu de 500.
  - `fuel-alerts-triggers.sql` rejoué au démarrage (`CREATE OR REPLACE`), sous garde `to_regproc('create_vehicle_alert')`, sinon avertissement ; cas ajouté au test jumeau.
  - Log `moduleLogger` de la suppression définitive d'un plein physique (coût, quantité, véhicule).
  - Règle de suppression partagée : `shared/constants/fuel-record-delete.ts` (`canDeleteFuelRecord`, `hasMovedFuelCard`), utilisée par `FuelService.deleteFuelRecord` et par l'écran (le chef d'atelier ne voit plus la corbeille sur un débit de carte).
  - Couche 3 : `fuel_record_changed` invalide aussi le groupe `missions` ; suppressions locales invalident `/api/fuel-card/*` ; `useSingleFlightMutate` sur les 3 boutons supprimer ; `if (!req.user)` mort retiré de la route.
- **Pourquoi** : réserves de l'audit sécurité et de la relecture sur #263.
- **Écarts / ouvert** : poser les triggers d'alertes carburant active un comportement dormant (alertes insérées pour `user_id = 1`) ; à valider par `fleet-db` avant la mise en production. Les écrans `fuel/[id].tsx` et `fuel-record-detail-modal.tsx` n'appliquent pas encore `canDeleteFuelRecord` à leur bouton.

## 2026-11-04 — Suppression douce des pleins carburant : triggers d'alertes retirés du démarrage (#263)

- **Quoi** : `applyFuelAlertsTriggers` retiré de `server/init-database.ts`. `fuel-alerts-triggers.sql` garde son filtre `deleted_at`, mais n'est plus posé au démarrage.
- **Pourquoi** : rejoué sur PG 17 local (relecture), le trigger AFTER INSERT fait échouer le 2e plein d'un véhicule (`AVG(LAG() OVER)` interdit, `format('%.1f')` invalide) et insère avec `user_id = 1` en clé étrangère. Sur toute base où `create_vehicle_alert` existe, création de plein, débit de carte et plein de mission tomberaient en 500. Sa réécriture est confiée à fleet-db (sous-requête, `round()`, destinataire configuré, alerte qui ne casse pas l'écriture, intégration qui pose les triggers).
- **Comment tester** : `tests/unit/server/fuel-records-soft-delete-schema.test.ts`, qui échoue si `init-database.ts` cite de nouveau ce fichier.
- **Corrections d'entrées précédentes** :
  - l'entrée « réserves de l'audit et de la relecture » disait que `fuel/[id].tsx` et `fuel-record-detail-modal.tsx` n'appliquaient pas `canDeleteFuelRecord` : c'est fait depuis ba14938 ;
  - ef19904 (filtre `deleted_at` de `storage.getFuelRecordsByVehicleId`, lu par `/statistics`, `/consumption-history` et `alert-service`) et ba14938 (bouton supprimer de la fiche et de la modale) n'avaient pas d'entrée : les voici.

## 2026-11-04 11:10 — R2 : gardes déclaratives du parcours d'acquisition
- **Agent** : fleet-api · **Branche** : `fix/r2-vehicle-acquisition-guards`
- **Statut** : fait, en relecture
- **Quoi** : les 7 écritures gelées du parcours d'acquisition (POST et PATCH de la session, complete, abandon, abandon actif, téléversement et suppression de document) portent `isWorkflowDocumentWriter` (admin, secrétariat, logistique, chef d'atelier, client). Les corps passent par `validateBody` (schémas dans `shared/contracts/vehicle-acquisition.ts`, `purchasePrice` accepté dans `workflowData`). Les sept entrées quittent les listes gelées du cliquet, plus quatre de `KNOWN_AUTHENTICATE_ONLY`.
- **Comment** : la cloison était déjà dans le service (`user_id` + `session_id`) ; `complete` et `abandon` répondaient 200 sur la session d'un autre. `completeWorkflow` et `abandonWorkflow` renvoient maintenant si la session est celle de l'utilisateur (quel que soit son statut : rejouer reste 200), la route répond 404 sinon. Les documents gardent le 403 du handler (`canAccessOwned`).
- **Pourquoi** : une écriture sans garde de rôle laissait un technicien ou un magasinier créer des brouillons ; une clôture silencieuse sur la session d'un autre masquait l'accès hors périmètre.
- **Écarts de droits** : technicien, magasinier, chauffeur, direction et comptable ne créent plus de session ni ne suppriment de document (403). Aucun écran ne leur ouvre ce parcours (route `/workflows/vehicle-acquisition` : admin et chef d'atelier).
- **Preuves** : preuve rouge avant correctif, 10 cas sur 15 en échec (complete, abandon et abandon actif : 200 au lieu de 404 pour le client B ; 200 au lieu de 403 pour le technicien ; 400 sans `errors[]` sur le téléversement) ; ensuite 15/15. 0 `error TS` ; unitaires 2107 verts, seul `backup-db.test.ts` instable (non corrigé) ; contrats 145 fichiers, 1742 tests verts.

## 2026-11-04 — Prix d'achat du véhicule, clôture du « Reste » (#214)
- **Quoi** : le « Reste » de l'entrée du 3 novembre est soldé. L'assistant d'acquisition n'envoie plus `purchasePrice` pour un rôle sans droit d'écriture (8bbfc6a). Le contrat pneus était rouge parce qu'il lisait `r.id`, `row.tire` et `row.vehicle`. La route renvoie des lignes de jointure `{ vehicle_tires, tires, vehicles }`, forme que lit déjà `pages/vehicles/[id].tsx` : le test a été corrigé, l'API n'a pas changé (192d934). La branche est fusionnée avec `origin/main`.
- **Preuve rouge** : le contrat `vehicle-purchase-price-scope` a été rejoué sur le code de `origin/main` (9461373). Seule différence : la constante `VEHICLE_PURCHASE_PRICE_READ_ROLES`, absente de main, est remplacée par sa valeur littérale. Résultat : 52 cas rouges sur 89. Ils échouent pour les rôles hors lecture : liste 7, détail 7, `/all` 7, pneus 7, coûts de mission 5, missions 5, export 2, trame kilométrage 1, écriture PATCH 11. Sur la branche, les 89 cas passent.
- **Preuves** : 0 `error TS`, 2150 tests unitaires et 1810 contrats verts.
- **Reste** : l'écart sur `acquisitionHT` (direction, `management-dashboard-service.ts:529` et `:713`) attend la décision de l'utilisatrice, que 0a lui pose. Rien n'est modifié en attendant.

## 2026-11-04 — Lot R8 : connexion PIN, activation de compte, planifications et types de document
- **Quoi** : six écritures passent par `validateBody` et sortent du cliquet (2 entrées T3, 4 entrées T4, 2 entrées T1 de `server/api`). `POST /api/auth/pin-login` : corps validé en type avant la recherche du compte (`shared/contracts/auth-pin-login.ts`). `PATCH /api/admin/users/:id/toggle` : `isActive` booléen obligatoire (`admin-users.ts`) ; la réponse ne renvoie plus le hash du mot de passe ni du PIN. `POST /api/maintenance-schedules` et `POST /api/test-date-maintenance` : schémas partagés (`maintenance-schedules.ts`), `details: error.message` retiré de la réponse 500. `POST` et `PATCH /api/vehicle-document-types` : `validateBody` sur les schémas existants, garde `authorize(["admin"])` écrite sur la route (le cliquet ne reconnaissait pas l'alias `adminOnly`).
- **Pourquoi** : le cliquet comptait ces routes en dette. Le corps de `pin-login` n'était pas typé (`Number(userId)`, `String(pin)`), la route d'activation lisait `isActive` sans le valider : `"false"` en chaîne passait la garde d'auto-désactivation, qui lit `isActive` avant le handler, et un admin pouvait se désactiver lui-même.
- **Décisions** : `pin-login` garde ses échecs d'authentification tels quels (401 inconnu, 403 non chauffeur, 401 sans PIN, 401 PIN faux). Seul le corps mal typé reçoit un 400 identique pour tous, avant toute lecture en base. `POST /api/test-date-maintenance` a un appelant (`client/src/pages/maintenance/date-based-alerts.tsx:199`) et deux contrats : conservée.
- **Preuve rouge** : contrat `r8-auth-misc-write-guards` joué sur le code d'avant : 3 cas rouges sur 19 (corps mal typé de `pin-login` : 401 au lieu de 400 ; `toggle` avec `isActive` mal typé : désactivation effectuée ; auto-désactivation avec `"false"` : 200). L'assertion sur le hash du mot de passe dans la réponse de `toggle` a été ajoutée après ce passage : la réponse du passage rouge contenait ce hash, mais l'assertion n'a pas été rejouée sur l'ancien code.

## 2026-11-04 — Durcissement de la connexion par PIN
- **Agent** : fleet-api · **Branche** : `fix/pin-login-hardening` (base `main`, #273 fusionnée)
- **Quoi** : tous les échecs de `POST /api/auth/pin-login` répondent le même 401 « Identifiants invalides » (même code, même corps) avec une comparaison bcrypt factice quand il n'y a pas de hash. L'identifiant est validé puis canonisé avant le garde de verrouillage (un seul compteur par compte). À la création d'un compte chauffeur, le mot de passe est aléatoire et n'est plus le PIN haché ; reprise rétroactive idempotente au démarrage (`revokePinDerivedDriverPasswords`).
- **Comment** : `server/lib/dummy-hash.ts` (comparaison factice, mot de passe aléatoire), montage dans `server/api/index.ts`, reprise dans `server/init-database.ts`. Contrats `driver-pin-login` mis à jour vers le 401 unifié.
- **Pourquoi** : réduire ce que la connexion par PIN laisse apprendre et fermer la contournement du verrouillage par la forme de l'identifiant.
- **Non fait** : refus du login par mot de passe pour le rôle chauffeur (les harnais de test ouvrent leurs sessions chauffeur par mot de passe) ; suite possible.
## 2026-11-04 12:15 — Reliquats R2 (documents homonymes, abandon en panne, clôture d'un abandon)

- **Quoi** : trois reliquats de la relecture de #270. (1) `transferDocumentsToVehicle` et `cleanupAbandonedWorkflowDocuments` filtrent aussi par `workflowId` ; le dossier `uploads/workflows/<sessionId>` n'est supprimé que si aucun document ne subsiste sous ce `sessionId`. (2) `abandonWorkflow` (rappels) lève `AppError(500, …, { cause })` sur panne base au lieu de renvoyer `false` ; `false` reste l'absence réelle (404). (3) `completeWorkflow` lève `AppError(409)` sur une session abandonnée ; rejouer sur une session terminée reste 200. Le point 4 (plancher de `vehicle-routes-guard`) était déjà dans 85fbd32.
- **Comment** : `sessionId` n'est pas unique entre comptes : deux brouillons homonymes partageaient lignes et dossier disque. Les routes `complete` et `active abandon` passent leurs erreurs à `next` (AppError conservée, 500 lisible sinon). À la création d'un véhicule, un brouillon déjà abandonné (409) est journalisé sans faire échouer la création.
- **Pourquoi** : le nettoyage du brouillon abandonné de B supprimait les documents de A, le transfert de B les copiait sur son véhicule, une panne base répondait 404 et un brouillon abandonné se déclarait « terminé ».
- **Preuves** : test d'intégration `workflow-shared-session-isolation` rouge avant correctif (2 cas : `[]` au lieu de `[88]` ; deux noms copiés au lieu d'un), vert ensuite ; test unitaire `workflow-reminder-abandon` (panne, absence, succès) ; contrat r2 : 409 après abandon, 200 rejoué. 0 `error TS`, unitaires verts, contrats et intégration workflow verts.
- **Reste** : contrainte unique `(user_id, session_id)` à proposer à `fleet-db` (supprimerait la classe de bug à la source).
- **#231 (même fonction)** : `transferDocumentsToVehicle` ne prend que les documents `isTransferred = false` du workflow visé ; pour chaque document, la marque « transféré » (gardée par `is_transferred = false`) et la ligne `vehicle_documents` sont écrites dans la même transaction. Un rejeu ou un second appel concurrent ne duplique plus. Preuves : deux tests d'intégration rouges avant correctif (`['une-fois.pdf','une-fois.pdf']` et `['tardif.pdf','tardif.pdf']`), verts ensuite. Reprise des données : aucune (recensement sur la base de test : 0 doublon).

## 2026-11-04 — Changement de mot de passe : révocation des autres sessions
- **Quoi** : `POST /api/users/change-password` appelle `revokeOtherUserSessions` (`server/lib/user-sessions.ts`) après l'écriture du nouveau hash : `DELETE FROM "session" WHERE sess->>'userId' = $1 AND sid <> $2` (requête paramétrée, `sid` = `req.sessionID`), puis fermeture des sockets temps réel du compte hors session courante. `closeUserConnections` (`server/index.ts`) reçoit un 3e argument optionnel `keepSessionId` ; la socket mémorise l'identifiant de session HTTP à l'upgrade (`wsMeta.sessionId`). Modification en place du handler de `routes.ts` (gelé), aucune route ajoutée.
- **Pourquoi** : un mot de passe changé après compromission laissait valides tous les autres cookies du compte.
- **Décisions** : échec de révocation = `AppError(500, ..., { cause })` via `next` ; le hash est déjà écrit, le message le dit et l'utilisateur peut relancer (idempotent). Contrairement à `revokeUserAccess`, pas de second essai silencieux. Client inchangé : le 401 « Mot de passe actuel incorrect » n'est lu comme expiration de session nulle part (seule `session-check.ts` sur `/api/auth/me` déconnecte ; `profile.tsx` n'affiche qu'un toast), donc le code reste 401 et les contrats existants aussi.
- **Preuve** : contrat `change-password-revoke-sessions` rouge avant correctif (autre session encore à 200), vert après ; intégration `revoke-other-user-sessions` (2 suppressions puis 0).

## 2026-11-04 — PATCH utilisateur : PIN haché et reprise des PIN en clair
- **Quoi** : `PATCH /api/users/:id` retire `pin` du corps avant `insertUserSchema.partial().parse`, le valide (exactement 4 chiffres, 400 lisible sinon, vide ignoré) et l'écrit haché (bcrypt, coût 10). `hashPlainUserPins` (`server/lib/pin-hash-migration.ts`), appelée par `initializeDatabase`, hache tout `users.pin` non NULL sans préfixe `$2`.
- **Pourquoi** : le PIN était stocké en clair alors que `pin-login` compare à un hash bcrypt.
- **Décisions** : reprise idempotente, UPDATE gardé par l'ancienne valeur, un PIN en clair non conforme est haché aussi, seul un compteur est journalisé.
- **Preuve rouge** : intégration (reprise neutralisée) 0 haché au lieu de 2 ; contrat 7 cas rouges sur 7 sur le code d'avant (PIN stocké en clair, PIN invalide accepté en 200, PIN vide stocké `''`).
## 2026-11-04 — Changement de mot de passe : tout ou rien, écriture conditionnelle
- **Quoi** : le hash et le DELETE des autres sessions partent dans la même `db.transaction` (`routes.ts`, handler modifié en place). `revokeOtherUserSessions` est découpée : `deleteOtherUserSessions(executor, userId, keepSid)` (dans la transaction) et `closeOtherUserConnections` (sockets, appelée après le commit). Le chemin « 200 partiel » (`otherSessionsRevoked`) est retiré, côté route, écran Profil et contrat. L'UPDATE est conditionné à l'ancien hash lu (`WHERE id = $1 AND password = <ancien>`) : 0 ligne touchée = 409 « Le mot de passe a été modifié entre-temps. Reconnectez-vous. ». Le 503 « non enregistré » de `storage.updateUser` disparaît avec l'appel (une panne de base devient la 500 générique du handler, rien n'est écrit). Le `console.error` de `closeUserConnections` est migré vers `moduleLogger("websocket")`.
- **Pourquoi** : la sécurité a refusé l'état partiel (hash écrit, sessions vivantes) et la course entre deux changements concurrents (le second, vérifié sur l'ancien mot de passe, écrasait le premier).
- **Preuve rouge** (code de 906d26a, tests nouveaux) : changements concurrents (barrière sur `bcrypt.hash`) : `[200, 200]` au lieu de `[200, 409]` ; DELETE en échec : rouge (l'export `deleteOtherUserSessions` n'existait pas, l'espion ne peut pas se poser : rouge pour cette raison, pas pour la réponse).
- **Moyen de l'espion** : `vi.spyOn(userSessions, "deleteOtherUserSessions").mockRejectedValueOnce` sur l'export du module, vu par la route car elle l'importe en ESM.

## 2026-11-04 — PATCH utilisateur : révocation des sessions du compte visé
- **Quoi** : `PATCH /api/users/:id` avec `password` ou `pin` écrit la fiche et supprime les sessions du compte dans la même `db.transaction` (`deleteOtherUserSessions(tx, id, keepSid)`), puis ferme les sockets après le commit (`closeOtherUserConnections`). `keepSid` vaut `req.sessionID` si l'admin modifie son propre compte, `null` sinon (toutes les sessions partent). `deleteOtherUserSessions` et `closeOtherUserConnections` acceptent `keepSessionId: null` (appels de change-password inchangés). Sans secret dans le corps, la voie `storage.updateUser` reste telle quelle.
- **Observabilité** : `log.info({ userId, revoked, requestId, reason })` rétabli après le commit, pour change-password et pour le PATCH ; la fermeture des sockets est sous `try/catch` + `log.error` (la fiche est écrite, pas de 500).
- **Preuve** : contrats `admin-patch-user-pin` (révocation de deux sessions, admin sur lui-même, nom seul, DELETE en échec, sockets qui jettent) et `change-password-revoke-sessions` (sockets qui jettent : 200 + nouveau hash).

## 2026-11-04 — Verrouillage : refus sans écriture tant que le verrou est actif
- **Quoi** : `LockoutStore.reserve` (magasin Postgres et mémoire) renvoie un refus sans rien écrire quand le verrou est actif ; une fenêtre expirée repart de zéro. La transaction et le verrou consultatif restent pris, seule l'écriture (upsert, audit) est évitée.
- **Pourquoi** : sous attaque, chaque 429 coûtait un upsert et un verrou de ligne sur un compteur sans effet tant que le verrou dure.
- **Preuve** : contrat `login-lockout-no-write-when-locked` (50 réservations sur compte verrouillé : `xmin` et `failed_count` inchangés, un seul audit `lock`) et unitaire du magasin mémoire.

## 2026-11-05 — Commandes fournisseur : ligne cliquable, actions de statut en fonction pure
- **Quoi** : la ligne de la liste ouvre le détail ; le numéro devient un lien (`aria-label` « Voir la commande … ») pour l'accès clavier ; l'icône œil est retirée (AGENTS §5). Les actions de statut du détail passent par `orderStatusActions` (`client/src/lib/purchase-order-actions.ts`).
- **Pourquoi** : la démo magasinier (b7) cliquait le numéro, qui n'était qu'un badge, et restait sur la liste ; le bouton « Enregistrer la livraison » n'était donc jamais trouvé. Les droits étaient corrects.
- **Preuve** : unitaire en matrice `purchase-order-actions` (15 cas : rôle × statut × commande pièces) ; tsc 0 ; `tests/unit` 2331 verts.

## 2026-11-05 — Import de sauvegarde : mot de passe validé (#323)
- **Quoi** : `usersWithSafeSecrets` (ex-`usersWithSafePins`) prépare PIN et mot de passe hors transaction ; `passwordForRestore` reprend bcrypt strict et SHA-256 hérité, hache un clair conforme, remplace le reste par un hash inutilisable avec `warn` (username seul).
- **Pourquoi** : un mot de passe clair restauré était stocké en clair et le compte ne pouvait plus se connecter.
- **Preuve** : contrat `backup-import-password` (clair → 200 au login, SHA-256 → 200 puis migré, trop court → 401), rouge sur le comportement de main (2 échecs, valeur stockée en clair) ; unitaire `user-password`.

## 2026-11-05 — Fichiers téléversés : liens résolus
- **Quoi** : `uploadedFileCandidates` refuse un candidat existant dont le chemin réel (liens et jonctions résolus) sort de `uploads/` (`realPathStaysInside`). Fichier absent : la comparaison lexicale suffit. `uploads/` monté par lien reste valide.
- **Pourquoi** : risque résiduel de la revue §9 du 3 novembre ; la borne ne comparait que le chemin lexical.
- **Preuve** : unitaire `uploaded-file` (jonction sortante refusée, rouge sur main ; lien de fichier sauté avec sa raison si l'OS refuse le droit de création).

## 2026-11-05 — Justificatif de règlement fournisseur borné à son dossier
- **Quoi** : `server/lib/settlement-proof.ts` (`isSettlementProofReference`, `settlementProofPath`). `recordInvoiceSettlement` refuse en 400 toute référence qui n'est pas un fichier de `/uploads/supplier-invoices/settlements/`, endpoint legacy `/payment` compris. La route du justificatif ne sert que ce dossier : une ligne ancienne hors dossier donne 404. `settlementProofPath` est ajoutée aux bornes du scan des accès disque.
- **Pourquoi** : la référence était libre à l'écriture et la lecture n'était bornée qu'à `uploads/` en entier (dette AGENTS §9).
- **Écrivains recensés** : téléversement `POST /:id/settlements` (toujours sous le dossier) et `POST /:id/payment` legacy (libre, sans appelant client). Ni seed, ni import de sauvegarde, ni trigger n'écrit `proof_reference`.
- **Preuve** : contrat `supplier-settlement-proof-path` (écriture hors dossier 400 sans règlement créé, ligne en base hors dossier 404, téléversé 200, legacy avec justificatif du dossier 200) ; unitaire `settlement-proof`.

## 2026-11-05 — Liens résolus : chemin absent, justificatif, destinations d'écriture
- **Quoi** : `realPathStaysInside` contrôle, pour un fichier absent, le dernier élément existant du chemin : lien pendant ou lien sortant refusés. `settlementProofPath`, la copie des documents de workflow vers le dossier du véhicule et `vehicleDocumentDirectory` (multer) passent par ce contrôle en plus de la borne lexicale.
- **Pourquoi** : relecture de #337. Un fichier absent derrière un lien était accepté, et une écriture l'aurait suivi hors du dossier ; deux destinations d'écriture n'étaient bornées que lexicalement.
- **Preuve** : unitaires `uploaded-file` (lien pendant, absent derrière une jonction sortante, `uploads/` absent, racine montée par jonction via `uploadedFileCandidates`) et `settlement-proof` (jonction dans le dossier refusée).

## 2026-11-05 — Liens résolus : référence = racine possédée
- **Quoi** : la copie des documents de workflow contrôle `vehicle-<id>` contre `uploads/documents` avant tout `mkdir` (dossier refusé : rien transféré, `log.warn` sans chemin). Multer distingue id invalide (« ID de véhicule invalide ») et dossier sortant (« Dossier de destination invalide », `log.warn`).
- **Pourquoi** : relecture de #340. La référence était `vehicle-<id>` lui-même : remplacé par une jonction, il se résolvait dehors avec le candidat et le contrôle passait.
- **Preuve** : intégration `workflow-document-transfer` (jonction `vehicle-<id>` : rien copié dehors, document non transféré) et contrat `vehicle-documents-upload-path` (400 « Dossier de destination invalide »), rouges sur la version précédente, verts après.

## 2026-11-05 — Justificatifs téléversés liés à l'écriture
- **Quoi** : règlement fournisseur (`POST /:id/settlements`) et récépissé de renouvellement (`POST /requests/:id/receipt`) suppriment le fichier dans le `finally` tant qu'aucune écriture validée ne le référence (`proofRecorded`, `receiptRecorded`). Diffusion du règlement au mieux (`log.error`).
- **Pourquoi** : une diffusion qui levait rendait 500 et supprimait le justificatif d'un règlement créé ; un identifiant invalide laissait un fichier orphelin.
- **Preuve** : contrat `supplier-settlement-proof-lifecycle` (3 cas, 2 rouges sur main) ; contrats `supplier-settlement*` et `document-renewal*` verts (64) ; tsc 0 ; unitaires 2417 verts.

## 2026-11-05 — Suppressions de server/api : borne qui résout les liens
- **Quoi** : `scanFileAccesses` prend en option le jeu de bornes acceptées (`LINK_RESOLVING_BOUND_CALLS`). Garde `upload-delete-hygiene` : toute suppression (`unlink`, `rm`, `rmdir`) d'une route de `server/api` passe par `uploadedFileCandidates`, `settlementProofPath` ou `existingUploadedFile` ; `isInsideDirectory` seul est refusé. Deux exceptions gelées (multer, `req.file.path`), chacune avec sa raison et sa condition de dégel.
- **Pourquoi** : `stored-path-hygiene` accepte la borne lexicale, qu'un lien sous `uploads/` passe (AGENTS §9).
- **Preuve** : suppression bornée lexicalement injectée dans une route : la nouvelle garde échoue, `stored-path-hygiene` passe ; cas synthétiques strict et défaut ; tsc 0, unitaires verts.

## 2026-11-05 — Routes multer : garde de cycle de vie, dépôt de document véhicule
- **Quoi** : garde `multer-lifecycle-hygiene` (route de `server/api` qui lit `req.file` : drapeau + `finally`, ou exception gelée ; import Excel en mémoire gelé). Dépôt de document véhicule passé au patron, diffusion au mieux. Règlement fournisseur : `removeUploadedProof` par `settlementProofPath`, refus 401/400 en `AppError`.
- **Pourquoi** : récidive de #178 en #348 ; le dépôt de document véhicule avait le même défaut (diffusion qui lève : 500 et fichier d'un document enregistré supprimé).
- **Preuve** : contrat `vehicle-documents-upload-errors` (diffusion qui lève → 201, fichier conservé), rouge avant ; contrat `supplier-settlement-proof-lifecycle` (+ 409 facture non approuvée, aucun fichier) ; garde rouge sur l'ancien dépôt de document.

## 2026-11-05 — Justificatif de règlement : identifiants lus strictement
- **Quoi** : `GET /api/supplier-invoices/:id/settlements/:settlementId/proof` lit ses deux ids en chiffres seuls puis `assertValidDbId` (400). AGENTS.md §9 : revue des chemins stockés reprise (routes.ts, rapports, preuves de renouvellement), aucun accès non borné.
- **Pourquoi** : `parseInt("12abc")` valait 12 et servait le justificatif de la facture 12.
- **Preuve** : contrat `supplier-settlement-proof-path` (5 ids non stricts) rouge sur l'ancien code (200), vert après (15/15).
## 2026-11-05 — Gardes fichiers téléversés : mineurs de l'audit de #350
- **Quoi** : `multer-lifecycle-hygiene` parcourt `server/api` (sous-dossiers) et `server/routes.ts`, suit les handlers nommés du fichier, `upload.single()` et `const { file } = req` ; le drapeau doit suivre une écriture (`await` avant, `await` après seulement dans un `try`/`catch`) et le `finally` doit appeler une suppression. `upload-delete-hygiene` couvre tout `server/` (`deleteFile` du middleware compris ; job et stockage de sauvegarde, service workflow gelés avec raison). Dépôt de document véhicule : si la synchro du miroir puis le retrait de la ligne échouent, la ligne et son fichier restent. `ownedBy` supprimé (aucun consommateur ; garde et handler y lisaient l'id séparément).
- **Pourquoi** : réserves de la relecture et de l'audit sécurité de #350.
- **Preuve** : contrat `vehicle-documents-orphan-row-file` rouge sur l'ancien code, vert après (spies, la suite contrat tourne en `isolate: false`) ; garde multer rouge quand le drapeau du dépôt est avancé avant l'écriture ; cas synthétiques (drapeau avant ou entre deux écritures, effet au mieux, `finally` sans suppression, handler nommé, déstructuration).

## 2026-11-05 — Gardes fichiers téléversés : gel compté, drapeau après une écriture
- **Quoi** : `upload-delete-hygiene` compte les suppressions non bornées par clé gelée (`count`) ; `multer-lifecycle-hygiene` exige qu'un `await` d'écriture (`WRITE_NAME` : `insert`, `update`, `transaction`, `create…`, `record…`, `save…`) précède le drapeau, un `await` de lecture seul ne suffit plus.
- **Pourquoi** : réserves non bloquantes de la relecture de #355 (seconde suppression dans une fonction gelée, `await` quelconque avant le drapeau).
- **Preuve** : seconde `unlinkSync` injectée dans une fonction gelée → garde rouge (1 → 2) ; cas `/lecture-seule` accepté sans la règle, refusé avec ; cas `/transaction` accepté ; 11/11.

## 2026-11-05 — Coûts de mission : id strict, mission inconnue en 404
- **Quoi** : `GET /api/operations/missions/:id/costs` lit l'id par chiffres seuls puis `assertValidDbId` (400), la mission absente devient `AppError(404)` ; log du service migré vers `moduleLogger`. La cloison chauffeur (`refuseDriver`) était déjà en place et couverte.
- **Pourquoi** : `parseInt("12abc")` visait la mission 12 ; une mission absente sortait en 500.
- **Preuve** : contrat `operations-driver-scope` (cas id non strict et inconnu) rouge sur l'ancien code, vert après (10/10).
## 2026-11-05 — Justificatif de renouvellement consultable
- **Quoi** : `GET /api/document-renewals/requests/:id/proof` sert le justificatif déposé au renouvellement rapide. Rôles lecteurs des demandes (`DOCUMENT_RENEWAL_VIEWER_ROLES`), id par `parseRouteId`, cloison `canAccessOwned`, fichier servi depuis le seul dossier `uploads/document-renewals/proofs` (`uploadedFileCandidates` + `isInsideDirectory`), 404 lisible si la demande n'a pas de justificatif ou si le fichier a disparu.
- **Pourquoi** : décision produit (option A) : le justificatif était écrit sur disque mais jamais consultable.
- **Preuve** : contrat `document-renewal-proof-download` rouge sans la route (12/13), vert après (13/13) ; contrats renouvellement voisins 28/28 ; unitaires 2524, tsc 0.


## 2026-11-05 — Justificatif de renouvellement : toujours en téléchargement
- **Quoi** : `GET /api/document-renewals/requests/:id/proof` répond en `attachment` avec `nosniff`, type tiré d'une liste blanche d'extensions (sinon `application/octet-stream`), chemin résolu contrôlé contre le dossier des justificatifs. Au dépôt, l'extension stockée vient du type accepté (table commune avec le récépissé).
- **Pourquoi** : relecture de sécurité. Le type servi dépendait de l'extension du nom envoyé, que le filtre de dépôt ne contrôlait pas.
- **Preuve** : contrats `document-renewal-proof-download` et `document-quick-renew-proof-lifecycle`, nouveaux cas rouges sur la route d'origine, verts après.
## 2026-11-05 — Justificatif de règlement : identifiants lus strictement
- **Quoi** : `GET /api/supplier-invoices/:id/settlements/:settlementId/proof` lit ses deux ids en chiffres seuls puis `assertValidDbId` (400). AGENTS.md §9 : revue des chemins stockés reprise (routes.ts, rapports, preuves de renouvellement), aucun accès non borné.
- **Pourquoi** : `parseInt("12abc")` valait 12 et servait le justificatif de la facture 12.
- **Preuve** : contrat `supplier-settlement-proof-path` (5 ids non stricts) rouge sur l'ancien code (200), vert après (15/15).

## 2026-11-05 — Lecture commune des ids de route
- **Quoi** : `parseRouteId` (`server/lib/route-id.ts`) : chiffres seuls, 1 à l'int4, sinon 400. `parseMissionId`, coûts de mission et justificatif de règlement l'utilisent ; `MAX_DB_INTEGER_ID` y vit (réexporté par `work-order-scope`). Garde `route-id-parse-hygiene` : cliquet par fichier sur `parseInt(req.params` / `Number(req.params` dans `server/api` (53 occurrences gelées, 18 fichiers).
- **Pourquoi** : trois parseurs stricts écrits à la main en une journée ; `parseInt("12abc")` vise un autre objet.
- **Preuve** : unitaires 2437 verts (cas lâches 400, motif et commentaires) ; contrats `mission-id-strict`, `operations-driver-scope`, `supplier-settlement-proof-path` verts (54).

## 2026-11-05 — Justificatif de règlement fournisseur : téléchargement forcé, extension tirée du type
- **Quoi** : `GET /api/supplier-invoices/:id/settlements/:settlementId/proof` sert le fichier en `attachment` avec `nosniff`, et choisit son type d'après l'extension sur disque, en liste blanche (`settlementProofContentType`). Toute autre extension part en `application/octet-stream`. Au dépôt, l'extension vient du type déclaré (`SETTLEMENT_PROOF_EXTENSION_BY_MIME`), plus du nom d'origine. Le filtre de dépôt lit la même table.
- **Pourquoi** : même forme que le justificatif de renouvellement. Un nom d'origine en `.html` déclaré PDF était écrit en `.html`, puis servi en ligne sur l'origine de l'application.
- **Preuve** : contrat `supplier-settlement-proof-path` rouge 8/18 avant, vert 18/18 après. Avec les autres contrats de règlement : 31/31. Unitaires `settlement-proof` 41, et une mutation de la liste blanche tuée.
## 2026-11-05 — Filet des ids de route hors int4
- **Quoi** : `routeIdRangeGuard` monté en tête de `apiRouter` (`server/api/index.ts`) : segment dont l'entier de tête (après décodage, signe admis) dépasse `MAX_DB_INTEGER_ID` → `AppError(400, "Identifiant invalide.")`, pour `server/api` comme pour `routes.ts`. Inscrit dans la liste blanche du garde-fou des middlewares (sans base), retiré des attendus. Le contrat d'upload de document véhicule attend ce message pour un id hors plage (même 400).
- **Pourquoi** : un id hors plage répondait 500 après une erreur base 22003.
- **Preuve** : contrat `route-id-range-guard` rouge sans le montage (4/7 en échec), vert après ; formes lues par `parseInt` (encodée, signée, décimale, suffixée) rouges puis vertes ; avec l'upload de document 18/18 ; deux mutations du garde tuées ; garde-fou des middlewares vert.
## 2026-11-05 — Compteur de verrouillage : toutes les écritures sous le verrou de clé
- **Quoi** : `DbLockoutStore.reset` et `release` passent par `underKeyLock`, la transaction sous verrou consultatif déjà utilisée par `reserve` et `confirmFailure`. Dans `auth-login-unavailable`, l'attente fixe de 500 ms est remplacée par l'attente de l'état stable du garde ; l'import en double est retiré.
- **Pourquoi** : test instable en CI. Une réservation lue avant le DELETE du succès précédent réécrivait l'ancien compteur + 1.
- **Preuve** : intégration `login-lockout-db-store`, nouveaux cas rouges avant le correctif et verts après ; contrats du verrouillage verts sur trois passes.

## 2026-11-05 — Déverrouillage admin sous le verrou de clé
- **Quoi** : `underKeyLock` prend une ou plusieurs clés, verrouillées dans l'ordre. `unlockUser` remet à zéro le miroir `users` et supprime les compteurs de toutes ses clés dans une même transaction sous verrou. `reset` met désormais à jour son miroir dans sa transaction.
- **Pourquoi** : un déverrouillage pendant une réservation en cours pouvait être effacé par la réécriture de l'ancien compteur + 1.
- **Preuve** : intégration `login-lockout-db-store` 7/8 sur le store d'origine, 8/8 après le correctif. Contrats du verrouillage verts.

## 2026-11-05 — Documents téléversés servis en pièce jointe
- **Quoi** : `GET /api/documents/:id/download` et `GET /api/workflows/documents/:documentId` déplacés de `routes.ts` vers `server/api/uploaded-documents.routes.ts` (mêmes gardes, même cloison, mêmes messages). Envoi par `sendUploadedFile` : `uploadedFileCandidates`, pièce jointe, `nosniff`, type en liste blanche cohérent avec l'extension. `routes.ts` retiré de la liste gelée `file-serving-nosniff` ; clé de contrôle de `stored-path-hygiene` déplacée vers le helper.
- **Pourquoi** : reste ouvert de l'entrée LESSONS du justificatif de règlement fournisseur.
- **Preuve** : nouveau contrat rouge sur l'ancien code (7/8), vert après ; mutation du filtre de type tuée (4 rouges) ; contrats existants des deux routes verts, attendus `inline` passés à `attachment`.
## 2026-11-05 — Verrouillage de connexion : suite de la relecture du déverrouillage admin
- **Quoi** : `registerFailure` est retiré de `LockoutStore` et des deux stores, avec `nextLockState`, son seul usage. Les tests produisent un échec par le vrai chemin, `failLogin` (`tests/support/lockout.ts` : reserve puis confirmFailure). L'ordre des verrous de clé devient une fonction pure, `lockKeyOrder`, testée en unitaire. Le « reste ouvert » de LESSONS mentionne aussi `reserve`.
- **Pourquoi** : `registerFailure` écrivait sans verrou de clé et n'avait aucun appelant en production. Les tests s'en servaient comme raccourci, sans passer par le chemin réel. Quand on inversait le tri des clés, aucun test ne passait au rouge.
- **Preuve** : intégration du verrouillage 13/13, contrats 32/32, unitaires 2583. Si on inverse le tri dans `lockKeyOrder`, le test échoue.
## 2026-11-05 — Garde-fou : verrou de clé du compteur de verrouillage
- **Quoi** : le test `tests/unit/server/lockout-key-lock-hygiene.test.ts` vérifie deux choses. La clé `fleet-lockout:` n'est verrouillée qu'à un seul endroit de `server/`, dans `underKeyLock`. Et seul le store écrit `login_attempts_by_username`, à une exception près, nommée : la reprise M3 au démarrage.
- **Pourquoi** : les deux corrections du compteur (5 novembre) venaient d'écritures faites hors du verrou de clé. Un second endroit qui prendrait ce verrou pourrait l'appliquer dans un autre ordre, ou sur une autre forme de clé.
- **Preuve** : vert sur main. Il passe au rouge si l'on ajoute une deuxième occurrence de la clé, ou un écrivain de la table hors du store. Unitaires 2612.

## 2026-11-05 — Ids hors plage int4 dans la query et le corps
- **Quoi** : `bodyIdSchema` et `MAX_DB_INTEGER_ID` dans `shared/contracts/common.ts` ; `idSchema` borné. Les ids d'entrée de quinze routes de `server/api` passent par ces schémas. Nouveau cliquet `zod-id-range-hygiene`.
- **Pourquoi** : un id au-delà de l'int4 reçu dans la query ou le corps répondait 500. Le filet `routeIdRangeGuard` ne lit que le chemin.
- **Preuve** : contrat `id-range-query-body` rouge 12/12 sur l'ancien code, vert 15/15 après. Le cliquet passe au rouge si l'on retire une borne.

## 2026-11-05 — Suites de l'audit de #427 et de la relecture de #442
- **Quoi** : `upload.ts` n'accepte qu'un type MIME déclaré en propre (`Object.hasOwn`). `sendUploadedFile` classe l'échec d'envoi : interruption client (info, sans réponse), introuvable (404), autre (500). Contrat `uploaded-documents-download-headers` : id inconnu, chemin stocké hors de `uploads/`, fichier absent. `partId` du catalogue de pannes et plein de la clé d'anomalie carburant bornés à l'int4. Cliquet `zod-id-range-hygiene` étendu à `shared/schema.ts`, borne exigée `MAX_DB_INTEGER_ID`.
- **Pourquoi** : `constructor` comme type MIME remontait au prototype. Un fichier disparu entre le contrôle et l'envoi répondait 500, et une interruption côté client était journalisée en erreur. Deux ids hors plage répondaient encore 500.
- **Preuve** : unitaires rouges sur l'ancien `upload.ts` (2 cas) ; contrats `fault-catalog-lifecycle` et `fuel-anomalies` rouges en 500 sur l'ancien schéma, verts après.
## 2026-11-05 — Budget de mission (L1, drapeau finance)
- **Quoi** :
  - table `mission_budgets`, une par mission (`shared/schema.ts`, `MISSION_BUDGETS_SQL` et la migration jumelle `20261105_mission_budgets.sql`), avec les colonnes d'audit et `treasury_entry_id` nullable, sans effet avant T1 ;
  - contrat `shared/contracts/mission-budgets.ts` ;
  - routeur `server/api/mission-budgets.routes.ts`, derrière `requireFeature("finance")` :
    - saisie : logistique et administrateur ;
    - approbation et décaissement : direction et administrateur ;
    - lecture : les trois ;
    - besoin du jour : `GET /api/mission-budgets/daily-need?date=`, somme en base, au total et par statut.
- **Comment** :
  - le prix du litre est celui de la date du budget (`getFuelPriceAt`), figé à la saisie ;
  - `computeMissionBudget` calcule en centimes entiers ;
  - le client n'écrit ni le prix, ni les montants calculés, ni le statut (schéma `.strict()`) ;
  - une transition est un UPDATE conditionnel sur le statut attendu : un rejeu reçoit 409, sans double écriture ;
  - l'unicité de la mission est tenue par une contrainte, avec 409 en cas de conflit.
- **Pourquoi** : lot L1 du plan trésorerie et opérations. Le FDR est saisi librement ; le barème par destination fera l'objet d'un lot séparé (L1b).
- **Preuve** :
  - contrat `mission-budgets` rouge sur l'ancien code (8/10), vert après (10/10) ;
  - unitaires de calcul et de saisie (7) ;
  - test de dérive entre init-database, la migration et Drizzle (4) ;
  - `tsc` : 0 erreur.

## 2026-11-05 — Budget de mission (L1) : suites de la relecture et de l'audit de sécurité
- **Quoi** :
  - approbation et décaissement liés à la version lue : corps strict `{ expectedUpdatedAt }`, 409 si le budget a changé ;
  - prix carburant exigé à la date du budget : 409 sans prix, plus de prix par défaut sur ce flux (`findFuelPriceAt`) ;
  - date du budget bornée à 60 jours autour d'aujourd'hui (400) ;
  - mission terminée ou annulée : 409 à la saisie ;
  - correction : des notes seules ne re-figent pas le prix ; un corps sans changement n'écrit rien ; `log.info` sur toute correction écrite ;
  - contraintes `mission_budgets_status_check`, `_amounts_check` et `_mission_id_unique` réconciliées au démarrage (NOT VALID puis VALIDATE, renommage d'une unicité posée sous un autre nom) et relues par `reportCdcConstraintGaps`.
- **Comment** :
  - transition : UPDATE conditionnel sur le statut et sur `date_trunc('milliseconds', updated_at)` ;
  - le relevé des contraintes est déplacé après `MISSION_BUDGETS_SQL`, pour ne pas signaler au premier démarrage une table pas encore créée.
- **Pourquoi** :
  - sans version lue, la direction pouvait approuver un montant corrigé entre sa lecture et son clic ;
  - un prix par défaut silencieux faussait un montant décaissé.
- **Décision utilisatrice** : aucune contrainte « 4 yeux » entre saisie, approbation et décaissement. La traçabilité `createdBy` / `approvedBy` / `disbursedBy` suffit.
- **Preuve** :
  - contrat `mission-budgets` 15/15 (version périmée, course de deux décaissements, chauffeur 403, logistique au décaissement 403, date hors fenêtre, prix absent, mission close, correction sans écriture) ;
  - test des noms de contraintes Drizzle / SQL / `CDC_RECONCILED_CONSTRAINTS` ;
  - `tsc` : 0 erreur.

## 2026-11-05 — Lot Q1 : contrôles inopinés QHSE (serveur)
- **Quoi** : tables `qhse_inspection_criteria` et `qhse_inspections` (schéma Drizzle, `init-database.ts` idempotent, migration jumelle, CHECK de nature et de forme jsonb). Seize critères semés, tous tirés du document QHSE (10 cabine, 6 arrêt). Routeur `server/api/qhse-inspections.routes.ts` derrière le drapeau `qhse` : critères (lecture admin, management, logistics ; écriture admin, management), contrôles (saisie et lecture admin, management, logistics ; le chauffeur lit les siens, 403 identique pour l'absent et l'interdit). Rôles dans `shared/constants/roles.ts`.
- **Pourquoi** : le suivi des contrôles inopinés se faisait hors système. Chaque ligne garde code et libellé du critère à la saisie, pour qu'un renommage ne réécrive pas l'historique.
- **Preuve** : unitaires de validation et de dérive migration/init-database ; contrat 3/3 (drapeau coupé, rôles, cloison chauffeur, validation, second démarrage sans écriture) sur Postgres local sous verrou ; tsc 0 erreur ; unitaires 2723 verts, hors backup-db (script shell, échec propre à ce poste).
- **Reste en TypeScript** : l'égalité entre la nature du critère et la grille du contrôle (critères dans un jsonb) ; à confier à fleet-db si l'on passe à une table de lignes.

## 2026-11-05 — Budget de mission (L1) : suites de la contre-relecture
- **Quoi** :
  - mission terminée ou annulée : correction, approbation et décaissement refusés en 409, comme la saisie ;
  - libellé du relevé des contraintes rendu générique (« Contraintes de base incomplètes ») ;
  - fusion de `origin/main` (Q1 #462, #458, F1 #464) : `CDC_RECONCILED_CONSTRAINTS` garde F1, `qhse_*` et `mission_budgets_*`.
- **Comment** :
  - la mission est verrouillée `FOR SHARE` dans la transaction qui écrit le budget (saisie, correction, transition), avant le verrou du budget ;
  - même ordre de verrous partout (mission, puis budget) : une correction et une approbation simultanées ne s'interbloquent pas.
- **Pourquoi** : on pouvait encore décaisser le budget d'une mission annulée ; une annulation concurrente attend désormais l'écriture du budget, ou la précède et la fait refuser.
- **Preuve** : contrat `mission-budgets` 16/16, dont « mission close après la saisie » (correction, approbation, décaissement 409, budget intact) ; `tsc` : 0 erreur.

## 2026-11-05 — Budget de mission (L1b) : barème par destination
- **Quoi** :
  - table `mission_destinations` (code, libellé, litres, FDR, active) : liste fermée, semée avec les cinq destinations relevées ;
  - `GET /api/mission-budgets/destinations` : destinations actives, mêmes rôles de lecture que les budgets ;
  - saisie : `destinationId` facultatif ; il pré-remplit litres et FDR absents du corps, une valeur saisie l'emporte ; sans destination, litres et FDR restent requis ;
  - destination retirée ou inconnue : 400 ; correction : changer ou retirer la destination ne réécrit pas les montants.
- **Comment** :
  - migration jumelle de `MISSION_DESTINATIONS_SQL`, appliquée après `MISSION_BUDGETS_SQL` et avant le relevé des contraintes ;
  - `mission_destinations_amounts_check` (NOT VALID puis VALIDATE) et `mission_destinations_code_unique` réconciliées avant le seed, qui en dépend (`ON CONFLICT (code) DO NOTHING`) ;
  - le pré-remplissage se fait dans la transaction de saisie, après le verrou de la mission ;
  - `tests/support/cleanup.ts` supprime les destinations écrites par un compte de test, après avoir détaché les budgets qui les visent.
- **Pourquoi** : choix à la main dans une liste fermée, sans rapprochement automatique avec l'adresse de la mission ; le seed ne réécrit jamais une valeur corrigée depuis.
- **Preuve** : contrat `mission-budgets` 20/20 (liste par rôle, retirée absente, pré-remplissage, valeur saisie prioritaire, 400, correction) ; unitaires du schéma et du contrat 22/22 ; `tsc` : 0 erreur.

## 2026-11-05 — Budget de mission (L1b) : suites de la relecture

- **Quoi** : trois réserves de la relecture levées.
  - la clé étrangère `destination_id` ne bloque plus le démarrage sur une base qui contient des valeurs orphelines ;
  - la destination est lue dans la transaction de saisie ;
  - les destinations du test de contrat sont rattrapées par le ménage.
- **Comment** :
  - `mission_budgets_destination_id_mission_destinations_id_fk` est posée NOT VALID, puis validée ; une `foreign_key_violation` laisse un WARNING. Le modèle est `document_renewal_requests_receipt_uploaded_by_users_id_fk`. La contrainte est ajoutée à `CDC_RECONCILED_CONSTRAINTS` et au test de dérive ;
  - `activeDestination(tx, id)` lit en `FOR SHARE` : un retrait concurrent de la destination attend la fin de la saisie ;
  - les destinations du test portent `createdBy` d'un compte de test.
- **Pourquoi** : une clé étrangère posée sans repli fait échouer `init-database` dès qu'une seule valeur orpheline existe.
- **Preuve** :
  - migration jouée deux fois sur la base locale sans erreur, et contrainte validée ;
  - avec un budget orphelin, dans une transaction annulée ensuite, la contrainte reste NOT VALID et le démarrage n'est pas bloqué ;
  - `tsc` : 0 erreur ; unitaires 2860 ; contrat `mission-budgets` 20/20 ; ménage des clés étrangères 3/3.

## 2026-11-05 — Budget de mission (L1c) : décaissement au journal de trésorerie

- **Quoi** : un décaissement avec un compte de trésorerie écrit deux sorties au journal, liées à la mission : FDR + frais annexes, et carburant. Le budget retient la ligne FDR (`treasury_entry_id`).
- **Comment** :
  - `treasuryAccountId` est facultatif au décaissement, selon la règle T3 des règlements. Sans compte, seul le marquage est fait. Si le drapeau finance est coupé : 409. Compte inconnu : 404. Compte désactivé : 409. Carte carburant : 400 ;
  - `linkMissionBudgetDisbursement` (`treasury-links.ts`) s'exécute dans la transaction de la transition, après l'UPDATE conditionnel. Les clés sont `mission-budget:<id>:fdr` et `:carburant`, écrites par `insertLinked` : un rejeu n'écrit rien. Une ligne à montant nul est omise ;
  - la FK `mission_budgets_treasury_entry_id_treasury_entries_id_fk` est posée NOT VALID puis validée, avec un WARNING en repli. Migration `20261105_mission_budgets_treasury.sql`, jumelle de `MISSION_BUDGETS_TREASURY_SQL`. Elle est listée dans `CDC_RECONCILED_CONSTRAINTS` ;
  - `cleanup.ts` détache `treasury_entry_id` avant de supprimer des écritures.
- **Pourquoi** : l'argent remis pour une mission doit apparaître au journal de trésorerie, sur le compte d'où il sort.
- **Suites connues** :
  - **mission annulée (décision 0a, lot L1d)** :
    - avant décaissement, l'annulation se fait sans mouvement ;
    - après décaissement, le reliquat (décaissé − justifié) est contre-passé vers le compte source, par des clés `:reverse` sur le modèle de `reverseFuelLink` ;
    - le service est appelé dans la transaction de l'annulation ;
    - justifié = 0 tant que le lot justificatifs n'existe pas ;
  - écran : choix du compte au décaissement.
- **Preuve** : `tsc` : 0 erreur ; unitaires 2865 (2 ignorés) ; contrats complets 2508/2508, dont `mission-budgets` et trésorerie 53/53 ; intégration 351/352. Le seul échec, `lot-recette-schema-idempotence`, compare des compteurs `pg_stat` globaux sur des tables partagées ; rejoué seul avec le code L1c, il passe (2/2) : le second démarrage n'écrit rien.

## 2026-11-05 — Budget de mission (L1c) : suites de la relecture

- **Quoi** : quatre réserves de la relecture levées avant fusion, plus la lecture par le secrétariat.
  - le décaissement a ses propres rôles, et qui décaisse lit le budget ;
  - le compte source est obligatoire quand la finance est active ;
  - les migrations L1b et L1c bornent leur attente de verrou ;
  - la règle de solde est écrite.
- **Comment** :
  - `MISSION_BUDGET_DISBURSE_ROLES` = admin, secrétariat, logistique (`shared/constants/roles.ts`), mêmes rôles que `FUEL_RECHARGE_SOURCE_ROLES` mais déclarés à part. `POST /api/mission-budgets/:id/disburse` passe de `MISSION_BUDGET_APPROVE_ROLES` à cette liste. L'approbation reste admin et direction ;
  - `MISSION_BUDGET_READ_ROLES` gagne le secrétariat : la lecture (liste, détail, besoin du jour, destinations) couvre exactement saisie ∪ approbation ∪ décaissement, ce que fige un test unitaire ;
  - `linkMissionBudgetDisbursement` : finance active et aucun compte, 400 « Choisissez le compte de trésorerie… ». L'erreur est levée dans la transaction : le budget reste approuvé. Finance coupée : comportement inchangé (sans compte, simple marquage ; compte demandé, 409) ;
  - `SET LOCAL lock_timeout = '5s';` après le verrou consultatif, dans `20261105_mission_destinations.sql`, `20261105_mission_budgets_treasury.sql` et leurs jumelles `MISSION_DESTINATIONS_SQL`, `MISSION_BUDGETS_TREASURY_SQL`. C'est la forme de `DOCUMENT_RENEWAL_RECEIPT_SQL` ; même effet que `set_config('lock_timeout','5s',true)`.
- **Pourquoi** :
  - la direction, qui approuve, écrivait au journal sans être dans `TREASURY_WRITE_ROLES`, et ceux qui tiennent la caisse étaient refusés. Qui approuve ne décaisse pas ;
  - sans compte, un décaissement ne laissait aucune trace au journal, donc rien à contre-passer à l'annulation (L1d) ;
  - un démarrage ne doit pas rester bloqué derrière une transaction longue sur `mission_budgets`.
- **Règle de solde** : solde négatif autorisé, comme T2/T3. Un décaissement n'est pas refusé parce que le compte source passerait sous zéro. Aucun événement de trésorerie n'est émis pour ce lot : accepté par 0a.
- **Preuve** :
  - contrat `mission-budgets` : au décaissement, direction, technicien, chauffeur et client 403 ; secrétariat et logistique 200 ; sans compte (absent ou `null`) 400, budget resté approuvé, journal vide. En lecture, secrétariat 200 (liste, besoin du jour, détail après décaissement) ;
  - tests unitaires : `lock_timeout` présent dans les SQL L1b et L1c ; lecture = saisie ∪ approbation ∪ décaissement ; seul l'administrateur approuve et décaisse ;
  - `tsc` : 0 erreur ; unitaires 2880 ; contrats complets 2531/2531 ; intégration 352/352 ; contrats `mission-budgets`, trésorerie et moyens de paiement 71/71 après l'ajout de la lecture.

## 2026-11-05 — Budget de mission (L1d) : contre-passation à l'annulation de la mission

- **Quoi** : une mission annulée après décaissement rend au compte source le reliquat de chaque ligne décaissée. Une mission annulée avant décaissement ne produit aucun mouvement.
- **Comment** :
  - `reverseMissionBudgetDisbursements(tx, budgetIds, userId)` (`treasury-links.ts`) relit les sorties `mission-budget:<id>:fdr` et `:carburant`. Pour chacune, elle écrit une entrée `in` du même compte, de la même catégorie et liée à la même mission, de clé `<clé>:reverse`, via `insertLinked`. Un rejeu n'écrit rien. Elle suit le modèle de `reverseFuelLink` : elle est indépendante du drapeau finance, car une sortie déjà écrite se contre-passe toujours ;
  - montant = décaissé − justifié. Justifié vaut 0 tant que le lot des justificatifs n'existe pas ; un reliquat nul n'écrit rien ;
  - `onMissionStatusChange(tx, missionId, nextStatus, userId)` (`mission-budgets-service.ts`) n'agit que sur `cancelled`. Elle vise les budgets `disbursed` de la mission ;
  - `missions.routes.ts` (gelé) reçoit un seul appel, après l'UPDATE de la mission, dans la transaction de `PUT /api/missions/:id/status`. Aucune logique n'y est ajoutée ;
  - le budget reste `disbursed`, figé avec sa mission (`lockOpenMission`).
- **Pourquoi** : décision 0a, faute d'arbitrage de la cliente. L'argent remis pour une mission qui n'a pas lieu revient au compte d'où il est sorti, et le journal le montre.
- **Rétroactif** : un budget décaissé avant L1c n'a aucune ligne au journal. Son annulation n'écrit rien.
- **Suites connues** : quand les justificatifs existeront, `justified` lira leur somme ; aucun événement trésorerie dans ce lot, comme L1c.
- **Preuve** :
  - contrat `mission-budgets`, 3 cas L1d :
    - après décaissement par la logistique, 4 lignes : chaque `:reverse` est `in`, de même montant, compte, catégorie et mission ; le rejeu de l'annulation et du service n'ajoute rien ;
    - avant décaissement, et budget décaissé avant L1c : aucun mouvement ;
    - les autres statuts ne contre-passent rien ;
  - `tsc` 0 ; contrats `mission-budgets`, trésorerie, moyens de paiement et missions 76/76.

## 2026-11-05 — Budget de mission (L1d) : réserves de relecture levées

- **Quoi** : clôture et annulation concurrentes ne passent plus toutes les deux ; un rejeu ne réécrit ni la date d'annulation ni le journal applicatif.
- **Comment** :
  - `PUT /api/missions/:id/status` : UPDATE conditionné au statut lu, 409 sur 0 ligne, avant `onMissionStatusChange`. `cancelledAt` et `completedAt` ne sont écrits qu'au premier passage. Le fichier gelé ne reçoit que ces deux lignes ;
  - `insertLinked` renvoie vrai si la ligne est écrite. `reverseMissionBudgetDisbursements` compte les lignes écrites, donc 0 sur un rejeu ;
  - la docstring « Besoin du jour » est remise au-dessus de `dailyNeed`.
- **Pourquoi** : relecture sécurité de #491. Statut lu hors verrou et effet argent sur la transition, voir `docs/analysis/LESSONS_LEARNED.md` (near miss du 2026-11-05).
- **Preuve** : 3 contrats de plus :
  - cas déterministe 409, rouge sans le correctif ;
  - `Promise.all` clôture + annulation ;
  - drapeau finance coupé après un décaissement au journal : contre-passation quand même.
  - Le rejeu de l'annulation garde `cancelledAt` ; `mission-budgets` 34/34.

## 2026-11-05 — Budget de mission (L1e) : dépenses justifiées

- **Quoi** : sur un budget décaissé, la logistique, le secrétariat et l'administrateur saisissent les dépenses justifiées, ligne FDR et frais annexes ou ligne carburant. L'annulation de la mission ne rend plus au compte source que le reliquat.
- **Comment** :
  - table `mission_budget_expenses` : montant entier en XAF, libellé, date au jour de Douala, auteurs et horodatages. Migration `20261106_mission_budget_expenses.sql` et sa jumelle dans `init-database.ts`. Les deux CHECK sont réconciliés et relus au démarrage ;
  - `GET`, `POST` et `DELETE /api/mission-budgets/:id/expenses`, sous le drapeau finance :
    - lecture par les rôles qui lisent le budget ;
    - saisie et suppression par ceux qui décaissent ;
  - suppression douce (`deleted_at`, `deleted_by`), rejouable. Les sommes ignorent les lignes supprimées ;
  - même ordre de verrous que les transitions : mission `FOR SHARE`, puis budget `FOR UPDATE` pendant le contrôle de somme ;
  - 409 dans quatre cas :
    - mission annulée ou terminée ;
    - reliquat déjà contre-passé ;
    - budget non décaissé ;
    - somme d'une ligne au-delà de son décaissé ;
  - `reverseMissionBudgetDisbursements` lit la somme justifiée de chaque ligne. Une ligne entièrement justifiée n'écrit aucune contre-passation.
- **Pourquoi** : lot L1e validé par l'orchestrateur. Une dépense est une trace financière : elle ne s'efface jamais.
- **Limites connues** : un dépassement (avance complémentaire) relève d'un lot ultérieur ; il est refusé aujourd'hui. Pas encore d'écran ni de pièce jointe.
- **Preuve** :
  - contrat `mission-budget-expenses` 11/11 :
    - rôles ;
    - corps invalides et date future ;
    - plafond par ligne ;
    - trois saisies simultanées, et une saisie qui attend le verrou d'une autre non validée ;
    - suppression douce ;
    - reliquat partiel ;
    - mission terminée, mission annulée, reliquat rendu, drapeau coupé ;
  - 9 mutants sur 9 tués (verrou du budget, mission ouverte, budget décaissé, reliquat rendu, plafond, lignes supprimées dans la somme, reliquat, suppression physique, date future) ;
  - test unitaire jumelle et Drizzle.

## 2026-11-05 — Budget de mission (L1e) : réserves de relecture levées

- **Quoi** : une dépense ne peut plus être datée avant le décaissement de son budget. Les quatre FK de `mission_budget_expenses` sont relues au démarrage.
- **Comment** :
  - 400 si la date précède le jour du décaissement, au jour de Douala. Un budget hérité, sans date de décaissement, n'a pas de borne ;
  - les FK `budget_id`, `created_by`, `updated_by` et `deleted_by` rejoignent `CDC_RECONCILED_CONSTRAINTS`. Leur absence est signalée, pas réparée : elles ne sont posées qu'à la création de la table.
- **Pourquoi** : relecture sécurité de #499 (R2, R3). R1, qui demande si une mission terminée doit encore accepter des dépenses, attend une décision métier : comportement inchangé (409).
- **Preuve** :
  - contrat `mission-budget-expenses` 13/13, dont deux cas ajoutés :
    - date du lendemain à Douala : 400, rien n'est écrit ;
    - date antérieure au décaissement : 400 ; le jour même passe ; aucune borne sans date de décaissement ;
  - le mutant qui retire cette borne est tué ;
  - test unitaire : les 4 FK sont dans la liste relue au démarrage.

## 2026-11-05 — Budget de mission (L1f-1) : panneau sur la fiche mission

- **Quoi** : onglet « Budget » de la fiche mission, visible par la logistique, la direction, le secrétariat et l'administrateur (drapeau finance). Chaque rôle n'y voit que son étape : la logistique saisit et corrige, la direction approuve, le secrétariat décaisse depuis une banque ou une caisse puis saisit les dépenses justifiées.
- **Comment** :
  - `GET /api/mission-budgets?missionId=` : filtre additif, au plus un élément ;
  - `client/src/lib/mission-budget-ui.ts` : actions par rôle et par statut, dérivées des constantes de rôles partagées avec les gardes serveur ; aucune action sur une mission terminée ou annulée ;
  - `client/src/components/missions/mission-budget-panel.tsx` : saisie (barème ou saisie libre), approbation, décaissement avec compte source (liste `/api/fuel-card/source-accounts`, déjà ouverte aux rôles qui décaissent), dépenses et suppression ;
  - trois couches : mise à jour du cache après succès, événement `mission_budget_updated` écouté par la table des satellites, invalidation de la liste et du besoin du jour ;
  - envoi par `useSingleFlightMutate`, id passé dans les variables, erreurs par `userMessageOf`.
- **Correctif** : `mission_budget_updated` partait sans portée depuis L1. `broadcastUpdate` étant fermé par défaut, l'événement n'atteignait personne. La portée est désormais les rôles qui lisent le budget. Leçon dans `docs/analysis/LESSONS_LEARNED.md`.
- **Pourquoi** : lot L1f validé par l'orchestrateur. L'ancien bloc budget de la fiche reste en place ; son retrait relève d'un lot ultérieur.
- **Preuve** :
  - contrat `mission-budgets` : filtre `missionId` (rôles, mission sans budget, id illisible) et portée de l'événement lue par `normalizeScope` ; contrats budgets et dépenses 53/53 ;
  - unitaires 2954/2954, dont `mission-budget-ui` 6/6 et le garde-fou des satellites, qui voit maintenant les appels `broadcast?.(` ;
  - e2e `26-mission-budget-panel` 2/2 sur la base locale : trame reçue par un second compte de rôle différent à chaque étape, technicien sans onglet ;
  - 3 mutants sur 3 tués (portée retirée, filtre retiré, satellite retiré) ; typage 0 erreur.

## 2026-11-05 — Budget de mission (L1f-2) : page « Besoin du jour »

- **Quoi** : écran `/finance/mission-budgets`, entrée de menu « Besoin du jour », en lecture seule, pour la logistique, la direction, le secrétariat et l'administrateur (drapeau finance). Pour une date (aujourd'hui par défaut), il affiche :
  - les totaux : budgets, carburant, FDR, frais annexes, total ;
  - le reste à décaisser (demandés + approuvés) ;
  - un compteur par statut ;
  - le détail par mission. Une ligne mène à la fiche mission, où se font les actions.
- **Comment** :
  - écran déclaré dans `client/src/config/lot-screens.ts`, rôles `MISSION_BUDGET_READ_ROLES` (ceux des routes lues) ;
  - composant `client/src/components/finance/mission-budgets-daily-need.tsx` ;
  - `GET /api/mission-budgets` : champ additif optionnel `missionOrderNumber` (jointure `missions`), pour nommer la mission sans requête par ligne ;
  - `GET /api/mission-budgets/daily-need` : inchangé ;
  - temps réel par la table des satellites posée en L1f-1 (`mission_budget_updated` invalide la liste et le besoin du jour) ;
  - couleurs des statuts partagées avec le panneau (`MISSION_BUDGET_STATUS_CLASSES`).
- **Pourquoi** : lot L1f validé par l'orchestrateur. Le secrétariat prépare les décaissements du jour sans ouvrir chaque mission.
- **Preuve** :
  - contrat `mission-budgets` 41/41, dont un cas ajouté : chaque élément de la liste porte le numéro de commande de sa mission ;
  - unitaires 2984 :
    - `toDisburseOf` exclut les budgets décaissés ;
    - garde-fous des écrans du lot (rôles écran = rôles route ; table des composants) ;
  - e2e `27-mission-budgets-daily-need` 2/2 sur la base locale :
    - totaux exacts sur une date isolée ;
    - approbation par la direction : trame reçue par le secrétariat, écran mis à jour sans rechargement ;
    - technicien sans page ni menu ;
  - 3 mutants sur 3 tués (jointure retirée, décaissés comptés, technicien ajouté à l'écran) ;
  - typage 0 erreur.

## 2026-11-05 — Lancement de mission sur le budget de mission (L1g)

- **Quoi** :
  - drapeau finance actif : les contrôles budget de `GET /api/missions/:id/launch-readiness` et de `PUT /api/missions/:id/status` (vers `in_progress`) lisent le budget de mission ;
  - seul un budget approuvé ou décaissé passe. Correspondance : carburant = montant carburant, FDR = FDR, imprévus = frais annexes ;
  - absent ou seulement demandé : motif qui dit quoi faire, une seule fois dans les motifs du PUT ;
  - drapeau coupé : ancien budget de la fiche (`workflowData.budgetPlan`), comportement inchangé.
- **Comment** :
  - règle pure `launchBudgetOf` et lecture `resolveLaunchBudget` dans `server/services/mission-launch-budget.ts`, réexportées par `mission-budgets-service` (import existant de `missions.routes.ts`) ;
  - `missions.routes.ts` (gelé) : 9 lignes modifiées en place, aucune ajoutée ;
  - fiche mission : drapeau actif, « Lancer la mission » affiche le motif et ouvre l'onglet Budget, sans l'ancienne saisie ni de repli sur l'ancien budget. Le bouton « Budgets mission » devient « Voir l'onglet Budget ». L'ancien total reste affiché, en historique ;
  - temps réel : `mission_budget_updated` invalide aussi la check-list de lancement de la mission touchée (gabarit `byId` à `:missionId`). Le garde-fou des gabarits accepte un identifiant en milieu de chemin.
- **Pourquoi** : sans ce lot, l'ancien bloc en lecture seule aurait bloqué tout lancement, car les contrôles budget sont bloquants. Décision de l'utilisatrice : un budget de mission approuvé est requis, y compris pour une mission préparée avant L1.
- **Preuve** :
  - contrat `mission-launch-budget` 11/11 : drapeau coupé ou actif × budget absent, demandé, approuvé, décaissé, plus le PUT ;
  - contrats missions 352/352 ;
  - unitaires 2987 ; typage 0 erreur ;
  - e2e `28-mission-launch-budget` 1/1 : refus lisible, onglet Budget ; la direction approuve et la logistique (second compte, autre rôle) reçoit la trame, puis sa check-list est relue sans rechargement ;
  - mutants : 7 sur 7 tués.


## 2026-11-05 21:05 — Check-list de lancement : montants du budget réservés à ses lecteurs (suivi L1g)
- **Quoi** : drapeau finance actif, `GET /api/missions/:id/launch-readiness` ne renvoie plus les montants du budget de mission à un rôle hors de `MISSION_BUDGET_READ_ROLES` (admin, logistique, direction, secrétariat). Les contrôles budget passés disent « Budget approuvé. », `budgets.*` et `fuel.requiredBudget` valent `null`, le motif de solde insuffisant ne cite plus le budget, ni dans la check-list ni au PUT de statut (ouvert au chauffeur). Les verdicts ne changent pas. Drapeau coupé : inchangé.
- **Comment** : `resolveLaunchBudget(missionId, legacy, role)` renvoie aussi `present`, qui met en forme la réponse (`hideLaunchBudgetAmounts`, fonction pure), et `fuelShortfallMotif` pour le PUT. `missions.routes.ts` (gelé) : 5 lignes modifiées en place, aucune ajoutée.
- **Pourquoi** : constat sécurité sur #515 : la route est ouverte au personnel (`isStaff`), la lecture du budget ne l'est pas.
- **Preuve** : contrat 14/14 (technicien sans montant, logistique avec, drapeau coupé inchangé ; refus du PUT relu en base : mission toujours `assigned`) ; unitaires dédiés 8/8 ; mutants 6/6 tués.
## 2026-11-05T22:19:06+01:00 — Retrait d'une pièce posée sur un OT (DELETE /api/parts-used/:id)
- **Statut** : fait
- **Quoi** : le retrait remet la pièce en stock une seule fois, refuse un OT terminé (409), un id inconnu (404) et le technicien (403).
- **Comment** : route déplacée de `server/routes.ts` vers `server/api/parts-used.routes.ts` (monté avant `registerRoutes`, garde `isStockIssuer` sur la route pour laisser `GET /api/parts-used` à routes.ts) ; service `server/services/part-used-removal.ts` : transaction, `DELETE ... RETURNING`, crédit seulement si la ligne a été supprimée par l'appel, `recordStockMovement` avec `executor = tx`. Erreurs en `AppError`, log `moduleLogger`. Événement `part_used_removed` conservé, portée par rôles écrite en clair ; compteurs gelés de `broadcast-hygiene` (routes.ts 5 vers 4) et `work-order-scope-hygiene` (personnel 3 vers 2) diminués.
- **Pourquoi** : l'ancien chemin lisait, créditait puis supprimait sans transaction, avalait l'erreur et répondait 204 dans tous les cas.
- **Comment tester (QA)** : `tests/contract/parts-used-removal-defects.contract.test.ts` (10 passés) sur Postgres local ; mutants : sans garde de statut 2 échecs, sans transaction 1 échec.
- **Reste / risques** : l'écran OT affiche encore la corbeille au technicien (403 à l'usage) et seulement hors `completed` (pas `cancelled`) : à aligner côté front.


## 2026-11-05 23:06 — Dépenses de mission après mission terminée (R1)
- **Quoi** : une mission terminée garde ses dépenses justifiées ouvertes (saisie et suppression douce) tant que le reliquat n'est pas rendu ; reliquat rendu, 409 ; mission annulée, 409 « Cette mission est annulée : ses dépenses ne changent plus. ». Saisie, correction, approbation et décaissement du budget restent fermés sur mission terminée ou annulée.
- **Comment** : `MISSION_STATUSES_WITHOUT_EXPENSES = ["cancelled"]` (contrat partagé), lu par le serveur (`lockMission` générique, même verrou FOR SHARE) et par le client (`missionBudgetActions.expenses`).
- **Pourquoi** : décision produit : dépenses autorisées après la fin de la mission jusqu'au retour du reliquat, jamais si la mission est annulée.
- **Preuve** : contrats dépenses et budgets 56/56 (terminée + reliquat non rendu 201/204, plafond maintenu ; terminée + reliquat rendu 409 ; annulée sans contre-passation 409) ; unitaire actions 8/8 ; mutants 5/5 tués.
- **Dette** : clôture financière d'une mission terminée. Aucun parcours ne rend encore le reliquat d'une mission terminée : ses dépenses restent ouvertes sans fin. Lot suivant décidé (Q18) : bouton « mission soldée » tenu par la comptabilité.

## 2026-11-06 01:05 — Q18 : solde d'une mission terminée
- **Statut** : fait
- **Quoi** : `POST /api/mission-budgets/:id/settle` (drapeau `finance`, `MISSION_BUDGET_SETTLE_ROLES` = administrateur, secrétariat). Mission terminée et budget décaissé : le reliquat non justifié de chaque ligne revient au compte source par contre-passation, le budget porte `settledBy` / `settledAt`, ses dépenses se figent (409). Rejeu : 200 sans écriture. Fiche mission : bouton « Solder », badge « Soldé le … », soldes de trésorerie relus.
- **Comment** : `settleMissionBudget` en une transaction, mission `FOR SHARE` puis budget `FOR UPDATE` ; `reverseMissionBudgetDisbursements` reçoit le motif (`mission annulée` par défaut, `mission soldée`) écrit dans le libellé. Colonnes nullables `settled_by` (FK `users`, posée `NOT VALID` puis validée) et `settled_at` : migration `20261106_mission_budget_settlement.sql` et jumelle `MISSION_BUDGET_SETTLEMENT_SQL` dans `init-database.ts`. `lockBudgetForExpenses` refuse un budget soldé.
- **Pourquoi** : une mission terminée gardait son reliquat hors caisse sans moyen de le rendre (R1 laissait les dépenses ouvertes après la fin, sans clôture). Un reliquat nul n'écrit rien au journal : le gel repose donc sur `settledAt`, pas sur la présence d'une contre-passation.
- **Comment tester (QA)** : `npm run test:contract -- tests/contract/mission-budget-expenses.contract.test.ts` (parcours au FCFA avec dépenses après la fin, reliquat nul, deux soldes simultanés, rôles, 409/404/400, drapeau coupé) ; unitaires `mission-budgets-schema`, `mission-budget-ui`.
- **Reste / risques** : pas d'événement temps réel propre à la trésorerie : un autre écran de trésorerie ouvert se met à jour à sa prochaine lecture.
## 2026-11-05 23:41 — Montants du budget de mission réservés à leurs lecteurs, routes /api/missions (Q19)
- **Statut** : fait
- **Quoi** : technicien, chauffeur et client ne reçoivent plus aucun montant du budget d'une mission, drapeau `finance` actif comme coupé : `estimatedFuelCost`, ancien budget `workflowData.budgetPlan`, budget de mission, totaux carburant (`estimatedBudget`, `budgetDelta`), suggestion de budget, solde de la carte carburant. Verdicts de la check-list conservés (« Budget approuvé. », « Budget renseigné. », « Solde suffisant. »). Motif de refus du PUT de statut sans montant.
- **Comment** : `server/lib/mission-budget-scope.ts` (`redactMissionBudget` : clés à null ; `omitMissionBudget` : clés retirées pour la trame WS). `mission-launch-budget.ts` : présentateur à deux droits (budget : `MISSION_BUDGET_READ_ROLES`, solde : `TREASURY_FUEL_CARD_READ_ROLES`). `missions.routes.ts` (gelé) : 10 lignes modifiées en place, aucune ajoutée. Client : `mergeMissionPatch` garde le budget en cache d'un lecteur quand la trame n'en porte pas, puis relecture détail et liste ; fiche mission affiche « — » au lieu de « Non renseigné » ou 0.
- **Pourquoi** : les routes renvoyaient la ligne entière de `missions` ; le budget était lisible par tout le personnel.
- **Comment tester (QA)** : `tests/contract/mission-budget-amounts-scope.contract.test.ts` (sentinelles sur `JSON.stringify(body)`, deux drapeaux, trame WS) ; `mission-launch-budget.contract.test.ts` ; unitaires `mission-budget-scope`, `mission-budget-realtime`, `mission-launch-budget`. Mutants 6/6 tués.
- **Reste / risques** : `/api/operations/*` renvoyait encore la ligne entière ; corrigé dans l'entrée suivante.

## 2026-11-06 00:17 — Q19 : /api/operations/* masque aussi le budget, garde sur les lectures entières de missions
- **Statut** : fait
- **Quoi** : `GET /api/operations/missions`, `/missions/upcoming`, `/missions/active`, `/missions/by-client/:clientName` et la réponse de `POST /missions/from-fuel` passent par `redactMissionBudget`. `/stats/by-client`, `/stats/by-destination` et les statistiques d'un client : `totalRevenue`, `margin` et `marginPercentage` valent `null` hors `MISSION_BUDGET_READ_ROLES` (décision 0a), les compteurs restent. Trame `mission_created_from_fuel` (tout le personnel) sans montant (`omitMissionBudget`). PDF de la fiche mission : « Total budget » affiche « — » hors lecteurs. `operations-service` : `console.*` migrés vers `moduleLogger`.
- **Comment** : `mission-budget-scope.ts` traite un objet qui porte `totalRevenue` comme une statistique d'opérations. Nouveau module `server/lib/mission-response-scope.ts` qui réexporte les helpers prix et budget : la ligne d'import 65 de `missions.routes.ts` (gelé) importe ce seul module, aucune ligne ajoutée. Garde `tests/unit/server/mission-select-hygiene.test.ts` : liste gelée des 13 lectures entières de `missions` côté serveur, chacune justifiée ; les justifications vérifiables sont assertées (rôles de facturation inclus dans les lecteurs, export Excel sans montant du budget, routes `/api/operations` enveloppées).
- **Pourquoi** : constat sécurité sur #534 (B1) : `/api/operations/*` contournait Q19, et pour un client ou une destination à mission unique, le « chiffre d'affaires » valait le montant exact.
- **Comment tester (QA)** : `tests/contract/operations-budget-scope.contract.test.ts` (client et destination uniques, sentinelles dans `JSON.stringify(body)`, technicien et chauffeur, logistique lectrice) ; unitaires `mission-select-hygiene` et `mission-budget-scope`. Mutants 2/2 tués (route non masquée, revenus non masqués).
- **Reste / risques** : le calcul « revenu = `estimatedFuelCost` » reste faux sur le fond (c'est un budget, pas un prix) : à reprendre côté métier.

## 2026-11-06 00:47 — Q19 : réserves sécurité sur la garde des lignes entières de missions
- **Statut** : fait
- **Quoi** : la garde `mission-select-hygiene` voit aussi les écritures `insert` / `update` de `missions` suivies d'un `.returning()` sans argument (6 occurrences, toutes justifiées et gelées). Ses clés nomment le bloc englobant au lieu du rang dans le fichier. Contrat `operations-budget-scope` : sans cookie, 401 et aucun montant.
- **Comment** : `enclosingBlock` retient la déclaration la plus proche en amont (route `router.<verbe>("chemin"`, méthode de classe, fonction ou constante de premier niveau) ; deux occurrences du même bloc prennent un rang local. `returnsWholeRow` lit l'instruction jusqu'au `;` suivant.
- **Pourquoi** : relecture sécurité de #534 : une ligne renvoyée par `returning()` porte `estimatedFuelCost` et `workflowData` comme une lecture entière ; une clé `fichier#n` laissait passer l'échange d'une lecture justifiée contre une nouvelle.
- **Comment tester (QA)** : `npx vitest run tests/unit/server/mission-select-hygiene.test.ts` (6/6, dont détecteur sur cas synthétiques : écriture, projection, bloc, échange) ; `npm run test:contract -- tests/contract/operations-budget-scope.contract.test.ts` (7/7). Mutant : `.returning()` ajouté à `PUT /:id/agreed-price` fait échouer la garde.
- **Reste / risques** : détection textuelle ; un `returning()` construit dynamiquement ou une instruction contenant un `;` dans une chaîne lui échapperait.
## 2026-11-05T23:45:00+01:00 — Approbation d'une facture fournisseur (PATCH /api/supplier-invoices/:id/approve)
- **Statut** : fait
- **Quoi** : l'approbation n'accepte que `received` et `validated`. Facture inconnue : 404 ; déjà approuvée : 200 sans écriture (approbateur et date conservés) ; payée : 409 ; en litige : 409 « Lever le litige avant d'approuver » ; autre statut : 409.
- **Comment** : `approveInvoice` (three-way-matching-service) fait `UPDATE ... WHERE id AND status IN (...) RETURNING`, puis relit la facture si aucune ligne n'est écrite. `autoApproveMatches` porte la même condition (`status = 'received'`) et ne compte que les lignes réellement écrites. La route était déjà dans `server/api/supplier-invoices.routes.ts`, rôles inchangés.
- **Pourquoi** : l'UPDATE sans condition ramenait une facture payée à `approved`, écrasait l'approbateur et renvoyait 500 sur un id inconnu.
- **Comment tester (QA)** : `tests/contract/supplier-invoice-approve-status-guard.contract.test.ts` (8 cas dont deux approbations simultanées et auto-approve) ; sans le filtre de statut, 4 échecs.
- **Reste / risques** : aucun changement de contrat partagé ; événement `supplier_invoice_updated` toujours émis sur un rappel idempotent.
## 2026-11-06T00:20:00+01:00 — Validation d'une facture fournisseur, rejeu sans diffusion (suite audit de #533)
- **Statut** : fait
- **Quoi** : `PATCH /:id/validate` n'accepte que `received` (compare-and-set). Inconnue 404, déjà validée 200 sans écriture, approuvée, payée ou en litige 409. Validate puis approve ne peut plus ramener une facture payée à `approved` ni écraser l'approbateur. `validateInvoice` et `approveInvoice` renvoient `{ invoice, replayed }` ; la route n'émet pas `supplier_invoice_updated` sur un rejeu.
- **Comment** : même modèle que l'approbation (UPDATE conditionné, RETURNING, relecture). Les cas du contrat de défauts sont fusionnés dans `supplier-invoice-approve.contract.test.ts` (15 cas) avec E1 (payée), E2 (approuvée puis validate et approve), E3 (magasinier, facture de pièces payée) et le rejeu sans événement.
- **Pourquoi** : audit sécurité de #533, `validateInvoice` contournait le correctif.
- **Preuve** : mutants tués : validate sans filtre (5 échecs), approve sans filtre (7), diffusion systématique validate (1) et approve (1).
- **Hors périmètre** : `syncInvoiceFromReconciledSettlements` fait passer `disputed` à `paid`.

## 2026-11-10 — Verrou d'argent : compléments de relecture de la PR1
- **Quoi** : `deleteFuelRecordsWhere` et `deleteClientInvoicesWhere` exigent un `SQL` (un `undefined` viderait la table verrou levé) ; le ROLLBACK de `deleteFuelRecordsByVehiclesRaw` ne masque plus l'erreur d'origine (échec journalisé par `moduleLogger`, erreur d'origine relancée) ; exception de la restauration de sauvegarde écrite dans `docs/plans/v1-verrou-argent.md` (Réserves) et figée par un test d'hygiène sur les imports de `server/**` ; décompte corrigé dans le fragment de journal de la PR1 (43 DELETE migrés plus 2 en recette).
- **Preuve** : `money-override-hygiene.test.ts` 6/6 ; `tsc --noEmit` 0 erreur.

## 2026-11-10 — Verrou d'argent PR2 : pleins (service)
- **Quoi** : plein validé immuable (409 sur PATCH et DELETE), `POST /api/fuel-records/:id/cancel`, colonne `cancellation_reason`, écrans, `withMoneyOverride` dans la restauration de sauvegarde.
- **Comment** : voir `docs/qa/journal/` du même jour ; « budget soldé » = `mission_budgets.settled_at IS NOT NULL`.
- **Preuve** : unitaires 9/9 (rouge d'abord), tsc 0 erreur ; contrat et intégration laissés à la CI (le `.env` racine pointe la production).

## 2026-11-10 — GPS V1 téléphone : API (ingestion, lecture, points A/B, purge)
- **Quoi** : `POST /api/driver/missions/:id/positions` (paquets de 50 au plus, rôle `driver`, affectation vivante), `GET|POST /api/driver/positions` (format OsmAnd / Traccar Client, mission en route du chauffeur), `GET /api/vehicle-positions[/:vehicleId]` (admin, logistics, management, workshop_manager), `GET /api/missions/:id/track` (admin, logistics, management + chauffeur de la mission ; le chef d'atelier n'a pas la trace), `PATCH /api/missions/:id/geo` (admin, logistics), points A/B validés à la création de mission (`POST /api/missions`), purge quotidienne `purge_vehicle_positions` branchée sur `server/scheduler.ts`. Tout derrière le drapeau `gps`.
- **Comment** : bibliothèque pure `server/lib/gps-points.ts` (classement futur / trop ancien / hors fenêtre, points suspects à plus de 200 km/h, lecture OsmAnd, hubs), service `vehicle-positions-service.ts` (INSERT multi-lignes `ON CONFLICT ON CONSTRAINT vehicle_positions_client_point_unique DO NOTHING`, 23514 traduit en `AppError` 400 par nom de contrainte), diffusion `vehicle_position_updated` limitée à une par véhicule et par 30 s. Contrat `realtime-events` : `missionId` ajouté en champ optionnel. Hub inconnu ou demi-point : 400 ; les coordonnées du hub l'emportent sur celles envoyées.
- **Choix reuse-first (Traccar)** : Adapt. Protocole lu dans la documentation Traccar (OsmAnd : `id, lat, lon, timestamp, speed` en nœuds, `bearing, accuracy` ; Traccar Client JSON : `location.coords`, vitesse en m/s, `-1` = inconnu). Le décodeur est réécrit en TypeScript (une trentaine de lignes) plutôt qu'adopté : Traccar est un serveur Java complet, inutile pour accepter un relevé. L'identifiant `id` de l'appareil n'identifie personne, l'identité vient de la session ; l'identifiant de point est dérivé (sha256) pour que le rejeu ne duplique pas.
- **Pourquoi** : décision du 2026-11-10 (chauffeurs informés, pas de consentement) ; Nominatim et OSRM publics exclus.
- **Limite** : Traccar Client ne sait pas s'authentifier par cookie de session. Le format est lu, mais l'appareil réel exigera un jeton d'appareil (à décider avec le lot balises).
- **Preuve** : voir la PR (tsc, unitaires, contrat 13 cas sur Postgres local).

## 2026-11-10 — GPS V1 téléphone : correctifs d'audit sécurité de #660

- **Quoi** : B1 (CSRF) : `GET /api/driver/positions` supprimé, POST en `application/json` seulement (415), `parseOsmandReport` ne lit plus la requête. B2 (mission à plusieurs affectations) : la trace d'un chauffeur est filtrée sur ses `driver_id`, le point précédent de la détection de saut sur le véhicule, chaque point de trace porte `vehicleId`. Mineurs : horodatage hors bornes (`null`, plus de 500), relevé OsmAnd passé dans `gpsPointSchema` (précision et vitesse ramenées à la borne), cap arrondi au dixième et ramené à 0 si 360 (float4), purge sans consulter le drapeau, `z.number().finite()` sur /geo, champs géo de `POST /api/missions` ignorés drapeau coupé, plafond de 50 000 points par chauffeur et par mission (429).
- **Comment** : voir `server/api/driver-positions.routes.ts`, `server/services/vehicle-positions-service.ts`, `server/lib/gps-points.ts`. Prévention : `tests/unit/server/get-no-write-hygiene.test.ts` (liste gelée vide), règle `AGENTS.md` §10, entrée `LESSONS_LEARNED.md`.
- **Pourquoi** : cookie `SameSite=None` sans jeton CSRF ; une trace ne doit pas fuir d'un chauffeur à l'autre sur un relais.
- **Dette** : le plafond est un compte par paquet (une requête de plus) ; un débit par seconde (limiteur) n'est pas posé. GET et formulaire reviendront avec le jeton d'appareil (lot balises).

## 2026-11-10 — GPS V1 téléphone : réserves de relecture de #660

- **Quoi** : compteur `viewer-read-only` (apiRouter 148, total 182 : trois écritures POST/POST/PATCH ajoutées par ce lot). Index `(mission_id, driver_id)` sur `vehicle_positions` (schéma, migration `20261110_vehicle_positions_mission_driver_idx.sql`, jumelle `VEHICLE_POSITIONS_MISSION_DRIVER_IDX_SQL` appelée après `reportCdcConstraintGaps`). Plafond : ne compte que les points nouveaux (doublons du paquet écartés, puis ceux déjà en base) ; un rejeu près du plafond répond « doublons ». `PATCH /geo` émet `mission_updated`. `vehicle_position_updated` invalide aussi `/api/missions/:id/track`. Dernière position : `LATERAL ... LIMIT 1` par véhicule au lieu de `DISTINCT ON` sur toute la table. Mission annulée : points relevés avant `cancelledAt` + 2 min acceptés (l'annulation passe les affectations à `cancelled`, hors périmètre vivant), au-delà rejetés ; chauffeur retiré d'une mission qui continue : toujours 403.
- **Comment** : `server/services/vehicle-positions-service.ts` (`routeOfDriverMission`, `ingestDriverPositions`, `lastVehiclePositions`), `server/api/mission-track.routes.ts` (`emitMissionEvent`), `shared/contracts/realtime-events.ts` (champ additif). Clé de trace déclarée « en attente d'écran » dans `realtime-invalidation-keys.test.ts`. Le décompte n'est lancé que s'il y a au moins un point nouveau.
- **Pourquoi** : revue 0a. Un rejeu hors ligne ne doit jamais être puni par le plafond ; le trajet d'une mission annulée a eu lieu et doit rester tracé ; les compteurs d'écritures sont un cliquet volontaire.
- **Prévention** : leçon de la relecture, rejouer toutes les suites de contrat touchées par un nouveau montage (viewer-read-only, cdc-mounts, api-auth-guard), pas seulement la sienne.
