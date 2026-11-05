-- Dépenses justifiées du budget de mission (L1e). Jumelle : MISSION_BUDGET_EXPENSES_SQL (server/init-database.ts),
-- comparée par tests/unit/server/mission-budgets-schema.test.ts. Additive et idempotente.
-- Montant entier en XAF. Suppression douce (deleted_at, deleted_by) : une dépense est une trace financière.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS mission_budget_expenses (
  id serial PRIMARY KEY,
  budget_id integer NOT NULL
    CONSTRAINT mission_budget_expenses_budget_id_mission_budgets_id_fk REFERENCES mission_budgets(id),
  line text NOT NULL,
  amount integer NOT NULL,
  label text NOT NULL,
  expense_date date NOT NULL,
  created_by integer CONSTRAINT mission_budget_expenses_created_by_users_id_fk REFERENCES users(id),
  updated_by integer CONSTRAINT mission_budget_expenses_updated_by_users_id_fk REFERENCES users(id),
  deleted_by integer CONSTRAINT mission_budget_expenses_deleted_by_users_id_fk REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  CONSTRAINT mission_budget_expenses_line_check CHECK (line IN ('fdr', 'carburant')),
  CONSTRAINT mission_budget_expenses_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_mission_budget_expenses_budget_id ON mission_budget_expenses (budget_id);

DO $$
DECLARE
  c record;
BEGIN
  -- Table déjà créée sans ces contraintes (drizzle-kit push) : CHECK posé NOT VALID puis validé ; une ligne
  -- non conforme laisse un WARNING, relu par reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS).
  -- Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('mission_budget_expenses_line_check', 'CHECK (line IN (''fdr'', ''carburant''))'),
    ('mission_budget_expenses_amount_check', 'CHECK (amount > 0)')
  ) AS t(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budget_expenses'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE mission_budget_expenses ADD CONSTRAINT %I %s NOT VALID', c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budget_expenses'::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE mission_budget_expenses VALIDATE CONSTRAINT %I', c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'mission_budget_expenses : lignes hors contrainte %, laissée NOT VALID', c.name;
      END;
    END IF;
  END LOOP;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes mission_budget_expenses non réconciliées : verrou de table indisponible';
END $$;
