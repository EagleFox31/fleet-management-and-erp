-- FUEL3 : capacité totale des réservoirs du véhicule, en litres (règle d'anomalie carburant tank-overflow).
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par VEHICLE_TANK_CAPACITY_SQL (AGENTS.md §5), comparé par tests/unit/server/vehicles-tank-capacity-schema.test.ts.
-- Additif et rétroactif : colonne nullable, véhicules existants à NULL (capacité inconnue, règle muette),
-- aucune donnée modifiée. La contrainte refuse 0, négatif, NaN et Infinity ; la borne haute (2 000 L)
-- est une règle de saisie (shared/schema.ts, vehicleTankCapacitySchema), pas un invariant de base.
-- Idempotent : ADD COLUMN IF NOT EXISTS, contrainte posée seulement si absente, sous verrou consultatif.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant recrée la colonne) :
--   1. retirer VEHICLE_TANK_CAPACITY_SQL et son appel de server/init-database.ts, ce fichier et la colonne
--      tankCapacityL de shared/schema.ts ;
--   2. déployer, puis ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_tank_capacity_l_positive;
--      ALTER TABLE vehicles DROP COLUMN IF EXISTS tank_capacity_l;  (perd les capacités saisies)
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tank_capacity_l real;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'vehicles'::regclass AND conname = 'vehicles_tank_capacity_l_positive'
  ) THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_tank_capacity_l_positive
      CHECK (tank_capacity_l IS NULL OR (tank_capacity_l > 0 AND tank_capacity_l < 'Infinity'::real));
  END IF;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'vehicles_tank_capacity_l_positive non posée : capacités nulles ou négatives existantes dans vehicles';
END $$;
