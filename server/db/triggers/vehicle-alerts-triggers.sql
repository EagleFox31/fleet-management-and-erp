-- =============================================================================
-- TRIGGERS D'ALERTES POUR LA TABLE VEHICLES
-- =============================================================================

-- Fonction générique pour créer une alerte
CREATE OR REPLACE FUNCTION create_vehicle_alert(
    p_vehicle_id INTEGER,
    p_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_priority TEXT DEFAULT 'medium',
    p_link TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    -- Vérifier si l'alerte existe déjà
    IF NOT EXISTS (
        SELECT 1 FROM alerts 
        WHERE type = p_type 
        AND link LIKE '%vehicles%' || p_vehicle_id || '%'
        AND is_read = false
    ) THEN
        INSERT INTO alerts (user_id, title, message, type, priority, link, is_read)
        VALUES (1, p_title, p_message, p_type, p_priority, COALESCE(p_link, '/vehicles/' || p_vehicle_id), false);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. TRIGGER MAINTENANCE DUE PAR DATE
-- =============================================================================
CREATE OR REPLACE FUNCTION check_vehicle_maintenance_date() RETURNS TRIGGER AS $$
DECLARE
    days_overdue INTEGER;
    days_until INTEGER;
BEGIN
    -- Maintenance en retard
    IF NEW.next_maintenance_date IS NOT NULL AND NEW.next_maintenance_date < CURRENT_DATE THEN
        days_overdue := CURRENT_DATE - NEW.next_maintenance_date;
        
        PERFORM create_vehicle_alert(
            NEW.id,
            'maintenance_overdue',
            'Maintenance en retard',
            format('Véhicule %s - Maintenance en retard de %s jours', NEW.registration_number, days_overdue),
            CASE WHEN days_overdue > 30 THEN 'critical' ELSE 'high' END
        );
    END IF;
    
    -- Maintenance due dans les 7 jours
    IF NEW.next_maintenance_date IS NOT NULL THEN
        days_until := NEW.next_maintenance_date - CURRENT_DATE;
        
        IF days_until > 0 AND days_until <= 7 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'maintenance_due',
                'Maintenance programmée',
                format('Véhicule %s - Maintenance due dans %s jours', NEW.registration_number, days_until),
                'medium'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_vehicle_maintenance_date
    AFTER INSERT OR UPDATE OF next_maintenance_date, registration_number
    ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION check_vehicle_maintenance_date();

-- =============================================================================
-- 2. TRIGGER MAINTENANCE DUE PAR KILOMÉTRAGE
-- =============================================================================
CREATE OR REPLACE FUNCTION check_vehicle_maintenance_mileage() RETURNS TRIGGER AS $$
DECLARE
    remaining_km INTEGER;
BEGIN
    IF NEW.next_maintenance_mileage IS NOT NULL AND NEW.mileage IS NOT NULL THEN
        remaining_km := NEW.next_maintenance_mileage - NEW.mileage;
        
        -- Kilométrage dépassé
        IF remaining_km <= 0 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'maintenance_mileage_exceeded',
                'Kilométrage de maintenance dépassé',
                format('Véhicule %s - Kilométrage dépassé de %s km', NEW.registration_number, ABS(remaining_km)),
                'critical'
            );
        -- Kilométrage proche (dans les 5000 km)
        ELSIF remaining_km <= 5000 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'maintenance_mileage_approaching',
                'Kilométrage de maintenance proche',
                format('Véhicule %s - Plus que %s km avant maintenance', NEW.registration_number, remaining_km),
                CASE WHEN remaining_km <= 1000 THEN 'high' ELSE 'medium' END
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_vehicle_maintenance_mileage
    AFTER INSERT OR UPDATE OF mileage, next_maintenance_mileage, registration_number
    ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION check_vehicle_maintenance_mileage();

-- =============================================================================
-- 3. TRIGGER DOCUMENTS EXPIRÉS/EXPIRANT
-- =============================================================================
CREATE OR REPLACE FUNCTION check_vehicle_documents() RETURNS TRIGGER AS $$
DECLARE
    days_until_insurance INTEGER;
    days_until_technical INTEGER;
    days_until_license INTEGER;
BEGIN
    -- Assurance
    IF NEW.insurance_expiry IS NOT NULL THEN
        days_until_insurance := NEW.insurance_expiry - CURRENT_DATE;
        
        IF days_until_insurance < 0 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'document_expired',
                'Document expiré',
                format('Véhicule %s - Assurance expirée depuis %s jours', NEW.registration_number, ABS(days_until_insurance)),
                'critical'
            );
        ELSIF days_until_insurance <= 30 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'document_expiring',
                'Document expire bientôt',
                format('Véhicule %s - Assurance expire dans %s jours', NEW.registration_number, days_until_insurance),
                CASE WHEN days_until_insurance <= 7 THEN 'high' ELSE 'medium' END
            );
        END IF;
    END IF;
    
    -- Contrôle technique
    IF NEW.technical_inspection_date IS NOT NULL THEN
        days_until_technical := NEW.technical_inspection_date - CURRENT_DATE;
        
        IF days_until_technical < 0 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'document_expired',
                'Document expiré',
                format('Véhicule %s - Contrôle technique expiré depuis %s jours', NEW.registration_number, ABS(days_until_technical)),
                'critical'
            );
        ELSIF days_until_technical <= 30 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'document_expiring',
                'Document expire bientôt',
                format('Véhicule %s - Contrôle technique expire dans %s jours', NEW.registration_number, days_until_technical),
                CASE WHEN days_until_technical <= 7 THEN 'high' ELSE 'medium' END
            );
        END IF;
    END IF;
    
    -- Plaque d'immatriculation
    IF NEW.license_plate_expiry IS NOT NULL THEN
        days_until_license := NEW.license_plate_expiry - CURRENT_DATE;
        
        IF days_until_license < 0 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'document_expired',
                'Document expiré',
                format('Véhicule %s - Plaque d''immatriculation expirée depuis %s jours', NEW.registration_number, ABS(days_until_license)),
                'critical'
            );
        ELSIF days_until_license <= 30 THEN
            PERFORM create_vehicle_alert(
                NEW.id,
                'document_expiring',
                'Document expire bientôt',
                format('Véhicule %s - Plaque d''immatriculation expire dans %s jours', NEW.registration_number, days_until_license),
                CASE WHEN days_until_license <= 7 THEN 'high' ELSE 'medium' END
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_vehicle_documents
    AFTER INSERT OR UPDATE OF insurance_expiry, technical_inspection_date, license_plate_expiry, registration_number
    ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION check_vehicle_documents();