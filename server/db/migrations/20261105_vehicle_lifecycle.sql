-- Cycle de vie du véhicule (suppression douce, restauration symétrique).
-- vehicle_deletion_effects : désactivations posées par la suppression douce, rejouées puis vidées par la restauration
-- (server/services/vehicle-lifecycle-service.ts). vehicles.deleted_by : auteur de la suppression douce.
-- maintenance_schedules.updated_at et son déclencheur : horodatage renouvelé par tout écrivain (restauration fidèle).
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
DO $$
BEGIN
  -- Colonne ajoutée sans défaut : les lignes existantes restent à NULL, aucune n'est réécrite.
  -- Le défaut ne vaut ensuite que pour les nouvelles lignes. Bloc gardé : une base convergée n'écrit rien.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'maintenance_schedules' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE maintenance_schedules ADD COLUMN updated_at timestamp;
    ALTER TABLE maintenance_schedules ALTER COLUMN updated_at SET DEFAULT now();
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'maintenance_schedules.updated_at non ajoutée, verrou de table indisponible sous 5 s : lecture et écriture des plans, suppression douce et restauration en échec jusqu''au prochain démarrage';
END $$;
DO $$
BEGIN
  -- Tout écrivain renouvelle updated_at : la restauration distingue un plan désactivé par la suppression douce
  -- d'un plan désactivé à la main pendant le retrait. Posé seulement si la colonne existe.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'maintenance_schedules' AND column_name = 'updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION fn_maintenance_schedules_touch()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $fn$;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'maintenance_schedules'::regclass AND tgname = 'trg_maintenance_schedules_touch' AND NOT tgisinternal
    ) THEN
      CREATE OR REPLACE TRIGGER trg_maintenance_schedules_touch
      BEFORE UPDATE ON maintenance_schedules
      FOR EACH ROW
      EXECUTE FUNCTION fn_maintenance_schedules_touch();
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'trg_maintenance_schedules_touch non posé, verrou de table indisponible sous 5 s : réessayé au démarrage suivant';
END $$;
