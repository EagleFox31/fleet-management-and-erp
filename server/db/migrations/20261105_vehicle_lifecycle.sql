-- Cycle de vie du véhicule (suppression douce, restauration symétrique).
-- vehicle_deletion_effects : désactivations posées par la suppression douce, rejouées puis vidées par la restauration
-- (server/services/vehicle-lifecycle-service.ts). vehicles.deleted_by : auteur de la suppression douce.
-- Additif : aucune ligne existante réécrite. Rejoué à chaque démarrage par server/init-database.ts ; le même SQL est
-- porté par VEHICLE_LIFECYCLE_SQL, comparé par tests/unit/server/vehicle-lifecycle-schema.test.ts.
-- Verrou indisponible sous 5 s : WARNING et démarrage poursuivi, réessayé au démarrage suivant.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS vehicle_deletion_effects (
    id serial PRIMARY KEY,
    vehicle_id integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    table_name text NOT NULL,
    row_id integer NOT NULL,
    column_name text NOT NULL,
    previous_value jsonb NOT NULL,
    applied_value jsonb NOT NULL,
    created_by integer REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT vehicle_deletion_effects_row_key UNIQUE (vehicle_id, table_name, row_id, column_name)
  );
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'vehicle_deletion_effects non créée, verrou indisponible sous 5 s : suppression douce et restauration en échec jusqu''au prochain démarrage';
END $$;

DO $$
BEGIN
  ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'vehicles.deleted_by non ajoutée, verrou de table indisponible sous 5 s : suppression douce en échec jusqu''au prochain démarrage';
END $$;
DO $$
BEGIN
  ALTER TABLE vehicle_deletion_effects ADD COLUMN IF NOT EXISTS applied_stamp timestamp;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'vehicle_deletion_effects.applied_stamp non ajoutée, verrou indisponible sous 5 s : restauration en échec jusqu''au prochain démarrage';
END $$;
