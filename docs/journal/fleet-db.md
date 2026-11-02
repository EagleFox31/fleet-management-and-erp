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
