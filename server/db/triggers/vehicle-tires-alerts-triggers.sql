-- =============================================================================
-- TRIGGERS D'ALERTES POUR LA TABLE VEHICLE_TIRES
-- =============================================================================

-- TRIGGER USURE CRITIQUE DES PNEUS
CREATE OR REPLACE FUNCTION check_tire_wear() RETURNS TRIGGER AS $$
DECLARE
    vehicle_reg TEXT;
BEGIN
    -- Récupérer le numéro d'immatriculation du véhicule
    SELECT registration_number INTO vehicle_reg
    FROM vehicles 
    WHERE id = NEW.vehicle_id;
    
    -- Usure critique (profondeur <= 1.6mm)
    IF NEW.current_tread_depth IS NOT NULL AND NEW.current_tread_depth <= 1.6 THEN
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'maintenance',
            'Usure critique des pneus',
            format('Véhicule %s - Pneu position %s: profondeur critique %.1fmm', 
                vehicle_reg, NEW.position, NEW.current_tread_depth),
            'critical',
            '/vehicles/' || NEW.vehicle_id || '/tires'
        );
    -- Usure importante (profondeur <= 3mm)
    ELSIF NEW.current_tread_depth IS NOT NULL AND NEW.current_tread_depth <= 3 THEN
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'maintenance',
            'Usure importante des pneus',
            format('Véhicule %s - Pneu position %s: profondeur faible %.1fmm', 
                vehicle_reg, NEW.position, NEW.current_tread_depth),
            'high',
            '/vehicles/' || NEW.vehicle_id || '/tires'
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_tire_wear
    AFTER INSERT OR UPDATE OF current_tread_depth, position
    ON vehicle_tires
    FOR EACH ROW
    EXECUTE FUNCTION check_tire_wear();

-- TRIGGER PRESSION ANORMALE DES PNEUS
CREATE OR REPLACE FUNCTION check_tire_pressure() RETURNS TRIGGER AS $$
DECLARE
    vehicle_reg TEXT;
    pressure_deviation NUMERIC;
BEGIN
    -- Récupérer le numéro d'immatriculation du véhicule
    SELECT registration_number INTO vehicle_reg
    FROM vehicles 
    WHERE id = NEW.vehicle_id;
    
    -- Vérifier la pression si les deux valeurs sont disponibles
    IF NEW.current_pressure IS NOT NULL AND NEW.recommended_pressure IS NOT NULL AND NEW.recommended_pressure > 0 THEN
        pressure_deviation := ABS(NEW.current_pressure - NEW.recommended_pressure) / NEW.recommended_pressure * 100;
        
        -- Écart > 25% = critique
        IF pressure_deviation > 25 THEN
            PERFORM create_vehicle_alert(
                NEW.vehicle_id,
                'maintenance',
                'Pression pneu critique',
                format('Véhicule %s - Pneu position %s: pression %.1f bars (recommandée: %.1f bars)', 
                    vehicle_reg, NEW.position, NEW.current_pressure, NEW.recommended_pressure),
                'critical',
                '/vehicles/' || NEW.vehicle_id || '/tires'
            );
        -- Écart > 15% = important
        ELSIF pressure_deviation > 15 THEN
            PERFORM create_vehicle_alert(
                NEW.vehicle_id,
                'maintenance',
                'Pression pneu anormale',
                format('Véhicule %s - Pneu position %s: pression %.1f bars (recommandée: %.1f bars)', 
                    vehicle_reg, NEW.position, NEW.current_pressure, NEW.recommended_pressure),
                'high',
                '/vehicles/' || NEW.vehicle_id || '/tires'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_tire_pressure
    AFTER INSERT OR UPDATE OF current_pressure, recommended_pressure, position
    ON vehicle_tires
    FOR EACH ROW
    EXECUTE FUNCTION check_tire_pressure();

-- TRIGGER PNEUS ENDOMMAGÉS
CREATE OR REPLACE FUNCTION check_tire_damage() RETURNS TRIGGER AS $$
DECLARE
    vehicle_reg TEXT;
BEGIN
    -- Récupérer le numéro d'immatriculation du véhicule
    SELECT registration_number INTO vehicle_reg
    FROM vehicles 
    WHERE id = NEW.vehicle_id;
    
    -- Alertes selon le statut du pneu
    IF NEW.status = 'punctured' THEN
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'maintenance',
            'Pneu crevé',
            format('Véhicule %s - Pneu position %s: crevaison détectée', 
                vehicle_reg, NEW.position),
            'critical',
            '/vehicles/' || NEW.vehicle_id || '/tires'
        );
    ELSIF NEW.status = 'damaged' THEN
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'maintenance',
            'Pneu endommagé',
            format('Véhicule %s - Pneu position %s: dommage détecté', 
                vehicle_reg, NEW.position),
            'high',
            '/vehicles/' || NEW.vehicle_id || '/tires'
        );
    ELSIF NEW.status = 'worn' THEN
        PERFORM create_vehicle_alert(
            NEW.vehicle_id,
            'maintenance',
            'Pneu usé',
            format('Véhicule %s - Pneu position %s: remplacement nécessaire', 
                vehicle_reg, NEW.position),
            'medium',
            '/vehicles/' || NEW.vehicle_id || '/tires'
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_tire_damage
    AFTER UPDATE OF status
    ON vehicle_tires
    FOR EACH ROW
    WHEN (NEW.status IN ('punctured', 'damaged', 'worn'))
    EXECUTE FUNCTION check_tire_damage();