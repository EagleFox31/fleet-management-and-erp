# Journal — fleet-db (base de données, lots suivants)

Règles : `docs/journal/README.md`.

## 2026-11-02T14:11:16+01:00 — FUEL3 — Capacité des réservoirs du véhicule

- **Agent** : fleet-db · **Branche** : `lot/db/fuel3-capacite` · **Commit** : voir `git log`
- **Statut** : fait (partie base ; règles, route PATCH et écran restent à fleet-api et fleet-fe)
- **Quoi** : colonne `vehicles.tank_capacity_l` (real, nullable) et contrainte `vehicles_tank_capacity_l_positive` (> 0 et fini) ; champ `tankCapacityL` dans `insertVehicleSchema` (facultatif, 1 à 2 000 L) et schéma réutilisable `vehicleTankCapacitySchema`.
- **Comment** : `VEHICLE_TANK_CAPACITY_SQL` dans `server/init-database.ts`, jumelle de `server/db/migrations/20261102_vehicles_tank_capacity.sql` ; `ADD COLUMN IF NOT EXISTS`, contrainte posée seulement si absente, sous verrou consultatif. Détail : `docs/analysis/FUEL3_CAPACITE_RESERVOIR.md`.
- **Pourquoi** : cadrage FUEL3 (`docs/plans/doc1-fuel3-cadrage.md`), la capacité n'existait nulle part ; prérequis de la règle `tank-overflow`.
- **Comment tester (QA)** :
  - Prérequis : `.env` avec `DATABASE_URL_TEST` (branche Neon de test).
  - Étapes : 1. démarrer l'application deux fois ; 2. `SELECT count(tank_capacity_l) FROM vehicles` ; 3. `UPDATE vehicles SET tank_capacity_l = 0 WHERE id = <véhicule TEST>` dans une transaction annulée.
  - Attendu : colonne présente, 0 capacité renseignée sur l'existant, l'UPDATE à 0 refusé (`23514`, `vehicles_tank_capacity_l_positive`), second démarrage sans écriture.
  - Preuve automatisée : `tests/unit/server/vehicles-tank-capacity-schema.test.ts` et, sous `db-lock`, `tests/integration/vehicles-tank-capacity.test.ts`.
- **RAIDER** : couvert : Idempotent (second init sans changement de catalogue ni de lignes), Retroactive (existant à NULL, aucun backfill), Durable (champ facultatif, contrats inchangés). Ne s'applique pas : seed.
- **Reste / risques** : la route PATCH véhicule ne passe pas par Zod (`prepareColumnUpdate`) : sans validation par fleet-api, une capacité 0 y produit l'erreur base `23514` au lieu d'un 400 lisible.

## 2026-11-03T08:01:08+01:00 — P3-2 lot 2a — Colonnes du récépissé de renouvellement

- **Agent** : fleet-db · **Branche** : `fix/p3-2-receipt-columns` · **Commit** : voir `git log`
- **Statut** : fait (partie base ; route de dépôt, éligibilité et écran restent à fleet-api et fleet-fe)
- **Quoi** : `document_renewal_requests.receipt_valid_until`, `receipt_file_name`, `receipt_file_path`, `receipt_uploaded_at`, `receipt_uploaded_by` (→ `users.id`), toutes nullable ; CHECK `document_renewal_requests_receipt_complete` (date et fichier ensemble). Le schéma Zod d'insertion omet fichier et traçabilité.
- **Comment** : `DOCUMENT_RENEWAL_RECEIPT_SQL` dans `server/init-database.ts`, jumelle de `server/db/migrations/20261103_document_renewal_receipt.sql`, hors CDC ; contraintes posées seulement si absentes, sous verrou consultatif. Détail : `docs/analysis/P3-2_RECEPISSE_RENOUVELLEMENT.md`.
- **Pourquoi** : décision utilisateur 3 (P3-2) ; `proof_file_*` est la preuve de clôture, pas un récépissé provisoire.
- **Comment tester (QA)** :
  - Prérequis : base de test dédiée (conteneur `fleetmaster20-main-postgres-1`), schéma poussé.
  - Étapes : 1. démarrer deux fois ; 2. insérer une demande avec date sans fichier.
  - Attendu : colonnes présentes, refus `23514` `document_renewal_requests_receipt_complete`, second démarrage sans écriture.
  - Preuve automatisée : `tests/unit/server/document-renewal-receipt-schema.test.ts`, `tests/integration/document-renewal-receipt.test.ts`.
- **RAIDER** : Idempotent (migration rejouée = NOTICE skipping, init rejoué sans changement de catalogue ni de lignes, second `drizzle-kit push` sans ordre sur ces objets, OID stables) ; Retroactive (7 demandes réelles toutes `completed`, colonnes à NULL, aucune reprise) ; Durable (insertion sans récépissé inchangée).
- **Reste / risques** : le second `drizzle-kit push` rejoue encore des ordres préexistants (FK aux noms tronqués à 63 caractères, défaut `idempotency_keys.expires_at`), sans lien avec ce lot.

## 2026-11-03T08:19:23+01:00 — P3-2 lot 2a — Réserves de relecture #125

- **Agent** : fleet-db · **Branche** : `fix/p3-2-receipt-columns` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : la CHECK `document_renewal_requests_receipt_complete` couvre les quatre champs du récépissé (date, chemin, nom, date de dépôt : tous NULL ou tous renseignés) ; `receipt_uploaded_by` reste hors CHECK. Une CHECK de même nom à l'ancienne définition est remplacée.
- **Comment** : `SET LOCAL lock_timeout = '5s'` ; trois blocs `DO` (colonnes, FK, CHECK) ; contraintes posées `NOT VALID` puis validées dans un sous-bloc qui ne piège que la violation (patron #124) ; `reportDocumentRenewalReceiptGaps` relit `pg_constraint` et journalise par `moduleLogger` toute contrainte absente, non validée ou périmée, citée par son nom. Migration et init restent identiques (test unitaire).
- **Pourquoi** : un `RAISE WARNING` n'atteint pas les logs ; un seul bloc piégé annulait FK et CHECK ensemble ; un verrou de table tenu bloquait le démarrage.
- **Comment tester (QA)** :
  - Prérequis : base de test dédiée, schéma poussé.
  - Étapes : supprimer FK et CHECK, insérer une demande hors CHECK (ou un auteur inexistant), redémarrer.
  - Attendu : seule la contrainte violée reste `NOT VALID`, l'autre est validée, un avertissement `init-database` la nomme.
  - Preuve automatisée : `tests/integration/document-renewal-receipt.test.ts` (4 échecs avec le SQL de 77b4700, 7/7 avec le correctif).
- **RAIDER** : Idempotent (second démarrage sans changement, double `drizzle-kit push` sans ordre receipt, OID stables) ; Durable (insertion sans récépissé inchangée) ; failure memory (le patron #124 est repris, pas réinventé).
- **Reste / risques** : avec `lock_timeout` atteint, colonnes ou contraintes peuvent manquer jusqu'au démarrage suivant ; le journal le signale.

## 2026-11-04T04:32:02+01:00 — Import des données TAY

- **Agent** : fleet-db · **Branche** : `feat/import-tay` · **Commit** : voir `git log`
- **Statut** : fait (aperçu et preuve sur base locale jetable ; aucune exécution sur la base de dev partagée)
- **Quoi** : `scripts/import-tay.ts` (CLI) et `scripts/lib/tay-import.ts` (logique pure) chargent véhicules, kilométrage, chauffeurs et fournisseurs depuis les quatre classeurs de `attached_assets/` ; véhicule fictif `TEST-0001` (désactivable par `--no-test-vehicle`).
- **Comment** : aperçu par défaut, `--apply` en une transaction sous verrou consultatif ; upserts sur clés naturelles (plaque normalisée comme `vehicles_registration_key_idx`, `TAY-NNN`, nom fournisseur) avec `WHERE … IS DISTINCT FROM` ; lot `import_batches` par empreinte composite. Détail : `docs/data-import/IMPORT_TAY.md`.
- **Pourquoi** : reprise des données client ; décisions utilisateur : dates telles quelles, trois échéances sur `vehicles` sans `vehicle_documents`, un véhicule de test.
- **Comment tester (QA)** :
  - Prérequis : base jetable (conteneur `fleetmaster20-main-postgres-1`), schéma poussé puis `initializeDatabase`, utilisateur `admin`.
  - Étapes : aperçu, `--apply`, `--apply`.
  - Attendu : 1er passage 99 écritures (59 + 1 véhicules, 27 chauffeurs, 11 + 1 fournisseurs), 2e passage « Écritures : 0 », empreinte `xmin` identique.
  - Preuve automatisée : `tests/unit/scripts/tay-import.test.ts` (28 tests).
- **RAIDER** : Idempotent (second `--apply` sans écriture) ; Retroactive (fiche préexistante gardée, kilométrage seulement relevé, aucune suppression) ; Durable (aucun schéma modifié).
- **Reste / risques** : colonnes d'audit incomplètes sur `vehicles`, `drivers`, `suppliers` (non ajoutées) ; six véhicules identifiés par numéro de châssis ; exécution sur la base cible à décider.

## 2026-11-04T18:04:13+01:00 — CHECK users_pin_bcrypt_check (PIN en clair refusé en base)

- **Agent** : fleet-db · **Branche** : `fix/users-pin-bcrypt-check` (locale, sur `origin/main` après #304) · **Commit** : voir `git log`
- **Statut** : fait en local, sans push ni PR (attente du signal de l'orchestrateur)
- **Quoi** : `users.pin` n'accepte plus qu'un hash bcrypt (`$2a$`, `$2b$`, `$2y$`) ou NULL, quel que soit l'appelant. Migration `server/db/migrations/20261104_users_pin_bcrypt_check.sql`, jumelle `USERS_PIN_BCRYPT_CHECK_SQL` dans `server/init-database.ts`, relevé d'écart `reportUsersPinBcryptGaps`, CHECK déclarée dans `shared/schema.ts`.
- **Comment** : patron de `20261103_document_renewal_receipt.sql` : verrou consultatif, `lock_timeout` 5 s, CHECK posée NOT VALID si absente puis VALIDATE dans un sous-bloc qui piège `check_violation` (contrainte laissée NOT VALID, démarrage jamais bloqué). Préfixe écrit `[$]` : texte identique dans le `.sql` et le gabarit TypeScript (`\$` y deviendrait `$`). Au démarrage : reprise `hashPlainUserPins` (#304) avant `applyMigrationSqlFiles` et avant la pose explicite, garde-fou d'ordre dans le test unitaire. La reprise sélectionne désormais exactement ce que la CHECK refuse (`pin !~ '^[$]2[aby][$]'` au lieu de `NOT LIKE '$2%'`) et accepte un client de transaction.
- **Pourquoi** : invariant de sécurité (aucun PIN en clair) à tenir en base, pas seulement dans les routes.
- **Comment tester (QA)** :
  - Prérequis : Postgres local de test (`DATABASE_URL_TEST`), jamais Neon.
  - Étapes : `npm test -- tests/unit/server/users-pin-bcrypt-check-schema.test.ts` ; `npm run test:contract -- tests/contract/users-pin-bcrypt-check.contract.test.ts`.
  - Attendu : PIN « 1234 » refusé (23514, `users_pin_bcrypt_check`), hash et NULL acceptés, rejeu sans changement (même oid), clair présent : NOT VALID + avertissement sans valeur, puis validée après reprise.
- **RAIDER** : Idempotent (rejeu = même contrainte) ; Retroactive (aucune donnée modifiée par la migration, clair existant laissé à la reprise) ; Durable (`tests/integration/pin-hash-migration.test.ts` adapté : le clair n'est plus écrit qu'en transaction annulée sans la contrainte).
- **Reste / risques** : `POST /api/users` et `POST /api/auth/register` (`server/routes.ts`, gelé) acceptent encore `pin` via `insertUserSchema` sans le hacher : avec la contrainte, un PIN fourni y donne une erreur 500 au lieu d'un stockage en clair ; correction côté fleet-api.

- 2026-11-04 18:40 : branche poussée, PR #320 ouverte (la mention « sans push ni PR » ci-dessus est périmée). Correctifs de relecture : PIN haché dans les deux routes de création, err.detail masqué dans le logger, préfixe $2 non conforme exclu de la reprise et compté.

## 2026-11-05T15:24:00+01:00 — QHSE lot Q1 : contraintes nommées déclarées dans Drizzle (bloquant de relecture #462)

- **Quoi** : les CHECK de `qhse_inspection_criteria` (label, category) et `qhse_inspections` (kind, location, items), plus l'unicité du code, sont déclarés nommés dans `shared/schema.ts` et posés sous les mêmes noms par `QHSE_INSPECTIONS_SQL` et sa migration jumelle ; les six noms entrent dans `CDC_RECONCILED_CONSTRAINTS`.
- **Comment** : patron PR #122 : contrainte nommée dans le CREATE TABLE, puis bloc DO qui pose NOT VALID la contrainte absente et la valide (check_violation piégée : WARNING, démarrage non bloqué). Unicité posée par un ancien push (`qhse_inspection_criteria_code_unique`) renommée en `_code_key`. Mineurs : filtres from/to au jour Africa/Douala en SQL, `inspectedAt` refusé au-delà de 5 min dans le futur, portée chauffeur dans le WHERE de `getInspection` (403 identique absent/interdit).
- **Pourquoi** : un CHECK écrit seulement dans CREATE TABLE IF NOT EXISTS n'existe pas sur une base poussée par drizzle-kit et un push --force le retire.
- **Preuves** : Postgres local jetable (ports 62432/62433), schéma par drizzle-kit push --force : les six contraintes présentes et validées avant tout init-database, INSERT category='road' rejeté (qhse_inspection_criteria_category_check). Contrat qhse-inspections 6/6, intégration cdc-schema-idempotence 13/13, unitaires 2726 verts, tsc 0 erreur. Filtre Douala : rouge avec l'ancien calcul UTC, vert après.
- **Reste / risques** : aucune donnée réécrite ; une base où des lignes violent un CHECK garde la contrainte NOT VALID, signalée au démarrage.

## 2026-11-05T15:40:00+01:00 — QHSE lot Q1 : fusion de main (T1, O1) dans #462, test 403 chauffeur sans fiche

- **Quoi** : `git merge origin/main` (sans rebase ni force-push) sur `feat/qhse-inspections` ; ajout au contrat qhse-inspections du cas compte `driver` sans fiche chauffeur → 403 sur `GET /api/qhse/inspections/:id` (contrôle existant et id absent).
- **Comment** : conflits résolus en gardant les deux côtés : `shared/constants/roles.ts` (`INVENTORY_MANAGER_ROLES` puis groupes QHSE), `shared/schema.ts` (tables `treasury_*` puis `qhse_*`). `init-database.ts`, `api/index.ts`, `tests/support/cleanup.ts` fusionnés automatiquement, relus (montages trésorerie, opérations, QHSE présents ; suppressions QHSE et trésorerie avant les utilisateurs).
- **Pourquoi** : #462 n'était plus fusionnable après #461 et #465.
- **Preuves** : tsc 0 erreur ; unitaires 252 fichiers, 2796 verts ; Postgres local jetable (ports 57320/57433, supprimé ensuite), schéma par drizzle-kit push --force : intégration cleanup-users-fk-coverage + cdc-schema-idempotence 16/16, contrat qhse-inspections 6/6 ; nouvelle assertion rouge si l'on attend 200, verte à 403.
- **Reste / risques** : aucun effet en base partagée ; aucune migration nouvelle.

## 2026-11-10T16:20:31+01:00 — GPS-DB — Positions téléphone, points A/B des missions, purge

- **Agent** : fleet-db · **Branche** : `feat/gps-phone-db` · **Commit** : voir `git log`
- **Statut** : fait (partie base ; routes, purge planifiée et écrans restent aux lots GPS-API et GPS-FE ; drapeau `gps` coupé)
- **Quoi** : table `vehicle_positions` commune aux sources `phone` / `tracker` (identifiant de point client unique par auteur, bornes lat/lng, mesures positives, cap < 360, `suspect`), deux index (mission + temps, véhicule + temps) ; six colonnes facultatives `missions.pickup_*` / `delivery_*` (lat, lng, code de hub) avec deux CHECK ; fonction `purge_vehicle_positions(jours)` et `server/lib/gps-retention.ts` (`GPS_POSITION_RETENTION_DAYS`, 30 par défaut) ; `vehicle_positions` classée source d'action véhicule. Pas de `location_consents` (décision utilisatrice du jour).
- **Comment** : `VEHICLE_POSITIONS_GPS_SQL` dans `server/init-database.ts`, jumelle de `server/db/migrations/20261110_vehicle_positions_gps.sql` ; verrou consultatif + `lock_timeout` 5 s ; colonnes ajoutées seulement si absentes ; contraintes `NOT VALID` puis validées (patron #124), relues par `CDC_RECONCILED_CONSTRAINTS` ; fonction recréée seulement si son corps diffère. Détail : `docs/analysis/GPS_V1_POSITIONS_BASE.md`.
- **Pourquoi** : cadrage `docs/plans/carte-chauffeur-gps-telephone.md` §5 ; invariants tenus quel que soit l'appelant, rejeu hors ligne sans doublon même sous course.
- **Comment tester (QA)** :
  - Prérequis : base locale dédiée dans le conteneur Postgres de test, schéma poussé.
  - Étapes : 1. démarrer deux fois ; 2. insérer un point lat 91 ; 3. rejouer un point de même identifiant ; 4. `SELECT purge_vehicle_positions(30)` deux fois.
  - Attendu : refus `23514` nommé, rejeu sans ligne de plus, second démarrage et seconde purge sans écriture.
  - Preuve automatisée : `tests/unit/server/vehicle-positions-gps-schema.test.ts`, `tests/integration/vehicle-positions-gps.test.ts`.
- **RAIDER** : Idempotent (second init sans identifiant de transaction, mutant « fonction toujours recréée » tué) ; Retroactive (missions existantes à NULL, aucune reprise ; base poussée par Drizzle réconciliée) ; Durable (insertion de mission inchangée, suites unitaires et intégration vertes). Ne s'applique pas : seed.
- **Écarts au plan §5** : `mission_id` en CASCADE (SET NULL violerait `vehicle_positions_phone_check`) ; pas de `geo_source` (déduit du code de hub) ; `device_id` sans FK (`telemetry_devices` absente) ; `suspect` ajouté (§6).
- **Incident évité** : l'insertion scriptée de la constante dans `init-database.ts` par `String.replace` avait changé `$$` en `$` ; le test des jumelles l'a détecté avant tout commit (remplacement par fonction depuis).
- **Reste / risques** : le serveur doit refuser un point plus vieux que la rétention (sinon un rejeu après purge le réinsère) et planifier la purge quotidienne.

## 2026-11-10T16:45:00+01:00 — GPS-DB — Suites de relecture de #657

- **Agent** : fleet-db · **Branche** : `feat/gps-phone-db` · **Commit** : voir `git log` (nouveau commit, pas d'amend : le lot API est empilé)
- **Statut** : fait
- **Quoi** : 1. `insertMissionSchema` omet les six colonnes A/B (sinon `POST /api/missions` les écrivait sans validation de hub et un 23514 donnait une 500 ; le lot API les rouvrira avec validation). 2. Bloc des contraintes : les CHECK `missions_*_geo_check` sont sautées (WARNING) si les colonnes A/B manquent, cas d'un bloc colonnes abandonné sur `lock_not_available` (sinon 42703 et démarrage en échec) ; les deux jumelles identiques. 3. Doc : points `tracker` non dédoublonnés par la contrainte unique (NULL distincts), à traiter au lot balises. 4. Leçon `$$` → `$` par `String.replace`.
- **Preuve automatisée** : unitaire « insertMissionSchema ferme les six colonnes A/B » ; intégration « missions verrouillée à l'ajout des colonnes A/B » (verrou simulé par un event trigger annulé avec la transaction : démarrage poursuivi sans les deux CHECK, puis posées et validées au démarrage suivant).
- **Reste / risques** : aucun effet en base partagée.
