-- Lignes de travail sur l'ordre de travail (lot 3) — heures passées, sans valorisation.
-- Rejoué automatiquement au démarrage via server/init-database.ts (applyMigrationSqlFiles).
-- Dupliqué dans init-database.ts conformément à AGENTS.md §5 : un fichier SQL seul
-- ne garantit rien sur une base vierge.

CREATE TABLE IF NOT EXISTS labor_catalog (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  -- Barème de comparaison, jamais un tarif : aucune valorisation en argent
  -- dans ce lot (techniciens salariés, cf. docs/plans/lignes-de-travail-ot.md).
  standard_hours numeric(5,2),
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

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
);

CREATE INDEX IF NOT EXISTS idx_work_order_items_work_order_id ON work_order_items (work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_items_technician_id ON work_order_items (technician_id);
