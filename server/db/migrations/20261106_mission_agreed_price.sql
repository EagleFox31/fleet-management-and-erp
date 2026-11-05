-- O3 lot 3 : prix convenu d'une mission (saisi ou repris d'un tarif suggéré) et tarif d'origine.
-- Jumelle de MISSION_AGREED_PRICE_SQL (server/init-database.ts) : tests/unit/server/mission-agreed-price-schema.test.ts compare les deux.
-- Colonnes nullables, aucun rétro-remplissage ; le tarif supprimé laisse le prix (ON DELETE SET NULL).
-- Après 20261106_tariff_grid.sql (ordre alphabétique).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

ALTER TABLE missions ADD COLUMN IF NOT EXISTS agreed_price numeric(15,0);
ALTER TABLE missions ADD COLUMN IF NOT EXISTS tariff_grid_id integer;

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
END $$;
