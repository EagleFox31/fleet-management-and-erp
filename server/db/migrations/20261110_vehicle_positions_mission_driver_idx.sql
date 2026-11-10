-- GPS V1 : index (mission_id, driver_id) de vehicle_positions. Le décompte avant insertion (plafond par chauffeur
-- et mission) et le filtre de la trace relisaient toute la mission. Jumelle de VEHICLE_POSITIONS_MISSION_DRIVER_IDX_SQL
-- (server/init-database.ts) : tests/unit/server/vehicle-positions-gps-schema.test.ts
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS vehicle_positions_mission_driver_idx ON vehicle_positions (mission_id, driver_id);
