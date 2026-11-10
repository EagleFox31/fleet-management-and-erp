-- Remorque d'une affectation : assignments.trailer_id -> vehicles.id (type remorque / semi_remorque, vérifié
-- par server/services/trailer-assignment.ts). ON DELETE SET NULL : retirer une remorque du parc ne casse pas
-- l'historique des affectations. Une remorque n'est attelée qu'à un seul attelage actif : index unique partiel
-- sur trailer_id, filtré sur les statuts actifs (ACTIVE_ASSIGNMENT_STATUSES de shared/constants/assignments.ts).
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté par
-- ASSIGNMENTS_TRAILER_SQL (AGENTS.md §5), comparé par tests/unit/server/assignments-trailer-schema.test.ts.
-- Rétroactif : colonne nulle sur l'existant, rien modifié ni supprimé. mission_operations.trailer_vehicle_id
-- (suivi O1) est conservé tel quel : l'écran n'est pré-rempli que lorsque ce champ est vide.
-- Retour arrière : retirer ASSIGNMENTS_TRAILER_SQL et son appel, ce fichier et la colonne de shared/schema.ts,
-- déployer, puis DROP INDEX IF EXISTS uq_assignments_trailer_active; ALTER TABLE assignments DROP COLUMN trailer_id;
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS trailer_id integer REFERENCES vehicles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_assignments_trailer_active') THEN
    IF EXISTS (SELECT 1 FROM assignments WHERE trailer_id IS NOT NULL AND status IN ('pending', 'accepted', 'in_progress') GROUP BY trailer_id HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_assignments_trailer_active non posé : remorques attelées à plusieurs affectations actives';
    ELSE
      CREATE UNIQUE INDEX uq_assignments_trailer_active ON assignments (trailer_id) WHERE trailer_id IS NOT NULL AND status IN ('pending', 'accepted', 'in_progress');
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE WARNING 'uq_assignments_trailer_active non posé : verrou indisponible ou doublon apparu pendant la création';
END $$;
