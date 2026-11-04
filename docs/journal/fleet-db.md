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
