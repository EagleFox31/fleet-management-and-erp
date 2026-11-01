import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { db, pool } from './db';
import { users } from '../shared/schema';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const BOOTSTRAP_SQL_FILES = [
  'work-orders-realtime-triggers.sql',
  'supplier-invoice-settlements-workflow.sql',
  'mission-fuel-triggers.sql',
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
  let files: string[];
  try {
    files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();
  } catch {
    return;
  }

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

async function applyLotRecetteSchema() {
  await pool.query(LOT_RECETTE_SCHEMA_STATEMENTS.map((statement) => `${statement};`).join(String.fromCharCode(10)));
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
    await db.execute(sql`
      UPDATE tires
      SET updated_at = COALESCE(updated_at, created_at, now())
      WHERE updated_at IS NULL
    `);
    await db.execute(sql`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE vehicle_documents ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id)`);
    await db.execute(sql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hire_date date`);
    await db.execute(sql`ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS mission_id integer REFERENCES missions(id) ON DELETE SET NULL`);
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
    await db.execute(sql`DROP TRIGGER IF EXISTS trg_sync_document_updated_by ON document_renewal_requests`);
    await db.execute(sql`
      CREATE TRIGGER trg_sync_document_updated_by
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
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS renewal_reference text`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS renewal_visit_date date`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS center_accreditation_snapshot text`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS inspector_name text`);
    await db.execute(sql`ALTER TABLE document_renewal_requests ADD COLUMN IF NOT EXISTS inspector_code text`);
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
    await applyLotRecetteSchema();
    await applyPerformanceIndexes();
    await applyMigrationSqlFiles();
    await applyBootstrapSqlFiles();

    // Vérifier si des utilisateurs existent déjà
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log('✅ Base de données déjà initialisée');
      return;
    }

    // Créer un utilisateur administrateur par défaut
    console.log('👥 Création de l\'utilisateur administrateur...');
    const adminPassword = await bcrypt.hash('admin123', 10);

    await db.insert(users).values({
      username: 'admin',
      email: 'admin@fleet.com',
      name: 'Administrateur Système',
      password: adminPassword,
      role: 'admin'
    });

    console.log('✅ Utilisateur administrateur créé !');
    console.log('👤 Connexion: admin / admin123');
    console.log('📧 Email: admin@fleet.com');

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    throw error;
  }
}
