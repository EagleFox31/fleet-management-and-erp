CREATE OR REPLACE FUNCTION recalc_mission_fuel_totals(p_mission_id INTEGER)
RETURNS VOID AS $$
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE missions
  SET
    actual_fuel_quantity = (
      SELECT COALESCE(SUM(fr.quantity), 0)
      FROM fuel_records fr
      WHERE fr.mission_id = p_mission_id
        AND COALESCE(fr.debit_amount, '0')::numeric > 0
    ),
    actual_fuel_cost = (
      SELECT COALESCE(SUM(COALESCE(fr.debit_amount, '0')::numeric), 0)
      FROM fuel_records fr
      WHERE fr.mission_id = p_mission_id
        AND COALESCE(fr.debit_amount, '0')::numeric > 0
    ),
    updated_at = NOW()
  WHERE id = p_mission_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_mission_fuel_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recalc_mission_fuel_totals(NEW.mission_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_mission_fuel_totals(OLD.mission_id);
    RETURN OLD;
  END IF;

  IF OLD.mission_id IS DISTINCT FROM NEW.mission_id THEN
    PERFORM recalc_mission_fuel_totals(OLD.mission_id);
    PERFORM recalc_mission_fuel_totals(NEW.mission_id);
  ELSE
    PERFORM recalc_mission_fuel_totals(NEW.mission_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_mission_fuel ON fuel_records;
CREATE TRIGGER trigger_sync_mission_fuel
AFTER INSERT OR UPDATE OR DELETE ON fuel_records
FOR EACH ROW
EXECUTE FUNCTION sync_mission_fuel_totals();
