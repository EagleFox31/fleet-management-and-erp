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
