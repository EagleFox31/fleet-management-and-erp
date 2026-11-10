-- GPS V1 « position téléphone » (lot GPS-DB, docs/plans/carte-chauffeur-gps-telephone.md §5) :
-- table vehicle_positions commune aux sources (phone, tracker), points A/B facultatifs sur missions,
-- fonction purge_vehicle_positions(jours) pour la rétention (GPS_POSITION_RETENTION_DAYS, 30 par défaut).
-- Pas de table de consentement : décision du 2026-11-10, le relevé suit la fenêtre de mission.
-- Jumelle de VEHICLE_POSITIONS_GPS_SQL (server/init-database.ts) : tests/unit/server/vehicle-positions-gps-schema.test.ts
-- compare les deux. Rejoué à chaque démarrage ; second passage sans aucune écriture (catalogue compris) :
-- colonnes ajoutées seulement si absentes, fonction recréée seulement si son corps diffère.
-- Rétroactif : aucune donnée existante modifiée ; les nouvelles colonnes de missions sont NULL.
-- Retour arrière : retirer VEHICLE_POSITIONS_GPS_SQL et son appel de server/init-database.ts, ce fichier et les
-- déclarations de shared/schema.ts, déployer, puis
--   DROP FUNCTION IF EXISTS purge_vehicle_positions(integer); DROP TABLE IF EXISTS vehicle_positions;
--   ALTER TABLE missions DROP CONSTRAINT IF EXISTS missions_pickup_geo_check, DROP CONSTRAINT IF EXISTS missions_delivery_geo_check,
--     DROP COLUMN IF EXISTS pickup_lat, DROP COLUMN IF EXISTS pickup_lng, DROP COLUMN IF EXISTS pickup_hub_code,
--     DROP COLUMN IF EXISTS delivery_lat, DROP COLUMN IF EXISTS delivery_lng, DROP COLUMN IF EXISTS delivery_hub_code;
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS vehicle_positions (
  id bigserial PRIMARY KEY,
  vehicle_id integer NOT NULL
    CONSTRAINT vehicle_positions_vehicle_id_vehicles_id_fk REFERENCES vehicles(id) ON DELETE CASCADE,
  mission_id integer
    CONSTRAINT vehicle_positions_mission_id_missions_id_fk REFERENCES missions(id) ON DELETE CASCADE,
  driver_id integer
    CONSTRAINT vehicle_positions_driver_id_drivers_id_fk REFERENCES drivers(id) ON DELETE SET NULL,
  source text NOT NULL,
  device_id integer,
  submitted_by integer
    CONSTRAINT vehicle_positions_submitted_by_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  client_point_id uuid,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m real,
  speed_kmh real,
  heading real,
  suspect boolean NOT NULL DEFAULT false,
  CONSTRAINT vehicle_positions_source_check CHECK (source IN ('phone', 'tracker')),
  CONSTRAINT vehicle_positions_phone_check CHECK (source <> 'phone' OR (mission_id IS NOT NULL AND submitted_by IS NOT NULL AND client_point_id IS NOT NULL)),
  CONSTRAINT vehicle_positions_tracker_check CHECK (source <> 'tracker' OR device_id IS NOT NULL),
  CONSTRAINT vehicle_positions_coords_check CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180),
  CONSTRAINT vehicle_positions_measures_check CHECK ((accuracy_m IS NULL OR accuracy_m >= 0) AND (speed_kmh IS NULL OR speed_kmh >= 0) AND (heading IS NULL OR (heading >= 0 AND heading < 360))),
  CONSTRAINT vehicle_positions_client_point_unique UNIQUE (source, submitted_by, client_point_id)
);

CREATE INDEX IF NOT EXISTS vehicle_positions_mission_recorded_idx ON vehicle_positions (mission_id, recorded_at);
CREATE INDEX IF NOT EXISTS vehicle_positions_vehicle_recorded_idx ON vehicle_positions (vehicle_id, recorded_at DESC);

DO $$
DECLARE
  c record;
BEGIN
  -- Ajoutées seulement si absentes : un ADD COLUMN IF NOT EXISTS prendrait le verrou de table à chaque démarrage.
  FOR c IN SELECT * FROM (VALUES
    ('pickup_lat', 'double precision'),
    ('pickup_lng', 'double precision'),
    ('pickup_hub_code', 'text'),
    ('delivery_lat', 'double precision'),
    ('delivery_lng', 'double precision'),
    ('delivery_hub_code', 'text')
  ) AS v(col, typ) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'missions' AND column_name = c.col) THEN
      EXECUTE format('ALTER TABLE missions ADD COLUMN %I %s', c.col, c.typ);
    END IF;
  END LOOP;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'missions : points A/B non ajoutés, verrou de table indisponible';
END $$;

DO $$
DECLARE
  c record;
BEGIN
  -- Table déjà créée sans ces contraintes (drizzle-kit push antérieur) ou missions existante : CHECK posé
  -- NOT VALID puis validé ; une ligne non conforme laisse un WARNING, relu par reportCdcConstraintGaps
  -- (CDC_RECONCILED_CONSTRAINTS). Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('vehicle_positions', 'vehicle_positions_source_check', 'CHECK (source IN (''phone'', ''tracker''))'),
    ('vehicle_positions', 'vehicle_positions_phone_check', 'CHECK (source <> ''phone'' OR (mission_id IS NOT NULL AND submitted_by IS NOT NULL AND client_point_id IS NOT NULL))'),
    ('vehicle_positions', 'vehicle_positions_tracker_check', 'CHECK (source <> ''tracker'' OR device_id IS NOT NULL)'),
    ('vehicle_positions', 'vehicle_positions_coords_check', 'CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)'),
    ('vehicle_positions', 'vehicle_positions_measures_check', 'CHECK ((accuracy_m IS NULL OR accuracy_m >= 0) AND (speed_kmh IS NULL OR speed_kmh >= 0) AND (heading IS NULL OR (heading >= 0 AND heading < 360)))'),
    ('missions', 'missions_pickup_geo_check', 'CHECK ((pickup_lat IS NULL) = (pickup_lng IS NULL) AND (pickup_lat IS NULL OR (pickup_lat BETWEEN -90 AND 90 AND pickup_lng BETWEEN -180 AND 180)) AND (pickup_hub_code IS NULL OR (pickup_lat IS NOT NULL AND pickup_hub_code <> '''')))'),
    ('missions', 'missions_delivery_geo_check', 'CHECK ((delivery_lat IS NULL) = (delivery_lng IS NULL) AND (delivery_lat IS NULL OR (delivery_lat BETWEEN -90 AND 90 AND delivery_lng BETWEEN -180 AND 180)) AND (delivery_hub_code IS NULL OR (delivery_lat IS NOT NULL AND delivery_hub_code <> '''')))')
  ) AS v(tbl, name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '% : lignes hors contrainte %, laissée NOT VALID', c.tbl, c.name;
      END;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'vehicle_positions'::regclass
                 AND conname = 'vehicle_positions_client_point_unique') THEN
    BEGIN
      ALTER TABLE vehicle_positions ADD CONSTRAINT vehicle_positions_client_point_unique UNIQUE (source, submitted_by, client_point_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'vehicle_positions : points en double, contrainte vehicle_positions_client_point_unique non posée';
    END;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes GPS (vehicle_positions, missions) non réconciliées : verrou de table indisponible';
END $$;

DO $$
DECLARE
  -- Purge des points relevés il y a plus de p_retention_days jours. Renvoie le nombre de lignes supprimées :
  -- un second passage le même jour renvoie 0 et n'écrit rien.
  purge_body text := $body$
DECLARE
  deleted integer;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'Durée de conservation des positions invalide : %', p_retention_days
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM vehicle_positions WHERE recorded_at < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$body$;
BEGIN
  -- Recréée seulement si absente ou différente (fins de ligne ignorées) : rejouer n'écrit pas dans le catalogue.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('purge_vehicle_positions(integer)')
                 AND replace(prosrc, chr(13), '') = replace(purge_body, chr(13), '')) THEN
    EXECUTE format('CREATE OR REPLACE FUNCTION purge_vehicle_positions(p_retention_days integer) RETURNS integer LANGUAGE plpgsql AS %L', purge_body);
  END IF;
END $$;
