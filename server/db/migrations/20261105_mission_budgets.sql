-- L1 : budget de mission (drapeau finance), un par mission. Jumelle de MISSION_BUDGETS_SQL
-- (server/init-database.ts) : tests/unit/server/mission-budgets-schema.test.ts compare les deux.
-- Table neuve : contraintes posées à la création, noms alignés sur Drizzle (shared/schema.ts).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

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
