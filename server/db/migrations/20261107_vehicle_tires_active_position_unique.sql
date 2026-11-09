-- Un seul pneu actif par position d'un véhicule. Index unique partiel sur vehicle_tires(vehicle_id, position)
-- WHERE status = 'active' : les montages démontés (removed, punctured, worn, damaged) gardent leur historique.
-- Sans lui, installTireOnVehicle contrôle la position par un SELECT avant l'INSERT : deux montages
-- simultanés sur la même position passent tous les deux, et deux pneus « roulent » au même endroit.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL (AGENTS.md §5), comparé par
-- tests/unit/server/vehicle-tires-active-position-unique-schema.test.ts.
-- Rétroactif : aucune donnée modifiée ni supprimée. Si des positions portent déjà plusieurs pneus actifs,
-- l'index n'est pas posé (WARNING), le démarrage continue, et reportVehicleTireActivePositionGaps
-- (init-database.ts) journalise chaque couple (véhicule, position) avec ses montages : l'atelier démonte
-- le pneu en trop par son action dédiée. Le démarrage suivant pose l'index.
-- Idempotent, sous verrou consultatif et lock_timeout 5 s : un verrou indisponible ou un doublon inséré
-- entre la détection et la création laisse le démarrage continuer au lieu de le bloquer.
-- Retour arrière : retirer VEHICLE_TIRES_ACTIVE_POSITION_UNIQUE_SQL et son appel de server/init-database.ts,
-- ce fichier et l'uniqueIndex de shared/schema.ts, déployer, puis
-- DROP INDEX IF EXISTS uq_vehicle_tires_active_position;
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_vehicle_tires_active_position') THEN
    IF EXISTS (SELECT 1 FROM vehicle_tires WHERE status = 'active' GROUP BY vehicle_id, position HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_vehicle_tires_active_position non posé : positions portant plusieurs pneus actifs dans vehicle_tires';
    ELSE
      CREATE UNIQUE INDEX uq_vehicle_tires_active_position ON vehicle_tires (vehicle_id, position) WHERE status = 'active';
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE WARNING 'uq_vehicle_tires_active_position non posé : verrou indisponible ou doublon apparu pendant la création';
END $$;
