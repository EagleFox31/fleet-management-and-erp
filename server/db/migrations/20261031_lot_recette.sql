-- Lot recette du 2 novembre 2026 (T-07a, T-07b, T-23c) : schéma additif, idempotent.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; les mêmes
-- ordres sont dupliqués dans LOT_RECETTE_SCHEMA_STATEMENTS (AGENTS.md §5). Un test de dérive
-- (tests/unit/server/lot-recette-schema-drift.test.ts) vérifie que les deux listes concordent.
-- Aucun DROP, aucune colonne NOT NULL sans défaut. Les contraintes d'exclusion n'existent qu'ici :
-- drizzle ne sait pas les exprimer.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE TABLE IF NOT EXISTS vehicle_document_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  validity_months integer,
  alert_days integer NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO vehicle_document_types (code, label, validity_months, alert_days, active, sort_order) VALUES
  ('carte_grise', 'Carte grise', 120, 30, true, 10),
  ('carte_bleue', 'Carte bleue', 12, 30, true, 20),
  ('visite_technique', 'Visite technique', 6, 30, true, 30),
  ('acf', 'ACF', NULL, 30, true, 40),
  ('tae', 'TAE', 6, 30, true, 50),
  ('vignette', 'Vignette', 12, 30, true, 60),
  ('jaugeage', 'Jaugeage', 24, 30, true, 70),
  ('assurance', 'Assurance', 12, 30, true, 80),
  ('agrement_pd', 'Agrément PD', NULL, 30, true, 90),
  ('taxe', 'Taxe', NULL, 30, true, 900),
  ('autre', 'Autre', NULL, 30, true, 910)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamp;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at timestamp;

CREATE TABLE IF NOT EXISTS login_attempts_by_username (
  username_normalized text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamp,
  last_failed_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, topic)
);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS topic text;

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_user_dedupe ON alerts (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_user_unread ON alerts (user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_runs (
  id serial PRIMARY KEY,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  status text NOT NULL DEFAULT 'running',
  size_bytes bigint,
  checksum text,
  location text,
  error_code text
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs (started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_runs_single_running ON backup_runs ((true)) WHERE status = 'running';

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_status text;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_by integer REFERENCES users(id);

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_at timestamp;

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_reason text;

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS method text;

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS path text;

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS entity_ref text;

CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON activity_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs (created_at DESC);

ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS received_by integer REFERENCES users(id);

ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS received_at timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'fuel_records' AND column_name = 'validation_status'
  ) THEN
    ALTER TABLE fuel_records ADD COLUMN validation_status text NOT NULL DEFAULT 'validated';
    ALTER TABLE fuel_records ALTER COLUMN validation_status SET DEFAULT 'pending';
  END IF;
END $$;

ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS validated_by integer REFERENCES users(id);

ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS validated_at timestamp;

CREATE INDEX IF NOT EXISTS idx_fuel_records_validation ON fuel_records (validation_status, date);

CREATE TABLE IF NOT EXISTS fuel_prices (
  id serial PRIMARY KEY,
  effective_from date NOT NULL UNIQUE,
  price_per_liter numeric(15,2) NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO fuel_prices (effective_from, price_per_liter) VALUES (DATE '2000-01-01', 828) ON CONFLICT (effective_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS fuel_anomaly_resolutions (
  id serial PRIMARY KEY,
  anomaly_key text NOT NULL UNIQUE,
  fuel_record_id integer REFERENCES fuel_records(id) ON DELETE SET NULL,
  status text NOT NULL,
  comment text,
  resolved_by integer REFERENCES users(id),
  resolved_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
  id serial PRIMARY KEY,
  vehicle_id integer NOT NULL REFERENCES vehicles(id),
  reported_by integer NOT NULL REFERENCES users(id),
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  work_order_id integer REFERENCES work_orders(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status_created ON incidents (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_vehicle ON incidents (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_parts_used_work_order ON parts_used (work_order_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_time_tracking_user_date') THEN
    IF EXISTS (SELECT 1 FROM time_tracking GROUP BY user_id, date HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_time_tracking_user_date non posé : doublons existants dans time_tracking';
    ELSE
      CREATE UNIQUE INDEX uq_time_tracking_user_date ON time_tracking (user_id, date);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_monthly_time_stats_user_period') THEN
    IF EXISTS (SELECT 1 FROM monthly_time_stats GROUP BY user_id, month, year HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_monthly_time_stats_user_period non posé : doublons existants dans monthly_time_stats';
    ELSE
      CREATE UNIQUE INDEX uq_monthly_time_stats_user_period ON monthly_time_stats (user_id, month, year);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'btree_gist indisponible, contraintes de double affectation non posées : %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE WARNING 'work_orders_no_technician_overlap non posée : extension btree_gist absente';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_no_technician_overlap') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_no_technician_overlap
      EXCLUDE USING gist (
        technician_id WITH =,
        tsrange(start_date, GREATEST(COALESCE(end_date, 'infinity'::timestamp), start_date), '[)') WITH &&
      )
      WHERE (technician_id IS NOT NULL AND start_date IS NOT NULL AND end_date IS NOT NULL
             AND status IN ('pending', 'in_progress', 'awaiting_parts'));
  END IF;
EXCEPTION WHEN exclusion_violation THEN
  RAISE WARNING 'work_orders_no_technician_overlap non posée : chevauchements existants dans work_orders';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RAISE WARNING 'work_orders_no_vehicle_overlap non posée : extension btree_gist absente';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_no_vehicle_overlap') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_no_vehicle_overlap
      EXCLUDE USING gist (
        vehicle_id WITH =,
        tsrange(start_date, GREATEST(COALESCE(end_date, 'infinity'::timestamp), start_date), '[)') WITH &&
      )
      WHERE (vehicle_id IS NOT NULL AND start_date IS NOT NULL AND end_date IS NOT NULL
             AND status IN ('pending', 'in_progress', 'awaiting_parts'));
  END IF;
EXCEPTION WHEN exclusion_violation THEN
  RAISE WARNING 'work_orders_no_vehicle_overlap non posée : chevauchements existants dans work_orders';
END $$;
