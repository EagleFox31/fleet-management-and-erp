-- =============================================================================
-- REALTIME DB EVENTS FOR WORK_ORDERS
-- Channel: fleet_events
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_work_orders_realtime() RETURNS TRIGGER AS $$
DECLARE
  operation_type TEXT;
  event_type TEXT;
  entity_id INTEGER;
  work_order_payload JSONB;
BEGIN
  -- Reprise d'historique (CDC #9) : SET LOCAL fleetos.suppress_side_effects = 'on' coupe cet effet.
  IF current_setting('fleetos.suppress_side_effects', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  operation_type := TG_OP;

  IF TG_OP = 'INSERT' THEN
    event_type := 'work_order_created';
    entity_id := NEW.id;
    work_order_payload := jsonb_build_object(
      'id', NEW.id,
      'vehicleId', NEW.vehicle_id,
      'technicianId', NEW.technician_id,
      'title', NEW.title,
      'status', NEW.status,
      'priority', NEW.priority,
      'updatedAt', NEW.updated_at
    );
  ELSIF TG_OP = 'UPDATE' THEN
    entity_id := NEW.id;
    event_type := CASE
      WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'work_order_status_changed'
      ELSE 'work_order_updated'
    END;
    work_order_payload := jsonb_build_object(
      'id', NEW.id,
      'vehicleId', NEW.vehicle_id,
      'technicianId', NEW.technician_id,
      'title', NEW.title,
      'status', NEW.status,
      'priority', NEW.priority,
      'updatedAt', NEW.updated_at
    );
  ELSIF TG_OP = 'DELETE' THEN
    event_type := 'work_order_deleted';
    entity_id := OLD.id;
    work_order_payload := jsonb_build_object(
      'id', OLD.id,
      'vehicleId', OLD.vehicle_id,
      'technicianId', OLD.technician_id,
      'title', OLD.title,
      'status', OLD.status,
      'priority', OLD.priority,
      'updatedAt', OLD.updated_at
    );
  END IF;

  PERFORM pg_notify(
    'fleet_events',
    json_build_object(
      'source', 'database',
      'version', 1,
      'entity', 'work_order',
      'entityId', entity_id,
      'eventType', event_type,
      'payload', json_build_object(
        'operation', operation_type,
        'workOrderId', entity_id,
        'vehicleId', COALESCE((work_order_payload ->> 'vehicleId')::INTEGER, NULL),
        'workOrder', work_order_payload
      ),
      'emittedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )::TEXT
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_work_orders_realtime_notify ON work_orders;

CREATE TRIGGER trigger_work_orders_realtime_notify
  AFTER INSERT OR UPDATE OR DELETE
  ON work_orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_work_orders_realtime();
