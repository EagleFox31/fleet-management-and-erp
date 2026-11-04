-- Suppression douce d'un plein qui a mouvementé la carte carburant : la ligne reste (audit), mais
-- deleted_at non nul la sort du solde, des sommes, des listes et des détails.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; mêmes ALTER dans
-- init-database.ts (AGENTS.md §5).
-- Rétroactif : colonnes ajoutées à NULL, aucune donnée modifiée ni supprimée.
-- Retour arrière : retirer ces colonnes de shared/schema.ts et de init-database.ts, déployer, puis
-- ALTER TABLE fuel_records DROP COLUMN IF EXISTS deleted_by; ALTER TABLE fuel_records DROP COLUMN IF EXISTS deleted_at;
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id);
