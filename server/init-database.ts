import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db, pool } from './db';
import { users } from '../shared/schema';
import { TREASURY_CATEGORIES } from '../shared/contracts/treasury';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { moduleLogger } from './lib/logger';
import { listMigrationFiles } from './lib/migration-files';
import { planInitialAdmin } from './lib/initial-admin';
import { hashPlainUserPins } from './lib/pin-hash-migration';
import { randomPasswordHash } from './lib/dummy-hash';

const initLog = moduleLogger('init-database');

const BOOTSTRAP_SQL_FILES = [
  'work-orders-realtime-triggers.sql',
  'supplier-invoice-settlements-workflow.sql',
  'mission-fuel-triggers.sql',
  // Alertes carburant réécrites après #263 (destinataires configurés, échec d'alerte sans casser le plein).
  'fuel-alerts-triggers.sql',
] as const;

async function applySqlFile(absolutePath: string, logLabel: string) {
  const content = await readFile(absolutePath, 'utf-8');
  await pool.query(content);
  console.log(`✅ Bootstrap SQL appliqué: ${logLabel}`);
}

async function applyBootstrapSqlFiles() {
  for (const relativePath of BOOTSTRAP_SQL_FILES) {
    const absolutePath = path.resolve(process.cwd(), 'server', 'db', 'triggers', relativePath);
    await applySqlFile(absolutePath, `server/db/triggers/${relativePath}`);
  }
}

/** Migrations idempotentes rejouées à chaque démarrage (pas de table de suivi). */
async function applyMigrationSqlFiles() {
  const migrationsDir = path.resolve(process.cwd(), 'server', 'db', 'migrations');
  // Dossier absent : lève, le démarrage échoue (server/lib/migration-files.ts).
  const files = await listMigrationFiles(migrationsDir);

  for (const file of files) {
    const absolutePath = path.join(migrationsDir, file);
    await applySqlFile(absolutePath, `server/db/migrations/${file}`);
  }
}

async function applyPerformanceIndexes() {
  const indexStatements = [
    // Work orders
    `CREATE INDEX IF NOT EXISTS idx_work_orders_status_created_at ON work_orders (status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle_status ON work_orders (vehicle_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_work_orders_technician_status ON work_orders (technician_id, status)`,
    // Carburant : historique par véhicule (triggers d'alerte et cycle d'alertes, #287 / #281)
    `CREATE INDEX IF NOT EXISTS idx_fuel_records_vehicle_date_id ON fuel_records (vehicle_id, date, id)`,

    // Part requirements
    `CREATE INDEX IF NOT EXISTS idx_part_requirements_work_order_status ON part_requirements (work_order_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_part_requirements_status_created_at ON part_requirements (status, created_at DESC)`,

    // Tires
    `CREATE INDEX IF NOT EXISTS idx_tires_deleted_created_at ON tires (deleted_at, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_vehicle_tires_vehicle_status ON vehicle_tires (vehicle_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_vehicle_tires_status_installation_date ON vehicle_tires (status, installation_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_tire_inspections_vehicle_tire_date ON tire_inspections (vehicle_tire_id, inspection_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_tire_inspections_tread_depth ON tire_inspections (tread_depth)`,
    `CREATE INDEX IF NOT EXISTS idx_tire_rotations_vehicle_date ON tire_rotations (vehicle_id, rotation_date DESC)`,

    // Procurement / accounting
    `CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_order_date ON purchase_orders (status, order_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_created_at ON purchase_orders (supplier_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status_due_date ON supplier_invoices (status, due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier_created_at ON supplier_invoices (supplier_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_supplier_invoices_purchase_order_id ON supplier_invoices (purchase_order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_supplier_invoice_settlements_invoice_status ON supplier_invoice_settlements (supplier_invoice_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_supplier_invoice_settlements_payment_date ON supplier_invoice_settlements (payment_date DESC)`,

    // Mission fuel tracking
    `CREATE INDEX IF NOT EXISTS idx_fuel_records_mission_id ON fuel_records (mission_id)`,

    // Document renewal workflow
    `CREATE INDEX IF NOT EXISTS idx_document_renewal_centers_document_type ON document_renewal_centers (document_type)`,
    `CREATE INDEX IF NOT EXISTS idx_document_renewal_requests_vehicle_status ON document_renewal_requests (vehicle_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_document_renewal_requests_document_status ON document_renewal_requests (vehicle_document_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_document_renewal_requests_created_at ON document_renewal_requests (created_at DESC)`,

    // Dashboard Direction — filtres par date
    `CREATE INDEX IF NOT EXISTS idx_client_invoices_invoice_date_status ON client_invoices (invoice_date, status)`,
    `CREATE INDEX IF NOT EXISTS idx_fuel_records_date ON fuel_records (date)`,
    `CREATE INDEX IF NOT EXISTS idx_supplier_invoices_invoice_date_status ON supplier_invoices (invoice_date, status)`,
    `CREATE INDEX IF NOT EXISTS idx_missions_delivery_date_status ON missions (delivery_date, status)`,
    `CREATE INDEX IF NOT EXISTS idx_work_orders_completed_created_at ON work_orders (status, created_at) WHERE status = 'completed'`,
  ];

  for (const statement of indexStatements) {
    await db.execute(sql.raw(statement));
  }

  console.log(`✅ Index de performance vérifiés: ${indexStatements.length}`);
}

/**
 * Schéma additif du lot recette (T-07a, T-07b, T-23c). Doit rester identique à
 * server/db/migrations/20261031_lot_recette.sql (AGENTS.md §5) : le test
 * tests/unit/server/lot-recette-schema-drift.test.ts compare les deux.
 * Un seul envoi (protocole simple) = une transaction ; le verrou consultatif
 * de transaction sérialise deux instances qui démarrent ensemble.
 */
export const LOT_RECETTE_SCHEMA_STATEMENTS: readonly string[] = [
  `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))`,
  `CREATE TABLE IF NOT EXISTS vehicle_document_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  validity_months integer,
  alert_days integer NOT NULL DEFAULT 30,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
)`,
  `INSERT INTO vehicle_document_types (code, label, validity_months, alert_days, active, sort_order) VALUES
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
ON CONFLICT (code) DO NOTHING`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamp`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at timestamp`,
  `CREATE TABLE IF NOT EXISTS login_attempts_by_username (
  username_normalized text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamp,
  last_failed_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, topic)
)`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS topic text`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS dedupe_key text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_user_dedupe ON alerts (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_user_unread ON alerts (user_id, is_read, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS backup_runs (
  id serial PRIMARY KEY,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  status text NOT NULL DEFAULT 'running',
  size_bytes bigint,
  checksum text,
  location text,
  error_code text
)`,
  `CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs (started_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_runs_single_running ON backup_runs ((true)) WHERE status = 'running'`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_status text`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_by integer REFERENCES users(id)`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_at timestamp`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS qc_reason text`,
  `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS method text`,
  `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS path text`,
  `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS entity_ref text`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs (entity_type, entity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON activity_logs (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs (created_at DESC)`,
  `ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS received_by integer REFERENCES users(id)`,
  `ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS received_at timestamp`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'fuel_records' AND column_name = 'validation_status'
  ) THEN
    ALTER TABLE fuel_records ADD COLUMN validation_status text NOT NULL DEFAULT 'validated';
    ALTER TABLE fuel_records ALTER COLUMN validation_status SET DEFAULT 'pending';
  END IF;
END $$`,
  `ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS validated_by integer REFERENCES users(id)`,
  `ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS validated_at timestamp`,
  `CREATE INDEX IF NOT EXISTS idx_fuel_records_validation ON fuel_records (validation_status, date)`,
  `CREATE TABLE IF NOT EXISTS fuel_prices (
  id serial PRIMARY KEY,
  effective_from date NOT NULL UNIQUE,
  price_per_liter numeric(15,2) NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
)`,
  `INSERT INTO fuel_prices (effective_from, price_per_liter) VALUES (DATE '2000-01-01', 828) ON CONFLICT (effective_from) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS fuel_anomaly_resolutions (
  id serial PRIMARY KEY,
  anomaly_key text NOT NULL UNIQUE,
  fuel_record_id integer REFERENCES fuel_records(id) ON DELETE SET NULL,
  status text NOT NULL,
  comment text,
  resolved_by integer REFERENCES users(id),
  resolved_at timestamp NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS incidents (
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
)`,
  `CREATE INDEX IF NOT EXISTS idx_incidents_status_created ON incidents (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_incidents_vehicle ON incidents (vehicle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_parts_used_work_order ON parts_used (work_order_id)`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_time_tracking_user_date') THEN
    IF EXISTS (SELECT 1 FROM time_tracking GROUP BY user_id, date HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_time_tracking_user_date non posé : doublons existants dans time_tracking';
    ELSE
      CREATE UNIQUE INDEX uq_time_tracking_user_date ON time_tracking (user_id, date);
    END IF;
  END IF;
END $$`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_monthly_time_stats_user_period') THEN
    IF EXISTS (SELECT 1 FROM monthly_time_stats GROUP BY user_id, month, year HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_monthly_time_stats_user_period non posé : doublons existants dans monthly_time_stats';
    ELSE
      CREATE UNIQUE INDEX uq_monthly_time_stats_user_period ON monthly_time_stats (user_id, month, year);
    END IF;
  END IF;
END $$`,
  `DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'btree_gist indisponible, contraintes de double affectation non posées : %', SQLERRM;
END $$`,
  `DO $$
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
END $$`,
  `DO $$
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
END $$`,
];

/**
 * FUEL3 : capacité totale des réservoirs du véhicule, en litres. Nullable (véhicules existants à vide,
 * règle tank-overflow muette). CHECK vehicles_tank_capacity_l_positive : > 0 et fini (refuse 0, négatif,
 * NaN et Infinity, que `real` accepte sinon). Doit rester identique à
 * server/db/migrations/20261102_vehicles_tank_capacity.sql : tests/unit/server/vehicles-tank-capacity-schema.test.ts
 * compare les deux. Un seul envoi = une transaction, sérialisée par le verrou consultatif.
 */
export const VEHICLE_TANK_CAPACITY_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

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
END $$;`;

/**
 * PRT1 / CAT2 : spécifications et variantes de pièce, pièces associées à une panne (FK en cascade, unicité du
 * couple panne/pièce après dédoublonnage). Doit rester identique à
 * server/db/migrations/20261102_parts_catalog_children.sql : tests/unit/server/parts-catalog-children-schema.test.ts
 * compare les deux. Un seul envoi = une transaction, sérialisée par le verrou consultatif.
 */
export const PARTS_CATALOG_CHILDREN_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE TABLE IF NOT EXISTS part_specifications (
  id serial PRIMARY KEY,
  part_id integer,
  specification_name text NOT NULL,
  specification_value text NOT NULL,
  unit text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT part_specifications_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS part_variants (
  id serial PRIMARY KEY,
  part_id integer,
  variant_name text NOT NULL,
  variant_code text NOT NULL UNIQUE,
  additional_price numeric(10,2) DEFAULT '0',
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT part_variants_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fault_catalog (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  vehicle_brand text,
  symptoms text[],
  diagnostic_steps text[],
  repair_steps text[],
  estimated_duration integer,
  minimum_cost real,
  maximum_cost real,
  created_by integer,
  validated_by integer,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fault_catalog_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fault_catalog_validated_by_users_id_fk FOREIGN KEY (validated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS fault_catalog_parts (
  id serial PRIMARY KEY,
  fault_catalog_id integer NOT NULL,
  part_id integer NOT NULL,
  quantity integer DEFAULT 1,
  is_optional boolean DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fault_catalog_parts_fault_catalog_id_fault_catalog_id_fk FOREIGN KEY (fault_catalog_id) REFERENCES fault_catalog(id) ON DELETE CASCADE,
  CONSTRAINT fault_catalog_parts_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_part_specifications_part_id ON part_specifications (part_id);

CREATE INDEX IF NOT EXISTS idx_part_variants_part_id ON part_variants (part_id);

CREATE INDEX IF NOT EXISTS idx_fault_catalog_parts_part_id ON fault_catalog_parts (part_id);

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT c.conname, a.attname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'fault_catalog_parts'::regclass AND c.contype = 'f'
      AND ((a.attname = 'fault_catalog_id' AND c.confdeltype <> 'c')
        OR (a.attname = 'part_id' AND c.confdeltype <> 'r'))
  LOOP
    EXECUTE format('ALTER TABLE fault_catalog_parts DROP CONSTRAINT %I', fk.conname);
    IF fk.attname = 'fault_catalog_id' THEN
      ALTER TABLE fault_catalog_parts ADD CONSTRAINT fault_catalog_parts_fault_catalog_id_fault_catalog_id_fk
        FOREIGN KEY (fault_catalog_id) REFERENCES fault_catalog(id) ON DELETE CASCADE;
    ELSE
      ALTER TABLE fault_catalog_parts ADD CONSTRAINT fault_catalog_parts_part_id_parts_id_fk
        FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE RESTRICT;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM fault_catalog_parts
  WHERE id NOT IN (
    SELECT min(id) FROM fault_catalog_parts GROUP BY fault_catalog_id, part_id, quantity, is_optional
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    RAISE NOTICE 'fault_catalog_parts : % doublon(s) identique(s) (panne, pièce, quantité, optionnel) supprimé(s), ligne la plus ancienne conservée', removed;
  END IF;
  IF EXISTS (SELECT 1 FROM fault_catalog_parts GROUP BY fault_catalog_id, part_id HAVING count(*) > 1) THEN
    RAISE WARNING 'ux_fault_catalog_parts_fault_part non posé : lignes divergentes (quantité ou optionnel) pour un même couple (panne, pièce)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fault_catalog_parts_fault_part ON fault_catalog_parts (fault_catalog_id, part_id);
  END IF;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS ux_part_specifications_name_part ON part_specifications (lower(specification_name), part_id);
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'ux_part_specifications_name_part non posé : spécifications homonymes existantes pour une même pièce';
END $$;
DROP INDEX IF EXISTS ux_part_specifications_part_name;`;

/**
 * Cycle de vie du véhicule : journal des désactivations de la suppression douce (vehicle_deletion_effects)
 * et auteur de la suppression (vehicles.deleted_by). Doit rester identique à
 * server/db/migrations/20261105_vehicle_lifecycle.sql : tests/unit/server/vehicle-lifecycle-schema.test.ts
 * compare les deux. Verrou indisponible sous 5 s : WARNING, réessayé au démarrage suivant.
 */
export const VEHICLE_LIFECYCLE_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
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
END $$;`;

/**
 * P3-2 : récépissé provisoire d'une demande de renouvellement (date de validité, fichier, qui et quand).
 * Rend le véhicule éligible jusqu'à receipt_valid_until inclus ; distinct de proof_file_*, preuve de clôture.
 * CHECK document_renewal_requests_receipt_complete : date, chemin, nom et date de dépôt tous NULL ou tous
 * renseignés (receipt_uploaded_by exclu, NULL admis). FK et CHECK dans deux blocs DO : l'échec de l'une
 * n'annule pas l'autre ; l'écart est relu par reportDocumentRenewalReceiptGaps. Doit rester identique à
 * server/db/migrations/20261103_document_renewal_receipt.sql : tests/unit/server/document-renewal-receipt-schema.test.ts
 * compare les deux. Un seul envoi = une transaction, sérialisée par le verrou consultatif.
 */
export const DOCUMENT_RENEWAL_RECEIPT_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_valid_until date;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_file_name text;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_file_path text;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_uploaded_at timestamp;
  ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS receipt_uploaded_by integer;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'document_renewal_requests : colonnes receipt_* non ajoutées, verrou de table indisponible sous 5 s';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_uploaded_by_users_id_fk'
  ) THEN
    ALTER TABLE document_renewal_requests ADD CONSTRAINT document_renewal_requests_receipt_uploaded_by_users_id_fk
      FOREIGN KEY (receipt_uploaded_by) REFERENCES users(id) NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_uploaded_by_users_id_fk' AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE document_renewal_requests VALIDATE CONSTRAINT document_renewal_requests_receipt_uploaded_by_users_id_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'document_renewal_requests_receipt_uploaded_by_users_id_fk laissée NOT VALID : receipt_uploaded_by vers un utilisateur absent';
    END;
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_column THEN
  RAISE WARNING 'document_renewal_requests_receipt_uploaded_by_users_id_fk non posée : verrou indisponible ou colonne receipt_uploaded_by absente';
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_complete'
      AND pg_get_constraintdef(oid) NOT LIKE '%receipt_uploaded_at%'
  ) THEN
    ALTER TABLE document_renewal_requests DROP CONSTRAINT document_renewal_requests_receipt_complete;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_complete'
  ) THEN
    ALTER TABLE document_renewal_requests ADD CONSTRAINT document_renewal_requests_receipt_complete
      CHECK (num_nulls(receipt_valid_until, receipt_file_path, receipt_file_name, receipt_uploaded_at) IN (0, 4)) NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_renewal_requests'::regclass
      AND conname = 'document_renewal_requests_receipt_complete' AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE document_renewal_requests VALIDATE CONSTRAINT document_renewal_requests_receipt_complete;
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'document_renewal_requests_receipt_complete laissée NOT VALID : récépissés incomplets dans document_renewal_requests';
    END;
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_column THEN
  RAISE WARNING 'document_renewal_requests_receipt_complete non posée : verrou indisponible ou colonnes receipt_* absentes';
END $$;`;

export const DOCUMENT_RENEWAL_RECEIPT_CONSTRAINTS: readonly string[] = [
  'document_renewal_requests_receipt_uploaded_by_users_id_fk',
  'document_renewal_requests_receipt_complete',
];

/**
 * Le RAISE WARNING des blocs DO n'atteint pas les logs applicatifs : relit pg_constraint après
 * DOCUMENT_RENEWAL_RECEIPT_SQL et journalise toute contrainte absente, non validée, ou CHECK restée
 * à l'ancienne définition (sans receipt_uploaded_at) parce que des lignes violent la nouvelle.
 */
export async function reportDocumentRenewalReceiptGaps(client: Queryable, log: WarnLogger = initLog) {
  const { rows } = await client.query(
    `SELECT conname, convalidated, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = 'document_renewal_requests'::regclass AND conname = ANY($1)`,
    [DOCUMENT_RENEWAL_RECEIPT_CONSTRAINTS],
  );
  const found = new Map(rows.map((r) => [r.conname as string, r]));
  const missing = DOCUMENT_RENEWAL_RECEIPT_CONSTRAINTS.filter((name) => !found.has(name));
  const notValidated = DOCUMENT_RENEWAL_RECEIPT_CONSTRAINTS.filter((name) => found.get(name)?.convalidated === false);
  const check = found.get('document_renewal_requests_receipt_complete');
  const outdated = check && !String(check.def).includes('receipt_uploaded_at') ? [check.conname as string] : [];
  const affected = [...new Set([...missing, ...notValidated, ...outdated])];
  if (affected.length) {
    // Chaque contrainte citée par son nom : la FK (receipt_uploaded_by → users) et la CHECK se corrigent différemment.
    log.warn(
      { missing, notValidated, outdated },
      `Contraintes du récépissé de renouvellement non conformes : ${affected.join(', ')} ` +
        '(FK : receipt_uploaded_by vers un utilisateur absent ; CHECK : récépissés incomplets ; ou verrou de table indisponible)',
    );
  }
  return { missing, notValidated, outdated };
}

/**
 * users.pin : hash bcrypt ou NULL (CHECK users_pin_bcrypt_check), PIN en clair refusé en base. Posée NOT VALID
 * puis validée dans un sous-bloc : un PIN en clair encore présent laisse la contrainte NOT VALID, le démarrage
 * continue, l'écart est relu par reportUsersPinBcryptGaps. Doit rester identique à
 * server/db/migrations/20261104_users_pin_bcrypt_check.sql : tests/unit/server/users-pin-bcrypt-check-schema.test.ts
 * compare les deux. Préfixe écrit [$] : ce gabarit n'interpole rien et vaut le texte du fichier.
 */
export const USERS_PIN_BCRYPT_CHECK_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_pin_bcrypt_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_pin_bcrypt_check
      CHECK (pin IS NULL OR pin ~ '^[$]2[aby][$]') NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_pin_bcrypt_check' AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE users VALIDATE CONSTRAINT users_pin_bcrypt_check;
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'users_pin_bcrypt_check laissée NOT VALID : PIN en clair dans users';
    END;
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_column THEN
  RAISE WARNING 'users_pin_bcrypt_check non posée : verrou indisponible ou colonne pin absente';
END $$;`;

export const USERS_PIN_BCRYPT_CHECK = 'users_pin_bcrypt_check';

/**
 * Le RAISE WARNING n'atteint pas les logs applicatifs : relit pg_constraint après USERS_PIN_BCRYPT_CHECK_SQL et
 * journalise une contrainte absente ou non validée, avec le seul nombre de PIN en clair (jamais une valeur ni un id).
 */
export async function reportUsersPinBcryptGaps(client: Queryable, log: WarnLogger = initLog) {
  const { rows } = await client.query(
    `SELECT convalidated FROM pg_constraint WHERE conrelid = 'users'::regclass AND conname = $1`,
    [USERS_PIN_BCRYPT_CHECK],
  );
  const missing = rows.length === 0;
  const notValidated = rows.length > 0 && rows[0].convalidated === false;
  if (!missing && !notValidated) return { missing, notValidated, plainPins: 0 };
  const { rows: counted } = await client.query(
    `SELECT count(*)::int AS n FROM users WHERE pin IS NOT NULL AND pin !~ '^[$]2[aby][$]'`,
  );
  const plainPins = Number(counted[0].n);
  log.warn(
    { constraint: USERS_PIN_BCRYPT_CHECK, missing, notValidated, plainPins },
    missing
      ? `Contrainte ${USERS_PIN_BCRYPT_CHECK} non posée (verrou de table indisponible) : PIN en clair non refusés en base`
      : `Contrainte ${USERS_PIN_BCRYPT_CHECK} laissée NOT VALID : ${plainPins} PIN en clair dans users, à reprendre en hash bcrypt`,
  );
  return { missing, notValidated, plainPins };
}

/**
 * #113 : une fiche chauffeur par compte (index unique partiel uq_drivers_user_id). Doit rester identique à
 * server/db/migrations/20261103_drivers_user_id_unique.sql : tests/unit/server/drivers-user-id-unique-schema.test.ts
 * compare les deux. Doublons existants : index non posé, rien supprimé, écart relu par reportDriverUserIdUniqueGaps.
 */
export const DRIVERS_USER_ID_UNIQUE_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_drivers_user_id') THEN
    IF EXISTS (SELECT 1 FROM drivers WHERE user_id IS NOT NULL GROUP BY user_id HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_drivers_user_id non posé : comptes liés à plusieurs fiches dans drivers';
    ELSE
      CREATE UNIQUE INDEX uq_drivers_user_id ON drivers (user_id) WHERE user_id IS NOT NULL;
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE WARNING 'uq_drivers_user_id non posé : verrou indisponible ou doublon apparu pendant la création';
END $$;`;

/**
 * Retenues à la source (lot F1) : colonnes clients / client_invoices et leurs CHECK. Doit rester identique à
 * server/db/migrations/20261105_finance_withholding.sql : tests/unit/server/finance-withholding-schema.test.ts
 * compare les deux.
 */
export const FINANCE_WITHHOLDING_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_vat_rate numeric(5,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_is_rate numeric(5,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_is_base text NOT NULL DEFAULT 'ht';
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS deposited_at date;
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS withholding_vat_amount numeric(15,2);
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS withholding_is_amount numeric(15,2);
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS net_payable numeric(15,2);
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS deposited_by integer;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_updated_by integer;
DO $$
DECLARE
  c record;
  f record;
BEGIN
  -- Auteur du dépôt et des taux : ON DELETE SET NULL, la trace ne bloque pas la suppression d'un compte.
  FOR f IN SELECT * FROM (VALUES
    ('client_invoices', 'client_invoices_deposited_by_users_id_fk', 'deposited_by'),
    ('clients', 'clients_withholding_updated_by_users_id_fk', 'withholding_updated_by')
  ) AS v(tbl, name, col) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = f.tbl::regclass AND conname = f.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL', f.tbl, f.name, f.col);
    END IF;
  END LOOP;
  FOR c IN SELECT * FROM (VALUES
    ('clients_withholding_vat_rate_check', 'CHECK (withholding_vat_rate IS NULL OR (withholding_vat_rate >= 0 AND withholding_vat_rate <= 100))'),
    ('clients_withholding_is_rate_check', 'CHECK (withholding_is_rate IS NULL OR (withholding_is_rate >= 0 AND withholding_is_rate <= 100))'),
    ('clients_withholding_is_base_check', 'CHECK (withholding_is_base IN (''ht'', ''ttc''))')
  ) AS v(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'clients'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE clients ADD CONSTRAINT %I %s NOT VALID', c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'clients'::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE clients VALIDATE CONSTRAINT %I', c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'clients : lignes hors contrainte %, laissée NOT VALID', c.name;
      END;
    END IF;
  END LOOP;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes de retenue client non posées : verrou indisponible, nouvel essai au démarrage suivant';
END $$;`;

/**
 * Lot Q1 (drapeau qhse) : contrôles inopinés QHSE. Doit rester identique à
 * server/db/migrations/20261105_qhse_inspections.sql : tests/unit/server/qhse-inspections-schema.test.ts
 * compare les deux. Semis des critères cités par le document QHSE, par code, sans jamais réécrire un critère
 * existant.
 */
export const QHSE_INSPECTIONS_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS qhse_inspection_criteria (
  id serial PRIMARY KEY,
  code text NOT NULL CONSTRAINT qhse_inspection_criteria_code_key UNIQUE,
  label text NOT NULL CONSTRAINT qhse_inspection_criteria_label_check CHECK (length(btrim(label)) > 0),
  category text NOT NULL CONSTRAINT qhse_inspection_criteria_category_check CHECK (category IN ('cabin', 'stop')),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qhse_inspections (
  id serial PRIMARY KEY,
  kind text NOT NULL CONSTRAINT qhse_inspections_kind_check CHECK (kind IN ('cabin', 'stop')),
  inspected_at timestamp NOT NULL DEFAULT now(),
  location text NOT NULL CONSTRAINT qhse_inspections_location_check CHECK (length(btrim(location)) > 0),
  vehicle_id integer NOT NULL REFERENCES vehicles(id),
  driver_id integer NOT NULL REFERENCES drivers(id),
  inspector_id integer NOT NULL REFERENCES users(id),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT qhse_inspections_items_check CHECK (jsonb_typeof(items) = 'array'),
  general_observation text,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qhse_inspections_driver ON qhse_inspections (driver_id, inspected_at);
CREATE INDEX IF NOT EXISTS idx_qhse_inspections_vehicle ON qhse_inspections (vehicle_id);

DO $$
DECLARE
  c record;
  existing text;
BEGIN
  -- Tables déjà créées sans ces contraintes (drizzle-kit push antérieur, push --force) : la création
  -- conditionnelle est sautée. CHECK posé NOT VALID puis validé : une ligne non conforme laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS), pas un démarrage bloqué. Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('qhse_inspection_criteria', 'qhse_inspection_criteria_label_check', 'CHECK (length(btrim(label)) > 0)'),
    ('qhse_inspection_criteria', 'qhse_inspection_criteria_category_check', 'CHECK (category IN (''cabin'', ''stop''))'),
    ('qhse_inspections', 'qhse_inspections_kind_check', 'CHECK (kind IN (''cabin'', ''stop''))'),
    ('qhse_inspections', 'qhse_inspections_location_check', 'CHECK (length(btrim(location)) > 0)'),
    ('qhse_inspections', 'qhse_inspections_items_check', 'CHECK (jsonb_typeof(items) = ''array'')')
  ) AS v(tbl, name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '% : lignes hors contrainte %, laissée NOT VALID', c.tbl, c.name;
      END;
    END IF;
  END LOOP;
  -- Unicité du code sous le nom attendu : celle posée sous un autre nom (qhse_inspection_criteria_code_unique
  -- d'un push Drizzle antérieur) est renommée ; des doublons laissent un WARNING.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'qhse_inspection_criteria'::regclass
                 AND conname = 'qhse_inspection_criteria_code_key') THEN
    SELECT k.conname INTO existing FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.conrelid = 'qhse_inspection_criteria'::regclass AND k.contype = 'u'
      AND cardinality(k.conkey) = 1 AND a.attname = 'code'
    LIMIT 1;
    IF existing IS NOT NULL THEN
      EXECUTE format('ALTER TABLE qhse_inspection_criteria RENAME CONSTRAINT %I TO qhse_inspection_criteria_code_key', existing);
    ELSE
      BEGIN
        ALTER TABLE qhse_inspection_criteria ADD CONSTRAINT qhse_inspection_criteria_code_key UNIQUE (code);
      EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'qhse_inspection_criteria : codes en double, contrainte qhse_inspection_criteria_code_key non posée';
      END;
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes QHSE non réconciliées : verrou de table indisponible';
END $$;

INSERT INTO qhse_inspection_criteria (code, label, category, sort_order) VALUES
  ('cabin_epi', 'Port des EPI', 'cabin', 10),
  ('cabin_tenue_de_route', 'Tenue de route', 'cabin', 20),
  ('cabin_telephone', 'Téléphone au volant', 'cabin', 30),
  ('cabin_ceinture', 'Port de la ceinture', 'cabin', 40),
  ('cabin_fumer_manger', 'Fumer ou manger au volant', 'cabin', 50),
  ('cabin_cession_conduite', 'Cession de la conduite', 'cabin', 60),
  ('cabin_passager', 'Passager à bord', 'cabin', 70),
  ('cabin_exces_vitesse', 'Excès de vitesse', 'cabin', 80),
  ('cabin_signalisation_verticale', 'Respect de la signalisation verticale', 'cabin', 90),
  ('cabin_heures_conduite', 'Heures de conduite', 'cabin', 100),
  ('stop_epi', 'Port des EPI', 'stop', 10),
  ('stop_stationnement', 'Stationnement sur emplacement dédié', 'stop', 20),
  ('stop_cales', 'Utilisation des cales', 'stop', 30),
  ('stop_portieres', 'Fermeture des portières', 'stop', 40),
  ('stop_signalisation_vehicule', 'Signalisation du véhicule', 'stop', 50),
  ('stop_gardien', 'Présence d''un gardien', 'stop', 60)
ON CONFLICT (code) DO NOTHING;`;

/**
 * Clé de requête d'un plein de mission (rejeu sans second débit). Doit rester identique à
 * server/db/migrations/20261103_fuel_records_request_key.sql : tests/unit/server/fuel-records-request-key-schema.test.ts
 * compare les deux.
 */
export const FUEL_RECORDS_REQUEST_KEY_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS request_key text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ux_fuel_records_request_key') THEN
    CREATE UNIQUE INDEX ux_fuel_records_request_key ON fuel_records (request_key);
  END IF;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE WARNING 'ux_fuel_records_request_key non posé : verrou indisponible ou doublon, nouvel essai au démarrage suivant';
END $$;`;

/**
 * Le RAISE WARNING n'atteint pas les logs applicatifs : relit pg_indexes après DRIVERS_USER_ID_UNIQUE_SQL.
 * Index absent : journalise chaque compte lié à plusieurs fiches (identifiants seulement, aucune donnée
 * personnelle) pour que la logistique choisisse la fiche gardée. Rien n'est fusionné ni supprimé ici.
 */
export async function reportDriverUserIdUniqueGaps(client: Queryable, log: WarnLogger = initLog) {
  const { rows: index } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_drivers_user_id'`,
  );
  if (index.length) return { missing: false, duplicates: [] as { userId: number; driverIds: number[] }[] };
  const { rows } = await client.query(
    `SELECT user_id, array_agg(id ORDER BY id) AS driver_ids
       FROM drivers WHERE user_id IS NOT NULL
      GROUP BY user_id HAVING count(*) > 1 ORDER BY user_id`,
  );
  const duplicates = rows.map((r) => ({ userId: Number(r.user_id), driverIds: (r.driver_ids as unknown[]).map(Number) }));
  log.warn(
    { duplicates },
    duplicates.length
      ? `Index uq_drivers_user_id non posé : ${duplicates.length} compte(s) liés à plusieurs fiches chauffeur. ` +
          "La logistique choisit la fiche gardée ; déplacer assignments.driver_id vers elle puis retirer le user_id " +
          "des autres fiches. L'index est posé au démarrage suivant."
      : "Index uq_drivers_user_id non posé : verrou de table indisponible, nouvel essai au démarrage suivant.",
  );
  return { missing: true, duplicates };
}

/**
 * Durcissement de la connexion par PIN : la création d'un compte chauffeur posait le PIN haché comme
 * mot de passe (même chaîne que `users.pin`). Le PIN en clair n'est pas recouvrable, mais l'identité
 * des deux hashs suffit à repérer ces comptes. Chacun reçoit un mot de passe aléatoire que personne
 * ne connaît ; le PIN n'est jamais touché. Idempotent : après passage, password <> pin, le second
 * passage ne trouve plus rien. Retourne le nombre de comptes repris.
 */
export async function revokePinDerivedDriverPasswords(client: Queryable, log: { info: (obj: object, msg: string) => void } = initLog): Promise<number> {
  const { rows } = await client.query(
    `SELECT id FROM users WHERE role = 'driver' AND pin IS NOT NULL AND password = pin ORDER BY id`,
  );
  let reprises = 0;
  for (const row of rows) {
    const hash = await randomPasswordHash();
    // Garde password = pin répétée : un mot de passe changé entre-temps n'est pas écrasé.
    const res = await client.query(
      `UPDATE users SET password = $1 WHERE id = $2 AND role = 'driver' AND password = pin RETURNING id`,
      [hash, row.id],
    );
    reprises += res.rows.length;
  }
  if (reprises > 0) {
    log.info({ reprises }, `${reprises} compte(s) chauffeur : mot de passe dérivé du PIN remplacé par un secret aléatoire`);
  }
  return reprises;
}

/**
 * Alertes carburant d'avant #297 : lien `/vehicles/<id>/fuel`, route absente côté client
 * (clic vers une page introuvable). Réécrites en `/vehicles/<id>`, le lien posé depuis par
 * les triggers et le cycle d'alertes. Idempotent : le second passage ne trouve plus rien.
 * Retourne le nombre d'alertes reprises.
 */
export async function relinkLegacyFuelAlerts(client: Queryable, log: { info: (obj: object, msg: string) => void } = initLog): Promise<number> {
  const res = await client.query(
    `UPDATE alerts SET link = regexp_replace(link, '/fuel$', '') WHERE link ~ '^/vehicles/[0-9]+/fuel$' RETURNING id`,
  );
  const reprises = res.rows.length;
  if (reprises > 0) log.info({ reprises }, `${reprises} alerte(s) carburant : lien /vehicles/<id>/fuel réécrit en /vehicles/<id>`);
  return reprises;
}

/**
 * VEH4 : libère le véhicule quand son dernier OT ouvert est clôturé ou annulé (trigger
 * AFTER UPDATE OF status sur work_orders). Doit rester identique à
 * server/db/migrations/20261102_work_orders_release_vehicle.sql (AGENTS.md §5) : le test
 * tests/unit/server/work-orders-release-vehicle-drift.test.ts compare les deux.
 * Un seul envoi = une transaction, sérialisée par le verrou consultatif.
 */
export const WORK_ORDER_VEHICLE_RELEASE_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE OR REPLACE FUNCTION fn_work_orders_release_vehicle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_created_at timestamp;
BEGIN
  -- Verrou sur le véhicule avant le décompte : deux clôtures simultanées de ses deux derniers OT
  -- sont sérialisées, la seconde voit la première validée et libère le véhicule.
  SELECT status, created_at INTO v_status, v_created_at
  FROM vehicles
  WHERE id = NEW.vehicle_id AND deleted_at IS NULL
  FOR UPDATE;

  -- Seul un véhicule immobilisé par l'atelier est libéré : hors service reste hors service.
  IF v_status IS DISTINCT FROM 'maintenance' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.vehicle_id = NEW.vehicle_id
      AND w.status IN ('pending', 'in_progress', 'awaiting_parts')
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE vehicles SET status = 'operational' WHERE id = NEW.vehicle_id;

  INSERT INTO status_history (vehicle_id, status, date, notes, updated_by_id)
  VALUES (
    NEW.vehicle_id,
    'operational',
    GREATEST((now() AT TIME ZONE 'UTC')::date, v_created_at::date),
    format(
      'Véhicule remis en service - Ordre de travail #%s %s (aucun OT ouvert restant)',
      NEW.id,
      CASE NEW.status WHEN 'cancelled' THEN 'annulé' ELSE 'terminé' END
    ),
    NULL
  );

  PERFORM pg_notify(
    'fleet_events',
    json_build_object(
      'source', 'database',
      'version', 1,
      'entity', 'vehicle',
      'entityId', NEW.vehicle_id,
      'eventType', 'vehicle_status_changed',
      'payload', json_build_object(
        'vehicleId', NEW.vehicle_id,
        'status', 'operational',
        'previousStatus', 'maintenance',
        'workOrderId', NEW.id,
        'source', 'work_order_trigger'
      ),
      'emittedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );

  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_work_orders_release_vehicle
AFTER UPDATE OF status ON work_orders
FOR EACH ROW
WHEN (
  OLD.status IN ('pending', 'in_progress', 'awaiting_parts')
  AND NEW.status NOT IN ('pending', 'in_progress', 'awaiting_parts')
)
EXECUTE FUNCTION fn_work_orders_release_vehicle();`;

/**
 * Miroir de WORK_ORDER_VEHICLE_RELEASE_SQL : un OT clôturé qui redevient ouvert (refus du contrôle
 * qualité, réouverture) immobilise de nouveau le véhicule en service. Doit rester identique à
 * server/db/migrations/20261102_work_orders_hold_vehicle.sql (AGENTS.md §5), comparé par
 * tests/unit/server/work-orders-release-vehicle-drift.test.ts.
 */
export const WORK_ORDER_VEHICLE_HOLD_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE OR REPLACE FUNCTION fn_work_orders_hold_vehicle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_created_at timestamp;
BEGIN
  SELECT status, created_at INTO v_status, v_created_at
  FROM vehicles
  WHERE id = NEW.vehicle_id AND deleted_at IS NULL
  FOR UPDATE;

  -- Seul un véhicule en service est immobilisé : hors service reste hors service, maintenance reste
  -- maintenance (aucune ligne d'historique en double).
  IF v_status IS DISTINCT FROM 'operational' THEN
    RETURN NULL;
  END IF;

  UPDATE vehicles SET status = 'maintenance' WHERE id = NEW.vehicle_id;

  INSERT INTO status_history (vehicle_id, status, date, notes, updated_by_id)
  VALUES (
    NEW.vehicle_id,
    'maintenance',
    GREATEST((now() AT TIME ZONE 'UTC')::date, v_created_at::date),
    format('Véhicule passé en maintenance - Ordre de travail #%s rouvert', NEW.id),
    NULL
  );

  PERFORM pg_notify(
    'fleet_events',
    json_build_object(
      'source', 'database',
      'version', 1,
      'entity', 'vehicle',
      'entityId', NEW.vehicle_id,
      'eventType', 'vehicle_status_changed',
      'payload', json_build_object(
        'vehicleId', NEW.vehicle_id,
        'status', 'maintenance',
        'previousStatus', 'operational',
        'workOrderId', NEW.id,
        'source', 'work_order_trigger'
      ),
      'emittedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );

  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_work_orders_hold_vehicle
AFTER UPDATE OF status ON work_orders
FOR EACH ROW
WHEN (
  OLD.status IN ('completed', 'cancelled')
  AND NEW.status IN ('pending', 'in_progress', 'awaiting_parts')
)
EXECUTE FUNCTION fn_work_orders_hold_vehicle();`;

/**
 * Au moins un administrateur actif reste en base (trigger BEFORE sur users). Doit rester identique à
 * server/db/migrations/20261105_users_keep_active_admin.sql (AGENTS.md §5), comparé par
 * tests/unit/server/users-keep-active-admin-schema.test.ts. Un seul envoi = une transaction.
 */
export const USERS_KEEP_ACTIVE_ADMIN_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE OR REPLACE FUNCTION fn_users_keep_active_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Seule la sortie d'un administrateur actif (suppression, changement de rôle, désactivation) compte.
  IF OLD.role = 'admin' AND OLD.deleted_at IS NULL
     AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'admin' OR NEW.deleted_at IS NOT NULL) THEN
    -- Sérialise les sorties concurrentes : la seconde relit l'état validé par la première.
    PERFORM pg_advisory_xact_lock(hashtext('fleetmaster_last_active_admin'));
    -- Lecture verrouillante (FOR SHARE) : un autre administrateur ne peut pas sortir avant la fin de cette transaction.
    PERFORM 1 FROM users u WHERE u.role = 'admin' AND u.deleted_at IS NULL AND u.id <> OLD.id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Il doit rester au moins un administrateur actif.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'users_keep_one_active_admin';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_users_keep_active_admin
BEFORE UPDATE OF role, deleted_at OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION fn_users_keep_active_admin();`;

/**
 * L1 : budget de mission (drapeau finance), un par mission. Doit rester identique à
 * server/db/migrations/20261105_mission_budgets.sql : tests/unit/server/mission-budgets-schema.test.ts
 * compare les deux. Un seul envoi = une transaction, sérialisée par le verrou consultatif.
 */
export const MISSION_BUDGETS_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE TABLE IF NOT EXISTS mission_budgets (
  id serial PRIMARY KEY,
  mission_id integer NOT NULL
    CONSTRAINT mission_budgets_mission_id_missions_id_fk REFERENCES missions(id),
  budget_date date NOT NULL,
  fuel_liters numeric(12,2) NOT NULL,
  fuel_unit_price numeric(15,2) NOT NULL,
  fuel_amount numeric(15,2) NOT NULL,
  fdr_amount numeric(15,2) NOT NULL,
  extras_amount numeric(15,2) NOT NULL DEFAULT '0',
  total_amount numeric(15,2) NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  notes text,
  treasury_entry_id integer,
  approved_by integer CONSTRAINT mission_budgets_approved_by_users_id_fk REFERENCES users(id),
  approved_at timestamp,
  disbursed_by integer CONSTRAINT mission_budgets_disbursed_by_users_id_fk REFERENCES users(id),
  disbursed_at timestamp,
  created_by integer CONSTRAINT mission_budgets_created_by_users_id_fk REFERENCES users(id),
  updated_by integer CONSTRAINT mission_budgets_updated_by_users_id_fk REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mission_budgets_mission_id_unique UNIQUE (mission_id),
  CONSTRAINT mission_budgets_status_check CHECK (status IN ('requested', 'approved', 'disbursed')),
  CONSTRAINT mission_budgets_amounts_check
    CHECK (fuel_liters >= 0 AND fuel_unit_price >= 0 AND fdr_amount >= 0 AND extras_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_mission_budgets_budget_date ON mission_budgets (budget_date);

DO $$
DECLARE
  c record;
  existing text;
BEGIN
  -- Table déjà créée sans ces contraintes (drizzle-kit push antérieur, push --force) : la création
  -- conditionnelle est sautée. CHECK posé NOT VALID puis validé : une ligne non conforme laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS), pas un démarrage bloqué. Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('mission_budgets_status_check', 'CHECK (status IN (''requested'', ''approved'', ''disbursed''))'),
    ('mission_budgets_amounts_check', 'CHECK (fuel_liters >= 0 AND fuel_unit_price >= 0 AND fdr_amount >= 0 AND extras_amount >= 0)')
  ) AS v(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE mission_budgets ADD CONSTRAINT %I %s NOT VALID', c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE mission_budgets VALIDATE CONSTRAINT %I', c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'mission_budgets : lignes hors contrainte %, laissée NOT VALID', c.name;
      END;
    END IF;
  END LOOP;
  -- Un budget par mission, sous le nom attendu par le service (409) : une unicité posée sous un autre nom
  -- sur mission_id est renommée ; des doublons laissent un WARNING.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass
                 AND conname = 'mission_budgets_mission_id_unique') THEN
    SELECT k.conname INTO existing FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.conrelid = 'mission_budgets'::regclass AND k.contype = 'u'
      AND cardinality(k.conkey) = 1 AND a.attname = 'mission_id'
    LIMIT 1;
    IF existing IS NOT NULL THEN
      EXECUTE format('ALTER TABLE mission_budgets RENAME CONSTRAINT %I TO mission_budgets_mission_id_unique', existing);
    ELSE
      BEGIN
        ALTER TABLE mission_budgets ADD CONSTRAINT mission_budgets_mission_id_unique UNIQUE (mission_id);
      EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'mission_budgets : missions en double, contrainte mission_budgets_mission_id_unique non posée';
      END;
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes mission_budgets non réconciliées : verrou de table indisponible';
END $$;`;

// Grille tarifaire (O3) — jumelle de server/db/migrations/20261106_tariff_grid.sql.
export const TARIFF_GRID_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS tariff_grid (
  id serial PRIMARY KEY,
  client_id integer CONSTRAINT tariff_grid_client_id_clients_id_fk REFERENCES clients(id),
  origin text NOT NULL,
  destination text NOT NULL,
  cargo_type text NOT NULL DEFAULT '',
  pricing_unit text NOT NULL,
  unit_price numeric(15,0) NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by integer CONSTRAINT tariff_grid_created_by_users_id_fk REFERENCES users(id),
  updated_by integer CONSTRAINT tariff_grid_updated_by_users_id_fk REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT tariff_grid_pricing_unit_check CHECK (pricing_unit IN ('ton', 'container', 'trip')),
  CONSTRAINT tariff_grid_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT tariff_grid_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS tariff_grid_key_unique
  ON tariff_grid ((CASE WHEN client_id IS NULL THEN 0 ELSE client_id END), (lower(origin)), (lower(destination)), (lower(cargo_type)), (valid_from))
  WHERE active;

DO $$
DECLARE
  c record;
BEGIN
  -- Table déjà créée sans ces contraintes : CHECK posé NOT VALID puis validé ; une ligne non conforme
  -- laisse un WARNING, relu par reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS). Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('tariff_grid_pricing_unit_check', 'CHECK (pricing_unit IN (''ton'', ''container'', ''trip''))'),
    ('tariff_grid_unit_price_check', 'CHECK (unit_price >= 0)'),
    ('tariff_grid_period_check', 'CHECK (valid_to IS NULL OR valid_to >= valid_from)')
  ) AS t(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tariff_grid'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE tariff_grid ADD CONSTRAINT %I %s NOT VALID', c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tariff_grid'::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE tariff_grid VALIDATE CONSTRAINT %I', c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'tariff_grid : lignes hors contrainte %, laissée NOT VALID', c.name;
      END;
    END IF;
  END LOOP;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes tariff_grid non réconciliées : verrou de table indisponible';
END $$;
`;

// Prix convenu d'une mission (O3 lot 3) — jumelle de server/db/migrations/20261106_mission_agreed_price.sql.
// Après TARIFF_GRID_SQL : tariff_grid_id référence tariff_grid. Ni seed ni rétro-remplissage.
export const MISSION_AGREED_PRICE_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'missions' AND column_name = 'agreed_price') THEN
    ALTER TABLE missions ADD COLUMN agreed_price numeric(15,0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'missions' AND column_name = 'tariff_grid_id') THEN
    ALTER TABLE missions ADD COLUMN tariff_grid_id integer;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'missions.agreed_price / tariff_grid_id non ajoutées : verrou indisponible';
END $$;

DO $$
BEGIN
  -- Posée NOT VALID puis validée : un tariff_grid_id orphelin laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS), pas un démarrage bloqué.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'missions'::regclass
                 AND conname = 'missions_tariff_grid_id_tariff_grid_id_fk') THEN
    ALTER TABLE missions
      ADD CONSTRAINT missions_tariff_grid_id_tariff_grid_id_fk
      FOREIGN KEY (tariff_grid_id) REFERENCES tariff_grid(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'missions'::regclass
             AND conname = 'missions_tariff_grid_id_tariff_grid_id_fk' AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE missions VALIDATE CONSTRAINT missions_tariff_grid_id_tariff_grid_id_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'missions_tariff_grid_id_tariff_grid_id_fk laissée NOT VALID : tariff_grid_id vers un tarif absent';
    END;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'missions_tariff_grid_id_tariff_grid_id_fk non posée : verrou indisponible';
END $$;`;

// Barème FDR par destination (L1b) — jumelle de server/db/migrations/20261105_mission_destinations.sql.
// Après MISSION_BUDGETS_SQL : ajoute destination_id à mission_budgets.
export const MISSION_DESTINATIONS_SQL = `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE TABLE IF NOT EXISTS mission_destinations (
  id serial PRIMARY KEY,
  code text NOT NULL,
  label text NOT NULL,
  fuel_liters numeric(12,2) NOT NULL,
  fdr_amount numeric(15,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by integer CONSTRAINT mission_destinations_created_by_users_id_fk REFERENCES users(id),
  updated_by integer CONSTRAINT mission_destinations_updated_by_users_id_fk REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mission_destinations_code_unique UNIQUE (code),
  CONSTRAINT mission_destinations_amounts_check CHECK (fuel_liters >= 0 AND fdr_amount >= 0)
);

DO $$
DECLARE
  existing text;
BEGIN
  -- Table déjà créée sans ces contraintes (drizzle-kit push antérieur, push --force) : la création
  -- conditionnelle est sautée. CHECK posé NOT VALID puis validé : une ligne non conforme laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS). Noms identiques à shared/schema.ts.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_destinations'::regclass
                 AND conname = 'mission_destinations_amounts_check') THEN
    ALTER TABLE mission_destinations ADD CONSTRAINT mission_destinations_amounts_check
      CHECK (fuel_liters >= 0 AND fdr_amount >= 0) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_destinations'::regclass
             AND conname = 'mission_destinations_amounts_check' AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE mission_destinations VALIDATE CONSTRAINT mission_destinations_amounts_check;
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'mission_destinations : lignes hors contrainte mission_destinations_amounts_check, laissée NOT VALID';
    END;
  END IF;
  -- Unicité du code sous le nom attendu : celle posée sous un autre nom est renommée ; des doublons laissent un WARNING.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_destinations'::regclass
                 AND conname = 'mission_destinations_code_unique') THEN
    SELECT k.conname INTO existing FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.conrelid = 'mission_destinations'::regclass AND k.contype = 'u'
      AND cardinality(k.conkey) = 1 AND a.attname = 'code'
    LIMIT 1;
    IF existing IS NOT NULL THEN
      EXECUTE format('ALTER TABLE mission_destinations RENAME CONSTRAINT %I TO mission_destinations_code_unique', existing);
    ELSE
      BEGIN
        ALTER TABLE mission_destinations ADD CONSTRAINT mission_destinations_code_unique UNIQUE (code);
      EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'mission_destinations : codes en double, contrainte mission_destinations_code_unique non posée';
      END;
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes mission_destinations non réconciliées : verrou de table indisponible';
END $$;

INSERT INTO mission_destinations (code, label, fuel_liters, fdr_amount) VALUES
  ('ndjamena', 'N''Djamena', 750, 150000),
  ('kome', 'Komé', 450, 100000),
  ('sarh', 'Sarh', 700, 150000),
  ('ngong', 'Ngong', 350, 40000),
  ('douala', 'Douala', 591, 107000)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE mission_budgets ADD COLUMN IF NOT EXISTS destination_id integer;

DO $$
BEGIN
  -- Posée NOT VALID puis validée : une destination_id orpheline laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS), pas un démarrage bloqué.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass
                 AND conname = 'mission_budgets_destination_id_mission_destinations_id_fk') THEN
    ALTER TABLE mission_budgets
      ADD CONSTRAINT mission_budgets_destination_id_mission_destinations_id_fk
      FOREIGN KEY (destination_id) REFERENCES mission_destinations(id) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass
             AND conname = 'mission_budgets_destination_id_mission_destinations_id_fk' AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE mission_budgets VALIDATE CONSTRAINT mission_budgets_destination_id_mission_destinations_id_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'mission_budgets_destination_id_mission_destinations_id_fk laissée NOT VALID : destination_id vers une destination absente';
    END;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'mission_budgets_destination_id_mission_destinations_id_fk non posée : verrou indisponible';
END $$;`;

async function applyWorkOrderVehicleStatusTriggers() {
  await pool.query(WORK_ORDER_VEHICLE_RELEASE_SQL);
  await pool.query(WORK_ORDER_VEHICLE_HOLD_SQL);
}

async function applyLotRecetteSchema() {
  await pool.query(LOT_RECETTE_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join(String.fromCharCode(10)));
}

/**
 * Schéma additif du chantier CDC (écarts du cahier des charges #3, #7, #9, #10). Doit rester
 * identique à server/db/migrations/20261101_cdc_ecarts.sql (AGENTS.md §5) : le test
 * tests/unit/server/cdc-schema-drift.test.ts compare les deux. Même protocole que le lot
 * recette : un seul envoi = une transaction, verrou consultatif en tête.
 */
export const CDC_SCHEMA_STATEMENTS: readonly string[] = [
  `SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'))`,
  `CREATE INDEX IF NOT EXISTS parts_reference_key_idx ON parts (upper(btrim(reference)))`,
  `DO $$
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
END $$`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS due_mileage integer CONSTRAINT work_orders_due_mileage_check CHECK (due_mileage IS NULL OR due_mileage >= 0)`,
  `DO $$
BEGIN
  -- Base créée par drizzle-kit push : la colonne existe déjà, l'ADD COLUMN ci-dessus n'a pas posé le CHECK.
  -- NOT VALID : les lignes existantes ne bloquent pas le démarrage, les écritures suivantes sont contrôlées.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'work_orders'::regclass AND conname = 'work_orders_due_mileage_check'
  ) THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_due_mileage_check CHECK (due_mileage IS NULL OR due_mileage >= 0) NOT VALID;
  END IF;
END $$`,
  `CREATE INDEX IF NOT EXISTS work_orders_preventive_due_idx ON work_orders (due_date) WHERE is_preventive`,
  `CREATE TABLE IF NOT EXISTS workshop_labor_rates (
  id serial PRIMARY KEY,
  effective_from date NOT NULL UNIQUE,
  hourly_rate_ht numeric(15,2) NOT NULL CHECK (hourly_rate_ht >= 0),
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS import_batches (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('vehicles', 'interventions')),
  file_name text,
  file_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS import_batches_applied_file_uidx ON import_batches (kind, file_sha256) WHERE status = 'applied'`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS origin text`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS external_ref text`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS import_fingerprint text`,
  `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS import_batch_id integer REFERENCES import_batches(id) ON DELETE SET NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_orders_external_ref_uidx ON work_orders (external_ref) WHERE external_ref IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_orders_import_fingerprint_uidx ON work_orders (import_fingerprint) WHERE import_fingerprint IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS work_orders_import_batch_idx ON work_orders (import_batch_id) WHERE import_batch_id IS NOT NULL`,
  `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS import_batch_id integer REFERENCES import_batches(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS vehicles_import_batch_idx ON vehicles (import_batch_id) WHERE import_batch_id IS NOT NULL`,
  `DO $$
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
END $$`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
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
)`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx ON idempotency_keys (expires_at)`,
  `DO $$
DECLARE
  c record;
  existing text;
  duplicates integer;
BEGIN
  -- Base dont les tables CDC ont été créées par drizzle-kit push avant que Drizzle déclare
  -- ces contraintes : CREATE TABLE IF NOT EXISTS a été sauté, elles manquent. Rien à faire sinon.
  -- CHECK posé en NOT VALID puis validé : une ligne non conforme laisse un WARNING, pas un démarrage bloqué.
  FOR c IN SELECT * FROM (VALUES
    ('workshop_labor_rates', 'workshop_labor_rates_hourly_rate_ht_check', 'CHECK (hourly_rate_ht >= 0)'),
    ('import_batches', 'import_batches_kind_check', 'CHECK (kind IN (''vehicles'', ''interventions''))'),
    ('import_batches', 'import_batches_status_check', 'CHECK (status IN (''applied'', ''failed''))'),
    ('idempotency_keys', 'idempotency_keys_state_check', 'CHECK (state IN (''in_progress'', ''completed''))')
  ) AS v(tbl, name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '% : lignes hors contrainte %, laissée NOT VALID', c.tbl, c.name;
      END;
    END IF;
  END LOOP;
  -- UNIQUE sous le nom attendu par les services (409 sur conflit), colonnes dans l'ordre déclaré
  -- par Drizzle : une unicité posée sous un autre nom sur les mêmes colonnes est renommée ; des
  -- doublons existants laissent la base en l'état, avec un WARNING, plutôt que de bloquer le démarrage.
  -- Un index UNIQUE seul, sans contrainte, n'est pas reconnu : une seconde unicité serait posée à côté.
  FOR c IN SELECT * FROM (VALUES
    ('workshop_labor_rates', 'workshop_labor_rates_effective_from_key', ARRAY['effective_from']),
    ('idempotency_keys', 'idempotency_keys_user_id_key_key', ARRAY['user_id', 'key'])
  ) AS v(tbl, name, cols) LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      CONTINUE;
    END IF;
    existing := NULL;
    SELECT k.conname INTO existing FROM pg_constraint k
    WHERE k.conrelid = c.tbl::regclass AND k.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
           WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey))
        = (SELECT array_agg(x ORDER BY x) FROM unnest(c.cols) AS x)
    LIMIT 1;
    IF existing IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', c.tbl, existing, c.name);
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %I GROUP BY %s HAVING count(*) > 1) d',
      c.tbl, array_to_string(c.cols, ', ')) INTO duplicates;
    IF duplicates > 0 THEN
      RAISE WARNING '% : % doublon(s), contrainte % non posée', c.tbl, duplicates, c.name;
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%s)', c.tbl, c.name, array_to_string(c.cols, ', '));
    END IF;
  END LOOP;
END $$`,
];

// Contraintes CDC réconciliées au démarrage. Le RAISE WARNING du bloc n'atteint pas les logs
// applicatifs (aucun écouteur de notice) : l'écart restant est relu ici et journalisé.
export const CDC_RECONCILED_CONSTRAINTS: readonly string[] = [
  'workshop_labor_rates_hourly_rate_ht_check',
  'import_batches_kind_check',
  'import_batches_status_check',
  'idempotency_keys_state_check',
  'workshop_labor_rates_effective_from_key',
  'idempotency_keys_user_id_key_key',
  // Retenues à la source (F1) : posées et validées par FINANCE_WITHHOLDING_SQL, avant ce relevé.
  'clients_withholding_vat_rate_check',
  'clients_withholding_is_rate_check',
  'clients_withholding_is_base_check',
  // Posées par QHSE_INSPECTIONS_SQL (lot Q1), relues ici au même titre.
  'qhse_inspection_criteria_code_key',
  'qhse_inspection_criteria_label_check',
  'qhse_inspection_criteria_category_check',
  'qhse_inspections_kind_check',
  'qhse_inspections_location_check',
  'qhse_inspections_items_check',
  // Posées par MISSION_BUDGETS_SQL (lot L1), relues ici au même titre.
  'mission_budgets_status_check',
  'mission_budgets_amounts_check',
  'mission_budgets_mission_id_unique',
  // Posées par MISSION_DESTINATIONS_SQL (lot L1b).
  'mission_destinations_amounts_check',
  'mission_destinations_code_unique',
  'mission_budgets_destination_id_mission_destinations_id_fk',
  'missions_tariff_grid_id_tariff_grid_id_fk',
  // Posées par TARIFF_GRID_SQL (lot O3).
  'tariff_grid_pricing_unit_check',
  'tariff_grid_unit_price_check',
  'tariff_grid_period_check',
];

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };
type WarnLogger = { warn: (obj: object, msg: string) => void };

/** Contraintes absentes ou laissées NOT VALID (lignes non conformes ou doublons), journalisées en warn. */
export async function reportCdcConstraintGaps(
  client: Queryable,
  log: WarnLogger = initLog,
  names: readonly string[] = CDC_RECONCILED_CONSTRAINTS,
) {
  const { rows } = await client.query(
    `SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1)`,
    [names],
  );
  const found = new Map(rows.map((r) => [r.conname as string, r.convalidated as boolean]));
  const missing = names.filter((name) => !found.has(name));
  const notValidated = names.filter((name) => found.get(name) === false);
  if (missing.length || notValidated.length) {
    log.warn(
      { missing, notValidated },
      'Contraintes de base incomplètes : données existantes à corriger (doublons ou valeurs hors contrainte)',
    );
  }
  return { missing, notValidated };
}

async function applyCdcSchema() {
  await pool.query(CDC_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join(String.fromCharCode(10)));
}

/** Liste SQL des catégories, tirée du contrat partagé : la CHECK suit TREASURY_CATEGORIES sans copie à tenir. */
const TREASURY_CATEGORY_CHECK = `category IN (${TREASURY_CATEGORIES.map((c) => `'${c}'`).join(', ')})`;

/** Journal de trésorerie (lot T1) : tables et index, idempotents. Jumelle de shared/schema.ts (treasuryAccounts, treasuryEntries). */
export const TREASURY_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS treasury_accounts (
    id serial PRIMARY KEY,
    code text NOT NULL CONSTRAINT treasury_accounts_code_key UNIQUE,
    label text NOT NULL,
    kind text NOT NULL,
    bank_name text,
    opening_balance numeric(15,2) NOT NULL DEFAULT 0,
    opening_date date,
    is_active boolean NOT NULL DEFAULT true,
    created_by integer REFERENCES users(id),
    updated_by integer REFERENCES users(id),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT treasury_accounts_kind_check CHECK (kind IN ('bank', 'cash', 'fuel_card'))
  )`,
  `CREATE TABLE IF NOT EXISTS treasury_entries (
    id serial PRIMARY KEY,
    account_id integer NOT NULL REFERENCES treasury_accounts(id),
    entry_date date NOT NULL,
    piece_ref text,
    label text NOT NULL,
    direction text NOT NULL,
    amount numeric(15,2) NOT NULL,
    category text NOT NULL DEFAULT 'autre',
    counterparty_label text,
    transfer_group text,
    notes text,
    vehicle_id integer REFERENCES vehicles(id) ON DELETE SET NULL,
    mission_id integer REFERENCES missions(id) ON DELETE SET NULL,
    client_id integer REFERENCES clients(id),
    supplier_id integer REFERENCES suppliers(id),
    request_key text CONSTRAINT treasury_entries_request_key_key UNIQUE,
    created_by integer REFERENCES users(id),
    updated_by integer REFERENCES users(id),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT treasury_entries_amount_check CHECK (amount > 0),
    CONSTRAINT treasury_entries_direction_check CHECK (direction IN ('in', 'out')),
    CONSTRAINT treasury_entries_category_check CHECK (${TREASURY_CATEGORY_CHECK})
  )`,
  `CREATE INDEX IF NOT EXISTS idx_treasury_entries_account_date ON treasury_entries (account_id, entry_date, id)`,
  `CREATE INDEX IF NOT EXISTS idx_treasury_entries_transfer_group ON treasury_entries (transfer_group)`,
  // Lots T2 et T3 : liens plein/recharge et règlement fournisseur, carte carburant active unique.
  `ALTER TABLE treasury_entries ADD COLUMN IF NOT EXISTS fuel_record_id integer REFERENCES fuel_records(id) ON DELETE SET NULL`,
  `ALTER TABLE treasury_entries ADD COLUMN IF NOT EXISTS supplier_settlement_id integer REFERENCES supplier_invoice_settlements(id) ON DELETE SET NULL`,
  `ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS treasury_account_id integer REFERENCES treasury_accounts(id)`,
  // Lot T4 : traites et chèques. Jumelle de shared/schema.ts (paymentInstruments).
  `CREATE TABLE IF NOT EXISTS payment_instruments (
    id serial PRIMARY KEY,
    kind text NOT NULL,
    direction text NOT NULL DEFAULT 'outgoing',
    number text NOT NULL,
    drawer text NOT NULL,
    drawee text NOT NULL,
    paying_bank text,
    amount numeric(15,2) NOT NULL,
    issue_date date NOT NULL,
    due_date date NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    paid_at date,
    treasury_entry_id integer REFERENCES treasury_entries(id) CONSTRAINT payment_instruments_treasury_entry_id_key UNIQUE,
    supplier_id integer REFERENCES suppliers(id),
    client_id integer REFERENCES clients(id),
    vehicle_id integer REFERENCES vehicles(id),
    observations text,
    request_key text CONSTRAINT payment_instruments_request_key_key UNIQUE,
    created_by integer REFERENCES users(id),
    updated_by integer REFERENCES users(id),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT payment_instruments_kind_check CHECK (kind IN ('traite', 'cheque')),
    CONSTRAINT payment_instruments_direction_check CHECK (direction IN ('outgoing', 'incoming')),
    CONSTRAINT payment_instruments_status_check CHECK (status IN ('pending', 'paid', 'bounced', 'cancelled')),
    CONSTRAINT payment_instruments_amount_check CHECK (amount > 0),
    CONSTRAINT payment_instruments_dates_check CHECK (due_date >= issue_date),
    CONSTRAINT payment_instruments_paid_check CHECK ((status = 'paid') = (paid_at IS NOT NULL AND treasury_entry_id IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payment_instruments_status_due ON payment_instruments (status, due_date)`,
  // Deux cartes actives déjà en base : WARNING, l'index attend qu'on en désactive une (démarrage non bloqué).
  // Verrou de table indisponible sous 5 s : WARNING aussi, l'index est retenté au démarrage suivant.
  `DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  IF to_regclass('uq_treasury_accounts_active_fuel_card') IS NOT NULL THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM treasury_accounts WHERE kind = 'fuel_card' AND is_active) > 1 THEN
    RAISE WARNING 'treasury_accounts : plusieurs cartes carburant actives, index uq_treasury_accounts_active_fuel_card non posé';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_accounts_active_fuel_card ON treasury_accounts (kind) WHERE kind = 'fuel_card' AND is_active;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'treasury_accounts : index uq_treasury_accounts_active_fuel_card non posé, verrou de table indisponible sous 5 s';
END $$`,
  // Véhicule ou mission supprimés (restauration de sauvegarde, purge) : l'écriture reste, son lien passe à NULL.
  // Une FK posée sans ON DELETE est remplacée sous le même nom, dans une seule instruction. Verrou
  // indisponible sous 5 s : WARNING, rien n'est remplacé (bloc annulé en entier), retenté au démarrage suivant.
  `DO $$
DECLARE
  c record;
  fk record;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  FOR c IN SELECT * FROM (VALUES ('vehicle_id', 'vehicles'), ('mission_id', 'missions')) AS v(col, ref) LOOP
    FOR fk IN
      SELECT k.conname FROM pg_constraint k
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
      WHERE k.conrelid = 'treasury_entries'::regclass AND k.contype = 'f' AND a.attname = c.col AND k.confdeltype <> 'n'
    LOOP
      EXECUTE format('ALTER TABLE treasury_entries DROP CONSTRAINT %I, ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL',
        fk.conname, fk.conname, c.col, c.ref);
    END LOOP;
  END LOOP;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'treasury_entries : FK vehicle_id et mission_id non passées en ON DELETE SET NULL, verrou de table indisponible sous 5 s';
END $$`,
  // Tables créées par drizzle-kit push, ou avant qu'une contrainte soit déclarée : CREATE TABLE IF NOT EXISTS
  // a été sauté. Même réconciliation que le schéma CDC : CHECK en NOT VALID puis VALIDATE, UNIQUE renommé
  // s'il existe sous un autre nom, WARNING plutôt que démarrage bloqué si des lignes existantes dérogent.
  `DO $$
DECLARE
  c record;
  existing text;
  duplicates integer;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('treasury_accounts', 'treasury_accounts_kind_check', 'CHECK (kind IN (''bank'', ''cash'', ''fuel_card''))'),
    ('treasury_entries', 'treasury_entries_amount_check', 'CHECK (amount > 0)'),
    ('treasury_entries', 'treasury_entries_direction_check', 'CHECK (direction IN (''in'', ''out''))'),
    ('treasury_entries', 'treasury_entries_category_check', 'CHECK (${TREASURY_CATEGORY_CHECK.replace(/'/g, "''")})'),
    ('payment_instruments', 'payment_instruments_kind_check', 'CHECK (kind IN (''traite'', ''cheque''))'),
    ('payment_instruments', 'payment_instruments_direction_check', 'CHECK (direction IN (''outgoing'', ''incoming''))'),
    ('payment_instruments', 'payment_instruments_status_check', 'CHECK (status IN (''pending'', ''paid'', ''bounced'', ''cancelled''))'),
    ('payment_instruments', 'payment_instruments_amount_check', 'CHECK (amount > 0)'),
    ('payment_instruments', 'payment_instruments_dates_check', 'CHECK (due_date >= issue_date)'),
    ('payment_instruments', 'payment_instruments_paid_check', 'CHECK ((status = ''paid'') = (paid_at IS NOT NULL AND treasury_entry_id IS NOT NULL))')
  ) AS v(tbl, name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '% : lignes hors contrainte %, laissée NOT VALID', c.tbl, c.name;
      END;
    END IF;
  END LOOP;
  FOR c IN SELECT * FROM (VALUES
    ('treasury_accounts', 'treasury_accounts_code_key', ARRAY['code']),
    ('treasury_entries', 'treasury_entries_request_key_key', ARRAY['request_key']),
    ('payment_instruments', 'payment_instruments_request_key_key', ARRAY['request_key']),
    ('payment_instruments', 'payment_instruments_treasury_entry_id_key', ARRAY['treasury_entry_id'])
  ) AS v(tbl, name, cols) LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      CONTINUE;
    END IF;
    existing := NULL;
    SELECT k.conname INTO existing FROM pg_constraint k
    WHERE k.conrelid = c.tbl::regclass AND k.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
           WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey))
        = (SELECT array_agg(x ORDER BY x) FROM unnest(c.cols) AS x)
    LIMIT 1;
    IF existing IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', c.tbl, existing, c.name);
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %I WHERE %I IS NOT NULL GROUP BY %s HAVING count(*) > 1) d',
      c.tbl, c.cols[1], array_to_string(c.cols, ', ')) INTO duplicates;
    IF duplicates > 0 THEN
      RAISE WARNING '% : % doublon(s), contrainte % non posée', c.tbl, duplicates, c.name;
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%s)', c.tbl, c.name, array_to_string(c.cols, ', '));
    END IF;
  END LOOP;
END $$`,
];

// Contraintes de trésorerie réconciliées au démarrage, relues et journalisées comme celles du CDC.
export const TREASURY_RECONCILED_CONSTRAINTS: readonly string[] = [
  'treasury_accounts_kind_check',
  'treasury_entries_amount_check',
  'treasury_entries_direction_check',
  'treasury_entries_category_check',
  'treasury_accounts_code_key',
  'treasury_entries_request_key_key',
  'payment_instruments_kind_check',
  'payment_instruments_direction_check',
  'payment_instruments_status_check',
  'payment_instruments_amount_check',
  'payment_instruments_dates_check',
  'payment_instruments_paid_check',
  'payment_instruments_request_key_key',
  'payment_instruments_treasury_entry_id_key',
];

async function applyTreasurySchema() {
  for (const statement of TREASURY_SCHEMA_STATEMENTS) await pool.query(statement);
  await reportCdcConstraintGaps(pool, initLog, TREASURY_RECONCILED_CONSTRAINTS);
}

export async function initializeDatabase() {
  console.log('🌱 Vérification de la base de données...');

  try {
    // Assure la compatibilité du schéma en base pour le suivi de la dernière connexion
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamp`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin text`);
    // Droit de sortie de stock du chef d'atelier, retirable par l'admin (20261031_users_can_issue_stock.sql).
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_issue_stock boolean NOT NULL DEFAULT true`);
    await db.execute(sql`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id)`);
    // Traçabilité stock parts + tires — doit rester ici ET dans server/db/migrations/
    // (voir AGENTS.md §5). Un fichier SQL seul ne garantit rien sur une base vierge.
    await db.execute(sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now()`);
    await db.execute(sql`
      UPDATE parts
      SET updated_at = COALESCE(updated_at, created_at, now())
      WHERE updated_at IS NULL
    `);
    await db.execute(sql`ALTER TABLE tires ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE tires ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id)`);
    // Stock pneu usagé séparé du neuf — jumelle de server/db/migrations/20261101_tires_used_stock.sql.
    await db.execute(sql`ALTER TABLE tires ADD COLUMN IF NOT EXISTS used_stock_quantity integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE vehicle_tires ADD COLUMN IF NOT EXISTS stock_source text NOT NULL DEFAULT 'new'`);
    await db.execute(sql`
      UPDATE tires
      SET updated_at = COALESCE(updated_at, created_at, now())
      WHERE updated_at IS NULL
    `);
    await db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE vehicle_documents ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hire_date date`);
    // Une fiche chauffeur par compte (#113) — jumelle de server/db/migrations/20261103_drivers_user_id_unique.sql.
    await pool.query(DRIVERS_USER_ID_UNIQUE_SQL);
    await reportDriverUserIdUniqueGaps(pool);
    // Contrôles inopinés QHSE (lot Q1) — jumelle de server/db/migrations/20261105_qhse_inspections.sql.
    await pool.query(QHSE_INSPECTIONS_SQL);
    // Cycle de vie du véhicule — jumelle de server/db/migrations/20261105_vehicle_lifecycle.sql.
    await pool.query(VEHICLE_LIFECYCLE_SQL);
    // Mot de passe chauffeur dérivé du PIN : remplacé par un secret aléatoire (idempotent, PIN intact).
    await revokePinDerivedDriverPasswords(pool);
    // Liens d'alertes carburant vers une route inexistante : réécrits (idempotent, #297).
    await relinkLegacyFuelAlerts(pool);
    await db.execute(sql`ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS mission_id integer REFERENCES missions(id) ON DELETE SET NULL`);
    // Clé de requête des pleins de mission — jumelle de server/db/migrations/20261103_fuel_records_request_key.sql.
    await pool.query(FUEL_RECORDS_REQUEST_KEY_SQL);
    // Retenues à la source (F1) — jumelle de server/db/migrations/20261105_finance_withholding.sql.
    await pool.query(FINANCE_WITHHOLDING_SQL);
    // Suppression douce des pleins qui ont mouvementé la carte — jumelle de server/db/migrations/20261103_fuel_records_soft_delete.sql.
    await db.execute(sql`ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS deleted_at timestamp`);
    await db.execute(sql`ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id)`);
    // Le RAISE WARNING n'atteint pas les logs applicatifs : relire pg_indexes.
    const { rows: requestKeyIndex } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ux_fuel_records_request_key'`,
    );
    if (!requestKeyIndex.length) {
      initLog.warn(
        "Index ux_fuel_records_request_key non posé (verrou de table indisponible) : le rejeu reste contrôlé sous le " +
          "verrou de la carte carburant ; nouvel essai au démarrage suivant.",
      );
    }
    // Entrée en stock attribuée au réceptionnaire — doit rester ici ET dans
    // server/db/migrations/20261030_part_requirements_received_by.sql (AGENTS.md §5).
    await db.execute(sql`ALTER TABLE part_requirements ADD COLUMN IF NOT EXISTS received_by integer REFERENCES users(id)`);

    // --- Référentiel pièces: rattachement fournisseur par clé étrangère --------
    // `parts.supplier` (texte libre) reste en place pendant la transition: il sert
    // de valeur d'affichage historique et de source au backfill ci-dessous.
    // La vérité devient `parts.supplier_id`.
    await db.execute(sql`ALTER TABLE parts ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES suppliers(id) ON DELETE SET NULL`);

    // Backfill par correspondance de nom, insensible à la casse et aux espaces
    // superflus (la saisie libre a produit des variantes). Uniquement sur les
    // lignes non encore rattachées: l'opération est rejouable sans effet de bord.
    // Le `IN (SELECT ...)` écarte les noms ambigus qui matcheraient 2 fournisseurs.
    await db.execute(sql`
      UPDATE parts p
      SET supplier_id = s.id
      FROM suppliers s
      WHERE p.supplier_id IS NULL
        AND p.supplier IS NOT NULL
        AND btrim(p.supplier) <> ''
        AND lower(regexp_replace(btrim(p.supplier), '\\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(s.name), '\\s+', ' ', 'g'))
        AND p.supplier IN (
          SELECT p2.supplier
          FROM parts p2
          JOIN suppliers s2
            ON lower(regexp_replace(btrim(p2.supplier), '\\s+', ' ', 'g'))
             = lower(regexp_replace(btrim(s2.name), '\\s+', ' ', 'g'))
          GROUP BY p2.supplier
          HAVING count(DISTINCT s2.id) = 1
        )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_parts_supplier_id ON parts (supplier_id)`);
    // Trigger: met à jour vehicle_documents.updated_by automatiquement quand une demande est complétée
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION fn_sync_document_updated_by()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.completed_by IS NOT NULL AND NEW.vehicle_document_id IS NOT NULL THEN
          UPDATE vehicle_documents
          SET updated_by = NEW.completed_by,
              updated_at = COALESCE(NEW.completed_at, now())
          WHERE id = NEW.vehicle_document_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    // Une seule instruction : DROP puis CREATE échouait quand deux initialisations se croisaient
    // (redémarrage du serveur de dev pendant un setup de test : « trigger already exists »).
    await db.execute(sql`
      CREATE OR REPLACE TRIGGER trg_sync_document_updated_by
      AFTER INSERT OR UPDATE OF completed_by ON document_renewal_requests
      FOR EACH ROW
      EXECUTE FUNCTION fn_sync_document_updated_by();
    `);
    // Rétro-remplir les données existantes (déclenche le même comportement pour l'historique)
    await db.execute(sql`
      UPDATE vehicle_documents vd
      SET updated_by = drr.completed_by,
          updated_at = COALESCE(drr.completed_at, vd.updated_at)
      FROM (
        SELECT DISTINCT ON (vehicle_document_id)
          vehicle_document_id,
          completed_by,
          completed_at
        FROM document_renewal_requests
        WHERE completed_by IS NOT NULL
        ORDER BY vehicle_document_id, completed_at DESC
      ) drr
      WHERE vd.id = drr.vehicle_document_id
        AND vd.updated_by IS NULL
        AND drr.completed_by IS NOT NULL
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_renewal_centers (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        document_type text,
        accreditation_number text,
        address text,
        contact text,
        is_active boolean NOT NULL DEFAULT true,
        created_by integer REFERENCES users(id),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS document_renewal_requests (
        id serial PRIMARY KEY,
        vehicle_id integer NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        vehicle_document_id integer NOT NULL REFERENCES vehicle_documents(id) ON DELETE CASCADE,
        document_type text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        requested_by integer REFERENCES users(id),
        assigned_role text,
        center_id integer REFERENCES document_renewal_centers(id),
        center_name_snapshot text,
        center_accreditation_snapshot text,
        escort_role text,
        escort_user_id integer,
        target_date date,
        comment text,
        source text NOT NULL DEFAULT 'vehicle_document',
        new_expiry_date date,
        renewal_reference text,
        renewal_visit_date date,
        inspector_name text,
        inspector_code text,
        proof_file_name text,
        proof_file_path text,
        completed_by integer REFERENCES users(id),
        completed_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      ALTER TABLE document_renewal_requests
      DROP CONSTRAINT IF EXISTS document_renewal_requests_escort_user_id_users_id_fk
    `);
    await db.execute(sql`ALTER TABLE document_renewal_centers ADD COLUMN IF NOT EXISTS accreditation_number text`);
    // Unicité du nom normalisé, seulement s'il n'y a aucun doublon (miroir de
    // server/db/migrations/20261102_document_renewal_centers_unique_name.sql, AGENTS.md §5).
    await db.execute(sql`
      DO $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
        IF NOT EXISTS (
          SELECT 1
          FROM document_renewal_centers
          GROUP BY regexp_replace(lower(btrim(name)), '\\s+', ' ', 'g')
          HAVING count(*) > 1
        ) THEN
          CREATE UNIQUE INDEX IF NOT EXISTS uq_document_renewal_centers_name_normalized
            ON document_renewal_centers ((regexp_replace(lower(btrim(name)), '\\s+', ' ', 'g')));
        END IF;
      END $$
    `);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS renewal_reference text`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS renewal_visit_date date`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS center_accreditation_snapshot text`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS inspector_name text`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS inspector_code text`);
    // Récépissé de renouvellement (P3-2) — jumelle de server/db/migrations/20261103_document_renewal_receipt.sql.
    await pool.query(DOCUMENT_RENEWAL_RECEIPT_SQL);
    await reportDocumentRenewalReceiptGaps(pool);
    await db.execute(sql`
      UPDATE document_renewal_centers
      SET accreditation_number = 'AGR-' || LPAD(id::text, 4, '0')
      WHERE accreditation_number IS NULL OR trim(accreditation_number) = ''
    `);
    // Lignes de travail d'un OT (lot 3) — doit rester ici ET dans
    // server/db/migrations/20260901_work_order_items.sql (AGENTS.md §5).
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS labor_catalog (
        id serial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        label text NOT NULL,
        standard_hours numeric(5,2),
        is_active boolean NOT NULL DEFAULT true,
        created_by integer REFERENCES users(id),
        updated_by integer REFERENCES users(id),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS work_order_items (
        id serial PRIMARY KEY,
        work_order_id integer NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        labor_catalog_id integer REFERENCES labor_catalog(id) ON DELETE SET NULL,
        custom_label text,
        technician_id integer REFERENCES users(id) ON DELETE SET NULL,
        estimated_hours numeric(5,2),
        actual_hours numeric(5,2),
        status text NOT NULL DEFAULT 'pending',
        started_at timestamp,
        completed_at timestamp,
        notes text,
        created_by integer REFERENCES users(id),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_work_order_items_work_order_id ON work_order_items (work_order_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_work_order_items_technician_id ON work_order_items (technician_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS supplier_invoice_settlements (
        id serial PRIMARY KEY,
        supplier_invoice_id integer NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
        amount numeric(15,2) NOT NULL,
        payment_method text NOT NULL,
        payment_reference text NOT NULL,
        payment_date date NOT NULL,
        value_date date,
        treasury_account text,
        proof_reference text,
        status text NOT NULL DEFAULT 'recorded',
        recorded_by integer REFERENCES users(id),
        reconciled_by integer REFERENCES users(id),
        reconciled_at timestamp,
        reconciliation_note text,
        notes text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    // Rejet d'un règlement (SINV1) — jumelle de server/db/migrations/20261101_supplier_settlement_rejection.sql.
    await db.execute(sql`ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejected_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejected_at timestamp`);
    await db.execute(sql`ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejection_reason text`);
    // Suivi des opérations clients (O1) : 1-1 avec missions.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mission_operations (
        id serial PRIMARY KEY,
        mission_id integer NOT NULL UNIQUE REFERENCES missions(id) ON DELETE CASCADE,
        trailer_vehicle_id integer REFERENCES vehicles(id),
        container_number text,
        bl_number text,
        sector text,
        loading_date timestamp,
        departure_date timestamp,
        return_date timestamp,
        unloading_date timestamp,
        goods_nature text,
        comment text,
        created_by integer REFERENCES users(id),
        updated_by integer REFERENCES users(id),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await applyLotRecetteSchema();
    await applyCdcSchema();
    await applyTreasurySchema();
    // Triggers de statut véhicule (libération, ré-immobilisation) — jumelles de
    // server/db/migrations/20261102_work_orders_release_vehicle.sql et 20261102_work_orders_hold_vehicle.sql.
    await applyWorkOrderVehicleStatusTriggers();
    // Capacité des réservoirs (FUEL3) — jumelle de server/db/migrations/20261102_vehicles_tank_capacity.sql.
    await pool.query(VEHICLE_TANK_CAPACITY_SQL);
    // Reprise : PIN chauffeur en clair vers bcrypt (idempotente, compteur seul journalisé).
    await hashPlainUserPins(pool);
    await applyPerformanceIndexes();
    await applyMigrationSqlFiles();
    await applyBootstrapSqlFiles();
    // Enfants du catalogue de pièces et pièces de panne (PRT1/CAT2) — jumelle de server/db/migrations/20261102_parts_catalog_children.sql.
    await pool.query(PARTS_CATALOG_CHILDREN_SQL);
    // PIN en clair refusé en base — jumelle de server/db/migrations/20261104_users_pin_bcrypt_check.sql.
    // Après toute reprise des PIN en clair : la validation ne réussit que si aucun clair ne reste.
    await pool.query(USERS_PIN_BCRYPT_CHECK_SQL);
    await reportUsersPinBcryptGaps(pool);
    // Au moins un administrateur actif — jumelle de server/db/migrations/20261105_users_keep_active_admin.sql.
    await pool.query(USERS_KEEP_ACTIVE_ADMIN_SQL);
    // Grille tarifaire (O3) — jumelle de server/db/migrations/20261106_tariff_grid.sql.
    await pool.query(TARIFF_GRID_SQL);
    // Prix convenu d'une mission (O3 lot 3) — jumelle de server/db/migrations/20261106_mission_agreed_price.sql.
    await pool.query(MISSION_AGREED_PRICE_SQL);
    // Budget de mission (L1) — jumelle de server/db/migrations/20261105_mission_budgets.sql.
    await pool.query(MISSION_BUDGETS_SQL);
    // Barème FDR par destination (L1b) — jumelle de server/db/migrations/20261105_mission_destinations.sql.
    await pool.query(MISSION_DESTINATIONS_SQL);
    // Relu après le dernier SQL qui pose une contrainte réconciliée : au premier démarrage, une table
    // pas encore créée serait signalée à tort.
    await reportCdcConstraintGaps(pool);

    // Vérifier si des utilisateurs existent déjà
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log('✅ Base de données déjà initialisée');
      return;
    }

    // Créer un utilisateur administrateur par défaut
    initLog.info('Base sans utilisateur : création de l\'administrateur initial');
    // Administrateur initial : jamais admin/admin123 hors développement et test (server/lib/initial-admin.ts).
    const adminPlan = planInitialAdmin(process.env);
    if (!adminPlan.create) {
      initLog.warn(adminPlan.reason);
      return;
    }

    await db.insert(users).values({
      username: adminPlan.username,
      email: 'admin@fleet.com',
      name: 'Administrateur Système',
      password: await bcrypt.hash(adminPlan.password, 10),
      role: 'admin'
    });

    if (adminPlan.source === 'dev-default') {
      // Développement et test seulement : le mot de passe par défaut est public, le rappeler est sans risque.
      initLog.info({ username: adminPlan.username }, 'Administrateur de développement créé (mot de passe par défaut admin123)');
    } else {
      // Le mot de passe vient de l'environnement : jamais journalisé.
      initLog.info({ username: adminPlan.username }, 'Administrateur initial créé avec ADMIN_INITIAL_PASSWORD');
    }

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    throw error;
  }
}
