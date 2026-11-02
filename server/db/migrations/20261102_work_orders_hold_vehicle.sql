-- VEH4 (miroir de 20261102_work_orders_release_vehicle.sql) : un OT clôturé ou annulé qui redevient
-- ouvert (refus du contrôle qualité, réouverture, SQL direct) immobilise de nouveau le véhicule
-- en service. Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même
-- SQL est porté par WORK_ORDER_VEHICLE_HOLD_SQL (AGENTS.md §5), comparé par
-- tests/unit/server/work-orders-release-vehicle-drift.test.ts.
-- Idempotent : CREATE OR REPLACE FUNCTION puis CREATE OR REPLACE TRIGGER (une paire DROP/CREATE est
-- refusée par tests/unit/server/init-database-concurrency.test.ts), sous verrou consultatif.
-- Additif : aucune donnée existante modifiée.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant recrée le trigger) :
--   1. retirer WORK_ORDER_VEHICLE_HOLD_SQL et son appel de server/init-database.ts, et ce fichier ;
--   2. déployer, puis DROP TRIGGER IF EXISTS trg_work_orders_hold_vehicle ON work_orders;
--      DROP FUNCTION IF EXISTS fn_work_orders_hold_vehicle();
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE OR REPLACE FUNCTION fn_work_orders_hold_vehicle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_created_at timestamp;
BEGIN
  SELECT status, created_at INTO v_status, v_created_at
  FROM vehicles
  WHERE id = NEW.vehicle_id AND deleted_at IS NULL
  FOR UPDATE;

  -- Seul un véhicule en service est immobilisé : hors service reste hors service, maintenance reste
  -- maintenance (aucune ligne d'historique en double).
  IF v_status IS DISTINCT FROM 'operational' THEN
    RETURN NULL;
  END IF;

  UPDATE vehicles SET status = 'maintenance' WHERE id = NEW.vehicle_id;

  INSERT INTO status_history (vehicle_id, status, date, notes, updated_by_id)
  VALUES (
    NEW.vehicle_id,
    'maintenance',
    GREATEST((now() AT TIME ZONE 'UTC')::date, v_created_at::date),
    format('Véhicule passé en maintenance - Ordre de travail #%s rouvert', NEW.id),
    NULL
  );

  PERFORM pg_notify(
    'fleet_events',
    json_build_object(
      'source', 'database',
      'version', 1,
      'entity', 'vehicle',
      'entityId', NEW.vehicle_id,
      'eventType', 'vehicle_status_changed',
      'payload', json_build_object(
        'vehicleId', NEW.vehicle_id,
        'status', 'maintenance',
        'previousStatus', 'operational',
        'workOrderId', NEW.id,
        'source', 'work_order_trigger'
      ),
      'emittedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );

  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_work_orders_hold_vehicle
AFTER UPDATE OF status ON work_orders
FOR EACH ROW
WHEN (
  OLD.status IN ('completed', 'cancelled')
  AND NEW.status IN ('pending', 'in_progress', 'awaiting_parts')
)
EXECUTE FUNCTION fn_work_orders_hold_vehicle();
