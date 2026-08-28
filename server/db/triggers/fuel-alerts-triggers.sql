-- =============================================================================
-- TRIGGERS D'ALERTES POUR LA TABLE FUEL_RECORDS
-- =============================================================================

-- TRIGGER CONSOMMATION CARBURANT ANORMALE
CREATE OR REPLACE FUNCTION check_fuel_consumption() RETURNS TRIGGER AS $$
DECLARE
    avg_consumption NUMERIC;
    current_consumption NUMERIC;
    excess_percent INTEGER;
    previous_record RECORD;
BEGIN
    -- Récupérer l'enregistrement précédent pour calculer la consommation
    SELECT mileage, quantity INTO previous_record
    FROM fuel_records 
    WHERE vehicle_id = NEW.vehicle_id 
    AND date < NEW.date 
    ORDER BY date DESC 
    LIMIT 1;
    
    -- Calculer la consommation actuelle (L/100km)
    IF previous_record.mileage IS NOT NULL AND NEW.mileage > previous_record.mileage THEN
        current_consumption := (NEW.quantity::NUMERIC / (NEW.mileage - previous_record.mileage)) * 100;
        
        -- Calculer la consommation moyenne sur les 90 derniers jours
        SELECT AVG(
            (fr.quantity::NUMERIC / NULLIF((fr.mileage - LAG(fr.mileage) OVER (ORDER BY fr.date)), 0)) * 100
        ) INTO avg_consumption
        FROM fuel_records fr
        WHERE fr.vehicle_id = NEW.vehicle_id
        AND fr.date >= CURRENT_DATE - INTERVAL '90 days'
        AND fr.date < NEW.date;
        
        -- Vérifier si la consommation dépasse la moyenne de 20%
        IF avg_consumption IS NOT NULL AND avg_consumption > 0 AND current_consumption > avg_consumption * 1.2 THEN
            excess_percent := ((current_consumption - avg_consumption) / avg_consumption * 100)::INTEGER;
            
            PERFORM create_vehicle_alert(
                NEW.vehicle_id,
                'fuel',
                'Consommation carburant élevée',
                format('Véhicule - Consommation +%s%% vs moyenne (%.1fL/100km)', excess_percent, current_consumption),
                CASE WHEN excess_percent > 50 THEN 'high' ELSE 'medium' END,
                '/vehicles/' || NEW.vehicle_id || '/fuel'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_fuel_consumption
    AFTER INSERT
    ON fuel_records
    FOR EACH ROW
    EXECUTE FUNCTION check_fuel_consumption();

-- TRIGGER COÛT CARBURANT ÉLEVÉ
CREATE OR REPLACE FUNCTION check_fuel_cost() RETURNS TRIGGER AS $$
DECLARE
    monthly_budget NUMERIC := 500000; -- Budget mensuel par véhicule en F CFA
    current_month_total NUMERIC;
BEGIN
    -- Calculer le total du mois en cours pour ce véhicule
    SELECT COALESCE(SUM(cost), 0) INTO current_month_total
    FROM fuel_records
    WHERE vehicle_id = NEW.vehicle_id
    AND date >= date_trunc('month', CURRENT_DATE)
    AND date <= CURRENT_DATE;
    
    -- Vérifier si le budget mensuel est dépassé
    IF current_month_total > monthly_budget THEN
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'fuel',
            'Budget carburant dépassé',
            format('Véhicule - Budget mensuel dépassé: %s F CFA / %s F CFA', 
                current_month_total::INTEGER, monthly_budget::INTEGER),
            'high',
            '/vehicles/' || NEW.vehicle_id || '/fuel'
        );
    -- Alerte à 80% du budget
    ELSIF current_month_total > monthly_budget * 0.8 THEN
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'fuel',
            'Budget carburant en approche',
            format('Véhicule - 80%% du budget mensuel atteint: %s F CFA / %s F CFA', 
                current_month_total::INTEGER, monthly_budget::INTEGER),
            'medium',
            '/vehicles/' || NEW.vehicle_id || '/fuel'
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_fuel_cost
    AFTER INSERT OR UPDATE OF cost
    ON fuel_records
    FOR EACH ROW
    EXECUTE FUNCTION check_fuel_cost();