-- Chantier CDC (écarts du cahier des charges, lot DB-1) : schéma additif, idempotent.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; les mêmes
-- ordres sont dupliqués dans CDC_SCHEMA_STATEMENTS (AGENTS.md §5). Un test de dérive
-- (tests/unit/server/cdc-schema-drift.test.ts) vérifie que les deux listes concordent.
-- ADR 0001 §5 : aucun DROP, aucun ALTER TYPE, aucune colonne NOT NULL sans défaut sur une table
-- existante ; contraintes sur données existantes posées dans des blocs DO après contrôle.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE INDEX IF NOT EXISTS parts_reference_key_idx ON parts (upper(btrim(reference)));

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS due_mileage integer CONSTRAINT work_orders_due_mileage_check CHECK (due_mileage IS NULL OR due_mileage >= 0);

CREATE INDEX IF NOT EXISTS work_orders_preventive_due_idx ON work_orders (due_date) WHERE is_preventive;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM work_orders WHERE is_preventive AND due_date IS NULL AND start_date IS NOT NULL) THEN
    PERFORM set_config('fleetos.suppress_side_effects', 'on', true);
    UPDATE work_orders SET due_date = start_date::date
    WHERE is_preventive AND due_date IS NULL AND start_date IS NOT NULL;
    PERFORM set_config('fleetos.suppress_side_effects', '', true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workshop_labor_rates (
  id serial PRIMARY KEY,
  effective_from date NOT NULL UNIQUE,
  hourly_rate_ht numeric(15,2) NOT NULL CHECK (hourly_rate_ht >= 0),
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_batches (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('vehicles', 'interventions')),
  file_name text,
  file_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS import_batches_applied_file_uidx ON import_batches (kind, file_sha256) WHERE status = 'applied';

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS origin text;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_ref text;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS import_fingerprint text;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS import_batch_id integer REFERENCES import_batches(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_external_ref_uidx ON work_orders (external_ref) WHERE external_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_import_fingerprint_uidx ON work_orders (import_fingerprint) WHERE import_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_orders_import_batch_idx ON work_orders (import_batch_id) WHERE import_batch_id IS NOT NULL;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS import_batch_id integer REFERENCES import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vehicles_import_batch_idx ON vehicles (import_batch_id) WHERE import_batch_id IS NOT NULL;

DO $$
DECLARE
  has_deleted_at boolean;
  has_duplicates boolean;
  scope text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'vehicles_registration_key_uidx') THEN
    RETURN;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'vehicles' AND column_name = 'deleted_at'
  ) INTO has_deleted_at;
  scope := CASE WHEN has_deleted_at THEN ' WHERE deleted_at IS NULL' ELSE '' END;
  IF NOT has_deleted_at THEN
    RAISE WARNING 'vehicles.deleted_at absente : vehicles_registration_key_uidx couvre tous les véhicules';
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vehicles' || scope
    || ' GROUP BY upper(regexp_replace(registration_number, ''[^A-Za-z0-9]'', '''', ''g'')) HAVING count(*) > 1)'
    INTO has_duplicates;
  IF has_duplicates THEN
    RAISE WARNING 'vehicles_registration_key_uidx non posé : immatriculations en double après normalisation ; index non unique vehicles_registration_key_idx à la place';
    EXECUTE 'CREATE INDEX IF NOT EXISTS vehicles_registration_key_idx ON vehicles (upper(regexp_replace(registration_number, ''[^A-Za-z0-9]'', '''', ''g'')))' || scope;
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX vehicles_registration_key_uidx ON vehicles (upper(regexp_replace(registration_number, ''[^A-Za-z0-9]'', '''', ''g'')))' || scope;
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'vehicles_registration_key_uidx non posé : doublon apparu pendant la création';
END $$;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);
