-- L1 : budget de mission (drapeau finance), un par mission. Jumelle de MISSION_BUDGETS_SQL
-- (server/init-database.ts) : tests/unit/server/mission-budgets-schema.test.ts compare les deux.
-- Contraintes posées à la création puis réconciliées (NOT VALID -> VALIDATE) sur une table déjà là,
-- noms alignés sur Drizzle (shared/schema.ts) et relus par reportCdcConstraintGaps.
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
END $$;
