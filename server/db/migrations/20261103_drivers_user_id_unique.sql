-- #113 : une fiche chauffeur par compte utilisateur. Index unique partiel sur drivers(user_id), les fiches
-- sans compte (user_id NULL) restent libres. Sans lui, la cloison chauffeur (missions, espace chauffeur,
-- pannes) dépend de la fiche renvoyée en premier quand deux fiches pointent le même compte.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par DRIVERS_USER_ID_UNIQUE_SQL (AGENTS.md §5), comparé par tests/unit/server/drivers-user-id-unique-schema.test.ts.
-- Rétroactif : aucune donnée modifiée ni supprimée. Si des doublons existent déjà, l'index n'est pas posé
-- (WARNING), le démarrage continue, et reportDriverUserIdUniqueGaps (init-database.ts) journalise chaque
-- compte en double avec ses fiches : la logistique choisit la fiche gardée, la fusion déplace
-- assignments.driver_id puis retire le user_id de l'autre fiche. Le démarrage suivant pose l'index.
-- Idempotent, sous verrou consultatif et lock_timeout 5 s : un verrou indisponible ou un doublon inséré
-- entre la détection et la création laisse le démarrage continuer au lieu de le bloquer.
-- Retour arrière : retirer DRIVERS_USER_ID_UNIQUE_SQL et son appel de server/init-database.ts, ce fichier
-- et l'uniqueIndex de shared/schema.ts, déployer, puis DROP INDEX IF EXISTS uq_drivers_user_id;
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_drivers_user_id') THEN
    IF EXISTS (SELECT 1 FROM drivers WHERE user_id IS NOT NULL GROUP BY user_id HAVING count(*) > 1) THEN
      RAISE WARNING 'uq_drivers_user_id non posé : comptes liés à plusieurs fiches dans drivers';
    ELSE
      CREATE UNIQUE INDEX uq_drivers_user_id ON drivers (user_id) WHERE user_id IS NOT NULL;
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE WARNING 'uq_drivers_user_id non posé : verrou indisponible ou doublon apparu pendant la création';
END $$;
