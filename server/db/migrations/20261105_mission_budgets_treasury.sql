-- L1c : le décaissement d'un budget de mission écrit au journal de trésorerie ; treasury_entry_id
-- pointe sa ligne FDR (ou carburant). Jumelle de MISSION_BUDGETS_TREASURY_SQL (server/init-database.ts) :
-- tests/unit/server/mission-budgets-schema.test.ts compare les deux.
-- Après 20261105_mission_budgets.sql (ordre alphabétique : '.' avant '_'). Sans l'une des deux tables,
-- rien n'est fait : le démarrage suivant pose la contrainte.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('mission_budgets') IS NULL OR to_regclass('treasury_entries') IS NULL THEN
    RETURN;
  END IF;
  -- Posée NOT VALID puis validée : une valeur orpheline laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS), pas un démarrage bloqué. Nom identique à shared/schema.ts.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass
                 AND conname = 'mission_budgets_treasury_entry_id_treasury_entries_id_fk') THEN
    ALTER TABLE mission_budgets ADD CONSTRAINT mission_budgets_treasury_entry_id_treasury_entries_id_fk
      FOREIGN KEY (treasury_entry_id) REFERENCES treasury_entries(id) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_budgets'::regclass
             AND conname = 'mission_budgets_treasury_entry_id_treasury_entries_id_fk' AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE mission_budgets VALIDATE CONSTRAINT mission_budgets_treasury_entry_id_treasury_entries_id_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'mission_budgets : treasury_entry_id orphelins, mission_budgets_treasury_entry_id_treasury_entries_id_fk laissée NOT VALID';
    END;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'lien trésorerie de mission_budgets non réconcilié : verrou de table indisponible';
END $$;
