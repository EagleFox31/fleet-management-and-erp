-- L1b : barème FDR par destination (liste fermée), choisi à la main sur le budget de mission.
-- Jumelle de MISSION_DESTINATIONS_SQL (server/init-database.ts) :
-- tests/unit/server/mission-budgets-schema.test.ts compare les deux.
-- Seed limité aux valeurs relevées dans le besoin logistique ; ON CONFLICT DO NOTHING ne réécrit
-- jamais une valeur corrigée depuis. Après 20261105_mission_budgets.sql (ordre alphabétique).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mission_budgets_destination_id_mission_destinations_id_fk') THEN
    ALTER TABLE mission_budgets
      ADD CONSTRAINT mission_budgets_destination_id_mission_destinations_id_fk
      FOREIGN KEY (destination_id) REFERENCES mission_destinations(id);
  END IF;
END $$;
