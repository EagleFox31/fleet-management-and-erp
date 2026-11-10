-- Verrou d'argent en base (lot V1, D2) : un plein validé ne se modifie plus et ne se supprime plus, quel que soit
-- l'appelant (route, script, SQL direct). Refus : check_violation, contrainte fuel_records_validated_locked,
-- traduite en 409 lisible par server/lib/pg-errors.ts (moneyLockMessageOf).
-- Liste blanche sur un plein validé : updated_at, updated_by ; mission_id seulement vers NULL et seulement par
-- l'action de clé étrangère (ON DELETE SET NULL d'une mission supprimée, pg_trigger_depth() > 1) ; annulation tracée une seule fois (deleted_at, deleted_by, cancellation_reason de NULL
-- vers une valeur, motif non vide d'au plus 500 caractères). Un plein en attente reste libre, y compris sa
-- validation (pending -> validated). TRUNCATE de la table refusé (trigger par instruction). Levée pour une seule
-- transaction : withMoneyOverride (AGENTS.md §5).
-- Verrou de table borné à 5 s (lock_timeout) : si une écriture longue le retient, les triggers ne sont pas posés,
-- un WARNING est émis, init-database le journalise, et le démarrage suivant réessaie (comme ux_fuel_records_request_key).
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté par
-- FUEL_RECORDS_VALIDATED_LOCK_SQL (AGENTS.md §5), comparé par tests/unit/server/fuel-records-lock-schema.test.ts.
-- Aucune donnée modifiée : les pleins déjà validés deviennent simplement protégés. Idempotent.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant repose le trigger) :
--   1. retirer FUEL_RECORDS_VALIDATED_LOCK_SQL et son appel de server/init-database.ts, puis ce fichier ;
--   2. DROP TRIGGER IF EXISTS trg_fuel_records_validated_lock ON fuel_records; DROP FUNCTION IF EXISTS fn_fuel_records_validated_lock();
--      DROP TRIGGER IF EXISTS trg_fuel_records_truncate_lock ON fuel_records; DROP FUNCTION IF EXISTS fn_fuel_records_truncate_lock();
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION fn_fuel_records_validated_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  free_cols text[] := ARRAY['updated_at', 'updated_by', 'mission_id', 'deleted_at', 'deleted_by', 'cancellation_reason'];
BEGIN
  -- Levée explicite pour la transaction en cours, ou plein encore en attente (sa validation comprise) : rien à garder.
  IF current_setting('fleetos.allow_money_override', true) = 'on' OR OLD.validation_status IS DISTINCT FROM 'validated' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plein validé : suppression refusée.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fuel_records_validated_locked';
  END IF;

  -- Toute colonne hors liste blanche (montants, quantités, statut de validation, auteur...) est gelée.
  IF (to_jsonb(NEW) - free_cols) IS DISTINCT FROM (to_jsonb(OLD) - free_cols) THEN
    RAISE EXCEPTION 'Plein validé : seule son annulation tracée est permise.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fuel_records_validated_locked';
  END IF;

  -- La mission ne se change pas ; elle ne se détache que vers NULL, et seulement par l'action de clé étrangère
  -- (suppression de la mission : UPDATE lancé par un trigger, profondeur > 1). En direct, le plein sortirait du
  -- budget de sa mission sans annulation tracée.
  IF NEW.mission_id IS DISTINCT FROM OLD.mission_id AND (NEW.mission_id IS NOT NULL OR pg_trigger_depth() <= 1) THEN
    RAISE EXCEPTION 'Plein validé : la mission ne se change pas.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fuel_records_validated_locked';
  END IF;

  -- Annulation tracée : une seule fois, de NULL vers une valeur, avec auteur et motif.
  IF (NEW.deleted_at, NEW.deleted_by, NEW.cancellation_reason)
       IS DISTINCT FROM (OLD.deleted_at, OLD.deleted_by, OLD.cancellation_reason) THEN
    IF OLD.deleted_at IS NOT NULL OR OLD.deleted_by IS NOT NULL OR OLD.cancellation_reason IS NOT NULL
       OR NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL
       OR NEW.cancellation_reason IS NULL OR btrim(NEW.cancellation_reason) = ''
       OR char_length(NEW.cancellation_reason) > 500 THEN
      RAISE EXCEPTION 'Plein validé : annulation une seule fois, avec un motif de 1 à 500 caractères.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'fuel_records_validated_locked';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Vider la table effacerait aussi les pleins validés, sans passer par le trigger par ligne.
CREATE OR REPLACE FUNCTION fn_fuel_records_truncate_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('fleetos.allow_money_override', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Pleins : vidage de la table refusé.'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'fuel_records_validated_locked';
END;
$$;

-- Poser un trigger prend un verrou SHARE ROW EXCLUSIVE sur fuel_records : borné par lock_timeout, l'échec est toléré.
DO $do$
BEGIN
  CREATE OR REPLACE TRIGGER trg_fuel_records_validated_lock
  BEFORE UPDATE OR DELETE ON fuel_records
  FOR EACH ROW
  EXECUTE FUNCTION fn_fuel_records_validated_lock();

  CREATE OR REPLACE TRIGGER trg_fuel_records_truncate_lock
  BEFORE TRUNCATE ON fuel_records
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_fuel_records_truncate_lock();
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'triggers de verrou des pleins non posés : verrou de table indisponible, nouvel essai au démarrage suivant';
END $do$;
