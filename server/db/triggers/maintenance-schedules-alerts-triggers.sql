-- =============================================================================
-- TRIGGERS D'ALERTES POUR LA TABLE MAINTENANCE_SCHEDULES
-- =============================================================================

-- TRIGGER MAINTENANCE PROGRAMMÉE DUE PAR DATE
CREATE OR REPLACE FUNCTION check_maintenance_schedule_due() RETURNS TRIGGER AS $$
DECLARE
    days_past INTEGER;
BEGIN
  -- Reprise d'historique (CDC #9) : SET LOCAL fleetos.suppress_side_effects = 'on' coupe cet effet.
  IF current_setting('fleetos.suppress_side_effects', true) = 'on' THEN RETURN NEW; END IF;
    -- Maintenance due par date
    IF NEW.is_active = true 
       AND NEW.scheduled_date IS NOT NULL 
       AND NEW.scheduled_date <= CURRENT_DATE THEN
        
        days_past := CURRENT_DATE - NEW.scheduled_date;
        
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'maintenance',
            'Maintenance programmée due',
            format('"%s" - Due depuis %s jours', NEW.title, days_past),
            CASE WHEN days_past > 7 THEN 'high' ELSE 'medium' END,
            '/maintenance/schedules/' || NEW.id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_maintenance_schedule_due
    AFTER INSERT OR UPDATE OF is_active, scheduled_date, title
    ON maintenance_schedules
    FOR EACH ROW
    EXECUTE FUNCTION check_maintenance_schedule_due();

-- TRIGGER MAINTENANCE DUE PAR KILOMÉTRAGE (via véhicules)
CREATE OR REPLACE FUNCTION check_maintenance_schedule_mileage() RETURNS TRIGGER AS $$
DECLARE
    schedule RECORD;
    excess_km INTEGER;
BEGIN
  -- Reprise d'historique (CDC #9) : SET LOCAL fleetos.suppress_side_effects = 'on' coupe cet effet.
  IF current_setting('fleetos.suppress_side_effects', true) = 'on' THEN RETURN NEW; END IF;
    -- Vérifier toutes les maintenances actives basées sur le kilométrage pour ce véhicule
    FOR schedule IN 
        SELECT id, title, scheduled_mileage, vehicle_id
        FROM maintenance_schedules 
        WHERE vehicle_id = NEW.id 
        AND is_active = true 
        AND scheduled_mileage IS NOT NULL
        AND NEW.mileage >= scheduled_mileage
    LOOP
        excess_km := NEW.mileage - schedule.scheduled_mileage;
        
        PERFORM create_vehicle_alert(
            NEW.id,
            'maintenance',
            'Maintenance kilométrage due',
            format('"%s" - Kilométrage dépassé de %s km (%s)', schedule.title, excess_km, NEW.registration_number),
            CASE WHEN excess_km > 10000 THEN 'high' ELSE 'medium' END,
            '/maintenance/schedules/' || schedule.id
        );
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_maintenance_schedule_mileage
    AFTER UPDATE OF mileage
    ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION check_maintenance_schedule_mileage();