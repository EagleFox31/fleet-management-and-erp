-- Chantier CDC (écarts du cahier des charges, lot DB-1) : schéma additif, idempotent.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; les mêmes
-- ordres sont dupliqués dans CDC_SCHEMA_STATEMENTS (AGENTS.md §5). Un test de dérive
-- (tests/unit/server/cdc-schema-drift.test.ts) vérifie que les deux listes concordent.
-- ADR 0001 §5 : aucun DROP, aucun ALTER TYPE, aucune colonne NOT NULL sans défaut sur une table
-- existante ; contraintes sur données existantes posées dans des blocs DO après contrôle.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE INDEX IF NOT EXISTS parts_reference_key_idx ON parts (upper(btrim(reference)));

-- Reprise unique de due_date (CDC #7) : elle n'a lieu que dans la transaction qui crée la
-- colonne. Aux démarrages suivants la colonne existe et le bloc ne fait rien : un OT préventif
-- créé plus tard, ou un due_date remis à NULL volontairement, n'est jamais réécrit.
-- Le trigger temps réel est suspendu le temps de la reprise (au premier démarrage, sa fonction
-- n'a pas encore la garde fleetos.suppress_side_effects : applyBootstrapSqlFiles passe après) ;
-- il est réactivé avant la fin de la même transaction, les autres sessions ne le voient jamais
-- désactivé. La garde est aussi posée pour les fonctions qui l'ont déjà.
DO $$
DECLARE
  realtime_on boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'work_orders' AND column_name = 'due_date'
  ) THEN
    RETURN;
  END IF;
  ALTER TABLE work_orders ADD COLUMN due_date date;
  SELECT tgenabled = 'O' INTO realtime_on FROM pg_trigger
  WHERE tgrelid = 'work_orders'::regclass AND tgname = 'trigger_work_orders_realtime_notify';
  IF realtime_on THEN
    ALTER TABLE work_orders DISABLE TRIGGER trigger_work_orders_realtime_notify;
  END IF;
  PERFORM set_config('fleetos.suppress_side_effects', 'on', true);
  UPDATE work_orders SET due_date = start_date::date
  WHERE is_preventive AND start_date IS NOT NULL;
  PERFORM set_config('fleetos.suppress_side_effects', '', true);
  IF realtime_on THEN
    ALTER TABLE work_orders ENABLE TRIGGER trigger_work_orders_realtime_notify;
  END IF;
END $$;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS due_mileage integer CONSTRAINT work_orders_due_mileage_check CHECK (due_mileage IS NULL OR due_mileage >= 0);

DO $$
BEGIN
  -- Base créée par drizzle-kit push : la colonne existe déjà, l'ADD COLUMN ci-dessus n'a pas posé le CHECK.
  -- NOT VALID : les lignes existantes ne bloquent pas le démarrage, les écritures suivantes sont contrôlées.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'work_orders'::regclass AND conname = 'work_orders_due_mileage_check'
  ) THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_due_mileage_check CHECK (due_mileage IS NULL OR due_mileage >= 0) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS work_orders_preventive_due_idx ON work_orders (due_date) WHERE is_preventive;

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

-- Immatriculation normalisée (CDC #9) : index NON unique (recherche et rapprochement à l'import).
-- L'unicité reste un contrôle applicatif (lot #9) : un index unique ferait échouer en 23505
-- la création de véhicule existante. Les doublons existants sont signalés par un WARNING.
DO $$
DECLARE
  has_deleted_at boolean;
  scope text;
  duplicates integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'vehicles' AND column_name = 'deleted_at'
  ) INTO has_deleted_at;
  scope := CASE WHEN has_deleted_at THEN ' WHERE deleted_at IS NULL' ELSE '' END;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'vehicles_registration_key_idx') THEN
    IF NOT has_deleted_at THEN
      RAISE WARNING 'vehicles.deleted_at absente : vehicles_registration_key_idx couvre tous les véhicules';
    END IF;
    EXECUTE 'CREATE INDEX vehicles_registration_key_idx ON vehicles (upper(regexp_replace(registration_number, ''[^A-Za-z0-9]'', '''', ''g'')))' || scope;
  END IF;
  EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM vehicles' || scope
    || ' GROUP BY upper(regexp_replace(registration_number, ''[^A-Za-z0-9]'', '''', ''g'')) HAVING count(*) > 1) d'
    INTO duplicates;
  IF duplicates > 0 THEN
    RAISE WARNING 'vehicles : % immatriculation(s) en double après normalisation', duplicates;
  END IF;
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
