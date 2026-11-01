-- VEH4 : un véhicule en maintenance revient en service dès qu'il ne porte plus aucun OT ouvert,
-- quel que soit l'appelant (storage.updateWorkOrder, service technicien, contrôle qualité, SQL direct).
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est
-- porté par WORK_ORDER_VEHICLE_RELEASE_SQL (AGENTS.md §5), comparé par
-- tests/unit/server/work-orders-release-vehicle-drift.test.ts.
-- Idempotent : CREATE OR REPLACE FUNCTION puis CREATE OR REPLACE TRIGGER (instruction atomique,
-- PostgreSQL 14+ ; une paire DROP/CREATE est refusée par tests/unit/server/init-database-concurrency
-- après l'incident « trigger already exists »), dans une transaction sous verrou consultatif.
-- Additif : aucune donnée existante modifiée, aucun rattrapage (POST /api/check-all-maintenance,
-- reconcileVehicleStatusesFromWorkOrders, reste l'outil de rattrapage de l'historique).
-- Retour arrière : DROP TRIGGER IF EXISTS trg_work_orders_release_vehicle ON work_orders;
--                  DROP FUNCTION IF EXISTS fn_work_orders_release_vehicle();
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE OR REPLACE FUNCTION fn_work_orders_release_vehicle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_created_at timestamp;
BEGIN
  -- Verrou sur le véhicule avant le décompte : deux clôtures simultanées de ses deux derniers OT
  -- sont sérialisées, la seconde voit la première validée et libère le véhicule.
  SELECT status, created_at INTO v_status, v_created_at
  FROM vehicles
  WHERE id = NEW.vehicle_id AND deleted_at IS NULL
  FOR UPDATE;

  -- Seul un véhicule immobilisé par l'atelier est libéré : hors service reste hors service.
  IF v_status IS DISTINCT FROM 'maintenance' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.vehicle_id = NEW.vehicle_id
      AND w.status IN ('pending', 'in_progress', 'awaiting_parts')
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE vehicles SET status = 'operational' WHERE id = NEW.vehicle_id;

  INSERT INTO status_history (vehicle_id, status, date, notes, updated_by_id)
  VALUES (
    NEW.vehicle_id,
    'operational',
    GREATEST((now() AT TIME ZONE 'UTC')::date, v_created_at::date),
    format(
      'Véhicule remis en service - Ordre de travail #%s %s (aucun OT ouvert restant)',
      NEW.id,
      CASE NEW.status WHEN 'cancelled' THEN 'annulé' ELSE 'terminé' END
    ),
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
        'status', 'operational',
        'previousStatus', 'maintenance',
        'workOrderId', NEW.id,
        'source', 'work_order_trigger'
      ),
      'emittedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::text
  );

  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_work_orders_release_vehicle
AFTER UPDATE OF status ON work_orders
FOR EACH ROW
WHEN (
  OLD.status IN ('pending', 'in_progress', 'awaiting_parts')
  AND NEW.status NOT IN ('pending', 'in_progress', 'awaiting_parts')
)
EXECUTE FUNCTION fn_work_orders_release_vehicle();
