-- Clé de requête d'un plein de mission (normal ou régularisation) : choisie par le client pour une
-- soumission, elle permet de rejouer un nouvel envoi après une coupure sans débiter deux fois la carte.
-- Index unique : deux pleins ne peuvent pas porter la même clé (NULL reste libre, pleins sans clé).
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par FUEL_RECORDS_REQUEST_KEY_SQL (AGENTS.md §5), comparé par tests/unit/server/fuel-records-request-key-schema.test.ts.
-- Rétroactif : colonne ajoutée à NULL, aucune donnée modifiée ni supprimée.
-- Retour arrière : retirer FUEL_RECORDS_REQUEST_KEY_SQL et son appel, ce fichier et la colonne de
-- shared/schema.ts, déployer, puis DROP INDEX IF EXISTS ux_fuel_records_request_key;
-- ALTER TABLE fuel_records DROP COLUMN IF EXISTS request_key;
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS request_key text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ux_fuel_records_request_key') THEN
    CREATE UNIQUE INDEX ux_fuel_records_request_key ON fuel_records (request_key);
  END IF;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE WARNING 'ux_fuel_records_request_key non posé : verrou indisponible ou doublon, nouvel essai au démarrage suivant';
END $$;
