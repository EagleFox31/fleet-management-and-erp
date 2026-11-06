-- Q18 : mission soldée. Le reliquat du budget décaissé revient au compte source et ses dépenses se figent.
-- Jumelle de MISSION_BUDGET_SETTLEMENT_SQL (server/init-database.ts) : tests/unit/server/mission-budgets-schema.test.ts compare les deux.
-- Colonnes nullables, aucun rétro-remplissage : un budget existant reste non soldé.
-- Après 20261106_mission_budget_expenses.sql (ordre alphabétique).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

-- ADD COLUMN IF NOT EXISTS prend un verrou exclusif même quand la colonne existe : on teste d'abord.
DO $$
BEGIN
  IF to_regclass('mission_budgets') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'mission_budgets' AND column_name = 'settled_by') THEN
    ALTER TABLE mission_budgets ADD COLUMN settled_by integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'mission_budgets' AND column_name = 'settled_at') THEN
    ALTER TABLE mission_budgets ADD COLUMN settled_at timestamp;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'mission_budgets.settled_by / settled_at non ajoutées : verrou indisponible';
END $$;

DO $$
BEGIN
  IF to_regclass('mission_budgets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'mission_budgets' AND column_name = 'settled_by') THEN
    RETURN;
  END IF;
  -- Posée NOT VALID puis validée : un settled_by orphelin laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS), pas un démarrage bloqué. Nom identique à shared/schema.ts.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass
                 AND conname = 'mission_budgets_settled_by_users_id_fk') THEN
    ALTER TABLE mission_budgets ADD CONSTRAINT mission_budgets_settled_by_users_id_fk
      FOREIGN KEY (settled_by) REFERENCES users(id) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass
             AND conname = 'mission_budgets_settled_by_users_id_fk' AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE mission_budgets VALIDATE CONSTRAINT mission_budgets_settled_by_users_id_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'mission_budgets_settled_by_users_id_fk laissée NOT VALID : settled_by vers un utilisateur absent';
    END;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'mission_budgets_settled_by_users_id_fk non posée : verrou indisponible';
END $$;
