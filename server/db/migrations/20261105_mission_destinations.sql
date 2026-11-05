-- L1b : barème FDR par destination (liste fermée), choisi à la main sur le budget de mission.
-- Jumelle de MISSION_DESTINATIONS_SQL (server/init-database.ts) :
-- tests/unit/server/mission-budgets-schema.test.ts compare les deux.
-- Seed limité aux valeurs relevées dans le besoin logistique ; ON CONFLICT DO NOTHING ne réécrit
-- jamais une valeur corrigée depuis. Après 20261105_mission_budgets.sql (ordre alphabétique).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

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
END $$;
