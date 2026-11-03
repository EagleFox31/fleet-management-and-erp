-- =============================================================================
-- TRIGGERS D'ALERTES POUR LA TABLE WORK_ORDERS
-- =============================================================================

-- TRIGGER ORDRES DE TRAVAIL EN RETARD
CREATE OR REPLACE FUNCTION check_work_order_overdue() RETURNS TRIGGER AS $$
DECLARE
    days_past INTEGER;
BEGIN
  -- Reprise d'historique (CDC #9) : SET LOCAL fleetos.suppress_side_effects = 'on' coupe cet effet.
  IF current_setting('fleetos.suppress_side_effects', true) = 'on' THEN RETURN NEW; END IF;
    -- Ordres en retard (pending ou in_progress avec start_date dépassée)
    IF (NEW.status = 'pending' OR NEW.status = 'in_progress') 
       AND NEW.start_date IS NOT NULL 
       AND NEW.start_date < CURRENT_DATE THEN
        
        days_past := CURRENT_DATE - NEW.start_date;
        
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'work_order',
            'Ordre de travail en retard',
            format('OT #%s "%s" - En retard de %s jours', NEW.id, NEW.title, days_past),
            CASE WHEN days_past > 7 THEN 'critical' ELSE 'high' END,
            '/work-orders/' || NEW.id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_work_order_overdue
    AFTER INSERT OR UPDATE OF status, start_date, title
    ON work_orders
    FOR EACH ROW
    EXECUTE FUNCTION check_work_order_overdue();

-- TRIGGER ORDRES CRITIQUES NON TRAITÉS
CREATE OR REPLACE FUNCTION check_critical_pending_work_order() RETURNS TRIGGER AS $$
DECLARE
    hours_waiting INTEGER;
BEGIN
  -- Reprise d'historique (CDC #9) : SET LOCAL fleetos.suppress_side_effects = 'on' coupe cet effet.
  IF current_setting('fleetos.suppress_side_effects', true) = 'on' THEN RETURN NEW; END IF;
    -- Ordres critiques en attente
    IF NEW.status = 'pending' AND NEW.priority = 'critical' THEN
        hours_waiting := EXTRACT(EPOCH FROM (NOW() - NEW.created_at)) / 3600;
        
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'work_order',
            'OT critique non traité',
            format('OT #%s "%s" - Critique non traité depuis %sh', NEW.id, NEW.title, hours_waiting::INTEGER),
            'critical',
            '/work-orders/' || NEW.id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_critical_pending_work_order
    AFTER INSERT OR UPDATE OF status, priority, title
    ON work_orders
    FOR EACH ROW
    EXECUTE FUNCTION check_critical_pending_work_order();