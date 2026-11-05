-- Au moins un administrateur actif (role = 'admin', deleted_at IS NULL) reste en base : une suppression, un
-- changement de rôle ou une désactivation qui n'en laisserait aucun est refusée (check_violation, contrainte
-- users_keep_one_active_admin), quel que soit l'appelant (route, script, SQL direct).
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté par
-- USERS_KEEP_ACTIVE_ADMIN_SQL (AGENTS.md §5), comparé par tests/unit/server/users-keep-active-admin-schema.test.ts.
-- Aucune donnée modifiée. Idempotent (CREATE OR REPLACE FUNCTION et TRIGGER, atomiques en cas de démarrages concurrents).
-- Retour arrière, dans cet ordre (sinon le démarrage suivant repose le trigger) :
--   1. retirer USERS_KEEP_ACTIVE_ADMIN_SQL et son appel de server/init-database.ts, puis ce fichier ;
--   2. DROP TRIGGER IF EXISTS trg_users_keep_active_admin ON users; DROP FUNCTION IF EXISTS fn_users_keep_active_admin();
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE OR REPLACE FUNCTION fn_users_keep_active_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Seule la sortie d'un administrateur actif (suppression, changement de rôle, désactivation) compte.
  IF OLD.role = 'admin' AND OLD.deleted_at IS NULL
     AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'admin' OR NEW.deleted_at IS NOT NULL) THEN
    -- Sérialise les sorties concurrentes : la seconde relit l'état validé par la première.
    PERFORM pg_advisory_xact_lock(hashtext('fleetmaster_last_active_admin'));
    IF NOT EXISTS (
      SELECT 1 FROM users u WHERE u.role = 'admin' AND u.deleted_at IS NULL AND u.id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'Il doit rester au moins un administrateur actif.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'users_keep_one_active_admin';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_users_keep_active_admin
BEFORE UPDATE OF role, deleted_at OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION fn_users_keep_active_admin();
