-- users.pin ne contient qu'un hash bcrypt ($2a$, $2b$ ou $2y$) ou NULL : un PIN chauffeur en clair est refusé
-- en base, quel que soit l'appelant (route, script, seed). Préfixe écrit [$] et non \$ : le même texte vaut
-- dans ce fichier et dans le gabarit TypeScript, où \$ deviendrait $ (ancre de fin) à l'évaluation.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par USERS_PIN_BCRYPT_CHECK_SQL (AGENTS.md §5), comparé par tests/unit/server/users-pin-bcrypt-check-schema.test.ts.
-- Aucune donnée modifiée : la reprise des PIN en clair (hashPlainUserPins) est un autre changement.
-- Idempotent, sous verrou consultatif et lock_timeout 5 s : CHECK posée NOT VALID si absente puis validée
-- dans un sous-bloc. Un PIN en clair encore présent laisse la contrainte NOT VALID (écritures suivantes
-- contrôlées), jamais un démarrage bloqué ; un verrou de table indisponible laisse le démarrage continuer
-- (WARNING). L'écart est relu et journalisé au démarrage (reportUsersPinBcryptGaps, init-database.ts) :
-- le RAISE WARNING n'atteint pas les logs.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant repose la contrainte) :
--   1. retirer USERS_PIN_BCRYPT_CHECK_SQL et son appel de server/init-database.ts, ce fichier et la CHECK
--      users_pin_bcrypt_check de shared/schema.ts ;
--   2. déployer, puis ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pin_bcrypt_check;
--      (aucune donnée perdue).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_pin_bcrypt_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_pin_bcrypt_check
      CHECK (pin IS NULL OR pin ~ '^[$]2[aby][$]') NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND conname = 'users_pin_bcrypt_check' AND NOT convalidated
  ) THEN
    BEGIN
      ALTER TABLE users VALIDATE CONSTRAINT users_pin_bcrypt_check;
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'users_pin_bcrypt_check laissée NOT VALID : PIN en clair dans users';
    END;
  END IF;
EXCEPTION WHEN lock_not_available OR undefined_column THEN
  RAISE WARNING 'users_pin_bcrypt_check non posée : verrou indisponible ou colonne pin absente';
END $$;
